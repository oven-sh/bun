use core::ffi::c_int;
#[cfg(not(windows))]
use core::ffi::c_uint;

use bun_core;
use bun_core::String as BunString;
use bun_jsc::bun_string_jsc;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};

// c-bindings.cpp / OsBinding.cpp
unsafe extern "C" {
    safe fn bun_sysconf__SC_NPROCESSORS_ONLN() -> i32;
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    safe fn bun_sysconf__SC_CLK_TCK() -> isize;
    safe fn Bun__Os__getFreeMemory() -> u64;
    safe fn get_process_priority(pid: i32) -> i32;
    safe fn set_process_priority(pid: i32, priority: i32) -> i32;
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
    Bun__Os__getFreeMemory()
}

mod _impl {
    use super::*;
    use bun_core::EncodedSlice;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    use bun_core::ZStr;
    #[cfg(not(windows))]
    use bun_core::strings;
    use bun_core::{env_var, fmt as bun_fmt};
    use bun_jsc::{CallFrame, JSArray, StringJsc as _, SysErrorJsc as _, SystemError};
    #[cfg(windows)]
    use bun_paths::PathBuffer;
    #[cfg(windows)]
    use bun_sys::ReturnCodeExt as _;
    #[cfg(not(windows))]
    use bun_sys::c;
    #[cfg(windows)]
    use bun_sys::windows::libuv;
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

    // Generated bindings (emitted from `node_os.bind.ts` via
    // `src/codegen/bindgen.ts`). The C++ side
    // (`GeneratedBindings.cpp`) defines the SYSV-ABI `bindgen_Node_os_js*` host
    // functions, which validate/decode arguments and call back into the
    // `bindgen_Node_os_dispatch*` entry points. This module provides the
    // public surface: `js*` extern pointers + `create*Callback` wrappers
    // + the `UserInfoOptions` dictionary.
    pub mod gen_ {
        use super::{BunString, CallFrame, EncodedSlice, JSGlobalObject, JSValue};
        use bun_jsc::host_fn;

        // C++-side host fns (GeneratedBindings.cpp). `bindgen.ts` emits these as
        // `extern "C" SYSV_ABI` (the `JSHostFunctionType` shape) — `jsc.conv` is
        // the System V ABI on Windows-x64 and the C ABI everywhere else, matching
        // `bun_jsc::host_fn::JsHostFn`.
        bun_jsc::jsc_abi_extern! {
            fn bindgen_Node_os_jsCpus(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsFreemem(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsGetPriority(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsHomedir(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsHostname(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsLoadavg(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsNetworkInterfaces(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsRelease(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsTotalmem(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsUptime(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsUserInfo(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsVersion(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
            fn bindgen_Node_os_jsSetPriority(g: *mut JSGlobalObject, c: *mut CallFrame) -> JSValue;
        }

        // Each `create*Callback` is identical modulo (display name, min arg
        // count, host-fn symbol) — see `bindgen.ts:1538`. Generate them with
        // the exact triples the codegen would have produced.
        macro_rules! create_callback {
        ($($fn_name:ident, $js_name:literal, $argc:literal, $sym:ident;)*) => {$(
            pub fn $fn_name(global: &JSGlobalObject) -> JSValue {
                host_fn::new_runtime_function(
                    global,
                    Some(&EncodedSlice::latin1($js_name.as_bytes())),
                    $argc,
                    $sym,
                    false,
                    None,
                )
            }
        )*};
    }
        create_callback! {
            create_cpus_callback,               "cpus",              1, bindgen_Node_os_jsCpus;
            create_freemem_callback,            "freemem",           0, bindgen_Node_os_jsFreemem;
            create_get_priority_callback,       "getPriority",       2, bindgen_Node_os_jsGetPriority;
            create_homedir_callback,            "homedir",           1, bindgen_Node_os_jsHomedir;
            create_hostname_callback,           "hostname",          1, bindgen_Node_os_jsHostname;
            create_loadavg_callback,            "loadavg",           1, bindgen_Node_os_jsLoadavg;
            create_network_interfaces_callback, "networkInterfaces", 1, bindgen_Node_os_jsNetworkInterfaces;
            create_release_callback,            "release",           0, bindgen_Node_os_jsRelease;
            create_totalmem_callback,           "totalmem",          0, bindgen_Node_os_jsTotalmem;
            create_uptime_callback,             "uptime",            1, bindgen_Node_os_jsUptime;
            create_user_info_callback,          "userInfo",          2, bindgen_Node_os_jsUserInfo;
            create_version_callback,            "version",           0, bindgen_Node_os_jsVersion;
            create_set_priority_callback,       "setPriority",       2, bindgen_Node_os_jsSetPriority;
        }

        /// `t.dictionary({ encoding: t.DOMString.default("") })` from
        /// `node_os.bind.ts`. Mirrors the extern struct emitted by bindgen;
        /// the C++ side passes a pointer to this layout, so it must stay
        /// `#[repr(C)]`.
        #[repr(C)]
        pub struct UserInfoOptions {
            pub(crate) encoding: BunString,
        }
    }

    pub(crate) fn create_node_os_binding(global: &JSGlobalObject) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, 14);
        obj.put(
            global,
            b"hostCpuCount",
            JSValue::js_number(1i32.max(bun_sysconf__SC_NPROCESSORS_ONLN()) as f64),
        );
        obj.put(global, b"cpus", gen_::create_cpus_callback(global));
        obj.put(global, b"freemem", gen_::create_freemem_callback(global));
        obj.put(
            global,
            b"getPriority",
            gen_::create_get_priority_callback(global),
        );
        obj.put(global, b"homedir", gen_::create_homedir_callback(global));
        obj.put(global, b"hostname", gen_::create_hostname_callback(global));
        obj.put(global, b"loadavg", gen_::create_loadavg_callback(global));
        obj.put(
            global,
            b"networkInterfaces",
            gen_::create_network_interfaces_callback(global),
        );
        obj.put(global, b"release", gen_::create_release_callback(global));
        obj.put(global, b"totalmem", gen_::create_totalmem_callback(global));
        obj.put(global, b"uptime", gen_::create_uptime_callback(global));
        obj.put(global, b"userInfo", gen_::create_user_info_callback(global));
        obj.put(global, b"version", gen_::create_version_callback(global));
        obj.put(
            global,
            b"setPriority",
            gen_::create_set_priority_callback(global),
        );
        Ok(obj)
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

    pub(crate) fn cpus(global: &JSGlobalObject) -> JsResult<JSValue> {
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

    #[cfg(target_os = "macos")]
    fn cpus_impl_darwin(global_this: &JSGlobalObject) -> Result<JSValue, OsError> {
        // Fetch the CPU info structure
        let info = bun_sys::os::ProcessorCpuLoadInfo::get().ok_or(OsError::Any)?;
        let info_slice = info.as_slice();
        let num_cpus = u32::try_from(info_slice.len()).expect("int cast");

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
        let cpu_infos = bun_sys::os::CpuInfoList::get().map_err(|_| OsError::Any)?;

        let values = JSValue::create_empty_array(global_this, cpu_infos.iter().count())?;

        for (i, cpu_info) in cpu_infos.iter().enumerate() {
            let t = cpu_info.times();
            let times = CPUTimes {
                user: t.user,
                nice: t.nice,
                sys: t.sys,
                idle: t.idle,
                irq: t.irq,
            };

            let cpu = JSValue::create_empty_object(global_this, 3);
            cpu.put(
                global_this,
                b"model",
                bun_string_jsc::create_utf8_for_js(global_this, cpu_info.model())?,
            );
            cpu.put(
                global_this,
                b"speed",
                JSValue::js_number(cpu_info.speed() as f64),
            );
            cpu.put(global_this, b"times", times.to_value(global_this));

            values.put_index(global_this, u32::try_from(i).expect("int cast"), cpu)?;
        }

        Ok(values)
    }

    pub(crate) fn get_priority(global: &JSGlobalObject, pid: i32) -> JsResult<i32> {
        let result = get_process_priority(pid);
        if result == i32::MAX {
            let err = SystemError {
                message: BunString::static_("no such process"),
                code: BunString::static_("ESRCH"),
                #[cfg(not(windows))]
                errno: -(bun_sys::posix::E::ESRCH as c_int),
                #[cfg(windows)]
                errno: libuv::UV_ESRCH,
                syscall: BunString::static_("uv_os_getpriority"),
                ..Default::default()
            };
            return Err(global.throw_value(err.to_error_instance_with_info_object(global)));
        }
        Ok(result)
    }

    pub(crate) fn homedir(global: &JSGlobalObject) -> JsResult<BunString> {
        // In Node.js, this is a wrapper around uv_os_homedir.
        #[cfg(windows)]
        {
            let mut out = PathBuffer::uninit();
            return match bun_sys::os::homedir(&mut out[..]) {
                Ok(size) => Ok(BunString::clone_utf8(&out[0..size])),
                Err(rc) => {
                    let err = rc.to_error(bun_sys::Tag::uv_os_homedir).expect("nonzero");
                    Err(global.throw_value(err.to_js(global)))
                }
            };
        }
        #[cfg(not(windows))]
        {
            // The posix implementation of uv_os_homedir first checks the HOME
            // environment variable, then falls back to reading the passwd entry.
            if let Some(home) = env_var::HOME.get() {
                if !home.is_empty() {
                    return Ok(BunString::from_bytes(home));
                }
            }

            return match bun_sys::os::passwd_home_dir() {
                Err(errno) => Err(global.throw_value(
                    bun_sys::Error::from_code(
                        // `errno` is a libc errno; a code outside the table is `EUNKNOWN`.
                        bun_sys::E::from_raw(errno as u16),
                        bun_sys::Tag::uv_os_homedir,
                    )
                    .to_js(global),
                )),
                Ok(None) => {
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
                Ok(Some(dir)) if dir.is_empty() => Ok(BunString::EMPTY),
                Ok(Some(dir)) => Ok(BunString::clone_utf8(&dir)),
            };
        }
    }

    pub(crate) fn hostname(global: &JSGlobalObject) -> JsResult<JSValue> {
        #[cfg(windows)]
        {
            let mut name_buffer: [u16; 130] = [0; 130]; // [129:0]u16 → 130 u16s with NUL at [129]
            if let Some(name) = bun_sys::os::hostname_w(&mut name_buffer) {
                return BunString::clone_utf16(name).into_js(global);
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

    pub(crate) fn loadavg(global: &JSGlobalObject) -> JsResult<JSValue> {
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
        let result: [f64; 3] = bun_sys::os::loadavg().unwrap_or([0.0, 0.0, 0.0]);
        #[cfg(windows)]
        let result: [f64; 3] = [0.0, 0.0, 0.0];

        JSArray::create(
            global,
            &[
                JSValue::js_number(result[0]),
                JSValue::js_number(result[1]),
                JSValue::js_number(result[2]),
            ],
        )
    }

    #[cfg(unix)]
    pub use network_interfaces_posix as network_interfaces;
    #[cfg(windows)]
    pub use network_interfaces_windows as network_interfaces;

    #[cfg(unix)]
    pub fn network_interfaces_posix(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        use bun_sys::os::{InterfaceAddress, InterfaceAddresses};

        let interfaces = match InterfaceAddresses::get() {
            Ok(list) => list,
            Err(errno) => {
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
        };

        // We'll skip interfaces that aren't actually available
        fn skip(iface: InterfaceAddress<'_>) -> bool {
            // Skip interfaces that aren't actually available
            if iface.flags() & libc::IFF_RUNNING as c_uint == 0 {
                return true;
            }
            if iface.flags() & libc::IFF_UP as c_uint == 0 {
                return true;
            }
            if iface.family().is_none() {
                return true;
            }
            false
        }

        // We won't actually return link-layer interfaces but we need them for
        //  extracting the MAC address
        fn is_link_layer(iface: InterfaceAddress<'_>) -> bool {
            #[cfg(any(target_os = "linux", target_os = "android"))]
            return iface.family() == Some(libc::AF_PACKET);
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            return iface.family() == Some(libc::AF_LINK);
        }

        fn is_loopback(iface: InterfaceAddress<'_>) -> bool {
            iface.flags() & libc::IFF_LOOPBACK as c_uint == libc::IFF_LOOPBACK as c_uint
        }

        let ret = JSValue::create_empty_object(global_this, 0);

        // The list contains entries for link-layer interfaces and the IPv4,
        //  IPv6 interfaces.  We only return the latter two but need the
        //  link-layer entries to determine MAC address.
        for iface in interfaces.iter() {
            if skip(iface) || is_link_layer(iface) {
                continue;
            }

            let interface_name = iface.name();
            let addr = iface.address().expect("skip() checked ifa_addr");
            // getifaddrs(3) leaves ifa_netmask null when the entry has none;
            // libuv reads that as an all-zero mask.
            let netmask = iface.netmask().unwrap_or_else(|| {
                let zero: core::net::IpAddr = if addr.family() == libc::AF_INET6 {
                    core::net::Ipv6Addr::UNSPECIFIED.into()
                } else {
                    core::net::Ipv4Addr::UNSPECIFIED.into()
                };
                bun_sys::net::Address::from_ip(zero, 0)
            });

            let interface = JSValue::create_empty_object(global_this, 0);

            // address <string> The assigned IPv4 or IPv6 address
            // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
            {
                // Compute the CIDR suffix; returns null if the netmask cannot
                //  be converted to a CIDR suffix
                let maybe_suffix: Option<u8> = match addr.family() as c_int {
                    libc::AF_INET => netmask
                        .as_in4()
                        .and_then(|m| netmask_to_cidr_suffix(m.sin_addr.s_addr)),
                    libc::AF_INET6 => netmask.as_in6().and_then(|m| {
                        netmask_to_cidr_suffix(u128::from_ne_bytes(m.sin6_addr.s6_addr))
                    }),
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
                // The link-layer entry for this interface; a Linux alias
                // (`eth0:1`) takes its base interface's (`eth0`), as in libuv.
                let maybe_ll_addr: Option<&[u8]> = interfaces
                    .iter()
                    .filter(|&ll_iface| !skip(ll_iface))
                    .filter(|ll_iface| {
                        let ll_name = ll_iface.name();
                        strings::has_prefix(interface_name, ll_name)
                            && (interface_name.len() == ll_name.len()
                                || interface_name[ll_name.len()] == b':')
                    })
                    .find_map(InterfaceAddress::link_layer_address);

                if let Some(addr_data) = maybe_ll_addr {
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
            if let Some(in6) = addr.as_in6() {
                interface.put(
                    global_this,
                    b"scopeid",
                    JSValue::js_number(in6.sin6_scope_id as f64),
                );
            }

            // Does this entry already exist?
            if let Some(array) = ret.get(global_this, interface_name)? {
                // Add this interface entry to the existing array
                let next_index: u32 =
                    u32::try_from(array.get_length(global_this)?).expect("int cast");
                array.put_index(global_this, next_index, interface)?;
            } else {
                // Add it as an array with this interface as an element
                let array = JSValue::create_empty_array(global_this, 1)?;
                array.put_index(global_this, 0, interface)?;
                ret.put(global_this, interface_name, array);
            }
        }

        Ok(ret)
    }

    #[cfg(windows)]
    pub fn network_interfaces_windows(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let ifaces = match bun_sys::os::InterfaceAddresses::get() {
            Ok(list) => list,
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

        for iface in ifaces.iter() {
            let interface = JSValue::create_empty_object(global_this, 7);
            let addr = iface.address();
            let netmask = iface.netmask();

            // address <string> The assigned IPv4 or IPv6 address
            // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
            let mut cidr = JSValue::NULL;
            let family = addr.family() as c_int;
            {
                // Compute the CIDR suffix; returns null if the netmask cannot
                //  be converted to a CIDR suffix
                let maybe_suffix: Option<u8> = match family {
                    bun_sys::posix::AF::INET => netmask
                        .as_in4()
                        .and_then(|m| netmask_to_cidr_suffix(m.sin_addr.s_addr)),
                    bun_sys::posix::AF::INET6 => netmask.as_in6().and_then(|m| {
                        netmask_to_cidr_suffix(u128::from_ne_bytes(m.sin6_addr.s6_addr))
                    }),
                    _ => None,
                };

                // Format the address and then, if valid, the CIDR suffix; both
                //  the address and cidr values can be slices into this same buffer
                // e.g. addr_str = "192.168.88.254", cidr_str = "192.168.88.254/24"
                let addr_str = bun_fmt::format_ip(&addr, &mut ip_buf).expect("unreachable");
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
                    cidr = bun_string_jsc::create_utf8_for_js(global_this, cidr_str)?;
                }

                interface.put(
                    global_this,
                    b"address",
                    bun_string_jsc::create_utf8_for_js(
                        global_this,
                        &ip_buf[start..start + addr_len],
                    )?,
                );
            }

            // netmask
            {
                let str = bun_fmt::format_ip(&netmask, &mut ip_buf).expect("unreachable");
                interface.put(
                    global_this,
                    b"netmask",
                    bun_string_jsc::create_utf8_for_js(global_this, str)?,
                );
            }
            // family
            interface.put(
                global_this,
                b"family",
                match family {
                    bun_sys::posix::AF::INET => global_this.common_strings().ipv4(),
                    bun_sys::posix::AF::INET6 => global_this.common_strings().ipv6(),
                    _ => global_this.common_strings().unknown(),
                },
            );

            // mac
            {
                let mac_buf = bun_fmt::mac_address_lower(iface.phys_addr());
                interface.put(
                    global_this,
                    b"mac",
                    bun_string_jsc::create_utf8_for_js(global_this, &mac_buf)?,
                );
            }

            // internal
            {
                interface.put(global_this, b"internal", JSValue::from(iface.is_internal()));
            }

            // cidr. this is here to keep ordering consistent with the node implementation
            interface.put(global_this, b"cidr", cidr);

            // scopeid
            if let Some(in6) = addr.as_in6() {
                interface.put(
                    global_this,
                    b"scopeid",
                    JSValue::js_number(in6.sin6_scope_id as f64),
                );
            }

            // Does this entry already exist?
            let interface_name = iface.name();
            if let Some(array) = ret.get(global_this, interface_name)? {
                // Add this interface entry to the existing array
                let next_index: u32 =
                    u32::try_from(array.get_length(global_this)?).expect("int cast");
                array.put_index(global_this, next_index, interface)?;
            } else {
                // Add it as an array with this interface as an element
                let array = JSValue::create_empty_array(global_this, 1)?;
                array.put_index(global_this, 0, interface)?;
                ret.put(global_this, interface_name, array);
            }
        }

        Ok(ret)
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
        let value: &[u8] = 'slice: {
            let Ok(info) = bun_sys::os::uname() else {
                break 'slice b"unknown";
            };
            let value = bun_core::slice_to_nul(&info.release);
            name_buffer[0..value.len()].copy_from_slice(value);
            &name_buffer[0..value.len()]
        };

        BunString::clone_utf8(value)
    }

    fn set_process_priority_impl(pid: i32, priority: i32) -> bun_sys::E {
        if pid < 0 {
            return bun_sys::E::ESRCH;
        }

        let code: i32 = set_process_priority(pid, priority);
        if code == 0 {
            return bun_sys::E::SUCCESS;
        }
        // POSIX `setpriority` returns -1 and sets errno; Windows returns a libuv code.
        #[cfg(windows)]
        return bun_sys::windows::translate_uv_error_to_e(code);
        #[cfg(not(windows))]
        return bun_sys::get_errno(code);
    }

    pub(crate) fn set_priority1(global: &JSGlobalObject, pid: i32, priority: i32) -> JsResult<()> {
        let errno = set_process_priority_impl(pid, priority);
        if errno == bun_sys::E::SUCCESS {
            return Ok(());
        }
        let err = bun_sys::Error::from_code(errno, bun_sys::Tag::uv_os_setpriority);
        let mut sys_err: SystemError = err.to_system_error().into();
        // Node's message here is the bare libuv label, not "ESRCH: …, uv_os_setpriority".
        sys_err.message =
            BunString::static_(err.uv_code_label().map_or("unknown error", |(_, l)| l));
        Err(global.throw_value(sys_err.to_error_instance_with_info_object(global)))
    }

    pub(crate) fn set_priority2(global: &JSGlobalObject, priority: i32) -> JsResult<()> {
        set_priority1(global, 0, priority)
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
            return bun_sys::os::total_memory();
        }
    }

    pub(crate) fn uptime(global: &JSGlobalObject) -> JsResult<f64> {
        #[cfg(windows)]
        {
            return match bun_sys::os::uptime() {
                Ok(uptime_value) => Ok(uptime_value),
                Err(err) => {
                    let sys_err = SystemError {
                        message: BunString::static_("failed to get system uptime"),
                        code: BunString::static_("ERR_SYSTEM_ERROR"),
                        errno: err,
                        syscall: BunString::static_("uv_uptime"),
                        ..Default::default()
                    };
                    Err(global.throw_value(sys_err.to_error_instance(global)))
                }
            };
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            let _ = global;
            let mut boot_time: bun_sys::posix::timeval = bun_core::ffi::zeroed();
            if bun_sys::posix::sysctl_read(c"kern.boottime", &mut boot_time).is_err() {
                return Ok(0.0);
            }
            return Ok((bun_sys::time::timestamp() - boot_time.tv_sec as i64) as f64);
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let _ = global;
            if let Ok(info) = bun_sys::posix::sysinfo() {
                return Ok(info.uptime as f64);
            }
            return Ok(0.0);
        }
    }

    pub(crate) fn user_info(
        global_this: &JSGlobalObject,
        options: &gen_::UserInfoOptions,
    ) -> JsResult<JSValue> {
        let _ = options; // TODO:

        let result = JSValue::create_empty_object(global_this, 5);

        let home = homedir(global_this)?;

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
        #[cfg(windows)]
        let slice: &[u8] = 'slice: {
            let Ok(info) = bun_sys::os::uname() else {
                break 'slice b"unknown";
            };
            let s = bun_core::slice_to_nul(&info.version);
            name_buffer[0..s.len()].copy_from_slice(s);
            &name_buffer[0..s.len()]
        };

        Ok(BunString::clone_utf8(slice))
    }
} // mod _impl
pub use _impl::*;

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
    Some(u8::try_from(first_zero).expect("int cast"))
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
