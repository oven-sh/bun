/// Features by the names that rustc has for them. `$source` says how to find out about one.
macro_rules! features {
    ($arch:literal, $Source:ty; $($name:literal $(($($needs:literal),+))? = $source:expr;)*) => {
        #[derive(Clone, Copy)]
        pub struct Features(pub(crate) u64);

        const NAMES: &[&str] = &[$($name),*];
        const SOURCES: [$Source; NAMES.len()] = [$($source),*];

        /// For each feature, itself and all that the compiler may use along with it.
        const WITH_IMPLIED: [u64; NAMES.len()] = {
            assert!(NAMES.len() < 64);
            let direct: [&[&str]; NAMES.len()] = [$(&[$($($needs),+)?]),*];
            let (mut all, mut i) = ([0; NAMES.len()], 0);
            while i < all.len() {
                all[i] = 1 << i;
                let mut j = 0;
                while j < direct[i].len() {
                    let needed = index_of(direct[i][j]);
                    assert!(needed < i, "a feature comes after those that it needs");
                    all[i] |= all[needed];
                    j += 1;
                }
                i += 1;
            }
            all
        };

        const fn index_of(name: &str) -> usize {
            let mut i = 0;
            while !NAMES[i].eq_ignore_ascii_case(name) {
                i += 1;
            }
            i
        }

        impl Features {
            /// Those that the whole program is compiled for.
            #[cfg(target_arch = $arch)]
            pub(crate) const OF_BUILD: Self = {
                let enabled = [$(cfg!(target_feature = $name)),*];
                let (mut bits, mut i) = (0, 0);
                while i < enabled.len() {
                    bits |= if enabled[i] { WITH_IMPLIED[i] } else { 0 };
                    i += 1;
                }
                Self(bits)
            };

            /// With those that they imply. Panics if there is no such feature.
            pub const fn named(names: &[&str]) -> Self {
                let (mut bits, mut i) = (0, 0);
                while i < names.len() {
                    bits |= WITH_IMPLIED[index_of(names[i])];
                    i += 1;
                }
                Self(bits)
            }

            #[inline]
            pub const fn contains(self, other: Self) -> bool {
                self.0 & other.0 == other.0
            }

            pub fn names(self) -> impl Iterator<Item = &'static str> {
                (0..NAMES.len()).filter(move |i| self.0 >> i & 1 != 0).map(|i| NAMES[i])
            }

            /// A feature counts only if all that it implies is reported too.
            fn reported(has: impl Fn(&$Source) -> bool) -> Self {
                let (mut reported, mut usable) = (0, 0);
                for (i, source) in SOURCES.iter().enumerate() {
                    reported |= u64::from(has(source)) << i;
                }
                for (i, &all) in WITH_IMPLIED.iter().enumerate() {
                    usable |= u64::from(reported & all == all) << i;
                }
                Self(usable)
            }
        }
    };
}
