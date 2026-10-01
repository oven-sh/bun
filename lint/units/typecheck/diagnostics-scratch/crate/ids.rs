// Id newtypes. 0 is nil for every id space.
pub trait Id: Copy + Eq {
    fn from_u32(v: u32) -> Self;
    fn to_u32(self) -> u32;
}

macro_rules! define_id {
    ($($name:ident),* $(,)?) => {$(
        #[repr(transparent)]
        #[derive(Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default, Debug)]
        pub struct $name(pub u32);
        impl $name {
            pub const NIL: Self = Self(0);
            #[inline]
            pub const fn is_nil(self) -> bool {
                self.0 == 0
            }
        }
        impl crate::ids::Id for $name {
            #[inline]
            fn from_u32(v: u32) -> Self {
                Self(v)
            }
            #[inline]
            fn to_u32(self) -> u32 {
                self.0
            }
        }
    )*};
}

define_id!(NodeId, DiagnosticId);
