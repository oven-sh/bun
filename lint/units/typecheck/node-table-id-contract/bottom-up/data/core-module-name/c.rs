#![deny(warnings)]
pub mod core {
    pub fn same() -> bool { true }
}
pub mod other {
    #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, Default)]
    pub struct X(pub u32);
    pub fn f() -> usize { ::core::mem::size_of::<X>() }
    pub fn h(a: &[u8]) -> bool { matches!(a.first(), Some(1)) && format!("{:?}", X(1)).len() > 1 }
}
