macro_rules! up_to_16 {
    ($($n:literal $N:ident)*) => {
        /// LLVM knows its range even when it comes out of a table, so bounds checks on it go away.
        #[derive(Clone, Copy)]
        #[repr(u8)]
        pub enum UpTo16 {
            $(#[doc(hidden)] $N = $n,)*
        }

        impl UpTo16 {
            pub const fn new(n: usize) -> Self {
                [$(Self::$N,)*][n]
            }

            #[inline(always)]
            pub const fn get(self) -> usize {
                self as usize
            }
        }
    };
}

up_to_16!(0 A 1 B 2 C 3 D 4 E 5 F 6 G 7 H 8 I 9 J 10 K 11 L 12 M 13 N 14 O 15 P 16 Q);
