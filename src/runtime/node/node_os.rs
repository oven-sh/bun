use core::ffi::c_int;
#[cfg(not(windows))]
use core::ffi::{c_char, c_uint, c_void};

use bun_core;
use bun_core::String as BunString;
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
    use bun_core::EncodedSlice;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    use bun_core::ZStr;
    #[cfg(not(windows))]
    use bun_core::strings;
    use bun_core::{env_var, fmt as bun_fmt};
    use bun_jsc::{CallFrame, JSArray, StringJsc as _, SysErrorJsc as _, SystemError};

    #[cfg(not(windows))]
    use bun_sys::c;
    #[cfg(windows)]
    use bun_sys::windows;
    use std::io::Write as _;

    /// Win32 declarations for `node:os`, and the C++ exports
    /// (`OsBinding.cpp`) behind `os.cpus()` / `os.networkInterfaces()`.
    #[cfg(windows)]
    #[allow(non_snake_case, non_camel_case_types, clippy::upper_case_acronyms)]
    mod win32 {
        use bun_sys::windows::ws2_32::{sockaddr_in, sockaddr_in6};
        use bun_sys::windows::{BOOL, DWORD, HANDLE};
        use core::ffi::{c_char, c_int, c_void};

        pub(super) const TOKEN_READ: DWORD = 0x0002_0008;
        /// `(HKEY)(ULONG_PTR)((LONG)0x80000002)`: a predefined handle (the
        /// `LONG` sign-extends), not a pointer.
        pub(super) const HKEY_LOCAL_MACHINE: *mut c_void =
            0x8000_0002_u32 as i32 as isize as *mut c_void;
        pub(super) const RRF_RT_REG_SZ: DWORD = 0x0000_0002;

        #[repr(C)]
        pub(super) struct MEMORYSTATUSEX {
            pub(super) dwLength: DWORD,
            pub(super) dwMemoryLoad: DWORD,
            pub(super) ullTotalPhys: u64,
            pub(super) ullAvailPhys: u64,
            pub(super) ullTotalPageFile: u64,
            pub(super) ullAvailPageFile: u64,
            pub(super) ullTotalVirtual: u64,
            pub(super) ullAvailVirtual: u64,
            pub(super) ullAvailExtendedVirtual: u64,
        }

        #[repr(C)]
        pub(super) struct OSVERSIONINFOW {
            pub(super) dwOSVersionInfoSize: DWORD,
            pub(super) dwMajorVersion: DWORD,
            pub(super) dwMinorVersion: DWORD,
            pub(super) dwBuildNumber: DWORD,
            pub(super) dwPlatformId: DWORD,
            pub(super) szCSDVersion: [u16; 128],
        }

        #[link(name = "kernel32")]
        unsafe extern "system" {
            pub(super) fn GetEnvironmentVariableW(
                name: *const u16,
                buffer: *mut u16,
                size: DWORD,
            ) -> DWORD;
            pub(super) safe fn GetTickCount64() -> u64;
            pub(super) fn GlobalMemoryStatusEx(buffer: *mut MEMORYSTATUSEX) -> BOOL;
        }
        #[link(name = "userenv")]
        unsafe extern "system" {
            pub(super) fn GetUserProfileDirectoryW(
                token: HANDLE,
                profile_dir: *mut u16,
                size: *mut DWORD,
            ) -> BOOL;
        }
        #[link(name = "advapi32")]
        unsafe extern "system" {
            pub(super) fn OpenProcessToken(
                process: HANDLE,
                access: DWORD,
                token: *mut HANDLE,
            ) -> BOOL;
            pub(super) fn RegGetValueW(
                key: *mut c_void,
                sub_key: *const u16,
                value: *const u16,
                flags: DWORD,
                value_type: *mut DWORD,
                data: *mut c_void,
                data_size: *mut DWORD,
            ) -> i32;
        }
        #[link(name = "ntdll")]
        unsafe extern "system" {
            pub(super) fn RtlGetVersion(info: *mut OSVERSIONINFOW) -> i32;
        }

        /// `BunCpuInfo` (`OsBinding.h`). Times are milliseconds.
        #[repr(C)]
        pub(super) struct CpuInfo {
            pub(super) model: *mut c_char,
            pub(super) speed: c_int,
            pub(super) cpu_times: CpuTimes,
        }
        #[repr(C)]
        pub(super) struct CpuTimes {
            pub(super) user: u64,
            pub(super) nice: u64,
            pub(super) sys: u64,
            pub(super) idle: u64,
            pub(super) irq: u64,
        }

        /// `BunInterfaceAddress` (`OsBinding.h`).
        #[repr(C)]
        pub(super) struct InterfaceAddress {
            pub(super) name: *mut c_char,
            pub(super) phys_addr: [u8; 6],
            pub(super) is_internal: c_int,
            pub(super) address: InterfaceSockaddr,
            pub(super) netmask: InterfaceNetmask,
        }
        #[repr(C)]
        pub(super) union InterfaceSockaddr {
            pub(super) address4: sockaddr_in,
            pub(super) address6: sockaddr_in6,
        }
        #[repr(C)]
        pub(super) union InterfaceNetmask {
            pub(super) netmask4: sockaddr_in,
            pub(super) netmask6: sockaddr_in6,
        }

        unsafe extern "C" {
            // `Bun__Os__cpuInfo` and `Bun__Os__interfaceAddresses` return 0 or a
            // negative `UV_E*` number; on success the array is released with the
            // matching free function.
            pub(super) fn Bun__Os__cpuInfo(
                cpu_infos: *mut *mut CpuInfo,
                count: *mut c_int,
            ) -> c_int;
            pub(super) fn Bun__Os__freeCpuInfo(cpu_infos: *mut CpuInfo, count: c_int);
            pub(super) fn Bun__Os__interfaceAddresses(
                addresses: *mut *mut InterfaceAddress,
                count: *mut c_int,
            ) -> c_int;
            pub(super) fn Bun__Os__freeInterfaceAddresses(
                addresses: *mut InterfaceAddress,
                count: c_int,
            );
        }

        /// `process.report` prints an interface's addresses as
        /// `os.networkInterfaces()` does. `address` is a `sockaddr_in` or a
        /// `sockaddr_in6`, read as far as its family says.
        #[unsafe(no_mangle)]
        pub(super) unsafe extern "C" fn Bun__Os__formatAddress(
            address: *const core::ffi::c_void,
            buffer: *mut u8,
            capacity: usize,
        ) -> usize {
            // SAFETY: caller contract.
            let address = unsafe { bun_sys::net::Address::init_posix(address.cast()) };
            // SAFETY: `buffer` is valid for `capacity` bytes.
            let into = unsafe { core::slice::from_raw_parts_mut(buffer, capacity) };
            // `format_ip` strips the brackets, so the text need not start at `into[0]`.
            let start = into.as_ptr() as usize;
            let Ok(text) = bun_core::fmt::format_ip(&address, into) else {
                return 0;
            };
            let (offset, len) = (text.as_ptr() as usize - start, text.len());
            into.copy_within(offset..offset + len, 0);
            len
        }

        /// `RtlGetVersion`, which unlike `GetVersionExW` is not subject to
        /// the application manifest's compatibility shims.
        pub(super) fn os_version() -> OSVERSIONINFOW {
            let mut info = OSVERSIONINFOW {
                dwOSVersionInfoSize: core::mem::size_of::<OSVERSIONINFOW>() as DWORD,
                dwMajorVersion: 0,
                dwMinorVersion: 0,
                dwBuildNumber: 0,
                dwPlatformId: 0,
                szCSDVersion: [0; 128],
            };
            // SAFETY: `info` is a valid out-pointer with its size field set.
            unsafe { RtlGetVersion(&mut info) };
            info
        }
    }

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
        let mut cpu_infos: *mut win32::CpuInfo = core::ptr::null_mut();
        let mut count: c_int = 0;
        // SAFETY: valid out-pointers
        let err = unsafe { win32::Bun__Os__cpuInfo(&mut cpu_infos, &mut count) };
        if err != 0 {
            return Err(OsError::Any);
        }
        scopeguard::defer! {
            // SAFETY: returned by Bun__Os__cpuInfo
            unsafe { win32::Bun__Os__freeCpuInfo(cpu_infos, count) };
        };

        let values =
            JSValue::create_empty_array(global_this, usize::try_from(count).expect("int cast"))?;

        // SAFETY: cpu_infos points to `count` entries per the Bun__Os__cpuInfo contract
        let infos =
            unsafe { bun_core::ffi::slice(cpu_infos, usize::try_from(count).expect("int cast")) };
        for (i, cpu_info) in infos.iter().enumerate() {
            let times = CPUTimes {
                user: cpu_info.cpu_times.user,
                nice: cpu_info.cpu_times.nice,
                sys: cpu_info.cpu_times.sys,
                idle: cpu_info.cpu_times.idle,
                irq: cpu_info.cpu_times.irq,
            };

            let cpu = JSValue::create_empty_object(global_this, 3);
            // SAFETY: cpu_info.model is a NUL-terminated C string
            let model = unsafe { bun_core::ffi::cstr(cpu_info.model) }.to_bytes();
            cpu.put(
                global_this,
                b"model",
                bun_string_jsc::create_utf8_for_js(global_this, model)?,
            );
            cpu.put(
                global_this,
                b"speed",
                JSValue::js_number(cpu_info.speed as f64),
            );
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
                errno: bun_errno::uv_codes::UV_ESRCH,
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
            return match homedir_windows() {
                Ok(home) => Ok(home),
                Err(err) => Err(global.throw_value(err.to_js(global))),
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

    /// `%USERPROFILE%`, else the profile directory of the process token's user
    /// (libuv's `uv_os_homedir`).
    #[cfg(windows)]
    fn homedir_windows() -> bun_sys::Result<BunString> {
        use bun_sys::{E, Error, Tag};
        let mut buf = bun_paths::w_path_buffer_pool::get();

        windows::kernel32::SetLastError(0);
        // SAFETY: the name is NUL-terminated; `buf` is writable for its length.
        let len = unsafe {
            win32::GetEnvironmentVariableW(
                bun_core::w!("USERPROFILE\0").as_ptr(),
                buf.as_mut_ptr(),
                buf.len() as windows::DWORD,
            )
        } as usize;
        if len > 0 && len < buf.len() {
            // A value too short to be a path is an error, not a miss.
            if len < 3 {
                return Err(Error::from_code(E::ENOENT, Tag::uv_os_homedir));
            }
            return Ok(BunString::clone_utf16(&buf[..len]));
        }
        match windows::Win32Error::get() {
            windows::Win32Error::ENVVAR_NOT_FOUND => {}
            // Set, but empty.
            windows::Win32Error::SUCCESS => {
                return Err(Error::from_code(E::ENOENT, Tag::uv_os_homedir));
            }
            err => return Err(Error::from_win32(err, Tag::uv_os_homedir)),
        }

        let mut token: windows::HANDLE = core::ptr::null_mut();
        // SAFETY: `token` is a valid out-pointer.
        if unsafe {
            win32::OpenProcessToken(windows::GetCurrentProcess(), win32::TOKEN_READ, &mut token)
        } == 0
        {
            return Err(Error::from_win32(
                windows::Win32Error::get(),
                Tag::uv_os_homedir,
            ));
        }
        let mut size = buf.len() as windows::DWORD;
        // SAFETY: `token` is live; `buf` is writable for `size` units.
        let ok = unsafe { win32::GetUserProfileDirectoryW(token, buf.as_mut_ptr(), &mut size) };
        let err = windows::Win32Error::get();
        // SAFETY: `token` is the live handle opened above.
        unsafe { windows::CloseHandle(token) };
        if ok == 0 {
            return Err(Error::from_win32(err, Tag::uv_os_homedir));
        }
        Ok(BunString::clone_utf16(slice_to_nul_u16(&buf)))
    }

    pub(crate) fn hostname(global: &JSGlobalObject) -> JsResult<JSValue> {
        #[cfg(windows)]
        {
            let mut name_buffer: [u16; 130] = [0; 130]; // [129:0]u16 → 130 u16s with NUL at [129]
            bun_uws_sys::iocp::us_internal_winsock_ensure();
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
                        let raw = &dl.sdl_data[dl.sdl_nlen as usize..];
                        // c_char and u8 are both Pod; bytemuck statically checks the layout.
                        bytemuck::cast_slice::<_, u8>(raw)
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
        let mut ifaces: *mut win32::InterfaceAddress = core::ptr::null_mut();
        let mut count: c_int = 0;
        // SAFETY: valid out-pointers
        let err = unsafe { win32::Bun__Os__interfaceAddresses(&mut ifaces, &mut count) };
        if err != 0 {
            let sys_err = SystemError {
                message: BunString::static_("uv_interface_addresses failed").into(),
                code: BunString::static_("ERR_SYSTEM_ERROR").into(),
                //.info = info,
                errno: err,
                syscall: BunString::static_("uv_interface_addresses").into(),
                ..Default::default()
            };
            return Err(global_this.throw_value(sys_err.to_error_instance(global_this)));
        }
        scopeguard::defer! {
            // SAFETY: returned by Bun__Os__interfaceAddresses
            unsafe { win32::Bun__Os__freeInterfaceAddresses(ifaces, count) };
        };

        let ret = JSValue::create_empty_object(global_this, 8);

        // 65 comes from: https://stackoverflow.com/questions/39443413/why-is-inet6-addrstrlen-defined-as-46-in-c
        let mut ip_buf = [0u8; 65];

        // SAFETY: ifaces points to `count` entries per the Bun__Os__interfaceAddresses contract
        let iface_slice =
            unsafe { bun_core::ffi::slice(ifaces, usize::try_from(count).expect("int cast")) };
        for iface in iface_slice {
            let interface = JSValue::create_empty_object(global_this, 7);

            // address <string> The assigned IPv4 or IPv6 address
            // cidr <string> The assigned IPv4 or IPv6 address with the routing prefix in CIDR notation. If the netmask is invalid, this property is set to null.
            let mut cidr = JSValue::NULL;
            {
                // Compute the CIDR suffix; returns null if the netmask cannot
                //  be converted to a CIDR suffix
                // SAFETY: union read tagged by family
                let family = unsafe { iface.address.address4.sin_family } as c_int;
                let maybe_suffix: Option<u8> = match family {
                    bun_sys::posix::AF::INET => {
                        netmask_to_cidr_suffix(unsafe { iface.netmask.netmask4.sin_addr.s_addr })
                    }
                    bun_sys::posix::AF::INET6 => {
                        netmask_to_cidr_suffix(u128::from_ne_bytes(unsafe {
                            iface.netmask.netmask6.sin6_addr.s6_addr
                        }))
                    }
                    _ => None,
                };

                // Format the address and then, if valid, the CIDR suffix; both
                //  the address and cidr values can be slices into this same buffer
                // e.g. addr_str = "192.168.88.254", cidr_str = "192.168.88.254/24"
                let addr_str = bun_fmt::format_ip(
                    // bun_sys::net::Address will do ptrCast depending on the family so this is ok
                    // SAFETY: the address union backs a valid sockaddr_in/sockaddr_in6; pointer derived
                    // from the whole union so provenance covers the full 28 bytes init_posix may copy.
                    &unsafe {
                        bun_sys::net::Address::init_posix(
                            core::ptr::from_ref(&iface.address).cast::<bun_sys::posix::sockaddr>(),
                        )
                    },
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
                let str = bun_fmt::format_ip(
                    // bun_sys::net::Address will do ptrCast depending on the family so this is ok
                    // SAFETY: the netmask union backs a valid sockaddr_in/sockaddr_in6; pointer derived
                    // from the whole union so provenance covers the full 28 bytes init_posix may copy.
                    &unsafe {
                        bun_sys::net::Address::init_posix(
                            core::ptr::from_ref(&iface.netmask).cast::<bun_sys::posix::sockaddr>(),
                        )
                    },
                    &mut ip_buf,
                )
                .expect("unreachable");
                interface.put(
                    global_this,
                    b"netmask",
                    bun_string_jsc::create_utf8_for_js(global_this, str)?,
                );
            }
            // family
            // SAFETY: union read tagged by family
            let family = unsafe { iface.address.address4.sin_family } as c_int;
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
                let mac_buf = bun_fmt::mac_address_lower(iface.phys_addr);
                interface.put(
                    global_this,
                    b"mac",
                    bun_string_jsc::create_utf8_for_js(global_this, &mac_buf)?,
                );
            }

            // internal
            {
                interface.put(
                    global_this,
                    b"internal",
                    JSValue::from(iface.is_internal != 0),
                );
            }

            // cidr. this is here to keep ordering consistent with the node implementation
            interface.put(global_this, b"cidr", cidr);

            // scopeid
            if family == bun_sys::posix::AF::INET6 {
                // SAFETY: union read; family == INET6
                interface.put(
                    global_this,
                    b"scopeid",
                    JSValue::js_number(unsafe { iface.address.address6.sin6_scope_id } as f64),
                );
            }

            // Does this entry already exist?
            // SAFETY: iface.name is a NUL-terminated C string
            let interface_name = unsafe { bun_core::ffi::cstr(iface.name) }.to_bytes();
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
        let value: &[u8] = {
            let info = win32::os_version();
            let mut cursor = &mut name_buffer[..];
            let _ = write!(
                cursor,
                "{}.{}.{}",
                info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber
            );
            let remaining = cursor.len();
            let len = name_buffer.len() - remaining;
            &name_buffer[..len]
        };

        BunString::clone_utf8(value)
    }

    unsafe extern "C" {
        pub(crate) safe fn set_process_priority(pid: i32, priority: i32) -> i32;
    }

    fn set_process_priority_impl(pid: i32, priority: i32) -> bun_sys::E {
        if pid < 0 {
            return bun_sys::E::ESRCH;
        }

        let code: i32 = set_process_priority(pid, priority);
        if code == 0 {
            return bun_sys::E::SUCCESS;
        }
        // POSIX `setpriority` returns -1 and sets errno; Windows returns a `UV_E*` number.
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
            let mut status = win32::MEMORYSTATUSEX {
                dwLength: core::mem::size_of::<win32::MEMORYSTATUSEX>() as windows::DWORD,
                dwMemoryLoad: 0,
                ullTotalPhys: 0,
                ullAvailPhys: 0,
                ullTotalPageFile: 0,
                ullAvailPageFile: 0,
                ullTotalVirtual: 0,
                ullAvailVirtual: 0,
                ullAvailExtendedVirtual: 0,
            };
            // SAFETY: `status` is a valid out-pointer with `dwLength` set.
            if unsafe { win32::GlobalMemoryStatusEx(&mut status) } == 0 {
                return 0;
            }
            return status.ullTotalPhys;
        }
    }

    pub(crate) fn uptime(global: &JSGlobalObject) -> JsResult<f64> {
        #[cfg(windows)]
        {
            let _ = global;
            return Ok(win32::GetTickCount64() as f64 / 1000.0);
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

    #[cfg(windows)]
    pub(crate) fn version() -> JsResult<BunString> {
        Ok(version_windows())
    }

    #[cfg(not(windows))]
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
        Ok(BunString::clone_utf8(slice))
    }

    /// The registry's `ProductName`, then the service pack if there is one
    /// (libuv's `uv_os_uname`).
    #[cfg(windows)]
    fn version_windows() -> BunString {
        let info = win32::os_version();
        let mut version = [0u16; 256 + 1 + 128];
        let mut len: usize = 0;

        let mut size = (256 * core::mem::size_of::<u16>()) as windows::DWORD;
        // SAFETY: both names are NUL-terminated; `version` is writable for `size` bytes.
        let rc = unsafe {
            win32::RegGetValueW(
                win32::HKEY_LOCAL_MACHINE,
                bun_core::w!("SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\0").as_ptr(),
                bun_core::w!("ProductName\0").as_ptr(),
                win32::RRF_RT_REG_SZ,
                core::ptr::null_mut(),
                version.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if rc == 0 {
            len = slice_to_nul_u16(&version[..256]).len();
            // Windows 11 kept `dwMajorVersion` 10 and the "Windows 10" product
            // name; its builds start at 22000.
            let windows_10 = bun_core::w!("Windows 10");
            if info.dwMajorVersion == 10
                && info.dwBuildNumber >= 22000
                && version[..len].starts_with(windows_10)
            {
                version[9] = u16::from(b'1');
            }
        }

        let service_pack = slice_to_nul_u16(&info.szCSDVersion);
        if !service_pack.is_empty() {
            if len > 0 {
                version[len] = u16::from(b' ');
                len += 1;
            }
            version[len..len + service_pack.len()].copy_from_slice(service_pack);
            len += service_pack.len();
        }

        BunString::clone_utf16(&version[..len])
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

#[cfg(windows)]
#[inline]
fn slice_to_nul_u16(buf: &[u16]) -> &[u16] {
    let nul = bun_core::strings::index_of_scalar(buf, 0).unwrap_or(buf.len());
    &buf[..nul]
}
