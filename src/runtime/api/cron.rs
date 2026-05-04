//! Bun.cron - in-process and OS-level cron scheduling.
//!
//! Bun.cron(schedule, handler)       - run a callback on a schedule (returns CronJob)
//! Bun.cron(path, schedule, title)   - register an OS-level job (returns Promise)
//! Bun.cron.remove(title)            - remove an OS-level job (returns Promise)
//! Bun.cron.parse(expr, from?)       - next-occurrence calculator (returns Date | null)
//!
//! OS-level uses crontab (Linux), launchctl + launchd plist (macOS), or
//! schtasks (Windows). Async, event-loop-integrated via bun.spawn.

use core::ffi::c_char;
use std::cell::Cell;
use std::io::Write as _;
use std::sync::Arc;

use bun_aio::{KeepAlive, Loop as AsyncLoop};
use bun_core::env_var;
use bun_io::BufferedReader as OutputReader;
use bun_jsc::{
    self as jsc, CallFrame, EventLoop, EventLoopHandle, JSFunction, JSGlobalObject, JSObject,
    JSPromise, JSValue, JsRef, JsResult, VirtualMachine,
};
use bun_paths::{self as path, PathBuffer};
use bun_runtime::api::bun::spawn::{self, Process, Rusage, SpawnOptions, Status};
use bun_runtime::api::timer::EventLoopTimer;
use bun_str::{self as strings, ZStr, ZString};
use bun_sys::{self as sys, Fd, File};

use super::cron_parser::{self, CronExpression};

// ============================================================================
// CronJobBase — shared base for CronRegisterJob and CronRemoveJob
// ============================================================================

/// Shared base for [`CronRegisterJob`] and [`CronRemoveJob`].
// Zig: `fn CronJobBase(comptime Self: type) type { return struct { ... } }`
trait CronJobBase {
    fn remaining_fds_mut(&mut self) -> &mut i8;
    fn err_msg_mut(&mut self) -> &mut Option<Vec<u8>>;
    fn has_called_process_exit_mut(&mut self) -> &mut bool;
    fn exit_status_mut(&mut self) -> &mut Option<Status>;
    fn maybe_finished(&mut self);

    fn loop_(&self) -> &AsyncLoop {
        #[cfg(windows)]
        {
            VirtualMachine::get().uv_loop()
        }
        #[cfg(not(windows))]
        {
            bun_uws::Loop::get()
        }
    }

    fn event_loop(&self) -> &EventLoop {
        VirtualMachine::get().event_loop()
    }

    fn on_reader_done(&mut self) {
        debug_assert!(*self.remaining_fds_mut() > 0);
        *self.remaining_fds_mut() -= 1;
        self.maybe_finished();
    }

    fn on_reader_error(&mut self, err: sys::Error) {
        debug_assert!(*self.remaining_fds_mut() > 0);
        *self.remaining_fds_mut() -= 1;
        if self.err_msg_mut().is_none() {
            let mut msg = Vec::new();
            let _ = write!(
                &mut msg,
                "Failed to read process output: {}",
                <&'static str>::from(err.get_errno())
            );
            *self.err_msg_mut() = Some(msg);
        }
        self.maybe_finished();
    }

    fn on_process_exit(&mut self, _proc: &Process, status: Status, _rusage: &Rusage) {
        *self.has_called_process_exit_mut() = true;
        *self.exit_status_mut() = Some(status);
        self.maybe_finished();
    }
}

// ============================================================================
// CronRegisterJob
// ============================================================================

pub struct CronRegisterJob {
    promise: jsc::JSPromiseStrong,
    // LIFETIMES.tsv: JSC_BORROW → &JSGlobalObject
    global: &'static JSGlobalObject,
    poll: KeepAlive,

    bun_exe: &'static ZStr,
    abs_path: ZString,
    /// normalized numeric form for crontab/launchd
    schedule: ZString,
    title: ZString,
    parsed_cron: CronExpression,

    state: RegisterState,
    // LIFETIMES.tsv: SHARED → Option<Arc<Process>>
    process: Option<Arc<Process>>,
    stdout_reader: OutputReader,
    stderr_reader: OutputReader,
    remaining_fds: i8,
    has_called_process_exit: bool,
    exit_status: Option<Status>,
    err_msg: Option<Vec<u8>>,
    tmp_path: Option<ZString>,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum RegisterState {
    ReadingCrontab,
    InstallingCrontab,
    WritingPlist,
    BootingOut,
    Bootstrapping,
    Done,
    Failed,
}

impl CronJobBase for CronRegisterJob {
    fn remaining_fds_mut(&mut self) -> &mut i8 { &mut self.remaining_fds }
    fn err_msg_mut(&mut self) -> &mut Option<Vec<u8>> { &mut self.err_msg }
    fn has_called_process_exit_mut(&mut self) -> &mut bool { &mut self.has_called_process_exit }
    fn exit_status_mut(&mut self) -> &mut Option<Status> { &mut self.exit_status }
    fn maybe_finished(&mut self) { CronRegisterJob::maybe_finished(self) }
}

impl CronRegisterJob {
    fn set_err(&mut self, args: core::fmt::Arguments<'_>) {
        if self.err_msg.is_none() {
            let mut msg = Vec::new();
            let _ = msg.write_fmt(args);
            self.err_msg = Some(msg);
        }
    }

    fn maybe_finished(&mut self) {
        if !self.has_called_process_exit || self.remaining_fds != 0 {
            return;
        }
        if let Some(proc) = self.process.take() {
            proc.detach();
            // Arc drop = deref()
            drop(proc);
        }
        if self.err_msg.is_some() {
            self.finish();
            return;
        }
        let Some(status) = self.exit_status else { return };
        match status {
            Status::Exited(exited) => {
                if exited.code != 0
                    && !(self.state == RegisterState::ReadingCrontab && exited.code == 1)
                    && self.state != RegisterState::BootingOut
                {
                    #[cfg(windows)]
                    let stderr_output: &[u8] = strings::trim(
                        self.stderr_reader.final_buffer().as_slice(),
                        &ASCII_WHITESPACE,
                    );
                    #[cfg(not(windows))]
                    let stderr_output: &[u8] = b"";
                    // On Windows, detect the SID resolution error and provide
                    // a clear message instead of the raw schtasks output.
                    #[cfg(windows)]
                    {
                        if self.state == RegisterState::InstallingCrontab
                            && bun_str::strings::index_of(
                                stderr_output,
                                b"No mapping between account names",
                            )
                            .is_some()
                        {
                            self.set_err(format_args!(
                                "Failed to register cron job: your Windows account's Security Identifier (SID) could not be resolved. \
                                 This typically happens on headless servers or CI where the process runs under a service account. \
                                 To fix this, either run Bun as a regular user account, or create the scheduled task manually with: \
                                 schtasks /create /xml <file> /tn <name> /ru SYSTEM /f"
                            ));
                            self.finish();
                            return;
                        }
                    }
                    if !stderr_output.is_empty() {
                        self.set_err(format_args!("{}", bstr::BStr::new(stderr_output)));
                    } else {
                        self.set_err(format_args!("Process exited with code {}", exited.code));
                    }
                    self.finish();
                    return;
                }
            }
            Status::Signaled(sig) => {
                if self.state != RegisterState::BootingOut {
                    self.set_err(format_args!("Process killed by signal {}", sig as i32));
                    self.finish();
                    return;
                }
            }
            Status::Err(err) => {
                self.set_err(format_args!(
                    "Process error: {}",
                    <&'static str>::from(err.get_errno())
                ));
                self.finish();
                return;
            }
            Status::Running => return,
        }
        self.advance_state();
    }

    fn advance_state(&mut self) {
        #[cfg(target_os = "macos")]
        {
            match self.state {
                RegisterState::WritingPlist => self.spawn_bootout(),
                RegisterState::BootingOut => self.spawn_bootstrap(),
                RegisterState::Bootstrapping => self.finish(),
                _ => {
                    self.set_err(format_args!("Unexpected state"));
                    self.finish();
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            match self.state {
                RegisterState::ReadingCrontab => self.process_crontab_and_install(),
                RegisterState::InstallingCrontab => self.finish(),
                _ => {
                    self.set_err(format_args!("Unexpected state"));
                    self.finish();
                }
            }
        }
    }

    fn finish(this: *mut Self) {
        // SAFETY: caller holds the unique Box<Self>; we consume it at the end.
        let this_ref = unsafe { &mut *this };
        this_ref.state = if this_ref.err_msg.is_some() {
            RegisterState::Failed
        } else {
            RegisterState::Done
        };
        this_ref.poll.unref(VirtualMachine::get());
        let ev = VirtualMachine::get().event_loop();
        ev.enter();
        // TODO(port): RAII guard for ev.exit() on early return
        if let Some(msg) = &this_ref.err_msg {
            let _ = this_ref.promise.reject_with_async_stack(
                this_ref.global,
                this_ref
                    .global
                    .create_error_instance(format_args!("{}", bstr::BStr::new(msg))),
            );
        } else {
            let _ = this_ref.promise.resolve(this_ref.global, JSValue::UNDEFINED);
        }
        ev.exit();
        // deinit: drop the Box (fields drop via Drop)
        // SAFETY: `this` was created via Box::into_raw in cron_register.
        unsafe { drop(Box::from_raw(this)) };
    }

    // Note: `&mut self` methods that call `finish()` actually pass `self as *mut Self`.
    // PORT NOTE: reshaped — Zig's `finish()` destroys self; in Rust we route through
    // a raw-ptr `finish` and never touch `self` afterward. Callers below treat
    // `self.finish()` as terminal.
    // TODO(port): consider a state-machine refactor in Phase B.

    fn spawn_cmd(
        &mut self,
        argv: &mut [*const c_char],
        stdin_opt: SpawnOptions::Stdio,
        stdout_opt: SpawnOptions::Stdio,
    ) {
        spawn_cmd_generic(self, argv, stdin_opt, stdout_opt);
    }

    // -- Linux --

    fn start_linux(&mut self) {
        self.state = RegisterState::ReadingCrontab;
        self.stdout_reader = OutputReader::init::<CronRegisterJob>();
        self.stdout_reader.set_parent(self);
        let Some(crontab_path) = find_crontab() else {
            self.set_err(format_args!("crontab not found in PATH"));
            return Self::finish(self);
        };
        let mut argv: [*const c_char; 3] =
            [crontab_path, b"-l\0".as_ptr().cast(), core::ptr::null()];
        self.spawn_cmd(&mut argv, SpawnOptions::Stdio::Ignore, SpawnOptions::Stdio::Buffer);
    }

    fn process_crontab_and_install(&mut self) {
        let existing_content = self.stdout_reader.final_buffer().as_slice();
        let mut result: Vec<u8> = Vec::new();

        if filter_crontab(existing_content, self.title.as_bytes(), &mut result).is_err() {
            self.set_err(format_args!("Out of memory building crontab"));
            return Self::finish(self);
        }

        // Build new entry with single-quoted paths to prevent shell injection
        let mut new_entry = Vec::new();
        if write!(
            &mut new_entry,
            "# bun-cron: {title}\n{sched} '{exe}' run --cron-title={title} --cron-period='{sched}' '{path}'\n",
            title = bstr::BStr::new(self.title.as_bytes()),
            sched = bstr::BStr::new(self.schedule.as_bytes()),
            exe = bstr::BStr::new(self.bun_exe.as_bytes()),
            path = bstr::BStr::new(self.abs_path.as_bytes()),
        )
        .is_err()
        {
            self.set_err(format_args!("Out of memory"));
            return Self::finish(self);
        }
        result.extend_from_slice(&new_entry);

        let tmp_path = match make_temp_path("bun-cron-") {
            Ok(p) => p,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Self::finish(self);
            }
        };
        let tmp_path_ptr = tmp_path.as_ptr();
        self.tmp_path = Some(tmp_path);

        let file = match File::openat(
            Fd::cwd(),
            self.tmp_path.as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
            0o600,
        )
        .unwrap_result()
        {
            Ok(f) => f,
            Err(_) => {
                self.set_err(format_args!("Failed to create temp file"));
                return Self::finish(self);
            }
        };
        if file.write_all(&result).unwrap_result().is_err() {
            file.close();
            self.set_err(format_args!("Failed to write temp file"));
            return Self::finish(self);
        }
        file.close();

        self.state = RegisterState::InstallingCrontab;
        // TODO(port): explicit deinit of old reader before reassign — Drop handles it.
        self.stdout_reader = OutputReader::init::<CronRegisterJob>();
        let Some(crontab_path) = find_crontab() else {
            self.set_err(format_args!("crontab not found in PATH"));
            return Self::finish(self);
        };
        let mut argv: [*const c_char; 3] = [crontab_path, tmp_path_ptr.cast(), core::ptr::null()];
        self.spawn_cmd(&mut argv, SpawnOptions::Stdio::Ignore, SpawnOptions::Stdio::Ignore);
    }

    // -- macOS --

    fn start_mac(&mut self) {
        self.state = RegisterState::WritingPlist;

        let calendar_xml = match cron_to_calendar_interval(self.schedule.as_bytes()) {
            Ok(x) => x,
            Err(_) => {
                self.set_err(format_args!("Invalid cron expression"));
                return Self::finish(self);
            }
        };

        let Some(home) = env_var::HOME.get() else {
            self.set_err(format_args!("HOME environment variable not set"));
            return Self::finish(self);
        };

        let mut launch_agents_dir = Vec::new();
        let _ = write!(&mut launch_agents_dir, "{}/Library/LaunchAgents", bstr::BStr::new(home));
        if Fd::cwd().make_path::<u8>(&launch_agents_dir).is_err() {
            self.set_err(format_args!("Failed to create ~/Library/LaunchAgents directory"));
            return Self::finish(self);
        }

        let plist_path = match alloc_print_z(format_args!(
            "{}/Library/LaunchAgents/bun.cron.{}.plist",
            bstr::BStr::new(home),
            bstr::BStr::new(self.title.as_bytes())
        )) {
            Ok(p) => p,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Self::finish(self);
            }
        };
        self.tmp_path = Some(plist_path);

        // XML-escape all dynamic values
        macro_rules! try_escape {
            ($e:expr) => {
                match xml_escape($e) {
                    Ok(v) => v,
                    Err(_) => {
                        self.set_err(format_args!("Out of memory"));
                        return Self::finish(self);
                    }
                }
            };
        }
        let xml_title = try_escape!(self.title.as_bytes());
        let xml_bun = try_escape!(self.bun_exe.as_bytes());
        let xml_path = try_escape!(self.abs_path.as_bytes());
        let xml_sched = try_escape!(self.schedule.as_bytes());

        let mut plist = Vec::new();
        if write!(
            &mut plist,
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">\n\
<plist version=\"1.0\">\n\
<dict>\n\
    <key>Label</key>\n\
    <string>bun.cron.{0}</string>\n\
    <key>ProgramArguments</key>\n\
    <array>\n\
        <string>{1}</string>\n\
        <string>run</string>\n\
        <string>--cron-title={0}</string>\n\
        <string>--cron-period={3}</string>\n\
        <string>{2}</string>\n\
    </array>\n\
    <key>StartCalendarInterval</key>\n\
{4}\n\
    <key>StandardOutPath</key>\n\
    <string>/tmp/bun.cron.{0}.stdout.log</string>\n\
    <key>StandardErrorPath</key>\n\
    <string>/tmp/bun.cron.{0}.stderr.log</string>\n\
</dict>\n\
</plist>\n",
            bstr::BStr::new(&xml_title),
            bstr::BStr::new(&xml_bun),
            bstr::BStr::new(&xml_path),
            bstr::BStr::new(&xml_sched),
            bstr::BStr::new(&calendar_xml),
        )
        .is_err()
        {
            self.set_err(format_args!("Out of memory"));
            return Self::finish(self);
        }

        let file = match File::openat(
            Fd::cwd(),
            self.tmp_path.as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
            0o644,
        )
        .unwrap_result()
        {
            Ok(f) => f,
            Err(_) => {
                self.set_err(format_args!("Failed to create plist file"));
                return Self::finish(self);
            }
        };
        if file.write_all(&plist).unwrap_result().is_err() {
            file.close();
            self.set_err(format_args!("Failed to write plist"));
            return Self::finish(self);
        }
        file.close();

        self.spawn_bootout();
    }

    fn spawn_bootout(&mut self) {
        self.state = RegisterState::BootingOut;
        let uid_str = match alloc_print_z(format_args!(
            "gui/{}/bun.cron.{}",
            get_uid(),
            bstr::BStr::new(self.title.as_bytes())
        )) {
            Ok(s) => s,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Self::finish(self);
            }
        };
        let mut argv: [*const c_char; 4] = [
            b"/bin/launchctl\0".as_ptr().cast(),
            b"bootout\0".as_ptr().cast(),
            uid_str.as_ptr().cast(),
            core::ptr::null(),
        ];
        self.spawn_cmd(&mut argv, SpawnOptions::Stdio::Ignore, SpawnOptions::Stdio::Ignore);
        drop(uid_str);
    }

    fn spawn_bootstrap(&mut self) {
        self.state = RegisterState::Bootstrapping;
        let Some(plist_path) = self.tmp_path.take() else {
            self.set_err(format_args!("No plist path"));
            return Self::finish(self);
        };
        let uid_str = match alloc_print_z(format_args!("gui/{}", get_uid())) {
            Ok(s) => s,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Self::finish(self);
            }
        };
        let mut argv: [*const c_char; 5] = [
            b"/bin/launchctl\0".as_ptr().cast(),
            b"bootstrap\0".as_ptr().cast(),
            uid_str.as_ptr().cast(),
            plist_path.as_ptr().cast(),
            core::ptr::null(),
        ];
        // self.tmp_path already cleared via take() — don't delete the installed plist
        self.spawn_cmd(&mut argv, SpawnOptions::Stdio::Ignore, SpawnOptions::Stdio::Ignore);
        drop(uid_str);
        drop(plist_path);
    }

    // -- JS entry point --

    #[bun_jsc::host_fn]
    pub fn cron_register(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let args = frame.arguments_as_array::<3>();

        // In-process callback cron: Bun.cron(schedule, handler)
        if args[1].is_callable() {
            return CronJob::register(global, args[0], args[1]);
        }
        if args[0].is_string() && args[2].is_undefined() {
            return global.throw_invalid_arguments(format_args!(
                "Bun.cron(schedule, handler) expects a function handler as the second argument"
            ));
        }

        if !args[0].is_string() {
            return global.throw_invalid_arguments(format_args!(
                "Bun.cron() expects a string path as the first argument"
            ));
        }
        if !args[1].is_string() {
            return global.throw_invalid_arguments(format_args!(
                "Bun.cron() expects a string schedule as the second argument"
            ));
        }
        if !args[2].is_string() {
            return global.throw_invalid_arguments(format_args!(
                "Bun.cron() expects a string title as the third argument"
            ));
        }

        let path_str = args[0].to_bun_string(global)?;
        let schedule_str = args[1].to_bun_string(global)?;
        let title_str = args[2].to_bun_string(global)?;

        let path_slice = path_str.to_utf8();
        let schedule_slice = schedule_str.to_utf8();
        let title_slice = title_str.to_utf8();

        // Validate title: only [a-zA-Z0-9_-]
        if !validate_title(title_slice.slice()) {
            return global.throw_invalid_arguments(format_args!(
                "Cron title must contain only alphanumeric characters, hyphens, and underscores"
            ));
        }

        // Parse and normalize cron schedule to numeric form for crontab/launchd/schtasks
        let parsed = match CronExpression::parse(schedule_slice.slice()) {
            Ok(p) => p,
            Err(e) => {
                return global.throw_invalid_arguments(format_args!(
                    "{}",
                    CronExpression::error_message(e)
                ))
            }
        };
        let mut fmt_buf = [0u8; 512];
        let normalized_schedule = parsed.format_numeric(&mut fmt_buf);

        let abs_path = match resolve_path(global, frame, path_slice.slice()) {
            Ok(p) => p,
            Err(_) => {
                return global
                    .throw_invalid_arguments(format_args!("Failed to resolve path"))
            }
        };

        // Validate path has no single quotes (shell escaping in crontab) or
        // percent signs (cron interprets % as newline before the shell sees it)
        for &c in abs_path.as_bytes() {
            if c == b'\'' {
                return global.throw_invalid_arguments(format_args!(
                    "Path must not contain single quotes"
                ));
            }
            if c == b'%' {
                return global.throw_invalid_arguments(format_args!(
                    "Path must not contain percent signs (cron interprets % as newline)"
                ));
            }
        }

        let bun_exe = match bun_core::self_exe_path() {
            Ok(p) => p,
            Err(_) => {
                return global.throw(format_args!("Failed to get bun executable path"));
            }
        };
        if bun_str::strings::index_of_any(bun_exe.as_bytes(), b"'%").is_some() {
            return global.throw_invalid_arguments(format_args!(
                "Bun executable path '{}' contains characters (' or %) that cannot be safely embedded in a crontab entry",
                bstr::BStr::new(bun_exe.as_bytes())
            ));
        }
        let job = Box::into_raw(Box::new(CronRegisterJob {
            promise: JSPromise::Strong::init(global),
            // SAFETY: global outlives the job; JSC_BORROW per LIFETIMES.tsv.
            global: unsafe { core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global) },
            poll: KeepAlive::default(),
            bun_exe,
            abs_path,
            schedule: ZString::from_bytes(normalized_schedule),
            title: ZString::from_bytes(title_slice.slice()),
            parsed_cron: parsed,
            state: RegisterState::ReadingCrontab,
            process: None,
            stdout_reader: OutputReader::init::<CronRegisterJob>(),
            stderr_reader: OutputReader::init::<CronRegisterJob>(),
            remaining_fds: 0,
            has_called_process_exit: false,
            exit_status: None,
            err_msg: None,
            tmp_path: None,
        }));
        // SAFETY: just allocated; unique.
        let job_ref = unsafe { &mut *job };

        let promise_value = job_ref.promise.value();
        job_ref.poll.ref_(VirtualMachine::get());

        #[cfg(target_os = "macos")]
        job_ref.start_mac();
        #[cfg(windows)]
        job_ref.start_windows();
        #[cfg(all(not(target_os = "macos"), not(windows)))]
        job_ref.start_linux();

        Ok(promise_value)
    }

    // -- Windows --

    fn start_windows(&mut self) {
        self.state = RegisterState::InstallingCrontab;

        let task_name = match alloc_print_z(format_args!(
            "bun-cron-{}",
            bstr::BStr::new(self.title.as_bytes())
        )) {
            Ok(s) => s,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Self::finish(self);
            }
        };

        let xml = match cron_to_task_xml(
            &self.parsed_cron,
            self.bun_exe.as_bytes(),
            self.title.as_bytes(),
            self.schedule.as_bytes(),
            self.abs_path.as_bytes(),
        ) {
            Ok(x) => x,
            Err(e) => {
                if e == TaskXmlError::TooManyTriggers {
                    self.set_err(format_args!(
                        "This cron expression requires too many triggers for Windows Task Scheduler (max 48). Simplify the expression or use fewer restricted fields."
                    ));
                } else {
                    self.set_err(format_args!("Failed to build task XML"));
                }
                return Self::finish(self);
            }
        };

        let xml_path = match make_temp_path("bun-cron-xml-") {
            Ok(p) => p,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Self::finish(self);
            }
        };
        let xml_path_ptr = xml_path.as_ptr();
        self.tmp_path = Some(xml_path);

        let file = match File::openat(
            Fd::cwd(),
            self.tmp_path.as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
            0o600,
        )
        .unwrap_result()
        {
            Ok(f) => f,
            Err(_) => {
                self.set_err(format_args!("Failed to create temp XML file"));
                return Self::finish(self);
            }
        };
        if file.write_all(&xml).unwrap_result().is_err() {
            file.close();
            self.set_err(format_args!("Failed to write temp XML file"));
            return Self::finish(self);
        }
        file.close();

        let mut argv: [*const c_char; 9] = [
            b"schtasks\0".as_ptr().cast(),
            b"/create\0".as_ptr().cast(),
            b"/xml\0".as_ptr().cast(),
            xml_path_ptr.cast(),
            b"/tn\0".as_ptr().cast(),
            task_name.as_ptr().cast(),
            b"/np\0".as_ptr().cast(),
            b"/f\0".as_ptr().cast(),
            core::ptr::null(),
        ];
        self.spawn_cmd(&mut argv, SpawnOptions::Stdio::Ignore, SpawnOptions::Stdio::Ignore);
        drop(task_name);
    }
}

impl Drop for CronRegisterJob {
    fn drop(&mut self) {
        // stdout_reader / stderr_reader drop via their own Drop.
        if let Some(proc) = self.process.take() {
            proc.detach();
            // Arc drop = deref()
        }
        if let Some(p) = self.tmp_path.take() {
            let _ = sys::unlink(&p);
        }
        // err_msg, abs_path, schedule, title freed via field Drop.
    }
}

#[cfg(windows)]
const ASCII_WHITESPACE: [u8; 6] = *b" \t\n\r\x0b\x0c";

// ============================================================================
// CronRemoveJob
// ============================================================================

pub struct CronRemoveJob {
    promise: jsc::JSPromiseStrong,
    // LIFETIMES.tsv: JSC_BORROW → &JSGlobalObject
    global: &'static JSGlobalObject,
    poll: KeepAlive,
    title: ZString,

    state: RemoveState,
    // LIFETIMES.tsv: SHARED → Option<Arc<Process>>
    process: Option<Arc<Process>>,
    stdout_reader: OutputReader,
    stderr_reader: OutputReader,
    remaining_fds: i8,
    has_called_process_exit: bool,
    exit_status: Option<Status>,
    err_msg: Option<Vec<u8>>,
    tmp_path: Option<ZString>,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum RemoveState {
    ReadingCrontab,
    InstallingCrontab,
    BootingOut,
    Done,
    Failed,
}

impl CronJobBase for CronRemoveJob {
    fn remaining_fds_mut(&mut self) -> &mut i8 { &mut self.remaining_fds }
    fn err_msg_mut(&mut self) -> &mut Option<Vec<u8>> { &mut self.err_msg }
    fn has_called_process_exit_mut(&mut self) -> &mut bool { &mut self.has_called_process_exit }
    fn exit_status_mut(&mut self) -> &mut Option<Status> { &mut self.exit_status }
    fn maybe_finished(&mut self) { CronRemoveJob::maybe_finished(self) }
}

impl CronRemoveJob {
    fn set_err(&mut self, args: core::fmt::Arguments<'_>) {
        if self.err_msg.is_none() {
            let mut msg = Vec::new();
            let _ = msg.write_fmt(args);
            self.err_msg = Some(msg);
        }
    }

    fn maybe_finished(&mut self) {
        if !self.has_called_process_exit || self.remaining_fds != 0 {
            return;
        }
        if let Some(proc) = self.process.take() {
            proc.detach();
            drop(proc);
        }
        if self.err_msg.is_some() {
            return Self::finish(self);
        }
        let Some(status) = self.exit_status else { return };
        match status {
            Status::Exited(exited) => {
                let is_acceptable_nonzero = (self.state == RemoveState::ReadingCrontab
                    && exited.code == 1)
                    || self.state == RemoveState::BootingOut
                    // On Windows, schtasks /delete exits non-zero when the task doesn't exist;
                    // removal of a non-existent job should resolve without error.
                    || (cfg!(windows) && self.state == RemoveState::InstallingCrontab);
                if exited.code != 0 && !is_acceptable_nonzero {
                    #[cfg(windows)]
                    let stderr_output: &[u8] = strings::trim(
                        self.stderr_reader.final_buffer().as_slice(),
                        &ASCII_WHITESPACE,
                    );
                    #[cfg(not(windows))]
                    let stderr_output: &[u8] = b"";
                    if !stderr_output.is_empty() {
                        self.set_err(format_args!("{}", bstr::BStr::new(stderr_output)));
                    } else {
                        self.set_err(format_args!("Process exited with code {}", exited.code));
                    }
                    return Self::finish(self);
                }
            }
            Status::Signaled(sig) => {
                if self.state != RemoveState::BootingOut {
                    self.set_err(format_args!("Process killed by signal {}", sig as i32));
                    return Self::finish(self);
                }
            }
            Status::Err(err) => {
                self.set_err(format_args!(
                    "Process error: {}",
                    <&'static str>::from(err.get_errno())
                ));
                return Self::finish(self);
            }
            Status::Running => return,
        }
        self.advance_state();
    }

    fn advance_state(&mut self) {
        #[cfg(target_os = "macos")]
        {
            match self.state {
                RemoveState::BootingOut => {
                    let Some(home) = env_var::HOME.get() else {
                        self.set_err(format_args!("HOME not set"));
                        return Self::finish(self);
                    };
                    if let Ok(plist_path) = alloc_print_z(format_args!(
                        "{}/Library/LaunchAgents/bun.cron.{}.plist",
                        bstr::BStr::new(home),
                        bstr::BStr::new(self.title.as_bytes())
                    )) {
                        let _ = sys::unlink(&plist_path);
                    } else {
                        self.set_err(format_args!("Out of memory"));
                        return Self::finish(self);
                    }
                    Self::finish(self);
                }
                _ => {
                    self.set_err(format_args!("Unexpected state"));
                    Self::finish(self);
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            match self.state {
                RemoveState::ReadingCrontab => self.remove_crontab_entry(),
                RemoveState::InstallingCrontab => Self::finish(self),
                _ => {
                    self.set_err(format_args!("Unexpected state"));
                    Self::finish(self);
                }
            }
        }
    }

    fn finish(this: *mut Self) {
        // SAFETY: caller holds the unique Box<Self>; consumed at the end.
        let this_ref = unsafe { &mut *this };
        this_ref.state = if this_ref.err_msg.is_some() {
            RemoveState::Failed
        } else {
            RemoveState::Done
        };
        this_ref.poll.unref(VirtualMachine::get());
        let ev = VirtualMachine::get().event_loop();
        ev.enter();
        if let Some(msg) = &this_ref.err_msg {
            let _ = this_ref.promise.reject_with_async_stack(
                this_ref.global,
                this_ref
                    .global
                    .create_error_instance(format_args!("{}", bstr::BStr::new(msg))),
            );
        } else {
            let _ = this_ref.promise.resolve(this_ref.global, JSValue::UNDEFINED);
        }
        ev.exit();
        // SAFETY: `this` was created via Box::into_raw in cron_remove.
        unsafe { drop(Box::from_raw(this)) };
    }

    fn spawn_cmd(
        &mut self,
        argv: &mut [*const c_char],
        stdin_opt: SpawnOptions::Stdio,
        stdout_opt: SpawnOptions::Stdio,
    ) {
        spawn_cmd_generic(self, argv, stdin_opt, stdout_opt);
    }

    fn start_linux(&mut self) {
        self.state = RemoveState::ReadingCrontab;
        self.stdout_reader = OutputReader::init::<CronRemoveJob>();
        self.stdout_reader.set_parent(self);
        let Some(crontab_path) = find_crontab() else {
            self.set_err(format_args!("crontab not found in PATH"));
            return Self::finish(self);
        };
        let mut argv: [*const c_char; 3] =
            [crontab_path, b"-l\0".as_ptr().cast(), core::ptr::null()];
        self.spawn_cmd(&mut argv, SpawnOptions::Stdio::Ignore, SpawnOptions::Stdio::Buffer);
    }

    fn remove_crontab_entry(&mut self) {
        let existing_content = self.stdout_reader.final_buffer().as_slice();
        let mut result: Vec<u8> = Vec::new();

        if filter_crontab(existing_content, self.title.as_bytes(), &mut result).is_err() {
            self.set_err(format_args!("Out of memory"));
            return Self::finish(self);
        }

        let tmp_path = match make_temp_path("bun-cron-rm-") {
            Ok(p) => p,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Self::finish(self);
            }
        };
        let tmp_path_ptr = tmp_path.as_ptr();
        self.tmp_path = Some(tmp_path);

        let file = match File::openat(
            Fd::cwd(),
            self.tmp_path.as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
            0o600,
        )
        .unwrap_result()
        {
            Ok(f) => f,
            Err(_) => {
                self.set_err(format_args!("Failed to create temp file"));
                return Self::finish(self);
            }
        };
        if file.write_all(&result).unwrap_result().is_err() {
            file.close();
            self.set_err(format_args!("Failed to write temp file"));
            return Self::finish(self);
        }
        file.close();

        self.state = RemoveState::InstallingCrontab;
        self.stdout_reader = OutputReader::init::<CronRemoveJob>();
        let Some(crontab_path) = find_crontab() else {
            self.set_err(format_args!("crontab not found in PATH"));
            return Self::finish(self);
        };
        let mut argv: [*const c_char; 3] = [crontab_path, tmp_path_ptr.cast(), core::ptr::null()];
        self.spawn_cmd(&mut argv, SpawnOptions::Stdio::Ignore, SpawnOptions::Stdio::Ignore);
    }

    fn start_mac(&mut self) {
        self.state = RemoveState::BootingOut;
        let uid_str = match alloc_print_z(format_args!(
            "gui/{}/bun.cron.{}",
            get_uid(),
            bstr::BStr::new(self.title.as_bytes())
        )) {
            Ok(s) => s,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Self::finish(self);
            }
        };
        let mut argv: [*const c_char; 4] = [
            b"/bin/launchctl\0".as_ptr().cast(),
            b"bootout\0".as_ptr().cast(),
            uid_str.as_ptr().cast(),
            core::ptr::null(),
        ];
        self.spawn_cmd(&mut argv, SpawnOptions::Stdio::Ignore, SpawnOptions::Stdio::Ignore);
        drop(uid_str);
    }

    #[bun_jsc::host_fn]
    pub fn cron_remove(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        let args = frame.arguments_as_array::<1>();
        if !args[0].is_string() {
            return global.throw_invalid_arguments(format_args!(
                "Bun.cron.remove() expects a string title"
            ));
        }

        let title_str = args[0].to_bun_string(global)?;
        let title_slice = title_str.to_utf8();

        if !validate_title(title_slice.slice()) {
            return global.throw_invalid_arguments(format_args!(
                "Cron title must contain only alphanumeric characters, hyphens, and underscores"
            ));
        }

        let job = Box::into_raw(Box::new(CronRemoveJob {
            promise: JSPromise::Strong::init(global),
            // SAFETY: global outlives the job; JSC_BORROW per LIFETIMES.tsv.
            global: unsafe { core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global) },
            poll: KeepAlive::default(),
            title: ZString::from_bytes(title_slice.slice()),
            state: RemoveState::ReadingCrontab,
            process: None,
            stdout_reader: OutputReader::init::<CronRemoveJob>(),
            stderr_reader: OutputReader::init::<CronRemoveJob>(),
            remaining_fds: 0,
            has_called_process_exit: false,
            exit_status: None,
            err_msg: None,
            tmp_path: None,
        }));
        // SAFETY: just allocated; unique.
        let job_ref = unsafe { &mut *job };

        let promise_value = job_ref.promise.value();
        job_ref.poll.ref_(VirtualMachine::get());
        #[cfg(target_os = "macos")]
        job_ref.start_mac();
        #[cfg(windows)]
        job_ref.start_windows();
        #[cfg(all(not(target_os = "macos"), not(windows)))]
        job_ref.start_linux();
        Ok(promise_value)
    }

    fn start_windows(&mut self) {
        self.state = RemoveState::InstallingCrontab;
        let task_name = match alloc_print_z(format_args!(
            "bun-cron-{}",
            bstr::BStr::new(self.title.as_bytes())
        )) {
            Ok(s) => s,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Self::finish(self);
            }
        };
        let mut argv: [*const c_char; 6] = [
            b"schtasks\0".as_ptr().cast(),
            b"/delete\0".as_ptr().cast(),
            b"/tn\0".as_ptr().cast(),
            task_name.as_ptr().cast(),
            b"/f\0".as_ptr().cast(),
            core::ptr::null(),
        ];
        self.spawn_cmd(&mut argv, SpawnOptions::Stdio::Ignore, SpawnOptions::Stdio::Ignore);
        drop(task_name);
    }
}

impl Drop for CronRemoveJob {
    fn drop(&mut self) {
        if let Some(proc) = self.process.take() {
            proc.detach();
        }
        if let Some(p) = self.tmp_path.take() {
            let _ = sys::unlink(&p);
        }
    }
}

// ============================================================================
// CronJob — in-process callback-style cron (Bun.cron(expr, cb))
// ============================================================================

#[bun_jsc::JsClass]
pub struct CronJob {
    // bun.ptr.RefCount(...) intrusive — keep raw count for IntrusiveRc compat.
    ref_count: Cell<u32>,
    event_loop_timer: EventLoopTimer,
    // LIFETIMES.tsv: JSC_BORROW → &JSGlobalObject
    global: &'static JSGlobalObject,
    parsed: CronExpression,
    poll_ref: KeepAlive,
    this_value: JsRef,
    stopped: bool,
    /// Last computed wall-clock fire target (ms epoch); floors the next search
    /// so monotonic-vs-wall skew can't recompute the same minute.
    last_next_ms: f64,
    /// True while a ref() is held across an in-flight callback promise.
    /// Released exactly once by either onPromiseResolve/Reject or
    /// clearAllForVM(.teardown).
    pending_ref: bool,
    /// True between onTimerFire's cb.call() and processing of its result.
    in_fire: bool,
}

pub mod js {
    // Codegen-backed accessors. .classes.ts wrapper stays generated C++.
    pub use bun_jsc::codegen::JSCronJob::*;
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum ClearMode {
    Reload,
    Teardown,
}

impl CronJob {
    // Intrusive refcount (bun.ptr.RefCount).
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    pub fn deref(this: *mut Self) {
        // SAFETY: intrusive RC; this is valid until count hits 0.
        let rc = unsafe { (*this).ref_count.get() - 1 };
        unsafe { (*this).ref_count.set(rc) };
        if rc == 0 {
            // deinit: this_value.deinit() then destroy.
            // SAFETY: last ref; nobody else holds a pointer.
            unsafe {
                (*this).this_value.deinit();
                drop(Box::from_raw(this));
            }
        }
    }

    /// Defer downgrading the JS wrapper to weak until any in-flight promise
    /// has settled, so onPromiseReject can still read pendingPromise from
    /// the wrapper and pass the real Promise to unhandledRejection.
    fn maybe_downgrade(&mut self) {
        if self.stopped && !self.pending_ref && !self.this_value.is_finalized() {
            self.this_value.downgrade();
        }
    }

    fn release_pending_ref(this: *mut Self) {
        // SAFETY: caller holds at least one ref.
        let this_ref = unsafe { &mut *this };
        if this_ref.pending_ref {
            this_ref.pending_ref = false;
            this_ref.maybe_downgrade();
            Self::deref(this);
        }
    }

    /// Idempotent — every step checks its own state.
    fn stop_internal(&mut self, vm: &VirtualMachine) {
        self.stopped = true;
        if self.event_loop_timer.state == EventLoopTimer::State::ACTIVE {
            vm.timer.remove(&mut self.event_loop_timer);
        }
        self.poll_ref.unref(vm);
        self.maybe_downgrade();
    }

    /// Runs the cleanup that selfStop deferred while in_fire was true.
    fn finish_deferred_stop(this: *mut Self, vm: &VirtualMachine) {
        // SAFETY: caller holds a ref.
        unsafe { (*this).stop_internal(vm) };
        Self::remove_from_list(this, vm);
    }

    fn self_stop(this: *mut Self, vm: &VirtualMachine) {
        // SAFETY: caller holds a ref.
        let this_ref = unsafe { &mut *this };
        // While the callback is on the stack or its promise is pending, defer
        // list removal + downgrade to finishDeferredStop (called from
        // scheduleNext after settle) so onPromiseReject can read pendingPromise
        // and clearAllForVM(.teardown) can release pending_ref.
        if this_ref.in_fire || this_ref.pending_ref {
            this_ref.stopped = true;
            this_ref.poll_ref.unref(vm);
            return;
        }
        this_ref.stop_internal(vm);
        Self::remove_from_list(this, vm);
    }

    fn remove_from_list(this: *mut Self, vm: &VirtualMachine) {
        if let Some(rare) = vm.rare_data.as_ref() {
            if let Some(i) = rare.cron_jobs.iter().position(|&j| j == this) {
                rare.cron_jobs.swap_remove(i);
                Self::deref(this);
            }
        }
    }

    /// `.reload`: --hot — promises in flight will still settle on this VM, so
    /// the pending ref is left for onPromiseResolve/Reject to balance.
    /// `.teardown`: worker exit — the event loop is dying, settle never
    /// happens, so release the pending ref here to avoid leaking the struct.
    pub fn clear_all_for_vm<const MODE: ClearMode>(vm: &VirtualMachine) {
        let Some(rare) = vm.rare_data.as_ref() else { return };
        for &job in rare.cron_jobs.as_slice() {
            // SAFETY: list holds a ref for each entry.
            unsafe { (*job).stop_internal(vm) };
            if MODE == ClearMode::Teardown {
                Self::release_pending_ref(job);
            }
            Self::deref(job);
        }
        rare.cron_jobs.clear();
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called from JSC finalizer on mutator thread.
        unsafe { (*this).this_value.finalize() };
        Self::deref(this);
    }

    fn compute_next_timespec(&mut self) -> Option<bun_core::Timespec> {
        // Cron occurrences are calendar-based (real epoch); the timer heap is
        // monotonic. Anchor both to real time so fake timers don't half-apply.
        let now_ms: f64 = bun_core::time::milli_timestamp() as f64;
        // The monotonic timer can fire fractionally before the wall-clock target
        // (clock skew / NTP step); floor next() at the prior target so it can't
        // recompute the same minute and double-fire.
        let from_ms = now_ms.max(self.last_next_ms);
        let next_ms = match self.parsed.next(self.global, from_ms) {
            Ok(Some(v)) => v,
            _ => return None,
        };
        self.last_next_ms = next_ms;
        let delta: i64 = (next_ms - now_ms).max(1.0) as i64;
        Some(bun_core::Timespec::ms_from_now(
            bun_core::TimespecMode::ForceRealTime,
            delta,
        ))
    }

    fn schedule_next(this: *mut Self, vm: &VirtualMachine) {
        // SAFETY: caller holds a ref.
        let this_ref = unsafe { &mut *this };
        // Every path into here has just returned from user JS (the callback,
        // an uncaughtException handler, or an unhandledRejection handler). If
        // that JS called process.exit() / worker.terminate(), don't re-arm
        // the timer into a VM whose teardown now owns it.
        if this_ref.stopped || vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            this_ref.stopped = true;
            return Self::finish_deferred_stop(this, vm);
        }
        let Some(next_time) = this_ref.compute_next_timespec() else {
            return Self::finish_deferred_stop(this, vm);
        };
        vm.timer.update(&mut this_ref.event_loop_timer, &next_time);
    }

    pub fn on_timer_fire(this: *mut Self, vm: &VirtualMachine) {
        // SAFETY: timer heap holds the entry; the bracket-ref below keeps `this`
        // alive across scheduleNext → finishDeferredStop.
        let this_ref = unsafe { &mut *this };
        this_ref.event_loop_timer.state = EventLoopTimer::State::FIRED;
        // scheduleNext → finishDeferredStop downgrades this_value and derefs the
        // list entry; bracket-ref so that path can't drop the last ref mid-function.
        this_ref.ref_();
        let _guard = scopeguard::guard((), |_| Self::deref(this));

        if this_ref.stopped {
            return;
        }
        if vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            Self::self_stop(this, vm);
            return;
        }

        let Some(js_this) = this_ref.this_value.try_get() else {
            Self::self_stop(this, vm);
            return;
        };
        let Some(cb) = js::callback_get_cached(js_this) else {
            Self::self_stop(this, vm);
            return;
        };
        if cb.is_undefined() {
            Self::self_stop(this, vm);
            return;
        }

        vm.event_loop().enter();
        let _ev_guard = scopeguard::guard((), |_| vm.event_loop().exit());

        this_ref.in_fire = true;
        let result = match cb.call(this_ref.global, js_this, &[]) {
            Ok(v) => {
                this_ref.in_fire = false;
                v
            }
            Err(_) => {
                this_ref.in_fire = false;
                if let Some(err) = this_ref.global.try_take_exception() {
                    // terminate() arriving mid-callback leaves the TerminationException
                    // pending (tryClearException refuses to clear it) while JSC clears
                    // hasTerminationRequest on VMEntryScope exit. Reporting it would
                    // enter a DeferTermination scope and assert; match setTimeout's
                    // Bun__reportUnhandledError and drop it.
                    if err.is_termination_exception() {
                        Self::self_stop(this, vm);
                        return;
                    }
                    let _ = vm.uncaught_exception(vm.global, err, false);
                }
                Self::schedule_next(this, vm);
                return;
            }
        };

        // terminate() may have arrived while the callback was running; bail out
        // without touching the timer heap or JS state the teardown path owns.
        if vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            Self::self_stop(this, vm);
            return;
        }

        if let Some(promise) = result.as_any_promise() {
            match promise.status() {
                jsc::PromiseStatus::Pending => {
                    this_ref.ref_();
                    this_ref.pending_ref = true;
                    js::pending_promise_set_cached(js_this, this_ref.global, result);
                    if result
                        .then(this_ref.global, this, on_promise_resolve, on_promise_reject)
                        .is_err()
                    {
                        js::pending_promise_set_cached(js_this, this_ref.global, JSValue::UNDEFINED);
                        Self::release_pending_ref(this);
                        Self::schedule_next(this, vm);
                    }
                    return;
                }
                jsc::PromiseStatus::Fulfilled => {}
                jsc::PromiseStatus::Rejected => {
                    promise.set_handled(this_ref.global.vm());
                    vm.unhandled_rejection(vm.global, promise.result(this_ref.global.vm()), result);
                }
            }
        }

        Self::schedule_next(this, vm);
    }

    #[bun_jsc::host_fn(method)]
    pub fn stop(this: &mut Self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        Self::self_stop(this, this.global.bun_vm());
        Ok(frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(this: &mut Self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if !this.stopped {
            this.poll_ref.ref_(this.global.bun_vm());
        }
        Ok(frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(this: &mut Self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.unref(this.global.bun_vm());
        Ok(frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_cron(_this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED) // unreachable — register() pre-populates the cache via cronSetCached
    }

    pub fn register(
        global: &JSGlobalObject,
        schedule_arg: JSValue,
        callback_arg: JSValue,
    ) -> JsResult<JSValue> {
        if !schedule_arg.is_string() {
            return global.throw_invalid_arguments(format_args!(
                "Bun.cron() expects a string cron expression"
            ));
        }

        let schedule_str = schedule_arg.to_bun_string(global)?;
        let schedule_slice = schedule_str.to_utf8();

        let parsed = match CronExpression::parse(schedule_slice.slice()) {
            Ok(p) => p,
            Err(e) => {
                return global.throw_invalid_arguments(format_args!(
                    "{}",
                    CronExpression::error_message(e)
                ))
            }
        };

        let vm = global.bun_vm();

        let job = Box::into_raw(Box::new(CronJob {
            ref_count: Cell::new(1),
            event_loop_timer: EventLoopTimer {
                tag: EventLoopTimer::Tag::CronJob,
                next: bun_core::Timespec::EPOCH,
                ..EventLoopTimer::default()
            },
            // SAFETY: global outlives the job; JSC_BORROW per LIFETIMES.tsv.
            global: unsafe { core::mem::transmute::<&JSGlobalObject, &'static JSGlobalObject>(global) },
            parsed,
            poll_ref: KeepAlive::default(),
            this_value: JsRef::empty(),
            stopped: false,
            last_next_ms: 0.0,
            pending_ref: false,
            in_fire: false,
        }));
        // SAFETY: just allocated; unique.
        let job_ref = unsafe { &mut *job };

        let Some(next_time) = job_ref.compute_next_timespec() else {
            Self::deref(job);
            return global.throw_invalid_arguments(format_args!(
                "Cron expression '{}' has no future occurrences",
                bstr::BStr::new(schedule_slice.slice())
            ));
        };

        // The cron_jobs list exists so --hot reload and worker teardown can
        // stop/release jobs. Main-thread VMs without --hot never enumerate it,
        // so skip the list ref + append entirely.
        if vm.hot_reload == jsc::HotReload::Hot || vm.worker.is_some() {
            job_ref.ref_(); // owned by cron_jobs entry
            vm.rare_data().cron_jobs.push(job);
        }

        let js_value = job_ref.to_js(global);
        job_ref.this_value.set_strong(js_value, global);
        js::cron_set_cached(js_value, global, schedule_arg);
        js::callback_set_cached(js_value, global, callback_arg.with_async_context_if_needed(global));

        job_ref.poll_ref.ref_(vm);
        vm.timer.update(&mut job_ref.event_loop_timer, &next_time);

        Ok(js_value)
    }
}

// TODO(port): move to <area>_sys / codegen exports
#[unsafe(no_mangle)]
pub static Bun__CronJob__onPromiseResolve: jsc::JSHostFn = jsc::to_js_host_fn(on_promise_resolve);
#[unsafe(no_mangle)]
pub static Bun__CronJob__onPromiseReject: jsc::JSHostFn = jsc::to_js_host_fn(on_promise_reject);

#[bun_jsc::host_fn]
fn on_promise_resolve(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let this: *mut CronJob = args[args.len() - 1].as_promise_ptr::<CronJob>();
    let _guard = scopeguard::guard((), |_| CronJob::release_pending_ref(this));
    // SAFETY: pending_ref holds a ref on `this`.
    let this_ref = unsafe { &mut *this };
    let vm = this_ref.global.bun_vm();
    if let Some(js_this) = this_ref.this_value.try_get() {
        js::pending_promise_set_cached(js_this, this_ref.global, JSValue::UNDEFINED);
    }
    CronJob::schedule_next(this, vm);
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
fn on_promise_reject(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let this: *mut CronJob = args[args.len() - 1].as_promise_ptr::<CronJob>();
    let _guard = scopeguard::guard((), |_| CronJob::release_pending_ref(this));
    // SAFETY: pending_ref holds a ref on `this`.
    let this_ref = unsafe { &mut *this };
    let vm = this_ref.global.bun_vm();
    let err = args[0];
    let mut promise_value = JSValue::UNDEFINED;
    if let Some(js_this) = this_ref.this_value.try_get() {
        promise_value = js::pending_promise_get_cached(js_this).unwrap_or(JSValue::UNDEFINED);
        js::pending_promise_set_cached(js_this, this_ref.global, JSValue::UNDEFINED);
    }
    vm.unhandled_rejection(vm.global, err, promise_value);
    CronJob::schedule_next(this, vm);
    Ok(JSValue::UNDEFINED)
}

// ============================================================================
// Bun.cron object builder
// ============================================================================

pub fn get_cron_object(global_this: &JSGlobalObject, _obj: &JSObject) -> JSValue {
    let cron_fn = JSFunction::create(global_this, "cron", CronRegisterJob::cron_register, 3, Default::default());
    let remove_fn = JSFunction::create(global_this, "remove", CronRemoveJob::cron_remove, 1, Default::default());
    let parse_fn = JSFunction::create(global_this, "parse", cron_parse, 1, Default::default());
    cron_fn.put(global_this, bun_str::String::static_("remove"), remove_fn);
    cron_fn.put(global_this, bun_str::String::static_("parse"), parse_fn);
    cron_fn
}

#[bun_jsc::host_fn]
pub fn cron_parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<2>();

    if !args[0].is_string() {
        return global.throw_invalid_arguments(format_args!(
            "Bun.cron.parse() expects a string cron expression as the first argument"
        ));
    }

    let expr_str = args[0].to_bun_string(global)?;
    let expr_slice = expr_str.to_utf8();

    let parsed = match CronExpression::parse(expr_slice.slice()) {
        Ok(p) => p,
        Err(e) => {
            return global.throw_invalid_arguments(format_args!(
                "{}",
                CronExpression::error_message(e)
            ))
        }
    };

    let from_ms: f64 = if !args[1].is_empty() && !args[1].is_undefined() && args[1] != JSValue::NULL {
        if args[1].is_number() {
            args[1].to_number(global)?
        } else if args[1].js_type() == jsc::JSType::JSDate {
            args[1].to_number(global)?
        } else {
            return global.throw_invalid_arguments(format_args!(
                "Bun.cron.parse() expects the second argument to be a Date or number (ms since epoch)"
            ));
        }
    } else {
        bun_core::time::milli_timestamp() as f64
    };

    if from_ms.is_nan() || from_ms.is_infinite() {
        return global.throw_invalid_arguments(format_args!("Invalid date value"));
    }

    let Some(next_ms) = parsed.next(global, from_ms)? else {
        return Ok(JSValue::NULL);
    };
    Ok(JSValue::from_date_number(global, next_ms))
}

// ============================================================================
// Shared helpers
// ============================================================================

/// Trait abstracting over CronRegisterJob/CronRemoveJob for `spawn_cmd_generic`.
// TODO(port): merge with CronJobBase in Phase B.
trait SpawnCmdTarget: CronJobBase {
    fn set_err(&mut self, args: core::fmt::Arguments<'_>);
    fn finish(this: *mut Self);
    fn process_slot(&mut self) -> &mut Option<Arc<Process>>;
    fn stdout_reader(&mut self) -> &mut OutputReader;
    fn stderr_reader(&mut self) -> &mut OutputReader;
    fn remaining_fds(&mut self) -> &mut i8;
}

impl SpawnCmdTarget for CronRegisterJob {
    fn set_err(&mut self, args: core::fmt::Arguments<'_>) { CronRegisterJob::set_err(self, args) }
    fn finish(this: *mut Self) { CronRegisterJob::finish(this) }
    fn process_slot(&mut self) -> &mut Option<Arc<Process>> { &mut self.process }
    fn stdout_reader(&mut self) -> &mut OutputReader { &mut self.stdout_reader }
    fn stderr_reader(&mut self) -> &mut OutputReader { &mut self.stderr_reader }
    fn remaining_fds(&mut self) -> &mut i8 { &mut self.remaining_fds }
}
impl SpawnCmdTarget for CronRemoveJob {
    fn set_err(&mut self, args: core::fmt::Arguments<'_>) { CronRemoveJob::set_err(self, args) }
    fn finish(this: *mut Self) { CronRemoveJob::finish(this) }
    fn process_slot(&mut self) -> &mut Option<Arc<Process>> { &mut self.process }
    fn stdout_reader(&mut self) -> &mut OutputReader { &mut self.stdout_reader }
    fn stderr_reader(&mut self) -> &mut OutputReader { &mut self.stderr_reader }
    fn remaining_fds(&mut self) -> &mut i8 { &mut self.remaining_fds }
}

/// Generic spawn used by both CronRegisterJob and CronRemoveJob.
fn spawn_cmd_generic<T: SpawnCmdTarget>(
    this: &mut T,
    argv: &mut [*const c_char],
    stdin_opt: SpawnOptions::Stdio,
    stdout_opt: SpawnOptions::Stdio,
) {
    *this.has_called_process_exit_mut() = false;
    *this.exit_status_mut() = None;
    *this.remaining_fds() = 0;

    #[allow(unused_mut)]
    let mut resolved_argv0: Option<*const c_char> = None;
    #[cfg(windows)]
    {
        // Resolve the executable via bun.which, matching Bun.spawn's behavior.
        let mut path_buf = PathBuffer::uninit();
        let path_env = VirtualMachine::get()
            .transpiler
            .env
            .map
            .get(b"PATH")
            .unwrap_or(b"");
        // SAFETY: argv[0] is a NUL-terminated string from caller.
        let argv0 = unsafe { ZStr::from_ptr(argv[0]) }.as_bytes();
        match bun_core::which(&mut path_buf, path_env, b"", argv0) {
            Some(p) => resolved_argv0 = Some(p.as_ptr().cast()),
            None => {
                this.set_err(format_args!(
                    "Could not find '{}' in PATH",
                    bstr::BStr::new(argv0)
                ));
                return T::finish(this);
            }
        }
    }
    #[cfg(windows)]
    {
        this.stderr_reader().source = Some(bun_io::Source::Pipe(Box::new(
            // SAFETY: all-zero is a valid uv_pipe_t init state.
            unsafe { core::mem::zeroed::<bun_sys::windows::libuv::Pipe>() },
        )));
    }
    let cwd = VirtualMachine::get().transpiler.fs.top_level_dir;
    let spawn_options = SpawnOptions {
        stdin: stdin_opt,
        stdout: stdout_opt,
        #[cfg(windows)]
        stderr: SpawnOptions::Stdio::Buffer(this.stderr_reader().source.as_ref().unwrap().pipe()),
        #[cfg(not(windows))]
        stderr: SpawnOptions::Stdio::Ignore,
        cwd,
        argv0: resolved_argv0,
        #[cfg(windows)]
        windows: SpawnOptions::Windows {
            loop_: EventLoopHandle::init(VirtualMachine::get().event_loop()),
        },
        ..SpawnOptions::default()
    };

    // PERF(port): was arena bulk-free for envp on Windows
    #[cfg(unix)]
    let envp: *const *const c_char = {
        // SAFETY: std.c.environ is a process-global NUL-terminated array.
        unsafe extern "C" {
            static environ: *const *const c_char;
        }
        unsafe { environ }
    };
    #[cfg(windows)]
    let envp_owned;
    #[cfg(windows)]
    let envp: *const *const c_char = {
        match VirtualMachine::get()
            .transpiler
            .env
            .map
            .create_null_delimited_env_map()
        {
            Ok(v) => {
                envp_owned = v;
                envp_owned.as_ptr().cast()
            }
            Err(_) => {
                this.set_err(format_args!("Failed to create environment block"));
                return T::finish(this);
            }
        }
    };

    let spawned = match spawn::spawn_process(&spawn_options, argv.as_mut_ptr().cast(), envp) {
        Ok(maybe) => match maybe.unwrap_result() {
            Ok(s) => s,
            Err(err) => {
                this.set_err(format_args!("Failed to spawn process: {}", err.name()));
                return T::finish(this);
            }
        },
        Err(e) => {
            this.set_err(format_args!("Failed to spawn process: {}", e.name()));
            return T::finish(this);
        }
    };
    let mut spawned = spawned;

    #[cfg(unix)]
    {
        if let Some(stdout) = spawned.stdout {
            if !spawned.memfds[1] {
                this.stdout_reader().set_parent(this);
                let _ = sys::set_nonblocking(stdout);
                *this.remaining_fds() += 1;
                this.stdout_reader().flags.nonblocking = true;
                this.stdout_reader().flags.socket = true;
                this.stdout_reader().flags.memfd = false;
                this.stdout_reader().flags.received_eof = false;
                this.stdout_reader().flags.closed_without_reporting = false;
                if this.stdout_reader().start(stdout, true).unwrap_result().is_err() {
                    this.set_err(format_args!("Failed to start reading stdout"));
                    return T::finish(this);
                }
                if let Some(p) = this.stdout_reader().handle.get_poll() {
                    p.flags.insert(bun_aio::PollFlag::Socket);
                }
            } else {
                this.stdout_reader().set_parent(this);
                this.stdout_reader().start_memfd(stdout);
            }
        }
    }
    #[cfg(windows)]
    {
        if matches!(spawned.stderr, spawn::SpawnedStdio::Buffer(_)) {
            this.stderr_reader().parent = this as *mut T as *mut core::ffi::c_void;
            *this.remaining_fds() += 1;
            if this.stderr_reader().start_with_current_pipe().unwrap_result().is_err() {
                this.set_err(format_args!("Failed to start reading stderr"));
                return T::finish(this);
            }
        }
    }

    let process = spawned.to_process(VirtualMachine::get().event_loop(), false);
    *this.process_slot() = Some(Arc::clone(&process));
    process.set_exit_handler(this);
    match process.watch_or_reap() {
        bun_sys::Result::Err(err) => {
            if !process.has_exited() {
                // SAFETY: all-zero is a valid Rusage.
                let rusage = unsafe { core::mem::zeroed::<Rusage>() };
                process.on_exit(Status::Err(err), &rusage);
            }
        }
        bun_sys::Result::Ok(_) => {}
    }
}

/// Find crontab binary using bun.which (searches PATH).
fn find_crontab() -> Option<*const c_char> {
    #[cfg(windows)]
    {
        return None;
    }
    #[cfg(not(windows))]
    {
        // Zig: `const static = struct { var buf: bun.PathBuffer = undefined; };`
        // TODO(port): static mut PathBuffer is unsound under aliasing; safe here
        // because callers serialize on the JS thread.
        static mut BUF: PathBuffer = PathBuffer::ZEROED;
        let path_env = env_var::PATH.get().unwrap_or(b"/usr/bin:/bin");
        // SAFETY: single-threaded JS access.
        let buf = unsafe { &mut BUF };
        let found = bun_core::which(buf, path_env, b"", b"crontab")?;
        Some(found.as_ptr().cast())
    }
}

/// Get the current user ID portably.
fn get_uid() -> u32 {
    #[cfg(unix)]
    {
        bun_sys::c::getuid()
    }
    #[cfg(not(unix))]
    {
        0
    }
}

/// Validate title: only [a-zA-Z0-9_-], non-empty.
fn validate_title(title: &[u8]) -> bool {
    if title.is_empty() {
        return false;
    }
    for &c in title {
        if !c.is_ascii_alphanumeric() && c != b'-' && c != b'_' {
            return false;
        }
    }
    true
}

/// Filter crontab content, removing any entry with matching title marker.
fn filter_crontab(
    content: &[u8],
    title: &[u8],
    result: &mut Vec<u8>,
) -> Result<(), bun_alloc::AllocError> {
    let mut marker = Vec::new();
    let _ = write!(&mut marker, "# bun-cron: {}", bstr::BStr::new(title));
    let mut skip_next = false;
    for line in content.split(|&b| b == b'\n') {
        if skip_next {
            skip_next = false;
            continue;
        }
        if bun_str::strings::trim(line, b" \t") == marker.as_slice() {
            skip_next = true;
            continue;
        }
        if !line.is_empty() {
            result.extend_from_slice(line);
            result.push(b'\n');
        }
    }
    Ok(())
}

fn resolve_path(
    global: &JSGlobalObject,
    frame: &CallFrame,
    path_: &[u8],
) -> Result<ZString, bun_core::Error> {
    let vm = global.bun_vm();
    let srcloc = frame.get_caller_src_loc(global);
    let caller_utf8 = srcloc.str.to_utf8();
    let raw_dir = path::dirname(caller_utf8.slice(), path::Platform::Auto);
    let source_dir: &[u8] = if raw_dir.is_empty() { b"." } else { raw_dir };
    let mut resolved = vm
        .transpiler
        .resolver
        .resolve(source_dir, path_, bun_options_types::ImportKind::EntryPointRun)
        .map_err(|_| bun_core::err!("ModuleNotFound"))?;
    let entry_path = resolved.path().ok_or(bun_core::err!("ModuleNotFound"))?;
    Ok(ZString::from_bytes(entry_path.text))
}

/// XML-escape a string for safe embedding in plist XML.
fn xml_escape(input: &[u8]) -> Result<Vec<u8>, bun_alloc::AllocError> {
    let mut needs_escape = false;
    for &c in input {
        if c == b'&' || c == b'<' || c == b'>' || c == b'"' || c == b'\'' {
            needs_escape = true;
            break;
        }
    }
    if !needs_escape {
        return Ok(input.to_vec());
    }

    let mut result: Vec<u8> = Vec::new();
    for &c in input {
        match c {
            b'&' => result.extend_from_slice(b"&amp;"),
            b'<' => result.extend_from_slice(b"&lt;"),
            b'>' => result.extend_from_slice(b"&gt;"),
            b'"' => result.extend_from_slice(b"&quot;"),
            b'\'' => result.extend_from_slice(b"&apos;"),
            _ => result.push(c),
        }
    }
    Ok(result)
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, PartialEq, Eq)]
enum CalendarError {
    InvalidCron,
    OutOfMemory,
}
// TODO(port): narrow error set

impl From<CalendarError> for bun_core::Error {
    fn from(e: CalendarError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

fn cron_to_calendar_interval(schedule: &[u8]) -> Result<Vec<u8>, CalendarError> {
    let mut fields: [&[u8]; 5] = [b""; 5];
    let mut count: usize = 0;
    for field in schedule.split(|&b| b == b' ').filter(|s| !s.is_empty()) {
        if count >= 5 {
            return Err(CalendarError::InvalidCron);
        }
        fields[count] = field;
        count += 1;
    }
    if count != 5 {
        return Err(CalendarError::InvalidCron);
    }

    // Parse each field into a list of integer values (or None for "*")
    let mut field_values: [Option<Vec<i32>>; 5] = [None, None, None, None, None];
    for (field, fv) in fields.iter().zip(field_values.iter_mut()) {
        if *field == b"*" {
            continue;
        }
        let mut vals: Vec<i32> = Vec::new();
        for part in field.split(|&b| b == b',') {
            // Zig: std.fmt.parseInt(i32, part, 10) on raw []const u8. Parse bytes
            // directly — do NOT round-trip through str/from_utf8 (PORTING.md "Strings").
            if part.is_empty() {
                return Err(CalendarError::InvalidCron);
            }
            let mut val: i32 = 0;
            for &b in part {
                let digit = b.wrapping_sub(b'0');
                if digit > 9 {
                    return Err(CalendarError::InvalidCron);
                }
                val = val
                    .checked_mul(10)
                    .and_then(|v| v.checked_add(digit as i32))
                    .ok_or(CalendarError::InvalidCron)?;
            }
            vals.push(val);
        }
        *fv = Some(vals);
    }

    // Generate StartCalendarInterval dicts.
    // For wildcard fields, omit the key entirely (launchd treats missing = all).
    //
    // POSIX cron OR semantics: when BOTH day-of-month and day-of-week are non-wildcard,
    // the job fires when EITHER matches. launchd ANDs keys within a single dict, so we
    // emit two separate sets of dicts: one with Day (no Weekday) and one with Weekday
    // (no Day). launchd fires when ANY dict matches, achieving OR behavior.
    let mut result: Vec<u8> = Vec::new();

    let has_dom = field_values[2].is_some();
    let has_dow = field_values[4].is_some();
    let needs_or_split = has_dom && has_dow;

    // Determine if we need an <array> wrapper (multiple dicts or OR split)
    let needs_product = field_values
        .iter()
        .any(|fv| fv.as_ref().map_or(false, |v| v.len() > 1));
    let needs_array = needs_product || needs_or_split;

    // Borrow as slices for emit_calendar_dicts.
    let fv_slices: [Option<&[i32]>; 5] = [
        field_values[0].as_deref(),
        field_values[1].as_deref(),
        field_values[2].as_deref(),
        field_values[3].as_deref(),
        field_values[4].as_deref(),
    ];

    if !needs_array {
        // Single dict, no product needed
        const PLIST_KEYS: [&[u8]; 5] = [b"Minute", b"Hour", b"Day", b"Month", b"Weekday"];
        result.extend_from_slice(b"    <dict>\n");
        for (fv, key) in fv_slices.iter().zip(PLIST_KEYS.iter()) {
            if let Some(vals) = fv {
                if vals.len() == 1 {
                    append_calendar_key(&mut result, key, vals[0])?;
                }
            }
        }
        result.extend_from_slice(b"    </dict>");
    } else {
        result.extend_from_slice(b"    <array>\n");

        if needs_or_split {
            // OR split: emit day-of-month dicts (no Weekday), then day-of-week dicts (no Day)
            // Pass 1: Day + time fields (minute, hour, day, month — no weekday)
            emit_calendar_dicts(&mut result, fv_slices, EmitMode::ExcludeWeekday)?;
            // Pass 2: Weekday + time fields (minute, hour, weekday, month — no day)
            emit_calendar_dicts(&mut result, fv_slices, EmitMode::ExcludeDay)?;
        } else {
            // Normal Cartesian product: all fields together
            emit_calendar_dicts(&mut result, fv_slices, EmitMode::IncludeAll)?;
        }

        result.extend_from_slice(b"    </array>");
    }
    Ok(result)
}

fn append_calendar_key(result: &mut Vec<u8>, key: &[u8], val: i32) -> Result<(), CalendarError> {
    let _ = write!(
        result,
        "        <key>{}</key>\n        <integer>{}</integer>\n",
        bstr::BStr::new(key),
        val
    );
    Ok(())
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum EmitMode {
    IncludeAll,
    ExcludeWeekday,
    ExcludeDay,
}

/// Emit Cartesian-product <dict> entries for the given field values.
/// In exclude_weekday mode, day-of-week (index 4) is treated as wildcard.
/// In exclude_day mode, day-of-month (index 2) is treated as wildcard.
fn emit_calendar_dicts(
    result: &mut Vec<u8>,
    field_values: [Option<&[i32]>; 5],
    mode: EmitMode,
) -> Result<(), CalendarError> {
    const PLIST_KEYS: [&[u8]; 5] = [b"Minute", b"Hour", b"Day", b"Month", b"Weekday"];

    // Build effective field values based on mode
    let mut effective: [Option<&[i32]>; 5] = field_values;
    match mode {
        EmitMode::ExcludeWeekday => effective[4] = None,
        EmitMode::ExcludeDay => effective[2] = None,
        EmitMode::IncludeAll => {}
    }

    static ZERO: [i32; 1] = [0];
    let iter_mins: &[i32] = effective[0].unwrap_or(&ZERO);
    let iter_hrs: &[i32] = effective[1].unwrap_or(&ZERO);
    let iter_days: &[i32] = effective[2].unwrap_or(&ZERO);
    let iter_mons: &[i32] = effective[3].unwrap_or(&ZERO);
    let iter_wdays: &[i32] = effective[4].unwrap_or(&ZERO);

    for &m in iter_mins {
        for &h in iter_hrs {
            for &d in iter_days {
                for &mo in iter_mons {
                    for &w in iter_wdays {
                        result.extend_from_slice(b"    <dict>\n");
                        if effective[0].is_some() { append_calendar_key(result, PLIST_KEYS[0], m)?; }
                        if effective[1].is_some() { append_calendar_key(result, PLIST_KEYS[1], h)?; }
                        if effective[2].is_some() { append_calendar_key(result, PLIST_KEYS[2], d)?; }
                        if effective[3].is_some() { append_calendar_key(result, PLIST_KEYS[3], mo)?; }
                        if effective[4].is_some() { append_calendar_key(result, PLIST_KEYS[4], w)?; }
                        result.extend_from_slice(b"    </dict>\n");
                    }
                }
            }
        }
    }
    Ok(())
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, PartialEq, Eq)]
enum TaskXmlError {
    InvalidCron,
    TooManyTriggers,
    OutOfMemory,
}

impl From<TaskXmlError> for bun_core::Error {
    fn from(e: TaskXmlError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

/// Build a Windows Task Scheduler XML definition from a parsed cron expression.
/// Uses TimeTrigger+Repetition for simple intervals, CalendarTrigger for complex schedules.
fn cron_to_task_xml(
    cron: &CronExpression,
    bun_exe: &[u8],
    title: &[u8],
    schedule: &[u8],
    abs_path: &[u8],
) -> Result<Vec<u8>, TaskXmlError> {
    let mut xml: Vec<u8> = Vec::new();

    xml.extend_from_slice(
        b"<?xml version=\"1.0\"?>\n\
<Task version=\"1.2\" xmlns=\"http://schemas.microsoft.com/windows/2004/02/mit/task\">\n\
  <Triggers>\n",
    );

    // Use semantic checks (bitfield values) not syntax flags for wildcard detection.
    // e.g. "*/1" sets all bits just like "*" but has _is_wildcard=false.
    let days_is_wild = cron.days == cron_parser::ALL_DAYS;
    let weekdays_is_wild = cron.weekdays == cron_parser::ALL_WEEKDAYS;
    let months_is_wild = cron.months == cron_parser::ALL_MONTHS;

    // Try to use a single trigger with Repetition for simple repeating patterns.
    // This avoids the 48-trigger limit for high-frequency expressions.
    // Only valid when: (a) all days/weekdays/months are wild, AND
    // (b) the pattern is expressible as a single PT interval that doesn't drift.
    let minute_interval = compute_step_interval::<u64>(cron.minutes, 0, 59);
    let hour_interval = compute_step_interval::<u32>(cron.hours, 0, 23);
    let minutes_count: u32 = cron.minutes.count_ones();
    let hours_count: u32 = cron.hours.count_ones();

    // Case 1: All hours active, evenly-spaced minutes that divide 60
    //   e.g. "* * * * *" → PT1M, "*/5 * * * *" → PT5M, "*/15 * * * *" → PT15M
    // Case 2: Single minute, evenly-spaced hours that divide 24
    //   e.g. "0 * * * *" → PT1H, "0 */2 * * *" → PT2H, "30 */6 * * *" → PT6H
    let can_use_repetition = days_is_wild && weekdays_is_wild && months_is_wild && 'blk: {
        if hours_count == 24
            && minute_interval.is_some()
            && minute_interval.unwrap() <= 60
            && 60 % minute_interval.unwrap() == 0
            && minutes_count == 60 / minute_interval.unwrap()
        {
            break 'blk true; // Case 1
        }
        if minutes_count == 1
            && hour_interval.is_some()
            && hour_interval.unwrap() <= 24
            && 24 % hour_interval.unwrap() == 0
            && hours_count == 24 / hour_interval.unwrap()
        {
            break 'blk true; // Case 2
        }
        false
    };

    if can_use_repetition {
        let first_min: u32 = cron.minutes.trailing_zeros();
        let first_hour: u32 = cron.hours.trailing_zeros();

        let mut sb_buf = [0u8; 32];
        let sb = buf_print(
            &mut sb_buf,
            format_args!("2000-01-01T{:02}:{:02}:00", first_hour, first_min),
        )
        .map_err(|_| TaskXmlError::InvalidCron)?;

        xml.extend_from_slice(b"    <CalendarTrigger>\n");
        let _ = write!(
            &mut xml,
            "      <StartBoundary>{}</StartBoundary>\n",
            bstr::BStr::new(sb)
        );

        if hours_count == 24 {
            // Case 1: minute-based repetition
            let m = minute_interval.unwrap();
            if m == 1 {
                xml.extend_from_slice(b"      <Repetition><Interval>PT1M</Interval></Repetition>\n");
            } else {
                let _ = write!(
                    &mut xml,
                    "      <Repetition><Interval>PT{}M</Interval></Repetition>\n",
                    m
                );
            }
        } else {
            // Case 2: hour-based repetition
            let h = hour_interval.unwrap();
            if h > 1 {
                let _ = write!(
                    &mut xml,
                    "      <Repetition><Interval>PT{}H</Interval></Repetition>\n",
                    h
                );
            }
        }

        xml.extend_from_slice(b"      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n");
        xml.extend_from_slice(b"    </CalendarTrigger>\n");
    } else {
        // Complex pattern: emit CalendarTriggers for each hour×minute pair.
        // Cap at 48 triggers (Task Scheduler limit).
        let needs_or_split = !days_is_wild && !weekdays_is_wild;
        let triggers_per_time: u32 = if needs_or_split { 2 } else { 1 };
        let total_triggers = minutes_count * hours_count * triggers_per_time;
        if total_triggers > 48 {
            return Err(TaskXmlError::TooManyTriggers);
        }

        let mut hours_bits = cron.hours;
        while hours_bits != 0 {
            let h: u32 = hours_bits.trailing_zeros();
            hours_bits &= hours_bits - 1;
            let mut mins_bits = cron.minutes;
            while mins_bits != 0 {
                let m: u32 = mins_bits.trailing_zeros() as u32;
                mins_bits &= mins_bits - 1;
                let mut sb_buf = [0u8; 32];
                let sb = buf_print(
                    &mut sb_buf,
                    format_args!("2000-01-01T{:02}:{:02}:00", h, m),
                )
                .map_err(|_| TaskXmlError::InvalidCron)?;

                // Emit day-of-month trigger if needed
                if !days_is_wild {
                    append_calendar_trigger_with_schedule(
                        &mut xml,
                        sb,
                        ScheduleType::ByMonth { cron: *cron, months_is_wild },
                    )?;
                }

                // Emit day-of-week trigger if needed
                if !weekdays_is_wild {
                    if months_is_wild {
                        append_calendar_trigger_with_schedule(
                            &mut xml,
                            sb,
                            ScheduleType::ByWeek(cron.weekdays),
                        )?;
                    } else {
                        // Use ScheduleByMonthDayOfWeek to include month restrictions
                        append_calendar_trigger_with_schedule(
                            &mut xml,
                            sb,
                            ScheduleType::ByMonthDow { cron: *cron, months_is_wild },
                        )?;
                    }
                }

                // Both wildcard: every day (with optional month restriction)
                if days_is_wild && weekdays_is_wild {
                    if months_is_wild {
                        append_calendar_trigger_with_schedule(&mut xml, sb, ScheduleType::ByDay)?;
                    } else {
                        // Daily but restricted months → use ScheduleByMonth with all days
                        append_calendar_trigger_with_schedule(
                            &mut xml,
                            sb,
                            ScheduleType::ByMonthAllDays(cron.months),
                        )?;
                    }
                }
            }
        }
    }

    // Close triggers, add action
    let xml_bun = xml_escape(bun_exe).map_err(|_| TaskXmlError::OutOfMemory)?;
    let xml_title = xml_escape(title).map_err(|_| TaskXmlError::OutOfMemory)?;
    let xml_sched = xml_escape(schedule).map_err(|_| TaskXmlError::OutOfMemory)?;
    let xml_path = xml_escape(abs_path).map_err(|_| TaskXmlError::OutOfMemory)?;

    let _ = write!(
        &mut xml,
        "  </Triggers>\n\
  <Principals>\n\
    <Principal>\n\
      <LogonType>S4U</LogonType>\n\
      <RunLevel>LeastPrivilege</RunLevel>\n\
    </Principal>\n\
  </Principals>\n\
  <Settings>\n\
    <Enabled>true</Enabled>\n\
    <AllowStartOnDemand>true</AllowStartOnDemand>\n\
    <AllowHardTerminate>true</AllowHardTerminate>\n\
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>\n\
    <StartWhenAvailable>true</StartWhenAvailable>\n\
  </Settings>\n\
  <Actions>\n\
    <Exec>\n\
      <Command>{}</Command>\n\
      <Arguments>run --cron-title={} --cron-period=\"{}\" \"{}\"</Arguments>\n\
    </Exec>\n\
  </Actions>\n\
</Task>\n",
        bstr::BStr::new(&xml_bun),
        bstr::BStr::new(&xml_title),
        bstr::BStr::new(&xml_sched),
        bstr::BStr::new(&xml_path),
    );

    Ok(xml)
}

fn append_days_of_month_xml(xml: &mut Vec<u8>, days: u32) -> Result<(), TaskXmlError> {
    xml.extend_from_slice(b"        <DaysOfMonth>\n");
    for day in 1..32u32 {
        if days & (1u32 << day) != 0 {
            let _ = write!(xml, "          <Day>{}</Day>\n", day);
        }
    }
    xml.extend_from_slice(b"        </DaysOfMonth>\n");
    Ok(())
}

fn append_months_xml(xml: &mut Vec<u8>, months: u16) -> Result<(), TaskXmlError> {
    const MONTH_NAMES: [&str; 13] = [
        "", "January", "February", "March", "April", "May", "June", "July", "August",
        "September", "October", "November", "December",
    ];
    xml.extend_from_slice(b"        <Months>\n");
    for mo in 1..13usize {
        if months & (1u16 << mo) != 0 {
            let _ = write!(xml, "          <{}/>\n", MONTH_NAMES[mo]);
        }
    }
    xml.extend_from_slice(b"        </Months>\n");
    Ok(())
}

fn append_days_of_week_xml(xml: &mut Vec<u8>, weekdays: u8) -> Result<(), TaskXmlError> {
    const DAY_NAMES: [&str; 7] = [
        "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
    ];
    xml.extend_from_slice(b"        <DaysOfWeek>\n");
    for d in 0..7usize {
        if weekdays & (1u8 << d) != 0 {
            let _ = write!(xml, "          <{}/>\n", DAY_NAMES[d]);
        }
    }
    xml.extend_from_slice(b"        </DaysOfWeek>\n");
    Ok(())
}

#[derive(Clone, Copy)]
enum ScheduleType {
    ByDay,
    /// weekdays bitmask
    ByWeek(u8),
    ByMonth { cron: CronExpression, months_is_wild: bool },
    ByMonthDow { cron: CronExpression, months_is_wild: bool },
    /// months bitmask (daily with month restriction)
    ByMonthAllDays(u16),
}

fn append_calendar_trigger_with_schedule(
    xml: &mut Vec<u8>,
    start_boundary: &[u8],
    sched: ScheduleType,
) -> Result<(), TaskXmlError> {
    xml.extend_from_slice(b"    <CalendarTrigger>\n");
    let _ = write!(
        xml,
        "      <StartBoundary>{}</StartBoundary>\n",
        bstr::BStr::new(start_boundary)
    );

    match sched {
        ScheduleType::ByDay => {
            xml.extend_from_slice(
                b"      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n",
            );
        }
        ScheduleType::ByWeek(weekdays) => {
            xml.extend_from_slice(b"      <ScheduleByWeek>\n");
            xml.extend_from_slice(b"        <WeeksInterval>1</WeeksInterval>\n");
            append_days_of_week_xml(xml, weekdays)?;
            xml.extend_from_slice(b"      </ScheduleByWeek>\n");
        }
        ScheduleType::ByMonth { cron, .. } => {
            xml.extend_from_slice(b"      <ScheduleByMonth>\n");
            append_days_of_month_xml(xml, cron.days)?;
            append_months_xml(xml, cron.months)?;
            xml.extend_from_slice(b"      </ScheduleByMonth>\n");
        }
        ScheduleType::ByMonthDow { cron, .. } => {
            // ScheduleByMonthDayOfWeek: weekday + month restriction
            xml.extend_from_slice(b"      <ScheduleByMonthDayOfWeek>\n");
            xml.extend_from_slice(b"        <Weeks><Week>1</Week><Week>2</Week><Week>3</Week><Week>4</Week><Week>Last</Week></Weeks>\n");
            append_days_of_week_xml(xml, cron.weekdays)?;
            append_months_xml(xml, cron.months)?;
            xml.extend_from_slice(b"      </ScheduleByMonthDayOfWeek>\n");
        }
        ScheduleType::ByMonthAllDays(months) => {
            xml.extend_from_slice(b"      <ScheduleByMonth>\n");
            append_days_of_month_xml(xml, 0xFFFFFFFE)?;
            append_months_xml(xml, months)?;
            xml.extend_from_slice(b"      </ScheduleByMonth>\n");
        }
    }

    xml.extend_from_slice(b"    </CalendarTrigger>\n");
    Ok(())
}

/// If all set bits are evenly spaced, return the step size. Otherwise None.
fn compute_step_interval<T>(bits: T, _min: u8, max: u8) -> Option<u32>
where
    T: Copy
        + core::ops::BitAnd<Output = T>
        + core::ops::Sub<Output = T>
        + PartialEq
        + bun_core::BitOps, // TODO(port): trait providing count_ones/trailing_zeros/ZERO/ONE across uN
{
    if bits == T::ZERO {
        return None;
    }
    let count = bits.count_ones();
    if count == 1 {
        return Some(u32::from(max) + 1);
    }
    // Find first two set bits to determine step
    let mut remaining = bits;
    let first: u32 = remaining.trailing_zeros();
    remaining = remaining & (remaining - T::ONE);
    let second: u32 = remaining.trailing_zeros();
    let step = second - first;
    // Verify all bits are evenly spaced
    remaining = remaining & (remaining - T::ONE);
    let mut prev = second;
    while remaining != T::ZERO {
        let next: u32 = remaining.trailing_zeros();
        if next - prev != step {
            return None;
        }
        prev = next;
        remaining = remaining & (remaining - T::ONE);
    }
    Some(step)
}

fn alloc_print_z(args: core::fmt::Arguments<'_>) -> Result<ZString, bun_alloc::AllocError> {
    let mut v = Vec::new();
    v.write_fmt(args).map_err(|_| bun_alloc::AllocError)?;
    Ok(ZString::from_vec(v))
}

/// `std.fmt.bufPrint` equivalent: write into `buf`, return the written slice.
fn buf_print<'a>(buf: &'a mut [u8], args: core::fmt::Arguments<'_>) -> Result<&'a [u8], core::fmt::Error> {
    let mut cursor: &mut [u8] = buf;
    let total = cursor.len();
    cursor.write_fmt(args).map_err(|_| core::fmt::Error)?;
    let remaining = cursor.len();
    let written = total - remaining;
    // SAFETY: `written` bytes at the start of `buf` were just initialized.
    Ok(unsafe { core::slice::from_raw_parts(buf.as_ptr(), written) })
}

/// Create a temp file path with a random suffix to avoid TOCTOU/symlink attacks.
fn make_temp_path(prefix: &'static str) -> Result<ZString, bun_alloc::AllocError> {
    let mut name_buf = PathBuffer::uninit();
    // PORT NOTE: Zig used `prefix ++ "tmp"` at comptime; concat at runtime here.
    // TODO(port): use const_format::concatcp! once call sites pass a const.
    let mut full_prefix = Vec::with_capacity(prefix.len() + 3);
    full_prefix.extend_from_slice(prefix.as_bytes());
    full_prefix.extend_from_slice(b"tmp");
    let name = bun_fs::FileSystem::tmpname(&full_prefix, &mut name_buf, bun_core::fast_random())
        .map_err(|_| bun_alloc::AllocError)?;
    let joined = path::join_abs_string(
        bun_fs::FileSystem::RealFS::platform_temp_dir(),
        &[name],
        path::Platform::Auto,
    );
    Ok(ZString::from_bytes(joined))
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/cron.zig (1772 lines)
//   confidence: medium
//   todos:      9
//   notes:      finish() consumes Box<Self> via raw ptr (Zig destroyed self mid-method); SpawnCmdTarget trait abstracts the comptime mixin; ZString assumed as owned [:0]u8; rare_data.cron_jobs assumed Vec<*mut CronJob> with interior mutability in Phase B; calendar/task-xml error enums now impl From<_> for bun_core::Error; cron_to_calendar_interval parses ints from raw bytes (no from_utf8).
// ──────────────────────────────────────────────────────────────────────────
