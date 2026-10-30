//! `bun test --aot` over more test files or source than one program should hold: each part of the test files gets a
//! program of its own, built by a process of its own, and workers run the files of a part from its program. The
//! coordinator reports them as one run.

#[cfg(unix)]
use crate::api::bun::process::PosixStdio as Stdio;
#[cfg(unix)]
use crate::api::bun::process::SpawnResultExt as _;
#[cfg(not(unix))]
use crate::api::bun::process::WindowsStdio as Stdio;
use crate::api::bun::process::{self as spawn, Process, Rusage, SpawnOptions, Status};
use bun_collections::StringSet;
use bun_core::{Output, ZBox};
use bun_jsc::virtual_machine::VirtualMachine;

use super::file_range::FileRange;
use crate::cli::run_compiled::{self, TestPartFile};

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum PartState {
    Waiting,
    Building,
    Ready,
    Finished,
}

pub(crate) struct Part {
    /// The files that no worker has been given yet.
    pub(crate) range: FileRange,
    /// While it is built: the paths of the files, then the program. Closed when the last worker of the part ends.
    pub(crate) file: Option<TestPartFile>,
    pub(crate) has_program: bool,
    pub(crate) state: PartState,
    pub(crate) workers: u32,
}

pub(crate) struct Parts {
    pub(crate) list: Vec<Part>,
    /// Boxed: a spawned process holds a pointer to its builder, which must not move when the `Vec` grows.
    #[expect(clippy::vec_box)]
    pub(crate) builders: Vec<Box<PartBuilder>>,
    pub(crate) finished: Vec<(u32, Status)>,
    most_builders: u32,
    pub(crate) image_flag_slot: usize,
    pub(crate) builds_done: u32,
    pub(crate) builds_failed: u32,
    messages_seen: StringSet,
}

/// About what the build of a part takes at its peak.
const MEMORY_OF_A_BUILD: usize = 10 << 30;

impl Parts {
    pub(crate) fn new(
        file_count: u32,
        part_files: u32,
        workers: u32,
        image_flag_slot: usize,
    ) -> Parts {
        // Past the limit of source with no more than `part_files` files: the first split halves them.
        let part_files = match run_compiled::is_test_run_split() {
            true => part_files.min(file_count.div_ceil(2)),
            false => part_files,
        };
        let list = (0..file_count.div_ceil(part_files))
            .map(|index| {
                Part::new(FileRange {
                    lo: index * part_files,
                    hi: ((index + 1) * part_files).min(file_count),
                })
            })
            .collect();
        // Test workers take the rest of the memory.
        let fits = u32::try_from(crate::cli::lint_js::memory() / 3 / MEMORY_OF_A_BUILD)
            .unwrap_or(u32::MAX);
        Parts {
            list,
            builders: Vec::new(),
            finished: Vec::new(),
            most_builders: fits.clamp(1, workers),
            image_flag_slot,
            builds_done: 0,
            builds_failed: 0,
            messages_seen: StringSet::new(),
        }
    }

    pub(crate) fn has_undispatched_files(&self) -> bool {
        self.list.iter().any(|part| !part.range.is_empty())
    }

    /// One program at a time when the run has one worker. Otherwise a few programs may wait for workers while the next ones are built.
    /// `time_of`: with `--timings`, what the files of a part take together. The part that takes longest is built first.
    pub(crate) fn next_to_build(
        &self,
        serial: bool,
        time_of: Option<&dyn Fn(FileRange) -> u64>,
    ) -> Option<u32> {
        let waiting_for_workers = |part: &&Part| {
            part.state == PartState::Ready
                && (!part.range.is_empty() || (serial && part.workers > 0))
        };
        let busy = self.builders.len() + self.list.iter().filter(waiting_for_workers).count();
        if busy >= self.most_builders as usize {
            return None;
        }
        let waiting = (self.list.iter().enumerate())
            .filter(|(_, part)| part.state == PartState::Waiting)
            .map(|(index, part)| (index as u32, part.range));
        first_of_the_largest(waiting, time_of)
    }

    /// `waiting`: the part of each worker that has no file yet.
    /// `time_of`: with `--timings`, what a file takes. The worker goes to the part whose next file takes longest, so that
    /// a slow file of a part late in the list doesn't start last and become the tail of the run.
    pub(crate) fn next_for_worker(
        &self,
        waiting: &[u32],
        time_of: Option<&dyn Fn(FileRange) -> u64>,
    ) -> Option<u32> {
        let next_files = self.list.iter().enumerate().filter_map(|(index, part)| {
            let already_waiting = waiting.iter().filter(|&&of| of as usize == index).count() as u32;
            let has_file = part.state == PartState::Ready && part.range.len() > already_waiting;
            let next = part.range.lo + already_waiting;
            has_file.then_some((
                index as u32,
                FileRange {
                    lo: next,
                    hi: next + 1,
                },
            ))
        });
        first_of_the_largest(next_files, time_of)
    }

    pub(crate) fn split(&mut self, index: usize) {
        let part = &mut self.list[index];
        let FileRange { lo, hi } = part.range;
        let middle = lo + (hi - lo) / 2;
        part.range.hi = middle;
        part.state = PartState::Waiting;
        part.file = None;
        self.list.push(Part::new(FileRange { lo: middle, hi }));
    }

    pub(crate) fn worker_ended(&mut self, index: u32) {
        let part = &mut self.list[index as usize];
        part.workers = part.workers.saturating_sub(1);
        if part.workers == 0 && part.range.is_empty() {
            part.state = PartState::Finished;
            part.file = None;
        }
    }

    /// Parts share modules, so their builds say the same things. Each is said once.
    pub(crate) fn print_messages(&mut self, messages: &[u8]) {
        let writer = Output::error_writer();
        for message in bun_core::strings::split(messages, b"\n\n") {
            if !message.is_empty() && !self.messages_seen.contains(message) {
                let _ = self.messages_seen.insert(message);
                let _ = writer.write_all(message);
                let _ = writer.write_all(b"\n\n");
            }
        }
        Output::flush();
    }
}

/// Without `time_of`, the first.
fn first_of_the_largest(
    mut parts: impl Iterator<Item = (u32, FileRange)>,
    time_of: Option<&dyn Fn(FileRange) -> u64>,
) -> Option<u32> {
    let Some(time_of) = time_of else {
        return parts.next().map(|(index, _)| index);
    };
    let mut best: Option<(u32, u64)> = None;
    for (index, files) in parts {
        let time = time_of(files);
        if best.is_none_or(|(_, most)| time > most) {
            best = Some((index, time));
        }
    }
    best.map(|(index, _)| index)
}

impl Part {
    fn new(range: FileRange) -> Part {
        Part {
            range,
            file: None,
            has_program: false,
            state: PartState::Waiting,
            workers: 0,
        }
    }
}

pub(crate) struct PartBuilder {
    pub(crate) part: u32,
    pub(crate) process: Option<spawn::ProcessHandle>,
    parts: *mut Parts,
    messages_path: ZBox,
}

impl PartBuilder {
    pub(crate) fn start<'p>(
        part: u32,
        paths: impl Iterator<Item = &'p [u8]>,
        cwd: &[u8],
        vm: &VirtualMachine,
        envp: &bun_dotenv::NullDelimitedEnvMap,
        parts: *mut Parts,
        #[cfg(windows)] windows_job: Option<*mut core::ffi::c_void>,
    ) -> crate::Result<(Box<PartBuilder>, TestPartFile)> {
        let file = TestPartFile::create(paths).map_err(|_| crate::Error::SpawnFailed)?;
        // After stdio.
        let arguments = run_compiled::test_part_arguments(file.number_in_child(3));
        let self_path = bun_core::self_exe_path().map_err(|_| crate::Error::SelfExePathFailed)?;
        let arguments: Vec<ZBox> = arguments.iter().map(ZBox::from_bytes).collect();
        let mut argv: Vec<bun_spawn::CStrPtr> = Vec::with_capacity(arguments.len() + 2);
        argv.push(self_path.as_ptr());
        argv.extend(arguments.iter().map(|argument| argument.as_ptr()));
        argv.push(core::ptr::null());
        let messages_path = run_compiled::temporary_path(bun_resolver::fs::RealFS::tmpdir_path());
        let messages = Box::<[u8]>::from(messages_path.as_bytes());
        #[cfg(unix)]
        let options = SpawnOptions {
            stdin: Stdio::Ignore,
            stdout: Stdio::Ignore,
            stderr: Stdio::Path(messages),
            extra_fds: Box::new([Stdio::Pipe(file.descriptor)]),
            cwd: cwd.to_vec().into_boxed_slice(),
            new_process_group: true,
            #[cfg(any(target_os = "linux", target_os = "android"))]
            linux_pdeathsig: Some(libc::SIGKILL as u8),
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            linux_pdeathsig: None,
            ..Default::default()
        };
        #[cfg(windows)]
        let options = SpawnOptions {
            stdin: Stdio::Ignore,
            stdout: Stdio::Ignore,
            stderr: Stdio::Path(messages),
            cwd: cwd.to_vec().into_boxed_slice(),
            windows: spawn::WindowsOptions {
                loop_: bun_jsc::EventLoopHandle::init(vm.event_loop().cast()),
                ..Default::default()
            },
            ..Default::default()
        };
        // SAFETY: `argv` and `envp` are null-terminated arrays of C strings, valid for this call.
        let spawned = unsafe { spawn::spawn_process(&options, argv.as_ptr(), envp.as_ptr()) }?
            .map_err(|e| {
                Output::err(e, "spawnProcess failed for the build of test files", ());
                crate::Error::SpawnFailed
            })?;
        #[cfg(unix)]
        let handle = spawned.to_process_handle(bun_event_loop::EventLoopHandle::init(
            vm.event_loop().cast(),
        ));
        #[cfg(windows)]
        let handle = {
            let mut spawned = spawned;
            spawned.to_process_handle(vm.event_loop())
        };
        let mut builder = Box::new(PartBuilder {
            part,
            process: None,
            parts,
            messages_path,
        });
        let this: *mut PartBuilder = &raw mut *builder;
        let process: *mut Process = handle.as_ptr();
        builder.process = Some(handle);
        // SAFETY: just spawned, the sole owner until reaped. The box outlives the process: it is kept until the exit is taken.
        unsafe {
            #[cfg(windows)]
            if let (Some(job), spawn::Poller::Uv(uv)) = (windows_job, &(*process).poller) {
                let _ = bun_sys::windows::AssignProcessToJobObject(job, uv.process_handle);
            }
            (*process).set_exit_handler(bun_spawn::ProcessExit::new(
                bun_spawn::ProcessExitKind::TestPartBuilder,
                this,
            ));
            if let Err(error) = (*process).watch_or_reap() {
                Output::err(error, "watchOrReap failed for the build of test files", ());
                return Err(crate::Error::ProcessWatchFailed);
            }
        }
        Ok((builder, file))
    }

    fn on_process_exit(&mut self, _: &Process, status: Status, _: &Rusage) {
        // SAFETY: `parts` is boxed and outlives every builder. Nothing else of it is borrowed in an exit callback.
        unsafe { (*self.parts).finished.push((self.part, status)) };
    }

    pub(crate) fn take_messages(&self) -> Vec<u8> {
        let messages = bun_sys::File::read_from(bun_sys::Fd::cwd(), self.messages_path.as_bytes())
            .unwrap_or_default();
        let _ = bun_sys::unlink(&self.messages_path);
        messages
    }
}

bun_spawn::link_impl_ProcessExit! {
    TestPartBuilder for PartBuilder => |this| {
        on_process_exit(process, status, rusage) =>
            (*this).on_process_exit(&*process, status, rusage),
    }
}
