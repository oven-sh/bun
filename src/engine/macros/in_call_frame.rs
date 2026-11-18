use proc_macro2::TokenStream;
use quote::quote;

pub(crate) fn expand(arguments: &TokenStream, item: &TokenStream) -> TokenStream {
    // The compiler adds the attributes of the section for a naked function.
    let mach_o = if arguments.is_empty() {
        "__TEXT,__engine_frames,regular,pure_instructions"
    } else {
        "__TEXT,__engine_frames"
    };
    quote! {
        #[cfg_attr(target_vendor = "apple", unsafe(link_section = #mach_o))]
        #[cfg_attr(windows, unsafe(link_section = ".text$engine_frames_m"))]
        #[cfg_attr(not(any(target_vendor = "apple", windows)), unsafe(link_section = "engine_frames"))]
        #item
    }
}
