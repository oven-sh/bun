//! `bun test --timings=<path>...` / `--update-timings`:
//! `{ "version": 1, "files": { "relative/path.test.ts": ms } }`, used to
//! balance `--shard` by total duration and to start the slowest files first
//! under `--parallel`. Several files (one per CI shard) are unioned on read;
//! under `--shard` a run writes only the files it ran, so those per-shard
//! outputs are disjoint and next run's union of them is the whole table.

use std::io::Write as _;

use bun_collections::StringArrayHashMap;
use bun_core::{Output, strings};
use bun_options_types::context::Shard;
use bun_parsers::json as bun_json;
use bun_ptr::Interned;
use bun_resolver::fs::FileSystem;
use bun_sys::{Fd, File};

use super::parallel::file_range::FileRange;
use bun_collections::index_sort;

pub struct Timings {
    /// The first `--timings` path; `--update-timings` writes here.
    path: Box<[u8]>,
    /// Posix-separator paths relative to the project root → milliseconds; loaded entries overlaid with this run's.
    map: StringArrayHashMap<u32>,
    /// Just this run's measurements; what a `--shard` run writes.
    measured: StringArrayHashMap<u32>,
    /// Cost assigned to files with no entry when packing shards.
    median: u32,
}

impl Timings {
    /// Missing files are not an error (the first `--update-timings` run creates one); malformed ones are.
    pub fn load(paths: &[Box<[u8]>]) -> Timings {
        let mut map: StringArrayHashMap<u32> = StringArrayHashMap::new();
        for path in paths {
            Self::load_one(path, &mut map);
        }
        let median = {
            let mut known: Vec<u32> = map.values().to_vec();
            index_sort::sort_slice_unstable_by(&mut known, |a, b| a.cmp(b));
            known.get(known.len() / 2).copied().unwrap_or(0)
        };
        Timings {
            path: paths[0].clone(),
            map,
            measured: StringArrayHashMap::new(),
            median,
        }
    }

    fn load_one(path: &[u8], map: &mut StringArrayHashMap<u32>) {
        let contents = match File::read_from(Fd::cwd(), path) {
            Ok(contents) => contents,
            Err(err) if err.get_errno() == bun_sys::E::ENOENT => return,
            Err(err) => {
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: failed to read --timings file <b>{}<r>: {}",
                    bstr::BStr::new(path),
                    err
                );
                bun_core::Global::exit(1);
            }
        };
        if contents.is_empty() {
            return;
        }
        bun_ast::initialize_store();
        let source = bun_ast::Source::init_path_string(path, &contents[..]);
        let mut log = bun_ast::Log::init();
        let parsed = match bun_json::ParsedJson::parse_json(&source, &mut log) {
            Ok(p) => p,
            Err(_) => {
                let _ = log.print(std::ptr::from_mut::<bun_core::io::Writer>(
                    Output::error_writer(),
                ));
                bun_core::pretty_errorln!(
                    "<r><red>error<r>: --timings file <b>{}<r> is not valid JSON",
                    bstr::BStr::new(path)
                );
                bun_core::Global::exit(1);
            }
        };
        let root = &parsed.root;
        let files = Some(root)
            .filter(|r| r.as_property(b"version").and_then(|v| v.expr.as_number()) == Some(1.0))
            .and_then(|r| r.get_object(b"files"));
        let Some(files) = files else {
            bun_core::pretty_errorln!(
                "<r><red>error<r>: --timings file <b>{}<r> must look like {{ \"version\": 1, \"files\": {{ \"path\": milliseconds }} }}",
                bstr::BStr::new(path)
            );
            bun_core::Global::exit(1);
        };
        files.for_each_property(|key, _, value| {
            if let Some(ms) = value.as_number()
                && ms.is_finite()
                && ms >= 0.0
            {
                let _ = map.put(key, ms.round().min(u32::MAX as f64) as u32);
            }
        });
        bun_ast::Expr::data_store_reset();
        bun_ast::Stmt::data_store_reset();
    }

    pub fn is_empty(&self) -> bool {
        self.map.count() == 0
    }

    fn key_for(abs_path: &[u8]) -> Vec<u8> {
        let rel = bun_paths::resolve_path::relative(FileSystem::get().top_level_dir, abs_path);
        let mut key = rel.to_vec();
        if cfg!(windows) {
            bun_paths::resolve_path::platform_to_posix_in_place(&mut key[..]);
        }
        key
    }

    /// Recorded duration for a test file, if the table has one.
    pub fn get(&self, abs_path: &[u8]) -> Option<u32> {
        self.map.get(&Self::key_for(abs_path)).copied()
    }

    pub fn record(&mut self, abs_path: &[u8], ms: u32) {
        let key = Self::key_for(abs_path);
        let _ = self.map.put(&key, ms);
        let _ = self.measured.put(&key, ms);
    }

    pub fn record_since(&mut self, abs_path: &[u8], started_ms: i64) {
        let elapsed = (bun_core::time::milli_timestamp() - started_ms).max(0);
        self.record(abs_path, u32::try_from(elapsed).unwrap_or(u32::MAX));
    }

    fn cost(&self, abs_path: &[u8]) -> u64 {
        u64::from(self.get(abs_path).unwrap_or(self.median).max(1))
    }

    pub fn costs(&self, files: &[Interned]) -> Vec<u64> {
        files.iter().map(|f| self.cost(f.as_bytes())).collect()
    }

    /// Cut path-sorted `files` into `k` contiguous runs of roughly equal total
    /// duration. Contiguous so files that share a directory (and therefore most
    /// of their imports) land in the same process and hit its module cache;
    /// by duration so a directory of slow integration tests is spread over
    /// several runs instead of becoming one shard's tail.
    pub fn partition(&self, files: &[Interned], k: u32) -> Vec<FileRange> {
        let costs = self.costs(files);
        let n = files.len() as u32;
        let mut remaining: u64 = costs.iter().sum();
        let mut ranges = Vec::with_capacity(k as usize);
        let mut i: u32 = 0;
        for bin in 0..k {
            // Re-aim at the average of what's left so one huge file doesn't starve the runs after it.
            let target = remaining / u64::from(k - bin);
            let lo = i;
            let mut load: u64 = 0;
            while i < n
                && (bin == k - 1
                    || load == 0
                    || (2 * load + costs[i as usize] <= 2 * target && n - i > k - 1 - bin))
            {
                load += costs[i as usize];
                i += 1;
            }
            remaining -= load;
            ranges.push(FileRange { lo, hi: i });
        }
        ranges
    }

    /// Keeps shard `index` of `count` (see [`partition`]) compacted to the
    /// front of `files`; returns how many were kept.
    pub fn select_shard(&self, files: &mut [Interned], shard: Shard) -> usize {
        index_sort::sort_slice_by(files, |a, b| strings::order(a.as_bytes(), b.as_bytes()));
        let r = self.partition(files, shard.count)[(shard.index - 1) as usize];
        files.copy_within(r.lo as usize..r.hi as usize, 0);
        (r.hi - r.lo) as usize
    }

    /// Slowest first; files with no recorded duration go before everything
    /// else so an unknown (possibly slow) file never becomes the tail.
    pub fn sort_slowest_first(&self, files: &mut [Interned]) {
        let known: Vec<u64> = files
            .iter()
            .map(|f| self.get(f.as_bytes()).map_or(u64::MAX, u64::from))
            .collect();
        let mut order = index_sort::identity(files.len());
        index_sort::sort_indices(&mut order, &mut |a, b| {
            known[b as usize].cmp(&known[a as usize]).then_with(|| {
                files[a as usize]
                    .as_bytes()
                    .cmp(files[b as usize].as_bytes())
            })
        });
        index_sort::apply_permutation_in_place(files, &mut order);
    }

    /// Slowest-first (ties by path) so the file doubles as a "what's slow"
    /// report. `only_measured` (set under `--shard`) writes just the files this
    /// run ran; otherwise everything read is carried through so a local partial
    /// run doesn't shrink the table.
    pub fn write(&mut self, only_measured: bool) {
        let map = if only_measured {
            &mut self.measured
        } else {
            &mut self.map
        };
        map.sort(|keys, ms, a, b| {
            ms[b]
                .cmp(&ms[a])
                .then_with(|| strings::order(&keys[a], &keys[b]))
                .is_lt()
        });
        let mut out: Vec<u8> = Vec::with_capacity(map.count() * 48 + 40);
        out.extend_from_slice(b"{\n  \"version\": 1,\n  \"files\": {");
        for (i, (key, ms)) in map.iter().enumerate() {
            let _ = write!(
                &mut out,
                "{}\n    {}: {}",
                if i > 0 { "," } else { "" },
                bun_core::fmt::format_json_string_utf8(key, Default::default()),
                ms
            );
        }
        out.extend_from_slice(if map.count() > 0 {
            b"\n  }\n}\n"
        } else {
            b"}\n}\n"
        });

        let mut tmp: Vec<u8> = self.path.to_vec();
        let _ = write!(&mut tmp, ".{}.tmp", std::process::id());
        let tmp_z = bun_core::ZBox::from_vec(tmp);
        let dest_z = bun_core::ZBox::from_bytes(&self.path);
        let flags =
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC | bun_sys::O::CLOEXEC;
        let result = File::make_open(tmp_z.as_bytes(), flags, 0o666)
            .and_then(|f| f.write_all(&out))
            .and_then(|()| bun_sys::renameat(Fd::cwd(), &tmp_z, Fd::cwd(), &dest_z));
        if let Err(err) = result {
            let _ = bun_sys::unlinkat(Fd::cwd(), &tmp_z);
            Output::err(
                crate::Error::WriteFailed,
                "Failed to write --timings file {}\n{}",
                (bstr::BStr::new(&self.path), err),
            );
        }
    }
}
