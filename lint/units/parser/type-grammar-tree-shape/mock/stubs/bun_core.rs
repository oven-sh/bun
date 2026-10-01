pub struct StackCheck;
impl StackCheck {
    pub fn init() -> Self { StackCheck }
    #[inline] pub fn is_safe_to_recurse(&self) -> bool { true }
}

#[macro_export]
macro_rules! comptime_string_map {
    ($(#[$m:meta])* $vis:vis static $name:ident: $ty:ty = { $($k:literal => $v:expr),* $(,)? };) => {
        #[allow(non_camel_case_types, dead_code)]
        $vis struct $name;
        #[allow(dead_code)]
        impl $name {
            pub fn get(&self, s: &[u8]) -> Option<&'static $ty> {
                $( if s == &$k[..] { static V: $ty = $v; return Some(&V); } )*
                None
            }
        }
    };
}
