use bun_alloc::AllocError;
use bun_core::{CStrList, CStrRef};

/// Converts all strings in the process environment block to WTF-8.
///
/// This function should be called only once, at program startup, before any code that needs to
/// access the environment runs.
///
/// This function is Windows-only.
///
/// # Safety
/// No other thread can read the environment yet.
pub unsafe fn convert_env_to_wtf8() -> Result<(), AllocError> {
    let environment = crate::windows::EnvironmentStrings::get().ok_or(AllocError)?;
    let (wtf16_buf, strings) = environment.measure();
    // `bun_core::strings::to_utf8_alloc` is infallible (panics on OOM)
    // and returns `Vec<u8>` directly — no `?` here.
    let wtf8_buf = bun_core::strings::to_utf8_alloc(wtf16_buf);
    let wtf8_buf: &'static [u8] = Box::leak(wtf8_buf.into_boxed_slice());
    let mut len: usize = 0;

    // The empty string at the end becomes the `None`.
    let mut envp = Vec::with_capacity(strings);
    loop {
        let remaining = &wtf8_buf[len..];
        let str_len = bun_core::slice_to_nul(remaining).len();
        if str_len == 0 {
            break; // array ends with empty null-terminated string
        }
        envp.push(Some(CStrRef::from_slice_with_nul(&remaining[..=str_len])));
        len += str_len + 1; // each string is null-terminated
    }
    envp.push(None);

    let envp = CStrList::new(Box::leak(envp.into_boxed_slice()));
    // SAFETY: fn contract, and the loop pushes no `None`.
    unsafe { bun_core::os::set_environ(envp) };
    Ok(())
}
