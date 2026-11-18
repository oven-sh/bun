//! Tables of instructions that share a form. The discriminants are the bits in which they differ.

macro_rules! family {
    ($(#[$meta:meta])* $name:ident: $repr:ty { $($variant:ident = $value:expr,)* }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #[repr($repr)]
        pub enum $name {
            $($variant = $value,)*
        }

        impl $name {
            pub const ALL: &'static [Self] = &[$(Self::$variant,)*];
        }
    };
}

pub(crate) use family;
