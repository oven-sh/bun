//! E — expression node payloads for the JS AST.
//!
//! Port of `src/js_parser/ast/E.zig`.

use core::cmp::Ordering;
use core::fmt;

use bun_alloc::Arena as Bump;
use phf::phf_map;

use bun_alloc::AllocError;
use bun_collections::VecExt;
use bun_core::ZigString;
use bun_core::strings;

use crate::{Expr, ExprNodeIndex, ExprNodeList, G, OptionalChain, Ref, StoreRef};
use bun_alloc::ArenaVecExt as _;

pub use crate::StoreStr as Str;

/// This represents an internal property name that can be mangled. The symbol
/// referenced by this expression should be a "SymbolMangledProp" symbol.
#[derive(Clone, Copy)]
pub struct NameOfSymbol {
    pub ref_: Ref,

    /// If true, a preceding comment contains "@__KEY__"
    ///
    /// Currently not used
    pub has_property_key_comment: bool,
}
impl Default for NameOfSymbol {
    fn default() -> Self {
        Self {
            ref_: Ref::NONE,
            has_property_key_comment: false,
        }
    }
}

pub struct Array {
    pub items: ExprNodeList,
    pub comma_after_spread: Option<crate::Loc>,
    pub is_single_line: bool,
    pub is_parenthesized: bool,
    pub was_originally_macro: bool,
    pub close_bracket_loc: crate::Loc,
}
impl Default for Array {
    fn default() -> Self {
        Self {
            items: bun_alloc::AstAlloc::vec(),
            comma_after_spread: None,
            is_single_line: false,
            is_parenthesized: false,
            was_originally_macro: false,
            close_bracket_loc: crate::Loc::EMPTY,
        }
    }
}
impl Array {
    pub const EMPTY: Array = Array {
        items: bun_alloc::AstAlloc::vec(),
        comma_after_spread: None,
        is_single_line: false,
        is_parenthesized: false,
        was_originally_macro: false,
        close_bracket_loc: crate::Loc::EMPTY,
    };

    /// Zig: `pub fn push(this: *Array, arena, item) !void`.
    /// `Vec::append` uses the global arena; `_bump` is kept
    /// for call-site shape parity and the eventual bump-arena Vec.
    pub fn push(&mut self, _bump: &Bump, item: Expr) -> Result<(), AllocError> {
        VecExt::append(&mut self.items, item);
        Ok(())
    }

    #[inline]
    pub fn slice(&self) -> &[Expr] {
        self.items.slice()
    }
}

impl Array {
    pub fn inline_spread_of_array_literals(
        &mut self,
        _bump: &Bump,
        estimated_count: usize,
    ) -> Result<ExprNodeList, AllocError> {
        let mut out: ExprNodeList =
            ExprNodeList::init_capacity(estimated_count + self.items.len_u32() as usize);
        // PORT NOTE: reshaped for borrowck — iterate items via index so the &mut
        // borrow of `out` does not overlap a shared borrow of `self`.
        let items_len = self.items.len_u32() as usize;
        for idx in 0..items_len {
            let item = self.items.slice()[idx];
            match &item.data {
                crate::expr::Data::ESpread(val) => {
                    if let crate::expr::Data::EArray(inner) = &val.value.data {
                        for inner_item in inner.items.slice() {
                            if matches!(inner_item.data, crate::expr::Data::EMissing(_)) {
                                out.push(Expr::init(Undefined {}, inner_item.loc));
                            } else {
                                out.push(*inner_item);
                            }
                        }
                        // skip empty arrays
                        // don't include the inlined spread.
                        continue;
                    }
                    // non-arrays are kept in
                }
                _ => {}
            }

            out.push(item);
        }
        Ok(out)
    }

    // `pub const toJS = @import("../../js_parser_jsc/expr_jsc.zig").arrayToJS;` — deleted per
    // PORTING.md (jsc extension trait lives in `js_parser_jsc` crate).

    /// Assumes each item in the array is a string
    pub fn alphabetize_strings(&mut self) {
        if cfg!(debug_assertions) {
            for item in self.items.slice() {
                debug_assert!(matches!(item.data, crate::expr::Data::EString(_)));
            }
        }
        self.items.slice_mut().sort_by(array_sorter_is_less_than);
    }
}

pub struct Unary {
    pub op: crate::OpCode,
    pub value: ExprNodeIndex,
    pub flags: UnaryFlags,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    #[repr(transparent)]
    pub struct UnaryFlags: u8 {
        const WAS_ORIGINALLY_TYPEOF_IDENTIFIER = 1 << 0;

        const WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS = 1 << 1;
    }
}

pub struct Binary {
    pub left: ExprNodeIndex,
    pub right: ExprNodeIndex,
    pub op: crate::OpCode,
}

// ── Leaf scalar payloads ───────────────────────────────────────────────────
// `toJS` impls live in the `js_parser_jsc` extension trait.

#[derive(Clone, Copy)]
pub struct Boolean {
    pub value: bool,
}

#[derive(Clone, Copy, Default)]
pub struct Null;
#[derive(Clone, Copy, Default)]
pub struct Undefined;
#[derive(Clone, Copy, Default)]
pub struct Missing;
#[derive(Clone, Copy, Default)]
pub struct This;
#[derive(Clone, Copy, Default)]
pub struct Super;
#[derive(Clone, Copy, Default)]
pub struct ImportMeta;

#[derive(Clone, Copy, Default)]
pub struct ImportMetaMain {
    /// If true, print `!import.meta.main` (or `require.main != module`).
    pub inverted: bool,
}

#[derive(Clone, Copy)]
pub struct NewTarget {
    pub range: crate::Range,
}

pub struct New {
    pub target: ExprNodeIndex,
    pub args: ExprNodeList,

    /// True if there is a comment containing "@__PURE__" or "#__PURE__" preceding
    /// this call expression. See the comment inside ECall for more details.
    pub can_be_unwrapped_if_unused: CallUnwrap,

    pub close_parens_loc: crate::Loc,
}
impl Default for New {
    fn default() -> Self {
        Self {
            target: ExprNodeIndex::EMPTY,
            args: bun_alloc::AstAlloc::vec(),
            can_be_unwrapped_if_unused: CallUnwrap::Never,
            close_parens_loc: crate::Loc::EMPTY,
        }
    }
}

#[derive(Clone, Copy)]
pub enum Special {
    /// emits `exports` or `module.exports` depending on `commonjs_named_exports_deoptimized`
    ModuleExports,
    /// `import.meta.hot`
    HotEnabled,
    /// Acts as .e_undefined, but allows property accesses to the rest of the HMR API.
    HotDisabled,
    /// `import.meta.hot.data` when HMR is enabled. Not reachable when it is disabled.
    HotData,
    /// `import.meta.hot.accept` when HMR is enabled. Truthy.
    HotAccept,
    /// Converted from `hot_accept` in P.zig's handleImportMetaHotAcceptCall
    /// when passed strings. Printed as `hmr.acceptSpecifiers`
    HotAcceptVisited,
    /// Prints the resolved specifier string for an import record.
    /// Zig: `resolved_specifier_string: ImportRecord.Index` (a `u32`).
    ResolvedSpecifierString(u32),
}

pub struct Call {
    // Node:
    pub target: ExprNodeIndex,
    pub args: ExprNodeList,
    pub optional_chain: Option<OptionalChain>,
    pub is_direct_eval: bool,
    pub close_paren_loc: crate::Loc,

    pub can_be_unwrapped_if_unused: CallUnwrap,

    /// Used when printing to generate the source prop on the fly
    pub was_jsx_element: bool,
}
impl Default for Call {
    fn default() -> Self {
        Self {
            target: ExprNodeIndex::EMPTY,
            args: bun_alloc::AstAlloc::vec(),
            optional_chain: None,
            is_direct_eval: false,
            close_paren_loc: crate::Loc::EMPTY,
            can_be_unwrapped_if_unused: CallUnwrap::Never,
            was_jsx_element: false,
        }
    }
}
impl Call {
    pub fn has_same_flags_as(&self, b: &Call) -> bool {
        self.optional_chain == b.optional_chain
            && self.is_direct_eval == b.is_direct_eval
            && self.can_be_unwrapped_if_unused == b.can_be_unwrapped_if_unused
    }
}

#[repr(u8)] // Zig: enum(u2) — Rust has no u2, use u8
#[derive(Clone, Copy, PartialEq, Eq, Default)]
pub enum CallUnwrap {
    #[default]
    Never,
    IfUnused,
    IfUnusedAndToStringSafe,
}

pub struct Dot {
    // target is Node
    pub target: ExprNodeIndex,
    // TODO(port): arena-owned slice
    pub name: Str,
    pub name_loc: crate::Loc,
    pub optional_chain: Option<OptionalChain>,

    /// If true, this property access is known to be free of side-effects. That
    /// means it can be removed if the resulting value isn't used.
    pub can_be_removed_if_unused: bool,

    /// If true, this property access is a function that, when called, can be
    /// unwrapped if the resulting value is unused. Unwrapping means discarding
    /// the call target but keeping any arguments with side effects.
    pub call_can_be_unwrapped_if_unused: CallUnwrap,
}
impl Default for Dot {
    fn default() -> Self {
        Self {
            target: ExprNodeIndex::EMPTY,
            name: Str::EMPTY,
            name_loc: crate::Loc::EMPTY,
            optional_chain: None,
            can_be_removed_if_unused: false,
            call_can_be_unwrapped_if_unused: CallUnwrap::Never,
        }
    }
}
impl Dot {
    pub fn has_same_flags_as(&self, b: &Dot) -> bool {
        // TODO(port): Zig refers to `a.is_direct_eval` which does not exist on Dot;
        // mirroring the (likely buggy) Zig literally would not compile. Preserving
        // the three fields that DO exist; revisit.
        self.optional_chain == b.optional_chain
            && self.can_be_removed_if_unused == b.can_be_removed_if_unused
            && self.call_can_be_unwrapped_if_unused == b.call_can_be_unwrapped_if_unused
    }
}

pub struct Index {
    pub index: ExprNodeIndex,
    pub target: ExprNodeIndex,
    pub optional_chain: Option<OptionalChain>,
}
impl Index {
    pub fn has_same_flags_as(&self, b: &Index) -> bool {
        self.optional_chain == b.optional_chain
    }
}

pub struct Arrow {
    pub args: crate::StoreSlice<G::Arg>,
    pub body: G::FnBody,

    pub is_async: bool,
    pub has_rest_arg: bool,
    /// Use shorthand if true and "Body" is a single return statement
    pub prefer_expr: bool,
}
impl Arrow {
    // Zig `pub const noop_return_undefined: Arrow = .{ .body = .{ .stmts = &.{} } };`
    pub const NOOP_RETURN_UNDEFINED: Arrow = Arrow {
        args: crate::StoreSlice::EMPTY,
        body: G::FnBody {
            loc: crate::Loc::EMPTY,
            stmts: crate::StoreSlice::EMPTY,
        },
        is_async: false,
        has_rest_arg: false,
        prefer_expr: false,
    };
}
impl Default for Arrow {
    fn default() -> Self {
        Self {
            args: crate::StoreSlice::EMPTY,
            body: G::FnBody {
                loc: crate::Loc::EMPTY,
                stmts: crate::StoreSlice::EMPTY,
            },
            is_async: false,
            has_rest_arg: false,
            prefer_expr: false,
        }
    }
}

pub struct Function {
    pub func: G::Fn,
}

#[derive(Clone, Copy)]
pub struct Identifier {
    pub ref_: Ref,
}
impl Default for Identifier {
    #[inline]
    fn default() -> Self {
        Self { ref_: Ref::NONE }
    }
}
impl Identifier {
    #[inline]
    pub const fn init(ref_: Ref) -> Identifier {
        Identifier { ref_ }
    }

    /// If we're inside a "with" statement, this identifier may be a property
    /// access. In that case it would be incorrect to remove this identifier since
    /// the property access may be a getter or setter with side effects.
    #[inline]
    pub const fn must_keep_due_to_with_stmt(self) -> bool {
        self.ref_.user_bit(0)
    }
    #[inline]
    pub fn set_must_keep_due_to_with_stmt(&mut self, v: bool) {
        self.ref_.set_user_bit(0, v);
    }

    #[inline]
    pub const fn can_be_removed_if_unused(self) -> bool {
        self.ref_.user_bit(1)
    }
    #[inline]
    pub fn set_can_be_removed_if_unused(&mut self, v: bool) {
        self.ref_.set_user_bit(1, v);
    }

    /// If true, this identifier represents a function that, when called, can be
    /// unwrapped if the resulting value is unused. Unwrapping means discarding
    /// the call target but keeping any arguments with side effects.
    #[inline]
    pub const fn call_can_be_unwrapped_if_unused(self) -> bool {
        self.ref_.user_bit(2)
    }
    #[inline]
    pub fn set_call_can_be_unwrapped_if_unused(&mut self, v: bool) {
        self.ref_.set_user_bit(2, v);
    }

    // Builder-style — replaces the Zig `.{ .ref = r, .can_be_removed = true }`
    // struct-init pattern at the handful of sites that set flags up front.
    #[inline]
    pub const fn with_must_keep_due_to_with_stmt(self, v: bool) -> Self {
        Self {
            ref_: self.ref_.with_user_bit(0, v),
        }
    }
    #[inline]
    pub const fn with_can_be_removed_if_unused(self, v: bool) -> Self {
        Self {
            ref_: self.ref_.with_user_bit(1, v),
        }
    }
    #[inline]
    pub const fn with_call_can_be_unwrapped_if_unused(self, v: bool) -> Self {
        Self {
            ref_: self.ref_.with_user_bit(2, v),
        }
    }
}

#[derive(Clone, Copy)]
pub struct ImportIdentifier {
    pub ref_: Ref,
}
impl Default for ImportIdentifier {
    #[inline]
    fn default() -> Self {
        Self { ref_: Ref::NONE }
    }
}
impl ImportIdentifier {
    #[inline]
    pub const fn new(ref_: Ref, was_originally_identifier: bool) -> Self {
        // Strip any incoming user bits (the caller may pass an
        // `E::Identifier.ref_` carrying its own flags in bits 1/2) before
        // applying ours, so foreign flags can't leak into this node.
        Self {
            ref_: ref_
                .without_user_bits()
                .with_user_bit(0, was_originally_identifier),
        }
    }

    /// If true, this was originally an identifier expression such as "foo". If
    /// false, this could potentially have been a member access expression such
    /// as "ns.foo" off of an imported namespace object.
    #[inline]
    pub const fn was_originally_identifier(self) -> bool {
        self.ref_.user_bit(0)
    }
}

#[derive(Clone, Copy)]
pub struct CommonJSExportIdentifier {
    pub ref_: Ref,
}
impl Default for CommonJSExportIdentifier {
    #[inline]
    fn default() -> Self {
        Self { ref_: Ref::NONE }
    }
}
impl CommonJSExportIdentifier {
    #[inline]
    pub const fn new(ref_: Ref, base: CommonJSExportIdentifierBase) -> Self {
        // Strip any incoming user bits before applying ours — see
        // `ImportIdentifier::new`.
        Self {
            ref_: ref_.without_user_bits().with_user_bit(
                0,
                matches!(base, CommonJSExportIdentifierBase::ModuleDotExports),
            ),
        }
    }
    #[inline]
    pub const fn base(self) -> CommonJSExportIdentifierBase {
        if self.ref_.user_bit(0) {
            CommonJSExportIdentifierBase::ModuleDotExports
        } else {
            CommonJSExportIdentifierBase::Exports
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CommonJSExportIdentifierBase {
    Exports,
    ModuleDotExports,
}

/// This is similar to EIdentifier but it represents class-private fields and
/// methods. It can be used where computed properties can be used, such as
/// EIndex and Property.
#[derive(Clone, Copy)]
pub struct PrivateIdentifier {
    pub ref_: Ref,
}

pub struct JSXElement {
    pub tag: Option<ExprNodeIndex>,

    /// JSX props
    pub properties: G::PropertyList,

    /// JSX element children `<div>{this_is_a_child_element}</div>`
    pub children: ExprNodeList,

    /// needed to make sure parse and visit happen in the same order
    pub key_prop_index: i32,

    pub flags: crate::flags::JSXElementBitset,

    pub close_tag_loc: crate::Loc,
}
impl Default for JSXElement {
    fn default() -> Self {
        Self {
            tag: None,
            properties: bun_alloc::AstAlloc::vec(),
            children: bun_alloc::AstAlloc::vec(),
            key_prop_index: -1,
            flags: crate::flags::JSXElementBitset::default(),
            close_tag_loc: crate::Loc::EMPTY,
        }
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum JSXSpecialProp {
    /// old react transform used this as a prop
    UnderscoreSelf,
    UnderscoreSource,
    Key,
    Ref,
    Any,
}
impl JSXSpecialProp {
    #[inline]
    pub fn from_bytes(s: &[u8]) -> Option<Self> {
        match s.len() {
            3 => match s {
                b"key" => Some(Self::Key),
                b"ref" => Some(Self::Ref),
                _ => None,
            },
            6 if s == b"__self" => Some(Self::UnderscoreSelf),
            8 if s == b"__source" => Some(Self::UnderscoreSource),
            _ => None,
        }
    }
}

#[derive(Clone, Copy)]
pub struct Number {
    pub value: f64,
}

const DOUBLE_DIGIT: [&[u8]; 101] = [
    b"0", b"1", b"2", b"3", b"4", b"5", b"6", b"7", b"8", b"9", b"10", b"11", b"12", b"13", b"14",
    b"15", b"16", b"17", b"18", b"19", b"20", b"21", b"22", b"23", b"24", b"25", b"26", b"27",
    b"28", b"29", b"30", b"31", b"32", b"33", b"34", b"35", b"36", b"37", b"38", b"39", b"40",
    b"41", b"42", b"43", b"44", b"45", b"46", b"47", b"48", b"49", b"50", b"51", b"52", b"53",
    b"54", b"55", b"56", b"57", b"58", b"59", b"60", b"61", b"62", b"63", b"64", b"65", b"66",
    b"67", b"68", b"69", b"70", b"71", b"72", b"73", b"74", b"75", b"76", b"77", b"78", b"79",
    b"80", b"81", b"82", b"83", b"84", b"85", b"86", b"87", b"88", b"89", b"90", b"91", b"92",
    b"93", b"94", b"95", b"96", b"97", b"98", b"99", b"100",
];
const NEG_DOUBLE_DIGIT: [&[u8]; 101] = [
    b"-0", b"-1", b"-2", b"-3", b"-4", b"-5", b"-6", b"-7", b"-8", b"-9", b"-10", b"-11", b"-12",
    b"-13", b"-14", b"-15", b"-16", b"-17", b"-18", b"-19", b"-20", b"-21", b"-22", b"-23", b"-24",
    b"-25", b"-26", b"-27", b"-28", b"-29", b"-30", b"-31", b"-32", b"-33", b"-34", b"-35", b"-36",
    b"-37", b"-38", b"-39", b"-40", b"-41", b"-42", b"-43", b"-44", b"-45", b"-46", b"-47", b"-48",
    b"-49", b"-50", b"-51", b"-52", b"-53", b"-54", b"-55", b"-56", b"-57", b"-58", b"-59", b"-60",
    b"-61", b"-62", b"-63", b"-64", b"-65", b"-66", b"-67", b"-68", b"-69", b"-70", b"-71", b"-72",
    b"-73", b"-74", b"-75", b"-76", b"-77", b"-78", b"-79", b"-80", b"-81", b"-82", b"-83", b"-84",
    b"-85", b"-86", b"-87", b"-88", b"-89", b"-90", b"-91", b"-92", b"-93", b"-94", b"-95", b"-96",
    b"-97", b"-98", b"-99", b"-100",
];

impl Number {
    pub fn to_string(self, bump: &Bump) -> Option<Str> {
        Self::to_string_from_f64(self.value, bump)
    }

    pub fn to_string_from_f64(value: f64, bump: &Bump) -> Option<Str> {
        if value == value.trunc() && (value < i32::MAX as f64 && value > i32::MIN as f64) {
            let int_value = value as i64;
            let abs = int_value.unsigned_abs();

            // do not allocate for a small set of constant numbers: -100 through 100
            if (abs as usize) < DOUBLE_DIGIT.len() {
                return Some(Str::new(if int_value < 0 {
                    NEG_DOUBLE_DIGIT[abs as usize]
                } else {
                    DOUBLE_DIGIT[abs as usize]
                }));
            }

            // std.fmt.allocPrint(arena, "{d}", .{@as(i32, @intCast(int_value))}) catch return null
            // i32 fits in 11 bytes ("-2147483648"); format on stack then bump-copy.
            let mut stack = [0u8; 16];
            let Ok(s) = bun_core::fmt::buf_print(&mut stack, format_args!("{}", int_value as i32))
            else {
                return None;
            };
            return Some(Str::new(bump.alloc_slice_copy(s)));
        }

        if value.is_nan() {
            return Some(Str::new(b"NaN"));
        }

        if value.is_infinite() && value.is_sign_negative() {
            return Some(Str::new(b"-Infinity"));
        }

        if value.is_infinite() {
            return Some(Str::new(b"Infinity"));
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let mut buf = [0u8; 124];
            let s = bun_core::fmt::FormatDouble::dtoa(&mut buf, value);
            Some(Str::new(bump.alloc_slice_copy(s)))
        }
        #[cfg(target_arch = "wasm32")]
        {
            // do not attempt to implement the spec here, it would be error prone.
            None
        }
    }

    #[inline]
    pub fn to_u64(self) -> u64 {
        self.to::<u64>()
    }

    #[inline]
    pub fn to_usize(self) -> usize {
        self.to::<usize>()
    }

    #[inline]
    pub fn to_u32(self) -> u32 {
        self.to::<u32>()
    }

    #[inline]
    pub fn to_u16(self) -> u16 {
        self.to::<u16>()
    }

    pub fn to<T: NumberCast>(self) -> T {
        // @as(T, @intFromFloat(@min(@max(@trunc(self.value), 0), comptime @min(floatMax(f64), maxInt(T)))))
        let clamped = self.value.trunc().max(0.0).min(T::MAX_AS_F64);
        T::from_f64(clamped)
    }

    // `toJS` alias deleted — lives in `js_parser_jsc` extension trait.
}

/// Helper trait for `Number::to<T>()` — replaces Zig's `comptime T: type` param.
pub trait NumberCast: Copy {
    const MAX_AS_F64: f64;
    fn from_f64(v: f64) -> Self;
}
macro_rules! impl_number_cast {
    ($($t:ty),*) => {$(
        impl NumberCast for $t {
            const MAX_AS_F64: f64 = {
                let max = <$t>::MAX as f64;
                if max > f64::MAX { f64::MAX } else { max }
            };
            #[inline] fn from_f64(v: f64) -> Self { v as $t }
        }
    )*};
}
impl_number_cast!(u16, u32, u64, usize);

pub struct BigInt {
    // TODO(port): arena-owned slice
    pub value: Str,
}
impl BigInt {
    pub const EMPTY: BigInt = BigInt { value: Str::EMPTY };

    // `toJS` alias deleted — lives in `js_parser_jsc` extension trait.
}

pub struct Object {
    pub properties: G::PropertyList,
    pub comma_after_spread: Option<crate::Loc>,
    pub is_single_line: bool,
    pub is_parenthesized: bool,
    pub was_originally_macro: bool,

    pub close_brace_loc: crate::Loc,
}
impl Default for Object {
    fn default() -> Self {
        Self {
            properties: bun_alloc::AstAlloc::vec(),
            comma_after_spread: None,
            is_single_line: false,
            is_parenthesized: false,
            was_originally_macro: false,
            close_brace_loc: crate::Loc::EMPTY,
        }
    }
}

pub struct Rope {
    pub head: Expr,
    pub next: *mut Rope,
}
impl Rope {
    pub fn append(&mut self, expr: Expr, bump: &Bump) -> Result<*mut Rope, AllocError> {
        let mut tail = StoreRef::from_bump(self);
        while let Some(next) = core::ptr::NonNull::new(tail.next).map(StoreRef::from_non_null) {
            tail = next;
        }
        let rope: *mut Rope = bump.alloc(Rope {
            head: expr,
            next: core::ptr::null_mut(),
        });
        tail.next = rope;
        Ok(rope)
    }

    #[inline]
    pub fn next_ref<'a>(&self) -> Option<&'a Rope> {
        // SAFETY: `next` is either null or a bump-arena allocation valid until
        // arena reset (Zig: `?*Rope`). Read-only borrow; no `&mut` alias is
        // outstanding at any caller (the chain is fully built before walking).
        unsafe { self.next.cast_const().as_ref() }
    }
}

// thiserror is not a dep of this crate; hand-roll Error+Display.
#[derive(Debug, strum::IntoStaticStr)]
pub enum SetError {
    OutOfMemory,
    Clobber,
}
bun_core::impl_tag_error!(SetError);
bun_core::oom_from_alloc!(SetError);
impl From<SetError> for bun_core::Error {
    fn from(e: SetError) -> Self {
        match e {
            SetError::OutOfMemory => bun_core::err!(OutOfMemory),
            SetError::Clobber => bun_core::err!(Clobber),
        }
    }
}

pub struct RopeQuery<'a> {
    pub expr: Expr,
    pub rope: &'a Rope,
}

// ── live Object accessor surface ───────────────────────────────────────────
// Adapted to the current `Vec` API (`append(v)`, `slice()`, `slice_mut()`).
// `set_rope`/`get_or_put_array`/sort helpers stay in the gated impl below.
impl Object {
    pub const EMPTY: Object = Object {
        properties: bun_alloc::AstAlloc::vec(),
        comma_after_spread: None,
        is_single_line: false,
        is_parenthesized: false,
        was_originally_macro: false,
        close_brace_loc: crate::Loc::EMPTY,
    };

    pub fn get(&self, key: &[u8]) -> Option<Expr> {
        self.as_property(key).map(|q| q.expr)
    }

    pub fn as_property(&self, name: &[u8]) -> Option<crate::expr::Query> {
        for (i, prop) in self.properties.slice().iter().enumerate() {
            let Some(value) = prop.value else { continue };
            let Some(key) = &prop.key else { continue };
            let crate::expr::Data::EString(key_str) = &key.data else {
                continue;
            };
            if key_str.eql_bytes(name) {
                return Some(crate::expr::Query {
                    expr: value,
                    loc: key.loc,
                    i: i as u32,
                });
            }
        }
        None
    }

    pub fn has_property(&self, name: &[u8]) -> bool {
        for prop in self.properties.slice() {
            let Some(key) = &prop.key else { continue };
            let crate::expr::Data::EString(key_str) = &key.data else {
                continue;
            };
            if key_str.eql_bytes(name) {
                return true;
            }
        }
        false
    }

    pub fn put(&mut self, _bump: &Bump, key: &[u8], expr: Expr) -> Result<(), AllocError> {
        if let Some(q) = self.as_property(key) {
            self.properties.slice_mut()[q.i as usize].value = Some(expr);
        } else {
            VecExt::append(
                &mut self.properties,
                G::Property {
                    key: Some(Expr::init(EString::init(key), expr.loc)),
                    value: Some(expr),
                    ..G::Property::default()
                },
            );
        }
        Ok(())
    }

    pub fn put_string(&mut self, bump: &Bump, key: &[u8], value: &[u8]) -> Result<(), AllocError> {
        self.put(
            bump,
            key,
            Expr::init(EString::init(value), crate::Loc::EMPTY),
        )
    }

    /// Walks `rope` segments, creating nested objects as needed, and returns
    /// the leaf `E.Object` expression (Zig: `getOrPutObject`).
    pub fn get_or_put_object(&mut self, rope: &Rope, _bump: &Bump) -> Result<Expr, SetError> {
        let head_key = match rope.head.data.e_string() {
            Some(s) => s.data,
            None => return Err(SetError::Clobber),
        };
        if let Some(existing) = self.get(&head_key) {
            match existing.data {
                crate::expr::Data::EArray(array) => {
                    let Some(next) = rope.next_ref() else {
                        return Err(SetError::Clobber);
                    };
                    if let Some(last) = array.items.last() {
                        if let crate::expr::Data::EObject(mut obj) = last.data {
                            return obj.get_or_put_object(next, _bump);
                        }
                        return Err(SetError::Clobber);
                    }
                    return Err(SetError::Clobber);
                }
                crate::expr::Data::EObject(mut object) => {
                    if let Some(next) = rope.next_ref() {
                        return object.get_or_put_object(next, _bump);
                    }
                    return Ok(existing);
                }
                _ => return Err(SetError::Clobber),
            }
        }

        if let Some(next) = rope.next_ref() {
            let obj = Expr::init(Object::default(), rope.head.loc);
            let out = match obj.data {
                crate::expr::Data::EObject(mut o) => o.get_or_put_object(next, _bump)?,
                _ => unreachable!(),
            };
            VecExt::append(
                &mut self.properties,
                G::Property {
                    key: Some(rope.head),
                    value: Some(obj),
                    ..G::Property::default()
                },
            );
            return Ok(out);
        }

        let out = Expr::init(Object::default(), rope.head.loc);
        VecExt::append(
            &mut self.properties,
            G::Property {
                key: Some(rope.head),
                value: Some(out),
                ..G::Property::default()
            },
        );
        Ok(out)
    }
}

// `toJS` alias deleted — lives in `js_parser_jsc` extension trait.
impl Object {
    pub fn set(&mut self, key: Expr, _bump: &Bump, value: Expr) -> Result<(), SetError> {
        let head_key = match key.data.e_string() {
            Some(s) => s.data,
            None => return Err(SetError::Clobber),
        };
        if self.has_property(&head_key) {
            return Err(SetError::Clobber);
        }
        // Zig takes `*const Object` here and mutates through Vec's interior pointer;
        // in Rust we require `&mut self` so the borrow checker tracks the write.
        VecExt::append(
            &mut self.properties,
            G::Property {
                key: Some(key),
                value: Some(value),
                ..G::Property::default()
            },
        );
        Ok(())
    }

    // this is terribly, shamefully slow
    pub fn set_rope(&mut self, rope: &Rope, bump: &Bump, value: Expr) -> Result<(), SetError> {
        let head_key = match rope.head.data.e_string() {
            Some(s) => s.data,
            None => return Err(SetError::Clobber),
        };
        if let Some(existing) = self.get(&head_key) {
            match existing.data {
                crate::expr::Data::EArray(mut array) => {
                    let Some(next) = rope.next_ref() else {
                        array.push(bump, value)?;
                        return Ok(());
                    };

                    if let Some(last) = array.items.last_mut() {
                        if !matches!(last.data, crate::expr::Data::EObject(_)) {
                            return Err(SetError::Clobber);
                        }
                        last.data
                            .e_object_mut()
                            .unwrap()
                            .set_rope(next, bump, value)?;
                        return Ok(());
                    }

                    array.push(bump, value)?;
                    return Ok(());
                }
                crate::expr::Data::EObject(mut object) => {
                    if let Some(next) = rope.next_ref() {
                        object.set_rope(next, bump, value)?;
                        return Ok(());
                    }

                    return Err(SetError::Clobber);
                }
                _ => {
                    return Err(SetError::Clobber);
                }
            }
        }

        let mut value_ = value;
        if let Some(next) = rope.next_ref() {
            let mut obj = Expr::init(Object::default(), rope.head.loc);
            obj.data
                .e_object_mut()
                .unwrap()
                .set_rope(next, bump, value)?;
            value_ = obj;
        }

        VecExt::append(
            &mut self.properties,
            G::Property {
                key: Some(rope.head),
                value: Some(value_),
                ..G::Property::default()
            },
        );
        Ok(())
    }

    pub fn get_or_put_array(&mut self, rope: &Rope, bump: &Bump) -> Result<Expr, SetError> {
        let head_key = match rope.head.data.e_string() {
            Some(s) => s.data,
            None => return Err(SetError::Clobber),
        };
        if let Some(existing) = self.get(&head_key) {
            match existing.data {
                crate::expr::Data::EArray(mut array) => {
                    let Some(next) = rope.next_ref() else {
                        return Ok(existing);
                    };

                    if let Some(last) = array.items.last_mut() {
                        if !matches!(last.data, crate::expr::Data::EObject(_)) {
                            return Err(SetError::Clobber);
                        }
                        return last
                            .data
                            .e_object_mut()
                            .unwrap()
                            .get_or_put_array(next, bump);
                    }

                    return Err(SetError::Clobber);
                }
                crate::expr::Data::EObject(mut object) => {
                    let Some(next) = rope.next_ref() else {
                        return Err(SetError::Clobber);
                    };
                    return object.get_or_put_array(next, bump);
                }
                _ => {
                    return Err(SetError::Clobber);
                }
            }
        }

        if let Some(next) = rope.next_ref() {
            let mut obj = Expr::init(Object::default(), rope.head.loc);
            let out = obj
                .data
                .e_object_mut()
                .unwrap()
                .get_or_put_array(next, bump)?;
            VecExt::append(
                &mut self.properties,
                G::Property {
                    key: Some(rope.head),
                    value: Some(obj),
                    ..G::Property::default()
                },
            );
            return Ok(out);
        }

        let out = Expr::init(Array::default(), rope.head.loc);
        VecExt::append(
            &mut self.properties,
            G::Property {
                key: Some(rope.head),
                value: Some(out),
                ..G::Property::default()
            },
        );
        Ok(out)
    }

    /// Assumes each key in the property is a string
    pub fn alphabetize_properties(&mut self) {
        #[cfg(debug_assertions)]
        {
            for prop in self.properties.slice() {
                debug_assert!(matches!(
                    prop.key.as_ref().expect("infallible: prop has key").data,
                    crate::expr::Data::EString(_)
                ));
            }
        }
        self.properties
            .slice_mut()
            .sort_by(object_sorter_is_less_than);
    }

    pub fn package_json_sort(&mut self) {
        self.properties
            .slice_mut()
            .sort_by(package_json_sort_is_less_than);
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum PackageJsonSortFields {
    Name = 0,
    Version = 1,
    Author = 2,
    Repository = 3,
    Config = 4,
    Main = 5,
    Module = 6,
    Dependencies = 7,
    DevDependencies = 8,
    OptionalDependencies = 9,
    PeerDependencies = 10,
    Exports = 11,
    Fake = 12,
}

static PACKAGE_JSON_SORT_MAP: phf::Map<&'static [u8], PackageJsonSortFields> = phf_map! {
    b"name" => PackageJsonSortFields::Name,
    b"version" => PackageJsonSortFields::Version,
    b"author" => PackageJsonSortFields::Author,
    b"repository" => PackageJsonSortFields::Repository,
    b"config" => PackageJsonSortFields::Config,
    b"main" => PackageJsonSortFields::Main,
    b"module" => PackageJsonSortFields::Module,
    b"dependencies" => PackageJsonSortFields::Dependencies,
    b"devDependencies" => PackageJsonSortFields::DevDependencies,
    b"optionalDependencies" => PackageJsonSortFields::OptionalDependencies,
    b"peerDependencies" => PackageJsonSortFields::PeerDependencies,
    b"exports" => PackageJsonSortFields::Exports,
};

fn package_json_sort_is_less_than(lhs: &G::Property, rhs: &G::Property) -> Ordering {
    let mut lhs_key_size: u8 = PackageJsonSortFields::Fake as u8;
    let mut rhs_key_size: u8 = PackageJsonSortFields::Fake as u8;

    if let Some(k) = &lhs.key {
        if let crate::expr::Data::EString(s) = &k.data {
            lhs_key_size = *PACKAGE_JSON_SORT_MAP
                .get(&s.data)
                .unwrap_or(&PackageJsonSortFields::Fake) as u8;
        }
    }

    if let Some(k) = &rhs.key {
        if let crate::expr::Data::EString(s) = &k.data {
            rhs_key_size = *PACKAGE_JSON_SORT_MAP
                .get(&s.data)
                .unwrap_or(&PackageJsonSortFields::Fake) as u8;
        }
    }

    match lhs_key_size.cmp(&rhs_key_size) {
        Ordering::Equal => {
            // PORT NOTE: Zig `cmpStringsAsc` is `std.mem.order(u8, a, b) == .lt`; lifted to
            // a full `Ordering` so this is usable with `sort_by`.
            let a = lhs
                .key
                .as_ref()
                .unwrap()
                .data
                .e_string()
                .expect("infallible: variant checked")
                .data;
            let b = rhs
                .key
                .as_ref()
                .unwrap()
                .data
                .e_string()
                .expect("infallible: variant checked")
                .data;
            a.cmp(&b)
        }
        ord => ord,
    }
}

fn object_sorter_is_less_than(lhs: &G::Property, rhs: &G::Property) -> Ordering {
    let a = lhs
        .key
        .as_ref()
        .unwrap()
        .data
        .e_string()
        .expect("infallible: variant checked")
        .data;
    let b = rhs
        .key
        .as_ref()
        .unwrap()
        .data
        .e_string()
        .expect("infallible: variant checked")
        .data;
    a.cmp(&b)
}

pub struct Spread {
    pub value: ExprNodeIndex,
}

/// JavaScript string literal type
pub struct EString {
    pub data: Str,
    pub prefer_template: bool,

    // A very simple rope implementation
    // We only use this for string folding, so this is kind of overkill
    // We don't need to deal with substrings
    pub next: Option<StoreRef<EString>>,
    pub end: Option<StoreRef<EString>>,
    pub rope_len: u32,
    pub is_utf16: bool,
}
// Export under the Zig name `String` as well; `EString` avoids colliding with bun_core::String.
pub use EString as String;

impl Default for EString {
    fn default() -> Self {
        Self {
            data: Str::EMPTY,
            prefer_template: false,
            next: None,
            end: None,
            rope_len: 0,
            is_utf16: false,
        }
    }
}

// Minimal live surface for `IntoExprData` / `Data` / `lexer.rs` callers.
impl EString {
    #[inline]
    pub const fn is_utf8(&self) -> bool {
        !self.is_utf16
    }
    #[inline]
    pub fn slice8(&self) -> &[u8] {
        debug_assert!(!self.is_utf16);
        self.data.slice()
    }
    #[inline]
    pub fn slice16(&self) -> &[u16] {
        debug_assert!(self.is_utf16);
        // SAFETY: when `is_utf16`, `data` was constructed by `init_utf16` from a
        // `&[u16]`: `data.ptr` is the original u16-aligned pointer (reinterpreted
        // as `*const u8` for storage only) and `data.len` deliberately stores the
        // **u16 element count**, not a byte count — so the backing allocation is
        // `2 * data.len` bytes and reading `data.len` u16s is in-bounds. Can't be
        // `bytemuck::cast_slice(self.data.slice())` because that would yield
        // `len/2` u16s; the lying-length encoding is load-bearing for `len()`/
        // `javascript_length()`/`has_prefix_comptime()` and changing it is a
        // cross-crate refactor (see TODO above).
        //
        // The `c_void` hop is clippy's documented escape hatch for
        // `cast_ptr_alignment` ("alignment is externally guaranteed" — see the
        // u16-aligned invariant above); it is a no-op reinterpret, not FFI.
        unsafe {
            core::slice::from_raw_parts(
                self.data.as_ptr().cast::<core::ffi::c_void>().cast::<u16>(),
                self.data.len(),
            )
        }
    }
    /// Const constructor for `'static` literals (Prefill globals).
    pub const fn from_static(data: &'static [u8]) -> Self {
        Self {
            data: Str::new(data),
            prefer_template: false,
            next: None,
            end: None,
            rope_len: 0,
            is_utf16: false,
        }
    }
    /// `data` is arena-owned (source text or `Expr.Data.Store` / bump arena)
    /// and bulk-freed; `StoreStr` records it under the `StoreRef` contract.
    pub fn init(data: &[u8]) -> Self {
        Self {
            data: Str::new(data),
            ..Default::default()
        }
    }
    pub fn init_utf16(data: &[u16]) -> Self {
        let bytes = &bytemuck::cast_slice::<u16, u8>(data)[..data.len()];
        Self {
            data: Str::new(bytes),
            is_utf16: true,
            ..Default::default()
        }
    }
    /// E.String containing non-ascii characters may not fully work.
    /// https://github.com/oven-sh/bun/issues/11963
    /// More investigation is needed.
    pub fn init_re_encode_utf8(utf8: &[u8], bump: &Bump) -> EString {
        if strings::first_non_ascii(utf8).is_none() {
            Self::init(utf8)
        } else {
            // PERF(port): Zig allocated directly in arena; here we transcode to a
            // heap Vec then copy into the bump arena — profile.
            let utf16 = strings::to_utf16_alloc_for_real(utf8, false, false).expect("unreachable"); // fail_if_invalid=false → never errors
            let arena_slice: &mut [u16] = bump.alloc_slice_copy(&utf16);
            Self::init_utf16(arena_slice)
        }
    }
    /// Ensure `data` is UTF-8 (transcode from UTF-16 rope if needed).
    /// `lexer.rs::to_utf8_e_string` only ever calls this on a freshly-decoded
    /// non-rope string; the heavy rope-walk path is in the gated impl below.
    pub fn to_utf8(&mut self, bump: &Bump) -> Result<(), AllocError> {
        if !self.is_utf16 {
            return Ok(());
        }
        let v = strings::to_utf8_alloc(self.slice16());
        self.data = Str::new(bump.alloc_slice_copy(&v));
        self.is_utf16 = false;
        Ok(())
    }
}

impl EString {
    #[inline]
    pub fn len(&self) -> usize {
        if self.rope_len > 0 {
            self.rope_len as usize
        } else {
            self.data.len()
        }
    }
    #[inline]
    pub fn is_blank(&self) -> bool {
        self.len() == 0
    }
    #[inline]
    pub fn is_present(&self) -> bool {
        self.len() > 0
    }

    /// Zig `slice8()` alias used by some downstream callers as `.utf8()`.
    #[inline]
    pub fn utf8(&self) -> &[u8] {
        self.slice8()
    }

    /// Zig: `slice(arena)` — flatten any rope and return UTF-8 bytes.
    /// Resolves the rope into the bump arena, then transcodes if UTF-16.
    pub fn slice<'b>(&mut self, bump: &'b Bump) -> &'b [u8] {
        self.resolve_rope_if_needed(bump);
        self.string(bump).expect("OOM")
    }

    pub fn eql_bytes(&self, other: &[u8]) -> bool {
        if self.is_utf8() {
            strings::eql_long(&self.data, other, true)
        } else {
            strings::utf16_eql_string(self.slice16(), other)
        }
    }

    pub fn eql_comptime(&self, value: &'static [u8]) -> bool {
        if !self.is_utf8() {
            debug_assert!(self.next.is_none(), "transpiler: utf-16 string is a rope");
            return strings::eql_comptime_utf16(self.slice16(), value);
        }
        if self.next.is_none() {
            return self.data == value;
        }
        self.eql8_rope(value)
    }

    fn eql8_rope(&self, value: &[u8]) -> bool {
        debug_assert!(self.next.is_some() && self.is_utf8());
        if self.rope_len as usize != value.len() {
            return false;
        }
        let mut i = 0usize;
        let mut next: Option<&EString> = Some(self);
        while let Some(cur) = next {
            if !strings::eql_long(&cur.data, &value[i..i + cur.data.len()], false) {
                return false;
            }
            i += cur.data.len();
            next = cur.next.as_ref().map(|r| r.get());
        }
        true
    }

    pub fn resolve_rope_if_needed(&mut self, bump: &Bump) {
        if self.next.is_none() || !self.is_utf8() {
            return;
        }
        let mut bytes = bun_alloc::ArenaVec::<u8>::with_capacity_in(self.rope_len as usize, bump);
        bytes.extend_from_slice(&self.data);
        let mut str_ = self.next;
        while let Some(part) = str_ {
            bytes.extend_from_slice(&part.get().data);
            str_ = part.get().next;
        }
        self.data = Str::new(bytes.into_bump_slice());
        self.next = None;
    }

    /// Zig `string(arena)` — return UTF-8 bytes, transcoding if UTF-16.
    /// The transcode allocates via the global arena then copies into
    /// `bump` (Zig used the passed arena directly).
    pub fn string<'b>(&self, bump: &'b Bump) -> Result<&'b [u8], AllocError> {
        if self.is_utf8() {
            // `self.data` is arena-owned with the same lifetime as `bump`
            // (Zig invariant); StoreStr re-borrows under that contract.
            Ok(self.data.slice())
        } else {
            let v = strings::to_utf8_alloc(self.slice16());
            Ok(bump.alloc_slice_copy(&v))
        }
    }

    pub fn string_cloned<'b>(&self, bump: &'b Bump) -> Result<&'b [u8], AllocError> {
        if self.is_utf8() {
            Ok(bump.alloc_slice_copy(&self.data))
        } else {
            let v = strings::to_utf8_alloc(self.slice16());
            Ok(bump.alloc_slice_copy(&v))
        }
    }

    pub fn hash(&self) -> u64 {
        if self.is_blank() {
            return 0;
        }
        if self.is_utf8() {
            bun_wyhash::hash(&self.data)
        } else {
            bun_wyhash::hash(bytemuck::cast_slice::<u16, u8>(self.slice16()))
        }
    }
}

// ── EString surface ────────────────────────────────────────────────────────
// Ordering / equality / const-literal / rope-mutation helpers.
// `string_z`/`to_zig_string` remain gated on `bun_core::ZStr` arena constructors.
impl EString {
    pub const CLASS: EString = EString::from_static(b"class");
    pub const EMPTY: EString = EString::from_static(b"");
    pub const TRUE: EString = EString::from_static(b"true");
    pub const FALSE: EString = EString::from_static(b"false");
    pub const NULL: EString = EString::from_static(b"null");
    pub const UNDEFINED: EString = EString::from_static(b"undefined");

    pub fn is_identifier(&mut self, bump: &Bump) -> bool {
        if !self.is_utf8() {
            return crate::lexer_tables::is_identifier_utf16(self.slice16());
        }
        crate::lexer_tables::is_identifier(self.slice(bump))
    }

    /// Compares two strings lexicographically for JavaScript semantics.
    /// Both strings must share the same encoding (UTF-8 vs UTF-16).
    #[inline]
    pub fn order(&self, other: &EString) -> Ordering {
        debug_assert!(self.is_utf8() == other.is_utf8());
        if self.is_utf8() {
            strings::order(&self.data, &other.data)
        } else {
            strings::order_t(self.slice16(), other.slice16())
        }
    }

    pub fn clone(&self, bump: &Bump) -> Result<EString, AllocError> {
        Ok(EString {
            data: Str::new(bump.alloc_slice_copy(&self.data)),
            prefer_template: self.prefer_template,
            is_utf16: !self.is_utf8(),
            ..EString::default()
        })
    }

    pub fn clone_slice_if_necessary<'b>(&self, bump: &'b Bump) -> Result<&'b [u8], AllocError> {
        if self.is_utf8() {
            return Ok(bump.alloc_slice_copy(self.string(bump).expect("unreachable")));
        }
        self.string(bump)
    }

    pub fn javascript_length(&self) -> Option<u32> {
        if self.rope_len > 0 {
            // We only support ascii ropes for now
            return Some(self.rope_len);
        }
        if self.is_utf8() {
            if !strings::is_all_ascii(&self.data) {
                return None;
            }
            return Some(self.data.len() as u32);
        }
        Some(self.slice16().len() as u32)
    }

    // Zig `eql(comptime _t: type, other: anytype)` — split by operand type.
    pub fn eql_string(&self, other: &EString) -> bool {
        if self.is_utf8() {
            if other.is_utf8() {
                strings::eql_long(&self.data, &other.data, true)
            } else {
                strings::utf16_eql_string(other.slice16(), &self.data)
            }
        } else if other.is_utf8() {
            strings::utf16_eql_string(self.slice16(), &other.data)
        } else {
            self.slice16() == other.slice16()
        }
    }

    pub fn eql_utf16(&self, other: &[u16]) -> bool {
        if self.is_utf8() {
            strings::utf16_eql_string(other, &self.data)
        } else {
            other == self.slice16()
        }
    }

    #[inline]
    pub fn shallow_clone(&self) -> EString {
        EString {
            data: self.data,
            prefer_template: self.prefer_template,
            next: self.next,
            end: self.end,
            rope_len: self.rope_len,
            is_utf16: self.is_utf16,
        }
    }

    pub fn has_prefix_comptime(&self, value: &'static [u8]) -> bool {
        if self.data.len() < value.len() {
            return false;
        }
        if self.is_utf8() {
            &self.data[..value.len()] == value
        } else {
            strings::eql_comptime_utf16(&self.slice16()[..value.len()], value)
        }
    }

    pub fn push(&mut self, other: &mut EString) {
        debug_assert!(self.is_utf8());
        debug_assert!(other.is_utf8());

        if other.rope_len == 0 {
            other.rope_len = other.data.len() as u32;
        }
        if self.rope_len == 0 {
            self.rope_len = self.data.len() as u32;
        }
        self.rope_len += other.rope_len;

        // Caller contract — `other` lives in the AST Store/arena and outlives
        // the next reset; capturing its address as a `StoreRef` is the Zig
        // `*E.String` semantics.
        let other_ref = StoreRef::from_bump(other);
        if self.next.is_none() {
            self.next = Some(other_ref);
            self.end = Some(other_ref);
        } else {
            let mut end = self.end.unwrap();
            while end.get().next.is_some() {
                end = end.get().end.unwrap();
            }
            // `end` points into the live Store; rope nodes are mutated in
            // place via `StoreRef::DerefMut` (single-threaded visitor).
            end.next = Some(other_ref);
            self.end = Some(other_ref);
        }
    }

    /// Cloning the rope string is rarely needed, see `foldStringAddition`'s
    /// comments and the 'edgecase/EnumInliningRopeStringPoison' test
    pub fn clone_rope_nodes(s: &EString) -> EString {
        let mut root = s.shallow_clone();
        if let Some(first) = root.next {
            let mut tail: StoreRef<EString> =
                crate::expr::data::Store::append(first.get().shallow_clone());
            root.next = Some(tail);
            while let Some(next) = tail.next {
                let cloned = crate::expr::data::Store::append(next.get().shallow_clone());
                tail.next = Some(cloned);
                tail = cloned;
            }
            root.end = Some(tail);
        }
        root
    }
}

fn array_sorter_is_less_than(lhs: &Expr, rhs: &Expr) -> Ordering {
    lhs.data.e_string().unwrap().order(
        rhs.data
            .e_string()
            .expect("infallible: variant checked")
            .get(),
    )
}

impl EString {
    pub fn string_z<'b>(&self, bump: &'b Bump) -> Result<&'b bun_core::ZStr, AllocError> {
        // Zig: `if (self.isUTF8()) self.data else strings.toUTF8AllocZ(...)`, NUL-terminated.
        // Port: copy into the bump arena with a trailing NUL and wrap as `ZStr`.
        let bytes: &[u8] = if self.is_utf8() {
            &self.data
        } else {
            let v = strings::to_utf8_alloc(self.slice16());
            bump.alloc_slice_copy(&v)
        };
        let mut buf = bun_alloc::ArenaVec::<u8>::with_capacity_in(bytes.len() + 1, bump);
        buf.extend_from_slice(bytes);
        buf.push(0);
        let s = buf.into_bump_slice();
        // SAFETY: `s[len-1] == 0` (just pushed) and `s[..len-1]` is readable for `'b`.
        Ok(bun_core::ZStr::from_slice_with_nul(s))
    }

    // `toJS` alias deleted — lives in `js_parser_jsc` extension trait.

    pub fn to_zig_string(&mut self, bump: &Bump) -> ZigString {
        if self.is_utf8() {
            ZigString::from_utf8(self.slice(bump))
        } else {
            ZigString::init_utf16(self.slice16())
        }
    }
}

impl fmt::Display for EString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("E.String")?;
        if self.next.is_none() {
            f.write_str("(")?;
            if self.is_utf8() {
                write!(f, "\"{}\"", bstr::BStr::new(&self.data))?;
            } else {
                write!(f, "\"{}\"", bun_core::fmt::utf16(self.slice16()))?;
            }
            f.write_str(")")?;
        } else {
            f.write_str("(rope: [")?;
            let mut it: Option<&EString> = Some(self);
            while let Some(part) = it {
                if part.is_utf8() {
                    write!(f, "\"{}\"", bstr::BStr::new(&part.data))?;
                } else {
                    write!(f, "\"{}\"", bun_core::fmt::utf16(part.slice16()))?;
                }
                it = part.next.as_deref();
                if it.is_some() {
                    f.write_str(" ")?;
                }
            }
            f.write_str("])")?;
        }
        Ok(())
    }
}

// value is in the Node
pub struct TemplatePart {
    pub value: ExprNodeIndex,
    pub tail_loc: crate::Loc,
    pub tail: TemplateContents,
}

pub struct Template {
    pub tag: Option<ExprNodeIndex>,
    pub parts: crate::StoreSlice<TemplatePart>,
    pub head: TemplateContents,
}

impl Template {
    /// Empty `StoreSlice<TemplatePart>` for parts-less templates (e.g. tagged
    /// no-substitution literals).
    #[inline]
    pub fn empty_parts() -> crate::StoreSlice<TemplatePart> {
        crate::StoreSlice::EMPTY
    }

    #[inline]
    pub fn parts(&self) -> &[TemplatePart] {
        self.parts.slice()
    }

    #[inline]
    pub fn parts_mut(&mut self) -> &mut [TemplatePart] {
        self.parts.slice_mut()
    }
}

pub enum TemplateContents {
    Cooked(EString),
    Raw(Str),
}
impl TemplateContents {
    pub fn is_utf8(&self) -> bool {
        matches!(self, TemplateContents::Cooked(c) if c.is_utf8())
    }

    bun_core::enum_unwrap!(pub TemplateContents, Cooked => fn cooked / cooked_mut -> EString);
}

impl TemplateContents {
    /// Field-wise copy (Zig: `var part = part.*`). `EString` is structurally
    /// `Copy` but does not derive it; use `shallow_clone` for the cooked arm.
    #[inline]
    pub(crate) fn shallow_clone(&self) -> TemplateContents {
        match self {
            TemplateContents::Cooked(c) => TemplateContents::Cooked(c.shallow_clone()),
            TemplateContents::Raw(r) => TemplateContents::Raw(*r),
        }
    }
}

impl Template {
    /// "`a${'b'}c`" => "`abc`"
    pub fn fold(&mut self, bump: &Bump, loc: crate::Loc) -> Expr {
        if self.tag.is_some()
            || (matches!(self.head, TemplateContents::Cooked(_)) && !self.head.cooked().is_utf8())
        {
            // we only fold utf-8/ascii for now
            // `self` is Store/arena-allocated (Zig: `*Template`); capturing its
            // address as a `StoreRef` mirrors `.{ .e_template = self }`.
            return Expr {
                data: crate::expr::Data::ETemplate(StoreRef::from_bump(self)),
                loc,
            };
        }

        debug_assert!(matches!(self.head, TemplateContents::Cooked(_)));

        if self.parts().is_empty() {
            return Expr::init(core::mem::take(self.head.cooked_mut()), loc);
        }

        let mut parts =
            bun_alloc::ArenaVec::<TemplatePart>::with_capacity_in(self.parts().len(), bump);
        let mut head = Expr::init(core::mem::take(self.head.cooked_mut()), loc);
        for part_src in self.parts() {
            // Zig `var part = part.*` — field-wise copy (TemplatePart is not `Copy` only
            // because `EString` does not derive it; all fields are structurally `Copy`).
            let mut part = TemplatePart {
                value: part_src.value,
                tail_loc: part_src.tail_loc,
                tail: part_src.tail.shallow_clone(),
            };
            debug_assert!(matches!(part.tail, TemplateContents::Cooked(_)));

            part.value = part.value.unwrap_inlined();

            match &part.value.data {
                crate::expr::Data::ENumber(n) => {
                    if let Some(s) = n.to_string(bump) {
                        part.value = Expr::init(EString::init(&s), part.value.loc);
                    }
                }
                crate::expr::Data::ENull(_) => {
                    part.value = Expr::init(EString::init(b"null"), part.value.loc);
                }
                crate::expr::Data::EBoolean(b) => {
                    part.value = Expr::init(
                        EString::init(if b.value { &b"true"[..] } else { &b"false"[..] }),
                        part.value.loc,
                    );
                }
                crate::expr::Data::EUndefined(_) => {
                    part.value = Expr::init(EString::init(b"undefined"), part.value.loc);
                }
                crate::expr::Data::EBigInt(value) => {
                    part.value = Expr::init(EString::init(&value.value), part.value.loc);
                }
                _ => {}
            }

            if matches!(part.value.data, crate::expr::Data::EString(_))
                && part.tail.cooked().is_utf8()
                && part
                    .value
                    .data
                    .e_string()
                    .expect("infallible: variant checked")
                    .is_utf8()
            {
                if parts.is_empty() {
                    if part
                        .value
                        .data
                        .e_string()
                        .expect("infallible: variant checked")
                        .len()
                        > 0
                    {
                        head.data
                            .e_string_mut()
                            .expect("infallible: variant checked")
                            .push(
                                Expr::init(
                                    part.value
                                        .data
                                        .e_string()
                                        .expect("infallible: variant checked")
                                        .shallow_clone(),
                                    crate::Loc::EMPTY,
                                )
                                .data
                                .e_string_mut()
                                .unwrap(),
                            );
                    }

                    if part.tail.cooked().len() > 0 {
                        head.data
                            .e_string_mut()
                            .expect("infallible: variant checked")
                            .push(
                                Expr::init(core::mem::take(part.tail.cooked_mut()), part.tail_loc)
                                    .data
                                    .e_string_mut()
                                    .unwrap(),
                            );
                    }

                    continue;
                } else {
                    let prev_part = parts.last_mut().unwrap();
                    debug_assert!(matches!(prev_part.tail, TemplateContents::Cooked(_)));

                    if prev_part.tail.cooked().is_utf8() {
                        if part
                            .value
                            .data
                            .e_string()
                            .expect("infallible: variant checked")
                            .len()
                            > 0
                        {
                            prev_part.tail.cooked_mut().push(
                                Expr::init(
                                    part.value
                                        .data
                                        .e_string()
                                        .expect("infallible: variant checked")
                                        .shallow_clone(),
                                    crate::Loc::EMPTY,
                                )
                                .data
                                .e_string_mut()
                                .unwrap(),
                            );
                        }

                        if part.tail.cooked().len() > 0 {
                            prev_part.tail.cooked_mut().push(
                                Expr::init(core::mem::take(part.tail.cooked_mut()), part.tail_loc)
                                    .data
                                    .e_string_mut()
                                    .unwrap(),
                            );
                        }
                    } else {
                        // PERF(port): was appendAssumeCapacity — profile
                        parts.push(part);
                    }
                }
            } else {
                // PERF(port): was appendAssumeCapacity — profile
                parts.push(part);
            }
        }

        if parts.is_empty() {
            // parts.deinit() — drop is implicit
            head.data
                .e_string_mut()
                .expect("infallible: variant checked")
                .resolve_rope_if_needed(bump);
            return head;
        }

        // Arena-owned mutable slice; `into_bump_slice_mut()` preserves write
        // provenance for downstream mutators (Zig: `parts.items`).
        Expr::init(
            Template {
                tag: None,
                parts: crate::StoreSlice::from_bump(parts),
                head: TemplateContents::Cooked(
                    head.data
                        .e_string()
                        .expect("infallible: variant checked")
                        .shallow_clone(),
                ),
            },
            loc,
        )
    }
}

pub struct RegExp {
    // TODO(port): arena-owned slice
    pub value: Str,

    pub flags_offset: Option<u16>,
}
impl RegExp {
    pub const EMPTY: RegExp = RegExp {
        value: Str::EMPTY,
        flags_offset: None,
    };

    pub fn pattern(&self) -> &[u8] {
        if let Some(i_) = self.flags_offset {
            let mut i = i_;
            while i > 0 && self.value[i as usize] != b'/' {
                i -= 1;
            }

            return bun_core::trim(&self.value[..i as usize], b"/");
        }

        bun_core::trim(&self.value, b"/")
    }

    pub fn flags(&self) -> &[u8] {
        if let Some(i) = self.flags_offset {
            return &self.value[i as usize..];
        }

        b""
    }
}

pub struct Await {
    pub value: ExprNodeIndex,
}

#[derive(Default)]
pub struct Yield {
    pub value: Option<ExprNodeIndex>,
    pub is_star: bool,
}

pub struct If {
    pub test_: ExprNodeIndex,
    pub yes: ExprNodeIndex,
    pub no: ExprNodeIndex,
}

#[derive(Clone, Copy)]
pub struct RequireString {
    pub import_record_index: u32,

    pub unwrapped_id: u32,
}
impl Default for RequireString {
    fn default() -> Self {
        Self {
            import_record_index: 0,
            unwrapped_id: u32::MAX,
        }
    }
}

#[derive(Clone, Copy)]
pub struct RequireResolveString {
    pub import_record_index: u32,
    // close_paren_loc: logger.Loc = logger.Loc.Empty,
}

pub struct InlinedEnum {
    pub value: ExprNodeIndex,
    // TODO(port): arena-owned slice
    pub comment: Str,
}

pub struct Import {
    pub expr: ExprNodeIndex,
    pub options: ExprNodeIndex,
    pub import_record_index: u32,
}
impl Import {
    pub fn is_import_record_null(&self) -> bool {
        self.import_record_index == u32::MAX
    }

    pub fn import_record_loader(&self) -> Option<crate::Loader> {
        // This logic is duplicated in js_printer.zig fn parsePath()
        let crate::ExprData::EObject(obj) = &self.options.data else {
            return None;
        };
        let with = Object::get(obj, b"with").or_else(|| Object::get(obj, b"assert"))?;
        let crate::ExprData::EObject(with_obj) = &with.data else {
            return None;
        };
        let str_ = Object::get(with_obj, b"type")?.data.as_e_string()?;

        if !str_.is_utf16 {
            if let Some(loader) = crate::Loader::from_string(&str_.data) {
                if loader == crate::Loader::Sqlite {
                    let Some(embed) = Object::get(with_obj, b"embed") else {
                        return Some(loader);
                    };
                    let Some(embed_str) = embed.data.as_e_string() else {
                        return Some(loader);
                    };
                    if embed_str.eql_comptime(b"true") {
                        return Some(crate::Loader::SqliteEmbedded);
                    }
                }
                return Some(loader);
            }
        }

        None
    }
}

pub use G::Class;

// ported from: src/js_parser/ast/E.zig
