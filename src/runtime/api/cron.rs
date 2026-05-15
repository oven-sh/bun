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

use super::cron_parser::{self, CronExpression};

use core::ffi::c_char;
use std::cell::Cell;

use bun_core::env_var;
use bun_io::BufferedReader as OutputReader;
use bun_io::{KeepAlive, Loop as AsyncLoop};
use bun_jsc::event_loop::EventLoop;
use bun_jsc::virtual_machine::{HOT_RELOAD_HOT, VirtualMachine};
use bun_jsc::{
    self as jsc, CallFrame, EventLoopHandle, GlobalRef, JSFunction, JSGlobalObject, JSObject,
    JSPromise, JSValue, JsCell, JsRef, JsResult,
};
use bun_paths::{self as path, PathBuffer};
use bun_resolver::fs::{FileSystem, RealFS};
// `Process`/`Rusage`/`SpawnOptions`/`Status`/`spawn_process` live in
// `api::bun::process` (re-exported under `api::bun::spawn::posix_spawn`, but
// not at the `spawn` module root). Alias `process` as `spawn` so the
// `spawn::spawn_process(...)` call site below resolves.
use crate::api::bun::process::{
    self as spawn, Process, Rusage, SpawnOptions, SpawnResultExt as _, Status,
};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use bun_core::{ZStr, strings};
use bun_io::pipe_reader::BufferedReaderParent;
use bun_jsc::JsClass as _;
use bun_sys::FdDirExt as _;
// Owned NUL-terminated string (Zig `[:0]u8` allocation) — `bun_str` exposes the
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
// Zig: `fn CronJobBase(comptime Self: type) type { return struct { ... } }`
//
// PORT NOTE: every method on the path to `finish()` (which `heap::take`-
// drops `this`) takes a raw `*mut Self` receiver, mirroring the Zig `*Self`.
// A `&mut self` *parameter* would carry a Stacked Borrows FnEntry protector,
// making the in-flight dealloc UB; a *local* `let s = &mut *this` reborrow
// has no protector and ends at last use under NLL, so field access via `s`
// followed by `Self::finish(this)` is sound.
trait CronJobBase: Sized {
    fn remaining_fds_mut(&mut self) -> &mut i8;
    fn err_msg_mut(&mut self) -> &mut Option<Vec<u8>>;
    fn has_called_process_exit_mut(&mut self) -> &mut bool;
    fn exit_status_mut(&mut self) -> &mut Option<Status>;
    /// May free `this`. Caller must not touch `this` afterward.
    unsafe fn maybe_finished(this: *mut Self);

    fn loop_(&self) -> *mut AsyncLoop {
        // `VirtualMachine::uv_loop` already returns the native loop on both
        // targets (jsc/VirtualMachine.rs:2975); the prior POSIX arm's
        // `bun_uws::Loop::get()` named the same per-thread singleton.
        vm_mut().uv_loop()
    }

    fn event_loop(&self) -> *mut EventLoop {
        vm_mut().event_loop()
    }

    /// May free `this` via `maybe_finished`.
    unsafe fn on_reader_done(this: *mut Self) {
        // SAFETY: local reborrow, no protector; ends before `maybe_finished`.
        let s = unsafe { &mut *this };
        debug_assert!(*s.remaining_fds_mut() > 0);
        *s.remaining_fds_mut() -= 1;
        unsafe { Self::maybe_finished(this) };
    }

    /// May free `this` via `maybe_finished`.
    unsafe fn on_reader_error(this: *mut Self, err: sys::Error) {
        // SAFETY: local reborrow, no protector; ends before `maybe_finished`.
        let s = unsafe { &mut *this };
        debug_assert!(*s.remaining_fds_mut() > 0);
        *s.remaining_fds_mut() -= 1;
        if s.err_msg_mut().is_none() {
            let mut msg = Vec::new();
            let _ = write!(
                &mut msg,
                "Failed to read process output: {}",
                <&'static str>::from(err.get_errno())
            );
            *s.err_msg_mut() = Some(msg);
        }
        unsafe { Self::maybe_finished(this) };
    }

    /// May free `this` via `maybe_finished`.
    unsafe fn on_process_exit(this: *mut Self, _proc: &Process, status: Status, _rusage: &Rusage) {
        // SAFETY: local reborrow, no protector; ends before `maybe_finished`.
        let s = unsafe { &mut *this };
        *s.has_called_process_exit_mut() = true;
        *s.exit_status_mut() = Some(status);
        unsafe { Self::maybe_finished(this) };
    }
}

// ============================================================================
// CronRegisterJob
// ============================================================================

pub struct CronRegisterJob {
    promise: jsc::JSPromiseStrong,
    // LIFETIMES.tsv: JSC_BORROW → GlobalRef
    global: GlobalRef,
    poll: KeepAlive,

    bun_exe: &'static ZStr,
    abs_path: ZString,
    /// normalized numeric form for crontab/launchd
    schedule: ZString,
    title: ZString,
    parsed_cron: CronExpression,

    state: RegisterState,
    // LIFETIMES.tsv: SHARED — `Process` is intrusively refcounted (`*mut`).
    process: Option<*mut Process>,
    stdout_reader: OutputReader,
    stderr_reader: OutputReader,
    remaining_fds: i8,
    has_called_process_exit: bool,
    exit_status: Option<Status>,
    err_msg: Option<Vec<u8>>,
    tmp_path: Option<ZString>,
    /// Typed enum for the io-layer FilePoll vtable (`bun_io::EventLoopHandle`
    /// wraps `*const EventLoopHandle`).
    event_loop_handle: EventLoopHandle,
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

// Forward as raw ptr — `maybe_finished` (via `CronJobBase`) may free `this`.
bun_io::impl_buffered_reader_parent! {
    CronRegister for CronRegisterJob;
    has_on_read_chunk = false;
    on_reader_done  = |this| <Self as CronJobBase>::on_reader_done(this);
    on_reader_error = |this, err| <Self as CronJobBase>::on_reader_error(this, err);
    loop_           = |this| <Self as CronJobBase>::loop_(&*this).cast();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}

impl CronJobBase for CronRegisterJob {
    fn remaining_fds_mut(&mut self) -> &mut i8 {
        &mut self.remaining_fds
    }
    fn err_msg_mut(&mut self) -> &mut Option<Vec<u8>> {
        &mut self.err_msg
    }
    fn has_called_process_exit_mut(&mut self) -> &mut bool {
        &mut self.has_called_process_exit
    }
    fn exit_status_mut(&mut self) -> &mut Option<Status> {
        &mut self.exit_status
    }
    unsafe fn maybe_finished(this: *mut Self) {
        unsafe { CronRegisterJob::maybe_finished(this) }
    }
}

impl CronRegisterJob {
    fn set_err(&mut self, args: core::fmt::Arguments<'_>) {
        if self.err_msg.is_none() {
            let mut msg = Vec::new();
            let _ = msg.write_fmt(args);
            self.err_msg = Some(msg);
        }
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn maybe_finished(this: *mut Self) {
        // SAFETY: local reborrow (no FnEntry protector); not used after any
        // call below that may free `this`.
        let s = unsafe { &mut *this };
        if !s.has_called_process_exit || s.remaining_fds != 0 {
            return;
        }
        if let Some(proc) = s.process.take() {
            // SAFETY: `proc` is the intrusive-RC pointer returned by `to_process`.
            unsafe {
                (*proc).detach();
                Process::deref(proc);
            }
        }
        if s.err_msg.is_some() {
            return unsafe { Self::finish(this) };
        }
        let Some(status) = s.exit_status.take() else {
            return;
        };
        match status {
            Status::Exited(exited) => {
                if exited.code != 0
                    && !(s.state == RegisterState::ReadingCrontab && exited.code == 1)
                    && s.state != RegisterState::BootingOut
                {
                    // Materialize the trimmed stderr into an owned buffer:
                    // `final_buffer()` borrows `s` mutably, and `set_err`
                    // below needs another `&mut s` — copy out so the two
                    // borrows do not overlap (Windows only; POSIX ignores
                    // stderr here).
                    #[cfg(windows)]
                    let stderr_owned: Vec<u8> = bun_core::immutable::trim(
                        s.stderr_reader.final_buffer().as_slice(),
                        &ASCII_WHITESPACE,
                    )
                    .to_vec();
                    #[cfg(windows)]
                    let stderr_output: &[u8] = stderr_owned.as_slice();
                    #[cfg(not(windows))]
                    let stderr_output: &[u8] = b"";
                    // On Windows, detect the SID resolution error and provide
                    // a clear message instead of the raw schtasks output.
                    #[cfg(windows)]
                    {
                        if s.state == RegisterState::InstallingCrontab
                            && bun_core::index_of(
                                stderr_output,
                                b"No mapping between account names",
                            )
                            .is_some()
                        {
                            s.set_err(format_args!(
                                "Failed to register cron job: your Windows account's Security Identifier (SID) could not be resolved. \
                                 This typically happens on headless servers or CI where the process runs under a service account. \
                                 To fix this, either run Bun as a regular user account, or create the scheduled task manually with: \
                                 schtasks /create /xml <file> /tn <name> /ru SYSTEM /f"
                            ));
                            return unsafe { Self::finish(this) };
                        }
                    }
                    if !stderr_output.is_empty() {
                        s.set_err(format_args!("{}", bstr::BStr::new(stderr_output)));
                    } else {
                        s.set_err(format_args!("Process exited with code {}", exited.code));
                    }
                    return unsafe { Self::finish(this) };
                }
            }
            Status::Signaled(sig) => {
                if s.state != RegisterState::BootingOut {
                    s.set_err(format_args!("Process killed by signal {}", sig as i32));
                    return unsafe { Self::finish(this) };
                }
            }
            Status::Err(err) => {
                s.set_err(format_args!(
                    "Process error: {}",
                    <&'static str>::from(err.get_errno())
                ));
                return unsafe { Self::finish(this) };
            }
            Status::Running => return,
        }
        unsafe { Self::advance_state(this) };
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn advance_state(this: *mut Self) {
        // SAFETY: local reborrow; last use precedes any self-freeing call.
        let s = unsafe { &mut *this };
        #[cfg(target_os = "macos")]
        {
            match s.state {
                RegisterState::WritingPlist => unsafe { Self::spawn_bootout(this) },
                RegisterState::BootingOut => unsafe { Self::spawn_bootstrap(this) },
                RegisterState::Bootstrapping => unsafe { Self::finish(this) },
                _ => {
                    s.set_err(format_args!("Unexpected state"));
                    unsafe { Self::finish(this) };
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            match s.state {
                RegisterState::ReadingCrontab => unsafe { Self::process_crontab_and_install(this) },
                RegisterState::InstallingCrontab => unsafe { Self::finish(this) },
                _ => {
                    s.set_err(format_args!("Unexpected state"));
                    unsafe { Self::finish(this) };
                }
            }
        }
    }

    /// Consumes and frees `this` (`heap::take`).
    unsafe fn finish(this: *mut Self) {
        // SAFETY: caller holds the unique Box<Self>; consumed below. Local
        // reborrow has no FnEntry protector and is not used after the drop.
        let this_ref = unsafe { &mut *this };
        this_ref.state = if this_ref.err_msg.is_some() {
            RegisterState::Failed
        } else {
            RegisterState::Done
        };
        this_ref.poll.unref(bun_io::js_vm_ctx());
        let ev = VirtualMachine::get().event_loop_mut();
        ev.enter();
        if let Some(msg) = &this_ref.err_msg {
            let _ = this_ref.promise.reject_with_async_stack(
                &this_ref.global,
                Ok(this_ref
                    .global
                    .create_error_instance(format_args!("{}", bstr::BStr::new(msg)))),
            );
        } else {
            let _ = this_ref
                .promise
                .resolve(&this_ref.global, JSValue::UNDEFINED);
        }
        // Match Zig ordering: `defer ev.exit(); …; this.deinit();` — Drop runs
        // INSIDE the enter/exit scope so Process detach/deref and reader
        // teardown observe the entered event-loop state.
        // SAFETY: `this` was created via heap::alloc in cron_register.
        unsafe { drop(bun_core::heap::take(this)) };
        ev.exit();
    }

    /// May free `this` (via spawn → synchronous exit → finish, or error path).
    unsafe fn spawn_cmd(
        this: *mut Self,
        argv: &mut [*const c_char],
        stdin_opt: spawn::Stdio,
        stdout_opt: spawn::Stdio,
    ) {
        unsafe { spawn_cmd_generic(this, argv, stdin_opt, stdout_opt) };
    }

    // -- Linux --

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    #[cfg(not(windows))]
    unsafe fn start_linux(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_cmd`/`finish`.
        let s = unsafe { &mut *this };
        s.state = RegisterState::ReadingCrontab;
        s.stdout_reader = OutputReader::init::<CronRegisterJob>();
        s.stdout_reader.set_parent(this.cast());
        let Some(crontab_path) = find_crontab() else {
            s.set_err(format_args!("crontab not found in PATH"));
            return unsafe { Self::finish(this) };
        };
        let mut argv: [*const c_char; 3] =
            [crontab_path, b"-l\0".as_ptr().cast(), core::ptr::null()];
        unsafe { Self::spawn_cmd(this, &mut argv, spawn::Stdio::Ignore, spawn::Stdio::Buffer) };
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn process_crontab_and_install(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_cmd`/`finish`.
        let s = unsafe { &mut *this };
        let existing_content = s.stdout_reader.final_buffer().as_slice();
        let mut result: Vec<u8> = Vec::new();

        if filter_crontab(existing_content, s.title.as_bytes(), &mut result).is_err() {
            s.set_err(format_args!("Out of memory building crontab"));
            return unsafe { Self::finish(this) };
        }

        // Build new entry with single-quoted paths to prevent shell injection
        let mut new_entry = Vec::new();
        if write!(
            &mut new_entry,
            "# bun-cron: {title}\n{sched} '{exe}' run --cron-title={title} --cron-period='{sched}' '{path}'\n",
            title = bstr::BStr::new(s.title.as_bytes()),
            sched = bstr::BStr::new(s.schedule.as_bytes()),
            exe = bstr::BStr::new(s.bun_exe.as_bytes()),
            path = bstr::BStr::new(s.abs_path.as_bytes()),
        )
        .is_err()
        {
            s.set_err(format_args!("Out of memory"));
            return unsafe { Self::finish(this) };
        }
        result.extend_from_slice(&new_entry);

        let tmp_path = match make_temp_path("bun-cron-") {
            Ok(p) => p,
            Err(_) => {
                s.set_err(format_args!("Out of memory"));
                return unsafe { Self::finish(this) };
            }
        };
        let tmp_path_ptr = tmp_path.as_ptr();
        s.tmp_path = Some(tmp_path);

        let file = match File::openat(
            Fd::cwd(),
            s.tmp_path.as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
            0o600,
        ) {
            Ok(f) => f,
            Err(_) => {
                s.set_err(format_args!("Failed to create temp file"));
                return unsafe { Self::finish(this) };
            }
        };
        if file.write_all(&result).is_err() {
            let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
            s.set_err(format_args!("Failed to write temp file"));
            return unsafe { Self::finish(this) };
        }
        let _ = file.close(); // close error is non-actionable (Zig parity: discarded)

        s.state = RegisterState::InstallingCrontab;
        // PORT NOTE: explicit deinit of old reader before reassign — Drop handles it.
        s.stdout_reader = OutputReader::init::<CronRegisterJob>();
        let Some(crontab_path) = find_crontab() else {
            s.set_err(format_args!("crontab not found in PATH"));
            return unsafe { Self::finish(this) };
        };
        let mut argv: [*const c_char; 3] = [crontab_path, tmp_path_ptr.cast(), core::ptr::null()];
        unsafe { Self::spawn_cmd(this, &mut argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore) };
    }

    // -- macOS --

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn start_mac(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_bootout`/`finish`.
        let s = unsafe { &mut *this };
        s.state = RegisterState::WritingPlist;

        let calendar_xml = match cron_to_calendar_interval(s.schedule.as_bytes()) {
            Ok(x) => x,
            Err(_) => {
                s.set_err(format_args!("Invalid cron expression"));
                return unsafe { Self::finish(this) };
            }
        };

        let Some(home) = env_var::HOME.get() else {
            s.set_err(format_args!("HOME environment variable not set"));
            return unsafe { Self::finish(this) };
        };

        let mut launch_agents_dir = Vec::new();
        let _ = write!(
            &mut launch_agents_dir,
            "{}/Library/LaunchAgents",
            bstr::BStr::new(home)
        );
        if Fd::cwd().make_path(&launch_agents_dir).is_err() {
            s.set_err(format_args!(
                "Failed to create ~/Library/LaunchAgents directory"
            ));
            return unsafe { Self::finish(this) };
        }

        let plist_path = match alloc_print_z(format_args!(
            "{}/Library/LaunchAgents/bun.cron.{}.plist",
            bstr::BStr::new(home),
            bstr::BStr::new(s.title.as_bytes())
        )) {
            Ok(p) => p,
            Err(_) => {
                s.set_err(format_args!("Out of memory"));
                return unsafe { Self::finish(this) };
            }
        };
        s.tmp_path = Some(plist_path);

        // XML-escape all dynamic values
        macro_rules! try_escape {
            ($e:expr) => {
                match xml_escape($e) {
                    Ok(v) => v,
                    Err(_) => {
                        s.set_err(format_args!("Out of memory"));
                        return unsafe { Self::finish(this) };
                    }
                }
            };
        }
        let xml_title = try_escape!(s.title.as_bytes());
        let xml_bun = try_escape!(s.bun_exe.as_bytes());
        let xml_path = try_escape!(s.abs_path.as_bytes());
        let xml_sched = try_escape!(s.schedule.as_bytes());

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
            s.set_err(format_args!("Out of memory"));
            return unsafe { Self::finish(this) };
        }

        let file = match File::openat(
            Fd::cwd(),
            s.tmp_path.as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::TRUNC,
            0o644,
        ) {
            Ok(f) => f,
            Err(_) => {
                s.set_err(format_args!("Failed to create plist file"));
                return unsafe { Self::finish(this) };
            }
        };
        if file.write_all(&plist).is_err() {
            let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
            s.set_err(format_args!("Failed to write plist"));
            return unsafe { Self::finish(this) };
        }
        let _ = file.close(); // close error is non-actionable (Zig parity: discarded)

        unsafe { Self::spawn_bootout(this) };
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn spawn_bootout(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_cmd`/`finish`.
        let s = unsafe { &mut *this };
        s.state = RegisterState::BootingOut;
        let uid_str = match alloc_print_z(format_args!(
            "gui/{}/bun.cron.{}",
            get_uid(),
            bstr::BStr::new(s.title.as_bytes())
        )) {
            Ok(v) => v,
            Err(_) => {
                s.set_err(format_args!("Out of memory"));
                return unsafe { Self::finish(this) };
            }
        };
        let mut argv: [*const c_char; 4] = [
            b"/bin/launchctl\0".as_ptr().cast(),
            b"bootout\0".as_ptr().cast(),
            uid_str.as_ptr().cast(),
            core::ptr::null(),
        ];
        unsafe { Self::spawn_cmd(this, &mut argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore) };
        drop(uid_str);
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn spawn_bootstrap(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_cmd`/`finish`.
        let s = unsafe { &mut *this };
        s.state = RegisterState::Bootstrapping;
        let Some(plist_path) = s.tmp_path.take() else {
            s.set_err(format_args!("No plist path"));
            return unsafe { Self::finish(this) };
        };
        let uid_str = match alloc_print_z(format_args!("gui/{}", get_uid())) {
            Ok(v) => v,
            Err(_) => {
                s.set_err(format_args!("Out of memory"));
                return unsafe { Self::finish(this) };
            }
        };
        let mut argv: [*const c_char; 5] = [
            b"/bin/launchctl\0".as_ptr().cast(),
            b"bootstrap\0".as_ptr().cast(),
            uid_str.as_ptr().cast(),
            plist_path.as_ptr().cast(),
            core::ptr::null(),
        ];
        // tmp_path already cleared via take() — don't delete the installed plist
        unsafe { Self::spawn_cmd(this, &mut argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore) };
        drop(uid_str);
        drop(plist_path);
    }
}

// -- JS entry point -- (free fn: `#[host_fn]` Free shim calls bare `cron_register(..)`)

#[bun_jsc::host_fn]
pub fn cron_register(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<3>();

    // In-process callback cron: Bun.cron(schedule, handler)
    if args[1].is_callable() {
        return CronJob::register(global, args[0], args[1]);
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
    if bun_core::index_of_any(bun_exe.as_bytes(), b"'%").is_some() {
        return Err(global.throw_invalid_arguments(format_args!(
                "Bun executable path '{}' contains characters (' or %) that cannot be safely embedded in a crontab entry",
                bstr::BStr::new(bun_exe.as_bytes())
            )));
    }
    let job = bun_core::heap::into_raw(Box::new(CronRegisterJob {
        promise: jsc::JSPromiseStrong::init(global),
        global: GlobalRef::from(global),
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
        event_loop_handle: EventLoopHandle::init(vm_mut().event_loop().cast::<()>()),
    }));
    // SAFETY: just allocated; unique. Short-lived borrow ends before
    // `start_*` (which may free `job`).
    let promise_value = {
        let job_ref = unsafe { &mut *job };
        job_ref.poll.ref_(bun_io::js_vm_ctx());
        job_ref.promise.value()
    };

    // SAFETY: `job` is the freshly-leaked Box; `start_*` consumes it on
    // synchronous failure or hands it to the event loop on success.
    #[cfg(target_os = "macos")]
    unsafe {
        CronRegisterJob::start_mac(job)
    };
    #[cfg(windows)]
    unsafe {
        CronRegisterJob::start_windows(job)
    };
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    unsafe {
        CronRegisterJob::start_linux(job)
    };

    Ok(promise_value)
}

impl CronRegisterJob {
    // -- Windows --

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn start_windows(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_cmd`/`finish`.
        let s = unsafe { &mut *this };
        s.state = RegisterState::InstallingCrontab;

        let task_name = match alloc_print_z(format_args!(
            "bun-cron-{}",
            bstr::BStr::new(s.title.as_bytes())
        )) {
            Ok(v) => v,
            Err(_) => {
                s.set_err(format_args!("Out of memory"));
                return unsafe { Self::finish(this) };
            }
        };

        let xml = match cron_to_task_xml(
            &s.parsed_cron,
            s.bun_exe.as_bytes(),
            s.title.as_bytes(),
            s.schedule.as_bytes(),
            s.abs_path.as_bytes(),
        ) {
            Ok(x) => x,
            Err(e) => {
                if e == TaskXmlError::TooManyTriggers {
                    s.set_err(format_args!(
                        "This cron expression requires too many triggers for Windows Task Scheduler (max 48). Simplify the expression or use fewer restricted fields."
                    ));
                } else {
                    s.set_err(format_args!("Failed to build task XML"));
                }
                return unsafe { Self::finish(this) };
            }
        };

        let xml_path = match make_temp_path("bun-cron-xml-") {
            Ok(p) => p,
            Err(_) => {
                s.set_err(format_args!("Out of memory"));
                return unsafe { Self::finish(this) };
            }
        };
        let xml_path_ptr = xml_path.as_ptr();
        s.tmp_path = Some(xml_path);

        let file = match File::openat(
            Fd::cwd(),
            s.tmp_path.as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
            0o600,
        ) {
            Ok(f) => f,
            Err(_) => {
                s.set_err(format_args!("Failed to create temp XML file"));
                return unsafe { Self::finish(this) };
            }
        };
        if file.write_all(&xml).is_err() {
            let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
            s.set_err(format_args!("Failed to write temp XML file"));
            return unsafe { Self::finish(this) };
        }
        let _ = file.close(); // close error is non-actionable (Zig parity: discarded)

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
        unsafe { Self::spawn_cmd(this, &mut argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore) };
        drop(task_name);
    }
}

impl Drop for CronRegisterJob {
    fn drop(&mut self) {
        // stdout_reader / stderr_reader drop via their own Drop.
        if let Some(proc) = self.process.take() {
            // SAFETY: intrusive-RC pointer; we hold a ref.
            unsafe {
                (*proc).detach();
                Process::deref(proc);
            }
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
    // LIFETIMES.tsv: JSC_BORROW → GlobalRef
    global: GlobalRef,
    poll: KeepAlive,
    title: ZString,

    state: RemoveState,
    // LIFETIMES.tsv: SHARED — `Process` is intrusively refcounted (`*mut`).
    process: Option<*mut Process>,
    stdout_reader: OutputReader,
    stderr_reader: OutputReader,
    remaining_fds: i8,
    has_called_process_exit: bool,
    exit_status: Option<Status>,
    err_msg: Option<Vec<u8>>,
    tmp_path: Option<ZString>,
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
    Done,
    Failed,
}

// Forward as raw ptr — `maybe_finished` (via `CronJobBase`) may free `this`.
bun_io::impl_buffered_reader_parent! {
    CronRemove for CronRemoveJob;
    has_on_read_chunk = false;
    on_reader_done  = |this| <Self as CronJobBase>::on_reader_done(this);
    on_reader_error = |this, err| <Self as CronJobBase>::on_reader_error(this, err);
    loop_           = |this| <Self as CronJobBase>::loop_(&*this).cast();
    event_loop      = |this| (*this).event_loop_handle.as_event_loop_ctx();
}

impl CronJobBase for CronRemoveJob {
    fn remaining_fds_mut(&mut self) -> &mut i8 {
        &mut self.remaining_fds
    }
    fn err_msg_mut(&mut self) -> &mut Option<Vec<u8>> {
        &mut self.err_msg
    }
    fn has_called_process_exit_mut(&mut self) -> &mut bool {
        &mut self.has_called_process_exit
    }
    fn exit_status_mut(&mut self) -> &mut Option<Status> {
        &mut self.exit_status
    }
    unsafe fn maybe_finished(this: *mut Self) {
        unsafe { CronRemoveJob::maybe_finished(this) }
    }
}

impl CronRemoveJob {
    fn set_err(&mut self, args: core::fmt::Arguments<'_>) {
        if self.err_msg.is_none() {
            let mut msg = Vec::new();
            let _ = msg.write_fmt(args);
            self.err_msg = Some(msg);
        }
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn maybe_finished(this: *mut Self) {
        // SAFETY: local reborrow (no FnEntry protector); not used after any
        // call below that may free `this`.
        let s = unsafe { &mut *this };
        if !s.has_called_process_exit || s.remaining_fds != 0 {
            return;
        }
        if let Some(proc) = s.process.take() {
            // SAFETY: intrusive-RC pointer; we hold a ref.
            unsafe {
                (*proc).detach();
                Process::deref(proc);
            }
        }
        if s.err_msg.is_some() {
            return unsafe { Self::finish(this) };
        }
        let Some(status) = s.exit_status.take() else {
            return;
        };
        match status {
            Status::Exited(exited) => {
                let is_acceptable_nonzero = (s.state == RemoveState::ReadingCrontab
                    && exited.code == 1)
                    || s.state == RemoveState::BootingOut
                    // On Windows, schtasks /delete exits non-zero when the task doesn't exist;
                    // removal of a non-existent job should resolve without error.
                    || (cfg!(windows) && s.state == RemoveState::InstallingCrontab);
                if exited.code != 0 && !is_acceptable_nonzero {
                    // Owned copy: `final_buffer()` is `&mut self` and would
                    // alias `s.set_err` below. Copy the trimmed bytes out.
                    #[cfg(windows)]
                    let stderr_owned: Vec<u8> = bun_core::immutable::trim(
                        s.stderr_reader.final_buffer().as_slice(),
                        &ASCII_WHITESPACE,
                    )
                    .to_vec();
                    #[cfg(windows)]
                    let stderr_output: &[u8] = stderr_owned.as_slice();
                    #[cfg(not(windows))]
                    let stderr_output: &[u8] = b"";
                    if !stderr_output.is_empty() {
                        s.set_err(format_args!("{}", bstr::BStr::new(stderr_output)));
                    } else {
                        s.set_err(format_args!("Process exited with code {}", exited.code));
                    }
                    return unsafe { Self::finish(this) };
                }
            }
            Status::Signaled(sig) => {
                if s.state != RemoveState::BootingOut {
                    s.set_err(format_args!("Process killed by signal {}", sig as i32));
                    return unsafe { Self::finish(this) };
                }
            }
            Status::Err(err) => {
                s.set_err(format_args!(
                    "Process error: {}",
                    <&'static str>::from(err.get_errno())
                ));
                return unsafe { Self::finish(this) };
            }
            Status::Running => return,
        }
        unsafe { Self::advance_state(this) };
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn advance_state(this: *mut Self) {
        // SAFETY: local reborrow; last use precedes any self-freeing call.
        let s = unsafe { &mut *this };
        #[cfg(target_os = "macos")]
        {
            match s.state {
                RemoveState::BootingOut => {
                    let Some(home) = env_var::HOME.get() else {
                        s.set_err(format_args!("HOME not set"));
                        return unsafe { Self::finish(this) };
                    };
                    if let Ok(plist_path) = alloc_print_z(format_args!(
                        "{}/Library/LaunchAgents/bun.cron.{}.plist",
                        bstr::BStr::new(home),
                        bstr::BStr::new(s.title.as_bytes())
                    )) {
                        let _ = sys::unlink(&plist_path);
                    } else {
                        s.set_err(format_args!("Out of memory"));
                        return unsafe { Self::finish(this) };
                    }
                    unsafe { Self::finish(this) };
                }
                _ => {
                    s.set_err(format_args!("Unexpected state"));
                    unsafe { Self::finish(this) };
                }
            }
        }
        #[cfg(not(target_os = "macos"))]
        {
            match s.state {
                RemoveState::ReadingCrontab => unsafe { Self::remove_crontab_entry(this) },
                RemoveState::InstallingCrontab => unsafe { Self::finish(this) },
                _ => {
                    s.set_err(format_args!("Unexpected state"));
                    unsafe { Self::finish(this) };
                }
            }
        }
    }

    /// Consumes and frees `this` (`heap::take`).
    unsafe fn finish(this: *mut Self) {
        // SAFETY: caller holds the unique Box<Self>; consumed below. Local
        // reborrow has no FnEntry protector and is not used after the drop.
        let this_ref = unsafe { &mut *this };
        this_ref.state = if this_ref.err_msg.is_some() {
            RemoveState::Failed
        } else {
            RemoveState::Done
        };
        this_ref.poll.unref(bun_io::js_vm_ctx());
        let ev = VirtualMachine::get().event_loop_mut();
        ev.enter();
        if let Some(msg) = &this_ref.err_msg {
            let _ = this_ref.promise.reject_with_async_stack(
                &this_ref.global,
                Ok(this_ref
                    .global
                    .create_error_instance(format_args!("{}", bstr::BStr::new(msg)))),
            );
        } else {
            let _ = this_ref
                .promise
                .resolve(&this_ref.global, JSValue::UNDEFINED);
        }
        // Match Zig ordering: `defer ev.exit(); …; this.deinit();` — Drop runs
        // INSIDE the enter/exit scope so Process detach/deref and reader
        // teardown observe the entered event-loop state.
        // SAFETY: `this` was created via heap::alloc in cron_remove.
        unsafe { drop(bun_core::heap::take(this)) };
        ev.exit();
    }

    /// May free `this` (via spawn → synchronous exit → finish, or error path).
    unsafe fn spawn_cmd(
        this: *mut Self,
        argv: &mut [*const c_char],
        stdin_opt: spawn::Stdio,
        stdout_opt: spawn::Stdio,
    ) {
        unsafe { spawn_cmd_generic(this, argv, stdin_opt, stdout_opt) };
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    #[cfg(not(windows))]
    unsafe fn start_linux(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_cmd`/`finish`.
        let s = unsafe { &mut *this };
        s.state = RemoveState::ReadingCrontab;
        s.stdout_reader = OutputReader::init::<CronRemoveJob>();
        s.stdout_reader.set_parent(this.cast());
        let Some(crontab_path) = find_crontab() else {
            s.set_err(format_args!("crontab not found in PATH"));
            return unsafe { Self::finish(this) };
        };
        let mut argv: [*const c_char; 3] =
            [crontab_path, b"-l\0".as_ptr().cast(), core::ptr::null()];
        unsafe { Self::spawn_cmd(this, &mut argv, spawn::Stdio::Ignore, spawn::Stdio::Buffer) };
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn remove_crontab_entry(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_cmd`/`finish`.
        let s = unsafe { &mut *this };
        let existing_content = s.stdout_reader.final_buffer().as_slice();
        let mut result: Vec<u8> = Vec::new();

        if filter_crontab(existing_content, s.title.as_bytes(), &mut result).is_err() {
            s.set_err(format_args!("Out of memory"));
            return unsafe { Self::finish(this) };
        }

        let tmp_path = match make_temp_path("bun-cron-rm-") {
            Ok(p) => p,
            Err(_) => {
                s.set_err(format_args!("Out of memory"));
                return unsafe { Self::finish(this) };
            }
        };
        let tmp_path_ptr = tmp_path.as_ptr();
        s.tmp_path = Some(tmp_path);

        let file = match File::openat(
            Fd::cwd(),
            s.tmp_path.as_ref().unwrap(),
            sys::O::WRONLY | sys::O::CREAT | sys::O::EXCL,
            0o600,
        ) {
            Ok(f) => f,
            Err(_) => {
                s.set_err(format_args!("Failed to create temp file"));
                return unsafe { Self::finish(this) };
            }
        };
        if file.write_all(&result).is_err() {
            let _ = file.close(); // close error is non-actionable (Zig parity: discarded)
            s.set_err(format_args!("Failed to write temp file"));
            return unsafe { Self::finish(this) };
        }
        let _ = file.close(); // close error is non-actionable (Zig parity: discarded)

        s.state = RemoveState::InstallingCrontab;
        s.stdout_reader = OutputReader::init::<CronRemoveJob>();
        let Some(crontab_path) = find_crontab() else {
            s.set_err(format_args!("crontab not found in PATH"));
            return unsafe { Self::finish(this) };
        };
        let mut argv: [*const c_char; 3] = [crontab_path, tmp_path_ptr.cast(), core::ptr::null()];
        unsafe { Self::spawn_cmd(this, &mut argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore) };
    }

    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn start_mac(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_cmd`/`finish`.
        let s = unsafe { &mut *this };
        s.state = RemoveState::BootingOut;
        let uid_str = match alloc_print_z(format_args!(
            "gui/{}/bun.cron.{}",
            get_uid(),
            bstr::BStr::new(s.title.as_bytes())
        )) {
            Ok(v) => v,
            Err(_) => {
                s.set_err(format_args!("Out of memory"));
                return unsafe { Self::finish(this) };
            }
        };
        let mut argv: [*const c_char; 4] = [
            b"/bin/launchctl\0".as_ptr().cast(),
            b"bootout\0".as_ptr().cast(),
            uid_str.as_ptr().cast(),
            core::ptr::null(),
        ];
        unsafe { Self::spawn_cmd(this, &mut argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore) };
        drop(uid_str);
    }
}

// free fn: `#[host_fn]` Free shim calls bare `cron_remove(..)`
#[bun_jsc::host_fn]
pub fn cron_remove(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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

    let job = bun_core::heap::into_raw(Box::new(CronRemoveJob {
        promise: jsc::JSPromiseStrong::init(global),
        global: GlobalRef::from(global),
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
        event_loop_handle: EventLoopHandle::init(vm_mut().event_loop().cast::<()>()),
    }));
    // SAFETY: just allocated; unique. Short-lived borrow ends before
    // `start_*` (which may free `job`).
    let promise_value = {
        let job_ref = unsafe { &mut *job };
        job_ref.poll.ref_(bun_io::js_vm_ctx());
        job_ref.promise.value()
    };
    // SAFETY: `job` is the freshly-leaked Box; `start_*` consumes it on
    // synchronous failure or hands it to the event loop on success.
    #[cfg(target_os = "macos")]
    unsafe {
        CronRemoveJob::start_mac(job)
    };
    #[cfg(windows)]
    unsafe {
        CronRemoveJob::start_windows(job)
    };
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    unsafe {
        CronRemoveJob::start_linux(job)
    };
    Ok(promise_value)
}

impl CronRemoveJob {
    /// May free `this`. Raw-ptr receiver: see [`CronJobBase`] PORT NOTE.
    unsafe fn start_windows(this: *mut Self) {
        // SAFETY: local reborrow; not used after `spawn_cmd`/`finish`.
        let s = unsafe { &mut *this };
        s.state = RemoveState::InstallingCrontab;
        let task_name = match alloc_print_z(format_args!(
            "bun-cron-{}",
            bstr::BStr::new(s.title.as_bytes())
        )) {
            Ok(v) => v,
            Err(_) => {
                s.set_err(format_args!("Out of memory"));
                return unsafe { Self::finish(this) };
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
        unsafe { Self::spawn_cmd(this, &mut argv, spawn::Stdio::Ignore, spawn::Stdio::Ignore) };
        drop(task_name);
    }
}

impl Drop for CronRemoveJob {
    fn drop(&mut self) {
        if let Some(proc) = self.process.take() {
            // SAFETY: intrusive-RC pointer; we hold a ref.
            unsafe {
                (*proc).detach();
                Process::deref(proc);
            }
        }
        if let Some(p) = self.tmp_path.take() {
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
#[ref_count(destroy = Self::destroy_impl)]
pub struct CronJob {
    // bun.ptr.RefCount(...) intrusive — keep raw count for IntrusiveRc compat.
    ref_count: Cell<u32>,
    // pub: `bun_core::from_field_ptr!(CronJob, event_loop_timer)` needs `offset_of!` visibility.
    // `JsCell` is `#[repr(transparent)]`, so the byte offset of the inner
    // `EventLoopTimer` is identical and the dispatch.rs `owner!` macro works
    // unchanged.
    pub event_loop_timer: JsCell<EventLoopTimer>,
    // LIFETIMES.tsv: JSC_BORROW → GlobalRef. Read-only after construction.
    global: GlobalRef,
    // Read-only after construction.
    parsed: CronExpression,
    poll_ref: JsCell<KeepAlive>,
    this_value: JsCell<JsRef>,
    stopped: Cell<bool>,
    /// Last computed wall-clock fire target (ms epoch); floors the next search
    /// so monotonic-vs-wall skew can't recompute the same minute.
    last_next_ms: Cell<f64>,
    /// True while a ref() is held across an in-flight callback promise.
    /// Released exactly once by either onPromiseResolve/Reject or
    /// clearAllForVM(.teardown).
    pending_ref: Cell<bool>,
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

/// RAII owner for one intrusive refcount on a [`CronJob`].
type CronJobDerefOnDrop = bun_ptr::ScopedRef<CronJob>;

impl CronJob {
    /// `CellRefCounted::destroy` target (refcount hit zero).
    ///
    /// Safe fn: only reachable via the `#[ref_count(destroy = …)]` derive,
    /// whose generated trait `destroy` upholds the sole-owner contract.
    fn destroy_impl(this: *mut Self) {
        // deinit: this_value.deinit() then destroy.
        // SAFETY: last ref; nobody else holds a pointer.
        // PORT NOTE: `JsRef::deinit()` was dropped — Strong's Drop on
        // reassignment handles teardown (JSRef.rs trailer).
        unsafe {
            (*this).this_value.set(JsRef::empty());
            drop(bun_core::heap::take(this));
        }
    }
}

impl CronJob {
    /// `#[JsClass]` requires a `constructor`; the JS class is not directly
    /// constructible (`noConstructor` in .classes.ts) so this always throws.
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<Box<CronJob>> {
        Err(global.throw_invalid_arguments(format_args!(
            "CronJob cannot be constructed directly; use Bun.cron(schedule, handler)"
        )))
    }

    /// `self`'s address as `*mut Self` for raw-ptr-receiver helpers (e.g.
    /// `self_stop`, `schedule_next`). The callees deref it as `&*` (shared) —
    /// all mutation is `UnsafeCell`-backed — so no write provenance is
    /// required; the `*mut` spelling is purely to match the existing
    /// raw-ptr-receiver signature (which also stands for "callee may free
    /// the allocation").
    #[inline]
    fn as_ctx_ptr(&self) -> *mut Self {
        (self as *const Self).cast_mut()
    }

    /// Recover `&CronJob` from a raw-ptr receiver. Centralises the set-once
    /// `*mut Self → &Self` deref so the raw-ptr-receiver helpers
    /// (`release_pending_ref`, `self_stop`, `schedule_next`, `on_timer_fire`,
    /// `on_promise_*`) stay safe at the call site — one `unsafe` here, N safe
    /// callers.
    ///
    /// Only valid while the caller holds at least one intrusive ref (timer
    /// heap, list entry, `pending_ref`, or a `ref_guard`). R-2: shared borrow
    /// only — every field is `Cell`/`JsCell`/read-only-after-construction, so
    /// re-entrant JS forming a fresh `&Self` aliases soundly.
    #[inline]
    fn from_ctx_ptr<'a>(this: *mut Self) -> &'a Self {
        // SAFETY: every call site (private to this module) passes the
        // intrusively-refcounted heap allocation produced by [`as_ctx_ptr`] /
        // `as_promise_ptr` / `from_timer_ptr`, with refcount > 0 for the
        // returned borrow's duration. All mutation is interior, so a shared
        // `&Self` is sound even across JS re-entry.
        unsafe { &*this }
    }

    /// RAII pair for `ref_()` / `deref()`: bumps the intrusive refcount now and
    /// releases it on drop. Replaces the Zig `this.ref(); defer this.deref();`
    /// idiom. The guard holds a raw pointer (not `&mut Self`) so no Rust
    /// reference is live across the potential free in `deref()`.
    ///
    /// Safe under the same module-private invariant as [`from_ctx_ptr`]: every
    /// call site (private to this module) passes the intrusively-refcounted
    /// heap allocation with refcount > 0.
    #[inline]
    fn ref_guard(this: *mut Self) -> CronJobDerefOnDrop {
        // SAFETY: module-private invariant (see `from_ctx_ptr`) — `this` is the
        // live heap allocation with refcount > 0; `ScopedRef::new` bumps it so
        // the guard's `Drop` cannot free a dangling pointer.
        unsafe { CronJobDerefOnDrop::new(this) }
    }

    /// Defer downgrading the JS wrapper to weak until any in-flight promise
    /// has settled, so onPromiseReject can still read pendingPromise from
    /// the wrapper and pass the real Promise to unhandledRejection.
    fn maybe_downgrade(&self) {
        if self.stopped.get()
            && !self.pending_ref.get()
            && !matches!(self.this_value.get(), JsRef::Finalized)
        {
            self.this_value.with_mut(|v| v.downgrade());
        }
    }

    fn release_pending_ref(this: *mut Self) {
        let this_ref = Self::from_ctx_ptr(this);
        if this_ref.pending_ref.get() {
            this_ref.pending_ref.set(false);
            this_ref.maybe_downgrade();
            // SAFETY: `this` is a live Box-allocated CronJob; this releases one ref.
            unsafe { Self::deref(this) };
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
    fn finish_deferred_stop(this: *mut Self, vm: &VirtualMachine) {
        Self::from_ctx_ptr(this).stop_internal(vm);
        Self::remove_from_list(this, vm);
    }

    fn self_stop(this: *mut Self, vm: &VirtualMachine) {
        let this_ref = Self::from_ctx_ptr(this);
        // While the callback is on the stack or its promise is pending, defer
        // list removal + downgrade to finishDeferredStop (called from
        // scheduleNext after settle) so onPromiseReject can read pendingPromise
        // and clearAllForVM(.teardown) can release pending_ref.
        if this_ref.in_fire.get() || this_ref.pending_ref.get() {
            this_ref.stopped.set(true);
            this_ref.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
            return;
        }
        this_ref.stop_internal(vm);
        Self::remove_from_list(this, vm);
    }

    fn remove_from_list(this: *mut Self, vm: &VirtualMachine) {
        // PORT NOTE: `RareData::cron_jobs` stores the opaque
        // `rare_data::high_tier::CronJob`; cast through `*mut ()` for compare.
        // SAFETY: address-equality only.
        let needle = this.cast::<()>();
        // SAFETY: single JS thread; mutation of the per-VM Vec. Route through the
        // thread-local raw pointer (`VirtualMachine::get`) instead of upcasting
        // `&VirtualMachine` so the `invalid_reference_casting` lint stays clean.
        let _ = vm;
        let rare = VirtualMachine::get().as_mut().rare_data.as_mut();
        if let Some(rare) = rare {
            if let Some(i) = rare
                .cron_jobs
                .iter()
                .position(|&j| j.cast::<()>() == needle)
            {
                rare.cron_jobs.swap_remove(i);
                // SAFETY: `this` is a live Box-allocated CronJob; this releases one ref.
                unsafe { Self::deref(this) };
            }
        }
    }

    /// `.reload`: --hot — promises in flight will still settle on this VM, so
    /// the pending ref is left for onPromiseResolve/Reject to balance.
    /// `.teardown`: worker exit — the event loop is dying, settle never
    /// happens, so release the pending ref here to avoid leaking the struct.
    pub fn clear_all_for_vm<const MODE: ClearMode>(vm: &mut VirtualMachine) {
        // Drain the list first so `stop_internal` (which re-enters the VM)
        // doesn't alias the `rare` borrow.
        let jobs: Vec<*mut ()> = match vm.rare_data.as_mut() {
            Some(rare) => core::mem::take(&mut rare.cron_jobs)
                .into_iter()
                .map(|j| j.cast::<()>())
                .collect(),
            None => return,
        };
        for job in jobs {
            // PORT NOTE: stored as opaque `rare_data::high_tier::CronJob`; the
            // concrete type is this `CronJob` (see `register` push site).
            let job = job.cast::<CronJob>();
            // List holds a ref for each entry.
            Self::from_ctx_ptr(job).stop_internal(vm);
            if MODE == ClearMode::Teardown {
                Self::release_pending_ref(job);
            }
            // SAFETY: `job` is a live Box-allocated CronJob; this releases one ref.
            unsafe { Self::deref(job) };
        }
    }

    pub fn finalize(self: Box<Self>) {
        bun_ptr::finalize_js_box(self, |this| this.this_value.with_mut(|v| v.finalize()));
    }

    fn compute_next_timespec(&self) -> Option<bun_core::Timespec> {
        // Cron occurrences are calendar-based (real epoch); the timer heap is
        // monotonic. Anchor both to real time so fake timers don't half-apply.
        let now_ms: f64 = bun_core::time::milli_timestamp() as f64;
        // The monotonic timer can fire fractionally before the wall-clock target
        // (clock skew / NTP step); floor next() at the prior target so it can't
        // recompute the same minute and double-fire.
        let from_ms = now_ms.max(self.last_next_ms.get());
        let next_ms = match self.parsed.next(&self.global, from_ms) {
            Ok(Some(v)) => v,
            _ => return None,
        };
        self.last_next_ms.set(next_ms);
        let delta: i64 = (next_ms - now_ms).max(1.0) as i64;
        Some(bun_core::Timespec::ms_from_now(
            bun_core::TimespecMockMode::ForceRealTime,
            delta,
        ))
    }

    fn schedule_next(this: *mut Self, vm: &VirtualMachine) {
        let this_ref = Self::from_ctx_ptr(this);
        // Every path into here has just returned from user JS (the callback,
        // an uncaughtException handler, or an unhandledRejection handler). If
        // that JS called process.exit() / worker.terminate(), don't re-arm
        // the timer into a VM whose teardown now owns it.
        if this_ref.stopped.get()
            || vm.script_execution_status() != jsc::ScriptExecutionStatus::Running
        {
            this_ref.stopped.set(true);
            return Self::finish_deferred_stop(this, vm);
        }
        let Some(next_time) = this_ref.compute_next_timespec() else {
            return Self::finish_deferred_stop(this, vm);
        };
        timer_all().update(this_ref.event_loop_timer.as_ptr(), &next_time);
    }

    pub fn on_timer_fire(this: *mut Self, vm: &VirtualMachine) {
        // scheduleNext → finishDeferredStop downgrades this_value and derefs the
        // list entry; bracket-ref so that path can't drop the last ref mid-function.
        // Timer heap holds the entry; `this` is live until the guard drops.
        let _guard = Self::ref_guard(this);
        // Bracket-ref above keeps `this` alive across scheduleNext →
        // finishDeferredStop. R-2: shared (`&*`) — `cb.call()` re-enters JS,
        // which may call `stop()`/`ref()`/`unref()` on this same wrapper; a
        // `noalias` `&mut Self` here would be Stacked-Borrows UB. All mutation
        // is interior (`Cell`/`JsCell`).
        let this_ref = Self::from_ctx_ptr(this);
        this_ref
            .event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);

        if this_ref.stopped.get() {
            return;
        }
        if vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            Self::self_stop(this, vm);
            return;
        }

        let Some(js_this) = this_ref.this_value.get().try_get() else {
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

        // SAFETY: per-thread VM; `event_loop()` returns the live VM-owned
        // pointer. `enter_scope` calls `enter()` now and `exit()` on drop, and
        // holds the raw pointer (not `&mut`) so re-entrant JS can re-borrow.
        let _ev_guard = vm.enter_event_loop_scope();

        this_ref.in_fire.set(true);
        let result = match cb.call(&this_ref.global, js_this, &[]) {
            Ok(v) => {
                this_ref.in_fire.set(false);
                v
            }
            Err(_) => {
                this_ref.in_fire.set(false);
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
                    let global_ref = vm.global();
                    // SAFETY: single JS thread; `&mut` derived via the thread-local
                    // raw pointer (avoids `&T` → `&mut T` provenance laundering).
                    let _ = VirtualMachine::get()
                        .as_mut()
                        .uncaught_exception(global_ref, err, false);
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
                jsc::js_promise::Status::Pending => {
                    this_ref.ref_();
                    this_ref.pending_ref.set(true);
                    js::pending_promise_set_cached(js_this, &this_ref.global, result);
                    result.then(
                        &this_ref.global,
                        this,
                        Bun__CronJob__onPromiseResolve,
                        Bun__CronJob__onPromiseReject,
                    );
                    // Zig's `then()` is `TopExceptionScope`-wrapped and only fails
                    // on termination. The Rust `then()` returns `()`, so re-check
                    // the VM status and run the same recovery the Zig `catch`
                    // ran — otherwise `pending_ref` and the `ref_()` above leak.
                    if vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
                        js::pending_promise_set_cached(
                            js_this,
                            &this_ref.global,
                            JSValue::UNDEFINED,
                        );
                        Self::release_pending_ref(this);
                        Self::schedule_next(this, vm);
                    }
                    return;
                }
                jsc::js_promise::Status::Fulfilled => {}
                jsc::js_promise::Status::Rejected => {
                    promise.set_handled(this_ref.global.vm());
                    // `bun_jsc::AnyPromise` (lib.rs duplicate) lacks `.result()`;
                    // dispatch on the variant and call `JSPromise::result` directly.
                    // S012: `JSPromise` is an `opaque_ffi!` ZST — safe deref.
                    let reason = match promise {
                        jsc::AnyPromise::Normal(p) => {
                            jsc::JSPromise::opaque_mut(p).result(this_ref.global.vm())
                        }
                        jsc::AnyPromise::Internal(p) => {
                            jsc::JSPromise::opaque_mut(p).result(this_ref.global.vm())
                        }
                    };
                    // SAFETY: `vm.global` is live; `&mut` derived via the thread-local
                    // raw pointer (avoids `&T` → `&mut T` provenance laundering).
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
    pub fn stop(&self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: `bun_vm()` returns the per-thread singleton.
        // R-2: `self_stop` may `deref()` and free `self`; route through the
        // `*mut Self` ctx pointer (interior mutation only — see `as_ctx_ptr`).
        Self::self_stop(self.as_ctx_ptr(), self.global.bun_vm());
        Ok(frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(&self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        if !self.stopped.get() {
            self.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        }
        Ok(frame.this())
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(&self, _global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
        self.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
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

        // SAFETY: `bun_vm()` returns the per-thread singleton.
        let vm = global.bun_vm().as_mut();

        let job = bun_core::heap::into_raw(Box::new(CronJob {
            ref_count: Cell::new(1),
            event_loop_timer: JsCell::new(EventLoopTimer::init_paused(EventLoopTimerTag::CronJob)),
            global: GlobalRef::from(global),
            parsed,
            poll_ref: JsCell::new(KeepAlive::default()),
            this_value: JsCell::new(JsRef::empty()),
            stopped: Cell::new(false),
            last_next_ms: Cell::new(0.0),
            pending_ref: Cell::new(false),
            in_fire: Cell::new(false),
        }));
        // SAFETY: just allocated; unique. R-2: shared deref — all mutation is
        // interior.
        let job_ref = unsafe { &*job };

        let Some(next_time) = job_ref.compute_next_timespec() else {
            // SAFETY: `job` is a live Box-allocated CronJob; this releases one ref.
            unsafe { Self::deref(job) };
            return Err(global.throw_invalid_arguments(format_args!(
                "Cron expression '{}' has no future occurrences",
                bstr::BStr::new(schedule_slice.slice())
            )));
        };

        // The cron_jobs list exists so --hot reload and worker teardown can
        // stop/release jobs. Main-thread VMs without --hot never enumerate it,
        // so skip the list ref + append entirely.
        if vm.hot_reload == HOT_RELOAD_HOT || vm.worker.is_some() {
            job_ref.ref_(); // owned by cron_jobs entry
            // PORT NOTE: `RareData::cron_jobs` stores the opaque high-tier
            // placeholder type; cast through `*mut ()` and let inference pick
            // the element type.
            vm.rare_data().cron_jobs.push(job.cast::<()>().cast());
        }

        // SAFETY: `job` is a fresh `heap::alloc` pointer; ownership of one
        // ref transfers to the C++ wrapper (released via `finalize` → `deref`).
        let js_value = unsafe { Self::to_js_ptr(job, global) };
        job_ref
            .this_value
            .with_mut(|v| v.set_strong(js_value, global));
        js::cron_set_cached(js_value, global, schedule_arg);
        js::callback_set_cached(
            js_value,
            global,
            callback_arg.with_async_context_if_needed(global),
        );

        job_ref.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        timer_all().update(job_ref.event_loop_timer.as_ptr(), &next_time);

        Ok(js_value)
    }
}

// These MUST be *function* symbols: C++ `promiseHandlerID` compares the handler
// pointer passed to `JSValue::then` against `&Bun__CronJob__onPromiseResolve`
// by identity. A `static JSHostFn` would export a data slot whose address never
// matches the inner shim, tripping RELEASE_ASSERT_NOT_REACHED.
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bun__CronJob__onPromiseResolve(
        global: *mut JSGlobalObject,
        frame: *mut CallFrame,
    ) -> JSValue {
        let (global, frame) = unsafe { (&*global, &*frame) };
        jsc::host_fn::to_js_host_fn_result(global, on_promise_resolve(global, frame))
    }
}
bun_jsc::jsc_host_abi! {
    #[unsafe(no_mangle)]
    pub unsafe fn Bun__CronJob__onPromiseReject(
        global: *mut JSGlobalObject,
        frame: *mut CallFrame,
    ) -> JSValue {
        let (global, frame) = unsafe { (&*global, &*frame) };
        jsc::host_fn::to_js_host_fn_result(global, on_promise_reject(global, frame))
    }
}

fn on_promise_resolve(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let this: *mut CronJob = args[args.len() - 1].as_promise_ptr::<CronJob>();
    let _guard = scopeguard::guard(this, |p| CronJob::release_pending_ref(p));
    // `pending_ref` holds a ref on `this`.
    let this_ref = CronJob::from_ctx_ptr(this);
    // SAFETY: `bun_vm()` returns the per-thread singleton.
    let vm = this_ref.global.bun_vm();
    if let Some(js_this) = this_ref.this_value.get().try_get() {
        js::pending_promise_set_cached(js_this, &this_ref.global, JSValue::UNDEFINED);
    }
    CronJob::schedule_next(this, vm);
    Ok(JSValue::UNDEFINED)
}

fn on_promise_reject(_global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments();
    let this: *mut CronJob = args[args.len() - 1].as_promise_ptr::<CronJob>();
    let _guard = scopeguard::guard(this, |p| CronJob::release_pending_ref(p));
    // `pending_ref` holds a ref on `this`.
    let this_ref = CronJob::from_ctx_ptr(this);
    // SAFETY: `bun_vm()` returns the per-thread singleton.
    let vm = this_ref.global.bun_vm().as_mut();
    let err = args[0];
    let mut promise_value = JSValue::UNDEFINED;
    if let Some(js_this) = this_ref.this_value.get().try_get() {
        promise_value = js::pending_promise_get_cached(js_this).unwrap_or(JSValue::UNDEFINED);
        js::pending_promise_set_cached(js_this, &this_ref.global, JSValue::UNDEFINED);
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

pub fn get_cron_object(global_this: &JSGlobalObject, _obj: &JSObject) -> JSValue {
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
pub fn cron_parse(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let args = frame.arguments_as_array::<2>();

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
        if args[1].is_number() {
            args[1].to_number(global)?
        } else if args[1].js_type() == jsc::JSType::JSDate {
            args[1].to_number(global)?
        } else {
            return Err(global.throw_invalid_arguments(format_args!(
                "Bun.cron.parse() expects the second argument to be a Date or number (ms since epoch)"
            )));
        }
    } else {
        bun_core::time::milli_timestamp() as f64
    };

    if from_ms.is_nan() || from_ms.is_infinite() {
        return Err(global.throw_invalid_arguments(format_args!("Invalid date value")));
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
trait SpawnCmdTarget: CronJobBase + BufferedReaderParent {
    const EXIT_KIND: bun_spawn::ProcessExitKind;
    fn set_err(&mut self, args: core::fmt::Arguments<'_>);
    /// Consumes and frees `this`.
    unsafe fn finish(this: *mut Self);
    fn process_slot(&mut self) -> &mut Option<*mut Process>;
    fn stdout_reader(&mut self) -> &mut OutputReader;
    fn stderr_reader(&mut self) -> &mut OutputReader;
    fn remaining_fds(&mut self) -> &mut i8;
}

bun_spawn::link_impl_ProcessExit! {
    CronRegister for CronRegisterJob => |this| {
        // Forward `this` raw — `on_process_exit` → `maybe_finished` may free it.
        on_process_exit(process, status, rusage) =>
            <CronRegisterJob as CronJobBase>::on_process_exit(this, &*process, status, &*rusage),
    }
}
bun_spawn::link_impl_ProcessExit! {
    CronRemove for CronRemoveJob => |this| {
        on_process_exit(process, status, rusage) =>
            <CronRemoveJob as CronJobBase>::on_process_exit(this, &*process, status, &*rusage),
    }
}

impl SpawnCmdTarget for CronRegisterJob {
    const EXIT_KIND: bun_spawn::ProcessExitKind = bun_spawn::ProcessExitKind::CronRegister;
    fn set_err(&mut self, args: core::fmt::Arguments<'_>) {
        CronRegisterJob::set_err(self, args)
    }
    unsafe fn finish(this: *mut Self) {
        unsafe { CronRegisterJob::finish(this) }
    }
    fn process_slot(&mut self) -> &mut Option<*mut Process> {
        &mut self.process
    }
    fn stdout_reader(&mut self) -> &mut OutputReader {
        &mut self.stdout_reader
    }
    fn stderr_reader(&mut self) -> &mut OutputReader {
        &mut self.stderr_reader
    }
    fn remaining_fds(&mut self) -> &mut i8 {
        &mut self.remaining_fds
    }
}
impl SpawnCmdTarget for CronRemoveJob {
    const EXIT_KIND: bun_spawn::ProcessExitKind = bun_spawn::ProcessExitKind::CronRemove;
    fn set_err(&mut self, args: core::fmt::Arguments<'_>) {
        CronRemoveJob::set_err(self, args)
    }
    unsafe fn finish(this: *mut Self) {
        unsafe { CronRemoveJob::finish(this) }
    }
    fn process_slot(&mut self) -> &mut Option<*mut Process> {
        &mut self.process
    }
    fn stdout_reader(&mut self) -> &mut OutputReader {
        &mut self.stdout_reader
    }
    fn stderr_reader(&mut self) -> &mut OutputReader {
        &mut self.stderr_reader
    }
    fn remaining_fds(&mut self) -> &mut i8 {
        &mut self.remaining_fds
    }
}

/// Generic spawn used by both CronRegisterJob and CronRemoveJob.
///
/// May free `this` (synchronously, via either an early `T::finish` on setup
/// error or `watch_or_reap` → exit handler → `maybe_finished` → `finish`).
/// Raw-ptr receiver: see [`CronJobBase`] PORT NOTE. Callers must not touch
/// `this` after this returns.
unsafe fn spawn_cmd_generic<T: SpawnCmdTarget>(
    this: *mut T,
    argv: &mut [*const c_char],
    stdin_opt: spawn::Stdio,
    stdout_opt: spawn::Stdio,
) {
    // SAFETY: local reborrow (no FnEntry protector). Re-derived after each
    // section so no `&mut T` outlives a potentially-freeing call.
    let s = unsafe { &mut *this };
    *s.has_called_process_exit_mut() = false;
    *s.exit_status_mut() = None;
    *s.remaining_fds() = 0;

    #[allow(unused_mut)]
    let mut resolved_argv0: Option<*const c_char> = None;
    // Hoisted to function scope: `resolved_argv0` borrows into this buffer on
    // Windows and must outlive the SpawnOptions construction below.
    #[cfg(windows)]
    let mut path_buf = PathBuffer::uninit();
    #[cfg(windows)]
    {
        // Resolve the executable via bun.which, matching Bun.spawn's behavior.
        // `Transpiler::env()` is the audited safe `&Loader` accessor for the
        // process-lifetime dotenv loader (centralised single-unsafe deref).
        let path_env = vm_mut().transpiler.env().map.get(b"PATH").unwrap_or(b"");
        // SAFETY: argv[0] is a NUL-terminated string from caller.
        let argv0 = unsafe { core::ffi::CStr::from_ptr(argv[0]) }.to_bytes();
        match bun_which::which(&mut path_buf, path_env, b"", argv0) {
            Some(p) => resolved_argv0 = Some(p.as_ptr().cast()),
            None => {
                s.set_err(format_args!(
                    "Could not find '{}' in PATH",
                    bstr::BStr::new(argv0)
                ));
                return unsafe { T::finish(this) };
            }
        }
    }
    // PERF(port): was arena bulk-free for envp on Windows
    #[cfg(unix)]
    let envp: *const *const c_char = bun_core::c_environ();
    #[cfg(windows)]
    let envp_owned;
    #[cfg(windows)]
    let envp: *const *const c_char = {
        // `Transpiler::env_mut()` is the audited safe `&mut Loader` accessor
        // (process-lifetime singleton; centralised single-unsafe deref).
        match vm_mut()
            .transpiler
            .env_mut()
            .map
            .create_null_delimited_env_map()
        {
            Ok(v) => {
                envp_owned = v;
                envp_owned.as_ptr().cast()
            }
            Err(_) => {
                s.set_err(format_args!("Failed to create environment block"));
                return unsafe { T::finish(this) };
            }
        }
    };

    // PORT NOTE / OWNERSHIP: Zig stashes the heap libuv pipe in
    // `stderr_reader.source.?.pipe` and reuses the same pointer for
    // `SpawnOptions.stderr = .{ .buffer = pipe }`. In the Rust port BOTH
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
    // `mut` only for the Windows error-path `spawn_options.stderr.deinit()`.
    #[allow(unused_mut)]
    let mut spawn_options = SpawnOptions {
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

    let spawned = match spawn::spawn_process(&spawn_options, argv.as_mut_ptr().cast(), envp) {
        Ok(Ok(sp)) => sp,
        Ok(Err(err)) => {
            // `spawn_process_windows` only `heap::take`s the `Stdio::Buffer`
            // raw `*mut uv::Pipe` on the SUCCESS path; on every error return
            // ownership stays with the caller and `WindowsStdio` has no
            // `Drop`. Reclaim it (uv_close + free if init'd) here.
            #[cfg(windows)]
            spawn_options.stderr.deinit();
            s.set_err(format_args!(
                "Failed to spawn process: {}",
                bstr::BStr::new(err.name())
            ));
            return unsafe { T::finish(this) };
        }
        Err(e) => {
            #[cfg(windows)]
            spawn_options.stderr.deinit();
            s.set_err(format_args!("Failed to spawn process: {}", e.name()));
            return unsafe { T::finish(this) };
        }
    };
    let mut spawned = spawned;

    #[cfg(unix)]
    {
        if let Some(stdout) = spawned.stdout {
            let this_ptr = this.cast::<core::ffi::c_void>();
            if !spawned.memfds[1] {
                s.stdout_reader().set_parent(this_ptr);
                let _ = sys::set_nonblocking(stdout);
                *s.remaining_fds() += 1;
                {
                    use bun_io::pipe_reader::PosixFlags;
                    let flags = &mut s.stdout_reader().flags;
                    flags.insert(PosixFlags::NONBLOCKING | PosixFlags::SOCKET);
                    flags.remove(
                        PosixFlags::MEMFD
                            | PosixFlags::RECEIVED_EOF
                            | PosixFlags::CLOSED_WITHOUT_REPORTING,
                    );
                }
                if s.stdout_reader().start(stdout, true).is_err() {
                    s.set_err(format_args!("Failed to start reading stdout"));
                    return unsafe { T::finish(this) };
                }
                if let Some(p) = s.stdout_reader().handle.get_poll() {
                    p.set_flag(bun_io::FilePollFlag::Socket);
                }
            } else {
                s.stdout_reader().set_parent(this_ptr);
                s.stdout_reader().start_memfd(stdout);
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
            s.stderr_reader().source = Some(bun_io::Source::Pipe(pipe));
            s.stderr_reader()
                .set_parent(this.cast::<core::ffi::c_void>());
            *s.remaining_fds() += 1;
            if s.stderr_reader().start_with_current_pipe().is_err() {
                s.set_err(format_args!("Failed to start reading stderr"));
                return unsafe { T::finish(this) };
            }
        }
    }

    let ev_handle = EventLoopHandle::init(vm_mut().event_loop().cast::<()>());
    let process = spawned.to_process(ev_handle, false);
    *s.process_slot() = Some(process);
    // SAFETY: `process` was just allocated by `to_process`; we hold the only
    // ref. `this` is the owning `Box<T>` (only freed in `T::finish`, gated on
    // `has_called_process_exit`), so it outlives `process`.
    unsafe { (*process).set_exit_handler(bun_spawn::ProcessExit::new(T::EXIT_KIND, this)) };
    // `s` not used past this point — `watch_or_reap` may synchronously invoke
    // the exit handler, which can free `this`.
    // SAFETY: `process` is live; `watch_or_reap` may synchronously invoke the
    // exit handler (which re-enters `this` via the vtable thunk).
    match unsafe { (*process).watch_or_reap() } {
        Err(err) => {
            if !unsafe { (*process).has_exited() } {
                // SAFETY: all-zero is a valid Rusage.
                let rusage = bun_core::ffi::zeroed::<Rusage>();
                unsafe { (*process).on_exit(Status::Err(err), &rusage) };
            }
        }
        Ok(_) => {}
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
        // The returned `*const c_char` borrows this buffer, so it must outlive
        // the call. `Bun.cron` is exposed on every `BunObject`, so this is
        // reachable from the main JS thread *and* any Worker thread
        // concurrently — a process-global `static` would be a data race.
        // `thread_local!` gives each JS thread its own scratch buffer; the
        // returned pointer is consumed on the same thread (copied by
        // `posix_spawn`) before any later call can overwrite it. Non-Windows
        // only, so `MAX_PATH_BYTES` is ≤4 KiB and inline TLS is fine.
        thread_local! {
            static BUF: core::cell::RefCell<bun_core::PathBuffer> =
                const { core::cell::RefCell::new(bun_core::PathBuffer::ZEROED) };
        }
        let path_env = env_var::PATH.get().unwrap_or(b"/usr/bin:/bin");
        // `bun_which::which` is a pure PATH walk that cannot reenter
        // `find_crontab`, so the `RefCell` borrow is never contested. The
        // returned raw pointer escapes the `RefMut` guard but stays valid:
        // it points into per-thread storage and is consumed by `posix_spawn`
        // on this thread before any later call could overwrite the buffer.
        BUF.with_borrow_mut(|buf| {
            let found = bun_which::which(buf, path_env, b"", b"crontab")?;
            Some(found.as_ptr().cast())
        })
    }
}

fn resolve_path(
    global: &JSGlobalObject,
    frame: &CallFrame,
    path_: &[u8],
) -> Result<ZString, bun_core::Error> {
    // SAFETY: `bun_vm()` returns the per-thread singleton.
    let vm = global.bun_vm().as_mut();
    let srcloc = frame.get_caller_src_loc(global);
    let caller_utf8 = srcloc.str.to_utf8();
    let raw_dir = path::resolve_path::dirname::<path::platform::Auto>(caller_utf8.slice());
    let source_dir: &[u8] = if raw_dir.is_empty() { b"." } else { raw_dir };
    let mut resolved = vm
        .transpiler
        .resolver
        .resolve(source_dir, path_, bun_ast::ImportKind::EntryPointRun)
        .map_err(|_| bun_core::err!("ModuleNotFound"))?;
    let entry_path = resolved.path().ok_or(bun_core::err!("ModuleNotFound"))?;
    Ok(ZString::from_bytes(entry_path.text))
}

fn alloc_print_z(args: core::fmt::Arguments<'_>) -> Result<ZString, bun_alloc::AllocError> {
    let mut v = Vec::new();
    v.write_fmt(args).map_err(|_| bun_alloc::AllocError)?;
    Ok(ZString::from_vec(v))
}

/// Create a temp file path with a random suffix to avoid TOCTOU/symlink attacks.
fn make_temp_path(prefix: &'static str) -> Result<ZString, bun_alloc::AllocError> {
    let mut name_buf = PathBuffer::uninit();
    // PORT NOTE: Zig used `prefix ++ "tmp"` at comptime; concat at runtime here.
    // TODO(port): use const_format::concatcp! once call sites pass a const.
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

/// Get the current user ID portably.
pub fn get_uid() -> u32 {
    #[cfg(unix)]
    {
        // `bun_sys::c::getuid` is declared `safe fn` (no args, never fails) —
        // discharges the per-site proof the raw `libc` decl required.
        sys::c::getuid() as u32
    }
    #[cfg(not(unix))]
    {
        0
    }
}

/// Validate title: only [a-zA-Z0-9_-], non-empty.
pub fn validate_title(title: &[u8]) -> bool {
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
pub fn filter_crontab(
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
pub fn xml_escape(input: &[u8]) -> Result<Vec<u8>, bun_alloc::AllocError> {
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
    #[error("OutOfMemory")]
    OutOfMemory,
}
// TODO(port): narrow error set

impl From<CalendarError> for bun_core::Error {
    fn from(e: CalendarError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

pub fn cron_to_calendar_interval(schedule: &[u8]) -> Result<Vec<u8>, CalendarError> {
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
            // Zig: std.fmt.parseInt(i32, part, 10) on raw []const u8.
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

impl From<TaskXmlError> for bun_core::Error {
    fn from(e: TaskXmlError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

/// Build a Windows Task Scheduler XML definition from a parsed cron expression.
/// Uses TimeTrigger+Repetition for simple intervals, CalendarTrigger for complex schedules.
pub fn cron_to_task_xml(
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
        let _ = write!(
            &mut xml,
            "      <StartBoundary>{}</StartBoundary>\n",
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
                        ScheduleType::ByMonth {
                            cron: *cron,
                            months_is_wild,
                        },
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
                            ScheduleType::ByMonthDow {
                                cron: *cron,
                                months_is_wild,
                            },
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
            let _ = write!(xml, "          <{}/>\n", MONTH_NAMES[mo]);
        }
    }
    xml.extend_from_slice(b"        </Months>\n");
    Ok(())
}

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
    ByMonth {
        cron: CronExpression,
        months_is_wild: bool,
    },
    ByMonthDow {
        cron: CronExpression,
        months_is_wild: bool,
    },
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

/// Local stand-in for the planned `bun_core::BitOps` trait — only what
/// `compute_step_interval` needs, implemented for the two integer widths the
/// cron bitfields use.
// TODO(port): replace with `bun_core::BitOps` once that trait lands.
trait StepBits:
    Copy + core::ops::BitAnd<Output = Self> + core::ops::Sub<Output = Self> + PartialEq
{
    const ZERO: Self;
    const ONE: Self;
    fn count_ones(self) -> u32;
    fn trailing_zeros(self) -> u32;
}
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
impl_step_bits!(u32, u64);

/// If all set bits are evenly spaced, return the step size. Otherwise None.
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

use bun_core::fmt::buf_print;

// ported from: src/runtime/api/cron.zig
