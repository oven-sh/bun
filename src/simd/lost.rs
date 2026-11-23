//! Finds code that has lost the instructions of its target: see the guide.

use crate::Isa;

// SAFETY: only the address is taken.
#[allow(unsafe_code)]
unsafe extern "C" {
    /// Nothing defines it, so the linker names the functions that mention it.
    static this_code_lacks_the_instructions_of_its_target_and_needs_the_attribute_simd: u8;
}

#[inline(always)]
pub(crate) fn check<S: Isa>() {
    /// It is reached if the linker is told to give the name an address.
    #[cold]
    #[inline(never)]
    fn lacks_them() -> ! {
        panic!(
            "this code lacks the instructions of its target: see the last function in the backtrace that was not inlined"
        )
    }
    /// Two variables where it is inlined, which takes the features. LLVM can't join the calls before that.
    #[inline(always)]
    #[allow(unknown_lints, dangling_pointers_from_locals)]
    fn place() -> *const u8 {
        let it = 0;
        core::hint::black_box(());
        &raw const it
    }
    if const { !S::COMPILED_FOR && crate::OPTIMIZED && !cfg!(miri) }
        && S::here().short_call(place) == S::here().short_call(place)
    {
        core::hint::black_box(&raw const this_code_lacks_the_instructions_of_its_target_and_needs_the_attribute_simd);
        lacks_them()
    }
}
