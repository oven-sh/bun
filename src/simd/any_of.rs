use crate::raw::Bits;
use crate::{B16, Isa, MaskOf, Readable, Simd, Tag, Width};

/// The two tables of `in_columns` for one byte are at `128 + (byte ^ 15)` and `byte ^ 15`.
const BITS: &[u8; 400] = &{
    let (mut all, mut i) = ([0; 400], 0);
    while i < 8 {
        (all[143 + 16 * i], i) = (1 << i, i + 1);
    }
    all
};

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// Bit `byte >> 4 & 7` at index `byte & 15` of the table for bytes below 128, or of the other.
    #[op]
    pub(crate) fn in_columns(self, low: Self, high: Self) -> MaskOf<u8, W, S> {
        return_if!(S::A64, {
            let (eighth, bits) =
                (self >> 3, self.tag().dup128([1, 1, 2, 2, 4, 4, 8, 8, 16, 16, 32, 32, 64, 64, 128, 128]));
            let column = self.like(15).black_box().bit_select(self, eighth);
            low.two_tables_lookup_bytes(high, column).has_bit(bits.two_tables_lookup_bytes(bits.black_box(), eighth))
        });
        let (column, bits) =
            (self & 0x8f, self.tag().dup128([1, 2, 4, 8, 16, 32, 64, 128, 1, 2, 4, 8, 16, 32, 64, 128]));
        (low.table_lookup_bytes(column) | high.table_lookup_bytes(column ^ 0x80))
            .has_bit(bits.table_lookup_bytes(self >> 4))
    }
}

impl<S: Isa, W: Width> Tag<S, u8, W> {
    /// A test of whether each byte is one of `set`, which is known only at run time. See [`ByteSet`](crate::ByteSet) for
    /// a constant.
    #[op]
    pub(crate) fn any_of(self, set: &[u8]) -> impl Fn(Simd<u8, W, S>) -> MaskOf<u8, W, S> + use<S, W> {
        // In registers, as a load of a vector waits for stores of its bytes.
        let wide = Tag::<S, u8, B16>::new(self.simd());
        let (mut low16, mut high16) = (wide.zero(), wide.zero());
        for &byte in set {
            let from = &BITS[byte as usize ^ 15..];
            (low16, high16) = (low16 | wide.load(&from[128..]), high16 | wide.load(from));
        }
        let (low, high) = (self.dup128(low16.to_array()), self.dup128(high16.to_array()));
        #[inline(always)]
        move |v| {
            return_if!(
                W::BYTES < 16,
                self.resize_bitcast(wide.resize_bitcast(v).in_columns(low16, high16).to_vector()).moved_mask()
            );
            apart_unoptimized!(v.s, { v.in_columns(low, high) })
        }
    }

    /// The index of the first byte that is one of `set`. On `sve2`, `MATCH` tests for up to 16.
    #[inline(always)]
    pub(crate) fn find_any_of(self, within: &[impl Readable<u8>], set: &[u8]) -> Option<usize> {
        apart_unoptimized!(self.simd(), {
            macro_rules! up_to { ($first:literal $($i:literal)*) => {{
            let all = [self.set(set[$first]), $(self.set(set[$i.min(set.len() - 1)])),*];
            return self.find_if(Readable::source(within), #[inline(always)] |v| apart_unoptimized!(v.s, {
                // To join such masks takes long to compile.
                return_if!(crate::X86 && MaskOf::<u8, W, S>::BOTH, (v.equal_lanes(all[$first]) $(| v.equal_lanes(all[$i]))*).to_mask());
                v.simd_eq(all[$first]) $(| v.simd_eq(all[$i]))*
            }));
        }}; }
            // Zen 4 is slower at joining mask registers than at lookups, once the tables are made.
            if !S::HAS_MATCH && matches!(set.len(), 1..=4) && (S::REGISTER < 64 || within.len() <= 1024) {
                up_to!(0usize 1usize 2usize 3usize);
            }
            return_if!(S::BY_HAND || S::SCALAR, {
                if S::BY_HAND && matches!(set.len(), 5..=12) {
                    up_to!(0usize 1usize 2usize 3usize 4usize 5usize 6usize 7usize 8usize 9usize 10usize 11usize);
                }
                let mut members = [false; 256];
                for &byte in set {
                    members[byte as usize] = true;
                }
                within.iter().position(|byte| members[byte.value() as usize])
            });
            if !S::HAS_MATCH || set.len().wrapping_sub(1) >= 16 {
                return self.find_if(Readable::source(within), self.any_of(set));
            }
            live!(S::HAS_MATCH, {
                let (s, d) = (self.simd(), Tag::<S, u8, B16>::new(self.simd()));
                let set = d.load_n_or(set[0], set).raw.to_bytes();
                let (vectors, rest) = within.as_chunks::<16>();
                for (i, v) in vectors.iter().enumerate() {
                    if let Some(at) = s.first_match(d.load_any(v).raw.to_bytes(), set) {
                        return Some(16 * i + at);
                    }
                }
                let at = s.first_match(d.load_any_n(rest).raw.to_bytes(), set).filter(|&at| at < rest.len())?;
                Some(within.len() - rest.len() + at)
            })
        })
    }
}
