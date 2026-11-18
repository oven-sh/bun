use core::ops::Range;

#[cfg(not(windows))]
unsafe extern "C" {
    #[cfg_attr(
        target_vendor = "apple",
        link_name = "\x01section$start$__TEXT$__engine_frames"
    )]
    #[cfg_attr(not(target_vendor = "apple"), link_name = "__start_engine_frames")]
    fn start();
    #[cfg_attr(
        target_vendor = "apple",
        link_name = "\x01section$end$__TEXT$__engine_frames"
    )]
    #[cfg_attr(not(target_vendor = "apple"), link_name = "__stop_engine_frames")]
    fn end();
}

/// The linker sorts the parts of a section by what follows the dollar sign.
#[cfg(windows)]
macro_rules! markers {
    ($($name:ident in $section:literal;)*) => {$(
        #[unsafe(naked)]
        #[unsafe(link_section = $section)]
        unsafe extern "C" fn $name() {
            core::arch::naked_asm!("ret")
        }
    )*};
}

#[cfg(windows)]
markers! {
    start in ".text$engine_frames_a";
    end in ".text$engine_frames_z";
}

/// The addresses of the functions of the interpreter and of the stubs. While one runs the frame pointer is that of a
/// `CallFrame`, or has been saved in a native frame that it points to instead.
pub fn code_in_call_frames() -> Range<usize> {
    start as *const () as usize..end as *const () as usize
}
