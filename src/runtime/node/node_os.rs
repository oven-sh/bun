use core::ffi::{c_char, c_int, c_long, c_uint, c_ulong, c_ulonglong, c_void};
use std::io::Write as _;

use bun_core::{env_var, fmt as bun_fmt, HOST_NAME_MAX};
use bun_jsc::{
    node::ErrorCode, CallFrame, JSArray, JSGlobalObject, JSObject, JSValue, JsResult, SystemError,
};
use bun_paths::PathBuffer;
use bun_str::{strings, String as BunString, ZigString};
use bun_sys::c;
#[cfg(windows)]
use bun_sys::windows::{self, libuv};

// TODO(port): generated bindings (bun.gen.node_os) — Phase B wires codegen output
use crate::gen::node_os as gen;

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn bun_sysconf__SC_NPROCESSORS_ONLN() -> i32;
}

pub fn create_node_os_binding(global: &JSGlobalObject) -> JsResult<JSValue> {
    // TODO(port): JSObject::create struct-literal API — Phase B defines a builder/macro
    let obj = JSObject::create(global)?;
    // SAFETY: pure FFI getter
    obj.put(global, "hostCpuCount", JSValue::js_number(1i32.max(unsafe { bun_sysconf__SC_NPROCESSORS_ONLN() })));
    obj.put(global, "cpus", gen::create_cpus_callback(global));
    obj.put(global, "freemem", gen::create_freemem_callback(global));
    obj.put(global, "getPriority", gen::create_get_priority_callback(global));
    obj.put(global, "homedir", gen::create_homedir_callback(global));
    obj.put(global, "hostname", gen::create_hostname_callback(global));
    obj.put(global, "loadavg", gen::create_loadavg_callback(global));
    obj.put(global, "networkInterfaces", gen::create_network_interfaces_callback(global));
    obj.put(global, "release", gen::create_release_callback(global));
    obj.put(global, "totalmem", gen::create_totalmem_callback(global));
    obj.put(global, "uptime", gen::create_uptime_callback(global));
    obj.put(global, "userInfo", gen::create_user_info_callback(global));
    obj.put(global, "version", gen::create_version_callback(global));
    obj.put(global, "setPriority", gen::create_set_priority_callback(global));
    Ok(obj.to_js())
}

#[derive(Default, Clone, Copy)]
struct CPUTimes {
    user: u64,
    nice: u64,
    sys: u64,
    idle: u64,
    irq: u64,
}

impl CPUTimes {
    pub fn to_value(self, global_this: &JSGlobalObject) -> JSValue {
        // Zig used comptime std.meta.fieldNames + inline for; expand manually.
        let ret = JSValue::create_empty_object(global_this, 5);
        ret.put(global_this, ZigString::static_("user"), JSValue::js_number_from_uint64(self.user));
        ret.put(global_this, ZigString::static_("nice"), JSValue::js_number_from_uint64(self.nice));
        ret.put(global_this, ZigString::static_("sys"), JSValue::js_number_from_uint64(self.sys));
        ret.put(global_this, ZigString::static_("idle"), JSValue::js_number_from_uint64(self.idle));
        ret.put(global_this, ZigString::static_("irq"), JSValue::js_number_from_uint64(self.irq));
        ret
    }
}

pub fn cpus(global: &JSGlobalObject) -> JsResult<JSValue> {
    #[cfg(target_os = "linux")]
    let result = cpus_impl_linux(global);
    #[cfg(target_os = "macos")]
    let result = cpus_impl_darwin(global);
    #[cfg(target_os = "freebsd")]
    let result = cpus_impl_freebsd(global);
    #[cfg(windows)]
    let result = cpus_impl_windows(global);

    match result {
        Ok(v) => Ok(v),
        Err(_) => {
            let err = SystemError {
                message: BunString::static_("Failed to get CPU information"),
                code: BunString::static_(<&'static str>::from(ErrorCode::ERR_SYSTEM_ERROR)),
                ..Default::default()
            };
            global.throw_value(err.to_error_instance(global))
        }
    }
}

#[cfg(target_os = "linux")]
fn cpus_impl_linux(global_this: &JSGlobalObject) -> Result<JSValue, bun_core::Error> {
    // Create the return array
    let values = JSValue::create_empty_array(global_this, 0)?;
    let mut num_cpus: u32 = 0;

    // PERF(port): was stack-fallback alloc (8KB) — profile in Phase B
    let mut file_buf: Vec<u8> = Vec::new();

    // Read /proc/stat to get number of CPUs and times
    {
        // TODO(port): std.fs.cwd().openFile → bun_sys::File::open (no std::fs)
        let file = match bun_sys::File::open(b"/proc/stat", bun_sys::O::RDONLY, 0) {
            Ok(f) => f,
            Err(_) => {
                // hidepid mounts (common on Android) deny /proc/stat. lazyCpus in os.ts
                // pre-creates hostCpuCount lazy proxies, so return that many stub
                // entries (zeroed times / unknown model / speed 0) — matches Node.
                // SAFETY: pure FFI getter
                let count: u32 = u32::try_from(1i32.max(unsafe { bun_sysconf__SC_NPROCESSORS_ONLN() })).unwrap();
                let stubs = JSValue::create_empty_array(global_this, count)?;
                let mut i: u32 = 0;
                while i < count {
                    let cpu = JSValue::create_empty_object(global_this, 3);
                    cpu.put(global_this, ZigString::static_("times"), CPUTimes::default().to_value(global_this));
                    cpu.put(global_this, ZigString::static_("model"), ZigString::static_("unknown").with_encoding().to_js(global_this));
                    cpu.put(global_this, ZigString::static_("speed"), JSValue::js_number(0));
                    stubs.put_index(global_this, i, cpu)?;
                    i += 1;
                }
                return Ok(stubs);
            }
        };
        // file closed on Drop

        let read = bun_sys::File::from(file).read_to_end_with_array_list(&mut file_buf, bun_sys::ReadHint::ProbablySmall).unwrap()?;
        let contents = &file_buf[0..read];

        let mut line_iter = contents.split(|b| *b == b'\n').filter(|s| !s.is_empty());

        // Skip the first line (aggregate of all CPUs)
        let _ = line_iter.next();

        // Read each CPU line
        while let Some(line) = line_iter.next() {
            // CPU lines are formatted as `cpu0 user nice sys idle iowait irq softirq`
            let mut toks = line.split(|b| *b == b' ' || *b == b'\t').filter(|s| !s.is_empty());
            let cpu_name = toks.next();
            if cpu_name.is_none() || !cpu_name.unwrap().starts_with(b"cpu") {
                break; // done with CPUs
            }

            //NOTE: libuv assumes this is fixed on Linux, not sure that's actually the case
            let scale: u64 = 10;

            let mut times = CPUTimes::default();
            // TODO(port): narrow error set
            times.user = scale * parse_u64(toks.next().ok_or(bun_core::err!("eol"))?)?;
            times.nice = scale * parse_u64(toks.next().ok_or(bun_core::err!("eol"))?)?;
            times.sys = scale * parse_u64(toks.next().ok_or(bun_core::err!("eol"))?)?;
            times.idle = scale * parse_u64(toks.next().ok_or(bun_core::err!("eol"))?)?;
            let _ = toks.next().ok_or(bun_core::err!("eol"))?; // skip iowait
            times.irq = scale * parse_u64(toks.next().ok_or(bun_core::err!("eol"))?)?;

            // Actually create the JS object representing the CPU
            let cpu = JSValue::create_empty_object(global_this, 1);
            cpu.put(global_this, ZigString::static_("times"), times.to_value(global_this));
            values.put_index(global_this, num_cpus, cpu)?;

            num_cpus += 1;
        }

        file_buf.clear();
    }

    // Read /proc/cpuinfo to get model information (optional)
    if let Ok(file) = bun_sys::File::open(b"/proc/cpuinfo", bun_sys::O::RDONLY, 0) {
        // file closed on Drop

        let read = bun_sys::File::from(file).read_to_end_with_array_list(&mut file_buf, bun_sys::ReadHint::ProbablySmall).unwrap()?;
        let contents = &file_buf[0..read];

        let mut line_iter = contents.split(|b| *b == b'\n').filter(|s| !s.is_empty());

        const KEY_PROCESSOR: &[u8] = b"processor\t: ";
        const KEY_MODEL_NAME: &[u8] = b"model name\t: ";

        let mut cpu_index: u32 = 0;
        let mut has_model_name = true;
        while let Some(line) = line_iter.next() {
            if line.starts_with(KEY_PROCESSOR) {
                if !has_model_name {
                    let cpu = values.get_index(global_this, cpu_index)?;
                    cpu.put(global_this, ZigString::static_("model"), ZigString::static_("unknown").with_encoding().to_js(global_this));
                }
                // If this line starts a new processor, parse the index from the line
                let digits = trim_bytes(&line[KEY_PROCESSOR.len()..], b" \t\n");
                cpu_index = parse_u32(digits)?;
                if cpu_index >= num_cpus {
                    return Err(bun_core::err!("too_may_cpus"));
                }
                has_model_name = false;
            } else if line.starts_with(KEY_MODEL_NAME) {
                // If this is the model name, extract it and store on the current cpu
                let model_name = &line[KEY_MODEL_NAME.len()..];
                let cpu = values.get_index(global_this, cpu_index)?;
                cpu.put(global_this, ZigString::static_("model"), ZigString::init(model_name).with_encoding().to_js(global_this));
                has_model_name = true;
            }
        }
        if !has_model_name {
            let cpu = values.get_index(global_this, cpu_index)?;
            cpu.put(global_this, ZigString::static_("model"), ZigString::static_("unknown").with_encoding().to_js(global_this));
        }

        file_buf.clear();
    } else {
        // Initialize model name to "unknown"
        let mut it = values.array_iterator(global_this)?;
        while let Some(cpu) = it.next()? {
            cpu.put(global_this, ZigString::static_("model"), ZigString::static_("unknown").with_encoding().to_js(global_this));
        }
    }

    // Read /sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq to get current frequency (optional)
    for cpu_index in 0..num_cpus as usize {
        let cpu = values.get_index(global_this, cpu_index as u32)?;

        let mut path_buf = [0u8; 128];
        let path = {
            let mut cursor = &mut path_buf[..];
            write!(cursor, "/sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq", cpu_index)
                .map_err(|_| bun_core::err!("fmt"))?;
            let remaining = cursor.len();
            let written = path_buf.len() - remaining;
            &path_buf[..written]
        };
        if let Ok(file) = bun_sys::File::open(path, bun_sys::O::RDONLY, 0) {
            // file closed on Drop

            let read = bun_sys::File::from(file).read_to_end_with_array_list(&mut file_buf, bun_sys::ReadHint::ProbablySmall).unwrap()?;
            let contents = &file_buf[0..read];

            let digits = trim_bytes(contents, b" \n");
            let speed = parse_u64(digits).unwrap_or(0) / 1000;

            cpu.put(global_this, ZigString::static_("speed"), JSValue::js_number(speed));

            file_buf.clear();
        } else {
            // Initialize CPU speed to 0
            cpu.put(global_this, ZigString::static_("speed"), JSValue::js_number(0));
        }
    }

    Ok(values)
}

#[cfg(target_os = "freebsd")]
fn cpus_impl_freebsd(global_this: &JSGlobalObject) -> Result<JSValue, bun_core::Error> {
    let mut ncpu: c_uint = 0;
    let mut ncpu_len: usize = core::mem::size_of::<c_uint>();
    // TODO(port): std.posix.sysctlbynameZ → bun_sys::posix::sysctlbyname
    bun_sys::posix::sysctlbyname(c"hw.ncpu", &mut ncpu as *mut _ as *mut c_void, &mut ncpu_len, core::ptr::null_mut(), 0)?;
    if ncpu == 0 {
        return Err(bun_core::err!("no_processor_info"));
    }

    let mut model_buf = [0u8; 512];
    let mut model_len: usize = model_buf.len();
    let model = if bun_sys::posix::sysctlbyname(c"hw.model", model_buf.as_mut_ptr() as *mut c_void, &mut model_len, core::ptr::null_mut(), 0).is_ok() {
        ZigString::init(bun_str::slice_to_nul(&model_buf)).with_encoding().to_js(global_this)
    } else {
        ZigString::static_("unknown").with_encoding().to_js(global_this)
    };

    let mut speed_mhz: c_uint = 0;
    let mut speed_len: usize = core::mem::size_of::<c_uint>();
    let _ = bun_sys::posix::sysctlbyname(c"hw.clockrate", &mut speed_mhz as *mut _ as *mut c_void, &mut speed_len, core::ptr::null_mut(), 0);

    const CPU_STATES: usize = 5; // user, nice, sys, intr, idle
    let mut times_buf: Vec<c_long> = vec![0; ncpu as usize * CPU_STATES];
    let mut times_len: usize = times_buf.len() * core::mem::size_of::<c_long>();
    bun_sys::posix::sysctlbyname(c"kern.cp_times", times_buf.as_mut_ptr() as *mut c_void, &mut times_len, core::ptr::null_mut(), 0)?;

    // SAFETY: pure FFI getter
    let ticks: i64 = unsafe { bun_sysconf__SC_CLK_TCK() } as i64;
    let mult: u64 = if ticks > 0 { 1000 / u64::try_from(ticks).unwrap() } else { 1 };

    let values = JSValue::create_empty_array(global_this, u32::try_from(ncpu).unwrap())?;
    let mut i: u32 = 0;
    while i < ncpu {
        let off = i as usize * CPU_STATES;
        let times = CPUTimes {
            user: u64::try_from(times_buf[off + 0].max(0)).unwrap() * mult,
            nice: u64::try_from(times_buf[off + 1].max(0)).unwrap() * mult,
            sys: u64::try_from(times_buf[off + 2].max(0)).unwrap() * mult,
            irq: u64::try_from(times_buf[off + 3].max(0)).unwrap() * mult,
            idle: u64::try_from(times_buf[off + 4].max(0)).unwrap() * mult,
        };
        let cpu = JSValue::create_empty_object(global_this, 3);
        cpu.put(global_this, ZigString::static_("model"), model);
        cpu.put(global_this, ZigString::static_("speed"), JSValue::js_number(speed_mhz));
        cpu.put(global_this, ZigString::static_("times"), times.to_value(global_this));
        values.put_index(global_this, i, cpu)?;
        i += 1;
    }
    Ok(values)
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn bun_sysconf__SC_CLK_TCK() -> isize;
}

#[cfg(target_os = "macos")]
fn cpus_impl_darwin(global_this: &JSGlobalObject) -> Result<JSValue, bun_core::Error> {
    // Fetch the CPU info structure
    let mut num_cpus: c::natural_t = 0;
    let mut info: *mut c::processor_cpu_load_info = core::ptr::null_mut();
    let mut info_size: c::mach_msg_type_number_t = 0;
    // SAFETY: FFI call with valid out-pointers
    if unsafe {
        c::host_processor_info(
            c::mach_host_self(),
            c::PROCESSOR_CPU_LOAD_INFO,
            &mut num_cpus,
            &mut info as *mut *mut c::processor_cpu_load_info as *mut c::processor_info_array_t,
            &mut info_size,
        )
    } != 0
    {
        return Err(bun_core::err!("no_processor_info"));
    }
    let _dealloc = scopeguard::guard((), |_| {
        // SAFETY: info/info_size returned by host_processor_info
        unsafe { let _ = c::vm_deallocate(c::mach_task_self(), info as usize, info_size as usize); }
    });

    // Ensure we got the amount of data we expected to guard against buffer overruns
    if info_size != c::PROCESSOR_CPU_LOAD_INFO_COUNT * num_cpus {
        return Err(bun_core::err!("broken_process_info"));
    }

    // Get CPU model name
    let mut model_name_buf = [0u8; 512];
    let mut len: usize = model_name_buf.len();
    // Try brand_string first and if it fails try hw.model
    // SAFETY: valid buffers
    if !(unsafe { c::sysctlbyname(c"machdep.cpu.brand_string".as_ptr(), model_name_buf.as_mut_ptr() as *mut c_void, &mut len, core::ptr::null_mut(), 0) } == 0
        || unsafe { c::sysctlbyname(c"hw.model".as_ptr(), model_name_buf.as_mut_ptr() as *mut c_void, &mut len, core::ptr::null_mut(), 0) } == 0)
    {
        return Err(bun_core::err!("no_processor_info"));
    }
    // NOTE: sysctlbyname doesn't update len if it was large enough, so we
    // still have to find the null terminator.  All cpus can share the same
    // model name.
    let model_name = ZigString::init(bun_str::slice_to_nul(&model_name_buf)).with_encoding().to_js(global_this);

    // Get CPU speed
    let mut speed: u64 = 0;
    len = core::mem::size_of::<u64>();
    // SAFETY: valid buffers
    let _ = unsafe { c::sysctlbyname(c"hw.cpufrequency".as_ptr(), &mut speed as *mut u64 as *mut c_void, &mut len, core::ptr::null_mut(), 0) };
    if speed == 0 {
        // Suggested by Node implementation:
        // If sysctl hw.cputype == CPU_TYPE_ARM64, the correct value is unavailable
        // from Apple, but we can hard-code it here to a plausible value.
        speed = 2_400_000_000;
    }

    // Get the multiplier; this is the number of ms/tick
    // SAFETY: pure FFI getter
    let ticks: i64 = unsafe { bun_sysconf__SC_CLK_TCK() } as i64;
    let multiplier: u64 = 1000 / u64::try_from(ticks).unwrap();

    // Set up each CPU value in the return
    let values = JSValue::create_empty_array(global_this, u32::try_from(num_cpus).unwrap())?;
    let mut cpu_index: u32 = 0;
    // SAFETY: info points to num_cpus entries per host_processor_info contract
    let info_slice = unsafe { core::slice::from_raw_parts(info, num_cpus as usize) };
    while cpu_index < num_cpus {
        let ticks = &info_slice[cpu_index as usize].cpu_ticks;
        let times = CPUTimes {
            user: ticks[0] as u64 * multiplier,
            nice: ticks[3] as u64 * multiplier,
            sys: ticks[1] as u64 * multiplier,
            idle: ticks[2] as u64 * multiplier,
            irq: 0, // not available
        };

        let cpu = JSValue::create_empty_object(global_this, 3);
        cpu.put(global_this, ZigString::static_("speed"), JSValue::js_number(speed / 1_000_000));
        cpu.put(global_this, ZigString::static_("model"), model_name);
        cpu.put(global_this, ZigString::static_("times"), times.to_value(global_this));

        values.put_index(global_this, cpu_index, cpu)?;
        cpu_index += 1;
    }
    Ok(values)
}

#[cfg(windows)]
pub fn cpus_impl_windows(global_this: &JSGlobalObject) -> Result<JSValue, bun_core::Error> {
    let mut cpu_infos: *mut libuv::uv_cpu_info_t = core::ptr::null_mut();
    let mut count: c_int = 0;
    // SAFETY: valid out-pointers
    let err = unsafe { libuv::uv_cpu_info(&mut cpu_infos, &mut count) };
    if err != 0 {
        return Err(bun_core::err!("NoProcessorInfo"));
    }
    let _free = scopeguard::guard((), |_| {
        // SAFETY: returned by uv_cpu_info
        unsafe { libuv::uv_free_cpu_info(cpu_infos, count) };
    });

    let values = JSValue::create_empty_array(global_this, u32::try_from(count).unwrap())?;

    // SAFETY: cpu_infos points to `count` entries per uv_cpu_info contract
    let infos = unsafe { core::slice::from_raw_parts(cpu_infos, usize::try_from(count).unwrap()) };
    for (i, cpu_info) in infos.iter().enumerate() {
        let times = CPUTimes {
            user: cpu_info.cpu_times.user,
            nice: cpu_info.cpu_times.nice,
            sys: cpu_info.cpu_times.sys,
            idle: cpu_info.cpu_times.idle,
            irq: cpu_info.cpu_times.irq,
        };

        let cpu = JSValue::create_empty_object(global_this, 3);
        // SAFETY: cpu_info.model is a NUL-terminated C string from libuv
        let model = unsafe { core::ffi::CStr::from_ptr(cpu_info.model) }.to_bytes();
        cpu.put(global_this, ZigString::static_("model"), ZigString::init(model).with_encoding().to_js(global_this));
        cpu.put(global_this, ZigString::static_("speed"), JSValue::js_number(cpu_info.speed));
        cpu.put(global_this, ZigString::static_("times"), times.to_value(global_this));

        values.put_index(global_this, u32::try_from(i).unwrap(), cpu)?;
    }

    Ok(values)
}

pub fn freemem() -> u64 {
    // OsBinding.cpp
    // TODO(port): move to <area>_sys
    unsafe extern "C" {
        fn Bun__Os__getFreeMemory() -> u64;
    }
    // SAFETY: pure FFI getter
    unsafe { Bun__Os__getFreeMemory() }
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    fn get_process_priority(pid: i32) -> i32;
}

pub fn get_priority(global: &JSGlobalObject, pid: i32) -> JsResult<i32> {
    // SAFETY: pure FFI call
    let result = unsafe { get_process_priority(pid) };
    if result == i32::MAX {
        let err = SystemError {
            message: BunString::static_("no such process"),
            code: BunString::static_("ESRCH"),
            #[cfg(not(windows))]
            errno: -(bun_sys::posix::E::SRCH as c_int),
            #[cfg(windows)]
            errno: libuv::UV_ESRCH,
            syscall: BunString::static_("uv_os_getpriority"),
            ..Default::default()
        };
        return global.throw_value(err.to_error_instance_with_info_object(global));
    }
    Ok(result)
}

pub fn homedir(global: &JSGlobalObject) -> Result<BunString, bun_core::Error> {
    // In Node.js, this is a wrapper around uv_os_homedir.
    #[cfg(windows)]
    {
        let mut out = PathBuffer::uninit();
        let mut size: usize = out.len();
        // SAFETY: valid buffer + size out-param
        if let Some(err) = unsafe { libuv::uv_os_homedir(out.as_mut_ptr(), &mut size) }.to_error(bun_sys::Syscall::uv_os_homedir) {
            return global.throw_value(err.to_js(global)?);
        }
        return Ok(BunString::clone_utf8(&out[0..size]));
    }
    #[cfg(not(windows))]
    {
        // The posix implementation of uv_os_homedir first checks the HOME
        // environment variable, then falls back to reading the passwd entry.
        if let Some(home) = env_var::HOME.get() {
            if !home.is_empty() {
                return Ok(BunString::init(home));
            }
        }

        // From libuv:
        // > Calling sysconf(_SC_GETPW_R_SIZE_MAX) would get the suggested size, but it
        // > is frequently 1024 or 4096, so we can just use that directly. The pwent
        // > will not usually be large.
        // Instead of always using an allocation, first try a stack allocation
        // of 4096, then fallback to heap.
        let mut stack_string_bytes = [0u8; 4096];
        // PERF(port): was stack-fallback alloc — profile in Phase B
        let mut heap_bytes: Vec<u8> = Vec::new();
        let mut string_bytes: &mut [u8] = &mut stack_string_bytes[..];
        let mut using_heap = false;

        // SAFETY: zeroed POD
        let mut pw: c::passwd = unsafe { core::mem::zeroed() };
        let mut result: *mut c::passwd = core::ptr::null_mut();

        let ret: c_int = loop {
            // SAFETY: valid buffers and out-pointer
            let ret = unsafe {
                c::getpwuid_r(
                    c::geteuid(),
                    &mut pw,
                    string_bytes.as_mut_ptr() as *mut c_char,
                    string_bytes.len(),
                    &mut result,
                )
            };

            if ret == bun_sys::E::INTR as c_int {
                continue;
            }

            // If the system call wants more memory, double it.
            if ret == bun_sys::E::RANGE as c_int {
                let len = string_bytes.len();
                heap_bytes = vec![0u8; len * 2];
                string_bytes = &mut heap_bytes[..];
                using_heap = true;
                continue;
            }

            break ret;
        };
        let _ = using_heap;

        if ret != 0 {
            return global.throw_value(
                bun_sys::Error::from_code(
                    // SAFETY: ret is a valid errno value
                    unsafe { core::mem::transmute::<c_int, bun_sys::E>(ret) },
                    bun_sys::Syscall::uv_os_homedir,
                )
                .to_js(global)?,
            );
        }

        if result.is_null() {
            // bionic has no passwd entries for app uids; with HOME also unset
            // (zygote/run-as), return a usable default rather than throwing.
            #[cfg(target_os = "android")]
            {
                return Ok(BunString::static_("/data/local/tmp"));
            }
            // in uv__getpwuid_r, null result throws UV_ENOENT.
            #[cfg(not(target_os = "android"))]
            return global.throw_value(
                bun_sys::Error::from_code(bun_sys::E::NOENT, bun_sys::Syscall::uv_os_homedir).to_js(global)?,
            );
        }

        return Ok(if !pw.pw_dir.is_null() {
            // SAFETY: pw_dir is a NUL-terminated C string from getpwuid_r
            BunString::clone_utf8(unsafe { core::ffi::CStr::from_ptr(pw.pw_dir) }.to_bytes())
        } else {
            BunString::empty()
        });
    }
}

pub fn hostname(global: &JSGlobalObject) -> JsResult<JSValue> {
    #[cfg(windows)]
    {
        let mut name_buffer: [u16; 130] = [0; 130]; // [129:0]u16 → 130 u16s with NUL at [129]
        // SAFETY: valid buffer
        if unsafe { windows::GetHostNameW(name_buffer.as_mut_ptr(), 129) } == 0 {
            let str = BunString::clone_utf16(slice_to_nul_u16(&name_buffer));
            let js = str.to_js(global);
            str.deref();
            return Ok(js);
        }

        // SAFETY: zeroed POD
        let mut result: windows::ws2_32::WSADATA = unsafe { core::mem::zeroed() };
        // SAFETY: valid out-pointer
        if unsafe { windows::ws2_32::WSAStartup(0x202, &mut result) } == 0 {
            // SAFETY: valid buffer
            if unsafe { windows::GetHostNameW(name_buffer.as_mut_ptr(), 129) } == 0 {
                let y = BunString::clone_utf16(slice_to_nul_u16(&name_buffer));
                let js = y.to_js(global);
                y.deref();
                return Ok(js);
            }
        }

        return Ok(ZigString::init(b"unknown").with_encoding().to_js(global));
    }
    #[cfg(not(windows))]
    {
        let mut name_buffer = [0u8; HOST_NAME_MAX];
        // TODO(port): std.posix.gethostname → bun_sys::posix::gethostname
        let s = bun_sys::posix::gethostname(&mut name_buffer).unwrap_or(b"unknown");
        return Ok(ZigString::init(s).with_encoding().to_js(global));
    }
}

pub fn loadavg(global: &JSGlobalObject) -> JsResult<JSValue> {
    #[cfg(target_os = "macos")]
    let result: [f64; 3] = 'loadavg: {
        // SAFETY: zeroed POD
        let mut avg: c::struct_loadavg = unsafe { core::mem::zeroed() };
        let mut size: usize = core::mem::size_of::<c::struct_loadavg>();

        if bun_sys::posix::sysctlbyname(c"vm.loadavg", &mut avg as *mut _ as *mut c_void, &mut size, core::ptr::null_mut(), 0).is_err() {
            break 'loadavg [0.0, 0.0, 0.0];
        }

        let scale: f64 = avg.fscale as f64;
        [
            if scale == 0.0 { 0.0 } else { avg.ldavg[0] as f64 / scale },
            if scale == 0.0 { 0.0 } else { avg.ldavg[1] as f64 / scale },
            if scale == 0.0 { 0.0 } else { avg.ldavg[2] as f64 / scale },
        ]
    };
    #[cfg(target_os = "linux")]
    let result: [f64; 3] = 'loadavg: {
        // SAFETY: zeroed POD
        let mut info: c::struct_sysinfo = unsafe { core::mem::zeroed() };
        // SAFETY: valid out-pointer
        if unsafe { c::sysinfo(&mut info) } == 0 {
            break 'loadavg [
                ((info.loads[0] as f64 / 65536.0) * 100.0).ceil() / 100.0,
                ((info.loads[1] as f64 / 65536.0) * 100.0).ceil() / 100.0,
                ((info.loads[2] as f64 / 65536.0) * 100.0).ceil() / 100.0,
            ];
        }
        [0.0, 0.0, 0.0]
    };
    #[cfg(target_os = "freebsd")]
    let result: [f64; 3] = 'loadavg: {
        let mut avg: [f64; 3] = [0.0, 0.0, 0.0];
        // SAFETY: valid buffer
        if unsafe { c::getloadavg(avg.as_mut_ptr(), 3) } != 3 {
            break 'loadavg [0.0, 0.0, 0.0];
        }
        avg
    };
    #[cfg(windows)]
    let result: [f64; 3] = [0.0, 0.0, 0.0];

    JSArray::create(global, &[
        JSValue::js_number(result[0]),
        JSValue::js_number(result[1]),
        JSValue::js_number(result[2]),
    ])
}

#[cfg(unix)]
pub use network_interfaces_posix as network_interfaces;
#[cfg(windows)]
pub use network_interfaces_windows as network_interfaces;

#[cfg(unix)]
fn network_interfaces_posix(global_this: &JSGlobalObject) -> JsResult<JSValue> {
    // getifaddrs sets a pointer to a linked list
    let mut interface_start: *mut c::ifaddrs = core::ptr::null_mut();
    // SAFETY: valid out-pointer
    let rc = unsafe { c::getifaddrs(&mut interface_start) };
    if rc != 0 {
        let errno = bun_sys::posix::errno(rc);
        // Android API 30+: SELinux denies the netlink socket getifaddrs uses.
        // Node returns {} rather than throwing.
        #[cfg(target_os = "android")]
        {
            if errno == bun_sys::posix::E::ACCES || errno == bun_sys::posix::E::PERM {
                return Ok(JSValue::create_empty_object(global_this, 0));
            }
        }
        let err = SystemError {
            message: BunString::static_("A system error occurred: getifaddrs returned an error"),
            code: BunString::static_("ERR_SYSTEM_ERROR"),
            errno: errno as c_int,
            syscall: BunString::static_("getifaddrs"),
            ..Default::default()
        };

        return global_this.throw_value(err.to_error_instance(global_this));
    }
    let _free = scopeguard::guard((), |_| {
        // SAFETY: returned by getifaddrs
        unsafe { c::freeifaddrs(interface_start) };
    });

    // We'll skip interfaces that aren't actually available
    fn skip(iface: &c::ifaddrs) -> bool {
        // Skip interfaces that aren't actually available
        if iface.ifa_flags & c::IFF_RUNNING as c_uint == 0 { return true; }
        if iface.ifa_flags & c::IFF_UP as c_uint == 0 { return true; }
        if iface.ifa_addr.is_null() { return true; }
        false
    }

    // We won't actually return link-layer interfaces but we need them for
    //  extracting the MAC address
    fn is_link_layer(iface: &c::ifaddrs) -> bool {
        if iface.ifa_addr.is_null() { return false; }
        #[cfg(target_os = "linux")]
        // SAFETY: ifa_addr is non-null per check above
        return unsafe { (*iface.ifa_addr).sa_family } as c_int == bun_sys::posix::AF::PACKET;
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        // SAFETY: ifa_addr is non-null per check above
        return unsafe { (*iface.ifa_addr).sa_family } as c_int == bun_sys::posix::AF::LINK;
    }

    fn is_loopback(iface: &c::ifaddrs) -> bool {
        iface.ifa_flags & c::IFF_LOOPBACK as c_uint == c::IFF_LOOPBACK as c_uint
    }

    // The list currently contains entries for link-layer interfaces
    //  and the IPv4, IPv6 interfaces.  We only want to return the latter two
    //  but need the link-layer entries to determine MAC address.
    // So, on our first pass through the linked list we'll count the number of
    //  INET interfaces only.
    let mut num_inet_interfaces: usize = 0;
    let mut it = interface_start;
    while !it.is_null() {
        // SAFETY: it is a valid pointer in the linked list
        let iface = unsafe { &*it };
        if !(skip(iface) || is_link_layer(iface)) {
            num_inet_interfaces += 1;
        }
        it = iface.ifa_next;
    }
    let _ = num_inet_interfaces;

    let ret = JSValue::create_empty_object(global_this, 0);

    // Second pass through, populate each interface object
    let mut it = interface_start;
    while !it.is_null() {
        // SAFETY: it is a valid pointer in the linked list
        let iface = unsafe { &*it };
        let next = iface.ifa_next;
        if skip(iface) || is_link_layer(iface) {
            it = next;
            continue;
        }

        // SAFETY: ifa_name is a NUL-terminated C string
        let interface_name = unsafe { core::ffi::CStr::from_ptr(iface.ifa_name) }.to_bytes();
        // TODO(port): std.net.Address — using bun_sys::net::Address (no std::net)
        // SAFETY: ifa_addr/ifa_netmask are valid sockaddr* (skip() ensures ifa_addr non-null)
        let addr = unsafe { bun_sys::net::Address::init_posix(iface.ifa_addr as *const bun_sys::posix::sockaddr) };
        let netmask = unsafe { bun_sys::net::Address::init_posix(iface.ifa_netmask as *const bun_sys::posix::sockaddr) };

        let interface = JSValue::create_empty_object(global_this, 0);

        // address <string> The assigned IPv4 or IPv6 address
        // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
        {
            // Compute the CIDR suffix; returns null if the netmask cannot
            //  be converted to a CIDR suffix
            let maybe_suffix: Option<u8> = match addr.family() as c_int {
                bun_sys::posix::AF::INET => netmask_to_cidr_suffix(netmask.in_().sa.addr),
                bun_sys::posix::AF::INET6 => netmask_to_cidr_suffix(u128::from_ne_bytes(netmask.in6().sa.addr)),
                _ => None,
            };

            // Format the address and then, if valid, the CIDR suffix; both
            //  the address and cidr values can be slices into this same buffer
            // e.g. addr_str = "192.168.88.254", cidr_str = "192.168.88.254/24"
            let mut buf = [0u8; 64];
            let addr_str = bun_fmt::format_ip(&addr, &mut buf).expect("unreachable");
            let mut cidr = JSValue::NULL;
            if let Some(suffix) = maybe_suffix {
                //NOTE addr_str might not start at buf[0] due to slicing in formatIp
                let start = addr_str.as_ptr() as usize - buf.as_ptr() as usize;
                // Start writing the suffix immediately after the address
                let addr_len = addr_str.len();
                let suffix_len = {
                    let mut cursor = &mut buf[start + addr_len..];
                    write!(cursor, "/{}", suffix).expect("unreachable");
                    let remaining = cursor.len();
                    (buf.len() - (start + addr_len)) - remaining
                };
                // The full cidr value is the address + the suffix
                let cidr_str = &buf[start..start + addr_len + suffix_len];
                cidr = ZigString::init(cidr_str).with_encoding().to_js(global_this);
            }

            // PORT NOTE: reshaped for borrowck — re-slice addr_str from buf
            let addr_str_len = addr_str.len();
            let start = addr_str.as_ptr() as usize - buf.as_ptr() as usize;
            interface.put(global_this, ZigString::static_("address"), ZigString::init(&buf[start..start + addr_str_len]).with_encoding().to_js(global_this));
            interface.put(global_this, ZigString::static_("cidr"), cidr);
        }

        // netmask <string> The IPv4 or IPv6 network mask
        {
            let mut buf = [0u8; 64];
            let str = bun_fmt::format_ip(&netmask, &mut buf).expect("unreachable");
            interface.put(global_this, ZigString::static_("netmask"), ZigString::init(str).with_encoding().to_js(global_this));
        }

        // family <string> Either IPv4 or IPv6
        interface.put(global_this, ZigString::static_("family"), match addr.family() as c_int {
            bun_sys::posix::AF::INET => global_this.common_strings().ipv4(),
            bun_sys::posix::AF::INET6 => global_this.common_strings().ipv6(),
            _ => ZigString::static_("unknown").to_js(global_this),
        });

        // mac <string> The MAC address of the network interface
        {
            // We need to search for the link-layer interface whose name matches this one
            let mut ll_it = interface_start;
            let maybe_ll_addr: Option<*const c_void> = 'search: {
                while !ll_it.is_null() {
                    // SAFETY: ll_it is a valid pointer in the linked list
                    let ll_iface = unsafe { &*ll_it };
                    let ll_next = ll_iface.ifa_next;
                    if skip(ll_iface) || !is_link_layer(ll_iface) {
                        ll_it = ll_next;
                        continue;
                    }

                    // SAFETY: ifa_name is a NUL-terminated C string
                    let ll_name = unsafe { core::ffi::CStr::from_ptr(ll_iface.ifa_name) }.to_bytes();
                    if !strings::has_prefix(ll_name, interface_name) {
                        ll_it = ll_next;
                        continue;
                    }
                    if ll_name.len() > interface_name.len() && ll_name[interface_name.len()] != b':' {
                        ll_it = ll_next;
                        continue;
                    }

                    // This is the correct link-layer interface entry for the current interface,
                    //  cast to a link-layer socket address
                    break 'search Some(ll_iface.ifa_addr as *const c_void);
                }
                None
            };

            if let Some(ll_addr) = maybe_ll_addr {
                // Encode its link-layer address.  We need 2*6 bytes for the
                //  hex characters and 5 for the colon separators
                let mut mac_buf = [0u8; 17];
                #[cfg(target_os = "linux")]
                // SAFETY: ll_addr is a sockaddr_ll* per is_link_layer check
                let addr_data: &[u8] = unsafe { &(*(ll_addr as *const bun_sys::posix::sockaddr_ll)).addr };
                #[cfg(any(target_os = "macos", target_os = "freebsd"))]
                let addr_data: &[u8] = {
                    // SAFETY: ll_addr is a sockaddr_dl* per is_link_layer check
                    let dl = unsafe { &*(ll_addr as *const c::sockaddr_dl) };
                    &dl.sdl_data[dl.sdl_nlen as usize..]
                };
                if addr_data.len() < 6 {
                    let mac = b"00:00:00:00:00:00";
                    interface.put(global_this, ZigString::static_("mac"), ZigString::init(mac).with_encoding().to_js(global_this));
                } else {
                    let mac = {
                        let mut cursor = &mut mac_buf[..];
                        write!(
                            cursor,
                            "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
                            addr_data[0], addr_data[1], addr_data[2],
                            addr_data[3], addr_data[4], addr_data[5],
                        )
                        .expect("unreachable");
                        &mac_buf[..]
                    };
                    interface.put(global_this, ZigString::static_("mac"), ZigString::init(mac).with_encoding().to_js(global_this));
                }
            } else {
                let mac = b"00:00:00:00:00:00";
                interface.put(global_this, ZigString::static_("mac"), ZigString::init(mac).with_encoding().to_js(global_this));
            }
        }

        // internal <boolean> true if the network interface is a loopback or similar interface that is not remotely accessible; otherwise false
        interface.put(global_this, ZigString::static_("internal"), JSValue::from(is_loopback(iface)));

        // scopeid <number> The numeric IPv6 scope ID (only specified when family is IPv6)
        if addr.family() as c_int == bun_sys::posix::AF::INET6 {
            interface.put(global_this, ZigString::static_("scopeid"), JSValue::js_number(addr.in6().sa.scope_id));
        }

        // Does this entry already exist?
        if let Some(array) = ret.get(global_this, interface_name)? {
            // Add this interface entry to the existing array
            let next_index: u32 = u32::try_from(array.get_length(global_this)?).unwrap();
            array.put_index(global_this, next_index, interface)?;
        } else {
            // Add it as an array with this interface as an element
            let member_name = ZigString::init(interface_name);
            let array = JSValue::create_empty_array(global_this, 1)?;
            array.put_index(global_this, 0, interface)?;
            ret.put(global_this, &member_name, array);
        }

        it = next;
    }

    Ok(ret)
}

#[cfg(windows)]
fn network_interfaces_windows(global_this: &JSGlobalObject) -> JsResult<JSValue> {
    let mut ifaces: *mut libuv::uv_interface_address_t = core::ptr::null_mut();
    let mut count: c_int = 0;
    // SAFETY: valid out-pointers
    let err = unsafe { libuv::uv_interface_addresses(&mut ifaces, &mut count) };
    if err != 0 {
        let sys_err = SystemError {
            message: BunString::static_("uv_interface_addresses failed"),
            code: BunString::static_("ERR_SYSTEM_ERROR"),
            //.info = info,
            errno: err,
            syscall: BunString::static_("uv_interface_addresses"),
            ..Default::default()
        };
        return global_this.throw_value(sys_err.to_error_instance(global_this));
    }
    let _free = scopeguard::guard((), |_| {
        // SAFETY: returned by uv_interface_addresses
        unsafe { libuv::uv_free_interface_addresses(ifaces, count) };
    });

    let ret = JSValue::create_empty_object(global_this, 8);

    // 65 comes from: https://stackoverflow.com/questions/39443413/why-is-inet6-addrstrlen-defined-as-46-in-c
    let mut ip_buf = [0u8; 65];
    let mut mac_buf = [0u8; 17];

    // SAFETY: ifaces points to `count` entries per uv_interface_addresses contract
    let iface_slice = unsafe { core::slice::from_raw_parts(ifaces, usize::try_from(count).unwrap()) };
    for iface in iface_slice {
        let interface = JSValue::create_empty_object(global_this, 7);

        // address <string> The assigned IPv4 or IPv6 address
        // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
        let mut cidr = JSValue::NULL;
        {
            // Compute the CIDR suffix; returns null if the netmask cannot
            //  be converted to a CIDR suffix
            // SAFETY: union read tagged by family
            let family = unsafe { iface.address.address4.family } as c_int;
            let maybe_suffix: Option<u8> = match family {
                bun_sys::posix::AF::INET => netmask_to_cidr_suffix(unsafe { iface.netmask.netmask4.addr }),
                bun_sys::posix::AF::INET6 => netmask_to_cidr_suffix(u128::from_ne_bytes(unsafe { iface.netmask.netmask6.addr })),
                _ => None,
            };

            // Format the address and then, if valid, the CIDR suffix; both
            //  the address and cidr values can be slices into this same buffer
            // e.g. addr_str = "192.168.88.254", cidr_str = "192.168.88.254/24"
            // TODO(port): std.net.Address → bun_sys::net::Address
            let addr_str = bun_fmt::format_ip(
                // bun_sys::net::Address will do ptrCast depending on the family so this is ok
                // SAFETY: address4 is a valid sockaddr
                &unsafe { bun_sys::net::Address::init_posix(&iface.address.address4 as *const _ as *const bun_sys::posix::sockaddr) },
                &mut ip_buf,
            )
            .expect("unreachable");
            let addr_len = addr_str.len();
            let start = addr_str.as_ptr() as usize - ip_buf.as_ptr() as usize;
            if let Some(suffix) = maybe_suffix {
                //NOTE addr_str might not start at buf[0] due to slicing in formatIp
                // Start writing the suffix immediately after the address
                let suffix_len = {
                    let mut cursor = &mut ip_buf[start + addr_len..];
                    write!(cursor, "/{}", suffix).expect("unreachable");
                    let remaining = cursor.len();
                    (ip_buf.len() - (start + addr_len)) - remaining
                };
                // The full cidr value is the address + the suffix
                let cidr_str = &ip_buf[start..start + addr_len + suffix_len];
                cidr = ZigString::init(cidr_str).with_encoding().to_js(global_this);
            }

            interface.put(global_this, ZigString::static_("address"), ZigString::init(&ip_buf[start..start + addr_len]).with_encoding().to_js(global_this));
        }

        // netmask
        {
            let str = bun_fmt::format_ip(
                // bun_sys::net::Address will do ptrCast depending on the family so this is ok
                // SAFETY: netmask4 is a valid sockaddr
                &unsafe { bun_sys::net::Address::init_posix(&iface.netmask.netmask4 as *const _ as *const bun_sys::posix::sockaddr) },
                &mut ip_buf,
            )
            .expect("unreachable");
            interface.put(global_this, ZigString::static_("netmask"), ZigString::init(str).with_encoding().to_js(global_this));
        }
        // family
        // SAFETY: union read tagged by family
        let family = unsafe { iface.address.address4.family } as c_int;
        interface.put(global_this, ZigString::static_("family"), match family {
            bun_sys::posix::AF::INET => global_this.common_strings().ipv4(),
            bun_sys::posix::AF::INET6 => global_this.common_strings().ipv6(),
            _ => ZigString::static_("unknown").to_js(global_this),
        });

        // mac
        {
            let phys = &iface.phys_addr;
            let mac = {
                let mut cursor = &mut mac_buf[..];
                write!(
                    cursor,
                    "{:02x}:{:02x}:{:02x}:{:02x}:{:02x}:{:02x}",
                    phys[0], phys[1], phys[2], phys[3], phys[4], phys[5],
                )
                .expect("unreachable");
                &mac_buf[..]
            };
            interface.put(global_this, ZigString::static_("mac"), ZigString::init(mac).with_encoding().to_js(global_this));
        }

        // internal
        {
            interface.put(global_this, ZigString::static_("internal"), JSValue::from(iface.is_internal != 0));
        }

        // cidr. this is here to keep ordering consistent with the node implementation
        interface.put(global_this, ZigString::static_("cidr"), cidr);

        // scopeid
        if family == bun_sys::posix::AF::INET6 {
            // SAFETY: union read; family == INET6
            interface.put(global_this, ZigString::static_("scopeid"), JSValue::js_number(unsafe { iface.address.address6.scope_id }));
        }

        // Does this entry already exist?
        // SAFETY: iface.name is a NUL-terminated C string from libuv
        let interface_name = unsafe { core::ffi::CStr::from_ptr(iface.name) }.to_bytes();
        if let Some(array) = ret.get(global_this, interface_name)? {
            // Add this interface entry to the existing array
            let next_index: u32 = u32::try_from(array.get_length(global_this)?).unwrap();
            array.put_index(global_this, next_index, interface)?;
        } else {
            // Add it as an array with this interface as an element
            let member_name = ZigString::init(interface_name);
            let array = JSValue::create_empty_array(global_this, 1)?;
            array.put_index(global_this, 0, interface)?;
            ret.put(global_this, &member_name, array);
        }
    }

    Ok(ret)
}

pub fn release() -> BunString {
    let mut name_buffer = [0u8; HOST_NAME_MAX];

    #[cfg(target_os = "linux")]
    let value: &[u8] = {
        // TODO(port): std.posix.uname → bun_sys::posix::uname
        let uts = bun_sys::posix::uname();
        let result = bun_str::slice_to_nul(&uts.release);
        name_buffer[..result.len()].copy_from_slice(result);
        &name_buffer[0..result.len()]
    };
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    let value: &[u8] = 'slice: {
        name_buffer.fill(0);

        let mut size: usize = name_buffer.len();

        // SAFETY: valid buffers
        if unsafe {
            c::sysctlbyname(
                c"kern.osrelease".as_ptr(),
                name_buffer.as_mut_ptr() as *mut c_void,
                &mut size,
                core::ptr::null_mut(),
                0,
            )
        } == -1
        {
            break 'slice b"unknown";
        }

        bun_str::slice_to_nul(&name_buffer)
    };
    #[cfg(windows)]
    let value: &[u8] = 'slice: {
        // SAFETY: zeroed POD
        let mut info: libuv::uv_utsname_s = unsafe { core::mem::zeroed() };
        // SAFETY: valid out-pointer
        let err = unsafe { libuv::uv_os_uname(&mut info) };
        if err != 0 {
            break 'slice b"unknown";
        }
        let value = bun_str::slice_to_nul(&info.release);
        name_buffer[0..value.len()].copy_from_slice(value);
        &name_buffer[0..value.len()]
    };

    BunString::clone_utf8(value)
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    pub fn set_process_priority(pid: i32, priority: i32) -> i32;
}

pub fn set_process_priority_impl(pid: i32, priority: i32) -> bun_sys::E {
    if pid < 0 {
        return bun_sys::E::SRCH;
    }

    // SAFETY: pure FFI call
    let code: i32 = unsafe { set_process_priority(pid, priority) };

    if code == -2 {
        return bun_sys::E::SRCH;
    }
    if code == 0 {
        return bun_sys::E::SUCCESS;
    }

    let errcode = bun_sys::get_errno(code);
    // SAFETY: errcode is a valid errno value; bun_sys::E is #[repr(uN)]
    unsafe { core::mem::transmute(errcode as c_int) }
}

pub fn set_priority1(global: &JSGlobalObject, pid: i32, priority: i32) -> Result<(), bun_core::Error> {
    let errcode = set_process_priority_impl(pid, priority);
    match errcode {
        bun_sys::E::SRCH => {
            let err = SystemError {
                message: BunString::static_("no such process"),
                code: BunString::static_("ESRCH"),
                #[cfg(not(windows))]
                errno: -(bun_sys::posix::E::SRCH as c_int),
                #[cfg(windows)]
                errno: libuv::UV_ESRCH,
                syscall: BunString::static_("uv_os_getpriority"),
                ..Default::default()
            };
            global.throw_value(err.to_error_instance_with_info_object(global))
        }
        bun_sys::E::ACCES => {
            let err = SystemError {
                message: BunString::static_("permission denied"),
                code: BunString::static_("EACCES"),
                #[cfg(not(windows))]
                errno: -(bun_sys::posix::E::ACCES as c_int),
                #[cfg(windows)]
                errno: libuv::UV_EACCES,
                syscall: BunString::static_("uv_os_getpriority"),
                ..Default::default()
            };
            global.throw_value(err.to_error_instance_with_info_object(global))
        }
        bun_sys::E::PERM => {
            let err = SystemError {
                message: BunString::static_("operation not permitted"),
                code: BunString::static_("EPERM"),
                #[cfg(not(windows))]
                errno: -(bun_sys::posix::E::SRCH as c_int),
                #[cfg(windows)]
                errno: libuv::UV_ESRCH,
                syscall: BunString::static_("uv_os_getpriority"),
                ..Default::default()
            };
            global.throw_value(err.to_error_instance_with_info_object(global))
        }
        _ => {
            // no other error codes can be emitted
            Ok(())
        }
    }
}

pub fn set_priority2(global: &JSGlobalObject, priority: i32) -> Result<(), bun_core::Error> {
    set_priority1(global, 0, priority)
}

pub fn totalmem() -> u64 {
    #[cfg(target_os = "macos")]
    {
        let mut memory_: [c_ulonglong; 32] = [0; 32];
        let mut size: usize = memory_.len();

        if bun_sys::posix::sysctlbyname(c"hw.memsize", memory_.as_mut_ptr() as *mut c_void, &mut size, core::ptr::null_mut(), 0).is_err() {
            return 0;
        }

        return memory_[0];
    }
    #[cfg(target_os = "linux")]
    {
        // SAFETY: zeroed POD
        let mut info: c::struct_sysinfo = unsafe { core::mem::zeroed() };
        // SAFETY: valid out-pointer
        if unsafe { c::sysinfo(&mut info) } == 0 {
            // SAFETY: same-size POD reinterpret
            return unsafe { core::mem::transmute::<_, u64>(info.totalram) }.wrapping_mul(info.mem_unit as c_ulong as u64);
        }
        return 0;
    }
    #[cfg(target_os = "freebsd")]
    {
        let mut physmem: u64 = 0;
        let mut size: usize = core::mem::size_of::<u64>();
        if bun_sys::posix::sysctlbyname(c"hw.physmem", &mut physmem as *mut u64 as *mut c_void, &mut size, core::ptr::null_mut(), 0).is_err() {
            return 0;
        }
        return physmem;
    }
    #[cfg(windows)]
    {
        // SAFETY: pure FFI getter
        return unsafe { libuv::uv_get_total_memory() };
    }
}

pub fn uptime(global: &JSGlobalObject) -> JsResult<f64> {
    #[cfg(windows)]
    {
        let mut uptime_value: f64 = 0.0;
        // SAFETY: valid out-pointer
        let err = unsafe { libuv::uv_uptime(&mut uptime_value) };
        if err != 0 {
            let sys_err = SystemError {
                message: BunString::static_("failed to get system uptime"),
                code: BunString::static_("ERR_SYSTEM_ERROR"),
                errno: err,
                syscall: BunString::static_("uv_uptime"),
                ..Default::default()
            };
            return global.throw_value(sys_err.to_error_instance(global));
        }
        return Ok(uptime_value);
    }
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    {
        // SAFETY: zeroed POD
        let mut boot_time: bun_sys::posix::timeval = unsafe { core::mem::zeroed() };
        let mut size: usize = core::mem::size_of::<bun_sys::posix::timeval>();

        if bun_sys::posix::sysctlbyname(c"kern.boottime", &mut boot_time as *mut _ as *mut c_void, &mut size, core::ptr::null_mut(), 0).is_err() {
            return Ok(0.0);
        }

        // TODO(port): std.time.timestamp() → bun_sys::time::timestamp() (no std::time wallclock)
        return Ok((bun_sys::time::timestamp() - boot_time.tv_sec as i64) as f64);
    }
    #[cfg(target_os = "linux")]
    {
        let _ = global;
        // SAFETY: zeroed POD
        let mut info: c::struct_sysinfo = unsafe { core::mem::zeroed() };
        // SAFETY: valid out-pointer
        if unsafe { c::sysinfo(&mut info) } == 0 {
            return Ok(info.uptime as f64);
        }
        return Ok(0.0);
    }
}

pub fn user_info(global_this: &JSGlobalObject, options: gen::UserInfoOptions) -> JsResult<JSValue> {
    let _ = options; // TODO:

    let result = JSValue::create_empty_object(global_this, 5);

    let home = homedir(global_this)?;
    let home = scopeguard::guard(home, |h| h.deref());

    result.put(global_this, ZigString::static_("homedir"), home.to_js(global_this)?);

    #[cfg(windows)]
    {
        result.put(global_this, ZigString::static_("username"), ZigString::init(env_var::USER.get().unwrap_or(b"unknown")).with_encoding().to_js(global_this));
        result.put(global_this, ZigString::static_("uid"), JSValue::js_number(-1));
        result.put(global_this, ZigString::static_("gid"), JSValue::js_number(-1));
        result.put(global_this, ZigString::static_("shell"), JSValue::NULL);
    }
    #[cfg(not(windows))]
    {
        let username = env_var::USER.get().unwrap_or(b"unknown");

        result.put(global_this, ZigString::static_("username"), ZigString::init(username).with_encoding().to_js(global_this));
        result.put(global_this, ZigString::static_("shell"), ZigString::init(env_var::SHELL.get().unwrap_or(b"unknown")).with_encoding().to_js(global_this));
        // SAFETY: pure FFI getters
        result.put(global_this, ZigString::static_("uid"), JSValue::js_number(unsafe { c::getuid() }));
        result.put(global_this, ZigString::static_("gid"), JSValue::js_number(unsafe { c::getgid() }));
    }

    Ok(result)
}

pub fn version() -> JsResult<BunString> {
    let mut name_buffer = [0u8; HOST_NAME_MAX];

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    let slice: &[u8] = 'slice: {
        name_buffer.fill(0);

        let mut size: usize = name_buffer.len();

        // SAFETY: valid buffers
        if unsafe {
            c::sysctlbyname(
                c"kern.version".as_ptr(),
                name_buffer.as_mut_ptr() as *mut c_void,
                &mut size,
                core::ptr::null_mut(),
                0,
            )
        } == -1
        {
            break 'slice b"unknown";
        }

        bun_str::slice_to_nul(&name_buffer)
    };
    #[cfg(target_os = "linux")]
    let slice: &[u8] = {
        let uts = bun_sys::posix::uname();
        let result = bun_str::slice_to_nul(&uts.version);
        name_buffer[..result.len()].copy_from_slice(result);
        &name_buffer[0..result.len()]
    };
    #[cfg(windows)]
    let slice: &[u8] = 'slice: {
        // SAFETY: zeroed POD
        let mut info: libuv::uv_utsname_s = unsafe { core::mem::zeroed() };
        // SAFETY: valid out-pointer
        let err = unsafe { libuv::uv_os_uname(&mut info) };
        if err != 0 {
            break 'slice b"unknown";
        }
        let s = bun_str::slice_to_nul(&info.version);
        name_buffer[0..s.len()].copy_from_slice(s);
        &name_buffer[0..s.len()]
    };

    Ok(BunString::clone_utf8(slice))
}

/// Given a netmask returns a CIDR suffix.  Returns null if the mask is not valid.
/// `T` must be one of u32 (IPv4) or u128 (IPv6)
fn netmask_to_cidr_suffix<T: NetmaskInt>(mask: T) -> Option<u8> {
    let mask_bits = mask.swap_bytes();

    // Validity check: set bits should be left-contiguous
    let first_zero = (!mask_bits).leading_zeros();
    let last_one = T::BITS - mask_bits.trailing_zeros();
    if first_zero < T::BITS && first_zero < last_one {
        return None;
    }
    Some(u8::try_from(first_zero).unwrap())
}

// Helper trait for netmask_to_cidr_suffix (u32 / u128)
trait NetmaskInt: Copy + core::ops::Not<Output = Self> {
    const BITS: u32;
    fn swap_bytes(self) -> Self;
    fn leading_zeros(self) -> u32;
    fn trailing_zeros(self) -> u32;
}
impl NetmaskInt for u32 {
    const BITS: u32 = u32::BITS;
    fn swap_bytes(self) -> Self { u32::swap_bytes(self) }
    fn leading_zeros(self) -> u32 { u32::leading_zeros(self) }
    fn trailing_zeros(self) -> u32 { u32::trailing_zeros(self) }
}
impl NetmaskInt for u128 {
    const BITS: u32 = u128::BITS;
    fn swap_bytes(self) -> Self { u128::swap_bytes(self) }
    fn leading_zeros(self) -> u32 { u128::leading_zeros(self) }
    fn trailing_zeros(self) -> u32 { u128::trailing_zeros(self) }
}

// ───────────────────────── local helpers ─────────────────────────

#[inline]
fn parse_u64(s: &[u8]) -> Result<u64, bun_core::Error> {
    // TODO(port): std.fmt.parseInt → bun_str/bun_core integer parser over &[u8]
    core::str::from_utf8(s)
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .ok_or(bun_core::err!("InvalidCharacter"))
}

#[inline]
fn parse_u32(s: &[u8]) -> Result<u32, bun_core::Error> {
    core::str::from_utf8(s)
        .ok()
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or(bun_core::err!("InvalidCharacter"))
}

#[inline]
fn trim_bytes<'a>(s: &'a [u8], chars: &[u8]) -> &'a [u8] {
    let mut start = 0;
    let mut end = s.len();
    while start < end && chars.contains(&s[start]) {
        start += 1;
    }
    while end > start && chars.contains(&s[end - 1]) {
        end -= 1;
    }
    &s[start..end]
}

#[cfg(windows)]
#[inline]
fn slice_to_nul_u16(buf: &[u16]) -> &[u16] {
    let nul = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    &buf[..nul]
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_os.zig (1114 lines)
//   confidence: medium
//   todos:      16
//   notes:      heavy platform-conditional FFI; std.fs/std.net/std.posix mapped to bun_sys placeholders; gen::node_os codegen wiring deferred to Phase B
// ──────────────────────────────────────────────────────────────────────────
