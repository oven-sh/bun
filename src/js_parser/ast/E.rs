//! E — expression node payloads for the JS AST.
//!
//! Port of `src/js_parser/ast/E.zig`.

use core::cmp::Ordering;
use core::fmt;

use bumpalo::Bump;
use phf::phf_map;

use bun_alloc::{AllocError, Arena};
use bun_collections::BabyList;
use bun_core as core_;
use bun_logger as logger;
use bun_options_types::ImportRecord;
use bun_str::strings;
use bun_str::ZigString;

use crate::ast::{
    self as js_ast, Expr, ExprNodeIndex, ExprNodeList, Flags, G, Op, OptionalChain, Ref, StoreRef,
};

// In Zig: `const string = []const u8;`
// AST string fields are arena-owned (bulk-freed via Store/arena reset; never individually
// freed). Phase A models them as `&'static [u8]` to keep node types lifetime-free; Phase B
// will likely introduce a `StoreSlice`/`&'arena [u8]` newtype.
// TODO(port): arena-owned slice lifetime — revisit in Phase B.
type Str = &'static [u8];

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
        Self { ref_: Ref::NONE, has_property_key_comment: false }
    }
}

pub struct Array {
    pub items: ExprNodeList,
    pub comma_after_spread: Option<logger::Loc>,
    pub is_single_line: bool,
    pub is_parenthesized: bool,
    pub was_originally_macro: bool,
    pub close_bracket_loc: logger::Loc,
}
impl Default for Array {
    fn default() -> Self {
        Self {
            items: ExprNodeList::default(),
            comma_after_spread: None,
            is_single_line: false,
            is_parenthesized: false,
            was_originally_macro: false,
            close_bracket_loc: logger::Loc::EMPTY,
        }
    }
}
impl Array {
    pub fn push(&mut self, bump: &Bump, item: Expr) -> Result<(), AllocError> {
        self.items.append(bump, item)
    }

    #[inline]
    pub fn slice(&self) -> &[Expr] {
        self.items.slice()
    }

    pub fn inline_spread_of_array_literals(
        &mut self,
        bump: &Bump,
        estimated_count: usize,
    ) -> Result<ExprNodeList, AllocError> {
        // This over-allocates a little but it's fine
        let mut out: BabyList<Expr> =
            BabyList::init_capacity(bump, estimated_count + self.items.len() as usize)?;
        out.expand_to_capacity();
        let mut remain = out.slice_mut();
        for item in self.items.slice() {
            match &item.data {
                Expr::Data::ESpread(val) => {
                    if let Expr::Data::EArray(inner) = &val.value.data {
                        for inner_item in inner.items.slice() {
                            if matches!(inner_item.data, Expr::Data::EMissing(_)) {
                                remain[0] = Expr::init(Undefined {}, inner_item.loc);
                                remain = &mut remain[1..];
                            } else {
                                remain[0] = *inner_item;
                                remain = &mut remain[1..];
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

            remain[0] = *item;
            remain = &mut remain[1..];
        }

        // PORT NOTE: reshaped for borrowck — capture remain.len() before re-borrowing `out`.
        let remain_len = remain.len();
        out.shrink_retaining_capacity(out.len() - u32::try_from(remain_len).unwrap());
        Ok(out)
    }

    // `pub const toJS = @import("../../js_parser_jsc/expr_jsc.zig").arrayToJS;` — deleted per
    // PORTING.md (jsc extension trait lives in `js_parser_jsc` crate).

    /// Assumes each item in the array is a string
    pub fn alphabetize_strings(&mut self) {
        if cfg!(debug_assertions) {
            for item in self.items.slice() {
                debug_assert!(matches!(item.data, Expr::Data::EString(_)));
            }
        }
        self.items.slice_mut().sort_by(array_sorter_is_less_than);
    }
}

fn array_sorter_is_less_than(lhs: &Expr, rhs: &Expr) -> Ordering {
    // Zig: strings.cmpStringsAsc(ctx, lhs.data.e_string.data, rhs.data.e_string.data)
    strings::cmp_strings_asc(lhs.data.e_string().data, rhs.data.e_string().data)
}

pub struct Unary {
    pub op: Op::Code,
    pub value: ExprNodeIndex,
    pub flags: UnaryFlags,
}

bitflags::bitflags! {
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    #[repr(transparent)]
    pub struct UnaryFlags: u8 {
        /// The expression "typeof (0, x)" must not become "typeof x" if "x"
        /// is unbound because that could suppress a ReferenceError from "x".
        ///
        /// Also if we know a typeof operator was originally an identifier, then
        /// we know that this typeof operator always has no side effects (even if
        /// we consider the identifier by itself to have a side effect).
        ///
        /// Note that there *is* actually a case where "typeof x" can throw an error:
        /// when "x" is being referenced inside of its TDZ (temporal dead zone). TDZ
        /// checks are not yet handled correctly by Bun, so this possibility is
        /// currently ignored.
        const WAS_ORIGINALLY_TYPEOF_IDENTIFIER = 1 << 0;

        /// Similarly the expression "delete (0, x)" must not become "delete x"
        /// because that syntax is invalid in strict mode. We also need to make sure
        /// we don't accidentally change the return value:
        ///
        ///   Returns false:
        ///     "var a; delete (a)"
        ///     "var a = Object.freeze({b: 1}); delete (a.b)"
        ///     "var a = Object.freeze({b: 1}); delete (a?.b)"
        ///     "var a = Object.freeze({b: 1}); delete (a['b'])"
        ///     "var a = Object.freeze({b: 1}); delete (a?.['b'])"
        ///
        ///   Returns true:
        ///     "var a; delete (0, a)"
        ///     "var a = Object.freeze({b: 1}); delete (true && a.b)"
        ///     "var a = Object.freeze({b: 1}); delete (false || a?.b)"
        ///     "var a = Object.freeze({b: 1}); delete (null ?? a?.['b'])"
        ///
        ///     "var a = Object.freeze({b: 1}); delete (true ? a['b'] : a['b'])"
        const WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS = 1 << 1;
    }
}

pub struct Binary {
    pub left: ExprNodeIndex,
    pub right: ExprNodeIndex,
    pub op: Op::Code,
}

#[derive(Clone, Copy)]
pub struct Boolean {
    pub value: bool,
}
// `toJS` alias deleted — lives in `js_parser_jsc` extension trait.

#[derive(Clone, Copy, Default)]
pub struct Super;
#[derive(Clone, Copy, Default)]
pub struct Null;
#[derive(Clone, Copy, Default)]
pub struct This;
#[derive(Clone, Copy, Default)]
pub struct Undefined;

pub struct New {
    pub target: ExprNodeIndex,
    pub args: ExprNodeList,

    /// True if there is a comment containing "@__PURE__" or "#__PURE__" preceding
    /// this call expression. See the comment inside ECall for more details.
    pub can_be_unwrapped_if_unused: CallUnwrap,

    pub close_parens_loc: logger::Loc,
}

#[derive(Clone, Copy)]
pub struct NewTarget {
    pub range: logger::Range,
}

#[derive(Clone, Copy, Default)]
pub struct ImportMeta;

#[derive(Clone, Copy, Default)]
pub struct ImportMetaMain {
    /// If we want to print `!import.meta.main`, set this flag to true
    /// instead of wrapping in a unary not. This way, the printer can easily
    /// print `require.main != module` instead of `!(require.main == module)`
    pub inverted: bool,
}

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
    ResolvedSpecifierString(ImportRecord::Index),
}

pub struct Call {
    // Node:
    pub target: ExprNodeIndex,
    pub args: ExprNodeList,
    pub optional_chain: Option<OptionalChain>,
    pub is_direct_eval: bool,
    pub close_paren_loc: logger::Loc,

    /// True if there is a comment containing "@__PURE__" or "#__PURE__" preceding
    /// this call expression. This is an annotation used for tree shaking, and
    /// means that the call can be removed if it's unused. It does not mean the
    /// call is pure (e.g. it may still return something different if called twice).
    ///
    /// Note that the arguments are not considered to be part of the call. If the
    /// call itself is removed due to this annotation, the arguments must remain
    /// if they have side effects.
    pub can_be_unwrapped_if_unused: CallUnwrap,

    /// Used when printing to generate the source prop on the fly
    pub was_jsx_element: bool,
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
    pub name_loc: logger::Loc,
    pub optional_chain: Option<OptionalChain>,

    /// If true, this property access is known to be free of side-effects. That
    /// means it can be removed if the resulting value isn't used.
    pub can_be_removed_if_unused: bool,

    /// If true, this property access is a function that, when called, can be
    /// unwrapped if the resulting value is unused. Unwrapping means discarding
    /// the call target but keeping any arguments with side effects.
    pub call_can_be_unwrapped_if_unused: CallUnwrap,
}
impl Dot {
    pub fn has_same_flags_as(&self, b: &Dot) -> bool {
        // TODO(port): Zig refers to `a.is_direct_eval` which does not exist on Dot;
        // mirroring the (likely buggy) Zig literally would not compile. Preserving
        // the three fields that DO exist; revisit in Phase B.
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
    // TODO(port): arena-owned slice
    pub args: &'static [G::Arg],
    pub body: G::FnBody,

    pub is_async: bool,
    pub has_rest_arg: bool,
    /// Use shorthand if true and "Body" is a single return statement
    pub prefer_expr: bool,
}
impl Arrow {
    pub const NOOP_RETURN_UNDEFINED: Arrow = Arrow {
        args: &[],
        body: G::FnBody { loc: logger::Loc::EMPTY, stmts: &[] },
        is_async: false,
        has_rest_arg: false,
        prefer_expr: false,
    };
}

pub struct Function {
    pub func: G::Fn,
}

#[derive(Clone, Copy)]
pub struct Identifier {
    pub ref_: Ref,

    /// If we're inside a "with" statement, this identifier may be a property
    /// access. In that case it would be incorrect to remove this identifier since
    /// the property access may be a getter or setter with side effects.
    pub must_keep_due_to_with_stmt: bool,

    /// If true, this identifier is known to not have a side effect (i.e. to not
    /// throw an exception) when referenced. If false, this identifier may or
    /// not have side effects when referenced. This is used to allow the removal
    /// of known globals such as "Object" if they aren't used.
    pub can_be_removed_if_unused: bool,

    /// If true, this identifier represents a function that, when called, can be
    /// unwrapped if the resulting value is unused. Unwrapping means discarding
    /// the call target but keeping any arguments with side effects.
    pub call_can_be_unwrapped_if_unused: bool,
}
impl Default for Identifier {
    fn default() -> Self {
        Self {
            ref_: Ref::NONE,
            must_keep_due_to_with_stmt: false,
            can_be_removed_if_unused: false,
            call_can_be_unwrapped_if_unused: false,
        }
    }
}
impl Identifier {
    #[inline]
    pub fn init(ref_: Ref) -> Identifier {
        Identifier {
            ref_,
            must_keep_due_to_with_stmt: false,
            can_be_removed_if_unused: false,
            call_can_be_unwrapped_if_unused: false,
        }
    }
}

/// This is similar to an `Identifier` but it represents a reference to an ES6
/// import item.
///
/// Depending on how the code is linked, the file containing this EImportIdentifier
/// may or may not be in the same module group as the file it was imported from.
///
/// If it's the same module group than we can just merge the import item symbol
/// with the corresponding symbol that was imported, effectively renaming them
/// to be the same thing and statically binding them together.
///
/// But if it's a different module group, then the import must be dynamically
/// evaluated using a property access off the corresponding namespace symbol,
/// which represents the result of a require() call.
///
/// It's stored as a separate type so it's not easy to confuse with a plain
/// identifier. For example, it'd be bad if code trying to convert "{x: x}" into
/// "{x}" shorthand syntax wasn't aware that the "x" in this case is actually
/// "{x: importedNamespace.x}". This separate type forces code to opt-in to
/// doing this instead of opt-out.
#[derive(Clone, Copy)]
pub struct ImportIdentifier {
    pub ref_: Ref,

    /// If true, this was originally an identifier expression such as "foo". If
    /// false, this could potentially have been a member access expression such
    /// as "ns.foo" off of an imported namespace object.
    pub was_originally_identifier: bool,
}
impl Default for ImportIdentifier {
    fn default() -> Self {
        Self { ref_: Ref::NONE, was_originally_identifier: false }
    }
}

/// This is a dot expression on exports, such as `exports.<ref>`. It is given
/// it's own AST node to allow CommonJS unwrapping, in which this can just be
/// the identifier in the Ref
#[derive(Clone, Copy)]
pub struct CommonJSExportIdentifier {
    pub ref_: Ref,
    pub base: CommonJSExportIdentifierBase,
}
impl Default for CommonJSExportIdentifier {
    fn default() -> Self {
        Self { ref_: Ref::NONE, base: CommonJSExportIdentifierBase::Exports }
    }
}

/// The original variant of the dot expression must be known so that in the case that we
/// - fail to convert this to ESM
/// - ALSO see an assignment to `module.exports` (commonjs_module_exports_assigned_deoptimized)
/// It must be known if `exports` or `module.exports` was written in source
/// code, as the distinction will alter behavior. The fixup happens in the printer when
/// printing this node.
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

/// In development mode, the new JSX transform has a few special props
/// - `React.jsxDEV(type, arguments, key, isStaticChildren, source, self)`
/// - `arguments`:
///      ```{ ...props, children: children, }```
/// - `source`: https://github.com/babel/babel/blob/ef87648f3f05ccc393f89dea7d4c7c57abf398ce/packages/babel-plugin-transform-react-jsx-source/src/index.js#L24-L48
///      ```{
///         fileName: string | null,
///         columnNumber: number | null,
///         lineNumber: number | null,
///      }```
/// - `children`:
///     - static the function is React.jsxsDEV, "jsxs" instead of "jsx"
///     - one child? the function is React.jsxDEV,
///     - no children? the function is React.jsxDEV and children is an empty array.
/// `isStaticChildren`: https://github.com/facebook/react/blob/4ca62cac45c288878d2532e5056981d177f9fdac/packages/react/src/jsx/ReactJSXElementValidator.js#L369-L384
///     This flag means children is an array of JSX Elements literals.
///     The documentation on this is sparse, but it appears that
///     React just calls Object.freeze on the children array.
///     Object.freeze, historically, is quite a bit slower[0] than just not doing that.
///     Given that...I am choosing to always pass "false" to this.
///     This also skips extra state that we'd need to track.
///     If React Fast Refresh ends up using this later, then we can revisit this decision.
///  [0]: https://github.com/automerge/automerge/issues/177
pub struct JSXElement {
    /// JSX tag name
    /// `<div>` => E.String.init("div")
    /// `<MyComponent>` => E.Identifier{.ref = symbolPointingToMyComponent }
    /// null represents a fragment
    pub tag: Option<ExprNodeIndex>,

    /// JSX props
    pub properties: G::PropertyList,

    /// JSX element children `<div>{this_is_a_child_element}</div>`
    pub children: ExprNodeList,

    /// needed to make sure parse and visit happen in the same order
    pub key_prop_index: i32,

    pub flags: Flags::JSXElement::Bitset,

    pub close_tag_loc: logger::Loc,
}
impl Default for JSXElement {
    fn default() -> Self {
        Self {
            tag: None,
            properties: G::PropertyList::default(),
            children: ExprNodeList::default(),
            key_prop_index: -1,
            flags: Flags::JSXElement::Bitset::default(),
            close_tag_loc: logger::Loc::EMPTY,
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
    pub static MAP: phf::Map<&'static [u8], JSXSpecialProp> = phf_map! {
        b"__self" => JSXSpecialProp::UnderscoreSelf,
        b"__source" => JSXSpecialProp::UnderscoreSource,
        b"key" => JSXSpecialProp::Key,
        b"ref" => JSXSpecialProp::Ref,
    };
}

#[derive(Clone, Copy, Default)]
pub struct Missing;
impl Missing {
    // TODO(port): jsonStringify — Zig std.json protocol; Phase B picks a serde strategy.
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error> {
        let _ = writer;
        // writer.write(null)
        todo!("jsonStringify protocol")
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
    /// String concatenation with numbers is required by the TypeScript compiler for
    /// "constant expression" handling in enums. We can match the behavior of a JS VM
    /// by calling out to the APIs in WebKit which are responsible for this operation.
    ///
    /// This can return `None` in wasm builds to avoid linking JSC
    pub fn to_string(&self, bump: &Bump) -> Option<&'static [u8]> {
        Self::to_string_from_f64(self.value, bump)
    }

    pub fn to_string_from_f64(value: f64, bump: &Bump) -> Option<&'static [u8]> {
        if value == value.trunc() && (value < i32::MAX as f64 && value > i32::MIN as f64) {
            let int_value = value as i64;
            let abs = int_value.unsigned_abs();

            // do not allocate for a small set of constant numbers: -100 through 100
            if (abs as usize) < DOUBLE_DIGIT.len() {
                return Some(if int_value < 0 {
                    NEG_DOUBLE_DIGIT[abs as usize]
                } else {
                    DOUBLE_DIGIT[abs as usize]
                });
            }

            // std.fmt.allocPrint(allocator, "{d}", .{@as(i32, @intCast(int_value))}) catch return null
            use std::io::Write as _;
            let mut v = bumpalo::collections::Vec::<u8>::new_in(bump);
            if write!(&mut v, "{}", i32::try_from(int_value).unwrap()).is_err() {
                return None;
            }
            // TODO(port): arena slice lifetime — see Str alias note.
            // SAFETY: arena-owned slice; lifetime erased to 'static pending Phase B StoreRef/Str.
            return Some(unsafe { core::mem::transmute::<&[u8], &'static [u8]>(v.into_bump_slice()) });
        }

        if value.is_nan() {
            return Some(b"NaN");
        }

        if value.is_infinite() && value.is_sign_negative() {
            return Some(b"-Infinity");
        }

        if value.is_infinite() {
            return Some(b"Infinity");
        }

        #[cfg(not(target_arch = "wasm32"))]
        {
            let mut buf = [0u8; 124];
            let s = bun_core::fmt::FormatDouble::dtoa(&mut buf, value);
            // TODO(port): arena slice lifetime
            // SAFETY: arena-owned slice; lifetime erased to 'static pending Phase B StoreRef/Str.
            return Some(unsafe {
                core::mem::transmute::<&[u8], &'static [u8]>(bump.alloc_slice_copy(s))
            });
        }
        #[cfg(target_arch = "wasm32")]
        {
            // do not attempt to implement the spec here, it would be error prone.
        }

        #[allow(unreachable_code)]
        None
    }

    #[inline]
    pub fn to_u64(&self) -> u64 {
        self.to::<u64>()
    }

    #[inline]
    pub fn to_usize(&self) -> usize {
        self.to::<usize>()
    }

    #[inline]
    pub fn to_u32(&self) -> u32 {
        self.to::<u32>()
    }

    #[inline]
    pub fn to_u16(&self) -> u16 {
        self.to::<u16>()
    }

    pub fn to<T: NumberCast>(&self) -> T {
        // @as(T, @intFromFloat(@min(@max(@trunc(self.value), 0), comptime @min(floatMax(f64), maxInt(T)))))
        let clamped = self.value.trunc().max(0.0).min(T::MAX_AS_F64);
        T::from_f64(clamped)
    }

    // TODO(port): jsonStringify — Zig std.json protocol; Phase B picks a serde strategy.
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error> {
        let _ = writer;
        todo!("jsonStringify protocol")
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
    pub const EMPTY: BigInt = BigInt { value: b"" };

    // TODO(port): jsonStringify — Zig std.json protocol.
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error> {
        let _ = writer;
        todo!("jsonStringify protocol")
    }

    // `toJS` alias deleted — lives in `js_parser_jsc` extension trait.
}

pub struct Object {
    pub properties: G::PropertyList,
    pub comma_after_spread: Option<logger::Loc>,
    pub is_single_line: bool,
    pub is_parenthesized: bool,
    pub was_originally_macro: bool,

    pub close_brace_loc: logger::Loc,
}
impl Default for Object {
    fn default() -> Self {
        Self {
            properties: G::PropertyList::default(),
            comma_after_spread: None,
            is_single_line: false,
            is_parenthesized: false,
            was_originally_macro: false,
            close_brace_loc: logger::Loc::EMPTY,
        }
    }
}

/// used in TOML parser to merge properties
pub struct Rope<'arena> {
    pub head: Expr,
    pub next: Option<&'arena Rope<'arena>>,
}
impl<'arena> Rope<'arena> {
    pub fn append(
        &mut self,
        expr: Expr,
        bump: &'arena Bump,
    ) -> Result<&'arena mut Rope<'arena>, AllocError> {
        // TODO(port): Zig recurses through `next` mutably; Rust `&'arena Rope` is immutable.
        // This needs `&'arena mut Rope` or a `Cell`. Mirroring logic with raw-pointer escape.
        if let Some(next) = self.next {
            // SAFETY: arena-allocated Rope nodes are uniquely owned by the chain at this
            // point in TOML parsing; Zig mutates them freely.
            let next_mut = unsafe { &mut *(next as *const Rope<'arena> as *mut Rope<'arena>) };
            return next_mut.append(expr, bump);
        }

        let rope = bump.alloc(Rope { head: expr, next: None });
        self.next = Some(rope);
        Ok(rope)
    }
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum SetError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("Clobber")]
    Clobber,
}
impl From<AllocError> for SetError {
    fn from(_: AllocError) -> Self {
        SetError::OutOfMemory
    }
}
impl From<SetError> for bun_core::Error {
    fn from(e: SetError) -> Self {
        bun_core::Error::from_static_str(<&'static str>::from(e))
    }
}

pub struct RopeQuery<'a> {
    pub expr: Expr,
    pub rope: &'a Rope<'a>,
}

impl Object {
    pub fn get(&self, key: &[u8]) -> Option<Expr> {
        self.as_property(key).map(|query| query.expr)
    }

    // `toJS` alias deleted — lives in `js_parser_jsc` extension trait.

    pub fn put(&mut self, bump: &Bump, key: &[u8], expr: Expr) -> Result<(), AllocError> {
        if let Some(query) = self.as_property(key) {
            self.properties.ptr_mut()[query.i as usize].value = Some(expr);
        } else {
            self.properties.append(
                bump,
                G::Property {
                    key: Some(Expr::init(EString::init(key), expr.loc)),
                    value: Some(expr),
                    ..G::Property::default()
                },
            )?;
        }
        Ok(())
    }

    pub fn put_string(
        &mut self,
        bump: &Bump,
        key: &[u8],
        value: &[u8],
    ) -> Result<(), AllocError> {
        self.put(bump, key, Expr::init(EString::init(value), logger::Loc::EMPTY))
    }

    pub fn set(&self, key: Expr, bump: &Bump, value: Expr) -> Result<(), SetError> {
        if self.has_property(key.data.e_string().data) {
            return Err(SetError::Clobber);
        }
        // TODO(port): Zig takes `*const Object` but mutates `properties` (BabyList interior).
        // Mirroring with raw cast; Phase B should make this `&mut self`.
        // SAFETY: BabyList stores ptr/len/cap; Zig mutates through `*const Object` here and
        // callers never hold an aliasing borrow over the properties slice.
        let this = unsafe { &mut *(self as *const Object as *mut Object) };
        this.properties.append(
            bump,
            G::Property { key: Some(key), value: Some(value), ..G::Property::default() },
        )?;
        Ok(())
    }

    // this is terribly, shamefully slow
    pub fn set_rope(
        &mut self,
        rope: &Rope<'_>,
        bump: &Bump,
        value: Expr,
    ) -> Result<(), SetError> {
        if let Some(existing) = self.get(rope.head.data.e_string().data) {
            match &existing.data {
                Expr::Data::EArray(array) => {
                    if rope.next.is_none() {
                        array.push(bump, value)?;
                        return Ok(());
                    }

                    if let Some(last) = array.items.last() {
                        if !matches!(last.data, Expr::Data::EObject(_)) {
                            return Err(SetError::Clobber);
                        }

                        last.data.e_object_mut().set_rope(rope.next.unwrap(), bump, value)?;
                        return Ok(());
                    }

                    array.push(bump, value)?;
                    return Ok(());
                }
                Expr::Data::EObject(object) => {
                    if let Some(next) = rope.next {
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
        if let Some(next) = rope.next {
            let obj = Expr::init(Object { properties: Default::default(), ..Object::default() }, rope.head.loc);
            obj.data.e_object_mut().set_rope(next, bump, value)?;
            value_ = obj;
        }

        self.properties.append(
            bump,
            G::Property { key: Some(rope.head), value: Some(value_), ..G::Property::default() },
        )?;
        Ok(())
    }

    pub fn get_or_put_object(
        &mut self,
        rope: &Rope<'_>,
        bump: &Bump,
    ) -> Result<Expr, SetError> {
        if let Some(existing) = self.get(rope.head.data.e_string().data) {
            match &existing.data {
                Expr::Data::EArray(array) => {
                    if rope.next.is_none() {
                        return Err(SetError::Clobber);
                    }

                    if let Some(last) = array.items.last() {
                        if !matches!(last.data, Expr::Data::EObject(_)) {
                            return Err(SetError::Clobber);
                        }

                        return last.data.e_object_mut().get_or_put_object(rope.next.unwrap(), bump);
                    }

                    return Err(SetError::Clobber);
                }
                Expr::Data::EObject(object) => {
                    if let Some(next) = rope.next {
                        return object.get_or_put_object(next, bump);
                    }

                    // success
                    return Ok(existing);
                }
                _ => {
                    return Err(SetError::Clobber);
                }
            }
        }

        if let Some(next) = rope.next {
            let obj = Expr::init(Object { properties: Default::default(), ..Object::default() }, rope.head.loc);
            let out = obj.data.e_object_mut().get_or_put_object(next, bump)?;
            self.properties.append(
                bump,
                G::Property { key: Some(rope.head), value: Some(obj), ..G::Property::default() },
            )?;
            return Ok(out);
        }

        let out = Expr::init(Object::default(), rope.head.loc);
        self.properties.append(
            bump,
            G::Property { key: Some(rope.head), value: Some(out), ..G::Property::default() },
        )?;
        Ok(out)
    }

    pub fn get_or_put_array(
        &mut self,
        rope: &Rope<'_>,
        bump: &Bump,
    ) -> Result<Expr, SetError> {
        if let Some(existing) = self.get(rope.head.data.e_string().data) {
            match &existing.data {
                Expr::Data::EArray(array) => {
                    if rope.next.is_none() {
                        return Ok(existing);
                    }

                    if let Some(last) = array.items.last() {
                        if !matches!(last.data, Expr::Data::EObject(_)) {
                            return Err(SetError::Clobber);
                        }

                        return last.data.e_object_mut().get_or_put_array(rope.next.unwrap(), bump);
                    }

                    return Err(SetError::Clobber);
                }
                Expr::Data::EObject(object) => {
                    if rope.next.is_none() {
                        return Err(SetError::Clobber);
                    }

                    return object.get_or_put_array(rope.next.unwrap(), bump);
                }
                _ => {
                    return Err(SetError::Clobber);
                }
            }
        }

        if let Some(next) = rope.next {
            let obj = Expr::init(Object { properties: Default::default(), ..Object::default() }, rope.head.loc);
            let out = obj.data.e_object_mut().get_or_put_array(next, bump)?;
            self.properties.append(
                bump,
                G::Property { key: Some(rope.head), value: Some(obj), ..G::Property::default() },
            )?;
            return Ok(out);
        }

        let out = Expr::init(Array::default(), rope.head.loc);
        self.properties.append(
            bump,
            G::Property { key: Some(rope.head), value: Some(out), ..G::Property::default() },
        )?;
        Ok(out)
    }

    pub fn has_property(&self, name: &[u8]) -> bool {
        for prop in self.properties.slice() {
            let Some(key) = &prop.key else { continue };
            if !matches!(key.data, Expr::Data::EString(_)) {
                continue;
            }
            if key.data.e_string().eql_bytes(name) {
                return true;
            }
        }
        false
    }

    pub fn as_property(&self, name: &[u8]) -> Option<Expr::Query> {
        for (i, prop) in self.properties.slice().iter().enumerate() {
            let Some(value) = prop.value else { continue };
            let Some(key) = &prop.key else { continue };
            if !matches!(key.data, Expr::Data::EString(_)) {
                continue;
            }
            let key_str = key.data.e_string();
            if key_str.eql_bytes(name) {
                return Some(Expr::Query {
                    expr: value,
                    loc: key.loc,
                    i: i as u32,
                });
            }
        }

        None
    }

    /// Assumes each key in the property is a string
    pub fn alphabetize_properties(&mut self) {
        #[cfg(debug_assertions)]
        {
            for prop in self.properties.slice() {
                debug_assert!(matches!(prop.key.as_ref().unwrap().data, Expr::Data::EString(_)));
            }
        }
        self.properties.slice_mut().sort_by(object_sorter_is_less_than);
    }

    pub fn package_json_sort(&mut self) {
        self.properties.slice_mut().sort_by(package_json_sort_is_less_than);
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
        if let Expr::Data::EString(s) = &k.data {
            lhs_key_size =
                *PACKAGE_JSON_SORT_MAP.get(s.data).unwrap_or(&PackageJsonSortFields::Fake) as u8;
        }
    }

    if let Some(k) = &rhs.key {
        if let Expr::Data::EString(s) = &k.data {
            rhs_key_size =
                *PACKAGE_JSON_SORT_MAP.get(s.data).unwrap_or(&PackageJsonSortFields::Fake) as u8;
        }
    }

    match lhs_key_size.cmp(&rhs_key_size) {
        Ordering::Less => Ordering::Less,
        Ordering::Greater => Ordering::Greater,
        Ordering::Equal => strings::cmp_strings_asc(
            lhs.key.as_ref().unwrap().data.e_string().data,
            rhs.key.as_ref().unwrap().data.e_string().data,
        ),
    }
}

fn object_sorter_is_less_than(lhs: &G::Property, rhs: &G::Property) -> Ordering {
    strings::cmp_strings_asc(
        lhs.key.as_ref().unwrap().data.e_string().data,
        rhs.key.as_ref().unwrap().data.e_string().data,
    )
}

pub struct Spread {
    pub value: ExprNodeIndex,
}

/// JavaScript string literal type
pub struct EString {
    // A version of this where `utf8` and `value` are stored in a packed union, with len as a single u32 was attempted.
    // It did not improve benchmarks. Neither did converting this from a heap-allocated type to a stack-allocated type.
    // TODO: change this to *const anyopaque and change all uses to either .slice8() or .slice16()
    // TODO(port): arena-owned slice
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
// Export under the Zig name `String` as well; `EString` avoids colliding with bun_str::String.
pub use EString as String;

impl Default for EString {
    fn default() -> Self {
        Self {
            data: b"",
            prefer_template: false,
            next: None,
            end: None,
            rope_len: 0,
            is_utf16: false,
        }
    }
}

impl EString {
    pub fn is_identifier(&mut self, bump: &Bump) -> bool {
        if !self.is_utf8() {
            return bun_js_parser::js_lexer::is_identifier_utf16(self.slice16());
        }

        bun_js_parser::js_lexer::is_identifier(self.slice(bump))
    }

    pub const CLASS: EString = EString {
        data: b"class",
        prefer_template: false,
        next: None,
        end: None,
        rope_len: 0,
        is_utf16: false,
    };

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
        if self.next.is_none() {
            // TODO(port): `other` must be a Store-allocated node; callers pass
            // `Expr::init(EString, ...).data.e_string`, which is. Phase B: tighten signature.
            let other_ref = StoreRef::from_mut(other);
            self.next = Some(other_ref);
            self.end = Some(other_ref);
        } else {
            let mut end = self.end.unwrap();
            while end.get().next.is_some() {
                end = end.get().end.unwrap();
            }
            end.get_mut().next = Some(StoreRef::from_mut(other));
            self.end = Some(StoreRef::from_mut(other));
        }
    }

    /// Cloning the rope string is rarely needed, see `foldStringAddition`'s
    /// comments and the 'edgecase/EnumInliningRopeStringPoison' test
    pub fn clone_rope_nodes(s: EString) -> EString {
        let mut root = s;

        if root.next.is_some() {
            let mut current: Option<*mut EString> = Some(&mut root as *mut EString);
            loop {
                // SAFETY: pointer is to a live Store node or `root` on this stack frame.
                let node = unsafe { &mut *current.unwrap() };
                if let Some(next) = node.next {
                    node.next = Some(Expr::Data::Store::append_string(*next.get()));
                    current = node.next.map(|r| r.as_mut_ptr());
                } else {
                    root.end = Some(StoreRef::from_mut(node));
                    break;
                }
            }
        }

        root
    }

    pub fn to_utf8(&mut self, bump: &Bump) -> Result<(), AllocError> {
        if !self.is_utf16 {
            return Ok(());
        }
        // TODO(port): arena slice lifetime
        // SAFETY: arena-owned slice; lifetime erased to 'static pending Phase B StoreRef/Str.
        self.data = unsafe {
            core::mem::transmute::<&[u8], &'static [u8]>(strings::to_utf8_alloc(bump, self.slice16())?)
        };
        self.is_utf16 = false;
        Ok(())
    }

    pub fn init(value: &[u8]) -> EString {
        // TODO(port): arena slice lifetime
        // SAFETY: caller passes arena-owned or 'static slice (Zig invariant); lifetime erased
        // to 'static pending Phase B StoreRef/Str.
        EString {
            data: unsafe { core::mem::transmute::<&[u8], &'static [u8]>(value) },
            ..EString::default()
        }
    }

    pub fn init_utf16(value: &[u16]) -> EString {
        // Zig: data = @ptrCast(value.ptr)[0..value.len], is_utf16 = true
        // SAFETY: reinterpreting [u16; N] as [u8; N] (len is element count, not byte count —
        // matches Zig which stores u16 element count in `data.len`).
        let bytes =
            unsafe { core::slice::from_raw_parts(value.as_ptr() as *const u8, value.len()) };
        // SAFETY: arena-owned slice; lifetime erased to 'static pending Phase B StoreRef/Str.
        EString {
            data: unsafe { core::mem::transmute::<&[u8], &'static [u8]>(bytes) },
            is_utf16: true,
            ..EString::default()
        }
    }

    /// E.String containing non-ascii characters may not fully work.
    /// https://github.com/oven-sh/bun/issues/11963
    /// More investigation is needed.
    pub fn init_re_encode_utf8(utf8: &[u8], bump: &Bump) -> EString {
        if strings::is_all_ascii(utf8) {
            Self::init(utf8)
        } else {
            Self::init_utf16(strings::to_utf16_alloc_for_real(bump, utf8, false, false))
        }
    }

    pub fn slice8(&self) -> &[u8] {
        debug_assert!(!self.is_utf16);
        self.data
    }

    pub fn slice16(&self) -> &[u16] {
        debug_assert!(self.is_utf16);
        // SAFETY: when is_utf16, `data.ptr` was originally a `*const u16` and `data.len` is
        // the u16 element count (see `init_utf16`).
        unsafe { core::slice::from_raw_parts(self.data.as_ptr() as *const u16, self.data.len()) }
    }

    pub fn resolve_rope_if_needed(&mut self, bump: &Bump) {
        if self.next.is_none() || !self.is_utf8() {
            return;
        }
        let mut bytes =
            bumpalo::collections::Vec::<u8>::with_capacity_in(self.rope_len as usize, bump);
        // PERF(port): was appendSliceAssumeCapacity — profile in Phase B
        bytes.extend_from_slice(self.data);
        let mut str_ = self.next;
        while let Some(part) = str_ {
            bytes.extend_from_slice(part.get().data);
            str_ = part.get().next;
        }
        // TODO(port): arena slice lifetime
        // SAFETY: arena-owned slice; lifetime erased to 'static pending Phase B StoreRef/Str.
        self.data =
            unsafe { core::mem::transmute::<&[u8], &'static [u8]>(bytes.into_bump_slice()) };
        self.next = None;
    }

    pub fn slice(&mut self, bump: &Bump) -> &[u8] {
        self.resolve_rope_if_needed(bump);
        self.string(bump).expect("OOM")
    }

    fn string_compare_for_javascript<T: Copy + Into<i32>>(a: &[T], b: &[T]) -> Ordering {
        let n = a.len().min(b.len());
        let a_slice = &a[..n];
        let b_slice = &b[..n];
        debug_assert_eq!(a_slice.len(), b_slice.len());
        for (a_char, b_char) in a_slice.iter().zip(b_slice) {
            let delta: i32 = (*a_char).into() - (*b_char).into();
            if delta != 0 {
                return if delta < 0 { Ordering::Less } else { Ordering::Greater };
            }
        }
        a.len().cmp(&b.len())
    }

    /// Compares two strings lexicographically for JavaScript semantics.
    /// Both strings must share the same encoding (UTF-8 vs UTF-16).
    #[inline]
    pub fn order(&self, other: &EString) -> Ordering {
        debug_assert!(self.is_utf8() == other.is_utf8());

        if self.is_utf8() {
            Self::string_compare_for_javascript(self.data, other.data)
        } else {
            Self::string_compare_for_javascript(self.slice16(), other.slice16())
        }
    }

    pub const EMPTY: EString = EString {
        data: b"",
        prefer_template: false,
        next: None,
        end: None,
        rope_len: 0,
        is_utf16: false,
    };
    pub const TRUE: EString = EString { data: b"true", ..Self::EMPTY };
    pub const FALSE: EString = EString { data: b"false", ..Self::EMPTY };
    pub const NULL: EString = EString { data: b"null", ..Self::EMPTY };
    pub const UNDEFINED: EString = EString { data: b"undefined", ..Self::EMPTY };

    pub fn clone(&self, bump: &Bump) -> Result<EString, AllocError> {
        Ok(EString {
            // TODO(port): arena slice lifetime
            // SAFETY: arena-owned slice; lifetime erased to 'static pending Phase B StoreRef/Str.
            data: unsafe {
                core::mem::transmute::<&[u8], &'static [u8]>(bump.alloc_slice_copy(self.data))
            },
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
            if !strings::is_all_ascii(self.data) {
                return None;
            }
            return Some(self.data.len() as u32);
        }

        Some(self.slice16().len() as u32)
    }

    #[inline]
    pub fn len(&self) -> usize {
        if self.rope_len > 0 {
            self.rope_len as usize
        } else {
            self.data.len()
        }
    }

    #[inline]
    pub fn is_utf8(&self) -> bool {
        !self.is_utf16
    }

    #[inline]
    pub fn is_blank(&self) -> bool {
        self.len() == 0
    }

    #[inline]
    pub fn is_present(&self) -> bool {
        self.len() > 0
    }

    // Zig `eql(comptime _t: type, other: anytype)` — split by operand type.
    pub fn eql_string(&self, other: &EString) -> bool {
        if self.is_utf8() {
            if other.is_utf8() {
                strings::eql_long(self.data, other.data, true)
            } else {
                strings::utf16_eql_string(other.slice16(), self.data)
            }
        } else {
            if other.is_utf8() {
                strings::utf16_eql_string(self.slice16(), other.data)
            } else {
                self.slice16() == other.slice16()
            }
        }
    }

    pub fn eql_bytes(&self, other: &[u8]) -> bool {
        if self.is_utf8() {
            strings::eql_long(self.data, other, true)
        } else {
            strings::utf16_eql_string(self.slice16(), other)
        }
    }

    pub fn eql_utf16(&self, other: &[u16]) -> bool {
        if self.is_utf8() {
            strings::utf16_eql_string(other, self.data)
        } else {
            other == self.slice16()
        }
    }

    pub fn eql_comptime(&self, value: &'static [u8]) -> bool {
        if !self.is_utf8() {
            debug_assert!(self.next.is_none(), "transpiler: utf-16 string is a rope"); // utf-16 strings are not ropes
            return strings::eql_comptime_utf16(self.slice16(), value);
        }
        if self.next.is_none() {
            // latin-1 or utf-8, non-rope
            return self.data == value;
        }

        // latin-1 or utf-8, rope
        self.eql8_rope(value)
    }

    fn eql8_rope(&self, value: &[u8]) -> bool {
        debug_assert!(self.next.is_some() && self.is_utf8(), "transpiler: bad call to eql8Rope");
        if self.rope_len as usize != value.len() {
            return false;
        }
        let mut i: usize = 0;
        let mut next: Option<&EString> = Some(self);
        while let Some(current) = next {
            if !strings::eql_long(current.data, &value[i..i + current.data.len()], false) {
                return false;
            }
            i += current.data.len();
            next = current.next.map(|r| r.get());
        }
        debug_assert!(i == value.len(), "transpiler: rope string length mismatch 1");
        debug_assert!(i == self.rope_len as usize, "transpiler: rope string length mismatch 2");
        true
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

    pub fn string<'b>(&self, bump: &'b Bump) -> Result<&'b [u8], AllocError> {
        if self.is_utf8() {
            // TODO(port): lifetime — Zig returns the borrowed `data` here regardless of allocator.
            // SAFETY: `self.data` is arena-owned with the same arena as `bump` (Zig invariant);
            // re-borrowing under `'b` is sound while the AST store is alive.
            Ok(unsafe { core::mem::transmute::<&[u8], &'b [u8]>(self.data) })
        } else {
            strings::to_utf8_alloc(bump, self.slice16())
        }
    }

    pub fn string_z<'b>(&self, bump: &'b Bump) -> Result<&'b bun_str::ZStr, AllocError> {
        if self.is_utf8() {
            bun_str::ZStr::from_bytes_in(self.data, bump)
        } else {
            strings::to_utf8_alloc_z(bump, self.slice16())
        }
    }

    pub fn string_cloned<'b>(&self, bump: &'b Bump) -> Result<&'b [u8], AllocError> {
        if self.is_utf8() {
            Ok(bump.alloc_slice_copy(self.data))
        } else {
            strings::to_utf8_alloc(bump, self.slice16())
        }
    }

    pub fn hash(&self) -> u64 {
        if self.is_blank() {
            return 0;
        }

        if self.is_utf8() {
            // hash utf-8
            bun_wyhash::hash(self.data)
        } else {
            // hash utf-16
            let s16 = self.slice16();
            // SAFETY: reinterpreting &[u16] as &[u8] of double length.
            let bytes =
                unsafe { core::slice::from_raw_parts(s16.as_ptr() as *const u8, s16.len() * 2) };
            bun_wyhash::hash(bytes)
        }
    }

    // `toJS` alias deleted — lives in `js_parser_jsc` extension trait.

    pub fn to_zig_string(&mut self, bump: &Bump) -> ZigString {
        if self.is_utf8() {
            ZigString::from_utf8(self.slice(bump))
        } else {
            ZigString::init_utf16(self.slice16())
        }
    }

    // TODO(port): jsonStringify — Zig std.json protocol.
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error> {
        let _ = writer;
        let mut buf = [0u8; 4096];
        let mut i: usize = 0;
        for &char in self.slice16() {
            buf[i] = u8::try_from(char).unwrap();
            i += 1;
            if i >= 4096 {
                break;
            }
        }
        // writer.write(&buf[..i])
        todo!("jsonStringify protocol")
    }
}

impl fmt::Display for EString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("E.String")?;
        if self.next.is_none() {
            f.write_str("(")?;
            if self.is_utf8() {
                write!(f, "\"{}\"", bstr::BStr::new(self.data))?;
            } else {
                write!(f, "\"{}\"", bun_core::fmt::utf16(self.slice16()))?;
            }
            f.write_str(")")?;
        } else {
            f.write_str("(rope: [")?;
            let mut it: Option<&EString> = Some(self);
            while let Some(part) = it {
                if part.is_utf8() {
                    write!(f, "\"{}\"", bstr::BStr::new(part.data))?;
                } else {
                    write!(f, "\"{}\"", bun_core::fmt::utf16(part.slice16()))?;
                }
                it = part.next.map(|r| r.get());
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
    pub tail_loc: logger::Loc,
    pub tail: TemplateContents,
}

pub struct Template {
    pub tag: Option<ExprNodeIndex>,
    // TODO(port): arena-owned slice
    pub parts: &'static [TemplatePart],
    pub head: TemplateContents,
}

pub enum TemplateContents {
    Cooked(EString),
    Raw(Str),
}
impl TemplateContents {
    pub fn is_utf8(&self) -> bool {
        matches!(self, TemplateContents::Cooked(c) if c.is_utf8())
    }

    fn cooked(&self) -> &EString {
        match self {
            TemplateContents::Cooked(c) => c,
            _ => unreachable!(),
        }
    }
    fn cooked_mut(&mut self) -> &mut EString {
        match self {
            TemplateContents::Cooked(c) => c,
            _ => unreachable!(),
        }
    }
}

impl Template {
    /// "`a${'b'}c`" => "`abc`"
    pub fn fold(&mut self, bump: &Bump, loc: logger::Loc) -> Expr {
        if self.tag.is_some()
            || (matches!(self.head, TemplateContents::Cooked(_)) && !self.head.cooked().is_utf8())
        {
            // we only fold utf-8/ascii for now
            return Expr { data: Expr::Data::ETemplate(self), loc };
        }

        debug_assert!(matches!(self.head, TemplateContents::Cooked(_)));

        if self.parts.is_empty() {
            return Expr::init(core::mem::take(self.head.cooked_mut()), loc);
        }

        let mut parts =
            bumpalo::collections::Vec::<TemplatePart>::with_capacity_in(self.parts.len(), bump);
        let head = Expr::init(core::mem::take(self.head.cooked_mut()), loc);
        for part_src in self.parts {
            let mut part = *part_src;
            debug_assert!(matches!(part.tail, TemplateContents::Cooked(_)));

            part.value = part.value.unwrap_inlined();

            match &part.value.data {
                Expr::Data::ENumber(n) => {
                    if let Some(s) = n.to_string(bump) {
                        part.value = Expr::init(EString::init(s), part.value.loc);
                    }
                }
                Expr::Data::ENull(_) => {
                    part.value = Expr::init(EString::init(b"null"), part.value.loc);
                }
                Expr::Data::EBoolean(b) => {
                    part.value = Expr::init(
                        EString::init(if b.value { b"true" } else { b"false" }),
                        part.value.loc,
                    );
                }
                Expr::Data::EUndefined(_) => {
                    part.value = Expr::init(EString::init(b"undefined"), part.value.loc);
                }
                Expr::Data::EBigInt(value) => {
                    part.value = Expr::init(EString::init(value.value), part.value.loc);
                }
                _ => {}
            }

            if matches!(part.value.data, Expr::Data::EString(_))
                && part.tail.cooked().is_utf8()
                && part.value.data.e_string().is_utf8()
            {
                if parts.is_empty() {
                    if part.value.data.e_string().len() > 0 {
                        head.data.e_string_mut().push(
                            Expr::init(*part.value.data.e_string(), logger::Loc::EMPTY)
                                .data
                                .e_string_mut(),
                        );
                    }

                    if part.tail.cooked().len() > 0 {
                        head.data.e_string_mut().push(
                            Expr::init(core::mem::take(part.tail.cooked_mut()), part.tail_loc)
                                .data
                                .e_string_mut(),
                        );
                    }

                    continue;
                } else {
                    let prev_part = parts.last_mut().unwrap();
                    debug_assert!(matches!(prev_part.tail, TemplateContents::Cooked(_)));

                    if prev_part.tail.cooked().is_utf8() {
                        if part.value.data.e_string().len() > 0 {
                            prev_part.tail.cooked_mut().push(
                                Expr::init(*part.value.data.e_string(), logger::Loc::EMPTY)
                                    .data
                                    .e_string_mut(),
                            );
                        }

                        if part.tail.cooked().len() > 0 {
                            prev_part.tail.cooked_mut().push(
                                Expr::init(core::mem::take(part.tail.cooked_mut()), part.tail_loc)
                                    .data
                                    .e_string_mut(),
                            );
                        }
                    } else {
                        // PERF(port): was appendAssumeCapacity — profile in Phase B
                        parts.push(part);
                    }
                }
            } else {
                // PERF(port): was appendAssumeCapacity — profile in Phase B
                parts.push(part);
            }
        }

        if parts.is_empty() {
            // parts.deinit() — drop is implicit
            head.data.e_string_mut().resolve_rope_if_needed(bump);
            return head;
        }

        // TODO(port): arena slice lifetime for `parts`
        // SAFETY: arena-owned slice; lifetime erased to 'static pending Phase B StoreRef/Str.
        let parts_slice: &'static [TemplatePart] =
            unsafe { core::mem::transmute(parts.into_bump_slice()) };
        Expr::init(
            Template {
                tag: None,
                parts: parts_slice,
                head: TemplateContents::Cooked(*head.data.e_string()),
            },
            loc,
        )
    }
}

pub struct RegExp {
    // TODO(port): arena-owned slice
    pub value: Str,

    /// This exists for JavaScript bindings
    /// The RegExp constructor expects flags as a second argument.
    /// We want to avoid re-lexing the flags, so we store them here.
    /// This is the index of the first character in a flag, not the "/"
    /// /foo/gim
    ///      ^
    pub flags_offset: Option<u16>,
}
impl RegExp {
    pub const EMPTY: RegExp = RegExp { value: b"", flags_offset: None };

    pub fn pattern(&self) -> &[u8] {
        // rewind until we reach the /foo/gim
        //                               ^
        // should only ever be a single character
        // but we're being cautious
        if let Some(i_) = self.flags_offset {
            let mut i = i_;
            while i > 0 && self.value[i as usize] != b'/' {
                i -= 1;
            }

            return bun_str::strings::trim(&self.value[..i as usize], b"/");
        }

        bun_str::strings::trim(self.value, b"/")
    }

    pub fn flags(&self) -> &[u8] {
        // rewind until we reach the /foo/gim
        //                               ^
        // should only ever be a single character
        // but we're being cautious
        if let Some(i) = self.flags_offset {
            return &self.value[i as usize..];
        }

        b""
    }

    // TODO(port): jsonStringify — Zig std.json protocol.
    pub fn json_stringify<W>(&self, writer: &mut W) -> Result<(), bun_core::Error> {
        let _ = writer;
        todo!("jsonStringify protocol")
    }
}

pub struct Await {
    pub value: ExprNodeIndex,
}

pub struct Yield {
    pub value: Option<ExprNodeIndex>,
    pub is_star: bool,
}
impl Default for Yield {
    fn default() -> Self {
        Self { value: None, is_star: false }
    }
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
        Self { import_record_index: 0, unwrapped_id: u32::MAX }
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
    // TODO:
    // Comments inside "import()" expressions have special meaning for Webpack.
    // Preserving comments inside these expressions makes it possible to use
    // esbuild as a TypeScript-to-JavaScript frontend for Webpack to improve
    // performance. We intentionally do not interpret these comments in esbuild
    // because esbuild is not Webpack. But we do preserve them since doing so is
    // harmless, easy to maintain, and useful to people. See the Webpack docs for
    // more info: https://webpack.js.org/api/module-methods/#magic-comments.
    // leading_interior_comments: []G.Comment = &([_]G.Comment{}),
}
impl Import {
    pub fn is_import_record_null(&self) -> bool {
        self.import_record_index == u32::MAX
    }

    pub fn import_record_loader(&self) -> Option<bun_options_types::Loader> {
        // This logic is duplicated in js_printer.zig fn parsePath()
        let obj = self.options.data.as_e_object()?;
        let with = obj.get(b"with").or_else(|| obj.get(b"assert"))?;
        let with_obj = with.data.as_e_object()?;
        let str_ = with_obj.get(b"type")?.data.as_e_string()?;

        if !str_.is_utf16 {
            if let Some(loader) = bun_options_types::Loader::from_string(str_.data) {
                if loader == bun_options_types::Loader::Sqlite {
                    let Some(embed) = with_obj.get(b"embed") else { return Some(loader) };
                    let Some(embed_str) = embed.data.as_e_string() else { return Some(loader) };
                    if embed_str.eql_comptime(b"true") {
                        return Some(bun_options_types::Loader::SqliteEmbedded);
                    }
                }
                return Some(loader);
            }
        }

        None
    }
}

pub use G::Class;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/E.zig (1470 lines)
//   confidence: medium
//   todos:      25
//   notes:      AST string fields use `&'static [u8]` placeholder for arena slices (SAFETY-annotated transmutes; see Str alias); Expr::Data variant accessors (e_string/e_object/as_*) and StoreRef API assumed; Zig `pub var` constants ported as `pub const`.
// ──────────────────────────────────────────────────────────────────────────
