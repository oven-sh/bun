use core::marker::PhantomData;

/// A row of an architecture's table.
pub struct Feature<Source> {
    /// The name that rustc uses.
    pub(crate) name: &'static str,
    /// What the compiler may also use once it is enabled. These come earlier in the table.
    pub(crate) implies: &'static [&'static str],
    /// Where the system reports it.
    pub(crate) source: Source,
    pub(crate) is_in_build: bool,
}

/// `cfg!` needs a literal.
macro_rules! row {
    ($name:literal, $implies:expr, $source:expr) => {
        Feature {
            name: $name,
            implies: &$implies,
            source: $source,
            is_in_build: cfg!(target_feature = $name),
        }
    };
}
pub(crate) use row;

pub trait Arch {
    type Source: 'static;
    const FEATURES: &'static [Feature<Self::Source>];
}

/// A set of features. The top bit is reserved for `detected`.
pub struct Features<A>(pub(crate) u64, PhantomData<A>);

impl<A> Clone for Features<A> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}

impl<A> Copy for Features<A> {}

impl<A: Arch> Features<A> {
    /// The bit of each feature and of everything that it implies.
    const WITH_IMPLIED: [u64; 63] = {
        let (mut all, mut i) = ([0; 63], 0);
        while i < A::FEATURES.len() {
            all[i] = 1 << i;
            let mut j = 0;
            while j < A::FEATURES[i].implies.len() {
                let implied = Self::index_of(A::FEATURES[i].implies[j]);
                assert!(implied < i);
                all[i] |= all[implied];
                j += 1;
            }
            i += 1;
        }
        all
    };

    /// The features that the whole program is compiled for, if `A` is its architecture.
    pub const IN_BUILD: Self = {
        let (mut bits, mut i) = (0, 0);
        while i < A::FEATURES.len() {
            if A::FEATURES[i].is_in_build {
                bits |= Self::WITH_IMPLIED[i];
            }
            i += 1;
        }
        Self::from_bits(bits)
    };

    #[inline]
    pub(crate) const fn from_bits(bits: u64) -> Self {
        Self(bits, PhantomData)
    }

    #[inline]
    pub const fn bits(self) -> u64 {
        self.0
    }

    pub(crate) const fn index_of(name: &str) -> usize {
        let mut i = 0;
        while !A::FEATURES[i].name.eq_ignore_ascii_case(name) {
            i += 1;
        }
        i
    }

    /// Includes the implied features. Panics on an unknown name.
    pub const fn named(names: &[&str]) -> Self {
        let (mut bits, mut i) = (0, 0);
        while i < names.len() {
            bits |= Self::WITH_IMPLIED[Self::index_of(names[i])];
            i += 1;
        }
        Self::from_bits(bits)
    }

    #[inline]
    pub const fn contains(self, other: Self) -> bool {
        self.0 & other.0 == other.0
    }

    pub fn names(self) -> impl Iterator<Item = &'static str> {
        let rows = A::FEATURES.iter().enumerate();
        rows.filter(move |(i, _)| self.0 >> i & 1 != 0)
            .map(|(_, feature)| feature.name)
    }

    /// A feature counts only if everything that it implies is reported too.
    pub(crate) fn reported(has: impl Fn(&A::Source) -> bool) -> Self {
        let (mut reported, mut usable) = (0, 0);
        for (i, feature) in A::FEATURES.iter().enumerate() {
            reported |= u64::from(has(&feature.source)) << i;
            let all = Self::WITH_IMPLIED[i];
            usable |= u64::from(reported & all == all) << i;
        }
        Self::from_bits(usable)
    }
}

/// Of the release of a kernel.
pub(crate) fn major_and_minor(release: &[u8]) -> Option<(u32, u32)> {
    let mut numbers = release
        .split(|byte| !byte.is_ascii_digit())
        .map(|digits| str::from_utf8(digits).ok()?.parse().ok());
    numbers.next()?.zip(numbers.next()?)
}
