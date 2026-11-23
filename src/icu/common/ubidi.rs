//! The Unicode Bidirectional Algorithm (UAX #9): the object, and the levels of a text. ICU4C: ubidi.cpp
//!
//! X9 removes nothing from the text: BN and the embedding codes are skipped. The trail unit of a surrogate pair has
//! the property of the code point, and the lead unit is BN.

use crate::common::arrayvec::ArrayVec;
use crate::common::memory::{
    Appendable, check_oom, try_collect, try_extend_from_slice, try_push, try_resize,
};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::ubidi_props::{
    ubidi_get_class, ubidi_get_class_from_single_unit, ubidi_get_paired_bracket,
    ubidi_get_paired_bracket_type,
};
use crate::common::ubidi_tables::{self as tables, Action, ImpTab, reduced};
use crate::common::ubidiln::Runs;
use crate::common::unicode::uchar::{U_BPT_CLOSE, U_BPT_OPEN};
use crate::common::utf16;
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, U_MEMORY_ALLOCATION_ERROR, UErrorCode};
use std::mem::replace;

/// An embedding level. Until the implicit rules have run, bit 7 is `UBIDI_LEVEL_OVERRIDE`.
pub(crate) type UBiDiLevel = u8;

const MAX_EXPLICIT_LEVEL: UBiDiLevel = 125;
const DEFAULT_LTR: UBiDiLevel = 0xfe;
// ICU4C: ubidi.cpp, ubidi_getMemory. An array has at most `INT32_MAX` bytes, and a run has 12.
pub(crate) const MAX_RUN_COUNT: usize = i32::MAX as usize / 12;
// ICU4C: ubidi.cpp, checkParaCount. It allocates twice the number of paragraphs, 8 bytes each.
const MAX_PARA_COUNT: usize = i32::MAX as usize / 16;
// ICU4C: ubidiimp.h. It needs no memory for so many.
const SIMPLE_PARAS_COUNT: usize = 10;
const LEVEL_OVERRIDE: UBiDiLevel = 0x80;

/// A CR before an LF does not end a paragraph.
fn is_cr_before_lf(text: &[u16], i: usize) -> bool {
    text.get(i..i + 2) == Some(&[0x0d, 0x0a])
}

/// Returns true for `UBIDI_DEFAULT_LTR` and `UBIDI_DEFAULT_RTL`. Bit 0 is the level if no character is strong.
fn is_default_level(level: UBiDiLevel) -> bool {
    level >= DEFAULT_LTR
}

fn no_override(level: UBiDiLevel) -> UBiDiLevel {
    level & !LEVEL_OVERRIDE
}

/// Bidi_Class, with the values of `UCharDirection`, and two more for European numbers whose context is known.
#[expect(clippy::upper_case_acronyms)]
#[derive(Clone, Copy, PartialEq, Default)]
#[repr(u8)]
enum DirProp {
    L,
    R,
    EN,
    ES,
    ET,
    AN,
    CS,
    B,
    S,
    WS,
    #[default]
    ON,
    LRE,
    LRO,
    AL,
    RLE,
    RLO,
    PDF,
    NSM,
    BN,
    FSI,
    LRI,
    RLI,
    PDI,
    /// EN after W7
    ENL,
    /// EN not subject to W7
    ENR,
}

use DirProp::*;

/// A set of `DirProp`s.
type Flags = u32;

impl DirProp {
    /// Indexed by the five bits of a class in the data.
    const ALL: [Self; 32] = [
        L, R, EN, ES, ET, AN, CS, B, S, WS, ON, LRE, LRO, AL, RLE, RLO, PDF, NSM, BN, FSI, LRI,
        RLI, PDI, ENL, ENR, ON, ON, ON, ON, ON, ON, ON,
    ];

    fn from_code_point(c: u32) -> Self {
        Self::ALL.at(ubidi_get_class(c) as usize % Self::ALL.len())
    }

    /// `unit` is not a lead surrogate.
    #[inline]
    fn from_single_unit(unit: u16) -> Self {
        Self::ALL.at(ubidi_get_class_from_single_unit(unit) as usize % Self::ALL.len())
    }

    fn from_level(level: UBiDiLevel) -> Self {
        if level & 1 == 0 { L } else { R }
    }

    const fn flag(self) -> Flags {
        1 << self as u32
    }

    fn is_in(self, mask: Flags) -> bool {
        self.flag() & mask != 0
    }
}

const MASK_LTR: Flags = L.flag()
    | EN.flag()
    | ENL.flag()
    | ENR.flag()
    | AN.flag()
    | LRE.flag()
    | LRO.flag()
    | LRI.flag();
const MASK_RTL: Flags = R.flag() | AL.flag() | RLE.flag() | RLO.flag() | RLI.flag();
const MASK_R_AL: Flags = R.flag() | AL.flag();
const MASK_STRONG: Flags = L.flag() | MASK_R_AL;
const MASK_EXPLICIT: Flags = LRE.flag() | LRO.flag() | RLE.flag() | RLO.flag() | PDF.flag();
const MASK_ISO: Flags = LRI.flag() | RLI.flag() | FSI.flag() | PDI.flag();
const MASK_BN_EXPLICIT: Flags = BN.flag() | MASK_EXPLICIT;
const MASK_B_S: Flags = B.flag() | S.flag();
const MASK_WS: Flags = MASK_B_S | WS.flag() | MASK_BN_EXPLICIT | MASK_ISO;
const MASK_POSSIBLE_N: Flags = ON.flag() | CS.flag() | ES.flag() | ET.flag() | MASK_WS;
/// The properties that may take the embedding direction (N2).
const MASK_EMBEDDING: Flags = NSM.flag() | MASK_POSSIBLE_N;

fn flag_lr(level: UBiDiLevel) -> Flags {
    DirProp::from_level(level).flag()
}

// ICU4C: ubidi.cpp, DIRPROP_FLAG_E and DIRPROP_FLAG_O. LRO and RLO are in the same masks as LRE and RLE.
fn flag_e(level: UBiDiLevel) -> Flags {
    if level & 1 == 0 {
        LRE.flag()
    } else {
        RLE.flag()
    }
}

#[derive(Clone, Copy, PartialEq, Default)]
pub(crate) enum Direction {
    #[default]
    Ltr,
    Rtl,
    Mixed,
}

/// Stores the properties from `*i` on and adds them to `flags`. Stops after the first that is in `mask` and returns
/// it, or returns `None` at the end of the text.
#[inline]
fn classify_until(
    text: &[u16],
    mask: Flags,
    dir_props: &mut [DirProp],
    i: &mut usize,
    flags: &mut Flags,
) -> Option<DirProp> {
    loop {
        while let (Some(&unit), Some(slot)) = (text.get(*i), dir_props.get_mut(*i))
            && !utf16::is_lead(unit.into())
        {
            *slot = DirProp::from_single_unit(unit);
            *flags |= slot.flag();
            *i += 1;
            if slot.is_in(mask) {
                return Some(*slot);
            }
        }
        if *i >= text.len() {
            return None;
        }
        let c = utf16::next(text, i);
        let dir_prop = DirProp::from_code_point(c);
        *flags |= dir_prop.flag();
        dir_props.set(*i - 1, dir_prop);
        if c > 0xffff {
            *flags |= BN.flag();
            dir_props.set(*i - 2, BN);
        }
        if dir_prop.is_in(mask) {
            return Some(dir_prop);
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Para {
    limit: u32,
    level: UBiDiLevel,
}

impl Para {
    fn limit(self) -> usize {
        self.limit as usize
    }
}

enum Paras {
    Few(ArrayVec<Para, SIMPLE_PARAS_COUNT>),
    Many(Vec<Para>),
}

impl Default for Paras {
    fn default() -> Self {
        Self::Few(ArrayVec::new())
    }
}

impl Paras {
    #[inline]
    fn as_slice(&self) -> &[Para] {
        match self {
            Self::Few(list) => list,
            Self::Many(list) => list,
        }
    }

    /// Requires a paragraph.
    #[inline]
    fn first_limit(&self) -> usize {
        match self {
            Self::Few(list) => list.units[0].limit(),
            Self::Many(list) => list.at(0).limit(),
        }
    }

    /// Keeps the memory.
    fn clear(&mut self) {
        match self {
            Self::Few(list) => list.clear(),
            Self::Many(list) => list.clear(),
        }
    }

    fn push(&mut self, para: Para) -> Result<(), UErrorCode> {
        match self {
            Self::Few(list) => {
                if !list.push(para) {
                    *self = Self::Many(try_collect(list.iter().copied().chain([para]))?);
                }
            }
            Self::Many(list) => try_push(list, para)?,
        }
        Ok(())
    }

    /// Iterates over the starts, limits and levels. They cover exactly the text.
    fn with_starts(&self) -> impl Iterator<Item = (usize, usize, UBiDiLevel)> {
        let mut start = 0;
        self.as_slice()
            .iter()
            .map(move |&para| (replace(&mut start, para.limit()), para.limit(), para.level))
    }
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Run {
    pub(crate) logical_start: usize,
    pub(crate) is_odd: bool,
    /// Read only while the runs are reordered.
    pub(crate) level: UBiDiLevel,
    pub(crate) visual_limit: usize,
}

#[derive(Default)]
pub(crate) struct UBiDi {
    /// False if there is no text yet, or if the last `set_para` failed.
    is_valid: bool,
    pub(super) length: usize,
    dir_props: Vec<DirProp>,
    /// Valid if the direction is mixed.
    pub(super) levels: Vec<UBiDiLevel>,
    pub(super) para_level: UBiDiLevel,
    /// The level of each paragraph is computed from its text.
    default_para_level: bool,
    pub(super) direction: Direction,
    paras: Paras,
    pub(super) runs: Runs,
    /// Scratch buffers of `set_para`, reused for the next text.
    bracket_lists: BracketLists,
    isolates: Vec<Isolate>,
}

impl UBiDi {
    pub(crate) fn is_valid(&self) -> bool {
        self.is_valid
    }

    pub(crate) fn get_result_length(&self) -> usize {
        if self.is_valid { self.length } else { 0 }
    }

    // ICU4C: ubidiimp.h, GET_PARALEVEL
    #[inline]
    fn para_level_at(&self, index: usize) -> UBiDiLevel {
        if self.default_para_level && index >= self.paras.first_limit() {
            self.search_para_level(index)
        } else {
            self.para_level
        }
    }

    fn search_para_level(&self, index: usize) -> UBiDiLevel {
        let paras = self.paras.as_slice();
        paras
            .get(paras.partition_point(|para| para.limit() <= index))
            .map(|para| para.level)
            .soft_unwrap()
    }

    pub(crate) fn check_para_level(para_level: UBiDiLevel) -> Result<(), UErrorCode> {
        if para_level > MAX_EXPLICIT_LEVEL && !is_default_level(para_level) {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        Ok(())
    }

    /// Returns the copy as `set_para` has changed it, also after a failure, for the caller's array.
    pub(crate) fn embedding_levels(&self) -> &[UBiDiLevel] {
        &self.levels
    }

    /// Requires that `para_level` has passed `check_para_level`. `embedding_levels` is as long as the text, which has
    /// at most `INT32_MAX` units.
    // ICU4C: ubidi.cpp, ubidi_setPara
    pub(crate) fn set_para(
        &mut self,
        text: &[u16],
        para_level: UBiDiLevel,
        embedding_levels: Option<&[UBiDiLevel]>,
    ) -> Result<(), UErrorCode> {
        debug_assert!(Self::check_para_level(para_level).is_ok());
        self.is_valid = false;
        self.paras.clear();
        if embedding_levels.is_some() {
            self.levels.clear();
        }
        self.length = text.len();
        self.para_level = para_level;
        self.runs.clear();
        self.default_para_level = is_default_level(para_level);

        if self.length == 0 {
            self.runs.set(Vec::new());
            self.is_valid = true;
            return Ok(());
        }

        let mut resolve_state = self.get_dir_props(text)?;
        // A B is at the end of its paragraph.
        let only_trailing_ws = resolve_state.flags & (S.flag() | MASK_BN_EXPLICIT) == 0;
        if let Some(given) = embedding_levels {
            try_extend_from_slice(&mut self.levels, given)?;
            self.check_explicit_levels(&mut resolve_state)?;
        } else {
            try_resize(&mut self.levels, self.length, 0)?;
            self.resolve_explicit_levels(text, &mut resolve_state)?;
        }

        self.direction = direction_from_flags(resolve_state.flags);
        if self.direction == Direction::Mixed {
            self.resolve_implicit_rules(resolve_state.is_one_run);
            // Observable: an unmatched initiator or PDI becomes WS without an update of the flags.
            if resolve_state.flags & MASK_WS != 0 {
                self.adjust_ws_levels(only_trailing_ws);
            }
        }
        check_oom()?;
        self.init_single_run();
        self.is_valid = true;
        Ok(())
    }

    // P2, P3, X5c

    /// Computes the properties, the paragraphs and their levels. An FSI becomes LRI, or RLI if its first strong
    /// character is R or AL.
    // ICU4C: ubidi.cpp, getDirProps
    fn get_dir_props(&mut self, text: &[u16]) -> Result<ResolveState, UErrorCode> {
        /// The item that the next strong character resolves. 32 bits, so that `memset` can initialize the stack.
        #[derive(Clone, Copy, PartialEq)]
        #[repr(u32)]
        enum Seeking {
            Nothing,
            Para,
            Fsi,
        }

        let length = text.len();
        if self.dir_props.len() < length {
            try_resize(&mut self.dir_props, length, ON)?;
        }
        let (dir_props, paras) = (self.dir_props.slice_mut(..length), &mut self.paras);

        let (initial_level, initial_seeking) = if self.default_para_level {
            (self.para_level & 1, Seeking::Para)
        } else {
            (self.para_level, Seeking::Nothing)
        };
        let (mut level, mut seeking) = (initial_level, initial_seeking);
        // The position of each open initiator, and the state before it.
        let mut isolates = Stack::new((0u32, Seeking::Nothing));
        // The properties that can change the state.
        let relevant_props_for = |seeking| {
            MASK_ISO
                | B.flag()
                | if seeking != Seeking::Nothing {
                    MASK_STRONG
                } else {
                    0
                }
        };

        let (mut flags, mut relevant_props) = (0, relevant_props_for(seeking));
        let mut i = 0;
        while let Some(dir_prop) =
            classify_until(text, relevant_props, dir_props, &mut i, &mut flags)
        {
            match dir_prop {
                L | R | AL => {
                    let is_r = dir_prop != L;
                    match replace(&mut seeking, Seeking::Nothing) {
                        Seeking::Nothing => continue,
                        Seeking::Para => level = is_r.into(),
                        Seeking::Fsi => {
                            if let Some((initiator, _)) = isolates.last().filter(|_| is_r) {
                                dir_props.set(initiator as usize, RLI);
                            }
                        }
                    }
                }
                LRI | RLI | FSI => {
                    isolates.push((i as u32 - 1, seeking));
                    seeking = Seeking::Nothing;
                    if dir_prop == FSI {
                        dir_props.set(i - 1, LRI);
                        seeking = Seeking::Fsi;
                    }
                }
                PDI => {
                    if let Some((_, outer)) = isolates.pop() {
                        if seeking == Seeking::Fsi {
                            flags |= LRI.flag();
                        }
                        seeking = outer;
                    }
                }
                // B
                _ if is_cr_before_lf(text, i - 1) => {}
                _ => {
                    paras.push(Para {
                        limit: i as u32,
                        level,
                    })?;
                    if i < length {
                        if paras.as_slice().len() >= MAX_PARA_COUNT {
                            return Err(U_MEMORY_ALLOCATION_ERROR);
                        }
                        (level, seeking) = (initial_level, initial_seeking);
                        isolates.depth = 0;
                    }
                }
            }
            relevant_props = relevant_props_for(seeking);
        }
        // An open FSI without a strong character, or an overflow of the stack.
        let has_open_fsi =
            |open: &[(u32, Seeking)]| open.iter().any(|&(_, outer)| outer == Seeking::Fsi);
        if seeking == Seeking::Fsi
            || isolates
                .entries
                .get(..isolates.depth)
                .is_none_or(has_open_fsi)
        {
            flags |= LRI.flag();
        }

        if paras
            .as_slice()
            .last()
            .is_none_or(|para| para.limit() < length)
        {
            paras.push(Para {
                limit: length as u32,
                level,
            })?;
        }
        let paras = paras.as_slice();
        self.para_level = paras.first().map_or(level, |para| para.level);
        flags = paras
            .iter()
            .fold(flags, |flags, para| flags | flag_lr(para.level));
        Ok(ResolveState {
            flags,
            is_one_run: false,
        })
    }

    // X1 to X9

    // ICU4C: ubidi.cpp, resolveExplicitLevels
    fn resolve_explicit_levels(
        &mut self,
        text: &[u16],
        resolve_state: &mut ResolveState,
    ) -> Result<(), UErrorCode> {
        if direction_from_flags(resolve_state.flags) != Direction::Mixed {
            return Ok(());
        }
        let applies_codes = resolve_state.flags & (MASK_EXPLICIT | MASK_ISO) != 0;
        if !applies_codes {
            resolve_state.is_one_run = self.paras.as_slice().len() <= 1;
            for (start, limit, level) in self.paras.with_starts() {
                self.levels.slice_mut(start..limit).fill(level);
            }
        }
        let mut brackets = Brackets::new(
            text,
            &mut self.dir_props,
            &mut self.levels,
            &mut self.bracket_lists,
        );
        if !applies_codes {
            for (start, limit, level) in self.paras.with_starts() {
                brackets.begin_para(level);
                let mut i = start;
                while i < limit {
                    let dir_prop = brackets.dir_props.at(i);
                    if dir_prop.is_in(MASK_STRONG) {
                        // A repetition overwrites what the unit before it has recorded.
                        i = skip_equal(brackets.dir_props.slice(..limit), i + 1, dir_prop) - 1;
                    }
                    if !matches!(dir_prop, BN | B) {
                        brackets.process_char(i, dir_prop, level)?;
                    }
                    i += 1;
                }
            }
            return Ok(());
        }
        resolve_state.flags = apply_explicit_codes(&mut brackets, self.paras.with_starts())?;
        if resolve_state.flags & MASK_EMBEDDING != 0 {
            resolve_state.flags |= flag_lr(self.para_level);
        }
        Ok(())
    }

    /// Checks the caller's levels. 0 means the paragraph level, except at a separator.
    // ICU4C: ubidi.cpp, checkExplicitLevels
    fn check_explicit_levels(
        &mut self,
        resolve_state: &mut ResolveState,
    ) -> Result<(), UErrorCode> {
        let mut flags = 0;
        for (start, limit, para_level) in self.paras.with_starts() {
            for (slot, &dir_prop) in self
                .levels
                .slice_mut(start..limit)
                .iter_mut()
                .zip(self.dir_props.slice(start..))
            {
                let level = no_override(*slot);
                if level == 0 {
                    if dir_prop != B {
                        *slot |= para_level;
                    }
                } else if !(para_level..=MAX_EXPLICIT_LEVEL).contains(&level) {
                    return Err(U_ILLEGAL_ARGUMENT_ERROR);
                }
                flags |= flag_e(*slot);
                if *slot & LEVEL_OVERRIDE == 0 {
                    flags |= dir_prop.flag();
                }
            }
        }
        if flags & MASK_EMBEDDING != 0 {
            flags |= flag_lr(self.para_level);
        }
        resolve_state.flags = flags;
        Ok(())
    }

    // W1 to W7, N1, N2, I1, I2

    // ICU4C: ubidi.cpp, ubidi_setPara, the loop over the level runs
    fn resolve_implicit_rules(&mut self, is_one_run: bool) {
        let length = self.length;
        self.isolates.clear();
        let mut limit = 0;
        let mut next_level = self.levels.at(0);
        let mut eor = self.para_level.max(next_level) & 1;
        while limit < length {
            let (start, level) = (limit, next_level);
            let begins_para = self.dir_props.get(start.wrapping_sub(1)) == Some(&B);
            let sor = if begins_para {
                self.para_level_at(start) & 1
            } else {
                eor
            };
            limit = if is_one_run { length } else { start + 1 };
            while limit < length
                && (self.levels.at(limit) == level
                    || self.dir_props.at(limit).is_in(MASK_BN_EXPLICIT))
            {
                limit += 1;
            }
            next_level = if limit < length {
                self.levels.at(limit)
            } else {
                self.para_level_at(length - 1)
            };
            eor = no_override(level).max(no_override(next_level)) & 1;
            if level & LEVEL_OVERRIDE == 0 {
                self.resolve_implicit_levels(start, limit, sor, eor);
            } else {
                self.levels
                    .slice_mut(start..limit)
                    .iter_mut()
                    .for_each(|level| *level = no_override(*level));
            }
        }
    }

    /// Resolves one level run. `sor` and `eor` are `reduced::L` (0) or `reduced::R` (1).
    // ICU4C: ubidi.cpp, resolveImplicitLevels
    fn resolve_implicit_levels(&mut self, start: usize, limit: usize, sor: u8, eor: u8) {
        let run_level = self.levels.at(start);
        let [for_even, for_odd] = tables::DEFAULT;
        let mut run = LevState {
            imp_tab: if run_level & 1 == 0 {
                for_even
            } else {
                for_odd
            },
            run_start: start,
            run_level,
            state: 0,
            start_on: None,
            start1: start,
            start2: start,
        };
        let first = self.dir_props.at(start);
        let mut state_imp = if let Some(isolate) = self.isolates.pop_if(|_| first == PDI) {
            (run.state, run.start_on, run.start1) =
                (isolate.state, isolate.start_on, isolate.start1);
            isolate.state_imp
        } else {
            self.process_property_seq(&mut run, sor, start, start);
            if first == NSM { 1 + sor } else { 0 }
        };

        let mut i = start;
        while i < limit {
            let dir_prop = self.dir_props.at(i);
            if dir_prop == B {
                self.isolates.clear();
            }
            let cell = tables::props_cell(state_imp, tables::GROUP_PROP.at(dir_prop as usize));
            if tables::action(cell) != 0 {
                self.process_sequences(&mut run, tables::action(cell), state_imp, i);
            }
            state_imp = tables::state(cell);
            i += 1;
            if dir_prop.is_in(MASK_STRONG) {
                // A repetition has no action and keeps the state.
                i = skip_equal(self.dir_props.slice(..limit), i, dir_prop);
            }
        }

        let last = self
            .dir_props
            .slice(start..limit)
            .iter()
            .rfind(|last| !last.is_in(MASK_BN_EXPLICIT));
        let is_interrupted = matches!(last, Some(LRI | RLI));
        if !is_interrupted {
            let action = tables::action(tables::props_cell(state_imp, eor)).max(1);
            self.process_sequences(&mut run, action, state_imp, limit);
        }
        if is_interrupted && limit < self.length {
            self.isolates.add(Isolate {
                start_on: run.start_on,
                start1: run.start1,
                state: run.state,
                state_imp,
            });
        } else {
            self.process_property_seq(&mut run, eor, limit, limit);
        }
    }

    /// Runs `action` of the properties table at position `i`, from state `state_imp`. 1 ends the sequence, 2 begins a
    /// second sequence, 3 ends both, 4 ends the first, makes the second the first and begins a new second.
    #[inline(always)]
    fn process_sequences(&mut self, run: &mut LevState, action: u8, state_imp: u8, i: usize) {
        let (start1, start2) = (run.start1, replace(&mut run.start2, i));
        if action == 2 {
            return;
        }
        self.process_property_seq(
            run,
            tables::res_prop(state_imp),
            start1,
            if action == 1 { i } else { start2 },
        );
        if action == 3 {
            self.process_property_seq(run, reduced::ON, start2, i);
        }
        run.start1 = if action == 4 { start2 } else { i };
    }

    /// Sets the levels for `start0..limit`, which has the reduced property `prop`.
    // ICU4C: ubidi.cpp, processPropertySeq
    fn process_property_seq(&mut self, run: &mut LevState, prop: u8, start0: usize, limit: usize) {
        let start_on = run.start_on.unwrap_or(start0);
        let cell = run.imp_tab.cell(run.state, prop);
        run.state = tables::state(cell);
        let (run_level, level) = (
            run.run_level,
            run.run_level + run.imp_tab.add_level(run.state),
        );
        let mut start = start0;

        match run.imp_tab.action(cell) {
            Action::None => {}
            Action::InitOnSeq => run.start_on = Some(start0),
            Action::PrependOnSeq => start = start_on,
            Action::NumberAfterROn => {
                self.set_levels_outside_isolates(start_on, start0, run_level + 1)
            }
        }
        if level != run_level || start < start0 {
            if start >= run.run_start {
                self.levels.slice_mut(start..limit).fill(level);
            } else {
                self.set_levels_outside_isolates(start, limit, level);
            }
        }
    }

    fn set_levels_outside_isolates(&mut self, start: usize, limit: usize, level: UBiDiLevel) {
        let mut isolate_count = 0isize;
        for (slot, &dir_prop) in self
            .levels
            .slice_mut(start..limit)
            .iter_mut()
            .zip(self.dir_props.slice(start..))
        {
            isolate_count -= isize::from(dir_prop == PDI);
            if isolate_count == 0 {
                *slot = level;
            }
            isolate_count += isize::from(matches!(dir_prop, LRI | RLI));
        }
    }

    /// Applies L1. A unit that X9 would remove gets the level of the next unit. `only_trailing_ws`: no other unit than
    /// the white space at the end of a paragraph can change.
    // ICU4C: ubidi.cpp, adjustWSLevels
    fn adjust_ws_levels(&mut self, only_trailing_ws: bool) {
        for (start, limit, para_level) in self.paras.with_starts() {
            let (mut reset_mask, mut next_level) = (MASK_WS, para_level);
            let units = self
                .levels
                .slice_mut(start..limit)
                .iter_mut()
                .zip(self.dir_props.slice(start..limit));
            for (level, &dir_prop) in units.rev() {
                if dir_prop.is_in(reset_mask) {
                    *level = para_level;
                    reset_mask = MASK_WS;
                } else if only_trailing_ws {
                    break;
                } else {
                    if dir_prop.is_in(MASK_BN_EXPLICIT) {
                        *level = next_level;
                    }
                    reset_mask = MASK_B_S;
                }
                next_level = *level;
            }
        }
    }
}

/// An inline stack with an entry for each explicit level. Further entries are only counted.
struct Stack<T> {
    entries: [T; MAX_EXPLICIT_LEVEL as usize + 1],
    depth: usize,
}

impl<T: Copy> Stack<T> {
    fn new(filler: T) -> Self {
        Self {
            entries: [filler; MAX_EXPLICIT_LEVEL as usize + 1],
            depth: 0,
        }
    }

    fn push(&mut self, entry: T) {
        if let Some(slot) = self.entries.get_mut(self.depth) {
            *slot = entry;
        }
        self.depth += 1;
    }

    fn last(&self) -> Option<T> {
        self.entries.get(self.depth.wrapping_sub(1)).copied()
    }

    fn pop(&mut self) -> Option<T> {
        let last = self.last();
        self.depth = self.depth.saturating_sub(1);
        last
    }
}

fn direction_from_flags(flags: Flags) -> Direction {
    // Neutrals between Arabic numbers become RTL.
    if !(flags & MASK_RTL != 0 || (flags & AN.flag() != 0 && flags & MASK_POSSIBLE_N != 0)) {
        Direction::Ltr
    } else if flags & MASK_LTR == 0 {
        Direction::Rtl
    } else {
        Direction::Mixed
    }
}

/// Returns the first index from `i` on whose element is not `value`, or the length.
#[inline]
pub(crate) fn skip_equal<T: Copy + PartialEq>(slice: &[T], mut i: usize, value: T) -> usize {
    while slice.get(i) == Some(&value) {
        i += 1;
    }
    i
}

/// Returns the least odd or even level greater than `level`.
fn next_level(level: UBiDiLevel, is_odd: bool) -> UBiDiLevel {
    if is_odd {
        (no_override(level) + 1) | 1
    } else {
        (no_override(level) + 2) & !1
    }
}

/// Applies X1 to X8 and N0. Returns the recomputed flags.
// ICU4C: ubidi.cpp, resolveExplicitLevels, the last part
// Not inlined: only a text with explicit codes needs the large stack frame.
#[inline(never)]
fn apply_explicit_codes(
    brackets: &mut Brackets<'_>,
    paras: impl Iterator<Item = (usize, usize, UBiDiLevel)>,
) -> Result<Flags, UErrorCode> {
    /// The state that a PDI restores.
    #[derive(Clone, Copy)]
    struct OuterState {
        level: UBiDiLevel,
        embedding_depth: usize,
        iso_run: IsoRun,
    }

    // Each push raises the level, so the stacks do not overflow.
    let mut embeddings = Stack::new(0);
    let mut isolates = Stack::<Option<OuterState>>::new(None);
    let mut flags = 0;
    for (start, limit, para_level) in paras {
        brackets.begin_para(para_level);
        (embeddings.depth, isolates.depth) = (0, 0);
        let (mut overflow_embedding_count, mut overflow_isolate_count) = (0usize, 0usize);
        // Both may have the override bit. `previous_level` belongs to the last unit that X9 does not remove.
        let (mut embedding_level, mut previous_level) = (para_level, para_level);

        for i in start..limit {
            let dir_prop = brackets.dir_props.at(i);
            if dir_prop.is_in(MASK_BN_EXPLICIT) {
                flags |= BN.flag();
                brackets.levels.set(i, previous_level);
                if dir_prop == BN || overflow_isolate_count > 0 {
                    continue;
                }
                if dir_prop != PDF {
                    let new_level = next_level(embedding_level, matches!(dir_prop, RLE | RLO));
                    if new_level <= MAX_EXPLICIT_LEVEL && overflow_embedding_count == 0 {
                        embeddings.push(embedding_level);
                        embedding_level = new_level
                            | if matches!(dir_prop, LRO | RLO) {
                                LEVEL_OVERRIDE
                            } else {
                                0
                            };
                    } else {
                        overflow_embedding_count += 1;
                    }
                } else if overflow_embedding_count > 0 {
                    overflow_embedding_count -= 1;
                } else if embeddings.depth
                    > isolates
                        .last()
                        .flatten()
                        .map_or(0, |outer| outer.embedding_depth)
                {
                    embedding_level = embeddings.pop().soft_unwrap();
                }
                continue;
            }
            if dir_prop == B {
                flags |= B.flag();
                brackets.levels.set(i, para_level);
                continue;
            }

            let is_boundary = no_override(embedding_level) != no_override(previous_level);
            if is_boundary {
                brackets.process_boundary(previous_level, embedding_level);
            }
            match dir_prop {
                LRI | RLI => {
                    flags |= ON.flag() | flag_lr(embedding_level);
                    brackets.levels.set(i, no_override(embedding_level));
                    previous_level = embedding_level;
                    let new_level = next_level(embedding_level, dir_prop == RLI);
                    if new_level <= MAX_EXPLICIT_LEVEL
                        && overflow_isolate_count == 0
                        && overflow_embedding_count == 0
                    {
                        flags |= dir_prop.flag();
                        let iso_run = brackets.begin_isolate(new_level);
                        isolates.push(Some(OuterState {
                            level: embedding_level,
                            embedding_depth: embeddings.depth,
                            iso_run,
                        }));
                        embedding_level = new_level;
                    } else {
                        brackets.dir_props.set(i, WS);
                        overflow_isolate_count += 1;
                    }
                }
                PDI => {
                    if overflow_isolate_count > 0 {
                        overflow_isolate_count -= 1;
                        brackets.dir_props.set(i, WS);
                    } else if let Some(outer) = isolates.pop().flatten() {
                        flags |= PDI.flag();
                        overflow_embedding_count = 0;
                        (embedding_level, embeddings.depth) = (outer.level, outer.embedding_depth);
                        brackets.end_isolate(outer.iso_run);
                    } else {
                        brackets.dir_props.set(i, WS);
                    }
                    flags |= ON.flag() | flag_lr(embedding_level);
                    brackets.levels.set(i, no_override(embedding_level));
                    previous_level = embedding_level;
                }
                _ => {
                    if is_boundary {
                        flags |= flag_e(embedding_level);
                    }
                    previous_level = embedding_level;
                    brackets.levels.set(i, embedding_level);
                    brackets.process_char(i, dir_prop, embedding_level)?;
                    flags |= brackets.dir_props.at(i).flag();
                }
            }
        }
    }
    Ok(flags)
}

/// The state of one call of `set_para`.
struct ResolveState {
    flags: Flags,
    /// The whole text is known to have one embedding level.
    is_one_run: bool,
}

/// The state saved at an isolate initiator and resumed at the matching PDI.
struct Isolate {
    start_on: Option<usize>,
    start1: usize,
    state: u8,
    state_imp: u8,
}

/// The state of both state machines within a level run.
struct LevState {
    imp_tab: &'static ImpTab,
    run_start: usize,
    /// At most 125: a run with an override is not resolved.
    run_level: UBiDiLevel,
    state: u8,
    start_on: Option<usize>,
    /// The starts of the pending sequences of the properties table.
    start1: usize,
    start2: usize,
}

// Paired brackets (N0)

/// An opening bracket that is not matched yet, or whose pair may still change its direction.
/// Indexes fit `u32`: a text has at most `INT32_MAX` units, and a unit at most two entries.
#[derive(Clone, Copy, Default)]
struct Opening {
    position: u32,
    /// The closing character, or minus the position of the closing bracket, or 0 for a neutralized entry.
    matching: i32,
    /// The position of the last strong character before the bracket.
    context_pos: u32,
    context_dir: DirProp,
    /// Index into `heads`.
    head: u16,
    /// The next lower entry for the same character: index + 1, or 0.
    next: u32,
}

impl Opening {
    fn position(&self) -> usize {
        self.position as usize
    }
}

/// The head of the list of entries for one closing character.
#[derive(Clone, Copy, Default)]
struct ListHead {
    closing: u16,
    /// The highest entry that may still be unmatched: index + 1, or 0.
    first: u32,
}

impl ListHead {
    fn index(self) -> Option<usize> {
        (self.first as usize).checked_sub(1)
    }
}

#[derive(Default)]
struct BracketLists {
    /// One stack for all depths of isolates.
    openings: Vec<Opening>,
    heads: Vec<ListHead>,
    /// The worklist of `fix_n0c`: the first entry to scan, and the position that has the new property.
    pending: Vec<(usize, usize)>,
}

/// The state at one depth of isolates.
#[derive(Clone, Copy)]
struct IsoRun {
    /// The range of entries in `openings`.
    start: usize,
    limit: usize,
    /// Entries below index `[0]` have ICU4C's flag `FOUND_L`, entries below index `[1]` have `FOUND_R`.
    found_limit: [usize; 2],
    /// The embedding direction.
    direction: DirProp,
    last_strong: DirProp,
    last_base: DirProp,
    context_dir: DirProp,
    context_pos: usize,
}

impl IsoRun {
    fn new(start: usize, level: UBiDiLevel) -> Self {
        let dir = DirProp::from_level(level);
        Self {
            start,
            limit: start,
            found_limit: [start; 2],
            direction: dir,
            last_strong: dir,
            last_base: dir,
            context_dir: dir,
            context_pos: 0,
        }
    }
}

/// Bracket matching in linear time. The number of open brackets is not limited.
///
/// A strong character flags all entries before it, so the flagged entries are a prefix (`IsoRun::found_limit`).
/// The entries for one closing character form a linked list in descending order (`heads`, `Opening::next`).
/// Invariant: each unmatched entry below `iso_run.limit` is in its list, and no list has an entry at or above the
/// limit. Matched and neutralized entries are unlinked when a search passes them.
// ICU4C: ubidi.cpp, BracketData and the functions bracket*
struct Brackets<'a> {
    text: &'a [u16],
    dir_props: &'a mut [DirProp],
    levels: &'a mut [UBiDiLevel],
    openings: &'a mut Vec<Opening>,
    heads: &'a mut Vec<ListHead>,
    pending: &'a mut Vec<(usize, usize)>,
    iso_run: IsoRun,
}

impl<'a> Brackets<'a> {
    fn new(
        text: &'a [u16],
        dir_props: &'a mut [DirProp],
        levels: &'a mut [UBiDiLevel],
        BracketLists {
            openings,
            heads,
            pending,
        }: &'a mut BracketLists,
    ) -> Self {
        Self {
            text,
            dir_props,
            levels,
            openings,
            heads,
            pending,
            iso_run: IsoRun::new(0, 0),
        }
    }

    /// Leaves the old entries in `openings`; `add_opening` overwrites them.
    fn begin_para(&mut self, level: UBiDiLevel) {
        self.iso_run = IsoRun::new(0, level);
        self.heads.clear();
    }

    /// Returns the outer run, for `end_isolate`.
    fn begin_isolate(&mut self, level: UBiDiLevel) -> IsoRun {
        let inner = IsoRun::new(self.iso_run.limit, level);
        replace(&mut self.iso_run, inner)
    }

    fn end_isolate(&mut self, outer: IsoRun) {
        self.truncate_openings(outer.limit);
        self.iso_run = IsoRun {
            last_base: ON,
            ..outer
        };
    }

    /// Handles a change of the level. `context_pos` becomes 0, which is before all brackets that follow.
    fn process_boundary(&mut self, previous_level: UBiDiLevel, embedding_level: UBiDiLevel) {
        self.truncate_openings(self.iso_run.start);
        self.iso_run = IsoRun {
            direction: DirProp::from_level(embedding_level),
            ..IsoRun::new(
                self.iso_run.start,
                no_override(previous_level).max(no_override(embedding_level)),
            )
        };
    }

    /// Removes the entries of the run from `limit` on.
    fn truncate_openings(&mut self, limit: usize) {
        for (index, opening) in (limit..self.iso_run.limit)
            .zip(self.openings.slice(limit..))
            .rev()
        {
            if let Some(head) = self.heads.soft_get_mut(usize::from(opening.head))
                && head.index() == Some(index)
            {
                head.first = opening.next;
            }
        }
        self.iso_run.limit = limit;
    }

    fn add_opening(&mut self, matching: u16, position: usize) -> Result<(), UErrorCode> {
        let limit = self.iso_run.limit;
        let head = match self.heads.iter().position(|head| head.closing == matching) {
            Some(head) => head,
            None => {
                // At most one list per closing bracket character, so the index fits `u16`.
                try_push(
                    self.heads,
                    ListHead {
                        closing: matching,
                        first: 0,
                    },
                )?;
                self.heads.len() - 1
            }
        };
        let opening = Opening {
            position: position as u32,
            matching: matching.into(),
            context_pos: self.iso_run.context_pos as u32,
            context_dir: self.iso_run.context_dir,
            head: head as u16,
            next: self.heads.at(head).first,
        };
        match self.openings.get_mut(limit) {
            Some(slot) => *slot = opening,
            None => try_push(self.openings, opening)?,
        }
        self.heads.set(
            head,
            ListHead {
                closing: matching,
                first: limit as u32 + 1,
            },
        );
        self.iso_run.limit = limit + 1;
        Ok(())
    }

    /// Changes N0c1 to N0c2 in the pairs whose context is the bracket that got `new_prop`. Invariant: `context_pos`
    /// never decreases from one entry to the next, and after a closing bracket is at least the position of the bracket.
    /// So the scans are disjoint, and a worklist holds the changed pairs.
    // ICU4C: ubidi.cpp, fixN0c
    fn fix_n0c(&mut self, opening_index: usize, new_prop: DirProp) {
        let limit = self.iso_run.limit;
        // The scan skips this entry, which is still unmatched.
        let mut next = Some((opening_index, self.openings.at(opening_index).position()));
        while let Some((first, new_prop_position)) = next {
            for k in first..limit {
                let opening = self.openings.at(k);
                if new_prop_position < opening.context_pos as usize {
                    break;
                }
                if opening.matching >= 0 || new_prop_position >= opening.position() {
                    continue;
                }
                if new_prop == opening.context_dir {
                    break;
                }
                let closing_position = opening.matching.unsigned_abs() as usize;
                self.dir_props.set(opening.position(), new_prop);
                self.dir_props.set(closing_position, new_prop);
                self.openings.set(
                    k,
                    Opening {
                        matching: 0,
                        ..opening
                    },
                );
                let nested_count = self
                    .openings
                    .slice(k..limit)
                    .partition_point(|other| other.position() < closing_position);
                self.pending.add((k + nested_count, closing_position));
            }
            next = self.pending.pop();
        }
    }

    /// Returns the direction of the pair, or `None` (N0d).
    fn process_closing(&mut self, open_idx: usize, position: usize) -> Option<DirProp> {
        let opening = self.openings.at(open_idx);
        let IsoRun {
            start,
            found_limit,
            direction,
            ..
        } = self.iso_run;
        let [found_l, found_r] = found_limit.map(|limit| open_idx < limit);
        if !(found_l | found_r) {
            self.truncate_openings(open_idx);
            return None;
        }
        let is_n0b = if direction == L { found_l } else { found_r };
        let new_prop = if is_n0b {
            direction
        } else {
            opening.context_dir
        };
        self.dir_props.set(opening.position(), new_prop);
        self.dir_props.set(position, new_prop);
        self.fix_n0c(open_idx, new_prop);

        let previous = self.openings.slice(start..open_idx).last().copied();
        let synonym = previous.filter(|previous| previous.position == opening.position);
        // N0c depends on the context, which an enclosing pair may still change.
        if is_n0b || open_idx == start {
            self.truncate_openings(open_idx - usize::from(synonym.is_some()));
        } else {
            self.openings.set(
                open_idx,
                Opening {
                    matching: -(position as i32),
                    ..opening
                },
            );
            if let Some(synonym) = synonym {
                self.openings.set(
                    open_idx - 1,
                    Opening {
                        matching: 0,
                        ..synonym
                    },
                );
            }
            // Neutralize the unmatched brackets within the pair.
            for head in self.heads.iter_mut() {
                while let Some(k) = head.index().filter(|&k| k > open_idx) {
                    let nested = self.openings.at(k);
                    self.openings.set(
                        k,
                        Opening {
                            matching: nested.matching.min(0),
                            ..nested
                        },
                    );
                    head.first = nested.next;
                }
            }
        }
        Some(new_prop)
    }

    /// Records that `strong` follows the entries of the run below `limit`.
    fn record_strong(&mut self, strong: DirProp, limit: usize) {
        let [l, r] = &mut self.iso_run.found_limit;
        let found = if strong == L { l } else { r };
        *found = limit.max(*found);
    }

    /// Returns the highest entry of the run that `c` matches.
    fn find_opening(&mut self, c: u16) -> Option<usize> {
        let start = self.iso_run.start;
        let head = self.heads.iter_mut().find(|head| head.closing == c)?;
        while let Some(index) = head.index().filter(|&index| index >= start) {
            let opening = self.openings.at(index);
            if opening.matching == i32::from(c) {
                return Some(index);
            }
            // A matched or neutralized entry never matches `c` again.
            head.first = opening.next;
        }
        None
    }

    /// `dir_prop` and `level` are the values at `position`.
    #[inline(always)]
    fn process_char(
        &mut self,
        position: usize,
        dir_prop: DirProp,
        level: UBiDiLevel,
    ) -> Result<(), UErrorCode> {
        if dir_prop == ON {
            return self.process_neutral(position, level);
        }
        self.record_char(position, dir_prop, level);
        Ok(())
    }

    fn process_neutral(&mut self, position: usize, level: UBiDiLevel) -> Result<(), UErrorCode> {
        let c = self.text.at(position);
        let bracket_type = ubidi_get_paired_bracket_type(c.into());
        if bracket_type == U_BPT_OPEN {
            let first = self.iso_run.limit;
            let matching = ubidi_get_paired_bracket(c.into()) as u16;
            // The closing angle brackets are synonyms: an entry for each.
            if matching == 0x232a {
                self.add_opening(0x3009, position)?;
            } else if matching == 0x3009 {
                self.add_opening(0x232a, position)?;
            }
            self.add_opening(matching, position)?;
            self.record_char(position, ON, level);
            // No strong character follows the new entries yet.
            self.iso_run.found_limit = self.iso_run.found_limit.map(|limit| limit.min(first));
        } else if bracket_type == U_BPT_CLOSE
            && let Some(open_idx) = self.find_opening(c)
            && let Some(new_prop) = self.process_closing(open_idx, position)
        {
            let run = &mut self.iso_run;
            (run.last_base, run.context_dir, run.context_pos) = (ON, new_prop, position);
            if level & LEVEL_OVERRIDE != 0 {
                run.last_strong = DirProp::from_level(level);
                self.record_strong(DirProp::from_level(level), open_idx);
            }
            // LRO and RLO do not override a pair.
            for position in [self.openings.at(open_idx).position(), position] {
                self.levels
                    .set(position, no_override(self.levels.at(position)));
            }
        } else {
            self.record_char(position, ON, level);
        }
        Ok(())
    }

    fn record_char(&mut self, position: usize, dir_prop: DirProp, level: UBiDiLevel) {
        let run = &mut self.iso_run;
        let strong = if level & LEVEL_OVERRIDE != 0 {
            let strong = DirProp::from_level(level);
            if !matches!(dir_prop, S | WS | ON) {
                self.dir_props.set(position, strong);
            }
            (run.last_base, run.last_strong) = (strong, strong);
            strong
        } else if dir_prop == NSM {
            // An NSM after an ON becomes ON, also if the ON is a bracket that becomes L or R.
            let IsoRun {
                last_base, limit, ..
            } = *run;
            match last_base {
                ON => self.dir_props.set(position, ON),
                L | R | AL => self.record_strong(last_base, limit),
                _ => {}
            }
            return;
        } else {
            run.last_base = dir_prop;
            match dir_prop {
                L | R | AL => {
                    run.last_strong = dir_prop;
                    if dir_prop == L { L } else { R }
                }
                EN if run.last_strong == L => {
                    self.dir_props.set(position, ENL); // W7
                    L
                }
                EN => {
                    self.dir_props
                        .set(position, if run.last_strong == AL { AN } else { ENR }); // W2
                    R
                }
                AN => R,
                _ => return,
            }
        };
        (run.context_dir, run.context_pos) = (strong, position);
        let limit = run.limit;
        self.record_strong(strong, limit);
    }
}
