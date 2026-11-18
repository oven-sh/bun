use crate::Value;

macro_rules! iteration_modes {
    ($($(#[$doc:meta])* $name:ident,)*) => {
        /// What the three words of an `IteratorRecord` mean.
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        #[repr(u8)]
        pub enum IterationMode {
            $($(#[$doc])* $name,)*
        }

        impl IterationMode {
            pub const ALL: &[IterationMode] = &[$(IterationMode::$name,)*];
        }
    };
}

iteration_modes! {
    /// The subject is the iterator, and `next` is its method.
    Generic,
    /// The subject is a `JsArray`, and the position is the index of the next element.
    Array,
    /// The same, of a typed array whose length stays below 2^32 - 1.
    TypedArray,
    /// The same, of the code units of a `JsString`.
    String,
    /// The subject and the position are the parts of a `MapCursor`.
    Map,
    /// The same, of a `SetCursor`.
    Set,
    /// From here on, the subject is an iterator of the library, which has the position itself.
    ArrayKeys,
    ArrayValues,
    ArrayEntries,
    MapKeys,
    MapValues,
    MapEntries,
    SetValues,
    SetEntries,
    StringIterator,
    /// Only of `for await` and `yield*`, as is the one that follows.
    AsyncGenerator,
    AsyncFromSync,
}

impl IterationMode {
    pub const MARKER_SHIFT: u32 = 4;
    pub const FIRST_MARKER: u64 = IterationMode::Array.marker().to_bits();
    pub const LAST_MARKER: u64 = IterationMode::AsyncFromSync.marker().to_bits();

    /// What stands in for `next`. It is neither a cell nor any value of the language.
    #[inline(always)]
    pub const fn marker(self) -> Value {
        // SAFETY: tagged as no cell.
        unsafe { Value::from_bits((self as u64) << Self::MARKER_SHIFT | Value::OTHER_TAG) }
    }

    #[inline(always)]
    pub const fn is_marker(next: Value) -> bool {
        next.to_bits().wrapping_sub(Self::FIRST_MARKER) <= Self::LAST_MARKER - Self::FIRST_MARKER
    }

    #[inline(always)]
    pub const fn of(next: Value) -> IterationMode {
        if Self::is_marker(next) {
            Self::ALL[(next.to_bits() >> Self::MARKER_SHIFT) as usize]
        } else {
            IterationMode::Generic
        }
    }

    /// If they are the bits of one.
    pub fn of_marker(bits: u64) -> Option<IterationMode> {
        let mut with_marker = Self::ALL[1..].iter().copied();
        with_marker.find(|it| it.marker().to_bits() == bits)
    }

    /// Its bit among those that an instruction has seen.
    #[inline(always)]
    pub const fn flag(self) -> u32 {
        1 << self as u32
    }
}
