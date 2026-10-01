#![deny(warnings)]
pub mod core {
    pub fn same() -> bool { true }
}
pub mod other {
    pub fn f() -> usize { core::mem::size_of::<u32>() }
    pub fn g() -> bool { crate::core::same() }
}
pub fn root() -> usize { core::mem::size_of::<u32>() }
