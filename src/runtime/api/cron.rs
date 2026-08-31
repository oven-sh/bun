//! Bun.cron - in-process and OS-level cron scheduling.
//!
//! Bun.cron(schedule, handler)       - run a callback on a schedule (returns CronJob)
//! Bun.cron(path, schedule, title)   - register an OS-level job (returns Promise)
//! Bun.cron.remove(title)            - remove an OS-level job (returns Promise)
//! Bun.cron.parse(expr, from?)       - next-occurrence calculator (returns Date | null)
//!
//! OS-level uses crontab (Linux), launchctl + launchd plist (macOS), or
//! schtasks (Windows). Async, event-loop-integrated via bun.spawn.

use std::io::Write as _;

#[cfg(windows)]
use super::cron_parser;
use super::cron_parser::{CronExpression, CronTz};

use core::ffi::CStr;
use std::cell::Cell;

use bun_core::EncodedSlice;
#[cfg(not(windows))]
use bun_core::env_var;
use bun_io::BufferedReader as OutputReader;
use bun_io::{KeepAlive, Loop as AsyncLoop};
use bun_jsc::virtual_machine::{HotReload, VirtualMachine};
use bun_jsc::{
    self as jsc, CallFrame, EncodedSliceJsc as _, EventLoopHandle, GlobalRef, JSFunction,
    JSGlobalObject, JSObject, JSValue, JsCell, JsRef, JsResult,
};
#[cfg(not(target_os = "macos"))]
use bun_paths::PathBuffer;
use bun_paths::{self as path};
use bun_ptr::{BackRef, RefPtr, ThisPtr};
use bun_resolver::fs::FileSystem;
#[cfg(not(target_os = "macos"))]
use bun_resolver::fs::RealFS;

#[cfg(not(windows))]
use crate::api::bun::process::SpawnResultExt as _;
use crate::api::bun::process::{
    self as spawn, Process, ProcessHandle, Rusage, SpawnOptions, Status,
};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use bun_core::ZStr;
use bun_core::strings;
use bun_io::pipe_reader::BufferedReaderParent;
#[cfg(target_os = "macos")]
use bun_sys::FdDirExt as _;
// Owned NUL-terminated string — `bun_str` exposes the
// borrowed `ZStr` only; the heap-backed counterpart is `bun_core::ZBox`.
use bun_core::ZBox as ZString;
use bun_sys::{self as sys, Fd, File};

// ─── local shims (upstream-crate gaps; see PORTING.md §extension traits) ────

/// Recover `&mut VirtualMachine` from the per-thread singleton.
///
/// Safe: delegates to [`VirtualMachine::as_mut`], which already encapsulates
/// the single-JS-thread thread-local deref (provenance from `get_mut_ptr()`).
#[inline]
fn vm_mut<'a>() -> &'a mut VirtualMachine {
    VirtualMachine::get_mut()
}

use crate::jsc_hooks::timer_all_mut as timer_all;

// ============================================================================
// CronJobBase — shared base for CronRegisterJob and CronRemoveJob
// ============================================================================

/// Shared base for [`CronRegisterJob`] and [`CronRemoveJob`].
// Note: `finish()` releases the job's single owning ref (freeing `this`), so
// every method on the path to it takes a `ThisPtr<Self>` receiver (never
// `&mut self`, whose Stacked Borrows FnEntry protector would make the
// in-flight dealloc UB) and touches nothing after the call that may free
// `this`. Mutable state lives in `Cell`/`JsCell` fields so every access is a
// short shared borrow.
trait CronJobBase: Sized + bun_ptr::AnyRefCounted {
    /// The single owning ref; released by `finish`.
    fn owner(&self) -> &Cell<Option<RefPtr<Self>>>;
    fn promise(&self) -> &JsCell<jsc::JSPromiseStrong>;
    fn global(&self) -> GlobalRef;
    fn poll(&self) -> &JsCell<KeepAlive>;
    fn remaining_fds(&self) -> &Cell<i8>;
    fn err_msg(&self) -> &JsCell<Option<Vec<u8>>>;
    fn has_called_process_exit(&self) -> &Cell<bool>;
    fn exit_status(&self) -> &JsCell<Option<Status>>;

    type State: Copy;
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    const READING_CRONTAB: Self::State;
    #[cfg(target_os = "macos")]
    const BOOTING_OUT: Self::State;
    #[cfg(not(windows))]
    fn set_state(&self, state: Self::State);
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    fn stdout_reader_slot(&self) -> &JsCell<OutputReader>;
    #[cfg(target_os = "macos")]
    fn title_bytes(&self) -> &[u8];

    #[cfg(all(not(target_os = "macos"), not(windows)))]
    fn prepare_list_crontab(&self, this_ptr: *mut core::ffi::c_void) -> Option<ZString>
    where
        Self: BufferedReaderParent,
    {
        self.set_state(Self::READING_CRONTAB);
        self.stdout_reader_slot().with_mut(|r| {
            *r = OutputReader::init::<Self>();
            r.set_parent(this_ptr);
        });
        let crontab_path = find_crontab();
        if crontab_path.is_none() {
            self.set_err(format_args!("crontab not found in PATH"));
        }
        crontab_path
    }

    #[cfg(target_os = "macos")]
    fn prepare_bootout(&self) -> Result<ZString, ()> {
        self.set_state(Self::BOOTING_OUT);
        alloc_print_z(format_args!(
            "gui/{}/bun.cron.{}",
            get_uid(),
            bstr::BStr::new(self.title_bytes())
        ))
        .map_err(|_| self.set_err(format_args!("Out of memory")))
    }

    fn check_finished(&self) -> JobAction;
    /// May free `this`.
    fn advance_state(this: ThisPtr<Self>);

    /// Settles the promise and releases the owning ref, freeing `this`; the
    /// job's `Drop` (process detach, reader teardown) runs inside the
    /// enter/exit scope. Callers return without touching `this` again.
    fn finish(this: ThisPtr<Self>) {
        let owner = this.owner().take().expect("cron job finished twice");
        this.poll().with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        let global = this.global();
        let ev = VirtualMachine::get().event_loop_mut();
        ev.enter();
        if let Some(msg) = this.err_msg().replace(None) {
            let err = EncodedSlice::utf8(&msg).to_error_instance(&global);
            let _ = this
                .promise()
                .with_mut(|p| p.reject_with_async_stack(&global, Ok(err)));
        } else {
            let _ = this
                .promise()
                .with_mut(|p| p.resolve(&global, JSValue::UNDEFINED));
        }
        drop(owner);
        ev.exit();
    }

    fn set_err(&self, args: core::fmt::Arguments<'_>) {
        if self.err_msg().get().is_none() {
            let mut msg = Vec::new();
            let _ = msg.write_fmt(args);
            self.err_msg().set(Some(msg));
        }
    }

    /// May free `this`.
    fn maybe_finished(this: ThisPtr<Self>) {
        match this.check_finished() {
            JobAction::Pending => {}
            JobAction::Finish => Self::finish(this),
            JobAction::Advance => Self::advance_state(this),
        }
    }

    fn loop_(&self) -> *mut AsyncLoop {
        // `VirtualMachine::uv_loop` already returns the native loop on both
        // targets (jsc/VirtualMachine.rs:2975); the prior POSIX arm's
        // `bun_uws::Loop::get()` named the same per-thread singleton.
        vm_mut().uv_loop()
    }

    fn note_reader_done(&self) {
        debug_assert!(self.remaining_fds().get() > 0);
        self.remaining_fds().set(self.remaining_fds().get() - 1);
    }

    fn note_reader_error(&self, err: sys::Error) {
        self.note_reader_done();
        if self.err_msg().get().is_none() {
            let mut msg = Vec::new();
            let _ = write!(
                &mut msg,
                "Failed to read process output: {}",
                bstr::BStr::new(err.name())
            );
            self.err_msg().set(Some(msg));
        }
    }

    /// May free `this` via `maybe_finished`.
    fn on_reader_done(this: ThisPtr<Self>) {
        this.note_reader_done();
        Self::maybe_finished(this);
    }

    /// May free `this` via `maybe_finished`.
    fn on_reader_error(this: ThisPtr<Self>, err: sys::Error) {
        this.note_reader_error(err);
        Self::maybe_finished(this);
    }

    /// May free `this` via `maybe_finished`.
    fn on_process_exit(this: ThisPtr<Self>, _proc: &Process, status: Status, _rusage: &Rusage) {
        this.has_called_process_exit().set(true);
        this.exit_status().set(Some(status));
        Self::maybe_finished(this);
    }
}

enum JobAction {
    Pending,
    Finish,
    Advance,
}

// ============================================================================
// CronRegisterJob
// ============================================================================

#[derive(bun_ptr::CellRefCounted)]
struct CronRegisterJob {
    ref_count: Cell<u32>,
    /// The single owning ref; released by `finish`.
    owner: Cell<Option<RefPtr<CronRegisterJob>>>,
    promise: JsCell<jsc::JSPromiseStrong>,
    // LIFETIMES.tsv: JSC_BORROW → GlobalRef
    global: GlobalRef,
    poll: JsCell<KeepAlive>,

    bun_exe: &'static ZStr,
    abs_path: ZString,
    /// normalized numeric form for crontab/launchd
    schedule: ZString,
    title: ZString,
    #[cfg(windows)]
    parsed_cron: CronExpression,

    state: Cell<RegisterState>,
    process: JsCell<Option<ProcessHandle>>,
    stdout_reader: JsCell<OutputReader>,
    #[cfg(windows)]
    stderr_reader: JsCell<OutputReader>,
    remaining_fds: Cell<i8>,
    has_called_process_exit: Cell<bool>,
    exit_status: JsCell<Option<Status>>,
    err_msg: JsCell<Option<Vec<u8>>>,
    tmp_path: JsCell<Option<ZString>>,
    /// Typed enum for the io-layer FilePoll vtable (`bun_io::EventLoopHandle`
    /// wraps `*const EventLoopHandle`).
    event_loop_handle: EventLoopHandle,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum RegisterState {
    ReadingCrontab,
    #[cfg(not(target_os = "macos"))]
    InstallingCrontab,
    #[cfg(target_os = "macos")]
    WritingPlist,
    BootingOut,
    #[cfg(target_os = "macos")]
    Bootstrapping,
}

// `maybe_finished` (via `CronJobBase`) may free `this`.
bun_io::impl_buffered_reader_parent! {
    CronRegister for CronRegisterJob;
    has_on_read_chunk = false;
    // SAFETY: `this` is the live heap job registered via `set_parent`.
    on_reader_done  = |this| <Self as CronJobBase>::on_reader_done(ThisPtr::new(this));
    // SAFETY: `this` is the live heap job registered via `set_parent`.
    on_reader_error = |this, err| <Self as CronJobBase>::on_reader_error(ThisPtr::new(this), err);
    loop_           = |this| <Self as CronJobBase>::loop_(&*this).cast();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}

impl CronJobBase for CronRegisterJob {
    type State = RegisterState;
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    const READING_CRONTAB: RegisterState = RegisterState::ReadingCrontab;
    #[cfg(target_os = "macos")]
    const BOOTING_OUT: RegisterState = RegisterState::BootingOut;
    #[cfg(not(windows))]
    fn set_state(&self, state: RegisterState) {
        self.state.set(state);
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    fn stdout_reader_slot(&self) -> &JsCell<OutputReader> {
        &self.stdout_reader
    }
    #[cfg(target_os = "macos")]
    fn title_bytes(&self) -> &[u8] {
        self.title.as_bytes()
    }
    fn owner(&self) -> &Cell<Option<RefPtr<Self>>> {
        &self.owner
    }
    fn promise(&self) -> &JsCell<jsc::JSPromiseStrong> {
        &self.promise
    }
    fn global(&self) -> GlobalRef {
        self.global
    }
    fn poll(&self) -> &JsCell<KeepAlive> {
        &self.poll
    }
    fn remaining_fds(&self) -> &Cell<i8> {
        &self.remaining_fds
    }
    fn err_msg(&self) -> &JsCell<Option<Vec<u8>>> {
        &self.err_msg
    }
    fn has_called_process_exit(&self) -> &Cell<bool> {
        &self.has_called_process_exit
    }
    fn exit_status(&self) -> &JsCell<Option<Status>> {
        &self.exit_status
    }

    fn check_finished(&self) -> JobAction {
        if !self.has_called_process_exit.get() || self.remaining_fds.get() != 0 {
            return JobAction::Pending;
        }
        self.process.set(None);
        if self.err_msg.get().is_some() {
            return JobAction::Finish;
        }
        let Some(status) = self.exit_status.replace(None) else {
            return JobAction::Pending;
        };
        let state = self.state.get();
        match status {
            Status::Exited(exited) => {
                if exited.code != 0
                    && !(state == RegisterState::ReadingCrontab && exited.code == 1)
                    && state != RegisterState::BootingOut
                {
                    // Materialize the trimmed stderr into an owned buffer so
                    // no borrow of the reader outlives this statement
                    // (Windows only; POSIX ignores stderr here).
                    #[cfg(windows)]
                    let stderr_owned: Vec<u8> = self.stderr_reader.with_mut(|r| {
                        bun_core::strings::trim(r.final_buffer().as_slice(), &ASCII_WHITESPACE)
                            .to_vec()
                    });
                    #[cfg(windows)]
                    let stderr_output: &[u8] = stderr_owned.as_slice();
                    #[cfg(not(windows))]
                    let stderr_output: &[u8] = b"";
                    // On Windows, detect the SID resolution error and provide
                    // a clear message instead of the raw schtasks output.
                    #[cfg(windows)]
                    {
                        if state == RegisterState::InstallingCrontab
                            && bun_core::index_of(
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
                            return JobAction::Finish;
                        }
                    }
                    if !stderr_output.is_empty() {
                        self.set_err(format_args!("{}", bstr::BStr::new(stderr_output)));
                    } else {
                        self.set_err(format_args!("Process exited with code {}", exited.code));
                    }
                    return JobAction::Finish;
                }
            }
            Status::Signaled(sig) => {
                if state != RegisterState::BootingOut {
                    self.set_err(format_args!("Process killed by signal {}", sig as i32));
                    return JobAction::Finish;
                }
            }
            Status::Err(err) => {
                self.set_err(format_args!(
                    "Process error: {}",
                    bstr::BStr::new(err.name())
                ));
                return JobAction::Finish;
            }
            Status::Running => return JobAction::Pending,
        }
        JobAction::Advance
    }

    /// May free `this`; see [`CronJobBase`] note.
    fn advance_state(this: ThisPtr<Self>) {
        let state = this.state.get();
        #[cfg(target_os = "macos")]
        {
            match state {
                RegisterState::WritingPlist => Self::spawn_bootout(this),
                RegisterState::BootingOut => Self::spawn_bootstrap(this),
                RegisterState::Bootstrapping => Self::finish(this),
                _ => {
                    this.set_err(format_args!("Unexpected state"));
                    Self::finish(this);
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            match state {
                RegisterState::ReadingCrontab => Self::process_crontab_and_install(this),
                RegisterState::InstallingCrontab => Self::finish(this),
                _ => {
                    this.set_err(format_args!("Unexpected state"));
                    Self::finish(this);
                }
            }
        }
    }
}

impl CronRegisterJob {
    /// May free `this` (via spawn → synchronous exit → finish, or error path).
    fn spawn_cmd(
        this: ThisPtr<Self>,
        argv: &[&CStr],
        stdin_opt: spawn::Stdio,
        stdout_opt: spawn::Stdio,
    ) {
        spawn_cmd_generic(this, argv, stdin_opt, stdout_opt);
    }

    // -- Linux --

    /// May free `this`; see [`CronJobBase`] note.
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    fn start_linux(this: ThisPtr<Self>) {
        let Some(crontab_path) = this.prepare_list_crontab(this.as_ptr().cast()) else {
            return Self::finish(this);
        };
        let argv = [crontab_path.as_cstr(), c"-l"];
        Self::spawn_cmd(this, &argv, spawn::Stdio::Ignore, spawn::Stdio::Buffer);
    }

    /// May free `this`; see [`CronJobBase`] note.
    #[cfg(not(target_os = "macos"))]
    fn process_crontab_and_install(this: ThisPtr<Self>) {
        let Ok((crontab_path, tmp_path)) = this.prepare_install_crontab() else {
            return Self::finish(this);
        };
        let argv = [crontab_path.as_cstr(), tmp_path.as_cstr()];
        Self::spawn_cmd(this, &argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore);
    }

    #[cfg(not(target_os = "macos"))]
    fn prepare_install_crontab(&self) -> Result<(ZString, ZString), ()> {
        let mut result: Vec<u8> = Vec::new();
        let filtered = self.stdout_reader.with_mut(|r| {
            filter_crontab(
                r.final_buffer().as_slice(),
                self.title.as_bytes(),
                &mut result,
            )
        });

        if filtered.is_err() {
            self.set_err(format_args!("Out of memory building crontab"));
            return Err(());
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
            return Err(());
        }
        result.extend_from_slice(&new_entry);

        let tmp_path = match make_temp_path("bun-cron-") {
            Ok(p) => p,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Err(());
            }
        };
        self.tmp_path
            .set(Some(ZString::from_bytes(tmp_path.as_bytes())));

        let file = match File::openat(
            Fd::cwd(),
            self.tmp_path.get().as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
            0o600,
        ) {
            Ok(f) => f,
            Err(_) => {
                self.set_err(format_args!("Failed to create temp file"));
                return Err(());
            }
        };
        if file.write_all(&result).is_err() {
            let _ = file.close(); // close error is non-actionable
            self.set_err(format_args!("Failed to write temp file"));
            return Err(());
        }
        let _ = file.close(); // close error is non-actionable

        self.state.set(RegisterState::InstallingCrontab);
        self.stdout_reader
            .set(OutputReader::init::<CronRegisterJob>());
        let Some(crontab_path) = find_crontab() else {
            self.set_err(format_args!("crontab not found in PATH"));
            return Err(());
        };
        Ok((crontab_path, tmp_path))
    }

    // -- macOS --

    /// May free `this`; see [`CronJobBase`] note.
    #[cfg(target_os = "macos")]
    fn start_mac(this: ThisPtr<Self>) {
        if this.prepare_plist().is_err() {
            return Self::finish(this);
        }
        Self::spawn_bootout(this);
    }

    #[cfg(target_os = "macos")]
    fn prepare_plist(&self) -> Result<(), ()> {
        self.state.set(RegisterState::WritingPlist);

        let calendar_xml = match cron_to_calendar_interval(self.schedule.as_bytes()) {
            Ok(x) => x,
            Err(_) => {
                self.set_err(format_args!("Invalid cron expression"));
                return Err(());
            }
        };

        let Some(home) = env_var::HOME.get() else {
            self.set_err(format_args!("HOME environment variable not set"));
            return Err(());
        };

        let mut launch_agents_dir = Vec::new();
        let _ = write!(
            &mut launch_agents_dir,
            "{}/Library/LaunchAgents",
            bstr::BStr::new(home)
        );
        if Fd::cwd().make_path(&launch_agents_dir).is_err() {
            self.set_err(format_args!(
                "Failed to create ~/Library/LaunchAgents directory"
            ));
            return Err(());
        }

        let plist_path = match alloc_print_z(format_args!(
            "{}/Library/LaunchAgents/bun.cron.{}.plist",
            bstr::BStr::new(home),
            bstr::BStr::new(self.title.as_bytes())
        )) {
            Ok(p) => p,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Err(());
            }
        };
        self.tmp_path.set(Some(plist_path));

        // XML-escape all dynamic values
        macro_rules! try_escape {
            ($e:expr) => {
                match xml_escape($e) {
                    Ok(v) => v,
                    Err(_) => {
                        self.set_err(format_args!("Out of memory"));
                        return Err(());
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
            return Err(());
        }

        let file = match File::openat(
            Fd::cwd(),
            self.tmp_path.get().as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
            0o644,
        ) {
            Ok(f) => f,
            Err(_) => {
                self.set_err(format_args!("Failed to create plist file"));
                return Err(());
            }
        };
        if file.write_all(&plist).is_err() {
            let _ = file.close(); // close error is non-actionable
            self.set_err(format_args!("Failed to write plist"));
            return Err(());
        }
        let _ = file.close(); // close error is non-actionable
        Ok(())
    }

    /// May free `this`; see [`CronJobBase`] note.
    #[cfg(target_os = "macos")]
    fn spawn_bootout(this: ThisPtr<Self>) {
        let Ok(uid_str) = this.prepare_bootout() else {
            return Self::finish(this);
        };
        let argv = [c"/bin/launchctl", c"bootout", uid_str.as_cstr()];
        Self::spawn_cmd(this, &argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore);
    }

    /// May free `this`; see [`CronJobBase`] note.
    #[cfg(target_os = "macos")]
    fn spawn_bootstrap(this: ThisPtr<Self>) {
        let Ok((uid_str, plist_path)) = this.prepare_bootstrap() else {
            return Self::finish(this);
        };
        let argv = [
            c"/bin/launchctl",
            c"bootstrap",
            uid_str.as_cstr(),
            plist_path.as_cstr(),
        ];
        Self::spawn_cmd(this, &argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore);
    }

    #[cfg(target_os = "macos")]
    fn prepare_bootstrap(&self) -> Result<(ZString, ZString), ()> {
        self.state.set(RegisterState::Bootstrapping);
        let Some(plist_path) = self.tmp_path.replace(None) else {
            self.set_err(format_args!("No plist path"));
            return Err(());
        };
        let uid_str = match alloc_print_z(format_args!("gui/{}", get_uid())) {
            Ok(v) => v,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Err(());
            }
        };
        Ok((uid_str, plist_path))
    }
}

/// Resolve the `{ tz?: string }` option to a `CronTz`.
fn resolve_cron_tz(global: &JSGlobalObject, opts: JSValue) -> JsResult<CronTz> {
    if opts.is_empty() || opts.is_undefined_or_null() {
        return Ok(CronTz::Local);
    }
    if !opts.is_object() {
        return Err(
            global.throw_invalid_arguments(format_args!("Bun.cron: options must be an object"))
        );
    }
    let Some(tz_val) = opts.get(global, "tz")? else {
        return Ok(CronTz::Local);
    };
    if tz_val.is_undefined_or_null() {
        return Ok(CronTz::Local);
    }
    if !tz_val.is_string() {
        return Err(
            global.throw_invalid_arguments(format_args!("Bun.cron: options.tz must be a string"))
        );
    }
    let tz_str = tz_val.to_bun_string(global)?;
    let tz_slice = tz_str.to_utf8();
    let tz_bytes = tz_slice.slice();
    // IANA names are ASCII; rejecting here keeps the Latin-1 StringView cast in
    // Bun__resolveTimeZoneID sound for non-ASCII UTF-8 input.
    if tz_bytes.is_ascii()
        && let Some(id) = JSGlobalObject::resolve_time_zone_id(tz_bytes)
    {
        return Ok(CronTz::Named(id));
    }
    Err(global.throw_invalid_arguments(format_args!(
        "Bun.cron: unknown time zone '{}'",
        bstr::BStr::new(tz_bytes)
    )))
}

// -- JS entry point -- (free fn: `#[host_fn]` Free shim calls bare `cron_register(..)`)

#[bun_jsc::host_fn]
pub(crate) fn cron_register(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<3>();

    // In-process callback cron: Bun.cron(schedule, handler, opts?)
    if args[1].is_callable() {
        let tz = resolve_cron_tz(global, args[2])?;
        return CronJob::register(global, args[0], args[1], tz);
    }
    if args[0].is_string() && args[2].is_undefined() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.cron(schedule, handler) expects a function handler as the second argument"
        )));
    }

    if !args[0].is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.cron() expects a string path as the first argument"
        )));
    }
    if !args[1].is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.cron() expects a string schedule as the second argument"
        )));
    }
    if !args[2].is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.cron() expects a string title as the third argument"
        )));
    }

    let path_str = args[0].to_bun_string(global)?;
    let schedule_str = args[1].to_bun_string(global)?;
    let title_str = args[2].to_bun_string(global)?;

    let path_slice = path_str.to_utf8();
    let schedule_slice = schedule_str.to_utf8();
    let title_slice = title_str.to_utf8();

    // Validate title: only [a-zA-Z0-9_-]
    if !validate_title(title_slice.slice()) {
        return Err(global.throw_invalid_arguments(format_args!(
            "Cron title must contain only alphanumeric characters, hyphens, and underscores"
        )));
    }

    // Parse and normalize cron schedule to numeric form for crontab/launchd/schtasks
    let parsed = match CronExpression::parse(schedule_slice.slice()) {
        Ok(p) => p,
        Err(e) => {
            return Err(global.throw_invalid_arguments(format_args!(
                "{}",
                bstr::BStr::new(CronExpression::error_message(e))
            )));
        }
    };
    let mut fmt_buf = [0u8; 512];
    let normalized_schedule = parsed.format_numeric(&mut fmt_buf);

    let abs_path = match resolve_path(global, frame, path_slice.slice()) {
        Ok(p) => p,
        Err(_) => {
            return Err(global.throw_invalid_arguments(format_args!("Failed to resolve path")));
        }
    };

    // Validate path has no single quotes (shell escaping in crontab) or
    // percent signs (cron interprets % as newline before the shell sees it)
    for &c in abs_path.as_bytes() {
        if c == b'\'' {
            return Err(
                global.throw_invalid_arguments(format_args!("Path must not contain single quotes"))
            );
        }
        if c == b'%' {
            return Err(global.throw_invalid_arguments(format_args!(
                "Path must not contain percent signs (cron interprets % as newline)"
            )));
        }
        if c == b'\n' || c == b'\r' {
            return Err(
                global.throw_invalid_arguments(format_args!("Path must not contain line breaks"))
            );
        }
    }

    let bun_exe = match bun_core::self_exe_path() {
        Ok(p) => p,
        Err(_) => {
            return Err(global.throw(format_args!("Failed to get bun executable path")));
        }
    };
    if bun_core::strings::index_of_any(bun_exe.as_bytes(), b"'%").is_some() {
        return Err(global.throw_invalid_arguments(format_args!(
                "Bun executable path '{}' contains characters (' or %) that cannot be safely embedded in a crontab entry",
                bstr::BStr::new(bun_exe.as_bytes())
            )));
    }
    let job = RefPtr::new(CronRegisterJob {
        ref_count: Cell::new(1),
        owner: Cell::new(None),
        promise: JsCell::new(jsc::JSPromiseStrong::init(global)),
        global: GlobalRef::from(global),
        poll: JsCell::new(KeepAlive::default()),
        bun_exe,
        abs_path,
        schedule: ZString::from_bytes(normalized_schedule),
        title: ZString::from_bytes(title_slice.slice()),
        #[cfg(windows)]
        parsed_cron: parsed,
        state: Cell::new(RegisterState::ReadingCrontab),
        process: JsCell::new(None),
        stdout_reader: JsCell::new(OutputReader::init::<CronRegisterJob>()),
        #[cfg(windows)]
        stderr_reader: JsCell::new(OutputReader::init::<CronRegisterJob>()),
        remaining_fds: Cell::new(0),
        has_called_process_exit: Cell::new(false),
        exit_status: JsCell::new(None),
        err_msg: JsCell::new(None),
        tmp_path: JsCell::new(None),
        event_loop_handle: EventLoopHandle::init(vm_mut().event_loop().cast::<()>()),
    });
    job.poll.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
    let promise_value = job.promise.get().value();
    let this = job.this_ptr();
    this.owner.set(Some(job));
    let job = this;

    #[cfg(target_os = "macos")]
    CronRegisterJob::start_mac(job);
    #[cfg(windows)]
    CronRegisterJob::start_windows(job);
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    CronRegisterJob::start_linux(job);

    Ok(promise_value)
}

#[cfg(windows)]
impl CronRegisterJob {
    // -- Windows --

    /// May free `this`; see [`CronJobBase`] note.
    fn start_windows(this: ThisPtr<Self>) {
        let Ok((task_name, xml_path)) = this.prepare_schtasks_create() else {
            return Self::finish(this);
        };
        let argv = [
            c"schtasks",
            c"/create",
            c"/xml",
            xml_path.as_cstr(),
            c"/tn",
            task_name.as_cstr(),
            c"/np",
            c"/f",
        ];
        Self::spawn_cmd(this, &argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore);
    }

    fn prepare_schtasks_create(&self) -> Result<(ZString, ZString), ()> {
        self.state.set(RegisterState::InstallingCrontab);

        let task_name = match alloc_print_z(format_args!(
            "bun-cron-{}",
            bstr::BStr::new(self.title.as_bytes())
        )) {
            Ok(v) => v,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Err(());
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
                return Err(());
            }
        };

        let xml_path = match make_temp_path("bun-cron-xml-") {
            Ok(p) => p,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Err(());
            }
        };
        self.tmp_path
            .set(Some(ZString::from_bytes(xml_path.as_bytes())));

        let file = match File::openat(
            Fd::cwd(),
            self.tmp_path.get().as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
            0o600,
        ) {
            Ok(f) => f,
            Err(_) => {
                self.set_err(format_args!("Failed to create temp XML file"));
                return Err(());
            }
        };
        if file.write_all(&xml).is_err() {
            let _ = file.close(); // close error is non-actionable
            self.set_err(format_args!("Failed to write temp XML file"));
            return Err(());
        }
        let _ = file.close(); // close error is non-actionable

        Ok((task_name, xml_path))
    }
}

impl Drop for CronRegisterJob {
    fn drop(&mut self) {
        if let Some(p) = self.tmp_path.replace(None) {
            let _ = sys::unlink(&p);
        }
    }
}

#[cfg(windows)]
const ASCII_WHITESPACE: [u8; 6] = *b" \t\n\r\x0b\x0c";

// ============================================================================
// CronRemoveJob
// ============================================================================

#[derive(bun_ptr::CellRefCounted)]
struct CronRemoveJob {
    ref_count: Cell<u32>,
    /// The single owning ref; released by `finish`.
    owner: Cell<Option<RefPtr<CronRemoveJob>>>,
    promise: JsCell<jsc::JSPromiseStrong>,
    // LIFETIMES.tsv: JSC_BORROW → GlobalRef
    global: GlobalRef,
    poll: JsCell<KeepAlive>,
    title: ZString,

    state: Cell<RemoveState>,
    process: JsCell<Option<ProcessHandle>>,
    stdout_reader: JsCell<OutputReader>,
    #[cfg(windows)]
    stderr_reader: JsCell<OutputReader>,
    remaining_fds: Cell<i8>,
    has_called_process_exit: Cell<bool>,
    exit_status: JsCell<Option<Status>>,
    err_msg: JsCell<Option<Vec<u8>>>,
    tmp_path: JsCell<Option<ZString>>,
    /// Typed enum for the io-layer FilePoll vtable (`bun_io::EventLoopHandle`
    /// wraps `*const EventLoopHandle`).
    event_loop_handle: EventLoopHandle,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum RemoveState {
    ReadingCrontab,
    InstallingCrontab,
    BootingOut,
}

// `maybe_finished` (via `CronJobBase`) may free `this`.
bun_io::impl_buffered_reader_parent! {
    CronRemove for CronRemoveJob;
    has_on_read_chunk = false;
    // SAFETY: `this` is the live heap job registered via `set_parent`.
    on_reader_done  = |this| <Self as CronJobBase>::on_reader_done(ThisPtr::new(this));
    // SAFETY: `this` is the live heap job registered via `set_parent`.
    on_reader_error = |this, err| <Self as CronJobBase>::on_reader_error(ThisPtr::new(this), err);
    loop_           = |this| <Self as CronJobBase>::loop_(&*this).cast();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}

impl CronJobBase for CronRemoveJob {
    type State = RemoveState;
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    const READING_CRONTAB: RemoveState = RemoveState::ReadingCrontab;
    #[cfg(target_os = "macos")]
    const BOOTING_OUT: RemoveState = RemoveState::BootingOut;
    #[cfg(not(windows))]
    fn set_state(&self, state: RemoveState) {
        self.state.set(state);
    }
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    fn stdout_reader_slot(&self) -> &JsCell<OutputReader> {
        &self.stdout_reader
    }
    #[cfg(target_os = "macos")]
    fn title_bytes(&self) -> &[u8] {
        self.title.as_bytes()
    }
    fn owner(&self) -> &Cell<Option<RefPtr<Self>>> {
        &self.owner
    }
    fn promise(&self) -> &JsCell<jsc::JSPromiseStrong> {
        &self.promise
    }
    fn global(&self) -> GlobalRef {
        self.global
    }
    fn poll(&self) -> &JsCell<KeepAlive> {
        &self.poll
    }
    fn remaining_fds(&self) -> &Cell<i8> {
        &self.remaining_fds
    }
    fn err_msg(&self) -> &JsCell<Option<Vec<u8>>> {
        &self.err_msg
    }
    fn has_called_process_exit(&self) -> &Cell<bool> {
        &self.has_called_process_exit
    }
    fn exit_status(&self) -> &JsCell<Option<Status>> {
        &self.exit_status
    }

    fn check_finished(&self) -> JobAction {
        if !self.has_called_process_exit.get() || self.remaining_fds.get() != 0 {
            return JobAction::Pending;
        }
        self.process.set(None);
        if self.err_msg.get().is_some() {
            return JobAction::Finish;
        }
        let Some(status) = self.exit_status.replace(None) else {
            return JobAction::Pending;
        };
        let state = self.state.get();
        match status {
            Status::Exited(exited) => {
                let is_acceptable_nonzero = (state == RemoveState::ReadingCrontab
                    && exited.code == 1)
                    || state == RemoveState::BootingOut
                    // On Windows, schtasks /delete exits non-zero when the task doesn't exist;
                    // removal of a non-existent job should resolve without error.
                    || (cfg!(windows) && state == RemoveState::InstallingCrontab);
                if exited.code != 0 && !is_acceptable_nonzero {
                    #[cfg(windows)]
                    let stderr_owned: Vec<u8> = self.stderr_reader.with_mut(|r| {
                        bun_core::strings::trim(r.final_buffer().as_slice(), &ASCII_WHITESPACE)
                            .to_vec()
                    });
                    #[cfg(windows)]
                    let stderr_output: &[u8] = stderr_owned.as_slice();
                    #[cfg(not(windows))]
                    let stderr_output: &[u8] = b"";
                    if !stderr_output.is_empty() {
                        self.set_err(format_args!("{}", bstr::BStr::new(stderr_output)));
                    } else {
                        self.set_err(format_args!("Process exited with code {}", exited.code));
                    }
                    return JobAction::Finish;
                }
            }
            Status::Signaled(sig) => {
                if state != RemoveState::BootingOut {
                    self.set_err(format_args!("Process killed by signal {}", sig as i32));
                    return JobAction::Finish;
                }
            }
            Status::Err(err) => {
                self.set_err(format_args!(
                    "Process error: {}",
                    bstr::BStr::new(err.name())
                ));
                return JobAction::Finish;
            }
            Status::Running => return JobAction::Pending,
        }
        JobAction::Advance
    }

    /// May free `this`; see [`CronJobBase`] note.
    fn advance_state(this: ThisPtr<Self>) {
        let state = this.state.get();
        #[cfg(target_os = "macos")]
        {
            match state {
                RemoveState::BootingOut => {
                    this.unlink_plist();
                    Self::finish(this);
                }
                _ => {
                    this.set_err(format_args!("Unexpected state"));
                    Self::finish(this);
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            match state {
                RemoveState::ReadingCrontab => Self::remove_crontab_entry(this),
                RemoveState::InstallingCrontab => Self::finish(this),
                _ => {
                    this.set_err(format_args!("Unexpected state"));
                    Self::finish(this);
                }
            }
        }
    }
}

impl CronRemoveJob {
    #[cfg(target_os = "macos")]
    fn unlink_plist(&self) {
        let Some(home) = env_var::HOME.get() else {
            self.set_err(format_args!("HOME not set"));
            return;
        };
        if let Ok(plist_path) = alloc_print_z(format_args!(
            "{}/Library/LaunchAgents/bun.cron.{}.plist",
            bstr::BStr::new(home),
            bstr::BStr::new(self.title.as_bytes())
        )) {
            let _ = sys::unlink(&plist_path);
        } else {
            self.set_err(format_args!("Out of memory"));
        }
    }

    /// May free `this` (via spawn → synchronous exit → finish, or error path).
    fn spawn_cmd(
        this: ThisPtr<Self>,
        argv: &[&CStr],
        stdin_opt: spawn::Stdio,
        stdout_opt: spawn::Stdio,
    ) {
        spawn_cmd_generic(this, argv, stdin_opt, stdout_opt);
    }

    /// May free `this`; see [`CronJobBase`] note.
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    fn start_linux(this: ThisPtr<Self>) {
        let Some(crontab_path) = this.prepare_list_crontab(this.as_ptr().cast()) else {
            return Self::finish(this);
        };
        let argv = [crontab_path.as_cstr(), c"-l"];
        Self::spawn_cmd(this, &argv, spawn::Stdio::Ignore, spawn::Stdio::Buffer);
    }

    /// May free `this`; see [`CronJobBase`] note.
    #[cfg(not(target_os = "macos"))]
    fn remove_crontab_entry(this: ThisPtr<Self>) {
        let Ok((crontab_path, tmp_path)) = this.prepare_filtered_crontab() else {
            return Self::finish(this);
        };
        let argv = [crontab_path.as_cstr(), tmp_path.as_cstr()];
        Self::spawn_cmd(this, &argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore);
    }

    #[cfg(not(target_os = "macos"))]
    fn prepare_filtered_crontab(&self) -> Result<(ZString, ZString), ()> {
        let mut result: Vec<u8> = Vec::new();
        let filtered = self.stdout_reader.with_mut(|r| {
            filter_crontab(
                r.final_buffer().as_slice(),
                self.title.as_bytes(),
                &mut result,
            )
        });

        if filtered.is_err() {
            self.set_err(format_args!("Out of memory"));
            return Err(());
        }

        let tmp_path = match make_temp_path("bun-cron-rm-") {
            Ok(p) => p,
            Err(_) => {
                self.set_err(format_args!("Out of memory"));
                return Err(());
            }
        };
        self.tmp_path
            .set(Some(ZString::from_bytes(tmp_path.as_bytes())));

        let file = match File::openat(
            Fd::cwd(),
            self.tmp_path.get().as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
            0o600,
        ) {
            Ok(f) => f,
            Err(_) => {
                self.set_err(format_args!("Failed to create temp file"));
                return Err(());
            }
        };
        if file.write_all(&result).is_err() {
            let _ = file.close(); // close error is non-actionable
            self.set_err(format_args!("Failed to write temp file"));
            return Err(());
        }
        let _ = file.close(); // close error is non-actionable

        self.state.set(RemoveState::InstallingCrontab);
        self.stdout_reader
            .set(OutputReader::init::<CronRemoveJob>());
        let Some(crontab_path) = find_crontab() else {
            self.set_err(format_args!("crontab not found in PATH"));
            return Err(());
        };
        Ok((crontab_path, tmp_path))
    }

    /// May free `this`; see [`CronJobBase`] note.
    #[cfg(target_os = "macos")]
    fn start_mac(this: ThisPtr<Self>) {
        let Ok(uid_str) = this.prepare_bootout() else {
            return Self::finish(this);
        };
        let argv = [c"/bin/launchctl", c"bootout", uid_str.as_cstr()];
        Self::spawn_cmd(this, &argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore);
    }
}

// free fn: `#[host_fn]` Free shim calls bare `cron_remove(..)`
#[bun_jsc::host_fn]
pub(crate) fn cron_remove(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<1>();
    if !args[0].is_string() {
        return Err(global
            .throw_invalid_arguments(format_args!("Bun.cron.remove() expects a string title")));
    }

    let title_str = args[0].to_bun_string(global)?;
    let title_slice = title_str.to_utf8();

    if !validate_title(title_slice.slice()) {
        return Err(global.throw_invalid_arguments(format_args!(
            "Cron title must contain only alphanumeric characters, hyphens, and underscores"
        )));
    }

    let job = RefPtr::new(CronRemoveJob {
        ref_count: Cell::new(1),
        owner: Cell::new(None),
        promise: JsCell::new(jsc::JSPromiseStrong::init(global)),
        global: GlobalRef::from(global),
        poll: JsCell::new(KeepAlive::default()),
        title: ZString::from_bytes(title_slice.slice()),
        state: Cell::new(RemoveState::ReadingCrontab),
        process: JsCell::new(None),
        stdout_reader: JsCell::new(OutputReader::init::<CronRemoveJob>()),
        #[cfg(windows)]
        stderr_reader: JsCell::new(OutputReader::init::<CronRemoveJob>()),
        remaining_fds: Cell::new(0),
        has_called_process_exit: Cell::new(false),
        exit_status: JsCell::new(None),
        err_msg: JsCell::new(None),
        tmp_path: JsCell::new(None),
        event_loop_handle: EventLoopHandle::init(vm_mut().event_loop().cast::<()>()),
    });
    job.poll.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
    let promise_value = job.promise.get().value();
    let this = job.this_ptr();
    this.owner.set(Some(job));
    let job = this;
    #[cfg(target_os = "macos")]
    CronRemoveJob::start_mac(job);
    #[cfg(windows)]
    CronRemoveJob::start_windows(job);
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    CronRemoveJob::start_linux(job);
    Ok(promise_value)
}

#[cfg(windows)]
impl CronRemoveJob {
    /// May free `this`; see [`CronJobBase`] note.
    fn start_windows(this: ThisPtr<Self>) {
        let Ok(task_name) = this.prepare_schtasks_delete() else {
            return Self::finish(this);
        };
        let argv = [c"schtasks", c"/delete", c"/tn", task_name.as_cstr(), c"/f"];
        Self::spawn_cmd(this, &argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore);
    }

    fn prepare_schtasks_delete(&self) -> Result<ZString, ()> {
        self.state.set(RemoveState::InstallingCrontab);
        alloc_print_z(format_args!(
            "bun-cron-{}",
            bstr::BStr::new(self.title.as_bytes())
        ))
        .map_err(|_| self.set_err(format_args!("Out of memory")))
    }
}

impl Drop for CronRemoveJob {
    fn drop(&mut self) {
        if let Some(p) = self.tmp_path.replace(None) {
            let _ = sys::unlink(&p);
        }
    }
}

// ============================================================================
// CronJob — in-process callback-style cron (Bun.cron(expr, cb))
// ============================================================================

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). `on_timer_fire`
// calls `cb.call()` which re-enters JS; that JS may call `stop()`/`ref()`/
// `unref()` on this same wrapper, so a `noalias` `&mut Self` held across the
// re-entry is Stacked-Borrows UB and an LLVM-level miscompile hazard. `&self`
// + `UnsafeCell`-backed fields suppresses `noalias` on the receiver.
#[bun_jsc::JsClass(no_constructor)]
#[derive(bun_ptr::CellRefCounted)]
pub struct CronJob {
    ref_count: Cell<u32>,
    /// Set from the allocating `RefPtr` so `&self` host fns can reach the
    /// `ThisPtr`-taking paths that may release refs.
    self_ref: Cell<BackRef<CronJob, bun_ptr::Root>>,
    // pub: `bun_core::from_field_ptr!(CronJob, event_loop_timer)` needs `offset_of!` visibility.
    // `JsCell` is `#[repr(transparent)]`, so the byte offset of the inner
    // `EventLoopTimer` is identical and the dispatch.rs `owner!` macro works
    // unchanged.
    pub(crate) event_loop_timer: JsCell<EventLoopTimer>,
    // LIFETIMES.tsv: JSC_BORROW → GlobalRef. Read-only after construction.
    global: GlobalRef,
    // Read-only after construction.
    parsed: CronExpression,
    // Read-only after construction.
    tz: CronTz,
    poll_ref: JsCell<KeepAlive>,
    this_value: JsCell<JsRef>,
    stopped: Cell<bool>,
    /// Last computed wall-clock fire target (ms epoch); floors the next search
    /// so monotonic-vs-wall skew can't recompute the same minute.
    last_next_ms: Cell<f64>,
    /// The ref held across an in-flight callback promise. Released exactly
    /// once by either onPromiseResolve/Reject or clearAllForVM(.teardown).
    pending_ref: JsCell<Option<RefPtr<CronJob>>>,
    /// True between onTimerFire's cb.call() and processing of its result.
    in_fire: Cell<bool>,
}

bun_event_loop::impl_timer_owner!(CronJob; from_timer_ptr => event_loop_timer);

pub mod js {
    // `jsc.Codegen.JSCronJob` cached-slot accessors. The C++ side is emitted by
    // `src/codegen/generate-classes.ts` from `cron.classes.ts`; bind the extern
    // contract via the proc-macro so the symbol names line up.
    bun_jsc::codegen_cached_accessors!("CronJob"; callback, cron, pendingPromise);
}

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub enum ClearMode {
    Reload,
    Teardown,
}

impl CronJob {
    /// Defer downgrading the JS wrapper to weak until any in-flight promise
    /// has settled, so onPromiseReject can still read pendingPromise from
    /// the wrapper and pass the real Promise to unhandledRejection.
    fn maybe_downgrade(&self) {
        if self.stopped.get()
            && self.pending_ref.get().is_none()
            && !matches!(self.this_value.get(), JsRef::Finalized)
        {
            self.this_value.with_mut(|v| v.downgrade());
        }
    }

    /// May free `this`.
    fn release_pending_ref(this: ThisPtr<Self>) {
        if let Some(_pending) = this.pending_ref.replace(None) {
            this.maybe_downgrade();
        }
    }

    /// Idempotent — every step checks its own state.
    fn stop_internal(&self, _vm: &VirtualMachine) {
        self.stopped.set(true);
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
        self.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        self.maybe_downgrade();
    }

    /// Runs the cleanup that selfStop deferred while in_fire was true.
    /// May free `this`.
    fn finish_deferred_stop(this: ThisPtr<Self>, vm: &VirtualMachine) {
        this.stop_internal(vm);
        Self::remove_from_list(this);
    }

    /// The fake heap dropped this job's timer (`useRealTimers()` /
    /// `clearAllTimers()`): stop the job as `stop()` would, so it does not
    /// keep the event loop alive for a timer that can no longer fire.
    pub(crate) fn stop_dropped_from_fake_heap(this: ThisPtr<Self>) {
        Self::self_stop(this, VirtualMachine::get());
    }

    /// May free `this`.
    fn self_stop(this: ThisPtr<Self>, vm: &VirtualMachine) {
        // While the callback is on the stack or its promise is pending, defer
        // list removal + downgrade to finishDeferredStop (called from
        // scheduleNext after settle) so onPromiseReject can read pendingPromise
        // and clearAllForVM(.teardown) can release pending_ref.
        if this.in_fire.get() || this.pending_ref.get().is_some() {
            this.stopped.set(true);
            this.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
            return;
        }
        this.stop_internal(vm);
        Self::remove_from_list(this);
    }

    /// May free `this`.
    fn remove_from_list(this: ThisPtr<Self>) {
        let Some(jobs) = crate::jsc_hooks::cron_jobs_mut() else {
            return;
        };
        if let Some(i) = jobs.iter().position(|j| j.as_ptr() == this.as_ptr()) {
            drop(jobs.swap_remove(i));
        }
    }

    /// `.reload`: --hot — promises in flight will still settle on this VM, so
    /// the pending ref is left for onPromiseResolve/Reject to balance.
    /// `.teardown`: worker exit — the event loop is dying, settle never
    /// happens, so release the pending ref here to avoid leaking the struct.
    pub(crate) fn clear_all_for_vm<const MODE: ClearMode>(vm: &mut VirtualMachine) {
        // Drain the list first so `stop_internal` (which re-enters the VM)
        // doesn't alias the list borrow.
        let Some(jobs) = crate::jsc_hooks::cron_jobs_mut() else {
            return;
        };
        for job in core::mem::take(jobs) {
            let this = job.this_ptr();
            this.stop_internal(vm);
            if MODE == ClearMode::Teardown {
                Self::release_pending_ref(this);
            }
        }
    }

    pub fn finalize(&self) {
        self.this_value.with_mut(|v| v.finalize());
    }

    fn compute_next_timespec(&self) -> Option<bun_core::Timespec> {
        // Cron occurrences are calendar-based (epoch); the timer heap is
        // monotonic. Anchor both to the same clock (mocked when fake timers
        // are active) so they can never half-apply.
        let now_ms: f64 = bun_core::time::milli_timestamp_allow_mocked_time();
        // The monotonic timer can fire fractionally before the wall-clock target
        // (clock skew / NTP step); floor next() at the prior target so it can't
        // recompute the same minute and double-fire.
        let from_ms = now_ms.max(self.last_next_ms.get());
        let next_ms = match self.parsed.next(&self.global, from_ms, self.tz) {
            Ok(Some(v)) => v,
            _ => return None,
        };
        self.last_next_ms.set(next_ms);
        let delta: i64 = (next_ms - now_ms).max(1.0) as i64;
        Some(bun_core::Timespec::ms_from_now(
            bun_core::TimespecMockMode::AllowMockedTime,
            delta,
        ))
    }

    /// May free `this` (via `finish_deferred_stop`).
    fn schedule_next(this: ThisPtr<Self>, vm: &VirtualMachine) {
        // Every path into here has just returned from user JS (the callback,
        // an uncaughtException handler, or an unhandledRejection handler). If
        // that JS called process.exit() / worker.terminate(), don't re-arm
        // the timer into a VM whose teardown now owns it.
        if this.stopped.get() || vm.script_execution_status() != jsc::ScriptExecutionStatus::Running
        {
            this.stopped.set(true);
            return Self::finish_deferred_stop(this, vm);
        }
        let Some(next_time) = this.compute_next_timespec() else {
            return Self::finish_deferred_stop(this, vm);
        };
        timer_all().update(
            this.event_loop_timer
                .as_ptr()
                .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>(),
            &next_time,
        );
    }

    /// The tick's callback runs here as a top-level call (what it throws
    /// synchronously is reported), and the job is rescheduled either way.
    pub(crate) fn on_timer_fire(this: ThisPtr<Self>, vm: &VirtualMachine) {
        // scheduleNext → finishDeferredStop downgrades this_value and derefs the
        // list entry; bracket-ref so that path can't drop the last ref mid-function.
        // Timer heap holds the entry; `this` is live until the guard drops.
        let _guard = RefPtr::from_this(this);
        // R-2: shared borrows only — `cb.call()` re-enters JS, which may call
        // `stop()`/`ref()`/`unref()` on this same wrapper; a `noalias`
        // `&mut Self` here would be Stacked-Borrows UB. All mutation is
        // interior (`Cell`/`JsCell`).
        this.event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);

        if this.stopped.get() {
            return;
        }
        if vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            Self::self_stop(this, vm);
            return;
        }

        let Some(js_this) = this.this_value.get().try_get() else {
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

        // `enter()` now, `exit()` on drop; holds the raw pointer (not `&mut`)
        // so re-entrant JS can re-borrow.
        let _ev_guard = vm.enter_event_loop_scope();

        this.in_fire.set(true);
        // A top-level call: what the tick throws is reported here (before the
        // job is re-armed, so an `uncaughtException` handler's `stop()` is
        // observed by `schedule_next`), and does not stop the job — as with a
        // rejected tick.
        let result = vm
            .event_loop_mut()
            .run_callback_with_result(cb, &this.global, js_this, &[]);
        this.in_fire.set(false);

        // terminate() may have arrived while the callback was running; bail out
        // without touching the timer heap or JS state the teardown path owns.
        if vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            Self::self_stop(this, vm);
            return;
        }
        if result.is_empty() {
            Self::schedule_next(this, vm);
            return;
        }

        if let Some(promise) = result.as_any_promise() {
            match promise.status() {
                jsc::js_promise::Status::Pending => {
                    this.pending_ref.set(Some(RefPtr::from_this(this)));
                    js::pending_promise_set_cached(js_this, &this.global, result);
                    result.then(
                        &this.global,
                        this.as_ptr(),
                        crate::generated_host_exports::Bun__CronJob__onPromiseResolve,
                        crate::generated_host_exports::Bun__CronJob__onPromiseReject,
                    );
                    // `then()` returns `()`, so re-check the VM status and
                    // recover on termination — otherwise `pending_ref` leaks.
                    if vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
                        js::pending_promise_set_cached(js_this, &this.global, JSValue::UNDEFINED);
                        Self::release_pending_ref(this);
                        Self::schedule_next(this, vm);
                    }
                    return;
                }
                jsc::js_promise::Status::Fulfilled => {}
                jsc::js_promise::Status::Rejected => {
                    promise.set_handled(this.global.vm());
                    // `bun_jsc::AnyPromise` (lib.rs duplicate) lacks `.result()`;
                    // dispatch on the variant and call `JSPromise::result` directly.
                    // S012: `JSPromise` is an `opaque_ffi!` ZST — safe deref.
                    let reason = match promise {
                        jsc::AnyPromise::Normal(p) => {
                            jsc::JSPromise::opaque_mut(p).result(this.global.vm())
                        }
                        jsc::AnyPromise::Internal(p) => {
                            jsc::JSPromise::opaque_mut(p).result(this.global.vm())
                        }
                    };
                    let global_ref = vm.global();
                    VirtualMachine::get()
                        .as_mut()
                        .unhandled_rejection(global_ref, reason, result);
                }
            }
        }

        Self::schedule_next(this, vm);
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn stop(&self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        Self::self_stop(self.self_ref.get().this_ptr(), self.global.bun_vm());
        Ok(frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_ref(&self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if !self.stopped.get() {
            self.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        }
        Ok(frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn do_unref(
        &self,
        _global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        self.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        Ok(frame.this())
    }

    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_cron(_this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED) // unreachable — register() pre-populates the cache via cronSetCached
    }

    pub(crate) fn register(
        global: &JSGlobalObject,
        schedule_arg: JSValue,
        callback_arg: JSValue,
        tz: CronTz,
    ) -> JsResult<JSValue> {
        if !schedule_arg.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Bun.cron() expects a string cron expression"
            )));
        }

        let schedule_str = schedule_arg.to_bun_string(global)?;
        let schedule_slice = schedule_str.to_utf8();

        let parsed = match CronExpression::parse(schedule_slice.slice()) {
            Ok(p) => p,
            Err(e) => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{}",
                    bstr::BStr::new(CronExpression::error_message(e))
                )));
            }
        };

        let vm = global.bun_vm().as_mut();

        let job = RefPtr::new(CronJob {
            ref_count: Cell::new(1),
            self_ref: Cell::new(BackRef::dangling()),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(EventLoopTimerTag::CronJob)),
            global: GlobalRef::from(global),
            parsed,
            tz,
            poll_ref: JsCell::new(KeepAlive::default()),
            this_value: JsCell::new(JsRef::empty()),
            stopped: Cell::new(false),
            last_next_ms: Cell::new(0.0),
            pending_ref: JsCell::new(None),
            in_fire: Cell::new(false),
        });
        job.self_ref.set(BackRef::from(job.this_ptr()));

        let Some(next_time) = job.compute_next_timespec() else {
            return Err(global.throw_invalid_arguments(format_args!(
                "Cron expression '{}' has no future occurrences",
                bstr::BStr::new(schedule_slice.slice())
            )));
        };

        // The cron_jobs list exists so --hot reload and worker teardown can
        // stop/release jobs. Main-thread VMs without --hot never enumerate it,
        // so skip the list ref + append entirely.
        if vm.hot_reload == HotReload::Hot || vm.worker.is_some() {
            if let Some(jobs) = crate::jsc_hooks::cron_jobs_mut() {
                jobs.push(job.clone());
            }
        }

        // `job`'s ref moves to the JS wrapper (released via `finalize`).
        let js_value = Self::to_js_nonnull(job.as_non_null(), global);
        let job = job.into_this_ptr();
        job.this_value.with_mut(|v| v.set_strong(js_value, global));
        js::cron_set_cached(js_value, global, schedule_arg);
        js::callback_set_cached(
            js_value,
            global,
            callback_arg.with_async_context_if_needed(global),
        );

        job.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        timer_all().update(
            job.event_loop_timer
                .as_ptr()
                .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>(),
            &next_time,
        );

        Ok(js_value)
    }
}

// C++ `promiseHandlerID` compares the handler passed to `JSValue::then` against
// these symbols by address, so they must stay function exports.
// HOST_EXPORT(Bun__CronJob__onPromiseResolve, jsc)
pub fn on_promise_resolve(
    this: ThisPtr<CronJob>,
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    // `pending_ref` holds the ref taken before `then` until `release_pending_ref`.
    let _guard = scopeguard::guard(this, CronJob::release_pending_ref);
    let vm = this.global.bun_vm();
    if let Some(js_this) = this.this_value.get().try_get() {
        js::pending_promise_set_cached(js_this, &this.global, JSValue::UNDEFINED);
    }
    CronJob::schedule_next(this, vm);
    Ok(JSValue::UNDEFINED)
}

// HOST_EXPORT(Bun__CronJob__onPromiseReject, jsc)
pub fn on_promise_reject(
    this: ThisPtr<CronJob>,
    _global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let args = frame.arguments();
    let _guard = scopeguard::guard(this, CronJob::release_pending_ref);
    let vm = this.global.bun_vm().as_mut();
    let err = args[0];
    let mut promise_value = JSValue::UNDEFINED;
    if let Some(js_this) = this.this_value.get().try_get() {
        promise_value = js::pending_promise_get_cached(js_this).unwrap_or(JSValue::UNDEFINED);
        js::pending_promise_set_cached(js_this, &this.global, JSValue::UNDEFINED);
    }
    // `vm.global()` returns `&'static`, so the borrow is already decoupled
    // from `vm` and `unhandled_rejection(&mut self, ...)` can reborrow.
    let global_ref = vm.global();
    vm.unhandled_rejection(global_ref, err, promise_value);
    CronJob::schedule_next(this, vm);
    Ok(JSValue::UNDEFINED)
}

// ============================================================================
// Bun.cron object builder
// ============================================================================

pub(crate) fn get_cron_object(global_this: &JSGlobalObject, _obj: &JSObject) -> JSValue {
    // `#[bun_jsc::host_fn]` emits the C-ABI shim as `__jsc_host_<name>`.
    let cron_fn = JSFunction::create(
        global_this,
        "cron",
        __jsc_host_cron_register,
        3,
        Default::default(),
    );
    let remove_fn = JSFunction::create(
        global_this,
        "remove",
        __jsc_host_cron_remove,
        1,
        Default::default(),
    );
    let parse_fn = JSFunction::create(
        global_this,
        "parse",
        __jsc_host_cron_parse,
        1,
        Default::default(),
    );
    cron_fn.put(global_this, b"remove", remove_fn);
    cron_fn.put(global_this, b"parse", parse_fn);
    cron_fn
}

#[bun_jsc::host_fn]
pub(crate) fn cron_parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<3>();

    if !args[0].is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Bun.cron.parse() expects a string cron expression as the first argument"
        )));
    }

    let expr_str = args[0].to_bun_string(global)?;
    let expr_slice = expr_str.to_utf8();

    let parsed = match CronExpression::parse(expr_slice.slice()) {
        Ok(p) => p,
        Err(e) => {
            return Err(global.throw_invalid_arguments(format_args!(
                "{}",
                bstr::BStr::new(CronExpression::error_message(e))
            )));
        }
    };

    let from_ms: f64 = if !args[1].is_empty() && !args[1].is_undefined() && args[1] != JSValue::NULL
    {
        if args[1].is_number() || args[1].js_type() == jsc::JSType::JSDate {
            args[1].to_number(global)?
        } else {
            return Err(global.throw_invalid_arguments(format_args!(
                "Bun.cron.parse() expects the second argument to be a Date or number (ms since epoch)"
            )));
        }
    } else {
        bun_core::time::milli_timestamp() as f64
    };

    // Out-of-range ms hits UB in WTF::msToGregorianDateTime's int casts and
    // the resulting garbage components panic next()'s u32 conversions.
    if from_ms.is_nan() || from_ms.abs() > jsc::wtf::MAX_ECMASCRIPT_TIME {
        return Err(global.throw_invalid_arguments(format_args!("Invalid date value")));
    }

    let tz = resolve_cron_tz(global, args[2])?;

    let Some(next_ms) = parsed.next(global, from_ms, tz)? else {
        return Ok(JSValue::NULL);
    };
    // Return null (not Invalid Date) so callers can rely on `=== null` for "no future match".
    if next_ms > jsc::wtf::MAX_ECMASCRIPT_TIME {
        return Ok(JSValue::NULL);
    }
    Ok(JSValue::from_date_number(global, next_ms))
}

// ============================================================================
// Shared helpers
// ============================================================================

/// Trait abstracting over CronRegisterJob/CronRemoveJob for `spawn_cmd_generic`.
trait SpawnCmdTarget: CronJobBase + BufferedReaderParent + bun_spawn::ProcessExitOwner {
    fn process_slot(&self) -> &JsCell<Option<ProcessHandle>>;
    #[cfg(unix)]
    fn stdout_reader(&self) -> &JsCell<OutputReader>;
    #[cfg(windows)]
    fn stderr_reader(&self) -> &JsCell<OutputReader>;
}

bun_spawn::link_impl_ProcessExit! {
    CronRegister for CronRegisterJob => |this| {
        // SAFETY: `this` is the live heap job installed via `set_exit_handler`;
        // `on_process_exit` → `maybe_finished` may free it.
        on_process_exit(process, status, rusage) =>
            <CronRegisterJob as CronJobBase>::on_process_exit(ThisPtr::new(this), &*process, status, rusage),
    }
}
bun_spawn::link_impl_ProcessExit! {
    CronRemove for CronRemoveJob => |this| {
        // SAFETY: `this` is the live heap job installed via `set_exit_handler`.
        on_process_exit(process, status, rusage) =>
            <CronRemoveJob as CronJobBase>::on_process_exit(ThisPtr::new(this), &*process, status, rusage),
    }
}

impl SpawnCmdTarget for CronRegisterJob {
    fn process_slot(&self) -> &JsCell<Option<ProcessHandle>> {
        &self.process
    }
    #[cfg(unix)]
    fn stdout_reader(&self) -> &JsCell<OutputReader> {
        &self.stdout_reader
    }
    #[cfg(windows)]
    fn stderr_reader(&self) -> &JsCell<OutputReader> {
        &self.stderr_reader
    }
}
impl SpawnCmdTarget for CronRemoveJob {
    fn process_slot(&self) -> &JsCell<Option<ProcessHandle>> {
        &self.process
    }
    #[cfg(unix)]
    fn stdout_reader(&self) -> &JsCell<OutputReader> {
        &self.stdout_reader
    }
    #[cfg(windows)]
    fn stderr_reader(&self) -> &JsCell<OutputReader> {
        &self.stderr_reader
    }
}

/// Generic spawn used by both CronRegisterJob and CronRemoveJob.
///
/// May free `this` (synchronously, via either an early `T::finish` on setup
/// error or `watch_or_reap` → exit handler → `maybe_finished` → `finish`);
/// see [`CronJobBase`] note. Callers must not touch `this` after this returns.
fn spawn_cmd_generic<T: SpawnCmdTarget>(
    this: ThisPtr<T>,
    argv: &[&CStr],
    stdin_opt: spawn::Stdio,
    stdout_opt: spawn::Stdio,
) {
    let Ok(process) = spawn_cmd_prepare(this, argv, stdin_opt, stdout_opt) else {
        return T::finish(this);
    };
    process.set_exit_handler(this);
    // The exit handler (`on_process_exit` → `maybe_finished`) may free `this`;
    // it only runs synchronously on the `Ok(true)` and `on_exit` paths, after
    // which neither `this` nor the slot is touched and the handle is dropped.
    match process.watch_or_reap() {
        Ok(false) => this.process_slot().set(Some(process)),
        Ok(true) => {}
        Err(err) => {
            if !process.has_exited() {
                let rusage = bun_core::ffi::zeroed::<Rusage>();
                process.on_exit(Status::Err(err), &rusage);
            }
        }
    }
}

/// Spawns the command and wires the output readers. `Err` records the error
/// via `set_err` (for the caller to `finish`). `this.as_ptr()` is stored as
/// the readers' parent pointer.
/// The `stdout_reader().start(..)` failure path synchronously re-enters this
/// job (`on_reader_error` -> `note_reader_error` writes the `remaining_fds`/
/// `err_msg` cells through the parent backref); it never touches the reader
/// cell itself, so the reader's `with_mut` borrow is the only one live.
fn spawn_cmd_prepare<T: SpawnCmdTarget>(
    this: ThisPtr<T>,
    argv: &[&CStr],
    stdin_opt: spawn::Stdio,
    stdout_opt: spawn::Stdio,
) -> Result<ProcessHandle, ()> {
    let this_ptr: *mut core::ffi::c_void = this.as_ptr().cast();
    this.has_called_process_exit().set(false);
    this.exit_status().set(None);
    this.remaining_fds().set(0);

    #[cfg(not(windows))]
    let resolved_argv0: Option<*const core::ffi::c_char> = None;
    #[cfg(windows)]
    let resolved_argv0: Option<*const core::ffi::c_char>;
    // Hoisted to function scope: `resolved_argv0` borrows into this buffer on
    // Windows and must outlive the spawn below.
    #[cfg(windows)]
    let mut path_buf = PathBuffer::uninit();
    #[cfg(windows)]
    {
        // Resolve the executable via bun.which, matching Bun.spawn's behavior.
        let path_env = vm_mut().transpiler.env().map.get(b"PATH").unwrap_or(b"");
        let argv0 = argv[0].to_bytes();
        match bun_which::which(&mut path_buf, path_env, b"", argv0) {
            Some(p) => resolved_argv0 = Some(p.as_ptr().cast()),
            None => {
                this.set_err(format_args!(
                    "Could not find '{}' in PATH",
                    bstr::BStr::new(argv0)
                ));
                return Err(());
            }
        }
    }
    #[cfg(unix)]
    let env = spawn::SpawnEnv::Inherit;
    #[cfg(windows)]
    let envp_owned;
    #[cfg(windows)]
    let env_strings: Vec<&CStr>;
    #[cfg(windows)]
    let env = {
        match vm_mut()
            .transpiler
            .env_mut()
            .map
            .create_null_delimited_env_map()
        {
            Ok(v) => {
                envp_owned = v;
                env_strings = envp_owned.iter().collect();
                spawn::SpawnEnv::Strings(&env_strings)
            }
            Err(_) => {
                this.set_err(format_args!("Failed to create environment block"));
                return Err(());
            }
        }
    };

    // Ownership note: BOTH
    // `Source::Pipe` and `WindowsStdioResult::Buffer` own a `Box<uv::Pipe>`,
    // and `spawn_process_windows` `heap::take`s the raw `Stdio::Buffer`
    // pointer into `WindowsStdioResult::Buffer` on success. Pre-stashing the
    // Box in `stderr_reader.source` here (the original transliteration) would
    // create TWO `Box<uv::Pipe>` over one allocation — UB under Stacked
    // Borrows even with a `mem::forget` of the duplicate, because moving the
    // first Box into `Source::Pipe` reasserts its `Unique` tag and kills the
    // raw pointer's provenance before `spawn_process_windows` ever
    // dereferences it. Instead hand the raw heap pointer to `Stdio::Buffer`
    // alone (sole owner), let `spawn_process_windows` round-trip it through
    // `heap::take`, and stash the returned Box in `stderr_reader.source`
    // AFTER spawn — see the `#[cfg(windows)]` block below and
    // `lifecycle_script_runner.rs` / `filter_run.rs` for the canonical
    // pattern. On spawn error, `WindowsStdio` has no `Drop`; reclaim
    // explicitly via `spawn_options.stderr.deinit()`.
    #[cfg(windows)]
    let stderr_pipe_ptr: *mut bun_sys::windows::libuv::Pipe =
        bun_core::heap::into_raw(Box::new(bun_core::ffi::zeroed::<
            bun_sys::windows::libuv::Pipe,
        >()));
    let cwd = FileSystem::get().top_level_dir;
    let spawn_options = SpawnOptions {
        stdin: stdin_opt,
        stdout: stdout_opt,
        #[cfg(windows)]
        stderr: spawn::Stdio::Buffer(stderr_pipe_ptr),
        #[cfg(not(windows))]
        stderr: spawn::Stdio::Ignore,
        cwd: cwd.into(),
        argv0: resolved_argv0,
        #[cfg(windows)]
        windows: spawn::WindowsOptions {
            loop_: EventLoopHandle::init(vm_mut().event_loop().cast::<()>()),
            ..Default::default()
        },
        ..SpawnOptions::default()
    };
    // `mut` only for the Windows error-path `spawn_options.stderr.deinit()`.
    #[cfg(windows)]
    let mut spawn_options = spawn_options;

    let spawned = match spawn::spawn_process_cstr(&spawn_options, argv, env) {
        Ok(Ok(sp)) => sp,
        Ok(Err(err)) => {
            // `spawn_process_windows` only `heap::take`s the `Stdio::Buffer`
            // raw `*mut uv::Pipe` on the SUCCESS path; on every error return
            // ownership stays with the caller and `WindowsStdio` has no
            // `Drop`. Reclaim it (uv_close + free if init'd) here.
            #[cfg(windows)]
            spawn_options.stderr.deinit();
            this.set_err(format_args!(
                "Failed to spawn process: {}",
                bstr::BStr::new(err.name())
            ));
            return Err(());
        }
        Err(e) => {
            #[cfg(windows)]
            spawn_options.stderr.deinit();
            this.set_err(format_args!("Failed to spawn process: {}", e.name()));
            return Err(());
        }
    };
    #[cfg(windows)]
    let mut spawned = spawned;

    #[cfg(unix)]
    {
        if let Some(stdout) = spawned.stdout {
            if !spawned.memfds[1] {
                this.stdout_reader().with_mut(|r| r.set_parent(this_ptr));
                let _ = sys::set_nonblocking(stdout);
                this.remaining_fds().set(this.remaining_fds().get() + 1);
                let started = this.stdout_reader().with_mut(|r| {
                    use bun_io::pipe_reader::PosixFlags;
                    r.flags.insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
                    r.flags.remove(
                        PosixFlags::MEMFD
                            | PosixFlags::RECEIVED_EOF
                            | PosixFlags::CLOSED_WITHOUT_REPORTING,
                    );
                    r.start(stdout, true)
                });
                if started.is_err() {
                    this.set_err(format_args!("Failed to start reading stdout"));
                    return Err(());
                }
                this.stdout_reader().with_mut(|r| {
                    if let Some(p) = r.handle.get_poll() {
                        p.set_flag(bun_io::FilePollFlag::Socket);
                    }
                });
            } else {
                this.stdout_reader().with_mut(|r| {
                    r.set_parent(this_ptr);
                    r.start_memfd(stdout);
                });
            }
        }
    }
    #[cfg(windows)]
    {
        // `spawn_process_windows` has `heap::take`n `stderr_pipe_ptr` out of
        // `Stdio::Buffer` into `spawned.stderr` as
        // `WindowsStdioResult::Buffer(Box<uv::Pipe>)`. Take that Box out
        // *here* (sole owner — single `into_raw` → `from_raw` round-trip, no
        // aliasing Box) and stash it in `stderr_reader.source` BEFORE
        // `start_with_current_pipe` (which reads `source.?.pipe`) and BEFORE
        // `spawned` drops — otherwise `WindowsSpawnResult::Drop` would
        // `uv_close`+free the live, libuv-registered handle (UAF in the read
        // callback + double-free on reader close).
        if let spawn::WindowsStdioResult::Buffer(pipe) = spawned.stderr.take() {
            debug_assert!(core::ptr::eq(Box::as_ref(&pipe), stderr_pipe_ptr));
            this.stderr_reader().with_mut(|r| {
                r.set_source(bun_io::Source::Pipe(pipe));
                r.set_parent(this_ptr);
            });
            this.remaining_fds().set(this.remaining_fds().get() + 1);
            let started = this
                .stderr_reader()
                .with_mut(|r| r.start_with_current_pipe());
            if started.is_err() {
                this.set_err(format_args!("Failed to start reading stderr"));
                return Err(());
            }
        }
    }

    let ev_handle = EventLoopHandle::init(vm_mut().event_loop().cast::<()>());
    Ok(spawned.to_process_handle(ev_handle))
}

/// Find crontab binary using bun.which (searches PATH).
#[cfg(not(target_os = "macos"))]
fn find_crontab() -> Option<ZString> {
    #[cfg(windows)]
    {
        return None;
    }
    #[cfg(not(windows))]
    {
        let path_env = env_var::PATH.get().unwrap_or(b"/usr/bin:/bin");
        let mut buf = PathBuffer::uninit();
        let found = bun_which::which(&mut buf, path_env, b"", b"crontab")?;
        Some(ZString::from_bytes(found.as_bytes()))
    }
}

fn resolve_path(
    global: &JSGlobalObject,
    frame: &CallFrame,
    path_: &[u8],
) -> crate::Result<ZString> {
    let vm = global.bun_vm().as_mut();
    let srcloc = frame.get_caller_src_loc(global);
    let caller_utf8 = srcloc.str.to_utf8();
    let raw_dir = path::resolve_path::dirname::<path::platform::Auto>(caller_utf8.slice());
    let source_dir: &[u8] = if raw_dir.is_empty() { b"." } else { raw_dir };
    let mut resolved = vm
        .transpiler
        .resolver
        .resolve(source_dir, path_, bun_ast::ImportKind::EntryPointRun)
        .map_err(|_| crate::Error::ModuleNotFound)?;
    let entry_path = resolved.path().ok_or(crate::Error::ModuleNotFound)?;
    Ok(ZString::from_bytes(entry_path.text))
}

#[cfg(any(target_os = "macos", windows))]
fn alloc_print_z(args: core::fmt::Arguments<'_>) -> Result<ZString, bun_alloc::AllocError> {
    let mut v = Vec::new();
    v.write_fmt(args).map_err(|_| bun_alloc::AllocError)?;
    Ok(ZString::from_vec(v))
}

/// Create a temp file path with a random suffix to avoid TOCTOU/symlink attacks.
#[cfg(not(target_os = "macos"))]
fn make_temp_path(prefix: &'static str) -> Result<ZString, bun_alloc::AllocError> {
    let mut name_buf = PathBuffer::uninit();
    let mut full_prefix = Vec::with_capacity(prefix.len() + 3);
    full_prefix.extend_from_slice(prefix.as_bytes());
    full_prefix.extend_from_slice(b"tmp");
    let name = FileSystem::tmpname(
        &full_prefix,
        name_buf.0.as_mut_slice(),
        bun_core::fast_random(),
    )
    .map_err(|_| bun_alloc::AllocError)?;
    let joined = path::resolve_path::join_abs_string::<path::platform::Auto>(
        RealFS::platform_temp_dir(),
        &[name.as_bytes()],
    );
    Ok(ZString::from_bytes(joined))
}

// ============================================================================
// Pure OS-level cron translators (crontab filter, launchd plist, schtasks XML).
// No JSC dependencies — operate on `&[u8]` and `cron_parser::CronExpression`.
// ============================================================================

/// Get the current user ID.
#[cfg(target_os = "macos")]
pub(crate) fn get_uid() -> u32 {
    // `bun_sys::c::getuid` is declared `safe fn` (no args, never fails) —
    // discharges the per-site proof the raw `libc` decl required.
    sys::c::getuid() as u32
}

/// Validate title: only [a-zA-Z0-9_-], non-empty.
pub(crate) fn validate_title(title: &[u8]) -> bool {
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
#[cfg(not(target_os = "macos"))]
pub(crate) fn filter_crontab(
    content: &[u8],
    title: &[u8],
    result: &mut Vec<u8>,
) -> Result<(), bun_alloc::AllocError> {
    let mut marker = Vec::new();
    let _ = write!(&mut marker, "# bun-cron: {}", bstr::BStr::new(title));
    let mut skip_next = false;
    for line in strings::split(content, b"\n") {
        if skip_next {
            skip_next = false;
            continue;
        }
        if bun_core::trim(line, b" \t") == marker.as_slice() {
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

/// XML-escape a string for safe embedding in plist XML.
#[cfg(any(target_os = "macos", windows))]
pub(crate) fn xml_escape(input: &[u8]) -> Result<Vec<u8>, bun_alloc::AllocError> {
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
pub enum CalendarError {
    #[error("InvalidCron")]
    InvalidCron,
}

#[cfg(target_os = "macos")]
pub(crate) fn cron_to_calendar_interval(schedule: &[u8]) -> Result<Vec<u8>, CalendarError> {
    let mut fields: [&[u8]; 5] = [b""; 5];
    let mut count: usize = 0;
    for field in strings::tokenize(schedule, b" ") {
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
        for part in strings::split(field, b",") {
            // parse_unsigned (not parse_int) keeps '-5' → InvalidCron.
            let val: i32 =
                bun_core::parse_unsigned(part, 10).map_err(|_| CalendarError::InvalidCron)?;
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
        .any(|fv| fv.as_ref().is_some_and(|v| v.len() > 1));
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
            emit_calendar_dicts(&mut result, &fv_slices, EmitMode::ExcludeWeekday)?;
            // Pass 2: Weekday + time fields (minute, hour, weekday, month — no day)
            emit_calendar_dicts(&mut result, &fv_slices, EmitMode::ExcludeDay)?;
        } else {
            // Normal Cartesian product: all fields together
            emit_calendar_dicts(&mut result, &fv_slices, EmitMode::IncludeAll)?;
        }

        result.extend_from_slice(b"    </array>");
    }
    Ok(result)
}

#[cfg(target_os = "macos")]
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
#[cfg(target_os = "macos")]
enum EmitMode {
    IncludeAll,
    ExcludeWeekday,
    ExcludeDay,
}

/// Emit Cartesian-product <dict> entries for the given field values.
/// In exclude_weekday mode, day-of-week (index 4) is treated as wildcard.
/// In exclude_day mode, day-of-month (index 2) is treated as wildcard.
#[cfg(target_os = "macos")]
fn emit_calendar_dicts(
    result: &mut Vec<u8>,
    field_values: &[Option<&[i32]>; 5],
    mode: EmitMode,
) -> Result<(), CalendarError> {
    const PLIST_KEYS: [&[u8]; 5] = [b"Minute", b"Hour", b"Day", b"Month", b"Weekday"];

    // Build effective field values based on mode
    let mut effective: [Option<&[i32]>; 5] = *field_values;
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
                        if effective[0].is_some() {
                            append_calendar_key(result, PLIST_KEYS[0], m)?;
                        }
                        if effective[1].is_some() {
                            append_calendar_key(result, PLIST_KEYS[1], h)?;
                        }
                        if effective[2].is_some() {
                            append_calendar_key(result, PLIST_KEYS[2], d)?;
                        }
                        if effective[3].is_some() {
                            append_calendar_key(result, PLIST_KEYS[3], mo)?;
                        }
                        if effective[4].is_some() {
                            append_calendar_key(result, PLIST_KEYS[4], w)?;
                        }
                        result.extend_from_slice(b"    </dict>\n");
                    }
                }
            }
        }
    }
    Ok(())
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug, PartialEq, Eq)]
pub enum TaskXmlError {
    #[error("InvalidCron")]
    InvalidCron,
    #[error("TooManyTriggers")]
    TooManyTriggers,
    #[error("OutOfMemory")]
    OutOfMemory,
}

/// Build a Windows Task Scheduler XML definition from a parsed cron expression.
/// Uses TimeTrigger+Repetition for simple intervals, CalendarTrigger for complex schedules.
#[cfg(windows)]
pub(crate) fn cron_to_task_xml(
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
    let can_use_repetition = days_is_wild
        && weekdays_is_wild
        && months_is_wild
        && 'blk: {
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
        let _ = writeln!(
            &mut xml,
            "      <StartBoundary>{}</StartBoundary>",
            bstr::BStr::new(sb)
        );

        if hours_count == 24 {
            // Case 1: minute-based repetition
            let m = minute_interval.unwrap();
            if m == 1 {
                xml.extend_from_slice(
                    b"      <Repetition><Interval>PT1M</Interval></Repetition>\n",
                );
            } else {
                let _ = writeln!(
                    &mut xml,
                    "      <Repetition><Interval>PT{}M</Interval></Repetition>",
                    m
                );
            }
        } else {
            // Case 2: hour-based repetition
            let h = hour_interval.unwrap();
            if h > 1 {
                let _ = writeln!(
                    &mut xml,
                    "      <Repetition><Interval>PT{}H</Interval></Repetition>",
                    h
                );
            }
        }

        xml.extend_from_slice(
            b"      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>\n",
        );
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
                let sb = buf_print(&mut sb_buf, format_args!("2000-01-01T{:02}:{:02}:00", h, m))
                    .map_err(|_| TaskXmlError::InvalidCron)?;

                // Emit day-of-month trigger if needed
                if !days_is_wild {
                    append_calendar_trigger_with_schedule(
                        &mut xml,
                        sb,
                        ScheduleType::ByMonth { cron: *cron },
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
                            ScheduleType::ByMonthDow { cron: *cron },
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

#[cfg(windows)]
fn append_days_of_month_xml(xml: &mut Vec<u8>, days: u32) -> Result<(), TaskXmlError> {
    xml.extend_from_slice(b"        <DaysOfMonth>\n");
    for day in 1..32u32 {
        if days & (1u32 << day) != 0 {
            let _ = writeln!(xml, "          <Day>{}</Day>", day);
        }
    }
    xml.extend_from_slice(b"        </DaysOfMonth>\n");
    Ok(())
}

#[cfg(windows)]
fn append_months_xml(xml: &mut Vec<u8>, months: u16) -> Result<(), TaskXmlError> {
    const MONTH_NAMES: [&str; 13] = [
        "",
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    xml.extend_from_slice(b"        <Months>\n");
    for mo in 1..13usize {
        if months & (1u16 << mo) != 0 {
            let _ = writeln!(xml, "          <{}/>", MONTH_NAMES[mo]);
        }
    }
    xml.extend_from_slice(b"        </Months>\n");
    Ok(())
}

#[cfg(windows)]
fn append_days_of_week_xml(xml: &mut Vec<u8>, weekdays: u8) -> Result<(), TaskXmlError> {
    const DAY_NAMES: [&str; 7] = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];
    xml.extend_from_slice(b"        <DaysOfWeek>\n");
    for d in 0..7usize {
        if weekdays & (1u8 << d) != 0 {
            let _ = writeln!(xml, "          <{}/>", DAY_NAMES[d]);
        }
    }
    xml.extend_from_slice(b"        </DaysOfWeek>\n");
    Ok(())
}

#[derive(Clone, Copy)]
#[cfg(windows)]
enum ScheduleType {
    ByDay,
    /// weekdays bitmask
    ByWeek(u8),
    ByMonth {
        cron: CronExpression,
    },
    ByMonthDow {
        cron: CronExpression,
    },
    /// months bitmask (daily with month restriction)
    ByMonthAllDays(u16),
}

#[cfg(windows)]
fn append_calendar_trigger_with_schedule(
    xml: &mut Vec<u8>,
    start_boundary: &[u8],
    sched: ScheduleType,
) -> Result<(), TaskXmlError> {
    xml.extend_from_slice(b"    <CalendarTrigger>\n");
    let _ = writeln!(
        xml,
        "      <StartBoundary>{}</StartBoundary>",
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
        ScheduleType::ByMonth { cron } => {
            xml.extend_from_slice(b"      <ScheduleByMonth>\n");
            append_days_of_month_xml(xml, cron.days)?;
            append_months_xml(xml, cron.months)?;
            xml.extend_from_slice(b"      </ScheduleByMonth>\n");
        }
        ScheduleType::ByMonthDow { cron } => {
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

/// Local stand-in for the planned `bun_core::BitOps` trait — only what
/// `compute_step_interval` needs, implemented for the two integer widths the
/// cron bitfields use.
#[cfg(windows)]
trait StepBits:
    Copy + core::ops::BitAnd<Output = Self> + core::ops::Sub<Output = Self> + PartialEq
{
    const ZERO: Self;
    const ONE: Self;
    fn count_ones(self) -> u32;
    fn trailing_zeros(self) -> u32;
}
#[cfg(windows)]
macro_rules! impl_step_bits {
    ($($t:ty),*) => {$(
        impl StepBits for $t {
            const ZERO: Self = 0;
            const ONE: Self = 1;
            #[inline] fn count_ones(self) -> u32 { <$t>::count_ones(self) }
            #[inline] fn trailing_zeros(self) -> u32 { <$t>::trailing_zeros(self) }
        }
    )*};
}
#[cfg(windows)]
impl_step_bits!(u32, u64);

/// If all set bits are evenly spaced, return the step size. Otherwise None.
#[cfg(windows)]
fn compute_step_interval<T: StepBits>(bits: T, _min: u8, max: u8) -> Option<u32> {
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

#[cfg(windows)]
use bun_core::fmt::buf_print;
