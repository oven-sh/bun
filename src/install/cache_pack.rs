//! `bun pm cache pack <file>` / `bun pm cache unpack <file>` — a single-file,
//! uncompressed snapshot of exactly the cache entries the current lockfile
//! needs.
//!
//! CI caches backed by object storage are dramatically faster at moving
//! one large sequential file than tens of thousands of small ones, and the
//! restore side of a directory cache pays a create+write per file *before*
//! `bun install` even starts. With a pack, CI restores one file, `unpack`
//! recreates only the missing cache folders (sequential reads, one rename per
//! package), and `bun install --frozen-lockfile` then finds every tarball
//! already extracted in the cache.
//!
//! Format (little endian, no compression — outer layers already zstd):
//!   magic "BUNCACHEPACK\0v1\n"
//!   repeated:  u8 kind | u32 path_len | path | u32 mode | u64 size | bytes
//!     kind 1 = package folder start (path = cache folder name; size = 0)
//!     kind 2 = regular file (path relative to the current folder)
//!     kind 3 = symlink (bytes = link target)
//!     kind 4 = directory (explicit, for empty dirs)
//!     kind 0 = end of pack

use std::io::{BufReader, BufWriter, Read, Write};

use bun_core::strings;
use bun_paths::SEP;

use crate::PackageManager;
use crate::lockfile_real::package::PackageColumns as _;
use crate::package_manager_real::directories;
use crate::resolution_real::Tag as ResolutionTag;

const MAGIC: &[u8] = b"BUNCACHEPACK\0v1\n";

pub struct PackSummary {
    pub packages: u32,
    pub files: u64,
    pub bytes: u64,
    pub skipped_missing: u32,
}

pub struct UnpackSummary {
    pub packages: u32,
    pub created: u32,
    pub already_present: u32,
    pub bytes: u64,
}

// Paths in this module are plain byte strings (`Vec<u8>` / `&[u8]`), joined with the
// platform separator and NUL-terminated only at the syscall boundary — no `std::path`
// and no UTF-8 requirement on archive-controlled names.

fn join(a: &[u8], b: &[u8]) -> Vec<u8> {
    let mut v = Vec::with_capacity(a.len() + 1 + b.len());
    v.extend_from_slice(a);
    if !a.is_empty() && !b.is_empty() && a[a.len() - 1] != SEP && a[a.len() - 1] != b'/' {
        v.push(SEP);
    }
    v.extend_from_slice(b);
    v
}

fn z(p: &[u8]) -> bun_core::ZBox {
    let mut v = Vec::with_capacity(p.len() + 1);
    v.extend_from_slice(p);
    v.push(0);
    bun_core::ZBox::from_vec_with_nul(v)
}

fn parent(p: &[u8]) -> Option<&[u8]> {
    bun_paths::dirname(p).filter(|d| !d.is_empty())
}

/// Kind of `p` itself (not following symlinks); None if it does not exist.
fn lstat_kind(p: &[u8]) -> std::io::Result<Option<bun_sys::FileKind>> {
    match bun_sys::lstat(&z(p)) {
        Ok(st) => Ok(Some(bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode))),
        Err(e) if e.get_errno() == bun_sys::E::ENOENT => Ok(None),
        Err(e) => Err(sys_err(e)),
    }
}

fn is_dir(p: &[u8]) -> bool {
    matches!(bun_sys::stat(&z(p)), Ok(st) if bun_sys::kind_from_mode(st.st_mode as bun_sys::Mode) == bun_sys::FileKind::Directory)
}

/// What sits at a cache-folder root: a real directory is packed, nothing is skipped,
/// anything else (a symlink, a file, an unreadable entry) is an error rather than a
/// silently incomplete pack.
fn folder_root_kind(p: &[u8]) -> std::io::Result<Option<()>> {
    match lstat_kind(p)? {
        Some(bun_sys::FileKind::Directory) => Ok(Some(())),
        None => Ok(None),
        Some(_) => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("cache entry {} is not a directory", bstr::BStr::new(p)),
        )),
    }
}

/// (name, kind) for every entry of `dir`, sorted by name. `Unknown` d_type is resolved
/// with an lstat so callers can rely on the kind.
fn list_dir(dir: &[u8]) -> std::io::Result<Vec<(Vec<u8>, bun_sys::FileKind)>> {
    let fd = bun_sys::open_dir_for_iteration(bun_sys::Fd::cwd(), dir).map_err(sys_err)?;
    let mut out = Vec::new();
    let mut iter = bun_sys::iterate_dir(fd);
    loop {
        match iter.next() {
            Ok(Some(entry)) => {
                let name = entry.name.slice_u8().to_vec();
                let kind = match entry.kind {
                    bun_sys::FileKind::Unknown => {
                        lstat_kind(&join(dir, &name))?.unwrap_or(bun_sys::FileKind::Unknown)
                    }
                    k => k,
                };
                out.push((name, kind));
            }
            Ok(None) => break,
            Err(e) => {
                let _ = bun_sys::close(fd);
                return Err(sys_err(e));
            }
        }
    }
    drop(iter);
    let _ = bun_sys::close(fd);
    out.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

fn rename(from: &[u8], to: &[u8]) -> std::io::Result<()> {
    bun_sys::renameat(bun_sys::Fd::cwd(), &z(from), bun_sys::Fd::cwd(), &z(to)).map_err(sys_err)
}

fn mkdir_p(p: &[u8]) -> std::io::Result<()> {
    bun_sys::mkdir_recursive(p).map_err(sys_err)
}

fn rm_rf(p: &[u8]) {
    let _ = bun_sys::delete_tree_absolute(p);
}

#[allow(clippy::needless_pass_by_value)] // used as `.map_err(sys_err)`
fn sys_err(e: bun_sys::Error) -> std::io::Error {
    std::io::Error::from_raw_os_error(i32::from(e.errno))
}

/// `std::io::Read` over a `bun_sys::File`.
struct FileReader(bun_sys::File);
impl Read for FileReader {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        self.0.read(buf).map_err(sys_err)
    }
}
/// `std::io::Write` over a `bun_sys::File`.
struct FileWriter(bun_sys::File);
impl Write for FileWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0.write_all(buf).map_err(sys_err)?;
        Ok(buf.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// The cache folder name for every fetchable package in the lockfile, and whether
/// the package is expected on this platform (os/cpu/libc) — used only to decide
/// whether a missing folder deserves a warning.
pub fn cache_folder_names(pm: &mut PackageManager) -> Vec<(Vec<u8>, bool)> {
    let mut out: Vec<(Vec<u8>, bool)> = Vec::new();
    let count = pm.lockfile.packages.len();
    for i in 0..count {
        let (name, resolution, expected) = {
            let pkgs = &pm.lockfile.packages;
            let meta = &pkgs.items_meta()[i];
            (
                pkgs.items_name()[i],
                pkgs.items_resolution()[i],
                !meta.is_disabled(pm.options.cpu, pm.options.os),
            )
        };
        let folder: Option<Vec<u8>> = match resolution.tag {
            ResolutionTag::Npm => {
                let name = pm.lockfile.str(&name).to_vec();
                Some(
                    directories::cached_npm_package_folder_name(
                        pm,
                        &name,
                        resolution.npm().version,
                        None,
                    )
                    .as_bytes()
                    .to_vec(),
                )
            }
            ResolutionTag::Git => Some(
                directories::cached_git_folder_name(pm, resolution.git(), None)
                    .as_bytes()
                    .to_vec(),
            ),
            ResolutionTag::Github => Some(
                directories::cached_github_folder_name(pm, resolution.github(), None)
                    .as_bytes()
                    .to_vec(),
            ),
            ResolutionTag::RemoteTarball => Some(
                directories::cached_tarball_folder_name(pm, *resolution.remote_tarball(), None)
                    .as_bytes()
                    .to_vec(),
            ),
            _ => None,
        };
        if let Some(f) = folder {
            if !f.is_empty() && !out.iter().any(|(e, _)| *e == f) {
                out.push((f, expected));
            }
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn write_record(
    w: &mut impl Write,
    kind: u8,
    path: &[u8],
    mode: u32,
    data: &[u8],
) -> std::io::Result<()> {
    w.write_all(&[kind])?;
    w.write_all(&(path.len() as u32).to_le_bytes())?;
    w.write_all(path)?;
    w.write_all(&mode.to_le_bytes())?;
    w.write_all(&(data.len() as u64).to_le_bytes())?;
    w.write_all(data)
}

fn pack_dir(
    w: &mut impl Write,
    root: &[u8],
    rel: &[u8],
    files: &mut u64,
    bytes: &mut u64,
) -> std::io::Result<()> {
    let here = join(root, rel);
    let entries = list_dir(&here)?;
    if entries.is_empty() && !rel.is_empty() {
        write_record(w, 4, rel, 0o755, &[])?;
    }
    for (name, kind) in entries {
        // records always use `/` so a pack is portable
        let mut child_rel = rel.to_vec();
        if !child_rel.is_empty() {
            child_rel.push(b'/');
        }
        child_rel.extend_from_slice(&name);
        let abs = join(root, &child_rel);
        match kind {
            bun_sys::FileKind::Directory => pack_dir(w, root, &child_rel, files, bytes)?,
            bun_sys::FileKind::SymLink => {
                let mut buf = [0u8; 4096];
                let n = bun_sys::readlink(&z(&abs), &mut buf).map_err(sys_err)?;
                write_record(w, 3, &child_rel, 0o777, &buf[..n])?;
            }
            bun_sys::FileKind::File => {
                let f = bun_sys::File::openat(bun_sys::Fd::cwd(), &abs, bun_sys::O::RDONLY, 0)
                    .map_err(sys_err)?;
                #[cfg(unix)]
                let mode = bun_sys::fstat(f.handle()).map_err(sys_err)?.st_mode as u32;
                #[cfg(not(unix))]
                let mode = 0o644u32;
                let data = f.read_to_end().map_err(sys_err)?;
                *files += 1;
                *bytes += data.len() as u64;
                write_record(w, 2, &child_rel, mode, &data)?;
            }
            // sockets, fifos, devices: not part of a package
            _ => {}
        }
    }
    Ok(())
}

/// Write a pack of every cache folder the lockfile references that exists locally.
pub fn pack(
    pm: &mut PackageManager,
    cache_dir: &[u8],
    out_path: &[u8],
) -> std::io::Result<PackSummary> {
    let folders = cache_folder_names(pm);
    let mut tmp = out_path.to_vec();
    let _ = write!(tmp, ".{}.tmp", std::process::id());
    let result = pack_impl(&folders, cache_dir, out_path, &tmp);
    if result.is_err() {
        // never leave a partial temp file behind (ENOSPC, unreadable cache entry, …)
        let _ = bun_sys::unlinkat(bun_sys::Fd::cwd(), &z(&tmp));
    }
    result
}

fn pack_impl(
    folders: &[(Vec<u8>, bool)],
    cache_dir: &[u8],
    out_path: &[u8],
    tmp: &[u8],
) -> std::io::Result<PackSummary> {
    let file = bun_sys::File::create(bun_sys::Fd::cwd(), tmp, true).map_err(sys_err)?;
    let mut w = BufWriter::with_capacity(1 << 20, FileWriter(file));
    w.write_all(MAGIC)?;
    let mut summary = PackSummary {
        packages: 0,
        files: 0,
        bytes: 0,
        skipped_missing: 0,
    };
    for (f, expected_here) in folders {
        let dir = join(cache_dir, f);
        if folder_root_kind(&dir)?.is_none() {
            // optional binaries for other platforms are legitimately absent
            if *expected_here {
                summary.skipped_missing += 1;
            }
            continue;
        }
        write_record(&mut w, 1, f, 0, &[])?;
        pack_dir(&mut w, &dir, b"", &mut summary.files, &mut summary.bytes)?;
        summary.packages += 1;
    }
    write_record(&mut w, 0, b"", 0, &[])?;
    w.flush()?;
    drop(w);
    rename(tmp, out_path)?;
    Ok(summary)
}

fn read_exact_vec(r: &mut impl Read, n: usize) -> std::io::Result<Vec<u8>> {
    let mut v = vec![0u8; n];
    r.read_exact(&mut v)?;
    Ok(v)
}

fn bad(msg: &str) -> std::io::Error {
    std::io::Error::new(std::io::ErrorKind::InvalidData, msg.to_string())
}

/// Reject anything that could write outside the folder being restored.
fn safe_rel(path: &[u8]) -> bool {
    !path.is_empty()
        && path[0] != b'/'
        && path[0] != b'\\'
        && !strings::contains_char(path, 0)
        && !strings::contains_char(path, b':')
        && !strings::split_any(path, b"/\\").any(|seg| seg == b"..")
}

/// May a symlink at package-relative `link_path` point at `target`? Relative targets
/// are resolved against the link's own directory and must stay inside the package
/// (`bin/cli -> ../lib/cli.js` is fine, `x -> ../../etc` is not); absolute targets,
/// drive letters and NULs are refused. Mirrors the extractor's own rule for tarballs.
fn symlink_target_stays_inside(link_path: &[u8], target: &[u8]) -> bool {
    if target.is_empty()
        || target[0] == b'/'
        || target[0] == b'\\'
        || strings::contains_char(target, 0)
        || strings::contains_char(target, b':')
    {
        return false;
    }
    // depth of the directory containing the link, relative to the package root
    let mut depth: i64 = strings::split_any(link_path, b"/\\")
        .filter(|c| !c.is_empty() && *c != b".")
        .count() as i64
        - 1;
    if depth < 0 {
        return false;
    }
    for comp in strings::split_any(target, b"/\\") {
        match comp {
            b"" | b"." => {}
            b".." => {
                depth -= 1;
                if depth < 0 {
                    return false;
                }
            }
            _ => depth += 1,
        }
    }
    true
}

/// A cache folder name is either `name@ver…` or `@scope/name@ver…` (one slash).
fn safe_folder_name(name: &[u8]) -> bool {
    if !safe_rel(name) || strings::contains_char(name, b'\\') || name == b"." || name == b".." {
        return false;
    }
    let slashes = strings::count_char(name, b'/');
    slashes == 0 || (slashes == 1 && name[0] == b'@' && !name.ends_with(b"/"))
}

/// Restore missing cache folders from a pack. Existing folders are left untouched
/// (their bytes are skipped without being written).
pub fn unpack(cache_dir: &[u8], pack_path: &[u8]) -> std::io::Result<UnpackSummary> {
    let result = unpack_impl(cache_dir, pack_path);
    if result.is_err() {
        // don't leave a half-written staging dir behind
        if let Ok(entries) = list_dir(cache_dir) {
            let mine = format!(".unpack-{}-", std::process::id());
            for (name, _) in entries {
                if name.starts_with(mine.as_bytes()) {
                    rm_rf(&join(cache_dir, &name));
                }
            }
        }
    }
    result
}

fn unpack_impl(cache_dir: &[u8], pack_path: &[u8]) -> std::io::Result<UnpackSummary> {
    mkdir_p(cache_dir)?;
    let file = bun_sys::File::openat(bun_sys::Fd::cwd(), pack_path, bun_sys::O::RDONLY, 0)
        .map_err(sys_err)?;
    let mut r = BufReader::with_capacity(1 << 20, FileReader(file));
    let magic = read_exact_vec(&mut r, MAGIC.len())?;
    if magic != MAGIC {
        return Err(bad("not a bun cache pack (bad magic)"));
    }
    let mut record_no: u64 = 0;
    // errors name the record so a corrupt pack can be identified and regenerated
    let bad = |msg: &str, record_no: u64| -> std::io::Error {
        std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!(
                "{msg} (record #{record_no}); delete the pack file and re-create it with `bun pm cache pack`"
            ),
        )
    };
    let mut summary = UnpackSummary {
        packages: 0,
        created: 0,
        already_present: 0,
        bytes: 0,
    };
    // Staging directories are named `.unpack-<pid>-<n>`; only this process's own are
    // ever removed (on failure, by `unpack`), so a concurrent unpack is never disturbed.
    // current folder: (final path, staging path) — None while skipping an existing one
    let mut current: Option<(Vec<u8>, Vec<u8>)> = None;
    let mut skipping = false;
    let pid = std::process::id();

    let finish = |cur: &mut Option<(Vec<u8>, Vec<u8>)>,
                  summary: &mut UnpackSummary|
     -> std::io::Result<()> {
        if let Some((final_path, staging)) = cur.take() {
            match rename(&staging, &final_path) {
                Ok(()) => summary.created += 1,
                Err(e) if is_dir(&final_path) => {
                    // lost a race with a concurrent unpack/install: theirs is as good as ours
                    let _ = e;
                    rm_rf(&staging);
                    summary.already_present += 1;
                }
                Err(e) => return Err(e),
            }
        }
        Ok(())
    };

    loop {
        record_no += 1;
        let mut kind = [0u8; 1];
        r.read_exact(&mut kind)?;
        let mut u32b = [0u8; 4];
        r.read_exact(&mut u32b)?;
        let path_len = u32::from_le_bytes(u32b) as usize;
        if path_len > 4096 {
            return Err(bad("path too long", record_no));
        }
        let path = read_exact_vec(&mut r, path_len)?;
        r.read_exact(&mut u32b)?;
        let mode = u32::from_le_bytes(u32b);
        let mut u64b = [0u8; 8];
        r.read_exact(&mut u64b)?;
        let size = u64::from_le_bytes(u64b);
        match kind[0] {
            0 => {
                finish(&mut current, &mut summary)?;
                break;
            }
            1 => {
                finish(&mut current, &mut summary)?;
                if !safe_folder_name(&path) {
                    return Err(bad("unsafe cache folder name in pack", record_no));
                }
                summary.packages += 1;
                let final_path = join(cache_dir, &path);
                if lstat_kind(&final_path)?.is_some() {
                    skipping = true;
                    summary.already_present += 1;
                    current = None;
                } else {
                    skipping = false;
                    if let Some(parent) = parent(&final_path) {
                        // `@scope/` directory for scoped packages
                        mkdir_p(parent)?;
                    }
                    let staging = join(
                        cache_dir,
                        format!(".unpack-{}-{}", pid, summary.packages).as_bytes(),
                    );
                    rm_rf(&staging);
                    mkdir_p(&staging)?;
                    current = Some((final_path, staging));
                }
                if size != 0 {
                    return Err(bad("folder record with payload", record_no));
                }
            }
            2..=4 => {
                if size > (1u64 << 34) {
                    return Err(bad("entry too large", record_no));
                }
                if skipping || current.is_none() {
                    // consume payload without writing
                    std::io::copy(&mut (&mut r).take(size), &mut std::io::sink())?;
                    continue;
                }
                if !safe_rel(&path) {
                    return Err(bad("unsafe entry path in pack", record_no));
                }
                let (_, staging) = current.as_ref().unwrap();
                let dest = join(staging, &path);
                // refuse to traverse a symlink materialized earlier in this package
                {
                    let mut p = staging.clone();
                    let comps: Vec<&[u8]> = strings::split_any(&path, b"/\\")
                        .filter(|c| !c.is_empty())
                        .collect();
                    for (i, c) in comps.iter().enumerate() {
                        p = join(&p, c);
                        if lstat_kind(&p)? == Some(bun_sys::FileKind::SymLink)
                            && (i + 1 < comps.len() || kind[0] != 3)
                        {
                            return Err(bad("pack entry traverses a symlink", record_no));
                        }
                    }
                }
                match kind[0] {
                    4 => {
                        mkdir_p(&dest)?;
                        std::io::copy(&mut (&mut r).take(size), &mut std::io::sink())?;
                    }
                    3 => {
                        if size > 4096 {
                            return Err(bad("symlink target too long", record_no));
                        }
                        let target = read_exact_vec(&mut r, size as usize)?;
                        // links inside a package may only point within it
                        if !symlink_target_stays_inside(&path, &target) {
                            return Err(bad("unsafe symlink target in pack", record_no));
                        }
                        if let Some(parent) = parent(&dest) {
                            mkdir_p(parent)?;
                        }
                        #[cfg(unix)]
                        bun_sys::symlinkat(&z(&target), bun_sys::Fd::cwd(), &z(&dest))
                            .map_err(sys_err)?;
                        #[cfg(not(unix))]
                        {
                            let _ = (target, dest);
                            return Err(std::io::Error::new(
                                std::io::ErrorKind::Unsupported,
                                "this pack contains symbolic links, which `bun pm cache unpack` cannot restore on this platform yet",
                            ));
                        }
                    }
                    _ => {
                        if let Some(parent) = parent(&dest) {
                            mkdir_p(parent)?;
                        }
                        let f = bun_sys::File::create(bun_sys::Fd::cwd(), &dest, true)
                            .map_err(sys_err)?;
                        #[cfg(unix)]
                        {
                            // keep the executable bit, never setuid/setgid/sticky or world-write
                            let m = (mode & 0o755) | 0o600;
                            bun_sys::fchmod(f.handle(), m as bun_sys::Mode).map_err(sys_err)?;
                        }
                        #[cfg(not(unix))]
                        let _ = mode;
                        let mut w = FileWriter(f);
                        let copied = std::io::copy(&mut (&mut r).take(size), &mut w)?;
                        if copied != size {
                            return Err(bad("truncated pack", record_no));
                        }
                        summary.bytes += size;
                    }
                }
            }
            _ => return Err(bad("unknown record kind", record_no)),
        }
    }
    Ok(summary)
}
