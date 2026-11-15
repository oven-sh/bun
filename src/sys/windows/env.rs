use bun_alloc::AllocError;
use bun_core::{CStrList, CStrRef};

/// Converts all strings in the process environment block to WTF-8.
///
/// This function should be called only once, at program startup, before any code that needs to
/// access the environment runs.
///
/// This function is Windows-only.
pub fn convert_env_to_wtf8() -> Result<(), AllocError> {
    let environment = crate::windows::EnvironmentStrings::get().ok_or(AllocError)?;
    // `bun_core::strings::to_utf8_alloc` is infallible (panics on OOM)
    // and returns `Vec<u8>` directly — no `?` here.
    let wtf8_buf = bun_core::strings::to_utf8_alloc(environment.as_slice());
    let wtf8_buf: &'static [u8] = Box::leak(wtf8_buf.into_boxed_slice());
    let mut len: usize = 0;

    // One NUL for each string, and one for the empty string that becomes the `None`.
    let mut envp = Vec::with_capacity(bun_core::strings::count_char(wtf8_buf, 0));
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

    bun_core::os::set_environ(CStrList::new(Box::leak(envp.into_boxed_slice())));
    Ok(())
}
