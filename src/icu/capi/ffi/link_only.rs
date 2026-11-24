//! What WTF calls for nothing but `$vm`, which builds with assertions have. Other links that drop unused sections first fail if a call becomes reachable.
#![allow(clippy::panic)]

macro_rules! link_only {
    ($($name:ident)+) => {$(
        const _: () = {
            #[unsafe(export_name = concat!(stringify!($name), "_79"))]
            extern "C" fn missing() -> ! {
                panic!(concat!(stringify!($name), " is not implemented"))
            }
        };
    )+};
}

link_only!(u_foldCase u_strFoldCase ubrk_isBoundary ubrk_setUText utext_close utext_setup);
