//! Resumable, non-blocking tarball extractor for `bun install`.
//!
//! The HTTP thread hands each body chunk to `on_chunk`, which appends to a
//! small pending buffer and (if not already running) schedules
//! `DrainTask` on `THREAD_POOL`. The drain task feeds
//! whatever is available to a `bun_tar::Decoder`, writing files as their
//! data arrives, until the decoder has consumed everything that is
//! buffered. At that point the drain task returns and the worker is
//! released. The next HTTP chunk reschedules the drain task, which resumes
//! exactly where it left off because the decoder and the open output
//! `bun.FD` live on the heap in it.
//!
//! This lets `bun install` overlap download and extraction on the normal
//! resolve thread pool without ever parking a worker on a condvar, and
//! without holding the full compressed or decompressed tarball in memory.

use std::sync::Arc;

use bun_archive::tar::{self, Event};
use bun_collections::{HiveBox, VecExt};
#[cfg(windows)]
use bun_core::strings;
use bun_core::{self, Output, env_var, fmt as bun_fmt};
use bun_paths::resolve_path::{self, platform};
use bun_paths::{self, OSPathChar, OSPathSliceZ};
#[cfg(windows)]
use bun_sys::Dir;
#[cfg(not(windows))]
use bun_sys::FdDirExt;
use bun_sys::{self, Fd, File, FileKind, Mode, O};
use bun_threading::{Guarded, OwnedTask, thread_pool};

use crate::bun_fs::FileSystem;
use crate::cache_publish::UnfinishedEntry;
use crate::integrity::{self, Integrity};
use crate::package_manager_real::{INBOX, PackageManager, THREAD_POOL};
use crate::{ExtractTarball, NetworkTask};

type OSPathZ<'a> = &'a OSPathSliceZ;

pub struct TarballStream {
    incoming: Arc<Guarded<Incoming>>,
}

/// What the HTTP thread hands to the drain task.
struct Incoming {
    /// Compressed .tgz bytes that have not yet been moved to `reading`.
    pending: Vec<u8>,
    /// Set once the HTTP thread has delivered the final chunk (or an error, in `response.fail`).
    network_task: Option<HiveBox<NetworkTask>>,
    /// `None` while the drain task is queued or running.
    drain_task: Option<Box<DrainTask>>,
}

struct DrainTask {
    task: thread_pool::Task,
    /// `None` while `Incoming::drain_task` holds the task.
    incoming: Option<Arc<Guarded<Incoming>>>,

    /// Bytes currently being decoded. Populated by swapping with `pending`
    /// under the mutex so the HTTP thread can keep appending while the
    /// decoder works without the lock held.
    reading: Vec<u8>,
    read_pos: usize,

    decoder: Option<tar::Decoder>,
    extraction: Extraction,

    /// Incremental SHA over the *compressed* bytes, matching
    /// `Integrity.verify` / `Integrity.forBytes` in the buffered path.
    hasher: integrity::Streaming,

    /// `Content-Length` of the response, when the server sent one.
    content_length: Option<usize>,
    bytes_received: usize,
    fail: Option<crate::Error>,
}

bun_threading::intrusive_work_task!(DrainTask, task);

/// What the decoder's events are applied to.
struct Extraction {
    /// The decoder reached the end of the archive.
    done: bool,

    /// Output file for the entry currently being written. `None` while
    /// between entries or when the current entry is being skipped.
    out: Option<bun_archive::EntryWriter>,
    write_strategy: bun_archive::WriteStrategy,

    /// Temp directory files are written into before being renamed into the
    /// cache. Lazily opened on the first drain so the HTTP thread never
    /// touches the filesystem.
    // Not a `Dir`, which closes 0-2: auto-install can run after script has closed one of them.
    dest: Option<File>,
    /// After `dest`: Windows can't remove a directory that is open.
    staging: Option<UnfinishedEntry>,

    /// Resolved first-directory name for GitHub tarballs (written to
    /// `.bun-tag` and used for the cache folder name).
    resolved_github_dirname: &'static [u8],
    want_first_dirname: bool,
    npm_mode: bool,

    /// Compressed bytes the decoder has consumed so far.
    bytes_consumed: usize,
    entry_count: u32,
    /// The decoder's message for `fail == Some(Fail)`.
    fail_detail: Vec<u8>,
    invalid_name: bool,

    tarball: ExtractTarball,
}

impl TarballStream {
    /// Minimum Content-Length for which the streaming path is used. Below
    /// this the whole body is buffered as before; the resumable
    /// state machine is only worth its per-chunk overhead for tarballs that
    /// would otherwise consume a noticeable amount of memory.
    pub(crate) fn min_size() -> usize {
        // env_var.get() returns Option<u64> even when a default
        // is configured; the var has a 2 MiB
        // default so unwrap is infallible here.
        usize::try_from(env_var::BUN_INSTALL_STREAMING_MIN_SIZE.get().unwrap()).expect("int cast")
    }

    /// Compressed bytes to buffer in `pending` before the HTTP thread
    /// schedules a drain; without this each body chunk re-wakes a worker
    /// once the drain has yielded. See `BUN_INSTALL_STREAMING_DRAIN_THRESHOLD`.
    fn drain_threshold() -> usize {
        usize::try_from(
            env_var::BUN_INSTALL_STREAMING_DRAIN_THRESHOLD
                .get()
                .unwrap(),
        )
        .expect("int cast")
    }

    pub(crate) fn init(tarball: &ExtractTarball, body_size: bun_http::BodySize) -> TarballStream {
        // For GitHub/URL/local tarballs we need a SHA-512 to record in the
        // lockfile even when there is no expected value to verify against,
        // matching `ExtractTarball.run`.
        let compute_if_missing = !tarball.integrity.tag.is_supported()
            && matches!(
                tarball.resolution.tag,
                ResolutionTag::Github | ResolutionTag::RemoteTarball | ResolutionTag::LocalTarball
            );

        let npm_mode = tarball.resolution.tag != ResolutionTag::Github;
        // An existing lockfile bun-tag keys the cache lookup; prefer it over the root dir name.
        let resolved_github_dirname = tarball.github_resolved;
        let want_first_dirname =
            tarball.resolution.tag == ResolutionTag::Github && resolved_github_dirname.is_empty();
        let hasher = integrity::Streaming::init(
            &if tarball.skip_verify {
                Integrity::default()
            } else {
                tarball.integrity
            },
            compute_if_missing,
        );

        let drain_task = Box::new(DrainTask {
            task: thread_pool::Task::default(),
            incoming: None,
            reading: Vec::new(),
            read_pos: 0,
            decoder: None,
            extraction: Extraction {
                done: false,
                out: None,
                write_strategy: bun_archive::WriteStrategy::default(),
                dest: None,
                staging: None,
                resolved_github_dirname,
                want_first_dirname,
                npm_mode,
                bytes_consumed: 0,
                entry_count: 0,
                fail_detail: Vec::new(),
                invalid_name: false,
                tarball: tarball.clone(),
            },
            hasher,
            content_length: match body_size {
                bun_http::BodySize::ContentLength(len) => Some(len),
                _ => None,
            },
            bytes_received: 0,
            fail: None,
        });
        TarballStream {
            incoming: Arc::new(Guarded::new(Incoming {
                pending: Vec::new(),
                network_task: None,
                drain_task: Some(drain_task),
            })),
        }
    }

    /// Called from the HTTP thread for each response-body chunk but the last. Returns
    /// without touching the filesystem or the decoder; actual processing is
    /// deferred to the drain task on a worker so the HTTP event loop stays
    /// responsive.
    pub(crate) fn on_chunk(&self, chunk: &[u8]) {
        let drain_threshold = Self::drain_threshold();
        let mut incoming = self.incoming.lock();
        incoming.pending.extend_from_slice(chunk);
        // One wakeup per batch of small chunks.
        let is_full = incoming.pending.len() >= drain_threshold;
        let drain_task = incoming.drain_task.take_if(|_| is_full);
        drop(incoming);
        if let Some(drain_task) = drain_task {
            drain_task.schedule(Arc::clone(&self.incoming));
        }
    }

    /// The drain task pushes `network_task` onto `INBOX`.
    pub(crate) fn on_last_chunk(self, chunk: &[u8], network_task: HiveBox<NetworkTask>) {
        let mut incoming = self.incoming.lock();
        incoming.pending.extend_from_slice(chunk);
        incoming.network_task = Some(network_task);
        let drain_task = incoming.drain_task.take();
        drop(incoming);
        if let Some(drain_task) = drain_task {
            drain_task.schedule(self.incoming);
        }
    }
}

impl OwnedTask for DrainTask {
    fn run(mut self: Box<Self>) {
        Output::Source::configure_thread();

        let shared = self.incoming.take().expect("set by `schedule`");
        loop {
            let mut incoming = shared.lock();
            if incoming.pending.is_empty() && incoming.network_task.is_none() {
                // Yield the worker until the HTTP thread delivers the next chunk.
                incoming.drain_task = Some(self);
                return;
            }
            self.take_pending(&mut incoming.pending);
            let network_task = incoming.network_task.take();
            drop(incoming);
            match network_task {
                Some(network_task) => return self.finish(network_task),
                None => self.decode(false, None),
            }
        }
    }
}

impl DrainTask {
    fn schedule(mut self: Box<Self>, incoming: Arc<Guarded<Incoming>>) {
        self.incoming = Some(incoming);
        THREAD_POOL.schedule(thread_pool::Batch::from_owned(self));
    }

    fn is_decoding(&self) -> bool {
        self.fail.is_none() && !self.extraction.done
    }

    /// Feed `reading` to the decoder, writing entries to disk. `eof`: nothing follows it.
    fn decode(&mut self, eof: bool, http_err: Option<crate::Error>) {
        if !self.is_decoding() {
            return;
        }
        if let Err(err) = self.step(eof) {
            // If the body was cut short by a transport error,
            // that is the failure; the decoder's complaint about
            // the truncated input is just its symptom.
            self.fail = Some(match (err, http_err) {
                (crate::Error::Fail, Some(http_err)) => http_err,
                (err, _) => err,
            });
            self.extraction.out = None;
        }
        if !self.is_decoding() {
            // The decoder will not be called again, so `reading` is dead — drop it
            // now rather than carrying its capacity until `finish()`.
            self.reading = Vec::new();
            self.read_pos = 0;
        }
    }

    /// Move the bytes of `pending` into `reading` for `step()`, or discard them once the decoder is done.
    fn take_pending(&mut self, pending: &mut Vec<u8>) {
        self.bytes_received += pending.len();
        // Hash before the decoder sees the bytes so integrity covers exactly
        // what came off the socket, including what follows the end of the
        // archive (tar zero-padding, gzip footer). Skip this once
        // an error is recorded — the digest won't be checked anyway.
        if self.fail.is_none() {
            self.hasher.update(pending);
        }
        if self.is_decoding() {
            if self.reading.len() == self.read_pos {
                // Previous buffer fully consumed — swap so the HTTP thread can
                // reuse its capacity without reallocating.
                core::mem::swap(&mut self.reading, pending);
            } else {
                // Keep the unconsumed tail in front of the new bytes.
                self.reading.drain_front(self.read_pos);
                self.reading.extend_from_slice(pending);
            }
            self.read_pos = 0;
        }
        pending.clear();
    }

    /// Run the decoder until it needs more input or hits a terminal state.
    fn step(&mut self, eof: bool) -> crate::Result<()> {
        if self.decoder.is_none() {
            let head: &[u8] = &self.reading;
            if head.len() < 2 && !eof {
                // Telling gzip from tar takes two bytes.
                return Ok(());
            }
            // Plain tar is what a .tgz sent with `Content-Encoding: gzip` arrives as,
            // because the HTTP client has already decompressed it.
            let gzip = head.starts_with(&[0x1f, 0x8b]);
            let dialect = if self.extraction.npm_mode {
                tar::Dialect::Npm
            } else {
                tar::Dialect::General
            };
            self.decoder = Some(
                tar::Decoder::new(tar::Options::for_host(dialect), gzip)
                    .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?,
            );
        }
        if self.extraction.dest.is_none() {
            self.extraction.open_destination()?;
        }
        let Some(decoder) = self.decoder.as_mut() else {
            return Ok(());
        };
        (self.extraction).run(decoder, &self.reading, &mut self.read_pos, eof)
    }

    fn finish(&mut self, mut network: HiveBox<NetworkTask>) {
        let http_err = network.response.fail.map(crate::Error::from);
        self.decode(true, http_err);
        self.extraction.out = None;
        network.response_buffer = Default::default();

        let log = bun_ast::Log::init();
        let result = self.populate_result(http_err, &log);
        // Before the install thread hears of a failure, after which it may exit.
        self.extraction.dest = None;
        self.extraction.staging = None;

        if let Err(crate::Error::Http(_)) = result {
            // The connection died before the body was complete: a failed
            // download, not a failed extraction. `run_tasks` retries or reports it.
            INBOX.network_tasks.push(network);
        } else {
            let tarball = self.extraction.tarball.clone();
            (INBOX.resolve_tasks).push(Task::create_extracted(tarball, network, log, result));
        }
        INBOX.wake();
    }
}

impl Extraction {
    fn run(
        &mut self,
        decoder: &mut tar::Decoder,
        reading: &[u8],
        read_pos: &mut usize,
        eof: bool,
    ) -> crate::Result<()> {
        loop {
            let (used, event) = match decoder.next(&reading[*read_pos..], eof) {
                Ok(next) => next,
                Err(tar::Error::Alloc(err)) => return Err(err.into()),
                Err(err) => {
                    self.fail_detail = err.to_string().into_bytes();
                    return Err(crate::Error::Fail);
                }
            };
            *read_pos += used;
            self.bytes_consumed += used;
            match event {
                Event::NeedInput => return Ok(()),
                Event::Entry(entry) => {
                    self.begin_entry(entry)?;
                    if self.out.is_none() {
                        decoder.skip_entry();
                    }
                }
                Event::Data { offset, bytes } => self.write_block(offset, bytes)?,
                Event::EndOfEntry { size } => self.finish_output_file(size)?,
                Event::EndOfArchive => {
                    // A body that is not an archive also ends here, because the tar
                    // reader skips every block that is not a valid header.
                    if self.entry_count == 0 {
                        self.fail_detail = b"archive is empty".to_vec();
                        return Err(crate::Error::Fail);
                    }
                    self.done = true;
                    return Ok(());
                }
            }
        }
    }

    fn open_destination(&mut self) -> crate::Result<()> {
        let tarball = &self.tarball;
        let (_, basename) = tarball.name_and_basename();
        let truncated_basename = &basename[0..basename.len().min(32)];
        let tmpname_suffix: &[u8] =
            if crate::dependency::is_safe_install_folder_name(truncated_basename) {
                truncated_basename
            } else if tarball.resolution.tag.is_git()
                || tarball.resolution.tag == ResolutionTag::LocalTarball
            {
                b"package"
            } else {
                self.invalid_name = true;
                return Err(crate::Error::InstallFailed);
            };
        let mut buf = bun_paths::path_buffer_pool::get();
        let tmpname = FileSystem::tmpname(tmpname_suffix, &mut buf[..], bun_core::fast_random())?;
        let tmpdir = &tarball.temp_dir.handle;
        self.staging = Some(UnfinishedEntry::new(tmpdir.fd(), tmpname.as_bytes()));

        let dest =
            bun_sys::make_path::make_open_path(tmpdir, tmpname.as_bytes(), Default::default())?;
        self.dest = Some(File::from_fd(dest.into_raw()));
        Ok(())
    }

    /// The entry's data ended at `end`, so the output file is set to that length.
    fn finish_output_file(&mut self, end: i64) -> crate::Result<()> {
        let Some(mut out) = self.out.take() else {
            return Ok(());
        };
        out.finish(end).map_err(|e| e.to_zig_err().into())
    }

    fn write_block(&mut self, offset: i64, bytes: &[u8]) -> crate::Result<()> {
        let Some(out) = self.out.as_mut() else {
            return Ok(());
        };
        out.write(&mut self.write_strategy, offset, bytes)
            .map_err(|e| e.to_zig_err().into())
    }

    /// Process one entry header. Opens the output file (or creates the
    /// directory). With `out` left empty, the entry's data is skipped.
    fn begin_entry(&mut self, entry: &tar::Entry) -> crate::Result<()> {
        debug_assert!(self.out.is_none());
        let mut os_path_buf: Vec<OSPathChar> = Vec::new();
        let pathname: &[OSPathChar] = bun_archive::os_path(entry, &mut os_path_buf)?;

        if self.want_first_dirname {
            self.want_first_dirname = false;
            // GitHub's first entry is the folder `repo-sha/`. A mirror's may be `repo-sha/file`.
            let root = bun_archive::first_path_component(pathname);
            #[cfg(windows)]
            {
                let result = strings::to_utf8_list_with_type(Vec::new(), root)?;
                self.resolved_github_dirname = FileSystem::get()
                    .dirname_store()
                    .append(&result)
                    .expect("unreachable");
            }
            #[cfg(not(windows))]
            {
                // bun.asByteSlice(root) — on posix OSPathChar==u8, so this is a no-op cast.
                self.resolved_github_dirname = FileSystem::get()
                    .dirname_store()
                    .append(root)
                    .expect("unreachable");
            }
        }

        let kind = entry.kind();

        if self.npm_mode && kind != FileKind::File {
            // npm tarballs only contain files; like Archiver.extractToDir
            // we skip everything else.
            return Ok(());
        }

        // Strip the leading `package/` (or `<repo>-<sha>/` for GitHub) and
        // normalise. Same transformation as Archiver.extractToDir so both
        // paths produce identical on-disk layouts.
        let mut tokenizer = pathname[..]
            .split(|c| *c == ('/' as OSPathChar))
            .filter(|s| !s.is_empty());
        if tokenizer.next().is_none() {
            return Ok(());
        }
        // tokenizeScalar.rest() — need byte offset of remainder, not just
        // iterator. `split().filter()` loses that, so use a manual
        // index-of-first-'/' + skip-leading-'/' instead. The result is fed
        // straight to `normalize_buf_t` (which takes `&[OSPathChar]`, not a
        // NUL-terminated slice) so there is no need to reconstruct an
        // `OSPathSliceZ` suffix view here.
        let rest: &[OSPathChar] = tokenize_rest_after_first(pathname);

        let mut norm_buf = bun_paths::os_path_buffer_pool::get();
        let normalized = if self.npm_mode {
            bun_archive::normalize_npm_entry_path(entry, &mut norm_buf[..])?
        } else {
            (rest.len() < norm_buf.len()).then(|| {
                resolve_path::normalize_buf_t::<OSPathChar, platform::Auto>(rest, &mut norm_buf[..])
            })
        };
        let Some(normalized) = normalized else {
            bun_core::warn!(
                "Skipping entry with a path longer than the maximum path length: {}\n",
                bun_fmt::EscapeControlChars(bun_fmt::fmt_os_path(rest, Default::default())),
            );
            return Ok(());
        };
        let norm_len = normalized.len();
        norm_buf[norm_len] = 0;
        let path = &mut norm_buf[..norm_len];
        if path.is_empty() || (path.len() == 1 && path[0] == ('.' as OSPathChar)) {
            return Ok(());
        }
        // `normalize_buf_t` collapses interior `..` but leaves a leading `..`
        // on a relative input. Reject those so `openat(dest_fd, ...)` can
        // never escape the temp extraction root. `Archiver.extractToDir`
        // sees the same normalised path; this check is belt-and-braces on
        // top of the integrity gate.
        if path.len() >= 2
            && path[0] == ('.' as OSPathChar)
            && path[1] == ('.' as OSPathChar)
            && (path.len() == 2 || path[2] == bun_paths::SEP as OSPathChar)
        {
            return Ok(());
        }
        #[cfg(windows)]
        {
            if self.npm_mode {
                apply_windows_npm_path_escapes(path);
            }
            if bun_archive::starts_elsewhere_on_windows(path) {
                return Ok(());
            }
        }

        let path: OSPathZ = OSPathSliceZ::from_buf(&norm_buf[..], norm_len);
        let path_slice: &[OSPathChar] = &path[..];
        let dest = self.dest.as_ref().unwrap().fd();

        match kind {
            FileKind::Directory => {
                make_directory(entry, dest, path, path_slice);
            }
            FileKind::File => {
                #[cfg(windows)]
                let mode: Mode = 0;
                // Mask to permission bits so setuid/setgid/sticky bits from the
                // archive never reach `openat`'s mode argument.
                #[cfg(not(windows))]
                let mode: Mode = Mode::try_from((entry.perm() & 0o777) | 0o666).expect("int cast");
                let file = File::from_fd(open_output_file(dest, path, path_slice, mode)?);
                self.entry_count += 1;
                self.out = Some(bun_archive::EntryWriter::new(file));
            }
            _ => {}
        }
        Ok(())
    }
}

impl DrainTask {
    fn populate_result(
        &mut self,
        http_err: Option<crate::Error>,
        log: &bun_ast::Log,
    ) -> Result<crate::ExtractData, crate::Error> {
        let tarball = &self.extraction.tarball;
        if let Some(err) = self.fail {
            if matches!(err, crate::Error::Http(_)) {
                // Reported (or retried) by `run_tasks`; see `finish()`.
            } else if self.extraction.invalid_name {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Refusing to install package with invalid name \"{}\"",
                        bun_fmt::for_terminal(bstr::BStr::new(tarball.name_and_basename().0)),
                    ),
                );
            } else {
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "{} extracting tarball for \"{}\"{}{} (at byte {} of {})",
                        err.name(),
                        bun_fmt::for_terminal(bstr::BStr::new(tarball.name.slice())),
                        if self.extraction.fail_detail.is_empty() {
                            ""
                        } else {
                            ": "
                        },
                        bun_fmt::EscapeControlChars(bstr::BStr::new(&self.extraction.fail_detail)),
                        self.extraction.bytes_consumed,
                        self.content_length
                            .as_ref()
                            .map_or(&"unknown" as &dyn core::fmt::Display, |n| n),
                    ),
                );
            }
            return Err(err);
        }

        if !tarball.skip_verify && tarball.integrity.tag.is_supported() {
            if !self.hasher.verify() {
                if let Some(http_err) = http_err {
                    // The decoder found the end-of-archive marker but the
                    // body still ended early (gzip trailer, tar padding):
                    // the same failed download as above.
                    return Err(http_err);
                }
                log.add_error_fmt(
                    None,
                    bun_ast::Loc::EMPTY,
                    format_args!(
                        "Integrity check failed for tarball: {}",
                        bun_fmt::for_terminal(bstr::BStr::new(tarball.name.slice())),
                    ),
                );
                return Err(crate::Error::IntegrityCheckFailed);
            }
        }

        if (self.decoder.as_ref()).is_some_and(tar::Decoder::skipped_header) {
            tarball.warn_about_skipped_header(log);
        }

        if tarball.resolution.tag == ResolutionTag::Github {
            'insert_tag: {
                if self.extraction.resolved_github_dirname.is_empty() {
                    break 'insert_tag;
                }
                let dest = self.extraction.dest.as_ref().unwrap().fd();
                if File::openat(
                    dest,
                    bun_core::zstr!(".bun-tag"),
                    O::WRONLY | O::CREAT | O::TRUNC | if cfg!(windows) { 0 } else { O::NOFOLLOW },
                    0o664,
                )
                .and_then(|f| f.write_all(self.extraction.resolved_github_dirname))
                .is_err()
                {
                    let _ = bun_sys::unlinkat(dest, bun_core::zstr!(".bun-tag"));
                }
            }
        }

        // Close the temp dir handle before renaming so Windows can move it.
        self.extraction.dest = None;

        let (name, basename) = tarball.name_and_basename();

        let integrity = tarball.lockfile_integrity(|| self.hasher.final_());
        let staging = self.extraction.staging.take().unwrap();
        let mut result = staging.finish(|staged| {
            let resolved = self.extraction.resolved_github_dirname;
            tarball.move_to_cache_directory(log, staged, name, basename, resolved, &integrity)
        })?;
        result.integrity = integrity;

        if PackageManager::verbose_install() {
            bun_core::pretty_errorln!(
                "[{}] Streamed {} tarball → {} entries<r>",
                bun_fmt::for_terminal(bstr::BStr::new(name)),
                bun_fmt::size(self.bytes_received, Default::default()),
                self.extraction.entry_count,
            );
            Output::flush();
        }

        Ok(result)
    }
}

fn open_output_file(
    dest_fd: Fd,
    path: OSPathZ,
    path_slice: &[OSPathChar],
    mode: Mode,
) -> crate::Result<Fd> {
    let flags = O::WRONLY | O::CREAT | O::TRUNC;
    #[cfg(windows)]
    {
        let _ = mode;
        return match bun_sys::openat_windows(dest_fd, path, flags, 0) {
            Ok(fd) => Ok(fd),
            Err(e) => match e.get_errno() {
                bun_sys::E::EPERM | bun_sys::E::ENOENT => 'brk: {
                    let Some(dir) = bun_paths::Dirname::dirname::<u16>(path_slice) else {
                        return Err(e.to_zig_err().into());
                    };
                    let _ = bun_sys::make_path::make_path::<u16>(Dir::borrow(&dest_fd), dir);
                    break 'brk bun_sys::openat_windows(dest_fd, path, flags, 0)
                        .map_err(|e| e.to_zig_err().into());
                }
                _ => Err(e.to_zig_err().into()),
            },
        };
    }
    #[cfg(not(windows))]
    {
        match bun_sys::openat(dest_fd, path, flags, mode) {
            Ok(fd) => Ok(fd),
            Err(e) => match e.get_errno() {
                bun_sys::E::EACCES | bun_sys::E::ENOENT => 'brk: {
                    let Some(dir) = bun_paths::dirname(path_slice) else {
                        return Err(e.to_zig_err().into());
                    };
                    let _ = dest_fd.make_path(dir);
                    break 'brk bun_sys::openat(dest_fd, path, flags, mode)
                        .map_err(|e| e.to_zig_err().into());
                }
                _ => Err(e.to_zig_err().into()),
            },
        }
    }
}

fn make_directory(entry: &tar::Entry, dest_fd: Fd, path: OSPathZ, path_slice: &[OSPathChar]) {
    #[cfg(windows)]
    {
        let _ = bun_sys::make_path::make_path::<u16>(Dir::borrow(&dest_fd), &path[..]);
        let _ = (entry, path_slice);
    }
    #[cfg(not(windows))]
    {
        match bun_sys::mkdirat_z(
            dest_fd,
            path,
            bun_archive::directory_mode(entry.perm() as Mode),
        ) {
            Ok(()) => {}
            Err(e) => match e.get_errno() {
                bun_sys::E::EEXIST | bun_sys::E::ENOTDIR => {}
                _ => {
                    let Some(dir) = bun_paths::dirname(path_slice) else {
                        return;
                    };
                    let _ = dest_fd.make_path(dir);
                    let _ = bun_sys::mkdirat_z(dest_fd, path, 0o777);
                }
            },
        }
    }
}

#[cfg(windows)]
fn apply_windows_npm_path_escapes(path: &mut [OSPathChar]) {
    // Same transformation as Archiver.extractToDir: encode characters
    // Windows rejects in filenames into the 0xf000 private-use range so
    // the extraction round-trips with node-tar.
    for ch in path.iter_mut() {
        match *ch {
            c if c == ('|' as OSPathChar)
                || c == ('<' as OSPathChar)
                || c == ('>' as OSPathChar)
                || c == ('?' as OSPathChar)
                || c == (':' as OSPathChar) =>
            {
                *ch += 0xf000;
            }
            _ => {}
        }
    }
}

// Skips any leading `/` delimiters, then returns everything after the first
// path component, so for `"package/index.js"` the result is `"index.js"`
// (no leading `/`).
fn tokenize_rest_after_first(s: &[OSPathChar]) -> &[OSPathChar] {
    let mut i = 0;
    while i < s.len() && s[i] == ('/' as OSPathChar) {
        i += 1;
    }
    while i < s.len() && s[i] != ('/' as OSPathChar) {
        i += 1;
    }
    while i < s.len() && s[i] == ('/' as OSPathChar) {
        i += 1;
    }
    &s[i..]
}

use crate::package_manager_task::Task;
use crate::resolution::Tag as ResolutionTag;
