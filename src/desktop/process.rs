//! This process and those that it starts, and what Electron adds to `process`.

use std::time::{Instant, SystemTime};

use bun_core::CStringList;
use bun_jsc::JSGlobalObject;

use crate::generated_bindgen::electron::DesktopProcess;
use crate::prelude::*;
use crate::{files, text};

unsafe extern "C" {
    safe fn Bun__Desktop__totalMemory() -> usize;
    safe fn Bun__Desktop__heapStatistics(
        global: &JSGlobalObject,
        capacity: &mut usize,
        size: &mut usize,
    );
    safe fn Bun__Os__getFreeMemory() -> u64;
    safe fn Bun__generateHeapSnapshotV8(vm: &bun_jsc::VM) -> bun_core::String;
    safe fn getRSS(bytes: &mut usize) -> i32;
}

pub(crate) fn object() -> JSValue {
    bun_ui::process()
}

/// From `process.env`, which the app may have changed. `None` if it is empty.
pub(crate) fn variable(name: &str) -> JsResult<Option<String>> {
    let value = bun_ui::environment(global(), name)?;
    Ok(value.filter(|it| !it.is_empty()).map(|it| string(&it)))
}

pub(crate) fn variables() -> JsResult<Vec<(String, String)>> {
    let all = get(object(), "env")?;
    let with_value = |name: String| Ok((text_of(get_by_value(global(), all, js(&*name)?)?)?, name));
    let entries = texts_of(all.keys(global())?)?.into_iter().map(with_value);
    entries
        .map(|it| it.map(|(value, name)| (name, value)))
        .collect()
}

pub(crate) fn environment(except: &str) -> JsResult<CStringList> {
    let mut all = variables()?;
    all.retain(|it| it.0 != except);
    let entries = (all.iter()).map(|it| [it.0.as_bytes(), b"=", it.1.as_bytes()]);
    Ok(CStringList::from_parts(entries))
}

pub(crate) fn arguments() -> JsResult<Vec<String>> {
    texts_of(get(object(), "argv")?)
}

pub(crate) fn executable() -> String {
    bun_core::self_exe_path().map_or_else(|_| String::new(), |it| string(it.as_bytes()))
}

pub(crate) fn main_script() -> String {
    string(global().bun_vm().main().unwrap_or_default())
}

pub(crate) fn id() -> u32 {
    std::process::id()
}

#[cfg(unix)]
pub(crate) fn home_of_user() -> String {
    let mut entry = core::mem::MaybeUninit::<libc::passwd>::uninit();
    let (mut strings, mut found) = ([0; 4096], core::ptr::null_mut());
    // SAFETY: the buffers are as large as it is told, and `found` points into them unless it is null.
    unsafe {
        libc::getpwuid_r(
            libc::geteuid(),
            entry.as_mut_ptr(),
            strings.as_mut_ptr(),
            strings.len(),
            &raw mut found,
        );
        found.as_ref().map_or_else(
            || "/".into(),
            |it| string(core::ffi::CStr::from_ptr(it.pw_dir).to_bytes()),
        )
    }
}

#[cfg(not(unix))]
pub(crate) fn home_of_user() -> String {
    "/".into()
}

#[cfg(unix)]
pub(crate) fn is_running(id: u32) -> bool {
    // SAFETY: the signal 0 is not sent.
    i32::try_from(id).is_ok_and(|id| id > 0 && unsafe { libc::kill(id, 0) } == 0)
}

#[cfg(not(unix))]
pub(crate) fn is_running(_: u32) -> bool {
    false
}

/// Waits for it, and returns whether it has succeeded.
pub(crate) fn run(command: &[&str]) -> JsResult<bool> {
    use bun_spawn::sync::{Options, Stdio, spawn};
    let (search, mut found) = (
        variable("PATH")?.unwrap_or_default(),
        bun_paths::path_buffer_pool::get(),
    );
    let Some(program) = bun_which::which(&mut found, search.as_bytes(), b"", command[0].as_bytes())
    else {
        return Ok(false);
    };
    let arguments = command[1..].iter().map(|it| it.as_bytes());
    let environment = environment("")?;
    let options = Options {
        stdout: Stdio::Ignore,
        stderr: Stdio::Ignore,
        argv: core::iter::once(program.as_bytes())
            .chain(arguments)
            .map(Box::from)
            .collect(),
        envp: Some(environment.as_list()),
        ..Options::default()
    };
    Ok(matches!(spawn(&options), Ok(Ok(result)) if result.is_ok()))
}

/// It outlives this one.
#[cfg(unix)]
pub(crate) fn start(command: &[String], environment: &CStringList) {
    use bun_spawn_sys::spawn_process::{PosixSpawnOptions, PosixStdio, spawn_process_posix};
    let options = PosixSpawnOptions {
        stdin: PosixStdio::Ignore,
        detached: true,
        linux_pdeathsig: Some(0),
        ..PosixSpawnOptions::default()
    };
    let arguments = CStringList::from_parts(command.iter().map(|it| [it.as_bytes()]));
    let _ = spawn_process_posix(&options, arguments.as_list(), Some(environment.as_list()));
}

#[cfg(not(unix))]
pub(crate) fn start(_: &[String], _: &CStringList) {}

state!(fn last_steps() -> RefCell<Vec<fn()>>);

/// After the listeners of `exit`. Asking twice makes no difference.
pub(crate) fn at_exit(step: fn()) {
    let run_all = || last_steps().take().into_iter().for_each(|step| step());
    global().bun_vm().exit_handler.last_steps.set(Some(run_all));
    let mut steps = last_steps().borrow_mut();
    if !steps.iter().any(|it| core::ptr::fn_addr_eq(*it, step)) {
        steps.push(step);
    }
}

pub(crate) fn exit(code: JSValue) -> JsResult<()> {
    invoke(object(), "exit", &[code]).map(drop)
}

pub(crate) fn inspect(thrown: JSValue) -> JsResult<String> {
    if thrown.is_any_error() {
        let stack = get(thrown, "stack")?;
        return text_of(if stack.is_string() { stack } else { thrown });
    }
    let mut formatter = bun_jsc::console_object::Formatter::new(global());
    Ok(format!("{}", thrown.to_fmt(&mut formatter)))
}

struct Usage {
    cpu_seconds: f64,
    peak_kilobytes: f64,
}

#[cfg(unix)]
fn usage() -> Usage {
    let mut usage = core::mem::MaybeUninit::<libc::rusage>::zeroed();
    // SAFETY: it has only numbers, for which zeros are valid.
    let usage = unsafe {
        libc::getrusage(libc::RUSAGE_SELF, usage.as_mut_ptr());
        usage.assume_init()
    };
    let seconds = |it: libc::timeval| it.tv_sec as f64 + it.tv_usec as f64 / 1e6;
    Usage {
        cpu_seconds: seconds(usage.ru_utime) + seconds(usage.ru_stime),
        peak_kilobytes: usage.ru_maxrss as f64 / if IS_MAC { 1024. } else { 1. },
    }
}

#[cfg(not(unix))]
fn usage() -> Usage {
    Usage {
        cpu_seconds: 0.,
        peak_kilobytes: 0.,
    }
}

fn kilobytes(bytes: usize) -> f64 {
    (bytes as f64 / 1024.).round()
}

fn resident_kilobytes() -> f64 {
    let mut bytes = 0;
    getRSS(&mut bytes);
    kilobytes(bytes)
}

pub(crate) fn memory() -> JsResult<JSValue> {
    let now = resident_kilobytes();
    Ok(
        object!({ "workingSetSize": now, "peakWorkingSetSize": usage().peak_kilobytes.round().max(now) }),
    )
}

state!(fn measured() -> Cell<Option<(Instant, f64)>>);

pub(crate) fn cpu_usage() -> JsResult<JSValue> {
    let (now, used) = (Instant::now(), usage().cpu_seconds);
    let (then, before) = (measured().replace(Some((now, used))))
        .unwrap_or_else(|| (global().bun_vm().origin_timer, 0.));
    let available = (now - then).as_secs_f64().max(1e-3) * f64::from(bun_core::get_thread_count());
    Ok(object!({
        "percentCPUUsage": 100. * (used - before) / available,
        "cumulativeCPUUsage": used,
        "idleWakeupsPerSecond": 0,
    }))
}

/// In milliseconds since 1970.
pub(crate) fn creation_time() -> f64 {
    let then = SystemTime::now() - global().bun_vm().origin_timer.elapsed();
    then.duration_since(SystemTime::UNIX_EPOCH)
        .map_or(0., |it| it.as_millis() as f64)
}

state!(fn created() -> core::cell::OnceCell<f64>);

#[cfg(unix)]
fn kernel_release() -> String {
    let mut names = core::mem::MaybeUninit::<libc::utsname>::zeroed();
    // SAFETY: zeros are empty strings, and it writes terminated ones.
    unsafe {
        libc::uname(names.as_mut_ptr());
        string(core::ffi::CStr::from_ptr(names.assume_init_ref().release.as_ptr()).to_bytes())
    }
}

#[cfg(not(unix))]
fn kernel_release() -> String {
    String::new()
}

fn version_of_macos() -> Option<String> {
    let list = files::read_text("/System/Library/CoreServices/SystemVersion.plist")?;
    let rest = text::split_once(&list, "<key>ProductVersion</key>")?.1;
    Some(text::before(rest.trim_start().strip_prefix("<string>")?, "<").into())
}

state!(fn system_version() -> core::cell::OnceCell<String>);

impl DesktopProcess {
    pub(crate) fn crash() {
        std::process::abort()
    }

    pub(crate) fn hang() {
        loop {
            std::thread::park();
        }
    }

    pub(crate) fn get_blink_memory_info(_: Cx<'_, '_>) -> JsResult<JSValue> {
        Ok(object!({ "allocated": 0, "total": 0 }))
    }

    pub(crate) fn get_cpu_usage(_: Cx<'_, '_>) -> JsResult<JSValue> {
        cpu_usage()
    }

    pub(crate) fn get_creation_time() -> f64 {
        *created().get_or_init(creation_time)
    }

    pub(crate) fn get_heap_statistics(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let (mut capacity, mut size) = (0, 0);
        Bun__Desktop__heapStatistics(global(), &mut capacity, &mut size);
        Ok(object!({
            "totalHeapSize": kilobytes(capacity),
            "totalHeapSizeExecutable": 0,
            "totalPhysicalSize": kilobytes(capacity),
            "totalAvailableSize": kilobytes(Bun__Os__getFreeMemory() as usize),
            "usedHeapSize": kilobytes(size),
            "heapSizeLimit": kilobytes(Bun__Desktop__totalMemory()),
            "mallocedMemory": 0,
            "peakMallocedMemory": 0,
            "doesZapGarbage": false,
        }))
    }

    pub(crate) fn get_process_memory_info(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let resident = resident_kilobytes();
        resolved(object!({ "residentSet": resident, "private": resident, "shared": 0 }))
    }

    pub(crate) fn get_system_memory_info(_: Cx<'_, '_>) -> JsResult<JSValue> {
        let total = kilobytes(Bun__Desktop__totalMemory());
        let Some(info) = files::read_text("/proc/meminfo") else {
            let free = kilobytes(Bun__Os__getFreeMemory() as usize);
            return Ok(object!({ "total": total, "free": free, "swapTotal": 0, "swapFree": 0 }));
        };
        let read = |name: &str| -> f64 {
            let line = text::split(&info, "\n").find_map(|it| it.strip_prefix(name));
            (line.and_then(|it| it.split_ascii_whitespace().next()?.parse().ok())).unwrap_or(0.)
        };
        Ok(object!({
            "total": total,
            "free": read("MemFree:"),
            "available": read("MemAvailable:"),
            "swapTotal": read("SwapTotal:"),
            "swapFree": read("SwapFree:"),
        }))
    }

    pub(crate) fn get_system_version() -> &'static str {
        system_version().get_or_init(|| match IS_MAC {
            true => version_of_macos().unwrap_or_default(),
            false => kernel_release(),
        })
    }

    #[cfg(unix)]
    pub(crate) fn set_fd_limit(most: u32) {
        let mut limit = libc::rlimit {
            rlim_cur: 0,
            rlim_max: 0,
        };
        // SAFETY: a live struct.
        unsafe {
            if libc::getrlimit(libc::RLIMIT_NOFILE, &raw mut limit) == 0 {
                limit.rlim_cur = limit.rlim_max.min(most.into());
                libc::setrlimit(libc::RLIMIT_NOFILE, &raw const limit);
            }
        }
    }

    #[cfg(not(unix))]
    pub(crate) fn set_fd_limit(_: u32) {}

    pub(crate) fn take_heap_snapshot(_: Cx<'_, '_>, file: &[u8]) -> bool {
        write_heap_snapshot(&string(file))
    }
}

pub(crate) fn write_heap_snapshot(file: &str) -> bool {
    let snapshot = Bun__generateHeapSnapshotV8(global().vm());
    files::write(file, &snapshot.to_utf8(), 0o600).is_ok()
}

pub(crate) fn copy_of_environment(given: JSValue, except: &[&str]) -> JsResult<JSValue> {
    let (copy, mut names) = (object!({}), given.keys(global())?.array_iterator(global())?);
    while let Some(name) = names.next()? {
        if !except.contains(&&*text_of(name)?) {
            JSValue::put_to_property_key(
                copy,
                global(),
                name,
                get_by_value(global(), given, name)?,
            )?;
        }
    }
    Ok(copy)
}

/// Does not return, unless it fails.
pub(crate) fn run_as_bun() -> JsResult<()> {
    let environment = copy_of_environment(get(object(), "env")?, &["ELECTRON_RUN_AS_NODE"])?;
    environment.put(global(), b"BUN_BE_BUN", js("1")?);
    let arguments: Vec<String> = [executable()]
        .into_iter()
        .chain(arguments()?.into_iter().skip(2))
        .collect();
    invoke(
        object(),
        "execve",
        &[js(executable())?, js(arguments)?, environment],
    )
    .map(drop)
}
