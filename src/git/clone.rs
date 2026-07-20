//! `clone(url, dir)` — wires `bun_http` transport → protocol → pack indexer →
//! checkout, and lays down a `.git` (incl. v2 index) that `git status` reads clean.

use crate::fs::{dir_nonempty, mkdirp, write_trusted};
use crate::odb::Odb;
use crate::pack::{Inflate, PackIndex};
use crate::transport::Remote;
use crate::{Error, Oid, Result, checkout, odb, protocol};
use bstr::BStr;
use bun_core::time::Timer;
use bun_threading::{Guarded, WaitGroup, WorkPool};
use core::fmt::Write as _;

#[derive(Default)]
pub struct CloneOptions {
    /// Skip working-tree checkout.
    pub no_checkout: bool,
    /// Suppress server progress (band 2) and our own timing lines.
    pub quiet: bool,
    /// Parallel blob-fetch connections (0 = auto = 8). 1 = single-connection
    /// path (one full pack, like `git clone`).
    pub jobs: usize,
    /// Skeleton history slices (0 = auto). 1 = single skeleton stream.
    pub skeleton_slices: usize,
}

/// Clone `url` (`http[s]://…`) into `dest` (absolute byte path). `dest` must
/// not exist or must be an empty directory. Returns the HEAD commit oid.
pub fn clone(url: &str, dest: &[u8], opts: &CloneOptions) -> Result<Oid> {
    let remote = Remote::parse(url)?;

    if dir_nonempty(dest)? {
        return Err(Error::Http(format!(
            "destination {:?} exists and is not empty",
            BStr::new(dest)
        )));
    }
    mkdirp(dest)?;
    let git_dir = join(dest, b".git");
    init_git_dir(&git_dir)?;

    // ── handshake + ls-refs ────────────────────────────────────────────────
    let caps = protocol::handshake(&remote)?;
    let refs = protocol::ls_refs(&remote)?;
    if refs.is_empty() {
        return Err(Error::Protocol("remote has no refs".into()));
    }
    let head = refs
        .iter()
        .find(|r| r.name == "HEAD")
        .ok_or_else(|| Error::Protocol("remote has no HEAD".into()))?;
    let head_oid = head.oid;
    let head_target = head.symref_target.clone();
    write_config(&git_dir, url, head_target.as_deref())?;

    // Want every distinct branch/tag tip + HEAD.
    let mut wants: Vec<Oid> = refs.iter().map(|r| r.oid).collect();
    wants.sort_unstable();
    wants.dedup();

    // Parallel path needs server-side `filter` support (GitHub, GitLab,
    // Gitea, any `uploadpack.allowFilter=true` backend). Fall back to one
    // full pack otherwise.
    let jobs = match (opts.jobs, caps.filter) {
        (0, true) => 8,
        (0, false) | (_, false) => 1,
        (n, true) => n,
    };
    let mut odb = Odb::new();
    let t0 = Timer::start().unwrap();

    if jobs == 1 {
        // Single-connection path: one full pack, identical to `git clone`.
        let buf = fetch_pack(&remote, &wants, &[], None, opts.quiet)?;
        log(
            opts,
            format_args!("\nReceived {} bytes in {:.2}s", buf.len(), s(t0)),
        );
        let t1 = Timer::start().unwrap();
        odb.push(PackIndex::build(buf, &mut Default::default())?);
        log(
            opts,
            format_args!("Indexed {} objects in {:.2}s", odb.packs()[0].len(), s(t1)),
        );
    } else {
        // ── Phase A: skeleton (commits + trees + tags) ────────────────────
        // Partition history at semver-sorted tags so the skeleton downloads
        // in parallel slices. We don't advertise `thin-pack`, so each
        // `want pt[i], have pt[0..i]` slice is self-contained.
        //
        // Slices are pushed to `queue` as each fetch completes; main drains
        // the queue and indexes (full `WorkPool` parallelism per slice)
        // **while later slices are still in flight** — so phase A wall-clock
        // is `max(slowest-fetch, Σ index)` instead of `slowest-fetch + Σ index`.
        // 4 slices is the measured sweet spot: enough to beat per-conn
        // bandwidth caps when slices are even (git/git: 4.96 s vs 5.99 s
        // single-stream), few enough that server-side per-slice graph walks
        // don't dominate when they're not (node: ~flat across 1–4).
        let k = if opts.skeleton_slices == 0 {
            4
        } else {
            opts.skeleton_slices
        };
        let pts = if k <= 1 {
            Vec::new()
        } else {
            partition_points(&refs, k - 1)
        };
        // Tried per-slice blob dispatch (fire blob buckets as each skeleton
        // slice lands): it loses. Early blob streams compete with the
        // remaining skeleton streams for the same ~150 MB/s link, so the
        // last skeleton slice — the one gating *full* blob knowledge —
        // arrives later, and the net is 2-3× slower than two clean phases.
        // The link is the bottleneck, not idle time; reordering work on a
        // saturated pipe doesn't help.
        let n_slices = pts.len() + 1;
        let queue: Guarded<Vec<Result<Vec<u8>>>> = Guarded::new(Vec::new());
        let cv = bun_threading::Condvar::new();
        dispatch_skeleton_fetches(&remote, &wants, &pts, opts.quiet, &queue, &cv);

        // Phase-B state lives here so wave-1 can fire from inside the drain
        // loop the moment the last skeleton *fetch* completes (before that
        // last batch is indexed). Wave-2 carries whatever the last batch
        // adds. No bandwidth contention: skeleton bytes are all received
        // before any blob byte is requested.
        let blob_wg = WaitGroup::init_with_count(0);
        let blob_out: Guarded<Vec<Result<PackIndex>>> = Guarded::new(Vec::new());
        let blob_bytes = Guarded::new(0usize);

        let mut all = crate::pack::OidMap::<u32>::default();
        let mut total_objs = 0usize;
        let mut skel_bytes = 0usize;
        let mut done = 0usize;
        let mut wave1_sent = false;

        let index_one = |buf: Vec<u8>,
                         all: &mut crate::pack::OidMap<u32>,
                         odb: &mut Odb,
                         total_objs: &mut usize,
                         skel_bytes: &mut usize|
         -> Result<()> {
            *skel_bytes += buf.len();
            let mut sink = crate::pack::BlobSink {
                want: true,
                ..Default::default()
            };
            let p = PackIndex::build_with(buf, &mut Default::default(), &mut sink, false)?;
            *total_objs += p.len();
            all.ensure_total_capacity(all.len() + sink.seen.len())
                .expect("OOM");
            sink.merge_into(all);
            odb.push(p);
            Ok(())
        };

        while done < n_slices {
            let batch: Vec<Result<Vec<u8>>> = {
                let mut g = queue.lock();
                while g.is_empty() {
                    cv.wait_guarded(&mut g);
                }
                core::mem::take(&mut *g)
            };
            done += batch.len();
            let last = done == n_slices;
            // Last fetch in hand → link is idle. Fire wave-1 from everything
            // already indexed *before* paying the index cost of this batch.
            if last && !all.is_empty() {
                let buckets = bucket_blobs(&all, jobs, None);
                blob_wg.add(buckets.len());
                dispatch_blob_fetches(
                    &remote,
                    &git_dir,
                    buckets,
                    opts.quiet,
                    &blob_wg,
                    &blob_out,
                    &blob_bytes,
                );
                wave1_sent = true;
                // Wave-2: index this batch into a *fresh* map, then dispatch
                // only oids not already in `all` (= not in wave-1).
                let mut tail = crate::pack::OidMap::<u32>::default();
                for buf in batch {
                    index_one(buf?, &mut tail, &mut odb, &mut total_objs, &mut skel_bytes)?;
                }
                let buckets = bucket_blobs(&tail, jobs, Some(&all));
                blob_wg.add(buckets.len());
                dispatch_blob_fetches(
                    &remote,
                    &git_dir,
                    buckets,
                    opts.quiet,
                    &blob_wg,
                    &blob_out,
                    &blob_bytes,
                );
                break;
            }
            for buf in batch {
                index_one(buf?, &mut all, &mut odb, &mut total_objs, &mut skel_bytes)?;
            }
        }
        if !wave1_sent {
            // All slices arrived in one batch — single dispatch.
            let buckets = bucket_blobs(&all, jobs, None);
            blob_wg.add(buckets.len());
            dispatch_blob_fetches(
                &remote,
                &git_dir,
                buckets,
                opts.quiet,
                &blob_wg,
                &blob_out,
                &blob_bytes,
            );
        }
        let t2 = Timer::start().unwrap();
        log(
            opts,
            format_args!(
                "\nSkeleton: {} bytes / {} objs in {} slices, fetched ‖ indexed in {:.2}s; blobs → {} streams{}",
                skel_bytes,
                total_objs,
                n_slices,
                s(t0),
                jobs,
                if wave1_sent {
                    " (wave-1 fired pre-index)"
                } else {
                    ""
                }
            ),
        );
        // Skeleton packs to disk while blobs download.
        for p in odb.packs() {
            write_pack_and_idx(&git_dir, p)?;
        }
        write_refs(&git_dir, &refs, head_target.as_deref())?;
        blob_wg.wait();
        for r in core::mem::take(&mut *blob_out.lock()) {
            odb.push(r?);
        }
        log(
            opts,
            format_args!(
                "Blobs: {} bytes, tail {:.2}s after skeleton",
                *blob_bytes.lock(),
                s(t2)
            ),
        );
    }

    // -j1 path writes here; the parallel path already wrote everything
    // overlapped with phase B.
    if jobs == 1 {
        for p in odb.packs() {
            write_pack_and_idx(&git_dir, p)?;
        }
        write_refs(&git_dir, &refs, head_target.as_deref())?;
    }

    // ── checkout ───────────────────────────────────────────────────────────
    if !opts.no_checkout {
        let tc = Timer::start().unwrap();
        let mut inf = Inflate::new();
        let tree = odb::read_commit_tree(&odb, &head_oid, &mut inf)?;
        let entries = checkout::checkout(&odb, tree, dest)?;
        crate::index::write(dest, entries)?;
        log(opts, format_args!("Checked out HEAD in {:.2}s", s(tc)));
    }
    log(opts, format_args!("Total: {:.2}s", s(t0)));

    Ok(head_oid)
}

#[inline]
fn s(t: Timer) -> f64 {
    t.read() as f64 / 1e9
}
fn log(opts: &CloneOptions, args: core::fmt::Arguments<'_>) {
    if !opts.quiet {
        bun_core::pretty_errorln!("{}", args);
    }
}

/// Partition `set` into `n` path-hash buckets, optionally skipping oids
/// already present in `exclude` (wave-2's "new since wave-1" delta).
fn bucket_blobs(
    set: &crate::pack::OidMap<u32>,
    n: usize,
    exclude: Option<&crate::pack::OidMap<u32>>,
) -> Vec<Vec<Oid>> {
    let mut buckets: Vec<Vec<Oid>> = (0..n).map(|_| Vec::new()).collect();
    for (oid, h) in set.iter() {
        if exclude.is_some_and(|e| e.get(oid).is_some()) {
            continue;
        }
        buckets[(*h as usize) % n].push(*oid);
    }
    buckets
}

/// One blocking fetch → buffered pack bytes.
fn fetch_pack(
    remote: &Remote,
    wants: &[Oid],
    haves: &[Oid],
    filter: Option<&str>,
    quiet: bool,
) -> Result<Vec<u8>> {
    let buf = Guarded::new(Vec::<u8>::new());
    protocol::fetch(remote, wants, haves, filter, quiet, |data| {
        buf.lock().extend_from_slice(data);
        Ok(())
    })?;
    Ok(core::mem::take(&mut *buf.lock()))
}

/// Pick `k` evenly-spaced tag oids as history partition points. Tags sort
/// roughly chronologically (semver-ish) so each `want pt[i], have pt[i-1]`
/// slice is a contiguous span of history. If a repo's tags aren't linear the
/// slices just overlap a bit — still correct, only less compressed.
fn partition_points(refs: &[protocol::Ref], k: usize) -> Vec<Oid> {
    let mut tags: Vec<&protocol::Ref> = refs
        .iter()
        .filter(|r| r.name.starts_with("refs/tags/"))
        .collect();
    if tags.len() < k * 2 {
        return Vec::new();
    }
    // Semver-aware: split the tag name on non-digit runs and compare each
    // numeric run as an integer (so v2 < v10).
    tags.sort_by_cached_key(|r| version_key(&r.name));
    // Bias toward recent: commit density grows over a project's life, so the
    // last slice (newest) is the fattest under uniform spacing. Place point i
    // at fraction `1 - ((k+1-i)/(k+1))²` instead of `i/(k+1)` — quadratic
    // toward the tail packs more cuts into recent history.
    let n = tags.len();
    (1..=k)
        .map(|i| {
            let r = (k + 1 - i) as f64 / (k + 1) as f64;
            let frac = 1.0 - r * r;
            tags[((frac * n as f64) as usize).min(n - 1)].oid
        })
        .collect()
}

fn version_key(name: &str) -> Vec<u64> {
    let mut out = Vec::with_capacity(4);
    let mut n = 0u64;
    let mut in_num = false;
    for b in name.bytes() {
        if b.is_ascii_digit() {
            n = n.saturating_mul(10).saturating_add(u64::from(b - b'0'));
            in_num = true;
        } else if in_num {
            out.push(n);
            n = 0;
            in_num = false;
        }
    }
    if in_num {
        out.push(n);
    }
    out
}

/// Dispatch `pts.len()+1` skeleton-slice fetches; each worker pushes its raw
/// pack bytes to `queue` and signals `cv` as soon as the stream completes.
/// Caller drains the queue concurrently (index-while-fetching).
///
/// Lifetime: `queue`/`cv` live on the caller's stack; the caller's drain loop
/// doesn't return until it has popped exactly `pts.len()+1` items, and each
/// worker's last action is `cv.notify_one()` *after* its push — so by the
/// time the caller exits the loop, every worker has returned and no longer
/// holds the `BackRef`s. That's the same guarantee `WaitGroup` gave, just
/// expressed through the queue count.
fn dispatch_skeleton_fetches(
    remote: &Remote,
    all_tips: &[Oid],
    pts: &[Oid],
    quiet: bool,
    queue: &Guarded<Vec<Result<Vec<u8>>>>,
    cv: &bun_threading::Condvar,
) {
    let n = pts.len() + 1;
    for i in 0..n {
        let want: Vec<Oid> = if i == n - 1 {
            all_tips.to_vec()
        } else {
            vec![pts[i]]
        };
        // Every earlier partition point as `have` — tags aren't always a
        // straight line, and an extra `have` only shrinks the slice.
        let have: Vec<Oid> = pts[..i].to_vec();
        let remote = remote.clone();
        let q = bun_ptr::BackRef::from(core::ptr::NonNull::from(queue));
        let c = bun_ptr::BackRef::from(core::ptr::NonNull::from(cv));
        WorkPool::go(
            (remote, want, have, quiet, q, c),
            move |(remote, want, have, quiet, q, c)| {
                let r = fetch_pack(&remote, &want, &have, Some("blob:none"), quiet);
                q.lock().push(r);
                c.notify_one();
            },
        )
        .unwrap();
    }
}

/// Dispatch `buckets.len()` blob fetches; each worker fetches → indexes
/// (`build_serial` — no nested pool) → writes `.pack`/`.idx` to `git_dir`,
/// then signals. Everything hides under the slowest stream.
#[allow(clippy::too_many_arguments)]
fn dispatch_blob_fetches(
    remote: &Remote,
    git_dir: &[u8],
    buckets: Vec<Vec<Oid>>,
    quiet: bool,
    wg: &WaitGroup,
    out: &Guarded<Vec<Result<PackIndex>>>,
    bytes: &Guarded<usize>,
) {
    for wants in buckets {
        if wants.is_empty() {
            wg.finish();
            continue;
        }
        let remote = remote.clone();
        let git_dir = git_dir.to_vec();
        let wg_ref = bun_ptr::BackRef::from(core::ptr::NonNull::from(wg));
        let out_ref = bun_ptr::BackRef::from(core::ptr::NonNull::from(out));
        let bytes_ref = bun_ptr::BackRef::from(core::ptr::NonNull::from(bytes));
        WorkPool::go(
            (remote, git_dir, wants, quiet, wg_ref, out_ref, bytes_ref),
            move |(remote, git_dir, wants, quiet, wg, out, bytes)| {
                let r = fetch_pack(&remote, &wants, &[], None, quiet).and_then(|buf| {
                    *bytes.lock() += buf.len();
                    let p = PackIndex::build_serial(buf)?;
                    write_pack_and_idx(&git_dir, &p)?;
                    Ok(p)
                });
                out.lock().push(r);
                wg.finish();
            },
        )
        .unwrap();
    }
}

fn write_pack_and_idx(git_dir: &[u8], p: &PackIndex) -> Result<()> {
    let name = p.pack_hash();
    write_trusted(
        &join(git_dir, format!("objects/pack/pack-{name}.pack").as_bytes()),
        p.pack_bytes(),
    )?;
    let mut idx_buf = Vec::new();
    p.write_idx(&mut idx_buf);
    write_trusted(
        &join(git_dir, format!("objects/pack/pack-{name}.idx").as_bytes()),
        &idx_buf,
    )?;
    Ok(())
}

/// Standalone index-pack: read `pack_path`, write `<pack_path%.pack>.idx`.
/// Same work `git index-pack` does — used for apples-to-apples benchmarking.
pub fn index_pack_file(pack_path: &[u8]) -> Result<Oid> {
    let pack = bun_sys::File::openat(bun_core::Fd::cwd(), pack_path, bun_sys::O::RDONLY, 0)?
        .read_to_end()?;
    let mut tm = crate::pack::Timings::default();
    let t = Timer::start().unwrap();
    let idx = PackIndex::build(pack, &mut tm)?;
    bun_core::pretty_errorln!(
        "Indexed {} objects in {:.3}s (trailer {:.3}s, scan {:.3}s, resolve {:.3}s, {} deltas)",
        idx.len(),
        t.read() as f64 / 1e9,
        tm.trailer_sha as f64 / 1e9,
        tm.pass1_scan as f64 / 1e9,
        tm.pass2_resolve as f64 / 1e9,
        tm.n_deltas,
    );
    let mut idx_buf = Vec::new();
    idx.write_idx(&mut idx_buf);
    let idx_path: Vec<u8> = pack_path
        .strip_suffix(b".pack")
        .unwrap_or(pack_path)
        .iter()
        .copied()
        .chain(*b".idx")
        .collect();
    write_trusted(&idx_path, &idx_buf)?;
    Ok(idx.pack_hash())
}

fn join(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(a.len() + 1 + b.len());
    out.extend_from_slice(a);
    out.push(b'/');
    out.extend_from_slice(b);
    out
}

fn init_git_dir(git: &[u8]) -> Result<()> {
    for sub in [
        &b"objects/pack"[..],
        b"objects/info",
        b"refs/heads",
        b"refs/tags",
        b"refs/remotes/origin",
        b"info",
    ] {
        mkdirp(&join(git, sub))?;
    }
    write_trusted(&join(git, b"HEAD"), b"ref: refs/heads/master\n")?;
    write_trusted(&join(git, b"description"), b"unnamed repository\n")?;
    Ok(())
}

fn write_config(git: &[u8], url: &str, head_target: Option<&str>) -> Result<()> {
    let mut cfg = format!(
        "[core]\n\trepositoryformatversion = 0\n\tfilemode = true\n\tbare = false\n\
         [remote \"origin\"]\n\turl = {url}\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n"
    );
    if let Some(branch) = head_target
        .and_then(|t| t.strip_prefix("refs/heads/"))
        // `\` is already rejected by check_ref_format; `"` would need escaping
        // in the subsection header — skip the stanza for that exotic case.
        .filter(|b| !b.contains('"'))
    {
        write!(
            cfg,
            "[branch \"{branch}\"]\n\tremote = origin\n\tmerge = refs/heads/{branch}\n"
        )
        .unwrap();
    }
    write_trusted(&join(git, b"config"), cfg.as_bytes())
}

fn write_refs(git: &[u8], refs: &[protocol::Ref], head_target: Option<&str>) -> Result<()> {
    // Packed refs: every advertised ref plus a refs/remotes/origin/* mirror of
    // each branch tip, so `git branch -r` and `git pull` see an upstream.
    let mut lines: Vec<(String, Oid)> = Vec::with_capacity(refs.len() * 2);
    for r in refs {
        if r.name == "HEAD" || r.symref_target.is_some() {
            continue;
        }
        lines.push((r.name.clone(), r.oid));
        if let Some(branch) = r.name.strip_prefix("refs/heads/") {
            lines.push((format!("refs/remotes/origin/{branch}"), r.oid));
        }
    }
    lines.sort_by(|a, b| a.0.cmp(&b.0));
    let mut packed = String::from("# pack-refs with: peeled fully-peeled sorted \n");
    for (name, oid) in &lines {
        writeln!(packed, "{oid} {name}").unwrap();
    }
    write_trusted(&join(git, b"packed-refs"), packed.as_bytes())?;

    let head = head_target.unwrap_or("refs/heads/master");
    write_trusted(&join(git, b"HEAD"), format!("ref: {head}\n").as_bytes())?;
    // refs/remotes/origin/HEAD is a symbolic ref — loose file, never packed.
    // Only write it when the server actually told us what HEAD points at.
    if let Some(branch) = head_target.and_then(|t| t.strip_prefix("refs/heads/")) {
        write_trusted(
            &join(git, b"refs/remotes/origin/HEAD"),
            format!("ref: refs/remotes/origin/{branch}\n").as_bytes(),
        )?;
    }
    Ok(())
}
