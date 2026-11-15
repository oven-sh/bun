//! Payloads that `Data` holds by `StoreRef` are allocated in an [`AstArena`].

use core::fmt;

use crate::Loc;
use bun_alloc::{AllocError, Arena as Bump};
use bun_core::{self};

use crate::{AstArena, E, G, Op, Ref};
// Re-export so downstream crates can name `ast::expr::StoreRef` (some callers
// route through `expr::`).
pub use crate::StoreRef;

use crate::StoreStr as Str;

// ───────────────────────────────────────────────────────────────────────────
// Expr
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct Expr<'a> {
    pub loc: Loc,
    pub data: Data<'a>,
}

impl Default for Expr<'_> {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl<'a> Expr<'a> {
    pub const EMPTY: Expr<'a> = Expr {
        data: Data::EMissing(E::Missing {}),
        loc: Loc::EMPTY,
    };
}

impl Expr<'_> {
    pub fn is_anonymous_named(&self) -> bool {
        match self.data {
            Data::EArrow(_) => true,
            Data::EFunction(func) => func.func.name.is_none(),
            Data::EClass(class) => class.class_name.is_none(),
            _ => false,
        }
    }

    pub fn can_be_inlined_from_property_access(&self) -> bool {
        match self.data {
            // if the array has a spread we must keep it
            // https://github.com/oven-sh/bun/issues/2594
            Data::ESpread(_) => false,
            Data::EMissing(_) => false,
            // `[[a?.b]][0]?.[0].c` must not become `a?.b.c`: inlining would
            // splice this chain onto the parent's `?.` continuation.
            Data::EDot(e) => e.optional_chain.is_none(),
            Data::EIndex(e) => e.optional_chain.is_none(),
            Data::ECall(e) => e.optional_chain.is_none(),
            _ => true,
        }
    }

    pub fn can_be_const_value(&self) -> bool {
        self.data.can_be_const_value()
    }

    pub fn can_be_moved(&self) -> bool {
        self.data.can_be_moved()
    }

    pub fn unwrap_inlined(self) -> Self {
        if let Data::EInlinedEnum(inlined) = self.data {
            return inlined.value;
        }
        self
    }

    #[inline]
    pub fn init_identifier(ref_: Ref, loc: Loc) -> Self {
        Expr {
            loc,
            data: Data::EIdentifier(E::Identifier::init(ref_)),
        }
    }

    pub fn to_empty(self) -> Self {
        Expr {
            data: Data::EMissing(E::Missing {}),
            loc: self.loc,
        }
    }
}

impl<'a> Expr<'a> {
    /// For a tree of JSON values. The result shares no node with `self`, only text.
    pub fn deep_clone_json<'b>(&self, bump: &'b AstArena) -> Result<Expr<'b>, crate::Error>
    where
        'a: 'b,
    {
        self.deep_clone_json_with_check(bump, bun_core::StackCheck::init())
    }
    #[inline]
    pub fn deep_clone_json_with_check<'b>(
        &self,
        bump: &'b AstArena,
        stack_check: bun_core::StackCheck,
    ) -> Result<Expr<'b>, crate::Error>
    where
        'a: 'b,
    {
        Ok(Expr {
            loc: self.loc,
            data: self.data.deep_clone_json_with_check(bump, stack_check)?,
        })
    }

    // `Expr::fromBlob` is JSC-tier — it parses JSON via `bun_parsers` and
    // reads `jsc::webcore::Blob`. Lives at its sole call site:
    // `bun_js_parser_jsc::macro_::expr_from_blob`.
}

#[derive(Clone, Copy)]
pub struct Query<'a> {
    pub expr: Expr<'a>,
    pub loc: Loc,
    pub i: u32,
}

// ───────────────────────────────────────────────────────────────────────────
// ── live Expr accessor surface ─────────────────────────────────────────────
// Subset of the gated impl below; bodies adapted to the live `E::Object` /
// `E::EString` surface in `e.rs`. The full set/get_path/rope helpers
// stay gated.
impl<'a> Expr<'a> {
    #[inline]
    pub fn is_array(&self) -> bool {
        matches!(self.data, Data::EArray(_))
    }
    #[inline]
    pub fn is_object(&self) -> bool {
        matches!(self.data, Data::EObject(_))
    }
    #[inline]
    pub fn is_string(&self) -> bool {
        matches!(self.data, Data::EString(_))
    }

    /// Materialize an immutable JSON leaf/container value as an `Expr`.
    pub fn from_json_value(bump: &'a AstArena, value: &E::JsonValue<'a>, loc: Loc) -> Self {
        match value {
            E::JsonValue::Null => Expr::init(E::Null, loc),
            E::JsonValue::Boolean(value) => Expr::init(E::Boolean { value: *value }, loc),
            E::JsonValue::Number(n) => Expr::init(*n, loc),
            E::JsonValue::String(s) => Expr::allocate(
                bump,
                E::String {
                    data: *s,
                    ..Default::default()
                },
                loc,
            ),
            E::JsonValue::Object(o) => Expr {
                loc,
                data: Data::EObjectJSON(*o),
            },
            E::JsonValue::Array(a) => Expr {
                loc,
                data: Data::EArrayJSON(*a),
            },
        }
    }

    /// Visit every property of an `E::Object` in source order.
    pub fn for_each_property(&self, mut f: impl FnMut(&'a [u8], Loc, Self)) {
        let _: Result<(), core::convert::Infallible> =
            self.try_for_each_property(|key, loc, value| {
                f(key, loc, value);
                Ok(())
            });
    }

    /// [`Expr::for_each_property`] with a fallible callback; stops at the first `Err`.
    pub fn try_for_each_property<Error>(
        &self,
        mut f: impl FnMut(&'a [u8], Loc, Self) -> Result<(), Error>,
    ) -> Result<(), Error> {
        let Some(obj) = self.as_e_object() else {
            return Ok(());
        };
        for property in obj.properties.slice() {
            let (Some(key_expr), Some(value)) = (property.key.as_ref(), property.value.as_ref())
            else {
                continue;
            };
            let Some(key) = key_expr.as_utf8_string_literal() else {
                continue;
            };
            f(key, key_expr.loc, *value)?;
        }
        Ok(())
    }

    fn as_e_object(&self) -> Option<&E::Object<'a>> {
        match &self.data {
            Data::EObject(obj) => Some(obj),
            other => {
                debug_assert!(
                    !matches!(other, Data::EObjectJSON(_)),
                    "read `E::ObjectJSON` through `JsonView`"
                );
                None
            }
        }
    }

    /// Number of properties of an `E::Object`; 0 otherwise.
    pub fn property_count(&self) -> usize {
        self.as_e_object().map_or(0, |obj| obj.properties.len())
    }

    /// Look up `name` among the properties of an object-literal expression.
    pub fn as_property(&self, name: &[u8]) -> Option<Query<'a>> {
        self.as_e_object()?.as_property(name)
    }

    pub fn get(&self, name: &[u8]) -> Option<Self> {
        self.as_property(name).map(|q| q.expr)
    }

    pub fn get_object(&self, name: &[u8]) -> Option<Self> {
        self.as_property(name)
            .and_then(|q| q.expr.is_object().then_some(q.expr))
    }

    pub fn as_array(&self) -> Option<ArrayIterator<'a>> {
        match &self.data {
            Data::EArray(array) => {
                if array.items.len_u32() == 0 {
                    return None;
                }
                Some(ArrayIterator {
                    array: *array,
                    index: 0,
                })
            }
            other => {
                debug_assert!(
                    !matches!(other, Data::EArrayJSON(_)),
                    "read `E::ArrayJSON` through `JsonView`"
                );
                None
            }
        }
    }

    #[inline]
    pub fn as_utf8_string_literal(&self) -> Option<&'a [u8]> {
        if let Data::EString(s) = &self.data {
            debug_assert!(s.next.is_none());
            return Some(s.data.slice());
        }
        None
    }

    #[inline]
    pub fn as_string<'b>(&self, bump: &'b Bump) -> Option<&'b [u8]>
    where
        'a: 'b,
    {
        match &self.data {
            Data::EString(str) => Some(str.string(bump).expect("OOM")),
            _ => None,
        }
    }

    #[inline]
    pub fn as_string_cloned<'b>(&self, bump: &'b Bump) -> Result<Option<&'b [u8]>, AllocError> {
        match &self.data {
            Data::EString(str) => Ok(Some(str.string_cloned(bump)?)),
            _ => Ok(None),
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self.data {
            Data::EBoolean(b) | Data::EBranchBoolean(b) => Some(b.value),
            _ => None,
        }
    }

    pub fn as_number(&self) -> Option<f64> {
        match self.data {
            Data::ENumber(n) => Some(n.value()),
            _ => None,
        }
    }
}

// Expr — property/object/string accessor methods.

impl<'a> Expr<'a> {
    pub fn has_any_property_named(&self, names: &'static [&'static [u8]]) -> bool {
        let Some(obj) = self.as_e_object() else {
            return false;
        };
        if obj.properties.len_u32() == 0 {
            return false;
        }

        for prop in obj.properties.slice() {
            if prop.value.is_none() {
                continue;
            }
            let Some(key) = &prop.key else { continue };
            let Data::EString(key_str) = &key.data else {
                continue;
            };
            if bun_core::eql_any_comptime(&key_str.data, names) {
                return true;
            }
        }

        false
    }

    // toJS alias deleted — `to_js` lives in `bun_js_parser_jsc::expr_jsc` extension trait.

    /// Don't use this if you care about performance.
    ///
    /// Sets the value of a property, creating it if it doesn't exist.
    pub fn set(
        &mut self,
        bump: &'a AstArena,
        name: &'a [u8],
        value: Self,
    ) -> Result<(), AllocError> {
        debug_assert!(matches!(self.data, Data::EObject(_)));
        let Data::EObject(obj) = &mut self.data else {
            unreachable!()
        };
        for i in 0..obj.properties.len_u32() as usize {
            let prop = &mut obj.properties.slice_mut()[i];
            let Some(key) = &prop.key else { continue };
            let Data::EString(key_str) = &key.data else {
                continue;
            };
            if key_str.eql_bytes(name) {
                prop.value = Some(value);
                return Ok(());
            }
        }

        obj.properties.push(
            bump,
            G::Property {
                key: Some(Expr::allocate(
                    bump,
                    E::String {
                        data: Str::new(name),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                )),
                value: Some(value),
                ..Default::default()
            },
        );
        Ok(())
    }

    /// Don't use this if you care about performance.
    ///
    /// Sets the value of a property to a string, creating it if it doesn't exist.
    pub fn set_string(
        expr: &mut Self,
        bump: &'a AstArena,
        name: &'a [u8],
        value: &'a [u8],
    ) -> Result<(), AllocError> {
        debug_assert!(matches!(expr.data, Data::EObject(_)));
        let Data::EObject(obj) = &mut expr.data else {
            unreachable!()
        };
        for i in 0..obj.properties.len_u32() as usize {
            let prop = &mut obj.properties.slice_mut()[i];
            let Some(key) = &prop.key else { continue };
            let Data::EString(key_str) = &key.data else {
                continue;
            };
            if key_str.eql_bytes(name) {
                prop.value = Some(Expr::allocate(
                    bump,
                    E::String {
                        data: Str::new(value),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                ));
                return Ok(());
            }
        }

        obj.properties.push(
            bump,
            G::Property {
                key: Some(Expr::allocate(
                    bump,
                    E::String {
                        data: Str::new(name),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                )),
                value: Some(Expr::allocate(
                    bump,
                    E::String {
                        data: Str::new(value),
                        ..Default::default()
                    },
                    Loc::EMPTY,
                )),
                ..Default::default()
            },
        );
        Ok(())
    }

    pub fn get_number(&self, name: &[u8]) -> Option<(f64, Loc)> {
        if let Some(q) = self.as_property(name) {
            if let Some(num) = q.expr.as_number() {
                return Some((num, q.expr.loc));
            }
        }
        None
    }

    pub fn get_string_cloned<'b>(
        &self,
        bump: &'b Bump,
        name: &[u8],
    ) -> Result<Option<&'b [u8]>, AllocError> {
        match self.as_property(name) {
            Some(q) => q.expr.as_string_cloned(bump),
            None => Ok(None),
        }
    }

    pub fn get_array(&self, name: &[u8]) -> Option<ArrayIterator<'a>> {
        let q = self.as_property(name)?;
        q.expr.as_array()
    }
}

// ───────────────────────────────────────────────────────────────────────────
// ArrayIterator
// ───────────────────────────────────────────────────────────────────────────

pub struct ArrayIterator<'a> {
    array: StoreRef<'a, E::Array<'a>>,
    index: u32,
}

impl<'a> ArrayIterator<'a> {
    pub fn next(&mut self) -> Option<Expr<'a>> {
        let result = *self.array.items.get(self.index as usize)?;
        self.index += 1;
        Some(result)
    }
}

// Earlier drafts of `as_array`/`is_string`/`as_utf8_string_literal`/
// `as_string`/`as_string_cloned`/`as_bool`/`as_number` duplicated the live `&self`
// implementations above (lines ~231-315) with worse signatures (`expr: &Expr`,
// raw-ptr returns). Those drafts were dropped; only the methods without a live
// counterpart remain.
impl<'a> Expr<'a> {
    #[inline]
    pub fn as_string_literal<'b>(&self, bump: &'b Bump) -> Option<&'b [u8]>
    where
        'a: 'b,
    {
        let Data::EString(s) = &self.data else {
            return None;
        };
        s.string(bump).ok()
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EFlags {
    None,
    TsDecorator,
    /// Between the `?` and `:` of a conditional, where an arrow return type is ambiguous.
    AfterQuestionAndBeforeColon,
}

// `is_missing` lives in the `init`/`allocate` impl block below.
impl<'a> Expr<'a> {
    /// The goal of this function is to "rotate" the AST if it's possible to use the
    /// left-associative property of the operator to avoid unnecessary parentheses.
    ///
    /// When using this, make absolutely sure that the operator is actually
    /// associative. For example, the "-" operator is not associative for
    /// floating-point numbers.
    //
    // PERF: `Op::Code` does not derive `ConstParamTy` (Op.rs owns the enum);
    // pass at runtime here. Revisit once `Code` gains `ConstParamTy` — call
    // sites are a handful of literal ops.
    pub fn join_with_left_associative_op(
        bump: &'a AstArena,
        op: Op::Code,
        a: Self,
        b: Self,
    ) -> Self {
        Self::join_with_left_associative_op_with_check(bump, op, a, b, bun_core::StackCheck::init())
    }

    fn join_with_left_associative_op_with_check(
        bump: &'a AstArena,
        op: Op::Code,
        a: Self,
        b: Self,
        stack_check: bun_core::StackCheck,
    ) -> Self {
        if stack_check.is_safe_to_recurse() {
            // "(a, b) op c" => "a, b op c"
            if let Data::EBinary(mut comma) = a.data {
                if comma.op == crate::OpCode::BinComma {
                    comma.right = Self::join_with_left_associative_op_with_check(
                        bump,
                        op,
                        comma.right,
                        b,
                        stack_check,
                    );
                    return a;
                }
            }

            // "a op (b op c)" => "(a op b) op c"
            // "a op (b op (c op d))" => "((a op b) op c) op d"
            if let Data::EBinary(binary) = b.data {
                if binary.op == op {
                    return Self::join_with_left_associative_op_with_check(
                        bump,
                        op,
                        Self::join_with_left_associative_op_with_check(
                            bump,
                            op,
                            a,
                            binary.left,
                            stack_check,
                        ),
                        binary.right,
                        stack_check,
                    );
                }
            }
        }

        // "a op b" => "a op b"
        // "(a op b) op c" => "(a op b) op c"
        Expr::allocate(
            bump,
            E::Binary {
                op,
                left: a,
                right: b,
            },
            a.loc,
        )
    }

    pub fn join_with_comma(self, bump: &'a AstArena, b: Self) -> Self {
        if self.is_missing() {
            return b;
        }
        if b.is_missing() {
            return self;
        }
        Expr::allocate(
            bump,
            E::Binary {
                op: crate::OpCode::BinComma,
                left: self,
                right: b,
            },
            self.loc,
        )
    }

    pub fn join_all_with_comma(bump: &'a AstArena, all: &[Self]) -> Self {
        debug_assert!(!all.is_empty());
        match all.len() {
            1 => all[0],
            2 => Expr::join_with_comma(all[0], bump, all[1]),
            _ => {
                let mut expr = all[0];
                for it in &all[1..] {
                    expr = Expr::join_with_comma(expr, bump, *it);
                }
                expr
            }
        }
    }

    pub fn extract_numeric_values_in_safe_range(left: &Data, right: &Data) -> Option<[f64; 2]> {
        let l_value = left.extract_numeric_value()?;
        let r_value = right.extract_numeric_value()?;

        // Check for NaN and return null if either value is NaN
        if l_value.is_nan() || r_value.is_nan() {
            return None;
        }

        if l_value.is_infinite() || r_value.is_infinite() {
            return Some([l_value, r_value]);
        }

        if l_value > crate::math::MAX_SAFE_INTEGER || r_value > crate::math::MAX_SAFE_INTEGER {
            return None;
        }
        if l_value < crate::math::MIN_SAFE_INTEGER || r_value < crate::math::MIN_SAFE_INTEGER {
            return None;
        }

        Some([l_value, r_value])
    }

    pub fn extract_numeric_values(left: &Data, right: &Data) -> Option<[f64; 2]> {
        Some([
            left.extract_numeric_value()?,
            right.extract_numeric_value()?,
        ])
    }

    pub fn extract_string_values(
        left: &Data<'a>,
        right: &Data<'a>,
        bump: &'a Bump,
    ) -> Option<[crate::StoreRef<'a, E::String<'a>>; 2]> {
        let mut l_string = Data::extract_string_value(*left)?;
        let mut r_string = Data::extract_string_value(*right)?;
        // `extract_string_value` returns the arena `StoreRef`; mutate via DerefMut.
        l_string.resolve_rope_if_needed(bump);
        r_string.resolve_rope_if_needed(bump);

        if l_string.is_utf8() != r_string.is_utf8() {
            return None;
        }

        Some([l_string, r_string])
    }
}

// We don't need to dynamically allocate booleans: `E::Boolean` is inline in
// `Data`, not a pointer to a pooled singleton.

// ───────────────────────────────────────────────────────────────────────────
// Expr construction via the IntoExprData trait
// ───────────────────────────────────────────────────────────────────────────

/// Trait implemented by every `E::*` payload type to construct an `Expr`.
pub trait IntoExprData<'a>: Sized {
    fn into_data_alloc(self, bump: &'a AstArena) -> Data<'a>;
}

/// Payloads that `Data` holds by value.
pub trait InlineExprData: Sized {
    fn into_data<'a>(self) -> Data<'a>;
}

macro_rules! impl_into_expr_data_boxed {
    ($($ty:ty => $variant:ident),* $(,)?) => {
        $(
            impl<'a> IntoExprData<'a> for $ty {
                #[inline]
                fn into_data_alloc(self, bump: &'a AstArena) -> Data<'a> {
                    Data::$variant(bump.alloc_node(self).into())
                }
            }
        )*
    };
}

macro_rules! impl_into_expr_data_inline {
    ($($ty:ident => $variant:ident),* $(,)?) => {
        $(
            impl InlineExprData for E::$ty {
                #[inline]
                fn into_data<'a>(self) -> Data<'a> { Data::$variant(self) }
            }
            impl<'a> IntoExprData<'a> for E::$ty {
                #[inline]
                fn into_data_alloc(self, _bump: &'a AstArena) -> Data<'a> { Data::$variant(self) }
            }
        )*
    };
}

impl_into_expr_data_boxed! {
    E::NameOfSymbol => ENameOfSymbol,
    E::Array<'a> => EArray,
    E::Class<'a> => EClass,
    E::Unary<'a> => EUnary,
    E::Binary<'a> => EBinary,
    E::New<'a> => ENew,
    E::Function<'a> => EFunction,
    E::Call<'a> => ECall,
    E::Dot<'a> => EDot,
    E::Index<'a> => EIndex,
    E::Arrow<'a> => EArrow,
    E::JSXElement<'a> => EJsxElement,
    E::BigInt<'a> => EBigInt,
    E::Object<'a> => EObject,
    E::ObjectJSON<'a> => EObjectJSON,
    E::ArrayJSON<'a> => EArrayJSON,
    E::Spread<'a> => ESpread,
    E::Template<'a> => ETemplate,
    E::RegExp<'a> => ERegExp,
    E::Await<'a> => EAwait,
    E::Yield<'a> => EYield,
    E::If<'a> => EIf,
    E::Import<'a> => EImport,
    E::InlinedEnum<'a> => EInlinedEnum,
}

impl_into_expr_data_inline! {
    This => EThis,
    Boolean => EBoolean,
    Super => ESuper,
    Null => ENull,
    Undefined => EUndefined,
    NewTarget => ENewTarget,
    ImportMeta => EImportMeta,
    PrivateIdentifier => EPrivateIdentifier,
    Missing => EMissing,
    Number => ENumber,
    RequireResolveString => ERequireResolveString,
    RequireString => ERequireString,
    Identifier => EIdentifier,
    ImportIdentifier => EImportIdentifier,
    CommonJSExportIdentifier => ECommonjsExportIdentifier,
}

// E::EString — special debug assert + boxed
impl<'a> IntoExprData<'a> for E::EString<'a> {
    #[inline]
    fn into_data_alloc(self, bump: &'a AstArena) -> Data<'a> {
        #[cfg(debug_assertions)]
        {
            // Sanity check: assert string is not a null ptr
            if !self.data.is_empty() && self.is_utf8() {
                debug_assert!(self.data.as_ptr() as usize > 0);
            }
        }
        Data::EString(bump.alloc_node(self))
    }
}

// &E::EString — construct from a pointer to copy from. `EString` derives no
// `Clone` (rope `next` ptr), so this is a shallow field-copy.
impl<'a> IntoExprData<'a> for &E::EString<'a> {
    #[inline]
    fn into_data_alloc(self, bump: &'a AstArena) -> Data<'a> {
        Data::EString(bump.alloc_node(self.shallow_clone()))
    }
}

impl<'a> Expr<'a> {
    #[inline]
    pub fn allocate<T: IntoExprData<'a>>(bump: &'a AstArena, st: T, loc: Loc) -> Self {
        Expr {
            loc,
            data: st.into_data_alloc(bump),
        }
    }

    #[inline]
    pub fn init<T: InlineExprData>(st: T, loc: Loc) -> Self {
        Expr {
            loc,
            data: st.into_data(),
        }
    }

    // Trivial predicates with `is_missing` callers in G.rs/B.rs.
    #[inline]
    pub fn is_missing(&self) -> bool {
        matches!(self.data, Data::EMissing(_))
    }
    #[inline]
    pub fn is_empty(&self) -> bool {
        matches!(self.data, Data::EMissing(_))
    }
    #[inline]
    pub fn assign(bump: &'a AstArena, a: Self, b: Self) -> Self {
        Expr::allocate(
            bump,
            E::Binary {
                op: crate::OpCode::BinAssign,
                left: a,
                right: b,
            },
            a.loc,
        )
    }
}

impl Expr<'_> {
    #[inline]
    pub fn is_primitive_literal(&self) -> bool {
        Tag::is_primitive_literal(self.data.tag())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Tag
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
#[repr(u8)]
pub enum Tag {
    EArray,
    EUnary,
    EBinary,
    EClass,
    ENew,
    EFunction,
    ECall,
    EDot,
    EIndex,
    EArrow,
    EJsxElement,
    EObject,
    EObjectJSON,
    EArrayJSON,
    ESpread,
    ETemplate,
    ERegExp,
    EAwait,
    EYield,
    EIf,
    EImport,
    EIdentifier,
    EImportIdentifier,
    EPrivateIdentifier,
    ECommonjsExportIdentifier,
    EBoolean,
    /// Like e_boolean, but produced by `feature()` from `bun:bundle`.
    /// This tag ensures feature() can only be used directly in conditional
    /// contexts (if statements, ternaries). Invalid usage is caught during
    /// the visit phase when this expression appears outside a branch condition.
    EBranchBoolean,
    ENumber,
    EBigInt,
    EString,
    ERequireString,
    ERequireResolveString,
    ERequireCallTarget,
    ERequireResolveCallTarget,
    EMissing,
    EThis,
    ESuper,
    ENull,
    EUndefined,
    ENewTarget,
    EImportMeta,
    EImportMetaMain,
    ERequireMain,
    ESpecial,
    EInlinedEnum,
    ENameOfSymbol,
}

impl Tag {
    // object, regex and array may have had side effects
    pub fn is_primitive_literal(self) -> bool {
        matches!(
            self,
            Tag::ENull
                | Tag::EUndefined
                | Tag::EString
                | Tag::EBoolean
                | Tag::EBranchBoolean
                | Tag::ENumber
                | Tag::EBigInt
        )
    }

    pub(crate) fn typeof_(tag: Tag) -> Option<&'static [u8]> {
        // This must only return `Some` when the operand is guaranteed to have
        // no side effects. Array/object/class literals are omitted because
        // their elements, properties, and static initializers can run code.
        Some(match tag {
            Tag::EArrayJSON | Tag::EObjectJSON | Tag::ENull | Tag::ERegExp => b"object",
            Tag::EUndefined => b"undefined",
            Tag::EBoolean | Tag::EBranchBoolean => b"boolean",
            Tag::ENumber => b"number",
            Tag::EBigInt => b"bigint",
            Tag::EString => b"string",
            Tag::EFunction | Tag::EArrow => b"function",
            _ => return None,
        })
    }
}

impl Tag {
    /// Human-readable variant name for diagnostics (`"string"`, `"boolean"`, …).
    pub fn type_name(self) -> &'static str {
        match self {
            Tag::EString => "string",
            Tag::EArray | Tag::EArrayJSON => "array",
            Tag::EUnary => "unary",
            Tag::EBinary => "binary",
            Tag::EBoolean | Tag::EBranchBoolean => "boolean",
            Tag::ESuper => "super",
            Tag::ENull => "null",
            Tag::EUndefined => "undefined",
            Tag::ENew => "new",
            Tag::EFunction => "function",
            Tag::ENewTarget => "new target",
            Tag::EImportMeta => "import.meta",
            Tag::ECall => "call",
            Tag::EDot => "dot",
            Tag::EIndex => "index",
            Tag::EArrow => "arrow",
            Tag::EIdentifier => "identifier",
            Tag::EImportIdentifier => "import identifier",
            Tag::EPrivateIdentifier => "#privateIdentifier",
            Tag::EJsxElement => "<jsx>",
            Tag::EMissing => "<missing>",
            Tag::ENumber => "number",
            Tag::EBigInt => "BigInt",
            Tag::EObject | Tag::EObjectJSON => "object",
            Tag::ESpread => "...",
            Tag::ETemplate => "template",
            Tag::ERegExp => "regexp",
            Tag::EAwait => "await",
            Tag::EYield => "yield",
            Tag::EIf => "if",
            Tag::ERequireResolveString => "require_or_require_resolve",
            Tag::EImport => "import",
            Tag::EThis => "this",
            Tag::EClass => "class",
            Tag::ERequireString => "require",
            other => <&'static str>::from(other),
        }
    }
}

impl fmt::Display for Tag {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.type_name())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Expr methods (continued)
// ───────────────────────────────────────────────────────────────────────────

impl<'a> Expr<'a> {
    // `assign` lives in the `init`/`allocate` impl block above.

    #[inline]
    pub(crate) fn at<T: InlineExprData>(&self, t: T) -> Self {
        Expr::init(t, self.loc)
    }

    // Wraps the provided expression in the "!" prefix operator. The expression
    // will potentially be simplified to avoid generating unnecessary extra "!"
    // operators. For example, calling this with "!!x" will return "!x" instead
    // of returning "!!!x".
    pub(crate) fn not(&self, bump: &'a AstArena) -> Self {
        self.maybe_simplify_not(bump).unwrap_or_else(|| {
            Expr::allocate(
                bump,
                E::Unary {
                    op: crate::OpCode::UnNot,
                    value: *self,
                    flags: E::UnaryFlags::empty(),
                },
                self.loc,
            )
        })
    }

    #[inline]
    pub fn has_value_for_this_in_call(&self) -> bool {
        matches!(self.data, Data::EDot(_) | Data::EIndex(_))
    }

    /// The given "expr" argument should be the operand of a "!" prefix operator
    /// (i.e. the "x" in "!x"). This returns a simplified expression for the
    /// whole operator (i.e. the "!x") if it can be simplified, or false if not.
    /// It's separate from "Not()" above to avoid allocation on failure in case
    /// that is undesired.
    pub fn maybe_simplify_not(&self, bump: &'a AstArena) -> Option<Self> {
        let expr = self;
        match expr.data {
            Data::ENull(_) | Data::EUndefined(_) => {
                return Some(expr.at(E::Boolean { value: true }));
            }
            Data::EBoolean(b) | Data::EBranchBoolean(b) => {
                return Some(expr.at(E::Boolean { value: !b.value }));
            }
            Data::ENumber(n) => {
                return Some(expr.at(E::Boolean {
                    value: n.value() == 0.0 || n.value().is_nan(),
                }));
            }
            Data::EBigInt(b) => {
                if let Some(equal) = E::BigInt::check_equality(&b.value, b"0") {
                    return Some(expr.at(E::Boolean { value: equal }));
                }
            }
            Data::EFunction(_) | Data::EArrow(_) | Data::ERegExp(_) => {
                return Some(expr.at(E::Boolean { value: false }));
            }
            // "!!!a" => "!a"
            Data::EUnary(un) => {
                if un.op == crate::OpCode::UnNot
                    && un.value.known_primitive() == PrimitiveType::Boolean
                {
                    return Some(un.value);
                }
            }
            Data::EBinary(mut ex) => {
                // TODO: evaluate whether or not it is safe to do this mutation since it's modifying in-place.
                // Make sure that these transformations are all safe for special values.
                // For example, "!(a < b)" is not the same as "a >= b" if a and/or b are
                // NaN (or undefined, or null, or possibly other problem cases too).
                //
                // `StoreRef` is a `Copy` `NonNull` handle, so copying it out of
                // the (immutable) `Data` and `DerefMut`-ing reaches the same
                // arena slot.
                match ex.op {
                    crate::OpCode::BinLooseEq => {
                        // "!(a == b)" => "a != b"
                        ex.op = crate::OpCode::BinLooseNe;
                        return Some(*expr);
                    }
                    crate::OpCode::BinLooseNe => {
                        // "!(a != b)" => "a == b"
                        ex.op = crate::OpCode::BinLooseEq;
                        return Some(*expr);
                    }
                    crate::OpCode::BinStrictEq => {
                        // "!(a === b)" => "a !== b"
                        ex.op = crate::OpCode::BinStrictNe;
                        return Some(*expr);
                    }
                    crate::OpCode::BinStrictNe => {
                        // "!(a !== b)" => "a === b"
                        ex.op = crate::OpCode::BinStrictEq;
                        return Some(*expr);
                    }
                    crate::OpCode::BinComma => {
                        // "!(a, b)" => "a, !b"
                        ex.right = ex.right.not(bump);
                        return Some(*expr);
                    }
                    _ => {}
                }
            }
            Data::EInlinedEnum(inlined) => {
                return inlined.value.maybe_simplify_not(bump);
            }
            _ => {}
        }

        None
    }

    pub(crate) fn to_string_expr_without_side_effects(&self, bump: &'a AstArena) -> Option<Self> {
        let expr = self;
        let unwrapped = expr.unwrap_inlined();
        let slice: Option<&[u8]> = match unwrapped.data {
            Data::ENull(_) => Some(b"null"),
            Data::EString(_) => return Some(*expr),
            Data::EUndefined(_) => Some(b"undefined"),
            Data::EBoolean(data) | Data::EBranchBoolean(data) => {
                Some(if data.value { b"true" } else { b"false" })
            }
            Data::EBigInt(bigint) => {
                if E::BigInt::has_radix(&bigint.value) {
                    None
                } else {
                    Some(bigint.value.slice())
                }
            }
            Data::ENumber(num) => num.to_string(bump).map(|s| s.slice()),
            Data::ERegExp(regexp) => Some(regexp.value.slice()),
            Data::EDot(dot) => 'brk: {
                // This is dumb but some JavaScript obfuscators use this to generate string literals
                if dot.name == b"constructor" {
                    break 'brk match dot.target.data {
                        Data::EString(_) => Some(b"function String() { [native code] }".as_slice()),
                        Data::ERegExp(_) => Some(b"function RegExp() { [native code] }".as_slice()),
                        _ => None,
                    };
                }
                None
            }
            _ => None,
        };
        slice.map(|s| {
            Expr::allocate(
                bump,
                E::String {
                    data: s.into(),
                    ..Default::default()
                },
                expr.loc,
            )
        })
    }

    #[inline]
    pub fn known_primitive(&self) -> PrimitiveType {
        self.data.known_primitive()
    }
}

// ───────────────────────────────────────────────────────────────────────────
// PrimitiveType
// ───────────────────────────────────────────────────────────────────────────

// EnumSetType derives Clone/Copy/PartialEq/Eq itself.
#[derive(Debug, enumset::EnumSetType)]
pub enum PrimitiveType {
    Unknown,
    Mixed,
    Null,
    Undefined,
    Boolean,
    Number,
    String,
    Bigint,
}

impl PrimitiveType {
    pub(crate) fn merge(left_known: PrimitiveType, right_known: PrimitiveType) -> PrimitiveType {
        if right_known == PrimitiveType::Unknown || left_known == PrimitiveType::Unknown {
            return PrimitiveType::Unknown;
        }
        if left_known == right_known {
            left_known
        } else {
            PrimitiveType::Mixed
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Data
// ───────────────────────────────────────────────────────────────────────────

/// Tagged union of expression payloads. Pointer variants are arena-allocated
/// `StoreRef<E::*>` (thin `NonNull` into an arena);
/// inline variants are stored by value. `StoreRef` is `Copy` + `Deref`, so
/// `Data` is `Copy` and `let Data::EBinary(b) = data; b.op` works.
#[derive(Clone, Copy, bun_core::EnumTag)]
#[enum_tag(existing = Tag)]
pub enum Data<'a> {
    EArray(StoreRef<'a, E::Array<'a>>),
    EUnary(StoreRef<'a, E::Unary<'a>>),
    EBinary(StoreRef<'a, E::Binary<'a>>),
    EClass(StoreRef<'a, E::Class<'a>>),

    ENew(StoreRef<'a, E::New<'a>>),
    EFunction(StoreRef<'a, E::Function<'a>>),
    ECall(StoreRef<'a, E::Call<'a>>),
    EDot(StoreRef<'a, E::Dot<'a>>),
    EIndex(StoreRef<'a, E::Index<'a>>),
    EArrow(StoreRef<'a, E::Arrow<'a>>),

    EJsxElement(StoreRef<'a, E::JSXElement<'a>>),
    EObject(StoreRef<'a, E::Object<'a>>),
    EObjectJSON(E::ObjectJSONRef<'a>),
    EArrayJSON(E::ArrayJSONRef<'a>),
    ESpread(StoreRef<'a, E::Spread<'a>>),
    ETemplate(StoreRef<'a, E::Template<'a>>),
    ERegExp(StoreRef<'a, E::RegExp<'a>>),
    EAwait(StoreRef<'a, E::Await<'a>>),
    EYield(StoreRef<'a, E::Yield<'a>>),
    EIf(StoreRef<'a, E::If<'a>>),
    EImport(StoreRef<'a, E::Import<'a>>),

    EIdentifier(E::Identifier),
    EImportIdentifier(E::ImportIdentifier),
    EPrivateIdentifier(E::PrivateIdentifier),
    ECommonjsExportIdentifier(E::CommonJSExportIdentifier),

    EBoolean(E::Boolean),
    EBranchBoolean(E::Boolean),
    ENumber(E::Number),
    EBigInt(StoreRef<'a, E::BigInt<'a>>),
    EString(StoreRef<'a, E::EString<'a>>),

    ERequireString(E::RequireString),
    ERequireResolveString(E::RequireResolveString),
    ERequireCallTarget,
    ERequireResolveCallTarget,

    EMissing(E::Missing),
    EThis(E::This),
    ESuper(E::Super),
    ENull(E::Null),
    EUndefined(E::Undefined),
    ENewTarget(E::NewTarget),
    EImportMeta(E::ImportMeta),

    EImportMetaMain(E::ImportMetaMain),
    ERequireMain,

    /// Covers some exotic AST node types under one namespace, since the
    /// places this is found it all follows similar handling.
    ESpecial(E::Special),

    EInlinedEnum(StoreRef<'a, E::InlinedEnum<'a>>),

    ENameOfSymbol(StoreRef<'a, E::NameOfSymbol>),
}

// ── Layout guards ─────────────────────────────────────────────────────────
// Every payload — `StoreRef<T>` and the inline identifier/`Number`/etc.
// structs — is ≤ 8 bytes at align 4, so `Data` = 1-byte discriminant + 8-byte
// payload → 12 at align 4. `Expr` = `Data` (12, align 4) + `Loc` (i32) → 16.
// `Option<Data>`/`Option<Expr>` niche-pack via spare discriminant values
// (47 variants < 256); a `#[repr(C)]`/`#[repr(u32)]` on `Data` would break it.
const _: () = assert!(core::mem::size_of::<Data>() == 12); // Do not increase the size of Expr
const _: () = assert!(core::mem::align_of::<Data>() == 4);
const _: () = assert!(core::mem::size_of::<Expr>() == 16);
const _: () = assert!(
    core::mem::size_of::<Option<Data>>() == core::mem::size_of::<Data>(),
    "expr::Data lost its niche — check for #[repr] or nullable-ptr payload"
);
const _: () = assert!(
    core::mem::size_of::<Option<Expr>>() == core::mem::size_of::<Expr>(),
    "Expr lost its niche — Option<Expr> is used in G::Property/B::Property/etc."
);
// Inline-payload ceilings (regress any of these and `Data` grows past 12).
// `align_of <= 4` is what keeps `Data` (and therefore `Expr`) at align 4.
const _: () = assert!(core::mem::size_of::<E::Identifier>() == 8);
const _: () = assert!(core::mem::align_of::<E::Identifier>() == 4);
const _: () = assert!(core::mem::size_of::<E::ImportIdentifier>() == 8);
const _: () = assert!(core::mem::size_of::<E::CommonJSExportIdentifier>() == 8);
const _: () = assert!(core::mem::size_of::<E::PrivateIdentifier>() == 8);
const _: () = assert!(core::mem::size_of::<E::Number>() <= 8);
const _: () = assert!(core::mem::align_of::<E::Number>() == 4);
const _: () = assert!(core::mem::size_of::<E::Special>() <= 8);
const _: () = assert!(core::mem::size_of::<E::RequireString>() <= 8);
const _: () = assert!(core::mem::size_of::<E::NewTarget>() <= 8);
const _: () = assert!(core::mem::size_of::<StoreRef<E::Binary>>() == core::mem::size_of::<usize>());
// Heap-payload shrinks unlocked by the 12-byte StoreSlice<T>:
const _: () = assert!(core::mem::size_of::<crate::G::FnBody>() == 16);
const _: () = assert!(core::mem::size_of::<E::Arrow>() <= 32);
const _: () = assert!(core::mem::size_of::<crate::S::Block>() == 16);

// Field-style accessors (`data.e_string()`, `data.e_object()`). The match arms
// in this file use these heavily; keeping them as inherent methods avoids
// rewriting ~25 sites. Returns `Option<StoreRef<T>>` (Copy).
impl<'a> Data<'a> {
    #[inline]
    pub fn e_string(&self) -> Option<StoreRef<'a, E::EString<'a>>> {
        if let Data::EString(s) = *self {
            Some(s)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_string_mut(&mut self) -> Option<&mut E::EString<'a>> {
        if let Data::EString(s) = self {
            Some(&mut **s)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_object(&self) -> Option<StoreRef<'a, E::Object<'a>>> {
        if let Data::EObject(o) = *self {
            Some(o)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_array(&self) -> Option<StoreRef<'a, E::Array<'a>>> {
        if let Data::EArray(a) = *self {
            Some(a)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_array_mut(&mut self) -> Option<&mut E::Array<'a>> {
        if let Data::EArray(a) = self {
            Some(&mut **a)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_object_mut(&mut self) -> Option<&mut E::Object<'a>> {
        if let Data::EObject(o) = self {
            Some(&mut **o)
        } else {
            None
        }
    }
    #[inline]
    pub fn as_e_string(&self) -> Option<StoreRef<'a, E::EString<'a>>> {
        self.e_string()
    }
    /// Mirrors `e_array()`; provided under the `as_*` name for downstream
    /// crates.
    #[inline]
    pub fn as_e_array(&self) -> Option<StoreRef<'a, E::Array<'a>>> {
        self.e_array()
    }
    /// Panics if not an object — callers gate with `is_object()` /
    /// `is_e_object()` first.
    #[inline]
    pub fn as_e_object(&self) -> StoreRef<'a, E::Object<'a>> {
        self.e_object()
            .expect("ExprData::as_e_object on non-object")
    }
    /// Mutable counterpart of `as_e_object()`; panics if not an object.
    #[inline]
    pub fn as_e_object_mut(&mut self) -> &mut E::Object<'a> {
        self.e_object_mut()
            .expect("ExprData::as_e_object_mut on non-object")
    }
    /// True if this is an `EObject`.
    #[inline]
    pub fn is_e_object(&self) -> bool {
        matches!(self, Data::EObject(_))
    }
    /// `E::Number` is an inline payload, so this returns it by
    /// value.
    #[inline]
    pub fn as_e_number(&self) -> Option<E::Number> {
        if let Data::ENumber(n) = *self {
            Some(n)
        } else {
            None
        }
    }

    // ── Remaining StoreRef<E::*> field-style accessors ──────────────────
    // Callers `.unwrap()` (or pattern-match) — the `Option` is the cheapest
    // sound encoding of a tag-mismatch precondition.
    #[inline]
    pub fn e_unary(&self) -> Option<StoreRef<'a, E::Unary<'a>>> {
        if let Data::EUnary(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_binary(&self) -> Option<StoreRef<'a, E::Binary<'a>>> {
        if let Data::EBinary(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_class(&self) -> Option<StoreRef<'a, E::Class<'a>>> {
        if let Data::EClass(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_new(&self) -> Option<StoreRef<'a, E::New<'a>>> {
        if let Data::ENew(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_function(&self) -> Option<StoreRef<'a, E::Function<'a>>> {
        if let Data::EFunction(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_call(&self) -> Option<StoreRef<'a, E::Call<'a>>> {
        if let Data::ECall(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_call_mut(&mut self) -> Option<&mut E::Call<'a>> {
        if let Data::ECall(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_dot(&self) -> Option<StoreRef<'a, E::Dot<'a>>> {
        if let Data::EDot(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_index(&self) -> Option<StoreRef<'a, E::Index<'a>>> {
        if let Data::EIndex(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_arrow(&self) -> Option<StoreRef<'a, E::Arrow<'a>>> {
        if let Data::EArrow(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_jsx_element(&self) -> Option<StoreRef<'a, E::JSXElement<'a>>> {
        if let Data::EJsxElement(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_spread(&self) -> Option<StoreRef<'a, E::Spread<'a>>> {
        if let Data::ESpread(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_template(&self) -> Option<StoreRef<'a, E::Template<'a>>> {
        if let Data::ETemplate(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_await_mut(&mut self) -> Option<&mut E::Await<'a>> {
        if let Data::EAwait(v) = self {
            Some(&mut **v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_if(&self) -> Option<StoreRef<'a, E::If<'a>>> {
        if let Data::EIf(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_import(&self) -> Option<StoreRef<'a, E::Import<'a>>> {
        if let Data::EImport(v) = *self {
            Some(v)
        } else {
            None
        }
    }

    // ── Inline (by-value) payload accessors ─────────────────────────────
    // These variants store the payload directly (no `StoreRef`); return
    // `Option<E::X>` by value — all are `Copy`.
    #[inline]
    pub fn e_identifier(&self) -> Option<E::Identifier> {
        if let Data::EIdentifier(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_import_identifier(&self) -> Option<E::ImportIdentifier> {
        if let Data::EImportIdentifier(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_number(&self) -> Option<E::Number> {
        if let Data::ENumber(v) = *self {
            Some(v)
        } else {
            None
        }
    }
    #[inline]
    pub fn e_special(&self) -> Option<E::Special> {
        if let Data::ESpecial(v) = *self {
            Some(v)
        } else {
            None
        }
    }
}

fn json_value_deep_clone<'a>(
    value: &E::JsonValue<'a>,
    loc: Loc,
    bump: &'a AstArena,
    stack_check: bun_core::StackCheck,
) -> Result<Expr<'a>, crate::Error> {
    Ok(match value {
        E::JsonValue::String(s) => {
            let bytes: &[u8] = bump.alloc_slice_copy(s.slice());
            Expr::allocate(bump, E::EString::init(bytes), loc)
        }
        E::JsonValue::Object(o) => Expr {
            loc,
            data: Data::EObjectJSON(*o).deep_clone_json_with_check(bump, stack_check)?,
        },
        E::JsonValue::Array(a) => Expr {
            loc,
            data: Data::EArrayJSON(*a).deep_clone_json_with_check(bump, stack_check)?,
        },
        _ => Expr::from_json_value(bump, value, loc),
    })
}

impl Data<'_> {
    /// Human-readable variant name for diagnostics (`"string"`, `"object"`, …).
    #[inline]
    pub fn tag_name(&self) -> &'static str {
        self.tag().type_name()
    }

    /// A number, a boolean, `null`, `undefined` or `E::Missing`: these point to nothing, so any lifetime fits.
    pub fn to_inline_literal<'b>(&self) -> Option<Data<'b>> {
        Some(match *self {
            Data::ENumber(n) => Data::ENumber(n),
            Data::EBoolean(b) => Data::EBoolean(b),
            Data::ENull(null) => Data::ENull(null),
            Data::EUndefined(undefined) => Data::EUndefined(undefined),
            Data::EMissing(missing) => Data::EMissing(missing),
            _ => return None,
        })
    }

    // Per-variant `as_*` accessors live alongside the enum decl above
    // (`e_string`/`e_object`/...).
    pub(crate) fn as_e_identifier(&self) -> Option<E::Identifier> {
        if let Data::EIdentifier(i) = self {
            Some(*i)
        } else {
            None
        }
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Data — heavy transform/analysis methods (clone/deep_clone/fold/etc).

impl<'a> Data<'a> {
    fn deep_clone_json_with_check<'b>(
        &self,
        bump: &'b AstArena,
        stack_check: bun_core::StackCheck,
    ) -> Result<Data<'b>, crate::Error>
    where
        'a: 'b,
    {
        if !stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }
        match self {
            Data::EArray(el) => {
                let items = el.items.try_deep_clone_with(bump, |e| {
                    e.deep_clone_json_with_check(bump, stack_check)
                })?;
                let item = bump.alloc_node(E::Array {
                    items,
                    comma_after_spread: el.comma_after_spread,
                    was_originally_macro: el.was_originally_macro,
                    is_single_line: el.is_single_line,
                    is_parenthesized: el.is_parenthesized,
                    close_bracket_loc: el.close_bracket_loc,
                });
                Ok(Data::EArray(item))
            }
            Data::EObjectJSON(el) => {
                let el = el.get();
                let rows = el.properties();
                let value_locs = el.value_locs();
                let mut properties = G::PropertyList::with_capacity_in(rows.len(), bump);
                for (i, row) in rows.iter().enumerate() {
                    let key_bytes: &[u8] = bump.alloc_slice_copy(row.key.slice());
                    let value_loc = value_locs.map_or(row.key_loc, |l| l[i]);
                    properties.push(
                        bump,
                        G::Property {
                            key: Some(Expr::allocate(
                                bump,
                                E::EString::init(key_bytes),
                                row.key_loc,
                            )),
                            value: Some(json_value_deep_clone(
                                &row.value,
                                value_loc,
                                bump,
                                stack_check,
                            )?),
                            kind: G::PropertyKind::Normal,
                            initializer: None,
                            ..Default::default()
                        },
                    );
                }
                let item = bump.alloc_node(E::Object {
                    properties,
                    is_single_line: el.is_single_line,
                    close_brace_loc: el.close_brace_loc,
                    ..Default::default()
                });
                Ok(Data::EObject(item))
            }
            Data::EArrayJSON(el) => {
                let el = el.get();
                let rows = el.items();
                let item_locs = el.item_locs();
                let mut items = crate::ExprNodeList::with_capacity_in(rows.len(), bump);
                for (i, value) in rows.iter().enumerate() {
                    let loc = item_locs.map_or(crate::Loc::EMPTY, |l| l[i]);
                    items.push(bump, json_value_deep_clone(value, loc, bump, stack_check)?);
                }
                let item = bump.alloc_node(E::Array {
                    items,
                    is_single_line: el.is_single_line,
                    close_bracket_loc: el.close_bracket_loc,
                    ..Default::default()
                });
                Ok(Data::EArray(item))
            }
            Data::EObject(el) => {
                let item = bump.alloc_node(E::Object {
                    properties: el
                        .properties
                        .try_deep_clone_with(bump, |p| p.deep_clone_json(bump, stack_check))?,
                    comma_after_spread: el.comma_after_spread,
                    is_single_line: el.is_single_line,
                    is_parenthesized: el.is_parenthesized,
                    was_originally_macro: el.was_originally_macro,
                    close_brace_loc: el.close_brace_loc,
                });
                Ok(Data::EObject(item))
            }
            Data::EString(el) => Ok(Data::EString(bump.alloc_node(el.flat_clone()))),
            _ => Ok(self.to_inline_literal().expect("a JSON value")),
        }
    }
} // end `impl Data` (deep_clone_json)

impl Data<'_> {
    /// `hasher` should be something with `fn update(&[u8])`;
    /// symbol table is passed to serialize `Ref` as identifier names instead of nondeterministic numbers.
    ///
    /// Hashes each scalar individually so the output is deterministic — no
    /// padding bytes are fed to the hasher (this is only consumed by React
    /// Refresh signature generation; only stability is required).
    pub fn write_to_hasher<H, S>(&self, hasher: &mut H, symbol_table: &S)
    where
        H: bun_core::Hasher + ?Sized,
        S: crate::base::SymbolTable + ?Sized,
    {
        self.write_to_hasher_with_check(hasher, symbol_table, bun_core::StackCheck::init());
    }

    fn write_to_hasher_with_check<H, S>(
        &self,
        hasher: &mut H,
        symbol_table: &S,
        stack_check: bun_core::StackCheck,
    ) where
        H: bun_core::Hasher + ?Sized,
        S: crate::base::SymbolTable + ?Sized,
    {
        if !stack_check.is_safe_to_recurse() {
            return;
        }

        use bun_core::write_any_to_hasher as raw;
        #[inline(always)]
        fn name_of<H: bun_core::Hasher + ?Sized, S: crate::base::SymbolTable + ?Sized>(
            h: &mut H,
            symbol_table: &S,
            r: Ref,
        ) {
            let sym = r.get_symbol(symbol_table);
            h.update(sym.original_name.slice());
        }

        raw(hasher, self.tag() as u8);
        match self {
            Data::ENameOfSymbol(e) => name_of(hasher, symbol_table, e.ref_),
            Data::EArray(e) => {
                raw(hasher, e.is_single_line);
                raw(hasher, e.is_parenthesized);
                raw(hasher, e.was_originally_macro);
                raw(hasher, e.items.len_u32());
                for item in e.items.slice() {
                    item.data
                        .write_to_hasher_with_check(hasher, symbol_table, stack_check);
                }
            }
            Data::EUnary(e) => {
                raw(hasher, e.flags.bits());
                raw(hasher, e.op as u8);
                e.value
                    .data
                    .write_to_hasher_with_check(hasher, symbol_table, stack_check);
            }
            Data::EBinary(e) => {
                // Not recursive on the left: the parser builds `a + b + …` in a loop, to any depth.
                let mut node = *e;
                let mut parents: Vec<StoreRef<E::Binary>> = Vec::new();
                loop {
                    raw(hasher, node.op as u8);
                    let Data::EBinary(left) = node.left.data else {
                        break;
                    };
                    raw(hasher, node.left.data.tag() as u8);
                    parents.push(node);
                    node = left;
                }
                node.left
                    .data
                    .write_to_hasher_with_check(hasher, symbol_table, stack_check);
                node.right
                    .data
                    .write_to_hasher_with_check(hasher, symbol_table, stack_check);
                while let Some(parent) = parents.pop() {
                    parent
                        .right
                        .data
                        .write_to_hasher_with_check(hasher, symbol_table, stack_check);
                }
            }
            Data::EClass(_) => {}
            Data::ENew(_) | Data::ECall(_) => {}
            Data::EFunction(_) => {}
            Data::EObjectJSON(e) => {
                let e = e.get();
                raw(hasher, e.is_single_line);
                raw(hasher, e.properties().len() as u32);
                for p in e.properties().iter() {
                    hasher.update(p.key.slice());
                    p.value.write_to_hasher(hasher);
                }
            }
            Data::EArrayJSON(e) => {
                let e = e.get();
                raw(hasher, e.is_single_line);
                raw(hasher, e.items().len() as u32);
                for item in e.items().iter() {
                    item.write_to_hasher(hasher);
                }
            }
            Data::EDot(e) => {
                // Encode `Option<#[repr(u8)] OptionalChain>` as its niche byte
                // (Some(Start)=0, Some(Continuation)=1, None=2) — same bytes
                // the prior raw-byte reinterpretation produced.
                raw(hasher, e.optional_chain.map_or(2u8, |c| c as u8));
                raw(hasher, e.name.len());
                e.target
                    .data
                    .write_to_hasher_with_check(hasher, symbol_table, stack_check);
                hasher.update(&e.name);
            }
            Data::EIndex(e) => {
                raw(hasher, e.optional_chain.map_or(2u8, |c| c as u8));
                e.target
                    .data
                    .write_to_hasher_with_check(hasher, symbol_table, stack_check);
                e.index
                    .data
                    .write_to_hasher_with_check(hasher, symbol_table, stack_check);
            }
            Data::EArrow(_) => {}
            Data::EJsxElement(_e) => {
                // autofix
            }
            Data::EObject(_e) => {
                // autofix
            }
            Data::ESpread(e) => {
                e.value
                    .data
                    .write_to_hasher_with_check(hasher, symbol_table, stack_check);
            }
            Data::EAwait(e) => {
                e.value
                    .data
                    .write_to_hasher_with_check(hasher, symbol_table, stack_check);
            }
            Data::EYield(e) => {
                // Hash the `Option` discriminant, then recurse into the value.
                raw(hasher, e.is_star);
                raw(hasher, e.value.is_some());
                if let Some(value) = &e.value {
                    value
                        .data
                        .write_to_hasher_with_check(hasher, symbol_table, stack_check);
                }
            }
            Data::ETemplate(_e) => {
                // autofix
            }
            Data::EIf(_e) => {
                // autofix
            }
            Data::EImport(_e) => {
                // autofix
            }
            Data::EIdentifier(e) => name_of(hasher, symbol_table, e.ref_),
            Data::EImportIdentifier(e) => name_of(hasher, symbol_table, e.ref_),
            Data::EPrivateIdentifier(e) => name_of(hasher, symbol_table, e.ref_),
            Data::ECommonjsExportIdentifier(e) => name_of(hasher, symbol_table, e.ref_),
            Data::EBoolean(e) | Data::EBranchBoolean(e) => {
                raw(hasher, e.value);
            }
            Data::ENumber(e) => {
                raw(hasher, e.value());
            }
            Data::EBigInt(e) => {
                hasher.update(&e.value);
            }
            Data::ERegExp(e) => {
                hasher.update(&e.value);
            }
            Data::EString(e) => {
                // Only the *first* rope segment is hashed.
                let current: &E::String = e;
                if current.is_utf8() {
                    hasher.update(&current.data);
                } else {
                    hasher.update(bun_core::slice_as_bytes(current.slice16()));
                }
                hasher.update(b"\x00");
            }
            Data::ERequireString(e) => {
                raw(hasher, e.import_record_index); // preferably, i'd like to write the filepath
            }
            Data::ERequireResolveString(e) => {
                raw(hasher, e.import_record_index);
            }
            Data::EImportMetaMain(e) => {
                raw(hasher, e.inverted);
            }
            Data::EInlinedEnum(e) => {
                // pretend there is no comment
                e.value
                    .data
                    .write_to_hasher_with_check(hasher, symbol_table, stack_check);
            }
            // no data
            Data::ERequireCallTarget
            | Data::ERequireResolveCallTarget
            | Data::EMissing(_)
            | Data::EThis(_)
            | Data::ESuper(_)
            | Data::ENull(_)
            | Data::EUndefined(_)
            | Data::ENewTarget(_)
            | Data::ERequireMain
            | Data::EImportMeta(_)
            | Data::ESpecial(_) => {}
        }
    }
}

impl<'a> Data<'a> {
    /// "const values" here refers to expressions that can participate in constant
    /// inlining, as they have no side effects on instantiation, and there would be
    /// no observable difference if duplicated. This is a subset of canBeMoved()
    pub(crate) fn can_be_const_value(&self) -> bool {
        match self {
            Data::ENumber(_)
            | Data::EBoolean(_)
            | Data::EBranchBoolean(_)
            | Data::ENull(_)
            | Data::EUndefined(_)
            | Data::EInlinedEnum(_) => true,
            Data::EString(str) => str.next.is_none(),
            Data::EArray(array) => array.was_originally_macro,
            Data::EObject(object) => object.was_originally_macro,
            _ => false,
        }
    }

    /// Expressions that can be moved are those that do not have side
    /// effects on their own. This is used to determine what can be moved
    /// outside of a module wrapper (__esm/__commonJS).
    pub(crate) fn can_be_moved(&self) -> bool {
        match self {
            // TODO: identifiers can be removed if unused, however code that
            // moves expressions around sometimes does so incorrectly when
            // doing destructures. test case: https://github.com/oven-sh/bun/issues/14027
            // Data::EIdentifier(id) => id.can_be_removed_if_unused,
            Data::EClass(class) => class.can_be_moved(),

            Data::EArrow(_)
            | Data::EFunction(_)
            | Data::ENumber(_)
            | Data::EBoolean(_)
            | Data::EBranchBoolean(_)
            | Data::ENull(_)
            | Data::EUndefined(_)
            // | Data::ERegExp(_)
            | Data::EBigInt(_)
            | Data::EString(_)
            | Data::EInlinedEnum(_)
            | Data::EImportMeta(_) => true,

            Data::ETemplate(template) => template.tag.is_none() && template.parts().len() == 0,

            Data::EArray(array) => array.was_originally_macro,
            Data::EObject(object) => object.was_originally_macro,

            // TODO: experiment with allowing some e_binary, e_unary, e_if as movable
            _ => false,
        }
    }

    pub fn is_safe_to_string(&self) -> bool {
        match self {
            // rope strings can throw when toString is called.
            Data::EString(str) => str.next.is_none(),

            Data::ENumber(_)
            | Data::EBoolean(_)
            | Data::EBranchBoolean(_)
            | Data::EUndefined(_)
            | Data::ENull(_) => true,
            // BigInt is deliberately excluded as a large enough BigInt could throw an out of memory error.
            //
            _ => false,
        }
    }

    pub fn known_primitive(&self) -> PrimitiveType {
        self.known_primitive_with_check(bun_core::StackCheck::init())
    }

    fn known_primitive_with_check(&self, stack_check: bun_core::StackCheck) -> PrimitiveType {
        if !stack_check.is_safe_to_recurse() {
            return PrimitiveType::Unknown;
        }
        match self {
            Data::EBigInt(_) => PrimitiveType::Bigint,
            Data::EBoolean(_) | Data::EBranchBoolean(_) => PrimitiveType::Boolean,
            Data::ENull(_) => PrimitiveType::Null,
            Data::ENumber(_) => PrimitiveType::Number,
            Data::EString(_) => PrimitiveType::String,
            Data::EUndefined(_) => PrimitiveType::Undefined,
            Data::ETemplate(t) => {
                if t.tag.is_none() {
                    PrimitiveType::String
                } else {
                    PrimitiveType::Unknown
                }
            }
            Data::EIf(e_if) => e_if
                .yes
                .data
                .merge_known_primitive_with_check(&e_if.no.data, stack_check),
            Data::EBinary(binary) => 'brk: {
                match binary.op {
                    crate::OpCode::BinStrictEq
                    | crate::OpCode::BinStrictNe
                    | crate::OpCode::BinLooseEq
                    | crate::OpCode::BinLooseNe
                    | crate::OpCode::BinLt
                    | crate::OpCode::BinGt
                    | crate::OpCode::BinLe
                    | crate::OpCode::BinGe
                    | crate::OpCode::BinInstanceof
                    | crate::OpCode::BinIn => break 'brk PrimitiveType::Boolean,
                    crate::OpCode::BinLogicalOr | crate::OpCode::BinLogicalAnd => {
                        break 'brk binary
                            .left
                            .data
                            .merge_known_primitive_with_check(&binary.right.data, stack_check);
                    }

                    crate::OpCode::BinNullishCoalescing => {
                        let left = binary.left.data.known_primitive_with_check(stack_check);
                        let right = binary.right.data.known_primitive_with_check(stack_check);
                        if left == PrimitiveType::Null || left == PrimitiveType::Undefined {
                            break 'brk right;
                        }

                        if left != PrimitiveType::Unknown {
                            if left != PrimitiveType::Mixed {
                                break 'brk left; // Definitely not null or undefined
                            }

                            if right != PrimitiveType::Unknown {
                                break 'brk PrimitiveType::Mixed; // Definitely some kind of primitive
                            }
                        }
                    }

                    crate::OpCode::BinAdd => {
                        let left = binary.left.data.known_primitive_with_check(stack_check);
                        let right = binary.right.data.known_primitive_with_check(stack_check);

                        if left == PrimitiveType::String || right == PrimitiveType::String {
                            break 'brk PrimitiveType::String;
                        }

                        if left == PrimitiveType::Bigint || right == PrimitiveType::Bigint {
                            break 'brk PrimitiveType::Bigint;
                        }

                        let left_ok = !matches!(
                            left,
                            PrimitiveType::Unknown | PrimitiveType::Mixed | PrimitiveType::Bigint
                        );
                        let right_ok = !matches!(
                            right,
                            PrimitiveType::Unknown | PrimitiveType::Mixed | PrimitiveType::Bigint
                        );
                        if left_ok && right_ok {
                            break 'brk PrimitiveType::Number;
                        }

                        break 'brk PrimitiveType::Mixed; // Can be number or bigint or string (or an exception)
                    }

                    crate::OpCode::BinSub
                    | crate::OpCode::BinSubAssign
                    | crate::OpCode::BinMul
                    | crate::OpCode::BinMulAssign
                    | crate::OpCode::BinDiv
                    | crate::OpCode::BinDivAssign
                    | crate::OpCode::BinRem
                    | crate::OpCode::BinRemAssign
                    | crate::OpCode::BinPow
                    | crate::OpCode::BinPowAssign
                    | crate::OpCode::BinBitwiseAnd
                    | crate::OpCode::BinBitwiseAndAssign
                    | crate::OpCode::BinBitwiseOr
                    | crate::OpCode::BinBitwiseOrAssign
                    | crate::OpCode::BinBitwiseXor
                    | crate::OpCode::BinBitwiseXorAssign
                    | crate::OpCode::BinShl
                    | crate::OpCode::BinShlAssign
                    | crate::OpCode::BinShr
                    | crate::OpCode::BinShrAssign
                    | crate::OpCode::BinUShr
                    | crate::OpCode::BinUShrAssign => break 'brk PrimitiveType::Mixed, // Can be number or bigint (or an exception)

                    crate::OpCode::BinAssign | crate::OpCode::BinComma => {
                        break 'brk binary.right.data.known_primitive_with_check(stack_check);
                    }

                    _ => {}
                }

                PrimitiveType::Unknown
            }

            Data::EUnary(unary) => match unary.op {
                crate::OpCode::UnVoid => PrimitiveType::Undefined,
                crate::OpCode::UnTypeof => PrimitiveType::String,
                crate::OpCode::UnNot | crate::OpCode::UnDelete => PrimitiveType::Boolean,
                crate::OpCode::UnPos => PrimitiveType::Number, // Cannot be bigint because that throws an exception
                crate::OpCode::UnNeg | crate::OpCode::UnCpl => {
                    match unary.value.data.known_primitive_with_check(stack_check) {
                        PrimitiveType::Bigint => PrimitiveType::Bigint,
                        PrimitiveType::Unknown | PrimitiveType::Mixed => PrimitiveType::Mixed,
                        _ => PrimitiveType::Number, // Can be number or bigint
                    }
                }
                crate::OpCode::UnPreDec
                | crate::OpCode::UnPreInc
                | crate::OpCode::UnPostDec
                | crate::OpCode::UnPostInc => PrimitiveType::Mixed, // Can be number or bigint

                _ => PrimitiveType::Unknown,
            },

            Data::EInlinedEnum(inlined) => {
                inlined.value.data.known_primitive_with_check(stack_check)
            }

            _ => PrimitiveType::Unknown,
        }
    }

    fn merge_known_primitive_with_check(
        &self,
        rhs: &Data,
        stack_check: bun_core::StackCheck,
    ) -> PrimitiveType {
        PrimitiveType::merge(
            self.known_primitive_with_check(stack_check),
            rhs.known_primitive_with_check(stack_check),
        )
    }

    /// Returns true if the result of the "typeof" operator on this expression is
    /// statically determined and this expression has no side effects (i.e. can be
    /// removed without consequence).
    #[inline]
    pub fn to_typeof(&self) -> Option<&'static [u8]> {
        Tag::typeof_(self.tag())
    }

    pub fn to_number(&self) -> Option<f64> {
        match self {
            Data::ENull(_) => Some(0.0),
            Data::EUndefined(_) => Some(f64::NAN),
            Data::EString(str) => {
                if str.next.is_some() {
                    return None;
                }
                if !str.is_utf8() {
                    return None;
                }
                // +'1' => 1
                Some(string_to_equivalent_number_value(str.slice8()))
            }
            Data::EBoolean(b) | Data::EBranchBoolean(b) => Some(if b.value { 1.0 } else { 0.0 }),
            Data::ENumber(n) => Some(n.value()),
            Data::EInlinedEnum(inlined) => match &inlined.value.data {
                Data::ENumber(num) => Some(num.value()),
                Data::EString(str) => {
                    if str.next.is_some() {
                        return None;
                    }
                    if !str.is_utf8() {
                        return None;
                    }
                    // +'1' => 1
                    Some(string_to_equivalent_number_value(str.slice8()))
                }
                _ => None,
            },
            _ => None,
        }
    }

    pub fn to_finite_number(&self) -> Option<f64> {
        match self {
            Data::EBoolean(b) | Data::EBranchBoolean(b) => Some(if b.value { 1.0 } else { 0.0 }),
            Data::ENumber(n) => {
                if n.value().is_finite() {
                    Some(n.value())
                } else {
                    None
                }
            }
            Data::EInlinedEnum(inlined) => match &inlined.value.data {
                Data::ENumber(num) => {
                    if num.value().is_finite() {
                        Some(num.value())
                    } else {
                        None
                    }
                }
                _ => None,
            },
            _ => None,
        }
    }

    pub(crate) fn extract_numeric_value(&self) -> Option<f64> {
        match self {
            Data::ENumber(n) => Some(n.value()),
            Data::EInlinedEnum(inlined) => match &inlined.value.data {
                Data::ENumber(num) => Some(num.value()),
                _ => None,
            },
            _ => None,
        }
    }

    pub(crate) fn extract_string_value(data: Self) -> Option<crate::StoreRef<'a, E::String<'a>>> {
        match data {
            Data::EString(s) => Some(s),
            Data::EInlinedEnum(inlined) => match inlined.value.data {
                Data::EString(str) => Some(str),
                _ => None,
            },
            _ => None,
        }
    }

    // toJS alias deleted — see `bun_js_parser_jsc::expr_jsc::DataJsc` extension trait.

    #[inline]
    pub fn is_string_value(&self) -> bool {
        matches!(self, Data::EString(_))
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Equality
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub enum Equality {
    /// Nothing is known about the equality of the two operands.
    Unknown,
    Equal,
    NotEqual,
    /// `require.main === module` (or `!==`/`==`/`!=`, in either order); the
    /// caller rewrites this to an import_meta_main node.
    RequireMainAndModule,
}

impl From<bool> for Equality {
    #[inline]
    fn from(equal: bool) -> Self {
        if equal {
            Equality::Equal
        } else {
            Equality::NotEqual
        }
    }
}

// `adt_const_params` (enum const-generic) is nightly-only. Lower to a sealed
// ZST trait, same pattern as `bun_paths::resolve_path::PlatformT`; callers use
// `Data::eql::<P, LooseEql>(...)` / `<P, StrictEql>`.
pub trait EqlKindT: Copy {
    const STRICT: bool;
}
#[derive(Clone, Copy)]
pub struct LooseEql;
impl EqlKindT for LooseEql {
    const STRICT: bool = false;
}
#[derive(Clone, Copy)]
pub struct StrictEql;
impl EqlKindT for StrictEql {
    const STRICT: bool = true;
}

/// Minimal parser surface needed by `Data::eql` — only the arena and the
/// module ref are touched. Kept separate from
/// `ast::p::ParserLike` so this file does not grow that trait (out of scope);
/// blanket-impl'd for every `P<...>` instantiation below.
pub trait EqlParser<'a> {
    fn arena(&self) -> &'a Bump;
    fn module_ref(&self) -> Ref;
}
// `impl EqlParser for P<...>` lives in `bun_js_parser` (next to `P`).

impl<'a> Data<'a> {
    pub fn eql<P: EqlParser<'a>, K: EqlKindT>(left: &Self, right: &Self, p: &mut P) -> Equality {
        // https://dorey.github.io/JavaScript-Equality-Table/
        match left {
            Data::EInlinedEnum(inlined) => {
                return Data::eql::<P, K>(&inlined.value.data, right, p);
            }

            Data::ENull(_) | Data::EUndefined(_) => {
                let right_tag = right.tag();
                if !matches!(right_tag, Tag::ENull | Tag::EUndefined)
                    && !right_tag.is_primitive_literal()
                {
                    return Equality::Unknown;
                }
                return Equality::from(if K::STRICT {
                    right_tag == left.tag()
                } else {
                    matches!(right_tag, Tag::ENull | Tag::EUndefined)
                });
            }
            Data::EBoolean(l) | Data::EBranchBoolean(l) => match right {
                Data::EBoolean(r) | Data::EBranchBoolean(r) => {
                    return Equality::from(l.value == r.value);
                }
                Data::ENumber(num) => {
                    if K::STRICT {
                        // "true === 1" is false
                        // "false === 0" is false
                        return Equality::NotEqual;
                    }
                    return Equality::from(if l.value {
                        num.value() == 1.0
                    } else {
                        num.value() == 0.0
                    });
                }
                Data::ENull(_) | Data::EUndefined(_) => {
                    return Equality::NotEqual;
                }
                _ => {}
            },
            Data::ENumber(l) => match right {
                Data::ENumber(r) => {
                    return Equality::from(l.value() == r.value());
                }
                Data::EInlinedEnum(r) => {
                    if let Data::ENumber(rn) = &r.value.data {
                        return Equality::from(l.value() == rn.value());
                    }
                }
                Data::EBoolean(r) | Data::EBranchBoolean(r) => {
                    if !K::STRICT {
                        // "1 == true" is true
                        // "0 == false" is true
                        return Equality::from(if r.value {
                            l.value() == 1.0
                        } else {
                            l.value() == 0.0
                        });
                    }
                    // "1 === true" is false
                    // "0 === false" is false
                    return Equality::NotEqual;
                }
                Data::ENull(_) | Data::EUndefined(_) => {
                    // "(not null or undefined) == undefined" is false
                    return Equality::NotEqual;
                }
                _ => {}
            },
            Data::EBigInt(l) => {
                return match right {
                    Data::EBigInt(r) => match E::BigInt::check_equality(&l.value, &r.value) {
                        Some(equal) => Equality::from(equal),
                        None => Equality::Unknown,
                    },
                    Data::ENull(_) | Data::EUndefined(_) => Equality::NotEqual,
                    _ => Equality::Unknown,
                };
            }
            Data::EString(l) => {
                // `StoreRef<EString>` is a Copy pointer; rebind mutably so
                // `DerefMut` gives `&mut EString` for in-place rope flattening.
                let mut l = *l;
                match right {
                    Data::EString(r) => {
                        let mut r = *r;
                        r.resolve_rope_if_needed(p.arena());
                        l.resolve_rope_if_needed(p.arena());
                        return Equality::from(r.eql_string(&l));
                    }
                    Data::EInlinedEnum(inlined) => {
                        if let Data::EString(r) = inlined.value.data {
                            let mut r = r;
                            r.resolve_rope_if_needed(p.arena());
                            l.resolve_rope_if_needed(p.arena());
                            return Equality::from(r.eql_string(&l));
                        }
                    }
                    Data::ENull(_) | Data::EUndefined(_) => {
                        return Equality::NotEqual;
                    }
                    Data::ENumber(r) => {
                        if !K::STRICT {
                            l.resolve_rope_if_needed(p.arena());
                            if r.value() == 0.0 && (l.is_blank() || l.eql_comptime(b"0")) {
                                return Equality::Equal;
                            }
                            if r.value() == 1.0 && l.eql_comptime(b"1") {
                                return Equality::Equal;
                            }
                            // the string could still equal 0 or 1 but it could be hex, binary, octal, ...
                            return Equality::Unknown;
                        } else {
                            return Equality::NotEqual;
                        }
                    }
                    _ => {}
                }
            }

            _ => {
                // Do not need to check left because e_require_main is
                // always re-ordered to the right side.
                if matches!(right, Data::ERequireMain) {
                    if let Some(id) = left.as_e_identifier() {
                        if id.ref_.eql(p.module_ref()) {
                            return Equality::RequireMainAndModule;
                        }
                    }
                }
            }
        }

        Equality::Unknown
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────────────────────────────────

/// `Number(str)`.
pub fn string_to_equivalent_number_value(str: &[u8]) -> f64 {
    // +"" -> 0
    if str.is_empty() {
        return 0.0;
    }
    if !bun_core::is_all_ascii(str) {
        return f64::NAN;
    }
    unsafe extern "C" {
        // NOT `safe fn`: callee dereferences `ptr` for `len` bytes — caller must
        // guarantee the (ptr,len) pair is a valid readable range.
        fn JSC__jsToNumber(ptr: *const u8, len: usize) -> f64;
    }
    // SAFETY: `str` is a live `&[u8]`, so `as_ptr()` is non-null and readable for
    // exactly `str.len()` bytes for the duration of this call; the C++ side reads
    // only (no mutation, no retention past return).
    unsafe { JSC__jsToNumber(str.as_ptr(), str.len()) }
}
