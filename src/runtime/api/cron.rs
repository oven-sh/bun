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
use core::future::Future;
use std::cell::Cell;

use bun_core::EncodedSlice;
#[cfg(not(windows))]
use bun_core::env_var;
use bun_io::KeepAlive;
use bun_jsc::bindgen::{Callable, JsLocal, JsScope, JsWrapper};
use bun_jsc::future::{self, AwaitSafe, LoopRef, Rejection};
use bun_jsc::virtual_machine::{HotReload, VirtualMachine};
use bun_jsc::{
    self as jsc, EncodedSliceJsc as _, GlobalRef, JSFunction, JSGlobalObject, JSObject, JSValue,
    JsCell, JsRef, JsResult,
};
use bun_paths as path;
use bun_ptr::{BackRef, RefPtr, ThisPtr};
#[cfg(not(target_os = "macos"))]
use bun_resolver::fs::FileSystem;
#[cfg(not(target_os = "macos"))]
use bun_resolver::fs::RealFS;

use crate::api::bun::process::{self as spawn, Status};
use crate::future::{Command, CommandError as Failure, Exit, command_error as failure};
use crate::generated_bindgen::cron::{
    Bun__Cron__cron, Bun__Cron__parse, Bun__Cron__remove, Bun__CronJob__onPromiseReject,
    Bun__CronJob__onPromiseResolve, CronOptions, js_CronJob as js,
};
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};
use bun_core::ZStr;
#[cfg(not(windows))]
use bun_core::strings;
#[cfg(target_os = "macos")]
use bun_sys::FdDirExt as _;
// Owned NUL-terminated string — `bun_str` exposes the
// borrowed `ZStr` only; the heap-backed counterpart is `bun_core::ZBox`.
use bun_core::ZBox as ZString;
use bun_sys::{self as sys, Fd, File};

use crate::jsc_hooks::timer_all_mut as timer_all;

// ============================================================================
// OS-level jobs — Bun.cron(path, schedule, title) and Bun.cron.remove(title)
// ============================================================================

/// The promise of an OS-level job, which keeps the process alive until it settles.
fn promise_of(
    cx: &mut JsScope<'_>,
    job: impl Future<Output = Result<(), Failure>> + AwaitSafe + 'static,
) -> JsResult<JSValue> {
    future::promise(&cx.js_thread(), |js| async move {
        let _keeps_loop_alive = LoopRef::new();
        match job.await {
            Ok(()) => Ok(JSValue::UNDEFINED),
            Err(message) => Err(Rejection::Value(
                EncodedSlice::utf8(&message).to_error_instance(js.global()),
            )),
        }
    })
}

/// The ends of a command, other than exit code 0, that are not a failure.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Tolerate {
    Nothing,
    /// `crontab -l` when the user has no crontab.
    #[cfg(all(not(target_os = "macos"), not(windows)))]
    ExitCode1,
    /// `schtasks /delete` of a task that does not exist.
    #[cfg(windows)]
    AnyExitCode,
    /// `launchctl bootout` of a service that may not be loaded.
    #[cfg(target_os = "macos")]
    AnyExitCodeOrSignal,
}

/// Run `argv` to its end.
async fn run(argv: &[&CStr], stdout: spawn::Stdio, tolerate: Tolerate) -> Result<Exit, Failure> {
    let exit = Command::spawn(argv, spawn::Stdio::Ignore, stdout)?.await?;
    match &exit.status {
        Status::Exited(exited) if exited.code != 0 => {
            let is_tolerated = match tolerate {
                Tolerate::Nothing => false,
                #[cfg(all(not(target_os = "macos"), not(windows)))]
                Tolerate::ExitCode1 => exited.code == 1,
                #[cfg(windows)]
                Tolerate::AnyExitCode => true,
                #[cfg(target_os = "macos")]
                Tolerate::AnyExitCodeOrSignal => true,
            };
            if !is_tolerated {
                #[cfg(windows)]
                {
                    let stderr = bun_core::strings::trim(&exit.stderr, &ASCII_WHITESPACE);
                    if !stderr.is_empty() {
                        return Err(stderr.to_vec());
                    }
                }
                return Err(failure!("Process exited with code {}", exited.code));
            }
        }
        Status::Signaled(signal) => {
            #[cfg(target_os = "macos")]
            let is_tolerated = tolerate == Tolerate::AnyExitCodeOrSignal;
            #[cfg(not(target_os = "macos"))]
            let is_tolerated = false;
            if !is_tolerated {
                return Err(failure!("Process killed by signal {}", *signal as i32));
            }
        }
        Status::Err(err) => {
            return Err(failure!("Process error: {}", bstr::BStr::new(err.name())));
        }
        Status::Exited(_) | Status::Running => {}
    }
    Ok(exit)
}

/// A file that is unlinked when this is dropped, however the job ends.
struct TempFile(Option<ZString>);

impl TempFile {
    fn create(
        path: ZString,
        flags: i32,
        mode: sys::Mode,
        contents: &[u8],
        [cannot_create, cannot_write]: [&str; 2],
    ) -> Result<Self, Failure> {
        let this = Self(Some(path));
        let file = File::openat(
            Fd::cwd(),
            this.path(),
            sys::O::WRONLY | sys::O::CREAT | flags,
            mode,
        )
        .map_err(|_| failure!("{cannot_create}"))?;
        let written = file.write_all(contents);
        let _ = file.close(); // close error is non-actionable
        written.map_err(|_| failure!("{cannot_write}"))?;
        Ok(this)
    }

    fn path(&self) -> &ZString {
        self.0.as_ref().expect("not kept")
    }

    #[cfg(target_os = "macos")]
    fn keep(mut self) -> ZString {
        self.0.take().expect("not kept")
    }
}

impl Drop for TempFile {
    fn drop(&mut self) {
        if let Some(path) = &self.0 {
            let _ = sys::unlink(path);
        }
    }
}

struct Registration {
    bun_exe: &'static ZStr,
    abs_path: ZString,
    /// normalized numeric form for crontab/launchd
    schedule: ZString,
    title: ZString,
    #[cfg(windows)]
    parsed_cron: CronExpression,
}

// -- Linux --

/// The user's crontab without the entry for `title`.
#[cfg(all(not(target_os = "macos"), not(windows)))]
async fn crontab_without(
    crontab: &ZString,
    title: &[u8],
    out_of_memory: &str,
) -> Result<Vec<u8>, Failure> {
    let listed = run(
        &[crontab.as_cstr(), c"-l"],
        spawn::Stdio::Buffer,
        Tolerate::ExitCode1,
    )
    .await?;
    let mut table = Vec::new();
    filter_crontab(&listed.stdout, title, &mut table).map_err(|_| failure!("{out_of_memory}"))?;
    Ok(table)
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
async fn install_crontab(
    crontab: &ZString,
    table: &[u8],
    prefix: &'static str,
) -> Result<(), Failure> {
    let path = make_temp_path(prefix).map_err(|_| failure!("Out of memory"))?;
    let messages = ["Failed to create temp file", "Failed to write temp file"];
    let file = TempFile::create(path, sys::O::EXCL, 0o600, table, messages)?;
    run(
        &[crontab.as_cstr(), file.path().as_cstr()],
        spawn::Stdio::Ignore,
        Tolerate::Nothing,
    )
    .await?;
    Ok(())
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
impl Registration {
    async fn register(self) -> Result<(), Failure> {
        let crontab = find_crontab().ok_or_else(|| failure!("crontab not found in PATH"))?;
        let title = self.title.as_bytes();
        let mut table = crontab_without(&crontab, title, "Out of memory building crontab").await?;
        // Single-quoted paths prevent shell injection
        let _ = write!(
            &mut table,
            "# bun-cron: {title}\n{sched} '{exe}' run --cron-title={title} --cron-period='{sched}' '{path}'\n",
            title = bstr::BStr::new(self.title.as_bytes()),
            sched = bstr::BStr::new(self.schedule.as_bytes()),
            exe = bstr::BStr::new(self.bun_exe.as_bytes()),
            path = bstr::BStr::new(self.abs_path.as_bytes()),
        );
        install_crontab(&crontab, &table, "bun-cron-").await
    }
}

#[cfg(all(not(target_os = "macos"), not(windows)))]
async fn unregister(title: ZString) -> Result<(), Failure> {
    let crontab = find_crontab().ok_or_else(|| failure!("crontab not found in PATH"))?;
    let table = crontab_without(&crontab, title.as_bytes(), "Out of memory").await?;
    install_crontab(&crontab, &table, "bun-cron-rm-").await
}

// -- macOS --

#[cfg(target_os = "macos")]
async fn bootout(title: &[u8]) -> Result<(), Failure> {
    let service = alloc_print_z(format_args!(
        "gui/{}/bun.cron.{}",
        get_uid(),
        bstr::BStr::new(title)
    ))
    .map_err(|_| failure!("Out of memory"))?;
    run(
        &[c"/bin/launchctl", c"bootout", service.as_cstr()],
        spawn::Stdio::Ignore,
        Tolerate::AnyExitCodeOrSignal,
    )
    .await?;
    Ok(())
}

#[cfg(target_os = "macos")]
impl Registration {
    async fn register(self) -> Result<(), Failure> {
        let plist = self.write_plist()?;
        bootout(self.title.as_bytes()).await?;
        let plist_path = plist.keep();
        let domain = alloc_print_z(format_args!("gui/{}", get_uid()))
            .map_err(|_| failure!("Out of memory"))?;
        run(
            &[
                c"/bin/launchctl",
                c"bootstrap",
                domain.as_cstr(),
                plist_path.as_cstr(),
            ],
            spawn::Stdio::Ignore,
            Tolerate::Nothing,
        )
        .await?;
        Ok(())
    }

    fn write_plist(&self) -> Result<TempFile, Failure> {
        let calendar_xml = cron_to_calendar_interval(self.schedule.as_bytes())
            .map_err(|_| failure!("Invalid cron expression"))?;

        let home = env_var::HOME
            .get()
            .ok_or_else(|| failure!("HOME environment variable not set"))?;

        let mut launch_agents_dir = home.to_vec();
        launch_agents_dir.extend_from_slice(b"/Library/LaunchAgents");
        Fd::cwd()
            .make_path(&launch_agents_dir)
            .map_err(|_| failure!("Failed to create ~/Library/LaunchAgents directory"))?;

        let plist_path = alloc_print_z(format_args!(
            "{}/Library/LaunchAgents/bun.cron.{}.plist",
            bstr::BStr::new(home),
            bstr::BStr::new(self.title.as_bytes())
        ))
        .map_err(|_| failure!("Out of memory"))?;

        // XML-escape all dynamic values
        let escape = |value: &[u8]| xml_escape(value).map_err(|_| failure!("Out of memory"));
        let xml_title = escape(self.title.as_bytes())?;
        let xml_bun = escape(self.bun_exe.as_bytes())?;
        let xml_path = escape(self.abs_path.as_bytes())?;
        let xml_sched = escape(self.schedule.as_bytes())?;

        let mut plist = Vec::new();
        let _ = write!(
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
        );

        let messages = ["Failed to create plist file", "Failed to write plist"];
        TempFile::create(plist_path, sys::O::TRUNC, 0o644, &plist, messages)
    }
}

#[cfg(target_os = "macos")]
async fn unregister(title: ZString) -> Result<(), Failure> {
    bootout(title.as_bytes()).await?;
    let home = env_var::HOME
        .get()
        .ok_or_else(|| failure!("HOME not set"))?;
    let plist_path = alloc_print_z(format_args!(
        "{}/Library/LaunchAgents/bun.cron.{}.plist",
        bstr::BStr::new(home),
        bstr::BStr::new(title.as_bytes())
    ))
    .map_err(|_| failure!("Out of memory"))?;
    let _ = sys::unlink(&plist_path);
    Ok(())
}

// -- Windows --

#[cfg(windows)]
const ASCII_WHITESPACE: [u8; 6] = *b" \t\n\r\x0b\x0c";

#[cfg(windows)]
fn task_name(title: &[u8]) -> Result<ZString, Failure> {
    alloc_print_z(format_args!("bun-cron-{}", bstr::BStr::new(title)))
        .map_err(|_| failure!("Out of memory"))
}

#[cfg(windows)]
impl Registration {
    async fn register(self) -> Result<(), Failure> {
        let task_name = task_name(self.title.as_bytes())?;
        let xml = cron_to_task_xml(
            &self.parsed_cron,
            self.bun_exe.as_bytes(),
            self.title.as_bytes(),
            self.schedule.as_bytes(),
            self.abs_path.as_bytes(),
        )
        .map_err(|e| match e {
            TaskXmlError::TooManyTriggers => failure!(
                "This cron expression requires too many triggers for Windows Task Scheduler (max 48). Simplify the expression or use fewer restricted fields."
            ),
            _ => failure!("Failed to build task XML"),
        })?;
        let xml_path = make_temp_path("bun-cron-xml-").map_err(|_| failure!("Out of memory"))?;
        let messages = [
            "Failed to create temp XML file",
            "Failed to write temp XML file",
        ];
        let xml_file = TempFile::create(xml_path, sys::O::EXCL, 0o600, &xml, messages)?;
        run(
            &[
                c"schtasks",
                c"/create",
                c"/xml",
                xml_file.path().as_cstr(),
                c"/tn",
                task_name.as_cstr(),
                c"/np",
                c"/f",
            ],
            spawn::Stdio::Ignore,
            Tolerate::Nothing,
        )
        .await
        .map_err(|stderr| {
            // A clear message in place of the raw schtasks output.
            if bun_core::index_of(&stderr, b"No mapping between account names").is_some() {
                return failure!(
                    "Failed to register cron job: your Windows account's Security Identifier (SID) could not be resolved. \
                     This typically happens on headless servers or CI where the process runs under a service account. \
                     To fix this, either run Bun as a regular user account, or create the scheduled task manually with: \
                     schtasks /create /xml <file> /tn <name> /ru SYSTEM /f"
                );
            }
            stderr
        })?;
        Ok(())
    }
}

#[cfg(windows)]
async fn unregister(title: ZString) -> Result<(), Failure> {
    let task_name = task_name(title.as_bytes())?;
    run(
        &[c"schtasks", c"/delete", c"/tn", task_name.as_cstr(), c"/f"],
        spawn::Stdio::Ignore,
        Tolerate::AnyExitCode,
    )
    .await?;
    Ok(())
}

/// Resolve the `{ tz?: string }` option to a `CronTz`.
fn resolve_cron_tz(global: &JSGlobalObject, options: Option<&CronOptions<'_>>) -> JsResult<CronTz> {
    let Some(tz_bytes) = options.and_then(|options| options.tz) else {
        return Ok(CronTz::Local);
    };
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

// -- JS entry points --

pub(crate) fn register_os_job(
    cx: &mut JsScope<'_>,
    path: &[u8],
    schedule: &[u8],
    title: &[u8],
) -> JsResult<JSValue> {
    let global = cx.global();

    // Validate title: only [a-zA-Z0-9_-]
    if !validate_title(title) {
        return Err(global.throw_invalid_arguments(format_args!(
            "Cron title must contain only alphanumeric characters, hyphens, and underscores"
        )));
    }

    // Parse and normalize cron schedule to numeric form for crontab/launchd/schtasks
    let parsed = match CronExpression::parse(schedule) {
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

    let abs_path = match resolve_path(global, path) {
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
    let registration = Registration {
        bun_exe,
        abs_path,
        schedule: ZString::from_bytes(normalized_schedule),
        title: ZString::from_bytes(title),
        #[cfg(windows)]
        parsed_cron: parsed,
    };
    promise_of(cx, registration.register())
}

pub(crate) fn remove(cx: &mut JsScope<'_>, title: &[u8]) -> JsResult<JSValue> {
    if !validate_title(title) {
        return Err(cx.global().throw_invalid_arguments(format_args!(
            "Cron title must contain only alphanumeric characters, hyphens, and underscores"
        )));
    }
    promise_of(cx, unregister(ZString::from_bytes(title)))
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
// (Aligned for `NativePromiseContext`, which packs its tag into the pointer's low bits.)
/// `CronJob`, declared in `cron.bind.ts`.
#[derive(bun_ptr::CellRefCounted)]
#[repr(align(16))]
pub(crate) struct CronJob {
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
    /// Set while a tick's promise is pending: the `NativePromiseContext` cell its reactions were
    /// given, which holds a ref on the job. The reaction that runs hands the ref back; the
    /// collector releases it if the promise is never settled; teardown takes it back.
    tick_cell: Cell<JSValue>,
    /// True between onTimerFire's cb.call() and processing of its result.
    in_fire: Cell<bool>,
    /// The context of the script that called `Bun.cron()`: its ticks are that script's.
    context: bun_jsc::ContextId,
    /// The job stops with that context, as its timers do.
    abort_handle: bun_jsc::AbortHandle,
}

bun_event_loop::impl_timer_owner!(CronJob; from_timer_ptr => event_loop_timer);
bun_jsc::impl_abort_handle_owner!(CronJob, abort_handle, |this, cause| {
    // SAFETY: trait contract — `this` is live (armed ⇒ not yet stopped).
    let job = unsafe { &*this };
    let vm_is_going = matches!(
        cause,
        bun_jsc::AbortCause::ContextStopped(bun_jsc::StopReason::VmTeardown)
    );
    CronJob::stop_with_its_context(
        job.self_ref.get().this_ptr(),
        job.global.bun_vm(),
        vm_is_going,
    )
});

#[derive(Clone, Copy, PartialEq, Eq, core::marker::ConstParamTy)]
pub(crate) enum ClearMode {
    Reload,
    Teardown,
}

impl CronJob {
    /// Defer downgrading the JS wrapper to weak until any in-flight promise
    /// has settled, so onPromiseReject can still read pendingPromise from
    /// the wrapper and pass the real Promise to unhandledRejection.
    fn maybe_downgrade(&self) {
        if self.stopped.get()
            && self.tick_cell.get().is_empty()
            && !matches!(self.this_value.get(), JsRef::Finalized)
        {
            self.this_value.with_mut(|v| v.downgrade());
        }
    }

    /// The job's script is gone (its context stopped): nothing reads the wrapper again, so the
    /// callback and what it closes over are not kept for a tick whose promise may never settle.
    fn let_go_of_wrapper(&self) {
        if !matches!(self.this_value.get(), JsRef::Finalized) {
            self.this_value.with_mut(|v| v.downgrade());
        }
    }

    /// Takes one ref as the cell's claim on the job and remembers the cell.
    fn create_tick_cell(this: ThisPtr<Self>) -> JSValue {
        debug_assert!(this.tick_cell.get().is_empty());
        bun_ptr::CellRefCounted::ref_(&*this);
        let cell =
            crate::api::native_promise_context::create(&this.global, this.as_ptr(), JSValue::ZERO);
        this.tick_cell.set(cell);
        cell
    }

    /// A reaction took the claim back from its cell. May free `this`.
    fn tick_settled(this: ThisPtr<Self>) {
        this.tick_cell.set(JSValue::ZERO);
        this.maybe_downgrade();
        <Self as bun_ptr::CellRefCounted>::deref_nn(bun_ptr::BackRef::from(this).into());
    }

    /// The tick's promise will not settle on this VM (it is going): take the claim back, so the
    /// reactions find an empty cell. May free `this`.
    fn reclaim_tick_claim(this: ThisPtr<Self>) {
        let cell = this.tick_cell.get();
        if !cell.is_empty() && crate::api::native_promise_context::take::<Self>(cell).is_some() {
            Self::tick_settled(this);
        }
    }

    /// From the cell's destructor (GC sweep): the tick's promise was collected unsettled. The
    /// field stops pointing at the dying cell now (a plain write); the claim is released from
    /// the event loop ([`tick_promise_collected`](Self::tick_promise_collected)).
    pub(crate) fn tick_cell_collected(&self) {
        self.tick_cell.set(JSValue::ZERO);
    }

    /// Releases the claim of a cell that was collected. May free `this`.
    ///
    /// # Safety
    /// `this` carries the collected cell's ref.
    pub(crate) unsafe fn tick_promise_collected(this: core::ptr::NonNull<Self>) {
        // SAFETY: fn contract.
        unsafe { this.as_ref() }.maybe_downgrade();
        <Self as bun_ptr::CellRefCounted>::deref_nn(this);
    }

    /// Idempotent — every step checks its own state.
    fn stop_internal(&self, _vm: &VirtualMachine) {
        self.stopped.set(true);
        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            timer_all().remove(self.event_loop_timer.as_ptr());
        }
        self.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        self.abort_handle.leave();
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

    /// The context of the script that scheduled the job stopped. A tick's promise that is pending
    /// may still settle (the host, or another graph, may hold it): its reactions' cell keeps the
    /// job until then, or until the promise is collected. Nothing else of the job is kept. With
    /// the tick's callback on the stack (it disposed its own graph) `on_timer_fire` finishes the
    /// stop when the callback returns. `vm_is_going`: the promise will not settle on this VM, so
    /// the claim is taken back now (the job leaves the list here, where
    /// `clear_all_for_vm::<Teardown>` would have found it). May free `this`.
    fn stop_with_its_context(this: ThisPtr<Self>, vm: &VirtualMachine, vm_is_going: bool) {
        if this.in_fire.get() {
            return Self::self_stop(this, vm);
        }
        // `remove_from_list` and `reclaim_tick_claim` may each drop the last ref.
        let _guard = RefPtr::from_this(this);
        this.stop_internal(vm);
        this.let_go_of_wrapper();
        Self::remove_from_list(this);
        if vm_is_going {
            Self::reclaim_tick_claim(this);
        }
    }

    /// May free `this`.
    fn self_stop(this: ThisPtr<Self>, vm: &VirtualMachine) {
        // While the callback is on the stack or its promise is pending, defer
        // list removal + downgrade to finishDeferredStop (called from
        // scheduleNext after settle) so onPromiseReject can read pendingPromise
        // and clearAllForVM(.teardown) can take the tick's claim back.
        if this.in_fire.get() || !this.tick_cell.get().is_empty() {
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
    /// the tick's claim is left for onPromiseResolve/Reject to take.
    /// `.teardown`: worker exit — the event loop is dying, settle never
    /// happens, so take the claim back here to avoid leaking the struct.
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
                Self::reclaim_tick_claim(this);
            }
        }
    }

    pub(crate) fn finalize(&self) {
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
        // The tick and what follows from it (the reactions on the promise it returns, what they
        // report) are the script's that scheduled the job.
        let _context = vm.enter_context(this.context);

        this.in_fire.set(true);
        // A top-level call: what the tick throws is reported here (before the
        // job is re-armed, so an `uncaughtException` handler's `stop()` is
        // observed by `schedule_next`), and does not stop the job — as with a
        // rejected tick.
        let result = vm.event_loop_mut().run_callback_with_result(
            this.context,
            cb,
            &this.global,
            js_this,
            &[],
        );
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
                    js::pending_promise_set_cached(js_this, &this.global, result);
                    // The reactions own the job's ref through their cell, not a raw pointer: a
                    // promise that settles after the job stopped finds the job, and one that
                    // never settles releases it when it is collected.
                    result.then_with_value(
                        &this.global,
                        Self::create_tick_cell(this),
                        Bun__CronJob__onPromiseResolve,
                        Bun__CronJob__onPromiseReject,
                    );
                    // `then_with_value()` returns `()`, so re-check the VM status and recover on
                    // termination: the reactions will not run.
                    if vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
                        js::pending_promise_set_cached(js_this, &this.global, JSValue::UNDEFINED);
                        Self::reclaim_tick_claim(this);
                        Self::schedule_next(this, vm);
                    } else if this.abort_handle.context_stopped() {
                        // The tick stopped its own context (`self_stop` deferred to here).
                        this.let_go_of_wrapper();
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

    pub(crate) fn stop<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        Self::self_stop(self.self_ref.get().this_ptr(), self.global.bun_vm());
        this_value
    }

    pub(crate) fn r#ref<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        if !self.stopped.get() {
            self.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        }
        this_value
    }

    pub(crate) fn unref<'a>(&self, this_value: JsWrapper<'a, Self>) -> JsWrapper<'a, Self> {
        self.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));
        this_value
    }

    pub(crate) fn register<'a>(
        cx: &mut JsScope<'a>,
        (schedule, schedule_value): (&[u8], JsLocal<'a>),
        handler: JsLocal<'a, Callable>,
        options: Option<&CronOptions<'a>>,
    ) -> JsResult<JSValue> {
        let tz = resolve_cron_tz(cx.global(), options)?;
        let cx = &cx.js_thread();
        let global = cx.global();

        let parsed = match CronExpression::parse(schedule) {
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
            tick_cell: Cell::new(JSValue::ZERO),
            in_fire: Cell::new(false),
            context: cx.context().id(),
            abort_handle: bun_jsc::AbortHandle::for_owner::<CronJob>(),
        });
        job.self_ref.set(BackRef::from(job.this_ptr()));

        let Some(next_time) = job.compute_next_timespec() else {
            return Err(global.throw_invalid_arguments(format_args!(
                "Cron expression '{}' has no future occurrences",
                bstr::BStr::new(schedule)
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
        js::cron_set_cached(js_value, global, schedule_value.to_js());
        js::callback_set_cached(
            js_value,
            global,
            handler.to_js().with_async_context_if_needed(global),
        );

        job.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        // SAFETY: heap-allocated (`RefPtr`); `stop_internal` leaves the context before the job is released.
        unsafe { bun_jsc::AbortHandle::arm_owner(job.as_ptr(), cx.context()) };
        timer_all().update(
            job.event_loop_timer
                .as_ptr()
                .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>(),
            &next_time,
        );

        Ok(js_value)
    }
}

pub(crate) fn on_promise_resolve(
    _: &mut JsScope<'_>,
    _: JsLocal<'_>,
    context: Option<core::ptr::NonNull<CronJob>>,
) {
    // The cell hands back the job's ref. None: the claim was taken back (the VM is going).
    let Some(job) = context else {
        return;
    };
    // SAFETY: the claim the cell handed back is a ref on the live job.
    let this = unsafe { ThisPtr::new(job.as_ptr()) };
    let _guard = scopeguard::guard(this, CronJob::tick_settled);
    let vm = this.global.bun_vm();
    if let Some(js_this) = this.this_value.get().try_get() {
        js::pending_promise_set_cached(js_this, &this.global, JSValue::UNDEFINED);
    }
    CronJob::schedule_next(this, vm);
}

pub(crate) fn on_promise_reject(
    _: &mut JsScope<'_>,
    reason: JsLocal<'_>,
    context: Option<core::ptr::NonNull<CronJob>>,
) {
    // As `on_promise_resolve`.
    let Some(job) = context else {
        return;
    };
    // SAFETY: the claim the cell handed back is a ref on the live job.
    let this = unsafe { ThisPtr::new(job.as_ptr()) };
    let _guard = scopeguard::guard(this, CronJob::tick_settled);
    let vm = this.global.bun_vm().as_mut();
    let err = reason.to_js();
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
}

// ============================================================================
// Bun.cron object builder
// ============================================================================

pub(crate) fn get_cron_object(global_this: &JSGlobalObject, _obj: &JSObject) -> JSValue {
    let cron_fn = JSFunction::create(global_this, "cron", Bun__Cron__cron, 3, Default::default());
    let remove_fn = JSFunction::create(
        global_this,
        "remove",
        Bun__Cron__remove,
        1,
        Default::default(),
    );
    let parse_fn = JSFunction::create(
        global_this,
        "parse",
        Bun__Cron__parse,
        1,
        Default::default(),
    );
    cron_fn.put(global_this, b"remove", remove_fn);
    cron_fn.put(global_this, b"parse", parse_fn);
    cron_fn
}

pub(crate) fn parse(
    cx: &mut JsScope<'_>,
    expression: &[u8],
    relative_date: Option<f64>,
    options: Option<&CronOptions<'_>>,
) -> JsResult<Option<f64>> {
    let global = cx.global();

    let parsed = match CronExpression::parse(expression) {
        Ok(p) => p,
        Err(e) => {
            return Err(global.throw_invalid_arguments(format_args!(
                "{}",
                bstr::BStr::new(CronExpression::error_message(e))
            )));
        }
    };

    let from_ms = relative_date.unwrap_or_else(|| bun_core::time::milli_timestamp() as f64);

    // An out-of-range `relative_date` is an invalid argument. next() would report it as "no match".
    if from_ms.is_nan() || from_ms.abs() > jsc::wtf::MAX_ECMASCRIPT_TIME {
        return Err(global.throw_invalid_arguments(format_args!("Invalid date value")));
    }

    let tz = resolve_cron_tz(global, options)?;

    parsed.next(global, from_ms, tz)
}

// ============================================================================
// Shared helpers
// ============================================================================

/// Find crontab binary using bun.which (searches PATH).
#[cfg(all(not(target_os = "macos"), not(windows)))]
fn find_crontab() -> Option<ZString> {
    let path_env = env_var::PATH.get().unwrap_or(b"/usr/bin:/bin");
    let mut buf = bun_paths::path_buffer_pool::get();
    let found = bun_which::which(&mut buf, path_env, b"", b"crontab")?;
    Some(ZString::from_bytes(found.as_bytes()))
}

fn resolve_path(global: &JSGlobalObject, path_: &[u8]) -> crate::Result<ZString> {
    let vm = global.bun_vm().as_mut();
    let srcloc = global.get_caller_src_loc();
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
    let mut name_buf = bun_paths::path_buffer_pool::get();
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
#[cfg(all(not(target_os = "macos"), not(windows)))]
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
