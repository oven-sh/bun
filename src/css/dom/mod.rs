//! CSS for `bun:dom`: `element.style`, `getComputedStyle()` and `<style>` sheets.
//!
//! C++ (`src/jsc/bindings/webcore/css`) stores declarations as text and never looks inside a value. Everything that
//! needs to know CSS happens here: splitting a declaration list, checking a value, expanding a shorthand, writing a value
//! back the way the CSSOM does, splitting a style sheet into rules, finding `var()`.
//!
//! `src/jsc/bindings/webcore/css/parser/BunCSSParser.h` mirrors every type and number of the C ABI below.

mod declarations;
mod properties;
mod stylesheet;
mod variables;

use declarations::DeclarationSink;

// ─── The C ABI ───

/// Lengths may be written without a unit.
pub(crate) const FLAG_QUIRKS_MODE: u32 = 1 << 0;
/// Color keywords are written as `rgb()`, as in computed style.
pub(crate) const FLAG_RESOLVE_COLORS: u32 = 1 << 1;
/// A style sheet with a rule at the top level that is not valid is refused, where the rule is otherwise left out.
pub(crate) const FLAG_REFUSE_INVALID_RULES: u32 = 1 << 2;

/// A part of the `strings` of the list it belongs to. UTF-8.
#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct StringRange {
    pub(crate) offset: u32,
    pub(crate) length: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct Declaration {
    /// A `CSSPropertyID`: a longhand, `all`, or 1 for a custom property.
    pub(crate) property: u16,
    /// The shorthand it was expanded from, or 0.
    pub(crate) shorthand: u16,
    pub(crate) is_important: bool,
    /// The shorthand has `var()` in it, so the longhand has no value yet.
    pub(crate) has_variable_references: bool,
    /// Of a custom property.
    pub(crate) name: StringRange,
    pub(crate) value: StringRange,
    /// The same range for all longhands of one declaration.
    pub(crate) shorthand_value: StringRange,
}

/// Owns both arrays.
#[repr(C)]
pub(crate) struct DeclarationList {
    pub(crate) declarations: *mut Declaration,
    pub(crate) declaration_count: usize,
    pub(crate) strings: *mut u8,
    pub(crate) strings_length: usize,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum RuleKind {
    Style = 0,
    // Rules with rules inside. `prelude` is the condition or the name.
    Media = 1,
    Supports = 2,
    LayerBlock = 3,
    Container = 4,
    Scope = 5,
    StartingStyle = 6,
    // Rules the DOM keeps as text.
    FontFace = 7,
    Keyframes = 8,
    Import = 9,
    Namespace = 10,
    Property = 11,
    Page = 12,
    CounterStyle = 13,
    LayerStatement = 14,
    FontPaletteValues = 15,
    FontFeatureValues = 16,
    ViewTransition = 17,
    PositionTry = 18,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum PseudoElementKind {
    None = 0,
    Before = 1,
    After = 2,
    Marker = 3,
    FirstLine = 4,
    FirstLetter = 5,
    Placeholder = 6,
    Selection = 7,
    Backdrop = 8,
    FileSelectorButton = 9,
    /// `x::slotted(y)` is two selectors of the list: `y`, with this kind, for the element that is assigned to a slot...
    Slotted = 10,
    /// ... and right after it `x`, for the slot.
    SlotOfSlotted = 11,
    /// One that `getComputedStyle()` has no style for.
    Other = 255,
}

/// One complex selector of a style rule, without its pseudo-element.
#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct RuleSelector {
    pub(crate) text: StringRange,
    pub(crate) pseudo_element: PseudoElementKind,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub(crate) struct Rule {
    pub(crate) kind: RuleKind,
    /// `Media`, `Supports`: whether the rules inside apply.
    pub(crate) condition_is_true: bool,
    /// How many of the rules that follow are inside this one, at any depth.
    pub(crate) descendant_count: u32,
    pub(crate) first_selector: u32,
    pub(crate) selector_count: u32,
    pub(crate) first_declaration: u32,
    pub(crate) declaration_count: u32,
    /// `Style`: the selector list, serialized. Rules with rules inside: what stands between the name and the block.
    pub(crate) prelude: StringRange,
    /// The whole rule as it was written.
    pub(crate) text: StringRange,
}

/// Owns the four arrays.
#[repr(C)]
pub(crate) struct StyleSheet {
    pub(crate) rules: *mut Rule,
    pub(crate) rule_count: usize,
    pub(crate) selectors: *mut RuleSelector,
    pub(crate) selector_count: usize,
    pub(crate) declarations: *mut Declaration,
    pub(crate) declaration_count: usize,
    pub(crate) strings: *mut u8,
    pub(crate) strings_length: usize,
}

/// One outermost `var()`. The ranges are parts of the input.
#[repr(C)]
#[derive(Clone, Copy, Default)]
pub(crate) struct VariableReference {
    /// From `var(` to `)`.
    pub(crate) whole: StringRange,
    pub(crate) name: StringRange,
    pub(crate) fallback: StringRange,
    pub(crate) has_fallback: bool,
}

/// Owns the array.
#[repr(C)]
pub(crate) struct VariableReferenceList {
    pub(crate) references: *mut VariableReference,
    pub(crate) reference_count: usize,
}

/// Invalid declarations are left out. Always returns true and writes `result`, which the caller gives back to
/// `Bun__CSS__DOM__freeDeclarationList`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__CSS__DOM__parseDeclarationList(
    input: *const u8,
    input_length: usize,
    flags: u32,
    result: *mut DeclarationList,
) -> bool {
    // SAFETY: the caller passes a valid pointer and length.
    let input = unsafe { input_slice(input, input_length) };
    let arena = bun_alloc::Arena::new();
    let mut sink = DeclarationSink::new(&arena, flags);
    sink.parse_declaration_list(input);
    let (declarations, strings) = sink.finish();
    // SAFETY: the caller passes a pointer that is valid for a write.
    unsafe { result.write(DeclarationList::new(declarations, strings)) };
    true
}

/// Returns false, and writes nothing, if `input` is not a valid value of the property. `!important` is not part of a value.
/// With 1 (a custom property) the result is one declaration without a name.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__CSS__DOM__parseValue(
    property: u16,
    input: *const u8,
    input_length: usize,
    flags: u32,
    result: *mut DeclarationList,
) -> bool {
    // SAFETY: the caller passes a valid pointer and length.
    let input = unsafe { input_slice(input, input_length) };
    let arena = bun_alloc::Arena::new();
    let mut sink = DeclarationSink::new(&arena, flags);
    let is_valid = if property == properties::CUSTOM {
        sink.parse_custom_property(b"", input, false)
    } else {
        sink.parse_property(property, input, false)
    };
    if !is_valid {
        return false;
    }
    let (declarations, strings) = sink.finish();
    // SAFETY: the caller passes a pointer that is valid for a write.
    unsafe { result.write(DeclarationList::new(declarations, strings)) };
    true
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__CSS__DOM__freeDeclarationList(list: *mut DeclarationList) {
    // SAFETY: the caller gives the list back, and does not use it again.
    drop(unsafe { list.read() });
}

/// Invalid rules are left out. With `FLAG_REFUSE_INVALID_RULES`, one at the top level makes this return false and write
/// nothing. Otherwise returns true and writes `result`, which the caller gives back to `Bun__CSS__DOM__freeStyleSheet`.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__CSS__DOM__parseStyleSheet(
    input: *const u8,
    input_length: usize,
    flags: u32,
    result: *mut StyleSheet,
) -> bool {
    // SAFETY: the caller passes a valid pointer and length.
    let input = unsafe { input_slice(input, input_length) };
    let arena = bun_alloc::Arena::new();
    let Some(sheet) = stylesheet::parse(input, &arena, flags) else {
        return false;
    };
    // SAFETY: the caller passes a pointer that is valid for a write.
    unsafe { result.write(sheet) };
    true
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__CSS__DOM__freeStyleSheet(sheet: *mut StyleSheet) {
    // SAFETY: the caller gives the sheet back, and does not use it again.
    drop(unsafe { sheet.read() });
}

/// Returns false, and writes nothing, if a `var()` is malformed.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__CSS__DOM__findVariableReferences(
    input: *const u8,
    input_length: usize,
    result: *mut VariableReferenceList,
) -> bool {
    // SAFETY: the caller passes a valid pointer and length.
    let input = unsafe { input_slice(input, input_length) };
    let Some(references) = variables::find_variable_references(input) else {
        return false;
    };
    let (references, reference_count) = into_raw_parts(references);
    // SAFETY: the caller passes a pointer that is valid for a write.
    unsafe {
        result.write(VariableReferenceList {
            references,
            reference_count,
        });
    }
    true
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__CSS__DOM__freeVariableReferenceList(list: *mut VariableReferenceList) {
    // SAFETY: the caller gives the list back, and does not use it again.
    drop(unsafe { list.read() });
}

// ─── Ownership ───

/// # Safety
/// `pointer` is valid for reads of `length` bytes, or `length` is 0.
unsafe fn input_slice<'a>(pointer: *const u8, length: usize) -> &'a [u8] {
    if length == 0 {
        return &[];
    }
    // SAFETY: the caller's contract.
    unsafe { core::slice::from_raw_parts(pointer, length) }
}

fn into_raw_parts<T>(items: Vec<T>) -> (*mut T, usize) {
    let items = items.into_boxed_slice();
    let length = items.len();
    (Box::into_raw(items).cast::<T>(), length)
}

/// # Safety
/// The two are what `into_raw_parts` returned, and are not used again.
unsafe fn free_raw_parts<T>(pointer: *mut T, length: usize) {
    // SAFETY: the caller's contract.
    drop(unsafe { Box::from_raw(core::ptr::slice_from_raw_parts_mut(pointer, length)) });
}

impl DeclarationList {
    fn new(declarations: Vec<Declaration>, strings: Vec<u8>) -> DeclarationList {
        let (declarations, declaration_count) = into_raw_parts(declarations);
        let (strings, strings_length) = into_raw_parts(strings);
        DeclarationList {
            declarations,
            declaration_count,
            strings,
            strings_length,
        }
    }
}

impl Drop for DeclarationList {
    fn drop(&mut self) {
        // SAFETY: `new` made both with `into_raw_parts`.
        unsafe {
            free_raw_parts(self.declarations, self.declaration_count);
            free_raw_parts(self.strings, self.strings_length);
        }
    }
}

impl StyleSheet {
    fn new(
        rules: Vec<Rule>,
        selectors: Vec<RuleSelector>,
        declarations: Vec<Declaration>,
        strings: Vec<u8>,
    ) -> StyleSheet {
        let (rules, rule_count) = into_raw_parts(rules);
        let (selectors, selector_count) = into_raw_parts(selectors);
        let (declarations, declaration_count) = into_raw_parts(declarations);
        let (strings, strings_length) = into_raw_parts(strings);
        StyleSheet {
            rules,
            rule_count,
            selectors,
            selector_count,
            declarations,
            declaration_count,
            strings,
            strings_length,
        }
    }
}

impl Drop for StyleSheet {
    fn drop(&mut self) {
        // SAFETY: `new` made all four with `into_raw_parts`.
        unsafe {
            free_raw_parts(self.rules, self.rule_count);
            free_raw_parts(self.selectors, self.selector_count);
            free_raw_parts(self.declarations, self.declaration_count);
            free_raw_parts(self.strings, self.strings_length);
        }
    }
}

impl Drop for VariableReferenceList {
    fn drop(&mut self) {
        // SAFETY: `Bun__CSS__DOM__findVariableReferences` made it with `into_raw_parts`.
        unsafe { free_raw_parts(self.references, self.reference_count) };
    }
}
