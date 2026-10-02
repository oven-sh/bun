#![deny(warnings)]
#![deny(unreachable_pub)]
#![allow(dead_code)]
pub mod checker {
    pub mod a {
        pub struct Checker;
        pub fn shared() {}
    }
    pub mod only_methods {
        use super::Checker;
        impl Checker {
            pub fn m(&self) {}
        }
    }
    pub mod private_fns {
        fn helper() {}
    }
    pub mod crate_fns {
        pub(crate) fn helper2() {}
    }
    pub mod dup {
        pub fn shared() {}
    }
    pub use a::*;
    pub use only_methods::*;
    pub use private_fns::*;
    pub use crate_fns::*;
    pub use dup::*;
}
