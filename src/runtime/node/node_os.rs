use core::ffi::c_int;
#[cfg(not(windows))]
use core::ffi::{c_char, c_uint, c_void};

use bun_core;
use bun_core::String as BunString;
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

// ─── gated: JSC bindings + platform syscall bodies ────────────────────────
// Every fn body builds JS objects (`JSValue::create_*`, `ZigString::*::to_js`,
// `global.throw_value`) or reaches `bun_sys::posix::sysctlbyname` /
// `bun_sys::c::sysinfo` / `crate::gen_::node_os` which are not yet exported.
// CPUTimes struct + freemem() + trailing pure helpers hoisted above/below.

mod _impl {
    use super::*;
    use crate::node::ErrorCode;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    use bun_core::ZStr;
    use bun_core::ZigString;
    #[cfg(not(windows))]
    use bun_core::strings;
    use bun_core::{env_var, fmt as bun_fmt};
    use bun_jsc::{CallFrame, JSArray, StringJsc as _, SysErrorJsc as _, SystemError};
    #[cfg(not(windows))]
    use bun_sys::c;
    #[cfg(windows)]
    use bun_sys::windows;
    #[cfg(windows)]
    use bun_sys::windows::Win32ErrorExt as _;
    use std::io::Write as _;

    // ─── local shims for upstream API gaps (Phase D) ──────────────────────────

    /// Unified error for `cpus_impl_*` so `?` works on both `JsResult` and
    /// `bun_core::Error`/`bun_sys::Error`. The variant payload is discarded by
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
    impl From<bun_core::Error> for OsError {
        fn from(_: bun_core::Error) -> Self {
            Self::Any
        }
    }
    impl From<bun_sys::Error> for OsError {
        fn from(_: bun_sys::Error) -> Self {
            Self::Any
        }
    }

    /// `bun_jsc::SystemError` has no `Default` (see src/jsc/SystemError.rs).
    /// Local zero-value for the extern-struct fields.
    #[inline]
    fn system_error_default() -> SystemError {
        SystemError {
            errno: 0,
            code: BunString::empty(),
            message: BunString::empty(),
            path: BunString::empty(),
            syscall: BunString::empty(),
            hostname: BunString::empty(),
            fd: c_int::MIN,
            dest: BunString::empty(),
        }
    }

    /// `bun_core::ZigString` (the `bun_string` crate type) is `repr(C)`-identical
    /// to the JSC-side `ZigString` but lacks `with_encoding`/`to_js`. Provide
    /// them locally.
    trait ZigStringJs {
        fn with_encoding(self) -> ZigString;
        fn to_js(&self, global: &JSGlobalObject) -> JSValue;
    }
    impl ZigStringJs for ZigString {
        #[inline]
        fn with_encoding(mut self) -> ZigString {
            // If not already 16-bit, mark UTF-8.
            if !self.is_16bit() {
                self.mark_utf8();
            }
            self
        }
        #[inline]
        fn to_js(&self, global: &JSGlobalObject) -> JSValue {
            // Signature matches `bun_jsc`'s decl exactly (avoids
            // `clashing_extern_declarations`); both params are non-null refs.
            unsafe extern "C" {
                safe fn ZigString__toValueGC(arg0: &ZigString, arg1: &JSGlobalObject) -> JSValue;
            }
            ZigString__toValueGC(self, global)
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
        use super::{BunString, CallFrame, JSGlobalObject, JSValue, ZigString};
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
                    Some(&ZigString::static_($js_name)),
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
            pub encoding: BunString,
        }
        impl Default for UserInfoOptions {
            fn default() -> Self {
                Self {
                    encoding: BunString::empty(),
                }
            }
        }
    }

    pub(crate) fn create_node_os_binding(global: &JSGlobalObject) -> JsResult<JSValue> {
        let obj = JSValue::create_empty_object(global, 14);
        // SAFETY: pure FFI getter
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
        pub(crate) fn to_value(self, global_this: &JSGlobalObject) -> JSValue {
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
                    code: BunString::static_(<&'static str>::from(ErrorCode::ERR_SYSTEM_ERROR)),
                    ..system_error_default()
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
                        // SAFETY: pure FFI getter
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
                                ZigString::static_("unknown")
                                    .with_encoding()
                                    .to_js(global_this),
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

            let mut line_iter = contents.split(|b| *b == b'\n').filter(|s| !s.is_empty());

            // Skip the first line (aggregate of all CPUs)
            let _ = line_iter.next();

            // Read each CPU line
            while let Some(line) = line_iter.next() {
                // CPU lines are formatted as `cpu0 user nice sys idle iowait irq softirq`
                let mut toks = line
                    .split(|b| *b == b' ' || *b == b'\t')
                    .filter(|s| !s.is_empty());
                let cpu_name = toks.next();
                if cpu_name.is_none() || !cpu_name.unwrap().starts_with(b"cpu") {
                    break; // done with CPUs
                }

                //NOTE: libuv assumes this is fixed on Linux, not sure that's actually the case
                let scale: u64 = 10;

                let times = CPUTimes {
                    user: scale * parse_u64(toks.next().ok_or_else(|| bun_core::err!("eol"))?)?,
                    nice: scale * parse_u64(toks.next().ok_or_else(|| bun_core::err!("eol"))?)?,
                    sys: scale * parse_u64(toks.next().ok_or_else(|| bun_core::err!("eol"))?)?,
                    idle: scale * parse_u64(toks.next().ok_or_else(|| bun_core::err!("eol"))?)?,
                    irq: {
                        let _ = toks.next().ok_or_else(|| bun_core::err!("eol"))?; // skip iowait
                        scale * parse_u64(toks.next().ok_or_else(|| bun_core::err!("eol"))?)?
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

            let mut line_iter = contents.split(|b| *b == b'\n').filter(|s| !s.is_empty());

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
                            ZigString::static_("unknown")
                                .with_encoding()
                                .to_js(global_this),
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
                        ZigString::init(model_name)
                            .with_encoding()
                            .to_js(global_this),
                    );
                    has_model_name = true;
                }
            }
            if !has_model_name {
                let cpu = values.get_index(global_this, cpu_index)?;
                cpu.put(
                    global_this,
                    b"model",
                    ZigString::static_("unknown")
                        .with_encoding()
                        .to_js(global_this),
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
                    ZigString::static_("unknown")
                        .with_encoding()
                        .to_js(global_this),
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
                .map_err(|_| bun_core::err!("fmt"))?;
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
            ZigString::init(bun_core::slice_to_nul(&model_buf))
                .with_encoding()
                .to_js(global_this)
        } else {
            ZigString::static_("unknown")
                .with_encoding()
                .to_js(global_this)
        };

        let mut speed_mhz: c_uint = 0;
        let _ = bun_sys::posix::sysctl_read(c"hw.clockrate", &mut speed_mhz);

        const CPU_STATES: usize = 5; // user, nice, sys, intr, idle
        let mut times_buf: Vec<core::ffi::c_long> = vec![0; ncpu as usize * CPU_STATES];
        bun_sys::posix::sysctl_read_slice(c"kern.cp_times", &mut times_buf[..])
            .map_err(|_| OsError::Any)?;

        // SAFETY: pure FFI getter
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
        let model_name = ZigString::init(bun_core::slice_to_nul(&model_name_buf))
            .with_encoding()
            .to_js(global_this);

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
        // SAFETY: pure FFI getter
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
        use bun_windows_sys::advapi32::{
            HKEY, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, RegCloseKey, RegOpenKeyExW, RegQueryValueExW,
        };
        use bun_windows_sys::ntdll::{
            NtQuerySystemInformation, SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION,
            SystemProcessorPerformanceInformation,
        };

        // SAFETY: out-param struct fully written by GetSystemInfo.
        let mut sysinfo: bun_windows_sys::SYSTEM_INFO = bun_core::ffi::zeroed();
        // SAFETY: valid out-pointer.
        unsafe { bun_windows_sys::GetSystemInfo(&raw mut sysinfo) };
        let count = sysinfo.dwNumberOfProcessors as usize;

        let mut sppi = vec![SYSTEM_PROCESSOR_PERFORMANCE_INFORMATION::default(); count];
        let bytes = u32::try_from(core::mem::size_of_val(&sppi[..])).expect("int cast");
        let mut ret_len: u32 = 0;
        // SAFETY: buffer sized for `count` rows; class 8 fills one per CPU.
        let status = unsafe {
            NtQuerySystemInformation(
                SystemProcessorPerformanceInformation,
                sppi.as_mut_ptr().cast(),
                bytes,
                &raw mut ret_len,
            )
        };
        if status != bun_windows_sys::NTSTATUS::SUCCESS {
            return Err(OsError::Any);
        }

        let values = JSValue::create_empty_array(global_this, count)?;
        let mut key_buf = [0u16; 128];
        let mut brand = [0u16; 256];
        for (i, row) in sppi.iter().enumerate() {
            // HARDWARE\DESCRIPTION\System\CentralProcessor\<i>
            let prefix: &[u16] =
                bun_core::wstr!("HARDWARE\\DESCRIPTION\\System\\CentralProcessor\\");
            // wstr! appends a NUL; copy only the characters or the key path
            // ends at the embedded NUL and the per-CPU index is lost.
            let mut n = prefix.len() - 1;
            key_buf[..n].copy_from_slice(&prefix[..n]);
            let digits = i.to_string();
            for d in digits.bytes() {
                key_buf[n] = u16::from(d);
                n += 1;
            }
            key_buf[n] = 0;

            let mut key: HKEY = core::ptr::null_mut();
            // SAFETY: NUL-terminated key path; out-param local.
            if unsafe {
                RegOpenKeyExW(
                    HKEY_LOCAL_MACHINE,
                    key_buf.as_ptr(),
                    0,
                    KEY_QUERY_VALUE,
                    &raw mut key,
                )
            } != 0
            {
                return Err(OsError::Any);
            }
            let mut speed: u32 = 0;
            let mut speed_size = 4u32;
            let mut brand_size =
                u32::try_from(core::mem::size_of_val(&brand[..])).expect("int cast");
            // SAFETY: value buffers sized; `key` live until RegCloseKey.
            let ok = unsafe {
                let a = RegQueryValueExW(
                    key,
                    bun_core::wstr!("~MHz").as_ptr(),
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                    (&raw mut speed).cast(),
                    &raw mut speed_size,
                );
                let b = RegQueryValueExW(
                    key,
                    bun_core::wstr!("ProcessorNameString").as_ptr(),
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                    brand.as_mut_ptr().cast(),
                    &raw mut brand_size,
                );
                RegCloseKey(key);
                a == 0 && b == 0
            };
            if !ok {
                return Err(OsError::Any);
            }

            // 100ns → ms; kernel time includes idle, subtract it (libuv parity).
            let times = CPUTimes {
                user: (row.UserTime / 10_000) as u64,
                nice: 0,
                sys: ((row.KernelTime - row.IdleTime) / 10_000) as u64,
                idle: (row.IdleTime / 10_000) as u64,
                irq: (row.InterruptTime / 10_000) as u64,
            };

            let cpu = JSValue::create_empty_object(global_this, 3);
            let brand_len = brand[..(brand_size as usize / 2)]
                .iter()
                .position(|&c| c == 0)
                .unwrap_or(brand_size as usize / 2);
            let mut model = Vec::new();
            bun_core::convert_wtf16_to_wtf8_append(&mut model, &brand[..brand_len]);
            cpu.put(
                global_this,
                b"model",
                ZigString::init(&model).with_encoding().to_js(global_this),
            );
            cpu.put(global_this, b"speed", JSValue::js_number(f64::from(speed)));
            cpu.put(global_this, b"times", times.to_value(global_this));
            values.put_index(global_this, u32::try_from(i).expect("int cast"), cpu)?;
        }

        Ok(values)
    }

    unsafe extern "C" {
        safe fn get_process_priority(pid: i32) -> i32;
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
                // node-visible errno domain keeps uv numbering. ESRCH = -4040.
                errno: -4040,
                syscall: BunString::static_("uv_os_getpriority"),
                ..system_error_default()
            };
            return Err(global.throw_value(err.to_error_instance_with_info_object(global)));
        }
        Ok(result)
    }

    pub(crate) fn homedir(global: &JSGlobalObject) -> JsResult<BunString> {
        // In Node.js, this is a wrapper around uv_os_homedir.
        #[cfg(windows)]
        {
            // USERPROFILE first, then the token's profile directory (the
            // same order node documents for os.homedir on Windows).
            let mut wide = [0u16; 1024];
            // SAFETY: NUL-terminated name; buffer sized; returns chars copied.
            let n = unsafe {
                bun_windows_sys::GetEnvironmentVariableW(
                    bun_core::wstr!("USERPROFILE").as_ptr(),
                    wide.as_mut_ptr(),
                    1024,
                )
            } as usize;
            // libuv treats a set-but-shorter-than-"C:\" USERPROFILE as
            // invalid (uv_os_homedir's `*size < 3` check).
            if n >= 3 && n < 1024 {
                return Ok(BunString::clone_utf16(&wide[..n]));
            }
            let mut token: bun_windows_sys::HANDLE = core::ptr::null_mut();
            // SAFETY: pseudo-handle process; out-param local; token closed below.
            let opened = unsafe {
                bun_windows_sys::advapi32::OpenProcessToken(
                    bun_windows_sys::GetCurrentProcess(),
                    bun_windows_sys::advapi32::TOKEN_READ,
                    &raw mut token,
                )
            };
            if opened == 0 {
                let err = bun_sys::Error::new(
                    bun_sys::windows::Win32Error::get().to_e(),
                    bun_sys::Tag::uv_os_homedir,
                );
                return Err(global.throw_value(err.to_js(global)));
            }
            let mut size: u32 = 1024;
            // SAFETY: live token; buffer sized; size in/out in chars.
            let ok = unsafe {
                let r = bun_windows_sys::userenv::GetUserProfileDirectoryW(
                    token,
                    wide.as_mut_ptr(),
                    &raw mut size,
                );
                bun_windows_sys::CloseHandle(token);
                r
            };
            if ok == 0 || size < 2 {
                let err = bun_sys::Error::new(
                    bun_sys::windows::Win32Error::get().to_e(),
                    bun_sys::Tag::uv_os_homedir,
                );
                return Err(global.throw_value(err.to_js(global)));
            }
            // size includes the NUL.
            return Ok(BunString::clone_utf16(&wide[..size as usize - 1]));
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
            let mut heap_bytes: Vec<u8>;
            let mut string_bytes: &mut [u8] = &mut stack_string_bytes[..];
            let mut using_heap = false;

            // SAFETY: zeroed POD
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
                        // `ret` is a libc errno; `E::from_raw` is the centralized
                        // `@enumFromInt` (debug-asserts the discriminant).
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
                BunString::empty()
            });
        }
    }

    pub(crate) fn hostname(global: &JSGlobalObject) -> JsResult<JSValue> {
        #[cfg(windows)]
        {
            let mut name_buffer: [u16; 130] = [0; 130]; // [129:0]u16 → 130 u16s with NUL at [129]
            // SAFETY: valid buffer
            if unsafe { windows::GetHostNameW(name_buffer.as_mut_ptr(), 129) } == 0 {
                let str = BunString::clone_utf16(slice_to_nul_u16(&name_buffer));
                let js = str.to_js(global);
                str.deref();
                return js;
            }

            let mut result: windows::ws2_32::WSADATA = bun_core::ffi::zeroed();
            // SAFETY: valid out-pointer
            if unsafe { windows::ws2_32::WSAStartup(0x202, &raw mut result) } == 0 {
                // SAFETY: valid buffer
                if unsafe { windows::GetHostNameW(name_buffer.as_mut_ptr(), 129) } == 0 {
                    let y = BunString::clone_utf16(slice_to_nul_u16(&name_buffer));
                    let js = y.to_js(global);
                    y.deref();
                    return js;
                }
            }

            return Ok(ZigString::init(b"unknown").with_encoding().to_js(global));
        }
        #[cfg(not(windows))]
        {
            let mut name_buffer = [0u8; HOST_NAME_MAX];
            let s: &[u8] = if bun_sys::posix::gethostname(&mut name_buffer).is_ok() {
                bun_core::slice_to_nul(&name_buffer)
            } else {
                b"unknown"
            };
            return Ok(ZigString::init(s).with_encoding().to_js(global));
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
        // getifaddrs sets a pointer to a linked list
        let mut interface_start: *mut libc::ifaddrs = core::ptr::null_mut();
        // SAFETY: valid out-pointer
        let rc = unsafe { libc::getifaddrs(&raw mut interface_start) };
        if rc != 0 {
            let _ = rc;
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
                ..system_error_default()
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
                    cidr = ZigString::init(cidr_str).with_encoding().to_js(global_this);
                }

                interface.put(
                    global_this,
                    b"address",
                    ZigString::init(&buf[start..start + addr_len])
                        .with_encoding()
                        .to_js(global_this),
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
                    ZigString::init(str).with_encoding().to_js(global_this),
                );
            }

            // family <string> Either IPv4 or IPv6
            interface.put(
                global_this,
                b"family",
                match addr.family() as c_int {
                    libc::AF_INET => global_this.common_strings().ipv4(),
                    libc::AF_INET6 => global_this.common_strings().ipv6(),
                    _ => ZigString::static_("unknown").to_js(global_this),
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
                        let raw = &dl.sdl_data[dl.sdl_nlen as usize..];
                        // c_char and u8 are both Pod; bytemuck statically checks the layout.
                        bytemuck::cast_slice::<_, u8>(raw)
                    };
                    if addr_data.len() < 6 {
                        let mac = b"00:00:00:00:00:00";
                        interface.put(
                            global_this,
                            b"mac",
                            ZigString::init(mac).with_encoding().to_js(global_this),
                        );
                    } else {
                        let mac_buf = bun_fmt::mac_address_lower(
                            addr_data[..6].try_into().expect("len>=6 checked above"),
                        );
                        interface.put(
                            global_this,
                            b"mac",
                            ZigString::init(&mac_buf).with_encoding().to_js(global_this),
                        );
                    }
                } else {
                    let mac = b"00:00:00:00:00:00";
                    interface.put(
                        global_this,
                        b"mac",
                        ZigString::init(mac).with_encoding().to_js(global_this),
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

            it = next;
        }

        Ok(ret)
    }

    #[cfg(windows)]
    pub fn network_interfaces_windows(global_this: &JSGlobalObject) -> JsResult<JSValue> {
        use bun_sys::posix::{AF, sockaddr_in, sockaddr_in6};
        use bun_windows_sys::Win32Error;
        use bun_windows_sys::iphlpapi::{
            GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
            GetAdaptersAddresses, IF_TYPE_SOFTWARE_LOOPBACK, IP_ADAPTER_ADDRESSES, IfOperStatusUp,
        };

        let ret = JSValue::create_empty_object(global_this, 8);

        // GetAdaptersAddresses size-probe loop: retry while the adapter set
        // grows between probe and fill. `u64` storage keeps the 8-aligned
        // adapter records readable from an aligned base.
        let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
        let mut buf: Vec<u64> = Vec::new();
        let mut size: u32 = 0;
        loop {
            // SAFETY: the buffer pointer spans `size` writable bytes (null on
            // the zero-size first probe); `size` is a valid in/out pointer.
            let r = unsafe {
                GetAdaptersAddresses(
                    AF::UNSPEC as u32,
                    flags,
                    core::ptr::null_mut(),
                    if buf.is_empty() {
                        core::ptr::null_mut()
                    } else {
                        buf.as_mut_ptr().cast()
                    },
                    &raw mut size,
                )
            };
            match Win32Error(u16::try_from(r).unwrap_or(u16::MAX)) {
                Win32Error::SUCCESS => break,
                Win32Error::BUFFER_OVERFLOW => {
                    buf = vec![0u64; (size as usize).div_ceil(8)];
                }
                // No adapters at all — an empty result, not an error.
                Win32Error::NO_DATA => return Ok(ret),
                code => {
                    // node-visible errno domain keeps uv numbering.
                    let errno: c_int = match code {
                        Win32Error::ADDRESS_NOT_ASSOCIATED => -4088, // UV_EAGAIN
                        Win32Error::INVALID_PARAMETER => -4060,      // UV_ENOBUFS
                        Win32Error::NOT_ENOUGH_MEMORY => -4057,      // UV_ENOMEM
                        _ => -4094,                                  // UV_UNKNOWN
                    };
                    let sys_err = SystemError {
                        message: BunString::static_("uv_interface_addresses failed"),
                        code: BunString::static_("ERR_SYSTEM_ERROR"),
                        errno,
                        syscall: BunString::static_("uv_interface_addresses"),
                        ..system_error_default()
                    };
                    return Err(global_this.throw_value(sys_err.to_error_instance(global_this)));
                }
            }
        }

        // 65 comes from: https://stackoverflow.com/questions/39443413/why-is-inet6-addrstrlen-defined-as-46-in-c
        let mut ip_buf = [0u8; 65];
        let mut name: Vec<u8> = Vec::new();

        let mut next_adapter: *const IP_ADAPTER_ADDRESSES = if buf.is_empty() {
            core::ptr::null()
        } else {
            buf.as_ptr().cast()
        };
        while !next_adapter.is_null() {
            // SAFETY: head of `buf` or a `Next` link written by
            // GetAdaptersAddresses; records live in `buf` until it drops.
            let adapter = unsafe { &*next_adapter };
            next_adapter = adapter.Next.cast_const();

            // Skip interfaces that are not up or carry no unicast address
            // (libuv parity); loopback stays, flagged `internal` below.
            if adapter.OperStatus != IfOperStatusUp || adapter.FirstUnicastAddress.is_null() {
                continue;
            }

            name.clear();
            {
                // SAFETY: FriendlyName is a NUL-terminated UTF-16 string in `buf`.
                let name_w = unsafe {
                    let p = adapter.FriendlyName;
                    let mut len = 0usize;
                    while *p.add(len) != 0 {
                        len += 1;
                    }
                    bun_core::ffi::slice(p, len)
                };
                bun_core::convert_wtf16_to_wtf8_append(&mut name, name_w);
            }

            // All-zero MAC unless the adapter reports exactly 6 bytes (libuv parity).
            let mut phys_addr = [0u8; 6];
            let mac_len = phys_addr.len();
            if adapter.PhysicalAddressLength as usize == mac_len {
                phys_addr.copy_from_slice(&adapter.PhysicalAddress[..mac_len]);
            }
            let is_internal = adapter.IfType == IF_TYPE_SOFTWARE_LOOPBACK;

            // One entry per (adapter, unicast address) pair.
            let mut next_unicast = adapter.FirstUnicastAddress.cast_const();
            while !next_unicast.is_null() {
                // SAFETY: unicast list node written by GetAdaptersAddresses into `buf`.
                let unicast = unsafe { &*next_unicast };
                next_unicast = unicast.Next.cast_const();

                let sa = unicast.Address.lpSockaddr;
                // SAFETY: lpSockaddr points at a sockaddr in `buf`; the family
                // tag is always readable.
                let family = c_int::from(unsafe { (*sa).sa_family });
                let prefix_len = unicast.OnLinkPrefixLength;

                // Copy the reported address; synthesize the netmask from
                // OnLinkPrefixLength, exactly as libuv composes them.
                let mut scope_id: u32 = 0;
                let (addr, netmask, maybe_suffix) = if family == AF::INET6 {
                    // SAFETY: AF_INET6 ⇒ the record is a sockaddr_in6 in `buf`.
                    let addr6 = unsafe { sa.cast::<sockaddr_in6>().read_unaligned() };
                    scope_id = addr6.sin6_scope_id;
                    let mut mask6: sockaddr_in6 = bun_core::ffi::zeroed();
                    mask6.sin6_family = AF::INET6 as u16;
                    let full_bytes = usize::from(prefix_len >> 3).min(16);
                    mask6.sin6_addr.s6_addr[..full_bytes].fill(0xff);
                    if prefix_len % 8 != 0 && full_bytes < 16 {
                        mask6.sin6_addr.s6_addr[full_bytes] = 0xff << (8 - prefix_len % 8);
                    }
                    let suffix =
                        netmask_to_cidr_suffix(u128::from_ne_bytes(mask6.sin6_addr.s6_addr));
                    // SAFETY: both locals are fully-initialized sockaddr_in6 values.
                    unsafe {
                        (
                            bun_sys::net::Address::init_posix((&raw const addr6).cast()),
                            bun_sys::net::Address::init_posix((&raw const mask6).cast()),
                            suffix,
                        )
                    }
                } else {
                    // SAFETY: GetAdaptersAddresses(AF_UNSPEC) yields only INET
                    // and INET6 records; non-INET6 is a sockaddr_in in `buf`.
                    let addr4 = unsafe { sa.cast::<sockaddr_in>().read_unaligned() };
                    let mut mask4: sockaddr_in = bun_core::ffi::zeroed();
                    mask4.sin_family = AF::INET as u16;
                    mask4.sin_addr.s_addr = if prefix_len > 0 {
                        (u32::MAX << (32 - u32::from(prefix_len.min(32)))).to_be()
                    } else {
                        0
                    };
                    let suffix = netmask_to_cidr_suffix(mask4.sin_addr.s_addr);
                    // SAFETY: both locals are fully-initialized sockaddr_in values.
                    unsafe {
                        (
                            bun_sys::net::Address::init_posix((&raw const addr4).cast()),
                            bun_sys::net::Address::init_posix((&raw const mask4).cast()),
                            suffix,
                        )
                    }
                };

                let interface = JSValue::create_empty_object(global_this, 7);

                // address <string> The assigned IPv4 or IPv6 address
                // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
                let mut cidr = JSValue::NULL;
                {
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
                        cidr = ZigString::init(cidr_str).with_encoding().to_js(global_this);
                    }

                    interface.put(
                        global_this,
                        b"address",
                        ZigString::init(&ip_buf[start..start + addr_len])
                            .with_encoding()
                            .to_js(global_this),
                    );
                }

                // netmask
                {
                    let str = bun_fmt::format_ip(&netmask, &mut ip_buf).expect("unreachable");
                    interface.put(
                        global_this,
                        b"netmask",
                        ZigString::init(str).with_encoding().to_js(global_this),
                    );
                }

                // family
                interface.put(
                    global_this,
                    b"family",
                    match family {
                        AF::INET => global_this.common_strings().ipv4(),
                        AF::INET6 => global_this.common_strings().ipv6(),
                        _ => ZigString::static_("unknown").to_js(global_this),
                    },
                );

                // mac
                {
                    let mac_buf = bun_fmt::mac_address_lower(phys_addr);
                    interface.put(
                        global_this,
                        b"mac",
                        ZigString::init(&mac_buf).with_encoding().to_js(global_this),
                    );
                }

                // internal
                interface.put(global_this, b"internal", JSValue::from(is_internal));

                // cidr. this is here to keep ordering consistent with the node implementation
                interface.put(global_this, b"cidr", cidr);

                // scopeid
                if family == AF::INET6 {
                    interface.put(
                        global_this,
                        b"scopeid",
                        JSValue::js_number(f64::from(scope_id)),
                    );
                }

                // Does this entry already exist?
                if let Some(array) = ret.get(global_this, name.as_slice())? {
                    // Add this interface entry to the existing array
                    let next_index: u32 =
                        u32::try_from(array.get_length(global_this)?).expect("int cast");
                    array.put_index(global_this, next_index, interface)?;
                } else {
                    // Add it as an array with this interface as an element
                    let array = JSValue::create_empty_array(global_this, 1)?;
                    array.put_index(global_this, 0, interface)?;
                    ret.put(global_this, name.as_slice(), array);
                }
            }
        }

        Ok(ret)
    }

    pub fn release() -> BunString {
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
            use bun_windows_sys::ntdll::{RTL_OSVERSIONINFOW, RtlGetVersion};
            let mut info: RTL_OSVERSIONINFOW = bun_core::ffi::zeroed();
            info.dwOSVersionInfoSize = core::mem::size_of::<RTL_OSVERSIONINFOW>() as u32;
            // Cannot fail; "major.minor.build" matches libuv's uv_os_uname release.
            let _ = RtlGetVersion(&mut info);
            let written = {
                let mut cursor = &mut name_buffer[..];
                write!(
                    cursor,
                    "{}.{}.{}",
                    info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber
                )
                .expect("unreachable");
                let remaining = cursor.len();
                name_buffer.len() - remaining
            };
            &name_buffer[..written]
        };

        BunString::clone_utf8(value)
    }

    unsafe extern "C" {
        pub(crate) safe fn set_process_priority(pid: i32, priority: i32) -> i32;
    }

    pub(crate) fn set_process_priority_impl(pid: i32, priority: i32) -> bun_sys::E {
        if pid < 0 {
            return bun_sys::E::ESRCH;
        }

        let code: i32 = set_process_priority(pid, priority);

        if code == -2 {
            return bun_sys::E::ESRCH;
        }
        if code == 0 {
            return bun_sys::E::SUCCESS;
        }

        // get_errno already returns bun_sys::E (= SystemErrno) directly.
        bun_sys::get_errno(code)
    }

    pub(crate) fn set_priority1(global: &JSGlobalObject, pid: i32, priority: i32) -> JsResult<()> {
        let errcode = set_process_priority_impl(pid, priority);
        match errcode {
            bun_sys::E::ESRCH => {
                let err = SystemError {
                    message: BunString::static_("no such process"),
                    code: BunString::static_("ESRCH"),
                    #[cfg(not(windows))]
                    errno: -(bun_sys::posix::E::ESRCH as c_int),
                    #[cfg(windows)]
                    // node-visible errno domain keeps uv numbering. ESRCH = -4040.
                    errno: -4040,
                    syscall: BunString::static_("uv_os_getpriority"),
                    ..system_error_default()
                };
                Err(global.throw_value(err.to_error_instance_with_info_object(global)))
            }
            bun_sys::E::EACCES => {
                let err = SystemError {
                    message: BunString::static_("permission denied"),
                    code: BunString::static_("EACCES"),
                    #[cfg(not(windows))]
                    errno: -(bun_sys::posix::E::EACCES as c_int),
                    #[cfg(windows)]
                    // node-visible errno domain keeps uv numbering. EACCES = -4092.
                    errno: -4092,
                    syscall: BunString::static_("uv_os_getpriority"),
                    ..system_error_default()
                };
                Err(global.throw_value(err.to_error_instance_with_info_object(global)))
            }
            bun_sys::E::EPERM => {
                let err = SystemError {
                    message: BunString::static_("operation not permitted"),
                    code: BunString::static_("EPERM"),
                    #[cfg(not(windows))]
                    errno: -(bun_sys::posix::E::ESRCH as c_int),
                    #[cfg(windows)]
                    // node-visible errno domain keeps uv numbering. ESRCH = -4040.
                    errno: -4040,
                    syscall: BunString::static_("uv_os_getpriority"),
                    ..system_error_default()
                };
                Err(global.throw_value(err.to_error_instance_with_info_object(global)))
            }
            _ => {
                // no other error codes can be emitted
                Ok(())
            }
        }
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
            use bun_windows_sys::kernel32::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
            let mut status: MEMORYSTATUSEX = bun_core::ffi::zeroed();
            status.dwLength = core::mem::size_of::<MEMORYSTATUSEX>() as u32;
            if GlobalMemoryStatusEx(&mut status) == 0 {
                return 0;
            }
            return status.ullTotalPhys;
        }
    }

    pub fn uptime(global: &JSGlobalObject) -> JsResult<f64> {
        #[cfg(windows)]
        {
            let _ = global;
            // GetTickCount64 (ms since boot) cannot fail — libuv's uv_uptime.
            return Ok(bun_windows_sys::kernel32::GetTickCount64() as f64 / 1000.0);
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
        let home = scopeguard::guard(home, |h| h.deref());

        result.put(global_this, b"homedir", home.to_js(global_this)?);

        #[cfg(windows)]
        {
            result.put(
                global_this,
                b"username",
                ZigString::init(env_var::USER.get().unwrap_or(b"unknown"))
                    .with_encoding()
                    .to_js(global_this),
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
                ZigString::init(username).with_encoding().to_js(global_this),
            );
            result.put(
                global_this,
                b"shell",
                ZigString::init(env_var::SHELL.get().unwrap_or(b"unknown"))
                    .with_encoding()
                    .to_js(global_this),
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
            use bun_windows_sys::advapi32::{
                HKEY, HKEY_LOCAL_MACHINE, KEY_QUERY_VALUE, KEY_WOW64_64KEY, RRF_RT_REG_SZ,
                RegCloseKey, RegGetValueW, RegOpenKeyExW,
            };
            use bun_windows_sys::ntdll::{RTL_OSVERSIONINFOW, RtlGetVersion};

            let mut info: RTL_OSVERSIONINFOW = bun_core::ffi::zeroed();
            info.dwOSVersionInfoSize = core::mem::size_of::<RTL_OSVERSIONINFOW>() as u32;
            let _ = RtlGetVersion(&mut info);

            // libuv's uv_os_uname version composition: registry ProductName
            // (with the Windows 11 fixup), then the service-pack suffix.
            let mut composed: Vec<u8> = Vec::new();
            let mut product = [0u16; 256];
            let mut key: HKEY = core::ptr::null_mut();
            // SAFETY: NUL-terminated key path; out-param local.
            if unsafe {
                RegOpenKeyExW(
                    HKEY_LOCAL_MACHINE,
                    bun_core::wstr!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion").as_ptr(),
                    0,
                    KEY_QUERY_VALUE | KEY_WOW64_64KEY,
                    &raw mut key,
                )
            } == 0
            {
                let mut product_bytes =
                    u32::try_from(core::mem::size_of_val(&product[..])).expect("int cast");
                // SAFETY: value buffer sized; `key` live until RegCloseKey.
                let ok = unsafe {
                    let r = RegGetValueW(
                        key,
                        core::ptr::null(),
                        bun_core::wstr!("ProductName").as_ptr(),
                        RRF_RT_REG_SZ,
                        core::ptr::null_mut(),
                        product.as_mut_ptr().cast(),
                        &raw mut product_bytes,
                    );
                    RegCloseKey(key);
                    r == 0
                };
                if ok {
                    let len = slice_to_nul_u16(&product).len();
                    let product = &mut product[..len];
                    // Windows 11 kept dwMajorVersion == 10; rewrite a leading
                    // "Windows 10" by build number, as libuv does.
                    if info.dwMajorVersion == 10
                        && info.dwBuildNumber >= 22000
                        && product.starts_with(&bun_core::wstr!("Windows 10")[..10])
                    {
                        product[9] = u16::from(b'1');
                    }
                    bun_core::convert_wtf16_to_wtf8_append(&mut composed, product);
                }
            }

            let csd = slice_to_nul_u16(&info.szCSDVersion);
            if !csd.is_empty() {
                if !composed.is_empty() {
                    composed.push(b' ');
                }
                bun_core::convert_wtf16_to_wtf8_append(&mut composed, csd);
            }

            if composed.len() > name_buffer.len() {
                break 'slice b"unknown";
            }
            name_buffer[..composed.len()].copy_from_slice(&composed);
            &name_buffer[..composed.len()]
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
fn parse_u64(s: &[u8]) -> Result<u64, bun_core::Error> {
    bun_core::fmt::parse_int(s, 10).map_err(|_| bun_core::err!("InvalidCharacter"))
}
#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
fn parse_u32(s: &[u8]) -> Result<u32, bun_core::Error> {
    bun_core::fmt::parse_int(s, 10).map_err(|_| bun_core::err!("InvalidCharacter"))
}

#[cfg(windows)]
#[inline]
fn slice_to_nul_u16(buf: &[u16]) -> &[u16] {
    let nul = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    &buf[..nul]
}
