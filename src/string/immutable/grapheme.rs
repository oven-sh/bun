// Grapheme break implementation using uucode's approach.
// Includes GB9c (Indic Conjunct Break) support.
// Types and algorithm are self-contained; no runtime dependency on uucode.
// Tables are pre-generated and committed as grapheme_tables.rs.

use super::grapheme_tables;

/// Grapheme break property for codepoints, excluding control/CR/LF
/// which are assumed to be handled externally.
#[repr(u8)] // Zig: enum(u5) — Rust has no u5 repr; values fit in 5 bits
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum GraphemeBreakNoControl {
    Other,
    Prepend,
    RegionalIndicator,
    SpacingMark,
    L,
    V,
    T,
    Lv,
    Lvt,
    Zwj,
    Zwnj,
    ExtendedPictographic,
    EmojiModifierBase,
    EmojiModifier,
    // extend ==
    //   zwnj +
    //   indic_conjunct_break_extend +
    //   indic_conjunct_break_linker
    IndicConjunctBreakExtend,
    IndicConjunctBreakLinker,
    IndicConjunctBreakConsonant,
}

impl GraphemeBreakNoControl {
    const ALL: [Self; 17] = [
        Self::Other,
        Self::Prepend,
        Self::RegionalIndicator,
        Self::SpacingMark,
        Self::L,
        Self::V,
        Self::T,
        Self::Lv,
        Self::Lvt,
        Self::Zwj,
        Self::Zwnj,
        Self::ExtendedPictographic,
        Self::EmojiModifierBase,
        Self::EmojiModifier,
        Self::IndicConjunctBreakExtend,
        Self::IndicConjunctBreakLinker,
        Self::IndicConjunctBreakConsonant,
    ];
}

/// State maintained between sequential calls to grapheme_break.
#[repr(u8)] // Zig: enum(u3) — Rust has no u3 repr; values fit in 3 bits
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum BreakState {
    Default,
    RegionalIndicator,
    ExtendedPictographic,
    IndicConjunctBreakConsonant,
    IndicConjunctBreakLinker,
}

impl BreakState {
    #[inline]
    const fn from_raw(n: u8) -> Self {
        debug_assert!(n <= 4);
        // SAFETY: #[repr(u8)] enum with variants 0..=4; caller guarantees range.
        unsafe { core::mem::transmute::<u8, Self>(n) }
    }
}

/// 3-level lookup table for codepoint → element mapping.
/// stage1 maps high byte → stage2 offset (u16)
/// stage2 maps to stage3 index (u8, max 255 unique values)
/// stage3 stores the actual element values
pub struct Tables<Elem: 'static> {
    pub stage1: &'static [u16],
    pub stage2: &'static [u8],
    pub stage3: &'static [Elem],
}

impl<Elem: Copy + 'static> Tables<Elem> {
    #[inline]
    pub fn get(&self, cp: u32) -> Elem {
        // Zig: cp is u21; Rust uses u32 (caller must pass valid codepoint <= 0x10FFFF).
        let high = cp >> 8;
        let low = cp & 0xFF;
        self.stage3[self.stage2[self.stage1[high as usize] as usize + low as usize] as usize]
    }
}

// TODO(port): grapheme_tables is generated — re-run generator with .rs output.
pub use grapheme_tables::TABLE;

/// Determines if there is a grapheme break between two codepoints.
/// Must be called sequentially maintaining the state between calls.
///
/// This function does NOT handle control characters, line feeds, or
/// carriage returns. Those must be filtered out before calling.
pub fn grapheme_break(cp1: u32, cp2: u32, state: &mut BreakState) -> bool {
    let value = precompute::DATA[precompute::Key::new(
        grapheme_tables::TABLE.get(cp1),
        grapheme_tables::TABLE.get(cp2),
        *state,
    )
    .index()];
    *state = value.state();
    value.result()
}

/// Precomputed lookup table for all possible permutations of
/// state x grapheme_break_1 x grapheme_break_2.
/// 2^13 keys of 4-bit values = 8KB total.
mod precompute {
    use super::{
        compute_grapheme_break_no_control, BreakState, GraphemeBreakNoControl,
    };

    /// Zig: packed struct(u13) { state: u3, gb1: u5, gb2: u5 } (LSB-first field order).
    #[repr(transparent)]
    #[derive(Copy, Clone)]
    pub(super) struct Key(u16);

    impl Key {
        #[inline]
        pub(super) const fn new(
            gb1: GraphemeBreakNoControl,
            gb2: GraphemeBreakNoControl,
            state: BreakState,
        ) -> Self {
            Self((state as u16) | ((gb1 as u16) << 3) | ((gb2 as u16) << 8))
        }

        #[inline]
        pub(super) const fn index(self) -> usize {
            self.0 as usize
        }
    }

    /// Zig: packed struct(u4) { result: bool, state: u3 } (LSB-first field order).
    #[repr(transparent)]
    #[derive(Copy, Clone)]
    pub(super) struct Value(u8);

    impl Value {
        #[inline]
        const fn new(result: bool, state: BreakState) -> Self {
            Self((result as u8) | ((state as u8) << 1))
        }

        #[inline]
        pub(super) const fn result(self) -> bool {
            (self.0 & 1) != 0
        }

        #[inline]
        pub(super) const fn state(self) -> BreakState {
            BreakState::from_raw(self.0 >> 1)
        }
    }

    // Zig: std.math.maxInt(u13) + 1
    const DATA_LEN: usize = 1 << 13;

    pub(super) static DATA: [Value; DATA_LEN] = {
        let mut result = [Value(0); DATA_LEN];

        // Zig computed max enum field value via @typeInfo; here it's known: 4.
        let max_state_int: usize = 4;

        // PERF(port): was comptime (@setEvalBranchQuota); const-eval in Rust.
        let mut state_int: usize = 0;
        while state_int <= max_state_int {
            let mut i1 = 0;
            while i1 < GraphemeBreakNoControl::ALL.len() {
                let mut i2 = 0;
                while i2 < GraphemeBreakNoControl::ALL.len() {
                    let mut state = BreakState::from_raw(state_int as u8);

                    let gb1 = GraphemeBreakNoControl::ALL[i1];
                    let gb2 = GraphemeBreakNoControl::ALL[i2];
                    let key = Key::new(gb1, gb2, state);
                    let v = compute_grapheme_break_no_control(gb1, gb2, &mut state);
                    result[key.index()] = Value::new(v, state);

                    i2 += 1;
                }
                i1 += 1;
            }
            state_int += 1;
        }

        // Zig: bun.assert(@sizeOf(@TypeOf(result)) == 8192);
        const _: () = assert!(core::mem::size_of::<[Value; DATA_LEN]>() == 8192);
        result
    };
}

/// Core grapheme break algorithm including GB9c (Indic Conjunct Break).
/// Ported from uucode's computeGraphemeBreakNoControl.
const fn compute_grapheme_break_no_control(
    gb1: GraphemeBreakNoControl,
    gb2: GraphemeBreakNoControl,
    state: &mut BreakState,
) -> bool {
    use BreakState as S;
    use GraphemeBreakNoControl as G;

    // Set state back to default when gb1 or gb2 is not expected in sequence.
    match *state {
        S::RegionalIndicator => {
            if !matches!(gb1, G::RegionalIndicator) || !matches!(gb2, G::RegionalIndicator) {
                *state = S::Default;
            }
        }
        S::ExtendedPictographic => {
            match gb1 {
                G::IndicConjunctBreakExtend
                | G::IndicConjunctBreakLinker
                | G::Zwnj
                | G::Zwj
                | G::ExtendedPictographic
                | G::EmojiModifierBase
                | G::EmojiModifier => {}
                _ => *state = S::Default,
            }

            match gb2 {
                G::IndicConjunctBreakExtend
                | G::IndicConjunctBreakLinker
                | G::Zwnj
                | G::Zwj
                | G::ExtendedPictographic
                | G::EmojiModifierBase
                | G::EmojiModifier => {}
                _ => *state = S::Default,
            }
        }
        S::IndicConjunctBreakConsonant | S::IndicConjunctBreakLinker => {
            match gb1 {
                G::IndicConjunctBreakConsonant
                | G::IndicConjunctBreakLinker
                | G::IndicConjunctBreakExtend
                | G::Zwj => {}
                _ => *state = S::Default,
            }

            match gb2 {
                G::IndicConjunctBreakConsonant
                | G::IndicConjunctBreakLinker
                | G::IndicConjunctBreakExtend
                | G::Zwj => {}
                _ => *state = S::Default,
            }
        }
        S::Default => {}
    }

    // GB6: L x (L | V | LV | LVT)
    if matches!(gb1, G::L) {
        if matches!(gb2, G::L | G::V | G::Lv | G::Lvt) {
            return false;
        }
    }

    // GB7: (LV | V) x (V | T)
    if matches!(gb1, G::Lv | G::V) {
        if matches!(gb2, G::V | G::T) {
            return false;
        }
    }

    // GB8: (LVT | T) x T
    if matches!(gb1, G::Lvt | G::T) {
        if matches!(gb2, G::T) {
            return false;
        }
    }

    // Handle GB9 (Extend | ZWJ) later, since it can also match the start of
    // GB9c (Indic) and GB11 (Emoji ZWJ)

    // GB9a: SpacingMark
    if matches!(gb2, G::SpacingMark) {
        return false;
    }

    // GB9b: Prepend
    if matches!(gb1, G::Prepend) {
        return false;
    }

    // GB9c: Indic Conjunct Break
    if matches!(gb1, G::IndicConjunctBreakConsonant) {
        // start of sequence
        if is_indic_conjunct_break_extend(gb2) {
            *state = S::IndicConjunctBreakConsonant;
            return false;
        } else if matches!(gb2, G::IndicConjunctBreakLinker) {
            // jump straight to linker state
            *state = S::IndicConjunctBreakLinker;
            return false;
        }
        // else, not an Indic sequence
    } else if matches!(*state, S::IndicConjunctBreakConsonant) {
        // consonant state
        if matches!(gb2, G::IndicConjunctBreakLinker) {
            // consonant -> linker transition
            *state = S::IndicConjunctBreakLinker;
            return false;
        } else if is_indic_conjunct_break_extend(gb2) {
            // continue [extend]* sequence
            return false;
        } else {
            // Not a valid Indic sequence
            *state = S::Default;
        }
    } else if matches!(*state, S::IndicConjunctBreakLinker) {
        // linker state
        if matches!(gb2, G::IndicConjunctBreakLinker) || is_indic_conjunct_break_extend(gb2) {
            // continue [extend linker]* sequence
            return false;
        } else if matches!(gb2, G::IndicConjunctBreakConsonant) {
            // linker -> end of sequence
            *state = S::Default;
            return false;
        } else {
            // Not a valid Indic sequence
            *state = S::Default;
        }
    }

    // GB11: Emoji ZWJ sequence and Emoji modifier sequence
    if is_extended_pictographic(gb1) {
        // start of sequence
        if is_extend(gb2) || matches!(gb2, G::Zwj) {
            *state = S::ExtendedPictographic;
            return false;
        }

        // emoji_modifier_sequence: emoji_modifier_base emoji_modifier
        if matches!(gb1, G::EmojiModifierBase) && matches!(gb2, G::EmojiModifier) {
            *state = S::ExtendedPictographic;
            return false;
        }

        // else, not an Emoji ZWJ sequence
    } else if matches!(*state, S::ExtendedPictographic) {
        // continue or end sequence
        if (is_extend(gb1) || matches!(gb1, G::EmojiModifier))
            && (is_extend(gb2) || matches!(gb2, G::Zwj))
        {
            // continue extend* ZWJ sequence
            return false;
        } else if matches!(gb1, G::Zwj) && is_extended_pictographic(gb2) {
            // ZWJ -> end of sequence
            *state = S::Default;
            return false;
        } else {
            // Not a valid Emoji ZWJ sequence
            *state = S::Default;
        }
    }

    // GB12 and GB13: Regional Indicator
    if matches!(gb1, G::RegionalIndicator) && matches!(gb2, G::RegionalIndicator) {
        if matches!(*state, S::Default) {
            *state = S::RegionalIndicator;
            return false;
        } else {
            *state = S::Default;
            return true;
        }
    }

    // GB9: x (Extend | ZWJ)
    if is_extend(gb2) || matches!(gb2, G::Zwj) {
        return false;
    }

    // GB999: Otherwise, break everywhere
    true
}

const fn is_indic_conjunct_break_extend(gb: GraphemeBreakNoControl) -> bool {
    matches!(
        gb,
        GraphemeBreakNoControl::IndicConjunctBreakExtend | GraphemeBreakNoControl::Zwj
    )
}

const fn is_extend(gb: GraphemeBreakNoControl) -> bool {
    matches!(
        gb,
        GraphemeBreakNoControl::Zwnj
            | GraphemeBreakNoControl::IndicConjunctBreakExtend
            | GraphemeBreakNoControl::IndicConjunctBreakLinker
    )
}

const fn is_extended_pictographic(gb: GraphemeBreakNoControl) -> bool {
    matches!(
        gb,
        GraphemeBreakNoControl::ExtendedPictographic | GraphemeBreakNoControl::EmojiModifierBase
    )
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/string/immutable/grapheme.zig (331 lines)
//   confidence: medium
//   todos:      1
//   notes:      Precompute::DATA uses const-eval (&mut in const fn, stable 1.83+); packed u13/u4 → transparent u16/u8 with manual shifts (LSB-first); u21 cp → u32; grapheme_tables is generated (stub).
// ──────────────────────────────────────────────────────────────────────────
