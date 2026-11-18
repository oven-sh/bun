use bun_engine_text::StringRef;

/// The name of the exported function that the address is in or after.
#[cfg(unix)]
pub(super) fn name_at(address: usize) -> Option<StringRef> {
    let mut info = core::mem::MaybeUninit::<libc::Dl_info>::zeroed();
    // SAFETY: takes any address, and the name is null or a string in a library that is loaded.
    unsafe {
        libc::dladdr(core::ptr::without_provenance(address), info.as_mut_ptr());
        let name = core::ptr::NonNull::new(info.assume_init().dli_sname.cast_mut())?;
        let name = core::ffi::CStr::from_ptr(name.as_ptr());
        Some(StringRef::from_latin1(name.to_bytes()))
    }
}

#[cfg(windows)]
pub(super) fn name_at(_: usize) -> Option<StringRef> {
    None
}
