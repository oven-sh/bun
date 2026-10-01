#![deny(warnings)]
pub mod core {
    pub fn same() -> bool { true }
}
pub mod other {
    use crate::core;
    pub fn f() -> usize { core::mem::size_of::<u32>() }
    pub fn g() -> bool { core::same() }
}
