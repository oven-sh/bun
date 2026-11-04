#[cfg(not(windows))]
use core::ffi::{c_char, c_int, c_uint, c_void};

use bun_core::String as BunString;
use bun_jsc::bindgen::JsScope;
use bun_jsc::bun_string_jsc;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

unsafe extern "C" {
    safe fn bun_sysconf__SC_NPROCESSORS_ONLN() -> i32;
}

#[derive(Default, Clone, Copy)]
pub(crate) struct CPUTimes {
    pub user: u64,
    pub nice: u64,
    pub sys: u64,
    pub idle: u64,
    pub irq: u64,
}

pub(crate) fn freemem() -> u64 {
    // OsBinding.cpp
    unsafe extern "C" {
        safe fn Bun__Os__getFreeMemory() -> u64;
    }
    Bun__Os__getFreeMemory()
}

mod _impl {
    use super::*;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    use bun_core::ZStr;
    #[cfg(not(windows))]
    use bun_core::strings;
    use bun_core::{env_var, fmt as bun_fmt};
    use bun_jsc::{StringJsc as _, SysErrorJsc as _, SystemError};

    #[cfg(not(windows))]
    use bun_sys::c;
    #[cfg(windows)]
    use bun_sys::windows;
    #[cfg(not(windows))]
    use std::io::Write as _;

    // ─── local shims for upstream API gaps (Phase D) ──────────────────────────

    /// Unified error for `cpus_impl_*` so `?` works on both `JsResult` and
    /// `crate::Error`/`bun_sys::Error`. The variant payload is discarded by
    /// `cpus()`, which throws a `SystemError`.
    pub(crate) enum OsError {
        Js,
        Any,
    }
    impl From<bun_jsc::JsError> for OsError {
        fn from(_: bun_jsc::JsError) -> Self {
            Self::Js
        }
    }
    impl From<crate::Error> for OsError {
        fn from(_: crate::Error) -> Self {
            Self::Any
        }
    }
    impl From<bun_sys::Error> for OsError {
        fn from(_: bun_sys::Error) -> Self {
            Self::Any
        }
    }

    // Neither `bun_core` nor `bun_sys` re-exports HOST_NAME_MAX yet; 256 is a
    // safe upper bound for the stack buffer on every platform.
    const HOST_NAME_MAX: usize = 256;

    pub(crate) fn host_cpu_count() -> i32 {
        bun_sysconf__SC_NPROCESSORS_ONLN().max(1)
    }

    impl CPUTimes {
        fn to_value(self, global_this: &JSGlobalObject) -> JSValue {
            let ret = JSValue::create_empty_object(global_this, 5);
            ret.put(
                global_this,
                b"user",
                JSValue::js_number_from_uint64(self.user),
            );
            ret.put(
                global_this,
                b"nice",
                JSValue::js_number_from_uint64(self.nice),
            );
            ret.put(
                global_this,
                b"sys",
                JSValue::js_number_from_uint64(self.sys),
            );
            ret.put(
                global_this,
                b"idle",
                JSValue::js_number_from_uint64(self.idle),
            );
            ret.put(
                global_this,
                b"irq",
                JSValue::js_number_from_uint64(self.irq),
            );
            ret
        }
    }

    pub(crate) fn cpus(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        #[cfg(any(target_os = "linux", target_os = "android"))]
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
                    code: BunString::static_("ERR_SYSTEM_ERROR"),
                    ..Default::default()
                };
                Err(global.throw_value(err.to_error_instance(global)))
            }
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn cpus_impl_linux(global_this: &JSGlobalObject) -> Result<JSValue, OsError> {
        // Create the return array
        let values = JSValue::create_empty_array(global_this, 0)?;
        let mut num_cpus: u32 = 0;

        let mut file_buf: Vec<u8> = Vec::new();

        // Read /proc/stat to get number of CPUs and times
        {
            let file =
                match bun_sys::File::open(bun_core::zstr!("/proc/stat"), bun_sys::O::RDONLY, 0) {
                    Ok(f) => f,
                    Err(_) => {
                        // hidepid mounts (common on Android) deny /proc/stat. lazyCpus in os.ts
                        // pre-creates hostCpuCount lazy proxies, so return that many stub
                        // entries (zeroed times / unknown model / speed 0) — matches Node.
                        let count: u32 =
                            u32::try_from(1i32.max(bun_sysconf__SC_NPROCESSORS_ONLN())).unwrap();
                        let stubs = JSValue::create_empty_array(global_this, count as usize)?;
                        let mut i: u32 = 0;
                        while i < count {
                            let cpu = JSValue::create_empty_object(global_this, 3);
                            cpu.put(
                                global_this,
                                b"times",
                                CPUTimes::default().to_value(global_this),
                            );
                            cpu.put(
                                global_this,
                                b"model",
                                global_this.common_strings().unknown(),
                            );
                            cpu.put(global_this, b"speed", JSValue::js_number(0.0));
                            stubs.put_index(global_this, i, cpu)?;
                            i += 1;
                        }
                        return Ok(stubs);
                    }
                };
            // file closed on Drop

            file.read_to_end_with_array_list(&mut file_buf, bun_sys::SizeHint::ProbablySmall)?;
            let contents = file_buf.as_slice();

            let mut line_iter = strings::tokenize(contents, b"\n");

            // Skip the first line (aggregate of all CPUs)
            let _ = line_iter.next();

            // Read each CPU line
            while let Some(line) = line_iter.next() {
                // CPU lines are formatted as `cpu0 user nice sys idle iowait irq softirq`
                let mut toks = strings::tokenize_any(line, b" \t");
                let cpu_name = toks.next();
                if cpu_name.is_none() || !cpu_name.unwrap().starts_with(b"cpu") {
                    break; // done with CPUs
                }

                //NOTE: libuv assumes this is fixed on Linux, not sure that's actually the case
                let scale: u64 = 10;

                let times = CPUTimes {
                    user: scale * parse_u64(toks.next().ok_or(crate::Error::eol)?)?,
                    nice: scale * parse_u64(toks.next().ok_or(crate::Error::eol)?)?,
                    sys: scale * parse_u64(toks.next().ok_or(crate::Error::eol)?)?,
                    idle: scale * parse_u64(toks.next().ok_or(crate::Error::eol)?)?,
                    irq: {
                        let _ = toks.next().ok_or(crate::Error::eol)?; // skip iowait
                        scale * parse_u64(toks.next().ok_or(crate::Error::eol)?)?
                    },
                };

                // Actually create the JS object representing the CPU
                let cpu = JSValue::create_empty_object(global_this, 1);
                cpu.put(global_this, b"times", times.to_value(global_this));
                values.put_index(global_this, num_cpus, cpu)?;

                num_cpus += 1;
            }

            file_buf.clear();
        }

        // Read /proc/cpuinfo to get model information (optional)
        if let Ok(file) =
            bun_sys::File::open(bun_core::zstr!("/proc/cpuinfo"), bun_sys::O::RDONLY, 0)
        {
            // file closed on Drop

            file.read_to_end_with_array_list(&mut file_buf, bun_sys::SizeHint::ProbablySmall)?;
            let contents = file_buf.as_slice();

            let mut line_iter = strings::tokenize(contents, b"\n");

            const KEY_PROCESSOR: &[u8] = b"processor\t: ";
            const KEY_MODEL_NAME: &[u8] = b"model name\t: ";

            let mut cpu_index: u32 = 0;
            let mut has_model_name = true;
            while let Some(line) = line_iter.next() {
                if line.starts_with(KEY_PROCESSOR) {
                    if !has_model_name {
                        let cpu = values.get_index(global_this, cpu_index)?;
                        cpu.put(
                            global_this,
                            b"model",
                            global_this.common_strings().unknown(),
                        );
                    }
                    // If this line starts a new processor, parse the index from the line
                    let digits = strings::trim(&line[KEY_PROCESSOR.len()..], b" \t\n");
                    cpu_index = parse_u32(digits)?;
                    if cpu_index >= num_cpus {
                        return Err(OsError::Any);
                    }
                    has_model_name = false;
                } else if line.starts_with(KEY_MODEL_NAME) {
                    // If this is the model name, extract it and store on the current cpu
                    let model_name = &line[KEY_MODEL_NAME.len()..];
                    let cpu = values.get_index(global_this, cpu_index)?;
                    cpu.put(
                        global_this,
                        b"model",
                        bun_string_jsc::create_utf8_for_js(global_this, model_name)?,
                    );
                    has_model_name = true;
                }
            }
            if !has_model_name {
                let cpu = values.get_index(global_this, cpu_index)?;
                cpu.put(
                    global_this,
                    b"model",
                    global_this.common_strings().unknown(),
                );
            }

            file_buf.clear();
        } else {
            // Initialize model name to "unknown"
            let mut it = values.array_iterator(global_this)?;
            while let Some(cpu) = it.next()? {
                cpu.put(
                    global_this,
                    b"model",
                    global_this.common_strings().unknown(),
                );
            }
        }

        // Read /sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq to get current frequency (optional)
        for cpu_index in 0..num_cpus as usize {
            let cpu = values.get_index(global_this, cpu_index as u32)?;

            let mut path_buf = [0u8; 128];
            let path: &ZStr = {
                let mut cursor = &mut path_buf[..];
                write!(
                    cursor,
                    "/sys/devices/system/cpu/cpu{}/cpufreq/scaling_cur_freq\0",
                    cpu_index
                )
                .map_err(|_| crate::Error::fmt)?;
                let remaining = cursor.len();
                let written = path_buf.len() - remaining;
                // SAFETY: we wrote a NUL terminator at path_buf[written-1]
                ZStr::from_buf(&path_buf[..], written - 1)
            };
            if let Ok(file) = bun_sys::File::open(path, bun_sys::O::RDONLY, 0) {
                // file closed on Drop

                file.read_to_end_with_array_list(&mut file_buf, bun_sys::SizeHint::ProbablySmall)?;
                let contents = file_buf.as_slice();

                let digits = strings::trim(contents, b" \n");
                let speed = parse_u64(digits).unwrap_or(0) / 1000;

                cpu.put(global_this, b"speed", JSValue::js_number(speed as f64));

                file_buf.clear();
            } else {
                // Initialize CPU speed to 0
                cpu.put(global_this, b"speed", JSValue::js_number(0.0));
            }
        }

        Ok(values)
    }

    #[cfg(target_os = "freebsd")]
    fn cpus_impl_freebsd(global_this: &JSGlobalObject) -> Result<JSValue, OsError> {
        let mut ncpu: c_uint = 0;
        bun_sys::posix::sysctl_read(c"hw.ncpu", &mut ncpu).map_err(|_| OsError::Any)?;
        if ncpu == 0 {
            return Err(OsError::Any);
        }

        let mut model_buf = [0u8; 512];
        let model = if bun_sys::posix::sysctl_read_slice(c"hw.model", &mut model_buf[..]).is_ok() {
            bun_string_jsc::create_utf8_for_js(global_this, bun_core::slice_to_nul(&model_buf))?
        } else {
            global_this.common_strings().unknown()
        };

        let mut speed_mhz: c_uint = 0;
        let _ = bun_sys::posix::sysctl_read(c"hw.clockrate", &mut speed_mhz);

        const CPU_STATES: usize = 5; // user, nice, sys, intr, idle
        let mut times_buf: Vec<core::ffi::c_long> = vec![0; ncpu as usize * CPU_STATES];
        bun_sys::posix::sysctl_read_slice(c"kern.cp_times", &mut times_buf[..])
            .map_err(|_| OsError::Any)?;

        let ticks: i64 = bun_sysconf__SC_CLK_TCK() as i64;
        let mult: u64 = if ticks > 0 {
            1000 / u64::try_from(ticks).expect("int cast")
        } else {
            1
        };

        let values = JSValue::create_empty_array(global_this, ncpu as usize)?;
        let mut i: u32 = 0;
        while i < ncpu {
            let off = i as usize * CPU_STATES;
            let times = CPUTimes {
                user: u64::try_from(times_buf[off + 0].max(0)).expect("int cast") * mult,
                nice: u64::try_from(times_buf[off + 1].max(0)).expect("int cast") * mult,
                sys: u64::try_from(times_buf[off + 2].max(0)).expect("int cast") * mult,
                irq: u64::try_from(times_buf[off + 3].max(0)).expect("int cast") * mult,
                idle: u64::try_from(times_buf[off + 4].max(0)).expect("int cast") * mult,
            };
            let cpu = JSValue::create_empty_object(global_this, 3);
            cpu.put(global_this, b"model", model);
            cpu.put(global_this, b"speed", JSValue::js_number(speed_mhz as f64));
            cpu.put(global_this, b"times", times.to_value(global_this));
            values.put_index(global_this, i, cpu)?;
            i += 1;
        }
        Ok(values)
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    unsafe extern "C" {
        safe fn bun_sysconf__SC_CLK_TCK() -> isize;
    }

    #[cfg(target_os = "macos")]
    fn cpus_impl_darwin(global_this: &JSGlobalObject) -> Result<JSValue, OsError> {
        // Fetch the CPU info structure
        let mut num_cpus: c::natural_t = 0;
        let mut info: *mut c::processor_cpu_load_info = core::ptr::null_mut();
        let mut info_size: c::mach_msg_type_number_t = 0;
        // SAFETY: FFI call with valid out-pointers
        if unsafe {
            c::host_processor_info(
                c::mach_host_self(),
                c::PROCESSOR_CPU_LOAD_INFO,
                &raw mut num_cpus,
                (&raw mut info).cast::<c::processor_info_array_t>(),
                &raw mut info_size,
            )
        } != 0
        {
            return Err(OsError::Any);
        }
        scopeguard::defer! {
            // SAFETY: info/info_size returned by host_processor_info
            unsafe { let _ = c::vm_deallocate(c::mach_task_self(), info as usize, info_size as usize); }
        };

        // Ensure we got the amount of data we expected to guard against buffer overruns
        if info_size != c::PROCESSOR_CPU_LOAD_INFO_COUNT * num_cpus {
            return Err(OsError::Any);
        }

        // Get CPU model name
        let mut model_name_buf = [0u8; 512];
        // Try brand_string first and if it fails try hw.model
        if !(bun_sys::posix::sysctl_read_slice(
            c"machdep.cpu.brand_string",
            &mut model_name_buf[..],
        )
        .is_ok()
            || bun_sys::posix::sysctl_read_slice(c"hw.model", &mut model_name_buf[..]).is_ok())
        {
            return Err(OsError::Any);
        }
        // NOTE: sysctlbyname doesn't update len if it was large enough, so we
        // still have to find the null terminator.  All cpus can share the same
        // model name.
        let model_name = bun_string_jsc::create_utf8_for_js(
            global_this,
            bun_core::slice_to_nul(&model_name_buf),
        )?;

        // Get CPU speed
        let mut speed: u64 = 0;
        let _ = bun_sys::posix::sysctl_read(c"hw.cpufrequency", &mut speed);
        if speed == 0 {
            // Suggested by Node implementation:
            // If sysctl hw.cputype == CPU_TYPE_ARM64, the correct value is unavailable
            // from Apple, but we can hard-code it here to a plausible value.
            speed = 2_400_000_000;
        }

        // Get the multiplier; this is the number of ms/tick
        let ticks: i64 = bun_sysconf__SC_CLK_TCK() as i64;
        let multiplier: u64 = 1000 / u64::try_from(ticks).expect("int cast");

        // Set up each CPU value in the return
        let values = JSValue::create_empty_array(global_this, num_cpus as usize)?;
        let mut cpu_index: u32 = 0;
        // SAFETY: info points to num_cpus entries per host_processor_info contract
        let info_slice = unsafe { bun_core::ffi::slice(info, num_cpus as usize) };
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
            cpu.put(
                global_this,
                b"speed",
                JSValue::js_number((speed / 1_000_000) as f64),
            );
            cpu.put(global_this, b"model", model_name);
            cpu.put(global_this, b"times", times.to_value(global_this));

            values.put_index(global_this, cpu_index, cpu)?;
            cpu_index += 1;
        }
        Ok(values)
    }

    #[cfg(windows)]
    fn cpus_impl_windows(global_this: &JSGlobalObject) -> Result<JSValue, OsError> {
        let infos = win32::cpus().map_err(|_| OsError::Any)?;

        let values = JSValue::create_empty_array(global_this, infos.len())?;

        for (i, cpu_info) in infos.iter().enumerate() {
            let cpu = JSValue::create_empty_object(global_this, 3);
            cpu.put(
                global_this,
                b"model",
                BunString::clone_utf16(&cpu_info.model).into_js(global_this)?,
            );
            cpu.put(
                global_this,
                b"speed",
                JSValue::js_number(cpu_info.speed as f64),
            );
            cpu.put(global_this, b"times", cpu_info.times.to_value(global_this));

            values.put_index(global_this, u32::try_from(i).expect("int cast"), cpu)?;
        }

        Ok(values)
    }

    #[cfg(not(windows))]
    unsafe extern "C" {
        safe fn get_process_priority(pid: i32) -> i32;
    }

    pub(crate) fn get_priority(cx: &mut JsScope<'_>, pid: i32) -> JsResult<i32> {
        #[cfg(windows)]
        let result = win32::priority(pid);
        #[cfg(not(windows))]
        let result = match get_process_priority(pid) {
            i32::MAX => Err(bun_sys::E::ESRCH),
            priority => Ok(priority),
        };
        result.map_err(|errno| priority_error(cx, errno, bun_sys::Tag::uv_os_getpriority))
    }

    fn priority_error(
        cx: &mut JsScope<'_>,
        errno: bun_sys::E,
        syscall: bun_sys::Tag,
    ) -> bun_jsc::JsError {
        let global = cx.global();
        let err = bun_sys::Error::from_code(errno, syscall);
        let mut sys_err: SystemError = err.to_system_error().into();
        // Node's message here is the bare libuv label, not "ESRCH: …, uv_os_setpriority".
        sys_err.message =
            BunString::static_(err.uv_code_label().map_or("unknown error", |(_, l)| l));
        global.throw_value(sys_err.to_error_instance_with_info_object(global))
    }

    pub(crate) fn homedir(cx: &mut JsScope<'_>) -> JsResult<BunString> {
        let global = cx.global();
        // In Node.js, this is a wrapper around uv_os_homedir.
        #[cfg(windows)]
        {
            return match win32::home_directory() {
                Ok(path) => Ok(BunString::clone_utf16(&path)),
                Err(err) => Err(global.throw_value(err.to_js(global))),
            };
        }
        #[cfg(not(windows))]
        {
            // The posix implementation of uv_os_homedir first checks the HOME
            // environment variable, then falls back to reading the passwd entry.
            if let Some(home) = env_var::HOME.get() {
                if !home.is_empty() {
                    return Ok(BunString::clone_utf8(home));
                }
            }

            // From libuv:
            // > Calling sysconf(_SC_GETPW_R_SIZE_MAX) would get the suggested size, but it
            // > is frequently 1024 or 4096, so we can just use that directly. The pwent
            // > will not usually be large.
            // Instead of always using an allocation, first try a stack allocation
            // of 4096, then fallback to heap.
            let mut stack_string_bytes = [0u8; 4096];
            let mut heap_bytes: Vec<u8>;
            let mut string_bytes: &mut [u8] = &mut stack_string_bytes[..];
            let mut using_heap = false;

            let mut pw: libc::passwd = bun_core::ffi::zeroed();
            let mut result: *mut libc::passwd = core::ptr::null_mut();

            let ret: c_int = loop {
                // SAFETY: valid buffers and out-pointer
                let ret = unsafe {
                    libc::getpwuid_r(
                        libc::geteuid(),
                        &raw mut pw,
                        string_bytes.as_mut_ptr().cast::<c_char>(),
                        string_bytes.len(),
                        &raw mut result,
                    )
                };

                if ret == bun_sys::E::EINTR as c_int {
                    continue;
                }

                // If the system call wants more memory, double it.
                if ret == bun_sys::E::ERANGE as c_int {
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
                return Err(global.throw_value(
                    bun_sys::Error::from_code(
                        // `ret` is a libc errno; a code outside the table is `EUNKNOWN`.
                        bun_sys::E::from_raw(ret as u16),
                        bun_sys::Tag::uv_os_homedir,
                    )
                    .to_js(global),
                ));
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
                return Err(global.throw_value(
                    bun_sys::Error::from_code(bun_sys::E::ENOENT, bun_sys::Tag::uv_os_homedir)
                        .to_js(global),
                ));
            }

            return Ok(if !pw.pw_dir.is_null() {
                // SAFETY: pw_dir is a NUL-terminated C string from getpwuid_r
                BunString::clone_utf8(unsafe { bun_core::ffi::cstr(pw.pw_dir) }.to_bytes())
            } else {
                BunString::EMPTY
            });
        }
    }

    pub(crate) fn hostname(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        #[cfg(windows)]
        {
            let mut name_buffer: [u16; 130] = [0; 130]; // [129:0]u16 → 130 u16s with NUL at [129]
            windows::ws2_32::ensure_started();
            // SAFETY: valid buffer
            if unsafe { windows::GetHostNameW(name_buffer.as_mut_ptr(), 129) } == 0 {
                return BunString::clone_utf16(slice_to_nul_u16(&name_buffer)).into_js(global);
            }

            return Ok(global.common_strings().unknown());
        }
        #[cfg(not(windows))]
        {
            let mut name_buffer = [0u8; HOST_NAME_MAX];
            let s: &[u8] = if bun_sys::posix::gethostname(&mut name_buffer).is_ok() {
                bun_core::slice_to_nul(&name_buffer)
            } else {
                b"unknown"
            };
            return bun_string_jsc::create_utf8_for_js(global, s);
        }
    }

    pub(crate) fn loadavg() -> [f64; 3] {
        #[cfg(target_os = "macos")]
        let result: [f64; 3] = 'loadavg: {
            let mut avg: c::struct_loadavg = bun_core::ffi::zeroed();
            if bun_sys::posix::sysctl_read(c"vm.loadavg", &mut avg).is_err() {
                break 'loadavg [0.0, 0.0, 0.0];
            }

            let scale: f64 = avg.fscale as f64;
            [
                if scale == 0.0 {
                    0.0
                } else {
                    avg.ldavg[0] as f64 / scale
                },
                if scale == 0.0 {
                    0.0
                } else {
                    avg.ldavg[1] as f64 / scale
                },
                if scale == 0.0 {
                    0.0
                } else {
                    avg.ldavg[2] as f64 / scale
                },
            ]
        };
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let result: [f64; 3] = 'loadavg: {
            if let Ok(info) = bun_sys::posix::sysinfo() {
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

        result
    }

    #[cfg(unix)]
    pub(crate) use network_interfaces_posix as network_interfaces;
    #[cfg(windows)]
    pub(crate) use network_interfaces_windows as network_interfaces;

    #[cfg(unix)]
    pub(crate) fn network_interfaces_posix(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        // getifaddrs sets a pointer to a linked list
        let mut interface_start: *mut libc::ifaddrs = core::ptr::null_mut();
        // SAFETY: valid out-pointer
        let rc = unsafe { libc::getifaddrs(&raw mut interface_start) };
        if rc != 0 {
            let errno = bun_sys::posix::errno();
            // Android API 30+: SELinux denies the netlink socket getifaddrs uses.
            // Node returns {} rather than throwing.
            #[cfg(target_os = "android")]
            {
                if errno == bun_sys::posix::E::EACCES as c_int
                    || errno == bun_sys::posix::E::EPERM as c_int
                {
                    return Ok(JSValue::create_empty_object(global_this, 0));
                }
            }
            let err = SystemError {
                message: BunString::static_(
                    "A system error occurred: getifaddrs returned an error",
                ),
                code: BunString::static_("ERR_SYSTEM_ERROR"),
                errno: errno as c_int,
                syscall: BunString::static_("getifaddrs"),
                ..Default::default()
            };

            return Err(global_this.throw_value(err.to_error_instance(global_this)));
        }
        scopeguard::defer! {
            // SAFETY: returned by getifaddrs
            unsafe { libc::freeifaddrs(interface_start) };
        };

        // We'll skip interfaces that aren't actually available
        fn skip(iface: &libc::ifaddrs) -> bool {
            // Skip interfaces that aren't actually available
            if iface.ifa_flags & libc::IFF_RUNNING as c_uint == 0 {
                return true;
            }
            if iface.ifa_flags & libc::IFF_UP as c_uint == 0 {
                return true;
            }
            if iface.ifa_addr.is_null() {
                return true;
            }
            false
        }

        // We won't actually return link-layer interfaces but we need them for
        //  extracting the MAC address
        fn is_link_layer(iface: &libc::ifaddrs) -> bool {
            if iface.ifa_addr.is_null() {
                return false;
            }
            #[cfg(any(target_os = "linux", target_os = "android"))]
            // SAFETY: ifa_addr is non-null per check above
            return unsafe { (*iface.ifa_addr).sa_family } as c_int == libc::AF_PACKET;
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            // SAFETY: ifa_addr is non-null per check above
            return unsafe { (*iface.ifa_addr).sa_family } as c_int == libc::AF_LINK;
        }

        fn is_loopback(iface: &libc::ifaddrs) -> bool {
            iface.ifa_flags & libc::IFF_LOOPBACK as c_uint == libc::IFF_LOOPBACK as c_uint
        }

        // The list currently contains entries for link-layer interfaces
        //  and the IPv4, IPv6 interfaces.  We only want to return the latter two
        //  but need the link-layer entries to determine MAC address.
        let ret = JSValue::create_empty_object(global_this, 0);

        // Populate each interface object
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
            let interface_name = unsafe { bun_core::ffi::cstr(iface.ifa_name) }.to_bytes();
            // SAFETY: ifa_addr/ifa_netmask are valid sockaddr* (skip() ensures ifa_addr non-null)
            let addr = unsafe { bun_sys::net::Address::init_posix(iface.ifa_addr.cast_const()) };
            // SAFETY: ifa_netmask is a valid sockaddr* populated by getifaddrs for this entry
            let netmask =
                unsafe { bun_sys::net::Address::init_posix(iface.ifa_netmask.cast_const()) };

            let interface = JSValue::create_empty_object(global_this, 0);

            // address <string> The assigned IPv4 or IPv6 address
            // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
            {
                // Compute the CIDR suffix; returns null if the netmask cannot
                //  be converted to a CIDR suffix
                let maybe_suffix: Option<u8> = match addr.family() as c_int {
                    // SAFETY: family checked; storage is sockaddr_in/sockaddr_in6-sized
                    libc::AF_INET => netmask_to_cidr_suffix(unsafe {
                        (*netmask.as_sockaddr().cast::<libc::sockaddr_in>())
                            .sin_addr
                            .s_addr
                    }),
                    // SAFETY: family checked; storage is sockaddr_in6-sized
                    libc::AF_INET6 => netmask_to_cidr_suffix(u128::from_ne_bytes(unsafe {
                        (*netmask.as_sockaddr().cast::<libc::sockaddr_in6>())
                            .sin6_addr
                            .s6_addr
                    })),
                    _ => None,
                };

                // Format the address and then, if valid, the CIDR suffix; both
                //  the address and cidr values can be slices into this same buffer
                // e.g. addr_str = "192.168.88.254", cidr_str = "192.168.88.254/24"
                let mut buf = [0u8; 64];
                // Reshaped for borrowck — capture buf base ptr/len before
                // format_ip's mutable borrow, and reduce addr_str to (start, len)
                // immediately so subsequent buf accesses don't alias the returned slice.
                let buf_ptr = buf.as_ptr() as usize;
                let buf_len = buf.len();
                let (start, addr_len) = {
                    let addr_str = bun_fmt::format_ip(&addr, &mut buf).expect("unreachable");
                    //NOTE addr_str might not start at buf[0] due to slicing in formatIp
                    (addr_str.as_ptr() as usize - buf_ptr, addr_str.len())
                };
                let mut cidr = JSValue::NULL;
                if let Some(suffix) = maybe_suffix {
                    // Start writing the suffix immediately after the address
                    let suffix_len = {
                        let mut cursor = &mut buf[start + addr_len..];
                        write!(cursor, "/{}", suffix).expect("unreachable");
                        let remaining = cursor.len();
                        (buf_len - (start + addr_len)) - remaining
                    };
                    // The full cidr value is the address + the suffix
                    let cidr_str = &buf[start..start + addr_len + suffix_len];
                    cidr = bun_string_jsc::create_utf8_for_js(global_this, cidr_str)?;
                }

                interface.put(
                    global_this,
                    b"address",
                    bun_string_jsc::create_utf8_for_js(global_this, &buf[start..start + addr_len])?,
                );
                interface.put(global_this, b"cidr", cidr);
            }

            // netmask <string> The IPv4 or IPv6 network mask
            {
                let mut buf = [0u8; 64];
                let str = bun_fmt::format_ip(&netmask, &mut buf).expect("unreachable");
                interface.put(
                    global_this,
                    b"netmask",
                    bun_string_jsc::create_utf8_for_js(global_this, str)?,
                );
            }

            // family <string> Either IPv4 or IPv6
            interface.put(
                global_this,
                b"family",
                match addr.family() as c_int {
                    libc::AF_INET => global_this.common_strings().ipv4(),
                    libc::AF_INET6 => global_this.common_strings().ipv6(),
                    _ => global_this.common_strings().unknown(),
                },
            );

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
                        let ll_name = unsafe { bun_core::ffi::cstr(ll_iface.ifa_name) }.to_bytes();
                        if !strings::has_prefix(ll_name, interface_name) {
                            ll_it = ll_next;
                            continue;
                        }
                        if ll_name.len() > interface_name.len()
                            && ll_name[interface_name.len()] != b':'
                        {
                            ll_it = ll_next;
                            continue;
                        }

                        // This is the correct link-layer interface entry for the current interface,
                        //  cast to a link-layer socket address
                        break 'search Some(ll_iface.ifa_addr.cast::<c_void>().cast_const());
                    }
                    None
                };

                if let Some(ll_addr) = maybe_ll_addr {
                    #[cfg(any(target_os = "linux", target_os = "android"))]
                    // SAFETY: ll_addr is a sockaddr_ll* per is_link_layer check
                    let addr_data: &[u8] =
                        unsafe { &(*ll_addr.cast::<libc::sockaddr_ll>()).sll_addr };
                    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
                    let addr_data: &[u8] = {
                        // SAFETY: ll_addr is a sockaddr_dl* per is_link_layer check.
                        // `sdl_data` is `[c_char; N]` (signedness varies by platform);
                        // reinterpret as bytes — same width, same provenance.
                        let dl = unsafe { &*ll_addr.cast::<c::sockaddr_dl>() };
                        bun_core::slice_as_bytes(&dl.sdl_data[dl.sdl_nlen as usize..])
                    };
                    if addr_data.len() < 6 {
                        let mac = b"00:00:00:00:00:00";
                        interface.put(
                            global_this,
                            b"mac",
                            bun_string_jsc::create_utf8_for_js(global_this, mac)?,
                        );
                    } else {
                        let mac_buf = bun_fmt::mac_address_lower(
                            addr_data[..6].try_into().expect("len>=6 checked above"),
                        );
                        interface.put(
                            global_this,
                            b"mac",
                            bun_string_jsc::create_utf8_for_js(global_this, &mac_buf)?,
                        );
                    }
                } else {
                    let mac = b"00:00:00:00:00:00";
                    interface.put(
                        global_this,
                        b"mac",
                        bun_string_jsc::create_utf8_for_js(global_this, mac)?,
                    );
                }
            }

            // internal <boolean> true if the network interface is a loopback or similar interface that is not remotely accessible; otherwise false
            interface.put(global_this, b"internal", JSValue::from(is_loopback(iface)));

            // scopeid <number> The numeric IPv6 scope ID (only specified when family is IPv6)
            if addr.family() as c_int == libc::AF_INET6 {
                // SAFETY: family checked; storage is sockaddr_in6-sized
                let scope_id =
                    unsafe { (*addr.as_sockaddr().cast::<libc::sockaddr_in6>()).sin6_scope_id };
                interface.put(global_this, b"scopeid", JSValue::js_number(scope_id as f64));
            }

            // Does this entry already exist?
            // The OS picks the interface name, so it can be an array index like "0".
            let key = bun_core::StringView::from_bytes(interface_name);
            if let Some(array) = ret.get_own(global_this, &key)? {
                // Add this interface entry to the existing array
                let next_index: u32 =
                    u32::try_from(array.get_length(global_this)?).expect("int cast");
                array.put_index(global_this, next_index, interface)?;
            } else {
                // Add it as an array with this interface as an element
                let array = JSValue::create_empty_array(global_this, 1)?;
                array.put_index(global_this, 0, interface)?;
                ret.put_may_be_index(global_this, &key, array)?;
            }

            it = next;
        }

        Ok(ret)
    }

    /// `address`, `netmask` and `family`.
    #[cfg(windows)]
    fn put_address(
        global_this: &JSGlobalObject,
        interface: JSValue,
        iface: &win32::InterfaceAddress<'_>,
    ) -> JsResult<()> {
        // 65 comes from: https://stackoverflow.com/questions/39443413/why-is-inet6-addrstrlen-defined-as-46-in-c
        let mut ip_buf = [0u8; 65];
        let address = bun_fmt::buf_print_infallible(&mut ip_buf, format_args!("{}", iface.address));
        interface.put(
            global_this,
            b"address",
            bun_string_jsc::create_utf8_for_js(global_this, address)?,
        );
        let netmask =
            bun_fmt::buf_print_infallible(&mut ip_buf, format_args!("{}", iface.netmask()));
        interface.put(
            global_this,
            b"netmask",
            bun_string_jsc::create_utf8_for_js(global_this, netmask)?,
        );
        interface.put(
            global_this,
            b"family",
            if iface.address.is_ipv6() {
                global_this.common_strings().ipv6()
            } else {
                global_this.common_strings().ipv4()
            },
        );
        Ok(())
    }

    #[cfg(windows)]
    pub(crate) fn network_interfaces_windows(cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global_this = cx.global();
        let adapters = match win32::Adapters::get() {
            Ok(adapters) => adapters,
            Err(err) => {
                let sys_err = SystemError {
                    message: BunString::static_("uv_interface_addresses failed"),
                    code: BunString::static_("ERR_SYSTEM_ERROR"),
                    //.info = info,
                    errno: err,
                    syscall: BunString::static_("uv_interface_addresses"),
                    ..Default::default()
                };
                return Err(global_this.throw_value(sys_err.to_error_instance(global_this)));
            }
        };

        let ret = JSValue::create_empty_object(global_this, 8);

        // 65 comes from: https://stackoverflow.com/questions/39443413/why-is-inet6-addrstrlen-defined-as-46-in-c
        let mut ip_buf = [0u8; 65];

        for iface in adapters.addresses() {
            let interface = JSValue::create_empty_object(global_this, 7);
            put_address(global_this, interface, &iface)?;

            // mac
            {
                let mac_buf = bun_fmt::mac_address_lower(iface.mac);
                interface.put(
                    global_this,
                    b"mac",
                    bun_string_jsc::create_utf8_for_js(global_this, &mac_buf)?,
                );
            }

            // internal
            {
                interface.put(global_this, b"internal", JSValue::from(iface.internal));
            }

            // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation.
            {
                let str = bun_fmt::buf_print_infallible(
                    &mut ip_buf,
                    format_args!("{}/{}", iface.address, iface.prefix_length),
                );
                interface.put(
                    global_this,
                    b"cidr",
                    bun_string_jsc::create_utf8_for_js(global_this, str)?,
                );
            }

            // scopeid
            if iface.address.is_ipv6() {
                interface.put(
                    global_this,
                    b"scopeid",
                    JSValue::js_number(iface.scope_id as f64),
                );
            }

            // Does this entry already exist?
            // The OS picks the interface name, so it can be an array index like "0".
            let key = BunString::clone_utf16(iface.name);
            if let Some(array) = ret.get_own(global_this, &key)? {
                // Add this interface entry to the existing array
                let next_index: u32 =
                    u32::try_from(array.get_length(global_this)?).expect("int cast");
                array.put_index(global_this, next_index, interface)?;
            } else {
                // Add it as an array with this interface as an element
                let array = JSValue::create_empty_array(global_this, 1)?;
                array.put_index(global_this, 0, interface)?;
                ret.put_may_be_index(global_this, &key, array)?;
            }
        }

        Ok(ret)
    }

    // `header.cpus` and `header.networkInterfaces` of `process.report.getReport()`; empty if Windows gives no list.

    #[cfg(windows)]
    #[unsafe(export_name = "Bun__Os__createReportCpus")]
    extern "C" fn create_report_cpus(global_this: &JSGlobalObject) -> JSValue {
        let infos = win32::cpus().unwrap_or_default();
        let cpus = JSValue::create_array_from_iter(global_this, infos.iter(), |info| {
            let cpu = JSValue::create_empty_object(global_this, 7);
            cpu.put(
                global_this,
                b"model",
                BunString::clone_utf16(&info.model).into_js(global_this)?,
            );
            cpu.put(global_this, b"speed", JSValue::js_number(info.speed as f64));
            for (name, time) in [
                ("user", info.times.user),
                ("nice", info.times.nice),
                ("sys", info.times.sys),
                ("idle", info.times.idle),
                ("irq", info.times.irq),
            ] {
                cpu.put(global_this, name, JSValue::js_number_from_uint64(time));
            }
            Ok(cpu)
        });
        bun_jsc::to_js_host_fn_result(global_this, cpus)
    }

    #[cfg(windows)]
    #[unsafe(export_name = "Bun__Os__createReportNetworkInterfaces")]
    extern "C" fn create_report_network_interfaces(global_this: &JSGlobalObject) -> JSValue {
        bun_jsc::to_js_host_fn_result(global_this, report_network_interfaces(global_this))
    }

    #[cfg(windows)]
    fn report_network_interfaces(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let interfaces = JSValue::create_empty_array(global_this, 0)?;
        let Ok(adapters) = win32::Adapters::get() else {
            return Ok(interfaces);
        };

        for iface in adapters.addresses() {
            let interface = JSValue::create_empty_object(global_this, 7);
            interface.put(
                global_this,
                b"name",
                BunString::clone_utf16(iface.name).into_js(global_this)?,
            );
            interface.put(global_this, b"internal", JSValue::from(iface.internal));
            interface.put(
                global_this,
                b"mac",
                bun_string_jsc::create_utf8_for_js(
                    global_this,
                    &bun_fmt::mac_address_lower(iface.mac),
                )?,
            );
            put_address(global_this, interface, &iface)?;
            if iface.address.is_ipv6() {
                interface.put(
                    global_this,
                    b"scopeid",
                    JSValue::js_number(iface.scope_id as f64),
                );
            }
            interfaces.push(global_this, interface)?;
        }

        Ok(interfaces)
    }

    pub(crate) fn release() -> BunString {
        let mut name_buffer = [0u8; HOST_NAME_MAX];

        #[cfg(any(target_os = "linux", target_os = "android"))]
        let value: &[u8] = {
            let uts = bun_core::ffi::uname();
            let result = bun_core::ffi::c_field_bytes(&uts.release);
            name_buffer[..result.len()].copy_from_slice(result);
            &name_buffer[0..result.len()]
        };
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        let value: &[u8] = 'slice: {
            name_buffer.fill(0);
            if bun_sys::posix::sysctl_read_slice(c"kern.osrelease", &mut name_buffer[..]).is_err() {
                break 'slice b"unknown";
            }
            bun_core::slice_to_nul(&name_buffer)
        };
        #[cfg(windows)]
        let value: &[u8] = {
            let info = win32::os_version();
            bun_fmt::buf_print_infallible(
                &mut name_buffer,
                format_args!(
                    "{}.{}.{}",
                    info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber
                ),
            )
        };

        BunString::clone_utf8(value)
    }

    #[cfg(not(windows))]
    unsafe extern "C" {
        pub(crate) safe fn set_process_priority(pid: i32, priority: i32) -> i32;
    }

    fn set_process_priority_impl(pid: i32, priority: i32) -> bun_sys::E {
        if pid < 0 {
            return bun_sys::E::ESRCH;
        }

        #[cfg(windows)]
        return win32::set_priority(pid, priority)
            .err()
            .unwrap_or(bun_sys::E::SUCCESS);
        #[cfg(not(windows))]
        return match set_process_priority(pid, priority) {
            0 => bun_sys::E::SUCCESS,
            code => bun_sys::get_errno(code),
        };
    }

    pub(crate) fn set_priority_of_current_process(
        cx: &mut JsScope<'_>,
        priority: i32,
    ) -> JsResult<()> {
        set_priority(cx, 0, priority)
    }

    pub(crate) fn set_priority(cx: &mut JsScope<'_>, pid: i32, priority: i32) -> JsResult<()> {
        let errno = set_process_priority_impl(pid, priority);
        if errno == bun_sys::E::SUCCESS {
            return Ok(());
        }
        Err(priority_error(cx, errno, bun_sys::Tag::uv_os_setpriority))
    }

    pub(crate) fn totalmem() -> u64 {
        #[cfg(target_os = "macos")]
        {
            let mut memory_: [core::ffi::c_ulonglong; 32] = [0; 32];
            if bun_sys::posix::sysctl_read_slice(c"hw.memsize", &mut memory_[..]).is_err() {
                return 0;
            }
            return memory_[0];
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            if let Ok(info) = bun_sys::posix::sysinfo() {
                return (info.totalram as u64)
                    .wrapping_mul(info.mem_unit as core::ffi::c_ulong as u64);
            }
            return 0;
        }
        #[cfg(target_os = "freebsd")]
        {
            let mut physmem: u64 = 0;
            if bun_sys::posix::sysctl_read(c"hw.physmem", &mut physmem).is_err() {
                return 0;
            }
            return physmem;
        }
        #[cfg(windows)]
        {
            return win32::total_memory();
        }
    }

    pub(crate) fn uptime() -> Result<f64, Box<SystemError>> {
        #[cfg(windows)]
        {
            return Ok(win32::uptime_seconds());
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            let mut boot_time: bun_sys::posix::timeval = bun_core::ffi::zeroed();
            if bun_sys::posix::sysctl_read(c"kern.boottime", &mut boot_time).is_err() {
                return Ok(0.0);
            }
            return Ok((bun_sys::time::timestamp() - boot_time.tv_sec as i64) as f64);
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            if let Ok(info) = bun_sys::posix::sysinfo() {
                return Ok(info.uptime as f64);
            }
            return Ok(0.0);
        }
    }

    pub(crate) fn user_info(
        cx: &mut JsScope<'_>,
        options: &crate::generated_bindgen::node_os::UserInfoOptions<'_>,
    ) -> JsResult<JSValue> {
        let _ = options; // TODO:

        let home = homedir(cx)?;
        let global_this = cx.global();
        let result = JSValue::create_empty_object(global_this, 5);

        result.put(global_this, b"homedir", home.into_js(global_this)?);

        #[cfg(windows)]
        {
            result.put(
                global_this,
                b"username",
                bun_string_jsc::create_utf8_for_js(
                    global_this,
                    env_var::USER.get().unwrap_or(b"unknown"),
                )?,
            );
            result.put(global_this, b"uid", JSValue::js_number(-1.0));
            result.put(global_this, b"gid", JSValue::js_number(-1.0));
            result.put(global_this, b"shell", JSValue::NULL);
        }
        #[cfg(not(windows))]
        {
            let username = env_var::USER.get().unwrap_or(b"unknown");

            result.put(
                global_this,
                b"username",
                bun_string_jsc::create_utf8_for_js(global_this, username)?,
            );
            result.put(
                global_this,
                b"shell",
                bun_string_jsc::create_utf8_for_js(
                    global_this,
                    env_var::SHELL.get().unwrap_or(b"unknown"),
                )?,
            );
            // `bun_sys::c::{getuid,getgid}` are declared `safe fn` (no args, never
            // fail) — discharges the per-site proof the raw `libc` re-export needed.
            result.put(global_this, b"uid", JSValue::js_number(c::getuid() as f64));
            result.put(global_this, b"gid", JSValue::js_number(c::getgid() as f64));
        }

        Ok(result)
    }

    pub(crate) fn version() -> JsResult<BunString> {
        #[cfg(not(windows))]
        let mut name_buffer = [0u8; HOST_NAME_MAX];

        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        let slice: &[u8] = 'slice: {
            name_buffer.fill(0);
            if bun_sys::posix::sysctl_read_slice(c"kern.version", &mut name_buffer[..]).is_err() {
                break 'slice b"unknown";
            }
            bun_core::slice_to_nul(&name_buffer)
        };
        #[cfg(any(target_os = "linux", target_os = "android"))]
        let slice: &[u8] = {
            let uts = bun_core::ffi::uname();
            let result = bun_core::ffi::c_field_bytes(&uts.version);
            name_buffer[..result.len()].copy_from_slice(result);
            &name_buffer[0..result.len()]
        };

        #[cfg(not(windows))]
        return Ok(BunString::clone_utf8(slice));
        #[cfg(windows)]
        return Ok(BunString::clone_utf16(&win32::os_version_name()));
    }
} // mod _impl
pub(crate) use _impl::*;

/// Given a netmask returns a CIDR suffix.  Returns null if the mask is not valid.
/// `T` must be one of u32 (IPv4) or u128 (IPv6)
#[cfg(unix)]
fn netmask_to_cidr_suffix<T: NetmaskInt>(mask: T) -> Option<u8> {
    let mask_bits = mask.swap_bytes();

    // Validity check: set bits should be left-contiguous
    let first_zero = (!mask_bits).leading_zeros();
    let last_one = T::BITS - mask_bits.trailing_zeros();
    if first_zero < T::BITS && first_zero < last_one {
        return None;
    }
    Some(u8::try_from(first_zero).expect("int cast"))
}

// Helper trait for netmask_to_cidr_suffix (u32 / u128)
#[cfg(unix)]
trait NetmaskInt: Copy + core::ops::Not<Output = Self> {
    const BITS: u32;
    fn swap_bytes(self) -> Self;
    fn leading_zeros(self) -> u32;
    fn trailing_zeros(self) -> u32;
}
#[cfg(unix)]
impl NetmaskInt for u32 {
    const BITS: u32 = u32::BITS;
    fn swap_bytes(self) -> Self {
        u32::swap_bytes(self)
    }
    fn leading_zeros(self) -> u32 {
        u32::leading_zeros(self)
    }
    fn trailing_zeros(self) -> u32 {
        u32::trailing_zeros(self)
    }
}
#[cfg(unix)]
impl NetmaskInt for u128 {
    const BITS: u32 = u128::BITS;
    fn swap_bytes(self) -> Self {
        u128::swap_bytes(self)
    }
    fn leading_zeros(self) -> u32 {
        u128::leading_zeros(self)
    }
    fn trailing_zeros(self) -> u32 {
        u128::trailing_zeros(self)
    }
}

// ───────────────────────── local helpers ─────────────────────────

#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
fn parse_u64(s: &[u8]) -> crate::Result<u64> {
    bun_core::fmt::parse_int(s, 10).map_err(|_| crate::Error::InvalidCharacter)
}
#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
fn parse_u32(s: &[u8]) -> crate::Result<u32> {
    bun_core::fmt::parse_int(s, 10).map_err(|_| crate::Error::InvalidCharacter)
}

#[cfg(windows)]
#[inline]
fn slice_to_nul_u16(buf: &[u16]) -> &[u16] {
    let nul = bun_core::strings::index_of_scalar(buf, 0).unwrap_or(buf.len());
    &buf[..nul]
}

/// What `node:os` asks Windows for.
#[cfg(windows)]
mod win32 {
    use core::ffi::c_void;
    use core::iter::successors;
    use core::net::{IpAddr, Ipv4Addr, Ipv6Addr};
    use core::ptr::null_mut;

    use bun_core::strings::element_length_utf16_into_utf8;
    use bun_sys::net::{sockaddr_in, sockaddr_in6};
    use bun_sys::windows::kernel32::GetTickCount64;
    use bun_sys::windows::{
        BOOL, CloseHandle, DWORD, GetCurrentProcess, HANDLE, NT_SUCCESS, NTSTATUS, OSVERSIONINFOW,
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, RtlGetVersion, ULONG, Win32Error,
        Win32ErrorExt as _,
    };
    use bun_sys::{E, UV_E};

    use super::{CPUTimes, bun_sysconf__SC_NPROCESSORS_ONLN, slice_to_nul_u16};
    use crate::node::node_util_binding::errno_from_win32_error;

    type HKEY = *mut c_void;
    const HKEY_LOCAL_MACHINE: HKEY = 0x8000_0002_u32 as i32 as isize as HKEY;
    const RRF_RT_REG_SZ: DWORD = 0x02;
    const RRF_RT_REG_DWORD: DWORD = 0x10;

    const SystemProcessorPerformanceInformation: i32 = 8;

    const PROCESS_SET_INFORMATION: DWORD = 0x0200;
    const NORMAL_PRIORITY_CLASS: DWORD = 0x20;
    const IDLE_PRIORITY_CLASS: DWORD = 0x40;
    const HIGH_PRIORITY_CLASS: DWORD = 0x80;
    const REALTIME_PRIORITY_CLASS: DWORD = 0x100;
    const BELOW_NORMAL_PRIORITY_CLASS: DWORD = 0x4000;
    const ABOVE_NORMAL_PRIORITY_CLASS: DWORD = 0x8000;
    /// `os.constants.priority`
    const PRIORITY_LOW: i32 = 19;
    const PRIORITY_BELOW_NORMAL: i32 = 10;
    const PRIORITY_NORMAL: i32 = 0;
    const PRIORITY_ABOVE_NORMAL: i32 = -7;
    const PRIORITY_HIGH: i32 = -14;
    const PRIORITY_HIGHEST: i32 = -20;

    const GAA_FLAG_SKIP_ANYCAST: ULONG = 0x02;
    const GAA_FLAG_SKIP_MULTICAST: ULONG = 0x04;
    const GAA_FLAG_SKIP_DNS_SERVER: ULONG = 0x08;
    const IF_TYPE_SOFTWARE_LOOPBACK: ULONG = 24;
    const IfOperStatusUp: i32 = 1;
    const ERROR_ADDRESS_NOT_ASSOCIATED: Win32Error = Win32Error(1228);

    #[repr(C)]
    #[derive(Clone, Copy, Default)]
    struct SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION {
        IdleTime: i64,
        KernelTime: i64,
        UserTime: i64,
        DpcTime: i64,
        InterruptTime: i64,
        InterruptCount: ULONG,
    }

    #[repr(C)]
    struct MEMORYSTATUSEX {
        dwLength: DWORD,
        dwMemoryLoad: DWORD,
        ullTotalPhys: u64,
        ullAvailPhys: u64,
        ullTotalPageFile: u64,
        ullAvailPageFile: u64,
        ullTotalVirtual: u64,
        ullAvailVirtual: u64,
        ullAvailExtendedVirtual: u64,
    }
    bun_core::impl_zeroable!(MEMORYSTATUSEX);

    #[repr(C)]
    struct SOCKET_ADDRESS {
        lpSockaddr: *const c_void,
        iSockaddrLength: i32,
    }

    #[repr(C)]
    struct IP_ADAPTER_UNICAST_ADDRESS_LH {
        Length: ULONG,
        Flags: DWORD,
        Next: *const IP_ADAPTER_UNICAST_ADDRESS_LH,
        Address: SOCKET_ADDRESS,
        PrefixOrigin: i32,
        SuffixOrigin: i32,
        DadState: i32,
        ValidLifetime: ULONG,
        PreferredLifetime: ULONG,
        LeaseLifetime: ULONG,
        OnLinkPrefixLength: u8,
    }

    /// Only the leading fields: the ones after `OperStatus` are not read.
    #[repr(C)]
    struct IP_ADAPTER_ADDRESSES_LH {
        Length: ULONG,
        IfIndex: DWORD,
        Next: *const IP_ADAPTER_ADDRESSES_LH,
        AdapterName: *const u8,
        FirstUnicastAddress: *const IP_ADAPTER_UNICAST_ADDRESS_LH,
        FirstAnycastAddress: *const c_void,
        FirstMulticastAddress: *const c_void,
        FirstDnsServerAddress: *const c_void,
        DnsSuffix: *const u16,
        Description: *const u16,
        FriendlyName: *const u16,
        PhysicalAddress: [u8; 8],
        PhysicalAddressLength: ULONG,
        Flags: ULONG,
        Mtu: ULONG,
        IfType: ULONG,
        OperStatus: i32,
    }

    unsafe extern "system" {
        fn GetPriorityClass(hProcess: HANDLE) -> DWORD;
        fn SetPriorityClass(hProcess: HANDLE, dwPriorityClass: DWORD) -> BOOL;
        safe fn GlobalMemoryStatusEx(lpBuffer: &mut MEMORYSTATUSEX) -> BOOL;
    }

    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn NtQuerySystemInformation(
            SystemInformationClass: i32,
            SystemInformation: *mut c_void,
            SystemInformationLength: ULONG,
            ReturnLength: *mut ULONG,
        ) -> NTSTATUS;
    }

    #[link(name = "advapi32")]
    unsafe extern "system" {
        fn RegGetValueW(
            hkey: HKEY,
            lpSubKey: *const u16,
            lpValue: *const u16,
            dwFlags: DWORD,
            pdwType: *mut DWORD,
            pvData: *mut c_void,
            pcbData: *mut DWORD,
        ) -> i32;
    }

    #[link(name = "userenv")]
    unsafe extern "system" {
        fn GetUserProfileDirectoryW(
            hToken: HANDLE,
            lpProfileDir: *mut u16,
            lpcchSize: *mut DWORD,
        ) -> BOOL;
    }

    #[link(name = "iphlpapi")]
    unsafe extern "system" {
        fn GetAdaptersAddresses(
            Family: ULONG,
            Flags: ULONG,
            Reserved: *mut c_void,
            AdapterAddresses: *mut IP_ADAPTER_ADDRESSES_LH,
            SizePointer: *mut ULONG,
        ) -> ULONG;
    }

    /// A value under `HKEY_LOCAL_MACHINE`. `key` and `name` end with a NUL.
    ///
    /// # Safety
    /// `data` is writable for `size` bytes.
    unsafe fn read_registry(
        key: &[u16],
        name: &[u16],
        kind: DWORD,
        data: *mut c_void,
        mut size: DWORD,
    ) -> Result<(), Win32Error> {
        debug_assert!(key.last() == Some(&0) && name.last() == Some(&0));
        // SAFETY: both strings are NUL-terminated, and the caller vouches for `data`.
        let status = unsafe {
            RegGetValueW(
                HKEY_LOCAL_MACHINE,
                key.as_ptr(),
                name.as_ptr(),
                kind,
                null_mut(),
                data,
                &raw mut size,
            )
        };
        match status {
            0 => Ok(()),
            _ => Err(Win32Error::from_u32(status as u32)),
        }
    }

    fn registry_string(key: &[u16], name: &[u16]) -> Result<Vec<u16>, Win32Error> {
        let mut value = [0u16; 256];
        // SAFETY: the size is the size of `value`.
        unsafe {
            read_registry(
                key,
                name,
                RRF_RT_REG_SZ,
                value.as_mut_ptr().cast(),
                size_of_val(&value) as DWORD,
            )?;
        }
        Ok(slice_to_nul_u16(&value).to_vec())
    }

    fn registry_dword(key: &[u16], name: &[u16]) -> Result<u32, Win32Error> {
        let mut value: u32 = 0;
        // SAFETY: the size is the size of `value`.
        unsafe {
            read_registry(
                key,
                name,
                RRF_RT_REG_DWORD,
                (&raw mut value).cast(),
                size_of_val(&value) as DWORD,
            )?;
        }
        Ok(value)
    }

    pub(super) struct Cpu {
        pub model: Vec<u16>,
        /// In MHz.
        pub speed: u32,
        /// In milliseconds.
        pub times: CPUTimes,
    }

    /// The logical processors of this process's processor group, like Node.
    pub(super) fn cpus() -> Result<Vec<Cpu>, Win32Error> {
        let count = usize::try_from(bun_sysconf__SC_NPROCESSORS_ONLN()).unwrap_or(0);
        let mut performance = vec![SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION::default(); count];
        // SAFETY: the length is the size of `performance`.
        let status = unsafe {
            NtQuerySystemInformation(
                SystemProcessorPerformanceInformation,
                performance.as_mut_ptr().cast(),
                size_of_val(performance.as_slice()) as ULONG,
                null_mut(),
            )
        };
        if !NT_SUCCESS(status) {
            return Err(Win32Error::from_ntstatus(status));
        }

        // The times count 100 ns units, and the kernel time includes the idle time.
        let milliseconds = |time: i64| (time / 10_000) as u64;
        performance
            .iter()
            .enumerate()
            .map(|(index, times)| {
                let key: Vec<u16> =
                    format!("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\{index}\0")
                        .encode_utf16()
                        .collect();
                Ok(Cpu {
                    model: registry_string(&key, bun_core::w!("ProcessorNameString\0"))?,
                    speed: registry_dword(&key, bun_core::w!("~MHz\0"))?,
                    times: CPUTimes {
                        user: milliseconds(times.UserTime),
                        nice: 0,
                        sys: milliseconds(times.KernelTime - times.IdleTime),
                        idle: milliseconds(times.IdleTime),
                        irq: milliseconds(times.InterruptTime),
                    },
                })
            })
            .collect()
    }

    /// The profile directory of the user this process runs as.
    fn profile_directory() -> Result<Vec<u16>, Win32Error> {
        /// `GetCurrentProcessToken()`
        const CURRENT_PROCESS_TOKEN: HANDLE = -4_isize as HANDLE;

        let mut path = vec![0u16; 260];
        loop {
            let mut length = path.len() as DWORD;
            // SAFETY: `length` is the length of `path`.
            if unsafe {
                GetUserProfileDirectoryW(CURRENT_PROCESS_TOKEN, path.as_mut_ptr(), &raw mut length)
            } != 0
            {
                path.truncate(slice_to_nul_u16(&path).len());
                return Ok(path);
            }
            match Win32Error::get() {
                Win32Error::INSUFFICIENT_BUFFER if length as usize > path.len() => {
                    path.resize(length as usize, 0);
                }
                error => return Err(error),
            }
        }
    }

    pub(super) fn home_directory() -> bun_sys::Result<Vec<u16>> {
        use bun_sys::{Error, Tag};
        match bun_sys::windows::getenv_w(bun_core::w!("USERPROFILE\0")) {
            // Node refuses a value that takes less than 3 bytes in UTF-8.
            Some(path) if element_length_utf16_into_utf8(&path) < 3 => {
                Err(Error::from_code(E::ENOENT, Tag::uv_os_homedir))
            }
            Some(path) => Ok(path),
            None => {
                profile_directory().map_err(|error| Error::from_win32(error, Tag::uv_os_homedir))
            }
        }
    }

    pub(super) fn os_version() -> OSVERSIONINFOW {
        let mut info: OSVERSIONINFOW = bun_core::ffi::zeroed();
        info.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as ULONG;
        // SAFETY: the size is the size of `info`.
        let _ = unsafe { RtlGetVersion(&raw mut info) };
        info
    }

    /// The product name from the registry if it can be read, then the service pack.
    pub(super) fn os_version_name() -> Vec<u16> {
        let info = os_version();
        let mut name = Vec::new();
        if let Ok(product) = registry_string(
            bun_core::w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\0"),
            bun_core::w!("ProductName\0"),
        ) {
            name = product;
            // Windows 11 kept the product name of Windows 10.
            if info.dwMajorVersion == 10
                && info.dwBuildNumber >= 22000
                && name.starts_with(bun_core::w!("Windows 10"))
            {
                name[9] = u16::from(b'1');
            }
        }
        let service_pack = slice_to_nul_u16(&info.szCSDVersion);
        if !service_pack.is_empty() {
            if !name.is_empty() {
                name.push(u16::from(b' '));
            }
            name.extend_from_slice(service_pack);
        }
        name
    }

    pub(super) fn total_memory() -> u64 {
        let mut status: MEMORYSTATUSEX = bun_core::ffi::zeroed();
        status.dwLength = size_of::<MEMORYSTATUSEX>() as DWORD;
        if GlobalMemoryStatusEx(&mut status) == 0 {
            return 0;
        }
        status.ullTotalPhys
    }

    pub(super) fn uptime_seconds() -> f64 {
        GetTickCount64() as f64 / 1000.0
    }

    struct Process(HANDLE);

    impl Process {
        /// 0 is this process.
        fn open(pid: i32, access: DWORD) -> Result<Self, E> {
            if pid == 0 {
                return Ok(Self(GetCurrentProcess()));
            }
            // SAFETY: every argument is passed by value.
            let handle = unsafe { OpenProcess(access, 0, pid as DWORD) };
            if handle.is_null() {
                return Err(match Win32Error::get() {
                    Win32Error::INVALID_PARAMETER => E::ESRCH,
                    error => error.to_system_errno(),
                });
            }
            Ok(Self(handle))
        }
    }

    impl Drop for Process {
        fn drop(&mut self) {
            // SAFETY: the handle is open, or the one of this process, which closing leaves alone.
            let _ = unsafe { CloseHandle(self.0) };
        }
    }

    /// The priority class of a process as the `nice` value Node reports for it.
    pub(super) fn priority(pid: i32) -> Result<i32, E> {
        let process = Process::open(pid, PROCESS_QUERY_LIMITED_INFORMATION)?;
        // SAFETY: the handle is open.
        Ok(match unsafe { GetPriorityClass(process.0) } {
            0 => return Err(Win32Error::get().to_system_errno()),
            REALTIME_PRIORITY_CLASS => PRIORITY_HIGHEST,
            HIGH_PRIORITY_CLASS => PRIORITY_HIGH,
            ABOVE_NORMAL_PRIORITY_CLASS => PRIORITY_ABOVE_NORMAL,
            NORMAL_PRIORITY_CLASS => PRIORITY_NORMAL,
            BELOW_NORMAL_PRIORITY_CLASS => PRIORITY_BELOW_NORMAL,
            _ => PRIORITY_LOW,
        })
    }

    /// Gives a process the priority class Node picks for a `nice` value.
    pub(super) fn set_priority(pid: i32, priority: i32) -> Result<(), E> {
        let class = match priority {
            PRIORITY_HIGHEST..PRIORITY_HIGH => REALTIME_PRIORITY_CLASS,
            PRIORITY_HIGH..PRIORITY_ABOVE_NORMAL => HIGH_PRIORITY_CLASS,
            PRIORITY_ABOVE_NORMAL..PRIORITY_NORMAL => ABOVE_NORMAL_PRIORITY_CLASS,
            PRIORITY_NORMAL..PRIORITY_BELOW_NORMAL => NORMAL_PRIORITY_CLASS,
            PRIORITY_BELOW_NORMAL..PRIORITY_LOW => BELOW_NORMAL_PRIORITY_CLASS,
            PRIORITY_LOW => IDLE_PRIORITY_CLASS,
            _ => return Err(E::EINVAL),
        };
        let process = Process::open(pid, PROCESS_SET_INFORMATION)?;
        // SAFETY: the handle is open.
        if unsafe { SetPriorityClass(process.0, class) } == 0 {
            return Err(Win32Error::get().to_system_errno());
        }
        Ok(())
    }

    /// The list `GetAdaptersAddresses` wrote, which points into itself.
    pub(super) struct Adapters(Vec<u64>);

    /// One address of an adapter that is up.
    pub(super) struct InterfaceAddress<'a> {
        pub name: &'a [u16],
        pub mac: [u8; 6],
        pub internal: bool,
        pub address: IpAddr,
        pub prefix_length: u8,
        /// 0 for IPv4.
        pub scope_id: u32,
    }

    impl Adapters {
        /// The error is the `errno` Node throws.
        pub(super) fn get() -> Result<Self, i32> {
            // Microsoft recommends starting with 15 KB.
            let mut size: ULONG = 15 * 1024;
            loop {
                let capacity = size;
                let mut list = vec![0u64; (capacity as usize).div_ceil(size_of::<u64>())];
                // SAFETY: `list` is aligned for the structure and at least `size` bytes long.
                let error = Win32Error::from_u32(unsafe {
                    GetAdaptersAddresses(
                        0, // AF_UNSPEC
                        GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER,
                        null_mut(),
                        list.as_mut_ptr().cast(),
                        &raw mut size,
                    )
                });
                match error {
                    Win32Error::SUCCESS => return Ok(Self(list)),
                    Win32Error::NO_DATA => return Ok(Self(Vec::new())),
                    // `size` is now what the list needs, which can grow between two calls.
                    Win32Error::BUFFER_OVERFLOW if size > capacity => {}
                    ERROR_ADDRESS_NOT_ASSOCIATED => return Err(-UV_E::AGAIN),
                    Win32Error::INVALID_PARAMETER => return Err(-UV_E::NOBUFS),
                    _ => return Err(errno_from_win32_error(error.0.into())),
                }
            }
        }

        pub(super) fn addresses(&self) -> impl Iterator<Item = InterfaceAddress<'_>> {
            // SAFETY: a list that is not empty starts with the first adapter. Every pointer in it is
            // null or points to a structure in `self.0`.
            let first = (!self.0.is_empty())
                .then(|| unsafe { &*self.0.as_ptr().cast::<IP_ADAPTER_ADDRESSES_LH>() });
            // SAFETY: as above.
            successors(first, |adapter| unsafe { adapter.Next.as_ref() })
                .filter(|adapter| adapter.OperStatus == IfOperStatusUp)
                .flat_map(|adapter| {
                    // SAFETY: as above.
                    let first = unsafe { adapter.FirstUnicastAddress.as_ref() };
                    // SAFETY: as above.
                    successors(first, |unicast| unsafe { unicast.Next.as_ref() })
                        .map(move |unicast| InterfaceAddress::new(adapter, unicast))
                })
        }
    }

    impl<'a> InterfaceAddress<'a> {
        fn new(
            adapter: &'a IP_ADAPTER_ADDRESSES_LH,
            unicast: &IP_ADAPTER_UNICAST_ADDRESS_LH,
        ) -> Self {
            let sockaddr = unicast.Address.lpSockaddr;
            // SAFETY: a unicast address is a `sockaddr_in` or a `sockaddr_in6`, and both start with
            // the family.
            let (address, scope_id) = unsafe {
                if i32::from((*sockaddr.cast::<sockaddr_in>()).family) == bun_sys::posix::AF::INET6
                {
                    let in6 = &*sockaddr.cast::<sockaddr_in6>();
                    (IpAddr::V6(Ipv6Addr::from(in6.addr)), in6.scope_id)
                } else {
                    let in4 = &*sockaddr.cast::<sockaddr_in>();
                    (IpAddr::V4(Ipv4Addr::from(in4.addr.to_ne_bytes())), 0)
                }
            };
            let mut mac = [0u8; 6];
            if adapter.PhysicalAddressLength as usize == mac.len() {
                mac.copy_from_slice(&adapter.PhysicalAddress[..6]);
            }
            Self {
                // SAFETY: NUL-terminated, in the list `adapter` is borrowed from.
                name: unsafe { bun_core::ffi::wstr_units(adapter.FriendlyName) },
                mac,
                internal: adapter.IfType == IF_TYPE_SOFTWARE_LOOPBACK,
                address,
                prefix_length: unicast.OnLinkPrefixLength,
                scope_id,
            }
        }

        pub(super) fn netmask(&self) -> IpAddr {
            let prefix = u32::from(self.prefix_length);
            match self.address {
                IpAddr::V4(_) => {
                    Ipv4Addr::from_bits(!u32::MAX.checked_shr(prefix).unwrap_or(0)).into()
                }
                IpAddr::V6(_) => {
                    Ipv6Addr::from_bits(!u128::MAX.checked_shr(prefix).unwrap_or(0)).into()
                }
            }
        }
    }
}
