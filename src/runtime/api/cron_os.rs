//! `Bun.cron(path, schedule, title)` and `Bun.cron.remove(title)`: one or two runs of crontab, launchctl or schtasks.

use core::cell::Cell;
use core::mem::ManuallyDrop;

use bstr::BStr;
use bun_core::{CStringList, EncodedSlice, ZBox, strings};
use bun_cron::{Registration, Title};
use bun_io::{BufferedReader, IoEvent, JsKeepAlive, Owner, PollTag, ReadResult};
use bun_jsc::bindgen::JsScope;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    EncodedSliceJsc as _, EventLoopHandle, GlobalRef, JSGlobalObject, JSPromiseStrong, JSValue,
    JsCell, JsResult,
};
use bun_paths::{platform, resolve_path};
use bun_ptr::{RefPtr, ThisPtr};
use bun_removable_features::removable_body_behind_value;
use bun_resolver::fs::FileSystem;
use bun_sys::{self as sys, Fd, File};
use scopeguard::ScopeGuard;

#[cfg(not(windows))]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{self as spawn, ProcessHandle, SpawnOptions, Status, Stdio};
use crate::jsc_hooks::runtime_state;
use backend::Step;

pub(crate) fn register(
    cx: &mut JsScope<'_>,
    path: &[u8],
    schedule: &[u8],
    title: &[u8],
) -> JsResult<JSValue> {
    let global = cx.global();
    let invalid = |message: &str| global.throw_invalid_arguments(format_args!("{message}"));
    let title = parse_title(global, title)?;
    let schedule = super::cron::parse_expression(global, schedule)?;
    let script = resolve_script(global, path).ok_or_else(|| invalid("Failed to resolve path"))?;

    // The path goes into a crontab line, in single quotes.
    if let Some(byte) = strings::index_of_any(&script, b"'%\n\r").and_then(|i| script.get(i)) {
        return Err(invalid(match byte {
            b'\'' => "Path must not contain single quotes",
            b'%' => "Path must not contain percent signs (cron interprets % as newline)",
            _ => "Path must not contain line breaks",
        }));
    }
    let Ok(exe) = bun_core::self_exe_path() else {
        return Err(global.throw(format_args!("Failed to get bun executable path")));
    };
    let exe = exe.as_bytes();
    if strings::contains_any(exe, b"'%") {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun executable path '{}' contains characters (' or %) that cannot be safely embedded in a crontab entry",
            BStr::new(exe)
        )));
    }

    let first = backend::register(&Registration {
        title,
        schedule,
        exe,
        script: &script,
    });
    Ok(OsJob::start(global, first))
}

pub(crate) fn remove(cx: &mut JsScope<'_>, title: &[u8]) -> JsResult<JSValue> {
    let global = cx.global();
    let title = parse_title(global, title)?;
    Ok(OsJob::start(global, backend::remove(&title)))
}

fn parse_title(global: &JSGlobalObject, title: &[u8]) -> JsResult<Title> {
    Title::new(title).ok_or_else(|| {
        global.throw_invalid_arguments(format_args!(
            "Cron title must contain only alphanumeric characters, hyphens, and underscores"
        ))
    })
}

/// Relative to the file that called.
fn resolve_script(global: &JSGlobalObject, path: &[u8]) -> Option<Vec<u8>> {
    let caller = global.get_caller_src_loc();
    let caller = caller.str.to_utf8();
    let dir = resolve_path::dirname::<platform::Auto>(caller.slice());
    let dir: &[u8] = if dir.is_empty() { b"." } else { dir };
    let mut resolved = (global.bun_vm().transpiler)
        .with_mut(|t| (t.resolver).resolve(dir, path, bun_ast::ImportKind::EntryPointRun))
        .ok()?;
    Some(resolved.path()?.text.to_vec())
}

struct Command {
    argv: CStringList,
    stdout: Stdio,
    step: Step,
}

impl Command {
    fn new(argv: &[&[u8]], stdout: Stdio, step: Step) -> Command {
        let argv = CStringList::from_parts(argv.iter().map(|&arg| [arg]));
        Command { argv, stdout, step }
    }
}

/// What the promise rejects with.
#[derive(thiserror::Error, Debug)]
enum Failure {
    #[error("{0}")]
    Text(&'static str),
    #[error("Failed to spawn process: {}", BStr::new(.0))]
    Spawn(&'static [u8]),
    #[error("Failed to read process output: {}", BStr::new(.0.name()))]
    Read(sys::Error),
    #[error("Process exited with code {0}")]
    Exited(u8),
    #[error("Process killed by signal {0}")]
    Signaled(u8),
    #[error("Process error: {}", BStr::new(.0.name()))]
    Wait(sys::Error),
    #[cfg(windows)]
    #[error("{}", BStr::new(.0))]
    Stderr(Box<[u8]>),
    #[cfg(windows)]
    #[error(transparent)]
    TooManyTriggers(#[from] bun_cron::schtasks::TooManyTriggers),
}

impl From<&'static str> for Failure {
    fn from(text: &'static str) -> Failure {
        Failure::Text(text)
    }
}

/// The command to run, or `None` to resolve the promise.
type Next = Result<Option<Command>, Failure>;

/// A step is over when its child has exited and the child's output has ended, in either order.
enum Child {
    Running,
    Exited(Result<(), Failure>),
    OutputEnded(sys::Result<Vec<u8>>),
}

/// The calls in flight. Not dropped with the runtime state: their polls are slots of `RareData`, which is freed first.
#[derive(Default)]
pub(crate) struct OsJobs(ManuallyDrop<JsCell<Vec<RefPtr<OsJob>>>>);

impl OsJobs {
    pub(crate) fn release_for_vm_teardown(&self) {
        if self.0.get().capacity() != 0 {
            removable_body_behind_value!(Cron, {
                for job in self.0.take() {
                    // The child outlives the VM, and the file is its input or the installed plist.
                    if let Some(file) = job.step.take().and_then(|(step, _)| step.into_file()) {
                        ScopeGuard::into_inner(file);
                    }
                }
            });
        }
    }
}

/// `OsJobs` has the one ref. A function that takes a `ThisPtr` may release it.
#[derive(bun_ptr::CellRefCounted)]
pub(crate) struct OsJob {
    ref_count: Cell<u32>,
    promise: JsCell<JSPromiseStrong>,
    global: GlobalRef,
    _keep_alive: JsKeepAlive,
    /// `None` between two steps.
    step: Cell<Option<(Step, Child)>>,
    process: Cell<Option<ProcessHandle>>,
    /// Of the child's stdout, or on Windows its stderr.
    output: BufferedReader,
}

bun_spawn::link_impl_ProcessExit! {
    Cron for OsJob => |this| {
        // SAFETY: a live job installed the handler, and its handle detaches it.
        on_process_exit(status, _rusage) => OsJob::on_process_exit(ThisPtr::new(this), status),
    }
}

impl OsJob {
    fn start(global: &JSGlobalObject, first: Result<Command, Failure>) -> JSValue {
        let job = RefPtr::new(OsJob {
            ref_count: Cell::new(1),
            promise: JsCell::new(JSPromiseStrong::init(global)),
            global: GlobalRef::from(global),
            _keep_alive: JsKeepAlive::active(),
            step: Cell::new(None),
            process: Cell::new(None),
            output: BufferedReader::init(),
        });
        let owner = Owner::new(PollTag::Cron, job.as_ptr().cast());
        // SAFETY: `owner` points to the heap allocation that holds this reader.
        unsafe { job.output.set_owner(owner) };
        let (this, promise) = (job.this_ptr(), job.promise.get().value());
        (runtime_state().cron_os_jobs.0).with_mut(|jobs| jobs.push(job));
        Self::run(this, first.map(Some));
        promise
    }

    fn run(this: ThisPtr<Self>, next: Next) {
        let process = match next.and_then(|next| next.map(|c| this.spawn(c)).transpose()) {
            Ok(Some(process)) => process,
            Ok(None) => return Self::finish(this, Ok(())),
            Err(failure) => return Self::finish(this, Err(failure)),
        };
        process.set_exit_handler(this);
        // `this` may be freed on every path but `Ok(false)`.
        match process.watch_or_reap() {
            Ok(false) => this.process.set(Some(process)),
            Ok(true) => {}
            Err(err) => {
                if !process.has_exited() {
                    process.on_exit(Status::Err(err), &bun_core::ffi::zeroed());
                }
            }
        }
    }

    fn spawn(&self, Command { argv, stdout, step }: Command) -> Result<ProcessHandle, Failure> {
        let vm = VirtualMachine::get();
        let event_loop = EventLoopHandle::init(vm.event_loop_ptr());
        #[cfg(windows)]
        let (mut path_buf, envp) = (
            bun_paths::path_buffer_pool::get(),
            vm.env_loader().map.to_envp(),
        );
        let options = SpawnOptions {
            stdin: Stdio::Ignore,
            stdout,
            cwd: FileSystem::get().top_level_dir().into(),
            #[cfg(unix)]
            stderr: Stdio::Ignore,
            #[cfg(windows)]
            stderr: Stdio::Buffer,
            #[cfg(windows)]
            argv0: {
                let path = vm.env_loader().map.get(b"PATH").unwrap_or(b"");
                let found = bun_which::which(&mut path_buf, path, b"", b"schtasks");
                Some(found.ok_or("Could not find 'schtasks' in PATH")?.into())
            },
            #[cfg(windows)]
            windows: spawn::WindowsOptions {
                loop_: event_loop,
                ..Default::default()
            },
            ..SpawnOptions::default()
        };
        #[cfg(unix)]
        let env = None;
        #[cfg(windows)]
        let env = Some(envp.as_list());

        let mut spawned = spawn::spawn_process(&options, argv.as_list(), env)
            .map_err(|err| Failure::Spawn(err.name().as_bytes()))?
            .map_err(|err| Failure::Spawn(err.name()))?;

        let mut child = Child::OutputEnded(Ok(Vec::new()));
        #[cfg(unix)]
        if let Some(stdout) = spawned.stdout.take().map(File::into_raw) {
            use bun_io::PosixFlags;
            (self.output).update_flags(|f| f.insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET));
            let read = (self.output.start(bun_io::js_vm_ctx(), stdout, true))
                .map_err(|_| "Failed to start reading stdout")?;
            child = (self.take_output(read)).map_or(Child::Running, Child::OutputEnded);
        }
        #[cfg(windows)]
        if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stderr.take() {
            (self.output.start_with_pipe(pipe)).map_err(|_| "Failed to start reading stderr")?;
            child = Child::Running;
        }
        self.step.set(Some((step, child)));
        Ok(spawned.to_process_handle(event_loop))
    }

    /// `None` until the output has ended.
    fn take_output(&self, read: ReadResult) -> Option<sys::Result<Vec<u8>>> {
        match read {
            ReadResult::Pending => None,
            ReadResult::Done => Some(Ok(self.output.take_buffer())),
            ReadResult::Err(err) => {
                // As EOF does, so that a child that is still writing gets EPIPE and exits.
                self.output.deinit();
                Some(Err(err))
            }
        }
    }

    pub(crate) fn on_io(this: ThisPtr<Self>, event: IoEvent) {
        let read = this.output.read(bun_io::js_vm_ctx(), Some(event));
        let Some(output) = this.take_output(read) else {
            return;
        };
        match this.step.take() {
            Some((step, Child::Running)) => this.step.set(Some((step, Child::OutputEnded(output)))),
            Some((step, Child::Exited(exit))) => Self::end_step(this, step, exit, output),
            other @ (Some((_, Child::OutputEnded(_))) | None) => {
                debug_assert!(false, "the output ended twice");
                this.step.set(other);
            }
        }
    }

    fn on_process_exit(this: ThisPtr<Self>, status: Status) {
        let exit = match status {
            Status::Running => return,
            Status::Exited(exited) if exited.code == 0 => Ok(()),
            Status::Exited(exited) => Err(Failure::Exited(exited.code)),
            Status::Signaled(signal) => Err(Failure::Signaled(signal)),
            Status::Err(err) => Err(Failure::Wait(err)),
        };
        match this.step.take() {
            Some((step, Child::Running)) => this.step.set(Some((step, Child::Exited(exit)))),
            Some((step, Child::OutputEnded(output))) => Self::end_step(this, step, exit, output),
            other @ (Some((_, Child::Exited(_))) | None) => {
                debug_assert!(false, "the child exited twice");
                this.step.set(other);
            }
        }
    }

    fn end_step(
        this: ThisPtr<Self>,
        step: Step,
        exit: Result<(), Failure>,
        output: sys::Result<Vec<u8>>,
    ) {
        this.process.set(None);
        Self::run(this, after(step, exit, output));
    }

    fn finish(this: ThisPtr<Self>, result: Result<(), Failure>) {
        let _entered = VirtualMachine::get().enter_event_loop_scope();
        // Dropped before the scope ends, which is where the reactions run.
        let Some(job) = runtime_state().cron_os_jobs.0.with_mut(|jobs| {
            let i = jobs.iter().position(|job| job.as_ptr() == this.as_ptr())?;
            Some(jobs.swap_remove(i))
        }) else {
            return;
        };
        let global = job.global;
        let _ = job.promise.with_mut(|promise| match result {
            Ok(()) => promise.resolve(&global, JSValue::UNDEFINED),
            Err(failure) => {
                let message = failure.to_string();
                let error = EncodedSlice::utf8(message.as_bytes()).to_error_instance(&global);
                promise.reject_with_async_stack(&global, Ok(error))
            }
        });
    }
}

/// Takes `step`, so that its file is gone before the promise settles.
fn after(step: Step, exit: Result<(), Failure>, output: sys::Result<Vec<u8>>) -> Next {
    let output = output.map_err(Failure::Read)?;
    let failure = match exit {
        Err(failure) if !step.tolerates(&failure) => failure,
        _ => return step.next(&output),
    };
    #[cfg(windows)]
    if let Failure::Exited(_) = failure
        && let explained @ [_, ..] = bun_cron::schtasks::explain_failure(&output)
    {
        return Err(Failure::Stderr(explained.into()));
    }
    Err(failure)
}

/// A path that is unlinked when it drops.
type OwnedFile = ScopeGuard<ZBox, fn(ZBox)>;

fn write_file(
    path: &[u8],
    (flag, mode): (i32, sys::Mode),
    contents: &[u8],
    [create_failed, write_failed]: [&'static str; 2],
) -> Result<OwnedFile, Failure> {
    let owned: OwnedFile = scopeguard::guard(ZBox::from_bytes(path), |p| _ = sys::unlink(&p));
    let flags = sys::O::WRONLY | sys::O::CREAT | flag;
    let file = File::openat(Fd::cwd(), owned.as_bytes(), flags, mode).map_err(|_| create_failed)?;
    file.write_all(contents).map_err(|_| write_failed)?;
    Ok(owned)
}

/// Under a name that cannot be guessed.
#[cfg(not(target_os = "macos"))]
fn write_temp_file(
    suffix: &str,
    contents: &[u8],
    errors: [&'static str; 2],
) -> Result<OwnedFile, Failure> {
    let mut buf = bun_paths::path_buffer_pool::get();
    let name = FileSystem::tmpname(suffix.as_bytes(), &mut buf.0, bun_core::fast_random())
        .map_err(|_| "Out of memory")?;
    let dir = bun_resolver::fs::RealFS::platform_temp_dir();
    let path = resolve_path::join_abs_string::<platform::Auto>(dir, &[name.as_bytes()]);
    write_file(path, (sys::O::EXCL, 0o600), contents, errors)
}

#[cfg(not(any(target_os = "macos", windows)))]
mod backend {
    use super::*;
    use bun_cron::crontab;

    pub(super) enum Step {
        /// `crontab -l`, to install what it prints with `entry` in place of the entry of `title`.
        List { title: Title, entry: Option<String> },
        /// `crontab <file>`
        Install(OwnedFile),
    }

    pub(super) fn register(job: &Registration<'_>) -> Result<Command, Failure> {
        list(&job.title, Some(crontab::entry(job)))
    }

    pub(super) fn remove(title: &Title) -> Result<Command, Failure> {
        list(title, None)
    }

    fn list(title: &Title, entry: Option<String>) -> Result<Command, Failure> {
        let title = title.clone();
        let step = Step::List { title, entry };
        Ok(Command::new(&[&find()?, b"-l"], Stdio::Buffer, step))
    }

    fn find() -> Result<Vec<u8>, Failure> {
        let path = bun_core::env_var::PATH.get().unwrap_or(b"/usr/bin:/bin");
        let mut buf = bun_paths::path_buffer_pool::get();
        let found = bun_which::which(&mut buf, path, b"", b"crontab");
        Ok(found.ok_or("crontab not found in PATH")?.to_vec())
    }

    impl Step {
        pub(super) fn tolerates(&self, failure: &Failure) -> bool {
            // How `crontab -l` says that there is no table.
            matches!((self, failure), (Step::List { .. }, Failure::Exited(1)))
        }

        pub(super) fn next(self, output: &[u8]) -> Next {
            let Step::List { title, entry } = self else {
                return Ok(None);
            };
            let mut table = crontab::without_entry(output, &title);
            let suffix = match entry {
                Some(entry) => {
                    table.extend_from_slice(entry.as_bytes());
                    "bun-cron-tmp"
                }
                None => "bun-cron-rm-tmp",
            };
            let errors = ["Failed to create temp file", "Failed to write temp file"];
            let file = write_temp_file(suffix, &table, errors)?;
            let path = file.to_vec();
            let step = Step::Install(file);
            Ok(Some(Command::new(&[&find()?, &path], Stdio::Ignore, step)))
        }

        pub(super) fn into_file(self) -> Option<OwnedFile> {
            match self {
                Step::List { .. } => None,
                Step::Install(file) => Some(file),
            }
        }
    }
}

#[cfg(target_os = "macos")]
mod backend {
    use super::*;
    use bun_core::env_var::HOME;
    use bun_sys::FdDirExt as _;

    pub(super) enum Step {
        /// `launchctl bootout` of what the title named before, to load the new plist.
        BootoutOld(OwnedFile),
        /// `launchctl bootstrap`
        Bootstrap,
        /// `launchctl bootout`, to delete the plist.
        Bootout(Title),
    }

    pub(super) fn register(job: &Registration<'_>) -> Result<Command, Failure> {
        let home = HOME.get().ok_or("HOME environment variable not set")?;
        let dir = format!("{}/Library/LaunchAgents", BStr::new(home));
        (Fd::cwd().make_path(dir.as_bytes()))
            .map_err(|_| "Failed to create ~/Library/LaunchAgents directory")?;
        let plist = write_file(
            plist_path(home, &job.title).as_bytes(),
            (sys::O::TRUNC, 0o644),
            bun_cron::launchd::plist(job).as_bytes(),
            ["Failed to create plist file", "Failed to write plist"],
        )?;
        Ok(bootout(&job.title, Step::BootoutOld(plist)))
    }

    pub(super) fn remove(title: &Title) -> Result<Command, Failure> {
        Ok(bootout(title, Step::Bootout(title.clone())))
    }

    fn plist_path(home: &[u8], title: &Title) -> String {
        let home = BStr::new(home);
        format!("{home}/Library/LaunchAgents/bun.cron.{title}.plist")
    }

    fn bootout(title: &Title, step: Step) -> Command {
        let service = format!("gui/{}/bun.cron.{title}", sys::c::getuid());
        let argv = [b"/bin/launchctl", &b"bootout"[..], service.as_bytes()];
        Command::new(&argv, Stdio::Ignore, step)
    }

    impl Step {
        pub(super) fn tolerates(&self, failure: &Failure) -> bool {
            // There may be nothing to boot out.
            !matches!(self, Step::Bootstrap)
                && matches!(failure, Failure::Exited(_) | Failure::Signaled(_))
        }

        pub(super) fn next(self, _: &[u8]) -> Next {
            match self {
                Step::BootoutOld(plist) => {
                    let plist = ScopeGuard::into_inner(plist);
                    let domain = format!("gui/{}", sys::c::getuid());
                    let argv = [
                        b"/bin/launchctl",
                        &b"bootstrap"[..],
                        domain.as_bytes(),
                        &plist,
                    ];
                    Ok(Some(Command::new(&argv, Stdio::Ignore, Step::Bootstrap)))
                }
                Step::Bootstrap => Ok(None),
                Step::Bootout(title) => {
                    let home = HOME.get().ok_or("HOME not set")?;
                    let _ = sys::unlink(&ZBox::from_bytes(plist_path(home, &title)));
                    Ok(None)
                }
            }
        }

        pub(super) fn into_file(self) -> Option<OwnedFile> {
            match self {
                Step::BootoutOld(plist) => Some(plist),
                Step::Bootstrap | Step::Bootout(_) => None,
            }
        }
    }
}

#[cfg(windows)]
mod backend {
    use super::*;

    pub(super) enum Step {
        /// `schtasks /create`
        Create(OwnedFile),
        /// `schtasks /delete`
        Delete,
    }

    pub(super) fn register(job: &Registration<'_>) -> Result<Command, Failure> {
        let xml = bun_cron::schtasks::task_xml(job)?;
        let errors = [
            "Failed to create temp XML file",
            "Failed to write temp XML file",
        ];
        let file = write_temp_file("bun-cron-xml-tmp", xml.as_bytes(), errors)?;
        let (path, name) = (file.to_vec(), format!("bun-cron-{}", job.title));
        let argv = [
            &b"schtasks"[..],
            b"/create",
            b"/xml",
            &path,
            b"/tn",
            name.as_bytes(),
            b"/np",
            b"/f",
        ];
        Ok(Command::new(&argv, Stdio::Ignore, Step::Create(file)))
    }

    pub(super) fn remove(title: &Title) -> Result<Command, Failure> {
        let name = format!("bun-cron-{title}");
        let argv = [&b"schtasks"[..], b"/delete", b"/tn", name.as_bytes(), b"/f"];
        Ok(Command::new(&argv, Stdio::Ignore, Step::Delete))
    }

    impl Step {
        pub(super) fn tolerates(&self, failure: &Failure) -> bool {
            // There may be no such task.
            matches!((self, failure), (Step::Delete, Failure::Exited(_)))
        }

        pub(super) fn next(self, _: &[u8]) -> Next {
            Ok(None)
        }

        pub(super) fn into_file(self) -> Option<OwnedFile> {
            match self {
                Step::Create(file) => Some(file),
                Step::Delete => None,
            }
        }
    }
}
