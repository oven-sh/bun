//! Queries the CPU and the operating system.

cfg_select! {
    any(miri, target_env = "sgx") => {
        pub(crate) fn query() -> crate::Features {
            crate::Features::IN_BUILD
        }
    }
    target_arch = "x86_64" => {
        use core::arch::x86_64::{__cpuid_count, _xgetbv};

        fn xcr0() -> u64 {
            const XSAVE_OSXSAVE: u32 = 0b11 << 26;
            if __cpuid_count(1, 0).ecx & XSAVE_OSXSAVE != XSAVE_OSXSAVE {
                return 0;
            }
            // SAFETY: the CPU has the instruction, the system has enabled it, and register 0 is
            // always there.
            unsafe { _xgetbv(0) }
        }

        pub(crate) fn query() -> crate::Features {
            let saved = xcr0();
            #[cfg(target_vendor = "apple")]
            let saved = crate::x86_64::saved_by_darwin(
                saved,
                darwin::is_set(c"hw.optional.avx512f"),
                darwin::sysctl(c"kern.osrelease", &mut [0; 32]),
            );
            let cpuid = |leaf, subleaf| {
                let answer = __cpuid_count(leaf, subleaf);
                [answer.eax, answer.ebx, answer.ecx, answer.edx]
            };
            crate::x86_64::decode(cpuid, saved)
        }
    }
    any(target_os = "linux", target_os = "android") => {
        use core::ffi::{c_int, c_ulong};

        const AT_HWCAP: c_ulong = 16;
        const AT_HWCAP2: c_ulong = 26;

        // SAFETY: `getauxval` accepts any number. A `struct utsname` has six names of 65 bytes.
        unsafe extern "C" {
            safe fn getauxval(key: c_ulong) -> c_ulong;
            safe fn uname(names: &mut [[u8; 65]; 6]) -> c_int;
        }

        fn hwcap() -> u64 {
            let (hwcap, mut names) = (getauxval(AT_HWCAP), [[0; 65]; 6]);
            if hwcap & crate::aarch64::HWCAP_SVE != 0 {
                uname(&mut names);
            }
            crate::aarch64::kept_by_linux(hwcap, &names[2])
        }

        #[cfg(target_os = "linux")]
        pub(crate) fn query() -> crate::Features {
            crate::aarch64::from_hwcap(hwcap(), getauxval(AT_HWCAP2))
        }

        #[cfg(target_os = "android")]
        pub(crate) fn query() -> crate::Features {
            use core::ffi::c_char;
            const PROP_VALUE_MAX: usize = 92;
            unsafe extern "C" {
                fn __system_property_get(
                    name: *const c_char,
                    value: &mut [u8; PROP_VALUE_MAX],
                ) -> c_int;
            }
            let mut value = [0; PROP_VALUE_MAX];
            // SAFETY: the name is NUL-terminated, and a value has up to `PROP_VALUE_MAX` bytes.
            unsafe { __system_property_get(c"ro.arch".as_ptr(), &mut value) };
            crate::aarch64::on_android(hwcap(), getauxval(AT_HWCAP2), &value)
        }
    }
    any(target_os = "freebsd", target_os = "openbsd") => {
        use core::ffi::{c_int, c_ulong};

        const AT_HWCAP: c_int = 25;
        const AT_HWCAP2: c_int = 26;

        fn aux(key: c_int) -> c_ulong {
            unsafe extern "C" {
                fn elf_aux_info(key: c_int, value: &mut c_ulong, size: c_int) -> c_int;
            }
            let mut value = 0;
            // SAFETY: `size` is the size of `value`.
            let status = unsafe { elf_aux_info(key, &mut value, size_of::<c_ulong>() as c_int) };
            if status == 0 { value } else { 0 }
        }

        pub(crate) fn query() -> crate::Features {
            crate::aarch64::from_hwcap(aux(AT_HWCAP), aux(AT_HWCAP2))
        }
    }
    target_vendor = "apple" => {
        pub(crate) fn query() -> crate::Features {
            crate::aarch64::from_sysctl(darwin::is_set)
        }
    }
    target_os = "windows" => {
        // SAFETY: accepts any number.
        #[link(name = "kernel32")]
        unsafe extern "system" {
            safe fn IsProcessorFeaturePresent(feature: u32) -> i32;
        }

        pub(crate) fn query() -> crate::Features {
            crate::aarch64::from_windows(|feature| IsProcessorFeaturePresent(feature) != 0)
        }
    }
    _ => {
        pub(crate) fn query() -> crate::Features {
            crate::Features::IN_BUILD
        }
    }
}

#[cfg(all(target_vendor = "apple", not(miri)))]
mod darwin {
    use core::ffi::{CStr, c_char, c_int, c_void};

    /// Empty if the name is unknown or `value` is too small.
    pub(super) fn sysctl<'a>(name: &CStr, value: &'a mut [u8]) -> &'a [u8] {
        unsafe extern "C" {
            fn sysctlbyname(
                name: *const c_char,
                old: *mut c_void,
                old_len: &mut usize,
                new: *const c_void,
                new_len: usize,
            ) -> c_int;
        }
        let (old, mut len) = (value.as_mut_ptr().cast(), value.len());
        // SAFETY: the name is NUL-terminated, `len` is the size of `value`, and nothing is set.
        let status = unsafe { sysctlbyname(name.as_ptr(), old, &mut len, core::ptr::null(), 0) };
        let len = if status == 0 { len } else { 0 };
        value.get(..len).unwrap_or_default()
    }

    pub(super) fn is_set(name: &CStr) -> bool {
        sysctl(name, &mut [0; 8]).iter().any(|&byte| byte != 0)
    }
}
