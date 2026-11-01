//! `bun test --aot` over more test files than fit one program. What the test files import is compiled once, as layers: the
//! packages with Bun's own code, and above them the rest. The test files are compiled as parts above the layers, a few files each.
//! Every program is built by a process of its own, a layer with nothing beside it. A worker holds the layers and one part and
//! runs the files of that part, and the coordinator reports all of them as one run.

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
use bun_sys::FdExt as _;

use super::file_range::FileRange;
use crate::cli::run_compiled::{self, TestPartFile, TestPartKind, TestPartMessages};

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
    /// Not 0: the part is one file, which took so many megabytes, over a gigabyte, when it was last measured: `Timings::is_heavy`.
    pub(crate) heavy_growth: u32,
    /// A layer whose build has the build of the layer above beside it: that one reads here how this one has ended.
    pub(crate) tells_build_above: Option<bun_sys::Fd>,
    /// A layer whose program waits in memory, because `Parts::temporary_directory_is_full`.
    pub(crate) is_in_memory: bool,
}

/// `PartBuilder::part` of the build of the lowest of `Parts::layers`. Those of the others follow. The numbers below are positions in `Parts::list`.
const FIRST_LAYER: u32 = 1 << 31;

/// The position among `Parts::layers` of what the builder builds.
pub(crate) fn layer_of(part: u32) -> Option<usize> {
    part.checked_sub(FIRST_LAYER).map(|layer| layer as usize)
}

pub(crate) struct Parts {
    pub(crate) list: Vec<Part>,
    /// What the test files import, as programs of their own, the lowest first. Each is built once, alone, above those before it. A part
    /// is built above them all and holds the test files and what no layer holds, and a worker holds them all. Empty: each part is a
    /// whole program.
    pub(crate) layers: Vec<Part>,
    /// The first of them is the library that this Bun holds compiled, which no process of the run builds.
    pub(crate) stands_on_library_of_this_bun: bool,
    /// The second of those that the run builds holds what imports with computed names reach.
    has_layer_of_computed_imports: bool,
    /// It has had no room for the program of a layer. That layer and those that are built after it wait in memory.
    pub(crate) temporary_directory_is_full: bool,
    /// Boxed: a spawned process holds a pointer to its builder, which must not move when the `Vec` grows.
    #[expect(clippy::vec_box)]
    pub(crate) builders: Vec<Box<PartBuilder>>,
    pub(crate) finished: Vec<(u32, Status)>,
    pub(crate) image_flag_slot: usize,
    messages_seen: StringSet,
}

impl Parts {
    pub(crate) fn new(
        file_count: u32,
        part_files: u32,
        ranges: Vec<FileRange>,
        heavy_growths: &[u32],
        image_flag_slot: usize,
        layers: u32,
        stands_on_library_of_this_bun: bool,
        has_layer_of_computed_imports: bool,
    ) -> Parts {
        let by_number = (0..file_count.div_ceil(part_files)).map(|index| FileRange {
            lo: index * part_files,
            hi: ((index + 1) * part_files).min(file_count),
        });
        let mut list: Vec<Part> = match ranges.is_empty() {
            true => by_number.map(Part::new).collect(),
            false => ranges.into_iter().map(Part::new).collect(),
        };
        for (part, &growth) in list.iter_mut().zip(heavy_growths) {
            part.heavy_growth = growth;
        }
        let all_files = FileRange {
            lo: 0,
            hi: file_count,
        };
        #[cfg(unix)]
        let library = stands_on_library_of_this_bun
            .then(run_compiled::unpack_library_of_this_bun)
            .flatten();
        #[cfg(not(unix))]
        let library: Option<TestPartFile> = None.filter(|_| stands_on_library_of_this_bun);
        let held_by_this_bun = library.map(|file| Part {
            file: Some(file),
            has_program: true,
            state: PartState::Ready,
            ..Part::new(all_files)
        });
        let built_by_run =
            (0..layers + u32::from(has_layer_of_computed_imports)).map(|_| Part::new(all_files));
        Parts {
            list,
            stands_on_library_of_this_bun: held_by_this_bun.is_some(),
            has_layer_of_computed_imports,
            temporary_directory_is_full: false,
            layers: held_by_this_bun.into_iter().chain(built_by_run).collect(),
            builders: Vec::new(),
            finished: Vec::new(),
            image_flag_slot,
            messages_seen: StringSet::new(),
        }
    }

    /// The files of the project are built as so many programs, one above the other. None of them has begun.
    pub(crate) fn set_programs_of_project(&mut self, programs: u32) {
        let below = usize::from(self.stands_on_library_of_this_bun)
            + 1
            + usize::from(self.has_layer_of_computed_imports);
        let of_project = &self.layers[below..];
        assert!(
            of_project
                .iter()
                .all(|layer| layer.state == PartState::Waiting)
        );
        let all_files = of_project[0].range;
        self.layers
            .resize_with(below + programs as usize, || Part::new(all_files));
    }

    /// The programs of the first `count` layers, the lowest first.
    pub(crate) fn programs_below(&self, count: usize) -> Vec<bun_sys::Fd> {
        let files = self.layers[..count]
            .iter()
            .filter_map(|layer| layer.file.as_ref());
        files.map(|file| file.descriptor).collect()
    }

    /// Whether the build of the layer above begins while this layer is built: `run_compiled::begins_beside_build_below`. It has to
    /// guess what this layer will hold, and it can for what computed imports reach: it finds them as the build of this layer does.
    /// A build that was started again for a wrong guess finds this layer built.
    fn has_build_above_beside_it(&self, layer: usize) -> bool {
        cfg!(unix)
            && self.kind_of(FIRST_LAYER + layer as u32) == TestPartKind::SharedComputed
            && run_compiled::test_run_builds_layers_side_by_side()
    }

    /// The layer right below is still being built.
    pub(crate) fn begins_beside_build_below(&self, layer: usize) -> bool {
        layer > 0 && self.layers[layer - 1].state == PartState::Building
    }

    /// The build of a layer has ended. `has_program`: `None` where it failed.
    pub(crate) fn tell_build_above(&mut self, layer: usize, has_program: Option<bool>) {
        let Some(descriptor) = self.layers[layer].tells_build_above.take() else {
            return;
        };
        if let Some(has_program) = has_program {
            let _ = bun_sys::write(descriptor, if has_program { b"1" } else { b"0" });
        }
        descriptor.close();
    }

    /// `part`: `PartBuilder::part`.
    pub(crate) fn kind_of(&self, part: u32) -> TestPartKind {
        // Among the layers that the run builds.
        let held_by_this_bun = usize::from(self.stands_on_library_of_this_bun);
        let count = self.layers.len() - held_by_this_bun;
        match layer_of(part).map(|layer| layer - held_by_this_bun) {
            None => TestPartKind::TestFiles,
            Some(0) if count > 1 => TestPartKind::SharedPackages,
            Some(1) if self.has_layer_of_computed_imports => TestPartKind::SharedComputed,
            Some(layer) if layer + 1 < count => TestPartKind::SharedLowest {
                part_in: (count - layer) as u32,
            },
            Some(_) => TestPartKind::Shared,
        }
    }

    /// What the heavy files that run took together. A file counts from when its worker starts.
    pub(crate) fn heavy_growth_running(&self) -> u32 {
        let running = self.list.iter().filter(|part| part.workers > 0);
        running.map(|part| part.heavy_growth).sum()
    }

    pub(crate) fn has_heavy_files_left(&self) -> bool {
        let is_left = |part: &Part| part.heavy_growth > 0 && part.state != PartState::Finished;
        self.list.iter().any(is_left)
    }

    /// The run needs room for its heaviest file. A heavy file waits while it and those that run would take more than that.
    fn is_held_back(&self, part: &Part, running: u32) -> bool {
        let room = self.list.iter().map(|part| part.heavy_growth).max();
        part.heavy_growth > 0 && running > 0 && running + part.heavy_growth > room.unwrap_or(0)
    }

    pub(crate) fn has_undispatched_files(&self) -> bool {
        self.list.iter().any(|part| !part.range.is_empty())
    }

    /// `time_of`: with `--timings`, what files take together. The part whose slowest file takes longest is built first.
    pub(crate) fn next_to_build(
        &self,
        free_workers: u32,
        time_of: Option<&dyn Fn(FileRange) -> u64>,
    ) -> Option<u32> {
        for (index, (layer, number)) in self.layers.iter().zip(FIRST_LAYER..).enumerate() {
            match layer.state {
                PartState::Waiting => return Some(number),
                PartState::Building => {
                    let above = self.layers.get(index + 1);
                    let is_next = above.is_some_and(|above| above.state == PartState::Waiting)
                        && self.has_build_above_beside_it(index);
                    return is_next.then_some(number + 1);
                }
                PartState::Ready | PartState::Finished => {}
            }
        }
        // Few builds run beside the tests: one for each worker that has no part, and two more. Those two go on while parts are left,
        // however many lie ready. The slow files come first, each a part that is soon built and runs long, and the quick ones last,
        // in parts that take longer to build than to run: builds that only followed the workers idled through the first and then
        // starved the workers, each of which called for one more build: twenty at once at the end of a large run.
        let is_built = |part: &&Part| part.state == PartState::Building;
        if self.list.iter().filter(is_built).count() as u32 >= free_workers + 2 {
            return None;
        }
        // The heavy parts run one after another, so they begin first: then none of them is the end of the run, and the workers beside
        // them are young and hold little.
        let waiting = |is_heavy: bool| {
            (self.list.iter().enumerate())
                .filter(move |(_, part)| {
                    part.state == PartState::Waiting && (part.heavy_growth > 0) == is_heavy
                })
                // It is the first of the part.
                .map(|(index, part)| {
                    let slowest = FileRange {
                        lo: part.range.lo,
                        hi: part.range.hi.min(part.range.lo + 1),
                    };
                    (index as u32, slowest)
                })
        };
        first_of_the_largest(waiting(true), time_of)
            .or_else(|| first_of_the_largest(waiting(false), time_of))
    }

    /// A worker starts a VM and the layers, so it runs a part from its first file to its last. Only when no part is left to build
    /// does a worker help with a part that another has begun, so that the run does not end with one worker at work.
    /// `waiting`: the part of each worker that has no file yet.
    /// `time_of`: with `--timings`, what a file takes. The worker goes to the part whose next file takes longest.
    /// The part for the worker of a run without `--parallel`. It waits for the build of the next part where one further on is ready.
    pub(crate) fn next_in_order(&self) -> Option<u32> {
        let is_left = |part: &Part| part.state != PartState::Finished;
        let next = self.list.iter().position(is_left)?;
        let part = &self.list[next];
        (part.state == PartState::Ready && part.is_free() && part.range.len() > 0)
            .then_some(next as u32)
    }

    /// `free_workers`: how many have no part, the one that asks among them.
    pub(crate) fn next_for_worker(
        &self,
        waiting: &[u32],
        free_workers: u32,
        time_of: Option<&dyn Fn(FileRange) -> u64>,
    ) -> Option<u32> {
        let running = self.heavy_growth_running();
        let next_files = |is_free: bool| {
            (self.list.iter().enumerate()).filter_map(move |(index, part)| {
                let already_waiting =
                    waiting.iter().filter(|&&of| of as usize == index).count() as u32;
                // No two heavy files run at once.
                let has_file = part.state == PartState::Ready
                    && part.is_free() == is_free
                    && part.range.len() > already_waiting
                    && !self.is_held_back(part, running);
                let next = part.range.lo + already_waiting;
                has_file.then_some((
                    index as u32,
                    FileRange {
                        lo: next,
                        hi: next + 1,
                    },
                ))
            })
        };
        let is_to_come =
            |part: &Part| matches!(part.state, PartState::Waiting | PartState::Building);
        let is_heavy = |&(index, _): &(u32, FileRange)| self.list[index as usize].heavy_growth > 0;
        let heavy = first_of_the_largest(next_files(true).filter(is_heavy), time_of);
        let begins = heavy.or_else(|| first_of_the_largest(next_files(true), time_of));
        // More parts are built at once than there are workers, and the largest test file, whose build ends last, tends to run
        // longest. A worker runs a part to its end, so one that takes a lesser part meanwhile leaves the slow file waiting for that
        // long, and then the slow file ends the run. Such a file is a part of its own: a worker is kept for it.
        if let (None, Some(index), Some(time_of)) = (heavy, begins, time_of) {
            let next = next_files(true).find(|&(part, _)| part == index);
            let time = next.map_or(0, |(_, file)| time_of(file));
            let is_slower_and_to_come = |part: &&Part| {
                part.state == PartState::Building
                    && part.range.len() == 1
                    && part.heavy_growth == 0
                    && time_of(part.range) > time
            };
            if self.list.iter().filter(is_slower_and_to_come).count() as u32 >= free_workers {
                return None;
            }
        }
        begins.or_else(|| match self.list.iter().any(is_to_come) {
            true => None,
            false => first_of_the_largest(next_files(false), time_of),
        })
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
    /// The files of a part whose build came to no end are built again one by one, so that the file that brings the compiler down
    /// pays alone.
    pub(crate) fn cut_into_single_files(&mut self, index: usize) {
        fn single(file: u32) -> Part {
            Part::new(FileRange {
                lo: file,
                hi: file + 1,
            })
        }
        let FileRange { lo, hi } = self.list[index].range;
        self.list[index] = single(lo);
        self.list.extend((lo + 1..hi).map(single));
    }

    /// What the builder of a program of test files printed. There are hundreds of them in a large run, and under
    /// `BUN_JSC_logAOTPhaseTimes` each writes 1,600 lines, 60 MB in all: of the log, the lines of whole steps are printed, and
    /// not those of each pass, analysis and round of flow inside them. A layer's log is printed whole.
    pub(crate) fn print_messages_of_test_files(&mut self, messages: &[u8]) {
        const KEPT: [&[u8]; 8] = [
            b"AOT account",
            b"AOT part build",
            b"AOT test build",
            b"AOT test run",
            b"AOT first look",
            b"AOT build starts over",
            b"AOT files are loaded again",
            b"AOT phase times: ",
        ];
        let is_printed = |line: &&[u8]| {
            !line.starts_with(b"AOT ")
                || (KEPT.iter().any(|kept| line.starts_with(kept))
                    && !line.starts_with(b"AOT phase times: pass "))
        };
        let lines: Vec<&[u8]> = bun_core::strings::split(messages, b"\n")
            .filter(is_printed)
            .collect();
        self.print_messages(&lines.join(&b"\n"[..]));
    }

    pub(crate) fn print_messages(&mut self, messages: &[u8]) {
        let writer = Output::error_writer();
        for message in bun_core::strings::split(messages, b"\n\n") {
            if !message.is_empty() && !self.messages_seen.contains(message) {
                let _ = self.messages_seen.insert(message);
                // Lines of the log are no message of the build: no empty line stands behind them.
                if message.starts_with(b"AOT ") {
                    let _ = writer.write_all(bun_core::strings::trim_right(message, b"\n"));
                    let _ = writer.write_all(b"\n");
                    continue;
                }
                let _ = writer.write_all(message);
                let _ = writer.write_all(b"\n\n");
            }
        }
        Output::flush();
    }
}

/// Cuts a list of files, the slowest first, into parts in that order: a run that takes the parts as they come begins with its slowest
/// files and ends with its quickest, so that its workers end together. `costs`: what each file takes.
/// A part is full when it takes what each of `count` parts would take that all took the same, or when it holds `most_files`.
pub(crate) fn cut_by_time(costs: &[u64], count: u32, most_files: u32) -> Vec<FileRange> {
    let full = (costs.iter().sum::<u64>() / u64::from(count.max(1))).max(1);
    let mut ranges = Vec::new();
    let (mut lo, mut time) = (0, 0);
    for (file, &cost) in (0u32..).zip(costs) {
        time += cost;
        if time >= full || file + 1 - lo >= most_files {
            ranges.push(FileRange { lo, hi: file + 1 });
            (lo, time) = (file + 1, 0);
        }
    }
    if (lo as usize) < costs.len() {
        ranges.push(FileRange {
            lo,
            hi: costs.len() as u32,
        });
    }
    ranges
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
    /// No worker runs it: none has begun it, or the one that had has ended early.
    fn is_free(&self) -> bool {
        self.workers == 0
    }

    fn new(range: FileRange) -> Part {
        Part {
            range,
            file: None,
            has_program: false,
            state: PartState::Waiting,
            workers: 0,
            heavy_growth: 0,
            tells_build_above: None,
            is_in_memory: false,
        }
    }
}

pub(crate) struct PartBuilder {
    pub(crate) part: u32,
    pub(crate) process: Option<spawn::ProcessHandle>,
    parts: *mut Parts,
    messages: TestPartMessages,
}

impl PartBuilder {
    pub(crate) fn start<'p>(
        part: u32,
        paths: impl Iterator<Item = &'p [u8]>,
        cwd: &[u8],
        vm: &VirtualMachine,
        envp: &bun_dotenv::NullDelimitedEnvMap,
        parts: *mut Parts,
        kind: TestPartKind,
        in_memory: bool,
        below: &[bun_sys::Fd],
        is_above_library: bool,
        threads: Option<u32>,
        told_of_last_below: Option<bun_sys::Fd>,
        #[cfg(windows)] windows_job: Option<*mut core::ffi::c_void>,
    ) -> crate::Result<(Box<PartBuilder>, TestPartFile)> {
        let file =
            TestPartFile::create(paths, kind, in_memory).map_err(|_| crate::Error::SpawnFailed)?;
        // After stdio: the file, the programs below, what tells of the last of them.
        let below_in_child = 4..4 + below.len();
        let arguments = run_compiled::test_part_arguments(
            file.number_in_child(3),
            kind,
            below_in_child,
            is_above_library,
            threads,
            told_of_last_below.map(|_| 4 + below.len()),
        );
        let self_path = bun_core::self_exe_path().map_err(|_| crate::Error::SelfExePathFailed)?;
        let arguments: Vec<ZBox> = arguments.iter().map(ZBox::from_bytes).collect();
        let mut argv: Vec<bun_spawn::CStrPtr> = Vec::with_capacity(arguments.len() + 2);
        argv.push(self_path.as_ptr());
        argv.extend(arguments.iter().map(|argument| argument.as_ptr()));
        argv.push(core::ptr::null());
        let messages = TestPartMessages::create().map_err(|_| crate::Error::SpawnFailed)?;
        #[cfg(unix)]
        let options = SpawnOptions {
            stdin: Stdio::Ignore,
            stdout: Stdio::Ignore,
            stderr: Stdio::Pipe(messages.descriptor),
            extra_fds: core::iter::once(file.descriptor)
                .chain(below.iter().copied())
                .chain(told_of_last_below)
                .map(Stdio::Pipe)
                .collect(),
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
            stderr: Stdio::Path(Box::from(messages.path.as_bytes())),
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
            messages,
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
        self.messages.read()
    }
}

bun_spawn::link_impl_ProcessExit! {
    TestPartBuilder for PartBuilder => |this| {
        on_process_exit(process, status, rusage) =>
            (*this).on_process_exit(&*process, status, rusage),
    }
}
