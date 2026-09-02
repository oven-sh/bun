//! Syntax-level peepholes that run under `minify_syntax`: rewrites of lowered
//! ES2015-era output back to the native syntax and a few small size wins the
//! other minifiers also apply.

use bun_collections::VecExt;

use crate::p::P;
use bun_alloc::{ArenaVec, ArenaVecExt as _};
use bun_ast::b::B as BData;
use bun_ast::flags as Flags;
use bun_ast::scope::Kind as ScopeKind;
use bun_ast::symbol::Kind as SymbolKind;
use bun_ast::{
    E, Expr, ExprData, ExprNodeList, G, OpCode as Op, OptionalChain, Ref, S, Stmt, StmtData,
    StoreRef,
};

/// The node that holds a `(t = x)` store moved into a recovered `?.` or `??`
/// expression. Once the function body is fully visited and `t` has no other
/// use, the store collapses to `x` and `var t` is dropped.
#[derive(Clone, Copy)]
pub(crate) enum TempStoreParent {
    Dot(StoreRef<E::Dot>),
    Index(StoreRef<E::Index>),
    Call(StoreRef<E::Call>),
    Nullish(StoreRef<E::Binary>),
}

#[derive(Clone, Copy)]
pub(crate) struct TempStoreCandidate {
    pub(crate) temp: Ref,
    pub(crate) parent: TempStoreParent,
}

/// A Babel/TypeScript `arguments` copy loop that can become
/// `var array = [...arguments]` once the loop's own temps prove unused
/// elsewhere in the function.
#[derive(Clone, Copy)]
pub(crate) struct ArgumentsCopyLoopCandidate {
    pub(crate) for_stmt: StoreRef<S::For>,
    pub(crate) arguments_ref: Ref,
    pub(crate) length: Option<(Ref, u32)>,
    pub(crate) index: (Ref, u32),
    pub(crate) array: Ref,
    pub(crate) offset: f64,
}

#[derive(Clone, Copy)]
pub(crate) enum MangleCandidate {
    TempStore(TempStoreCandidate),
    ArgumentsCopyLoop(ArgumentsCopyLoopCandidate),
}

enum ChainRoot {
    Dot(StoreRef<E::Dot>),
    Index(StoreRef<E::Index>),
    Call(StoreRef<E::Call>),
}

/// The number `str` denotes when it is the canonical decimal form of an
/// int32, so that `{ "123": x }` can become `{ 123: x }` and `a["123"]` can
/// become `a[123]`. Strings such as `"01"`, `"-0"`, `"1e3"` and
/// `"2147483648"` return `None`.
pub(crate) fn string_to_equivalent_number_value(str: &[u8]) -> Option<f64> {
    let (negative, digits) = match str {
        [b'-', rest @ ..] if !rest.is_empty() => (true, rest),
        _ => (false, str),
    };
    if digits.is_empty() || digits.len() > 10 {
        return None;
    }
    // A leading zero is only canonical for "0" itself, and "-0" is never
    // canonical because `String(-0)` is "0".
    if digits[0] == b'0' && (digits.len() > 1 || negative) {
        return None;
    }
    let mut value: i64 = 0;
    for &c in digits {
        if !c.is_ascii_digit() {
            return None;
        }
        value = value * 10 + i64::from(c - b'0');
    }
    if negative {
        value = -value;
    }
    if value < i64::from(i32::MIN) || value > i64::from(i32::MAX) {
        return None;
    }
    Some(value as f64)
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// `{ "123": x }` => `{ 123: x }`, `{ ["y"]: x }` => `{ y: x }`,
    /// `{ [123]: x }` => `{ 123: x }`. A computed `"__proto__"` key must stay
    /// computed: `{ ["__proto__"]: x }` defines an own property while
    /// `{ __proto__: x }` sets the prototype.
    pub(crate) fn mangle_object_property_key(&mut self, property: &mut G::Property) {
        let Some(key) = property.key.as_mut() else {
            return;
        };
        let key = key.unwrap_inlined();
        match key.data {
            ExprData::ENumber(_) => {
                // The bare number, not an inlined enum wrapper, so the printer
                // still recomputes a negative or non-finite key.
                property.key = Some(key);
                property.flags.remove(Flags::Property::IsComputed);
            }
            ExprData::EString(str) => {
                if let Some(number) = Self::property_key_string_to_number(&str) {
                    property.key = Some(Expr::init(E::Number::new(number), key.loc));
                    property.flags.remove(Flags::Property::IsComputed);
                } else if property.flags.contains(Flags::Property::IsComputed)
                    && !str.eql_comptime(b"__proto__")
                {
                    property.key = Some(key);
                    property.flags.remove(Flags::Property::IsComputed);
                }
            }
            _ => {}
        }
    }

    /// The class version of [`Self::mangle_object_property_key`]. A field or
    /// instance method named `constructor` and a static member named
    /// `prototype` must stay computed: as plain names they are early errors.
    pub(crate) fn mangle_class_property_key(&mut self, property: &mut G::Property) {
        let Some(key) = property.key.as_mut() else {
            return;
        };
        let key = key.unwrap_inlined();
        match key.data {
            ExprData::ENumber(_) => {
                property.key = Some(key);
                property.flags.remove(Flags::Property::IsComputed);
            }
            ExprData::EString(str) => {
                if let Some(number) = Self::property_key_string_to_number(&str) {
                    property.key = Some(Expr::init(E::Number::new(number), key.loc));
                    property.flags.remove(Flags::Property::IsComputed);
                } else if property.flags.contains(Flags::Property::IsComputed) {
                    let is_method = property.flags.contains(Flags::Property::IsMethod);
                    let is_static = property.flags.contains(Flags::Property::IsStatic);
                    let invalid_constructor =
                        str.eql_comptime(b"constructor") && (!is_method || !is_static);
                    let invalid_prototype = is_static && str.eql_comptime(b"prototype");
                    if !invalid_constructor && !invalid_prototype {
                        property.key = Some(key);
                        property.flags.remove(Flags::Property::IsComputed);
                    }
                }
            }
            _ => {}
        }
    }

    /// A property key string that is the canonical form of a non-negative
    /// int32 prints shorter as a number: `"123"` => `123`.
    fn property_key_string_to_number(str: &E::EString) -> Option<f64> {
        if !str.is_utf8() || str.next.is_some() {
            return None;
        }
        string_to_equivalent_number_value(str.slice8()).filter(|n| *n >= 0.0)
    }

    /// `a["123"]` => `a[123]`. Negative numbers are allowed here since the
    /// printer parenthesizes them.
    pub(crate) fn mangle_index_string_to_number(&mut self, index: &mut Expr) {
        let unwrapped = index.unwrap_inlined();
        let Some(str) = unwrapped.data.e_string() else {
            return;
        };
        if !str.is_utf8() || str.next.is_some() {
            return;
        }
        if let Some(number) = string_to_equivalent_number_value(str.slice8()) {
            *index = Expr::init(E::Number::new(number), unwrapped.loc);
        }
    }

    /// Whether `expr` reads an identifier this file declares. Reading one can
    /// neither throw a ReferenceError nor run a global getter.
    ///
    /// `module` and `exports` are declared ambiently for every file but only
    /// exist at runtime when the file ends up wrapped as CommonJS, so they
    /// count as unbound here.
    pub(crate) fn is_bound_identifier(&self, expr: &Expr) -> bool {
        match expr.data {
            ExprData::EIdentifier(id) => {
                !id.must_keep_due_to_with_stmt()
                    && !id.ref_.eql(self.module_ref)
                    && !id.ref_.eql(self.exports_ref)
                    && self.symbols[id.ref_.inner_index() as usize].kind != SymbolKind::Unbound
            }
            _ => false,
        }
    }

    /// Whether `expr` can be evaluated twice with no observable difference
    /// from evaluating it once: a declared local, `this`, or a literal.
    fn is_repeatable_operand(&self, expr: &Expr) -> bool {
        match expr.data {
            ExprData::EThis(_)
            | ExprData::ENumber(_)
            | ExprData::EString(_)
            | ExprData::EBoolean(_)
            | ExprData::ENull(_)
            | ExprData::EUndefined(_) => true,
            _ => self.is_bound_identifier(expr),
        }
    }

    /// Whether `target` can be both read and written as `target OP= value`
    /// in place of `target = target OP value`: the base and the property key
    /// must be evaluated once instead of twice without any visible change.
    ///
    /// A computed key must be a literal. `a[k] = a[k] + 1` converts `k` with
    /// ToPropertyKey twice and `a[k] += 1` once, which an object in `k`
    /// observes through its `toString`.
    fn is_compound_assignment_target(&self, target: &Expr) -> bool {
        match target.data {
            ExprData::EIdentifier(id) => !id.must_keep_due_to_with_stmt(),
            ExprData::EDot(dot) => {
                dot.optional_chain.is_none() && self.is_repeatable_operand(&dot.target)
            }
            ExprData::EIndex(index) => {
                index.optional_chain.is_none()
                    && self.is_repeatable_operand(&index.target)
                    && matches!(
                        index.index.unwrap_inlined().data,
                        ExprData::ENumber(_) | ExprData::EString(_)
                    )
            }
            _ => false,
        }
    }

    /// `x = x + y` => `x += y`, `a.b = a.b + c` => `a.b += c`, `x = x || y` =>
    /// `x ||= y`. Returns true when `e` was rewritten in place.
    pub(crate) fn mangle_assignment_to_compound(&mut self, e: &mut E::Binary) -> bool {
        debug_assert!(e.op == Op::BinAssign);
        let ExprData::EBinary(right) = e.right.data else {
            return false;
        };
        let compound_op = match right.op {
            Op::BinAdd => Op::BinAddAssign,
            Op::BinSub => Op::BinSubAssign,
            Op::BinMul => Op::BinMulAssign,
            Op::BinDiv => Op::BinDivAssign,
            Op::BinRem => Op::BinRemAssign,
            Op::BinPow => Op::BinPowAssign,
            Op::BinShl => Op::BinShlAssign,
            Op::BinShr => Op::BinShrAssign,
            Op::BinUShr => Op::BinUShrAssign,
            Op::BinBitwiseOr => Op::BinBitwiseOrAssign,
            Op::BinBitwiseAnd => Op::BinBitwiseAndAssign,
            Op::BinBitwiseXor => Op::BinBitwiseXorAssign,
            Op::BinLogicalOr => Op::BinLogicalOrAssign,
            Op::BinLogicalAnd => Op::BinLogicalAndAssign,
            Op::BinNullishCoalescing => Op::BinNullishCoalescingAssign,
            _ => return false,
        };
        if !self.is_compound_assignment_target(&e.left)
            || !values_look_the_same(&e.left.data, &right.left.data)
        {
            return false;
        }
        // `x ||= y` skips the write when `x` is truthy. A property setter, a
        // global accessor or the TypeError of a `const` would notice, so only
        // a mutable declared identifier may lose it. The logical form also
        // names an anonymous function: `x = x || function() {}` leaves `name`
        // empty while `x ||= function() {}` sets it to "x".
        if matches!(
            compound_op,
            Op::BinLogicalOrAssign | Op::BinLogicalAndAssign | Op::BinNullishCoalescingAssign
        ) {
            let ExprData::EIdentifier(id) = e.left.data else {
                return false;
            };
            let kind = self.symbols[id.ref_.inner_index() as usize].kind;
            if !self.is_bound_identifier(&e.left)
                || matches!(kind, SymbolKind::Constant | SymbolKind::Import)
                || right.right.is_anonymous_named()
            {
                return false;
            }
        }
        e.op = compound_op;
        e.right = right.right;
        self.ignore_usages_in(&right.left);
        true
    }

    /// Decrements the use counts of the identifiers in a node that a rewrite
    /// dropped from the tree.
    pub(crate) fn ignore_usages_in(&mut self, expr: &Expr) {
        match expr.data {
            ExprData::EIdentifier(id) => self.ignore_usage(id.ref_),
            ExprData::EDot(dot) => self.ignore_usages_in(&dot.target),
            ExprData::EIndex(index) => {
                self.ignore_usages_in(&index.target);
                self.ignore_usages_in(&index.index);
            }
            _ => {}
        }
    }
}

/// Whether two expressions are syntactically the same reference or literal
/// (after the identifier pass, so refs compare by symbol).
pub(crate) fn values_look_the_same(left: &ExprData, right: &ExprData) -> bool {
    match (left, right) {
        (ExprData::EInlinedEnum(a), _) => values_look_the_same(&a.value.data, right),
        (_, ExprData::EInlinedEnum(b)) => values_look_the_same(left, &b.value.data),
        (ExprData::EIdentifier(a), ExprData::EIdentifier(b)) => a.ref_.eql(b.ref_),
        (ExprData::EThis(_), ExprData::EThis(_)) => true,
        (ExprData::ENull(_), ExprData::ENull(_)) => true,
        (ExprData::EUndefined(_), ExprData::EUndefined(_)) => true,
        (ExprData::EBoolean(a), ExprData::EBoolean(b)) => a.value == b.value,
        (ExprData::EString(a), ExprData::EString(b)) => {
            a.next.is_none() && b.next.is_none() && a.eql_string(b)
        }
        (ExprData::EDot(a), ExprData::EDot(b)) => {
            a.optional_chain == b.optional_chain
                && a.name.slice() == b.name.slice()
                && values_look_the_same(&a.target.data, &b.target.data)
        }
        (ExprData::EIndex(a), ExprData::EIndex(b)) => {
            a.optional_chain == b.optional_chain
                && values_look_the_same(&a.target.data, &b.target.data)
                && values_look_the_same(&a.index.data, &b.index.data)
        }
        (ExprData::EUnary(a), ExprData::EUnary(b)) => {
            a.op == b.op && values_look_the_same(&a.value.data, &b.value.data)
        }
        (ExprData::EBinary(a), ExprData::EBinary(b)) => {
            a.op == b.op
                && values_look_the_same(&a.left.data, &b.left.data)
                && values_look_the_same(&a.right.data, &b.right.data)
        }
        (ExprData::ENumber(a), ExprData::ENumber(b)) => {
            // "a ? -0 : 0" must keep both branches.
            let (a, b) = (a.value(), b.value());
            a == b && a.is_sign_negative() == b.is_sign_negative()
        }
        _ => false,
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// `(t = x)` where `t` is a declared local: the lowered form of an
    /// optional chain or nullish coalesce holds its operand in a temp.
    fn as_local_temp_store(&self, expr: &Expr) -> Option<StoreRef<E::Binary>> {
        let ExprData::EBinary(store) = expr.data else {
            return None;
        };
        if store.op != Op::BinAssign || !self.is_bound_identifier(&store.left) {
            return None;
        }
        Some(store)
    }

    /// `a === null || a === void 0` => `a == null`
    /// `a !== null && a !== void 0` => `a != null`
    /// `(t = x) === null || t === void 0` => `(t = x) == null`
    pub(crate) fn mangle_null_or_undefined_check(
        &mut self,
        e: &E::Binary,
        loc: bun_ast::Loc,
    ) -> Option<Expr> {
        let (strict_op, loose_op) = match e.op {
            Op::BinLogicalOr => (Op::BinStrictEq, Op::BinLooseEq),
            Op::BinLogicalAnd => (Op::BinStrictNe, Op::BinLooseNe),
            _ => return None,
        };
        let (ExprData::EBinary(left), ExprData::EBinary(right)) = (e.left.data, e.right.data)
        else {
            return None;
        };
        if left.op != strict_op || right.op != strict_op {
            return None;
        }
        // Constants were already moved to the right of each comparison.
        let compares_null_and_undefined = matches!(
            (left.right.data, right.right.data),
            (ExprData::ENull(_), ExprData::EUndefined(_))
                | (ExprData::EUndefined(_), ExprData::ENull(_))
        );
        if !compares_null_and_undefined {
            return None;
        }
        // The loose check reads the value once where the strict pair reads
        // it twice, so the value must be a temp store, a declared local or
        // `this`: an unbound global could be an accessor.
        let same_value = match self.as_local_temp_store(&left.left) {
            Some(store) => values_look_the_same(&store.left.data, &right.left.data),
            None => {
                self.is_repeatable_operand(&left.left)
                    && values_look_the_same(&left.left.data, &right.left.data)
            }
        };
        if !same_value {
            return None;
        }
        self.ignore_usages_in(&right.left);
        let null = self.new_expr(E::Null {}, left.right.loc);
        Some(self.new_expr(
            E::Binary {
                op: loose_op,
                left: left.left,
                right: null,
            },
            loc,
        ))
    }

    /// The `??` and `?.` recoveries of esbuild's `MangleIfExpr`, extended to
    /// the lowered forms that hold the operand in a temp:
    ///
    /// - `a != null ? a : b` => `a ?? b`
    /// - `a == null ? void 0 : a.b.c(d)` => `a?.b.c(d)`
    /// - `(t = x) != null ? t : b` => `(t = x) ?? b`
    /// - `(t = x) == null ? void 0 : t.b` => `(t = x)?.b`
    ///
    /// A conditional that is itself called yields a value, so `this` is
    /// undefined in the call; the `?.` form would bind it. Callers pass
    /// `is_call_target` to keep that case as is.
    ///
    /// Returns true when `e` was replaced.
    pub(crate) fn mangle_if_expr(&mut self, e: &mut Expr, is_call_target: bool) -> bool {
        let Some(e_if) = e.data.e_if() else {
            return false;
        };
        let ExprData::EBinary(test) = e_if.test.data else {
            return false;
        };
        let (check, when_null, when_non_null) = match test.op {
            Op::BinLooseEq if matches!(test.right.data, ExprData::ENull(_)) => {
                (test.left, e_if.yes, e_if.no)
            }
            Op::BinLooseEq if matches!(test.left.data, ExprData::ENull(_)) => {
                (test.right, e_if.yes, e_if.no)
            }
            Op::BinLooseNe if matches!(test.right.data, ExprData::ENull(_)) => {
                (test.left, e_if.no, e_if.yes)
            }
            Op::BinLooseNe if matches!(test.left.data, ExprData::ENull(_)) => {
                (test.right, e_if.no, e_if.yes)
            }
            _ => return false,
        };

        // The value under test, as the other branch refers to it.
        let temp_store = self.as_local_temp_store(&check);
        let reference = match temp_store {
            Some(store) => store.left.data,
            None => {
                if !self.expr_can_be_removed_if_unused(&check) {
                    return false;
                }
                check.data
            }
        };

        // "a != null ? a : b" => "a ?? b"
        if values_look_the_same(&reference, &when_non_null.data) {
            self.ignore_usages_in(&when_non_null);
            let nullish = self.new_expr(
                E::Binary {
                    op: Op::BinNullishCoalescing,
                    left: check,
                    right: when_null,
                },
                e.loc,
            );
            if let (Some(store), ExprData::EBinary(binary)) = (temp_store, nullish.data) {
                self.record_temp_store_candidate(store, TempStoreParent::Nullish(binary));
            }
            *e = nullish;
            return true;
        }

        // "a != null ? a.b.c[d](e) : undefined" => "a?.b.c[d](e)"
        if is_call_target || !matches!(when_null.data, ExprData::EUndefined(_)) {
            return false;
        }
        let Some(root) = Self::try_to_insert_optional_chain(&reference, when_non_null) else {
            return false;
        };
        // The chain root read the reference a second time. Move the test
        // expression there so a temp store keeps its single evaluation.
        let parent = match root {
            ChainRoot::Dot(mut dot) => {
                self.ignore_usages_in(&dot.target);
                dot.target = check;
                TempStoreParent::Dot(dot)
            }
            ChainRoot::Index(mut index) => {
                self.ignore_usages_in(&index.target);
                index.target = check;
                TempStoreParent::Index(index)
            }
            ChainRoot::Call(mut call) => {
                self.ignore_usages_in(&call.target);
                call.target = check;
                TempStoreParent::Call(call)
            }
        };
        if let Some(store) = temp_store {
            self.record_temp_store_candidate(store, parent);
        }
        *e = Expr {
            data: when_non_null.data,
            loc: e.loc,
        };
        true
    }

    /// Marks the access at the root of `expr` whose target is `reference`
    /// as the start of an optional chain and the accesses above it as its
    /// continuation. Returns the root access.
    ///
    /// Nothing is changed when a plain access sits above an inner `?.`:
    /// `(a.b?.c).d` must still throw when `a.b` is null, while
    /// `a?.b?.c.d` would skip `.d` as well.
    fn try_to_insert_optional_chain(reference: &ExprData, expr: Expr) -> Option<ChainRoot> {
        let (root, _) = Self::find_chain_root(reference, expr)?;
        Self::mark_optional_chain(reference, expr);
        Some(root)
    }

    /// Finds the chain root and whether an inner `?.` start lies between
    /// it and `expr`.
    fn find_chain_root(reference: &ExprData, expr: Expr) -> Option<(ChainRoot, bool)> {
        let (target, optional_chain, root) = match expr.data {
            ExprData::EDot(dot) => (dot.target, dot.optional_chain, ChainRoot::Dot(dot)),
            ExprData::EIndex(index) => {
                (index.target, index.optional_chain, ChainRoot::Index(index))
            }
            ExprData::ECall(call) => (call.target, call.optional_chain, ChainRoot::Call(call)),
            _ => return None,
        };
        if values_look_the_same(reference, &target.data) {
            return Some((root, false));
        }
        let (root, inner_start) = Self::find_chain_root(reference, target)?;
        match optional_chain {
            // A parenthesized inner chain ended below this access.
            None if inner_start => None,
            None | Some(OptionalChain::Continuation) => Some((root, inner_start)),
            Some(OptionalChain::Start) => Some((root, true)),
        }
    }

    /// The write half of [`Self::try_to_insert_optional_chain`]: the root
    /// becomes a chain start and each plain access above it a continuation.
    fn mark_optional_chain(reference: &ExprData, expr: Expr) {
        match expr.data {
            ExprData::EDot(mut dot) => {
                if values_look_the_same(reference, &dot.target.data) {
                    dot.optional_chain = Some(OptionalChain::Start);
                } else {
                    Self::mark_optional_chain(reference, dot.target);
                    if dot.optional_chain.is_none() {
                        dot.optional_chain = Some(OptionalChain::Continuation);
                    }
                }
            }
            ExprData::EIndex(mut index) => {
                if values_look_the_same(reference, &index.target.data) {
                    index.optional_chain = Some(OptionalChain::Start);
                } else {
                    Self::mark_optional_chain(reference, index.target);
                    if index.optional_chain.is_none() {
                        index.optional_chain = Some(OptionalChain::Continuation);
                    }
                }
            }
            ExprData::ECall(mut call) => {
                if values_look_the_same(reference, &call.target.data) {
                    call.optional_chain = Some(OptionalChain::Start);
                } else {
                    Self::mark_optional_chain(reference, call.target);
                    if call.optional_chain.is_none() {
                        call.optional_chain = Some(OptionalChain::Continuation);
                    }
                }
            }
            _ => {}
        }
    }

    fn record_temp_store_candidate(&mut self, store: StoreRef<E::Binary>, parent: TempStoreParent) {
        if self.fn_body_depth == 0 || self.is_revisit_for_substitution || self.is_control_flow_dead
        {
            return;
        }
        let ExprData::EIdentifier(temp) = store.left.data else {
            return;
        };
        self.mangle_candidates
            .push(MangleCandidate::TempStore(TempStoreCandidate {
                temp: temp.ref_,
                parent,
            }));
    }

    /// Recognizes the loop Babel and TypeScript emit for rest parameters and
    /// `Array.prototype.slice.call(arguments)`:
    ///
    /// ```js
    /// for (var len = arguments.length, args = Array(len), i = 0; i < len; i++)
    ///   args[i] = arguments[i];
    /// for (var len = arguments.length, rest = Array(len > 1 ? len - 1 : 0), i = 1; i < len; i++)
    ///   rest[i - 1] = arguments[i];
    /// for (var args = [], i = 0; i < arguments.length; i++)
    ///   args[i] = arguments[i];
    /// ```
    ///
    /// The rewrite to `var args = [...arguments]` waits until the end of the
    /// function body, when the use counts show whether `len` and `i` are
    /// used anywhere else.
    pub(crate) fn record_arguments_copy_loop(&mut self, for_stmt: StoreRef<S::For>) {
        if self.fn_body_depth == 0
            || self.is_revisit_for_substitution
            || self.is_control_flow_dead
            || !self.is_strict_mode()
        {
            return;
        }
        let Some(candidate) = self.match_arguments_copy_loop(for_stmt) else {
            return;
        };
        self.mangle_candidates
            .push(MangleCandidate::ArgumentsCopyLoop(candidate));
    }

    fn is_arguments_object(&self, expr: &Expr) -> Option<Ref> {
        let ExprData::EIdentifier(id) = expr.data else {
            return None;
        };
        (self.symbols[id.ref_.inner_index() as usize].kind == SymbolKind::Arguments)
            .then_some(id.ref_)
    }

    fn is_ident(expr: &Expr, ref_: Ref) -> bool {
        matches!(expr.data, ExprData::EIdentifier(id) if id.ref_.eql(ref_))
    }

    fn is_number(expr: &Expr, value: f64) -> bool {
        matches!(expr.data, ExprData::ENumber(n) if n.value() == value)
    }

    fn match_arguments_copy_loop(
        &self,
        for_ref: StoreRef<S::For>,
    ) -> Option<ArgumentsCopyLoopCandidate> {
        let for_stmt: &S::For = &for_ref;
        // Body: `array[i - offset] = arguments[i]` (optionally in a block)
        let body = match for_stmt.body.data {
            StmtData::SBlock(block) if block.stmts.len() == 1 => block.stmts.slice()[0],
            _ => for_stmt.body,
        };
        let StmtData::SExpr(body_expr) = body.data else {
            return None;
        };
        let ExprData::EBinary(assign) = body_expr.value.data else {
            return None;
        };
        if assign.op != Op::BinAssign {
            return None;
        }
        let ExprData::EIndex(lhs) = assign.left.data else {
            return None;
        };
        let ExprData::EIndex(rhs) = assign.right.data else {
            return None;
        };
        if lhs.optional_chain.is_some() || rhs.optional_chain.is_some() {
            return None;
        }
        let ExprData::EIdentifier(array_id) = lhs.target.data else {
            return None;
        };
        let array = array_id.ref_;
        let arguments_ref = self.is_arguments_object(&rhs.target)?;
        let ExprData::EIdentifier(index_id) = rhs.index.data else {
            return None;
        };
        let index = index_id.ref_;
        let offset = match lhs.index.data {
            ExprData::EIdentifier(id) if id.ref_.eql(index) => 0.0,
            ExprData::EBinary(sub) if sub.op == Op::BinSub && Self::is_ident(&sub.left, index) => {
                match sub.right.data {
                    ExprData::ENumber(n) if n.value() >= 1.0 && n.value().fract() == 0.0 => {
                        n.value()
                    }
                    _ => return None,
                }
            }
            _ => return None,
        };
        let mut index_uses: u32 = 2;

        // Update: `i++` or `++i`
        let ExprData::EUnary(update) = for_stmt.update?.data else {
            return None;
        };
        if !matches!(update.op, Op::UnPostInc | Op::UnPreInc)
            || !Self::is_ident(&update.value, index)
        {
            return None;
        }
        index_uses += 1;

        // Test: `i < len` or `i < arguments.length`
        let ExprData::EBinary(test) = for_stmt.test?.data else {
            return None;
        };
        if test.op != Op::BinLt || !Self::is_ident(&test.left, index) {
            return None;
        }
        index_uses += 1;
        let mut length: Option<(Ref, u32)> = match test.right.data {
            ExprData::EIdentifier(id) => Some((id.ref_, 1)),
            ExprData::EDot(dot) => {
                if dot.name.slice() != b"length" || self.is_arguments_object(&dot.target).is_none()
                {
                    return None;
                }
                None
            }
            _ => return None,
        };

        // Init: `var [len = arguments.length,] array = <init>, i = offset`
        let StmtData::SLocal(init) = for_stmt.init?.data else {
            return None;
        };
        if init.kind != S::Kind::KVar {
            return None;
        }
        let decls = init.decls.slice();
        let mut decl_index = 0usize;
        if let Some((length_ref, _)) = length {
            let len_decl = decls.first()?;
            let BData::BIdentifier(binding) = len_decl.binding.data else {
                return None;
            };
            if !binding.r#ref.eql(length_ref) {
                return None;
            }
            let ExprData::EDot(dot) = len_decl.value?.data else {
                return None;
            };
            if dot.name.slice() != b"length" || self.is_arguments_object(&dot.target).is_none() {
                return None;
            }
            decl_index = 1;
        }
        if decls.len() != decl_index + 2 {
            return None;
        }
        let array_decl = &decls[decl_index];
        let index_decl = &decls[decl_index + 1];
        let BData::BIdentifier(array_binding) = array_decl.binding.data else {
            return None;
        };
        let BData::BIdentifier(index_binding) = index_decl.binding.data else {
            return None;
        };
        if !array_binding.r#ref.eql(array)
            || !index_binding.r#ref.eql(index)
            || !index_decl
                .value
                .is_some_and(|v| Self::is_number(&v, offset))
        {
            return None;
        }

        // Array init: `[]`, `Array(len)`, `new Array(len)`, or for an offset
        // `Array(len > offset ? len - offset : 0)`
        match array_decl.value?.data {
            ExprData::EArray(array) => {
                if array.items.len_u32() != 0 {
                    return None;
                }
            }
            ExprData::ECall(_) | ExprData::ENew(_) => {
                let (target, arg) = match array_decl.value?.data {
                    ExprData::ECall(call) if call.args.len_u32() == 1 => {
                        (call.target, *call.args.at(0))
                    }
                    ExprData::ENew(new) if new.args.len_u32() == 1 => (new.target, *new.args.at(0)),
                    _ => return None,
                };
                let ExprData::EIdentifier(array_ctor) = target.data else {
                    return None;
                };
                let array_ctor_symbol = &self.symbols[array_ctor.ref_.inner_index() as usize];
                if array_ctor_symbol.kind != SymbolKind::Unbound
                    || array_ctor_symbol.original_name.slice() != b"Array"
                {
                    return None;
                }
                let (length_ref, length_uses) = length.as_mut()?;
                if offset == 0.0 && Self::is_ident(&arg, *length_ref) {
                    *length_uses += 1;
                } else if let ExprData::EIf(cond) = arg.data
                    && let ExprData::EBinary(gt) = cond.test.data
                    && gt.op == Op::BinGt
                    && Self::is_ident(&gt.left, *length_ref)
                    && Self::is_number(&gt.right, offset)
                    && let ExprData::EBinary(sub) = cond.yes.data
                    && sub.op == Op::BinSub
                    && Self::is_ident(&sub.left, *length_ref)
                    && Self::is_number(&sub.right, offset)
                    && Self::is_number(&cond.no, 0.0)
                {
                    *length_uses += 2;
                } else {
                    return None;
                }
            }
            _ => return None,
        }

        Some(ArgumentsCopyLoopCandidate {
            for_stmt: for_ref,
            arguments_ref,
            length,
            index: (index, index_uses),
            array,
            offset,
        })
    }
}

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Whether `ref_` is a plain `var` or `let` declared by the function body
    /// that is being finished, so that every use of it has been counted.
    /// Parameters are excluded: a sloppy-mode `arguments` object aliases them.
    /// A symbol that another symbol links to is excluded too: a nested
    /// `var n` redeclaration records its uses on its own symbol.
    fn is_local_temp_of_current_fn_body(&self, ref_: Ref) -> bool {
        let symbol = &self.symbols[ref_.inner_index() as usize];
        if !matches!(symbol.kind, SymbolKind::Hoisted | SymbolKind::Other)
            || symbol.has_link()
            || symbol.is_link_target()
        {
            return false;
        }
        let body_scope = self.current_scope();
        if body_scope.kind != ScopeKind::FunctionBody {
            return false;
        }
        let name = symbol.original_name.slice();
        let hash = bun_ast::Scope::get_member_hash(name);
        if !body_scope
            .get_member_with_hash(name, hash)
            .is_some_and(|member| member.ref_.eql(ref_))
        {
            return false;
        }
        match body_scope.parent {
            Some(args_scope) if args_scope.kind == ScopeKind::FunctionArgs => args_scope
                .get_member_with_hash(name, hash)
                .is_none_or(|member| !member.ref_.eql(ref_)),
            _ => false,
        }
    }

    fn use_count(&self, ref_: Ref) -> u32 {
        self.symbols[ref_.inner_index() as usize].use_count_estimate
    }

    /// Finishes the rewrites recorded while visiting a function body, now
    /// that the use count of every `var` the body declares is final.
    pub(crate) fn apply_fn_body_mangle_candidates(
        &mut self,
        stmts: &mut ArenaVec<'a, Stmt>,
        base: usize,
    ) {
        if self.mangle_candidates.len() <= base {
            return;
        }
        let mut temp_stores: Vec<TempStoreCandidate> = Vec::new();
        let mut copy_loops: Vec<ArgumentsCopyLoopCandidate> = Vec::new();
        for candidate in self.mangle_candidates.drain(base..) {
            match candidate {
                MangleCandidate::TempStore(c) => temp_stores.push(c),
                MangleCandidate::ArgumentsCopyLoop(c) => copy_loops.push(c),
            }
        }
        // Direct eval can read any local by name.
        if self.current_scope().contains_direct_eval {
            return;
        }

        for c in copy_loops {
            self.rewrite_arguments_copy_loop(c, stmts);
        }

        // Decide each temp from all of its stores at once. The sort is
        // stable, so a group keeps the order the stores were recorded in.
        temp_stores.sort_by_key(|c| c.temp.inner_index());
        let mut group_start = 0usize;
        while group_start < temp_stores.len() {
            let temp = temp_stores[group_start].temp;
            let mut group_end = group_start + 1;
            while group_end < temp_stores.len() && temp_stores[group_end].temp.eql(temp) {
                group_end += 1;
            }
            let group = &temp_stores[group_start..group_end];
            group_start = group_end;

            if !self.is_local_temp_of_current_fn_body(temp) {
                // A temp of an enclosing function is decided when that
                // function's body is finished.
                if self.fn_body_depth > 0 {
                    self.mangle_candidates
                        .extend(group.iter().map(|c| MangleCandidate::TempStore(*c)));
                }
                continue;
            }
            // Every use of the temp must be one of the recorded stores, and
            // each store must still sit where it was put.
            if self.use_count(temp) as usize != group.len()
                || !group.iter().all(|c| Self::temp_store_of(c).is_some())
            {
                continue;
            }
            Self::remove_uninitialized_decl(stmts, temp);
            for c in group {
                self.eliminate_temp_store(*c);
            }
        }
    }

    /// The `(t = x)` store a candidate recorded, if its parent still holds it.
    fn temp_store_of(c: &TempStoreCandidate) -> Option<StoreRef<E::Binary>> {
        let slot = match c.parent {
            TempStoreParent::Dot(dot) => dot.target,
            TempStoreParent::Index(index) => index.target,
            TempStoreParent::Call(call) => call.target,
            TempStoreParent::Nullish(binary) => binary.left,
        };
        let ExprData::EBinary(store) = slot.data else {
            return None;
        };
        if store.op != Op::BinAssign
            || !matches!(store.left.data, ExprData::EIdentifier(id) if id.ref_.eql(c.temp))
        {
            return None;
        }
        Some(store)
    }

    /// `(t = x)?.y` => `x?.y`, `(t = x) ?? y` => `x ?? y`. A call on the
    /// bare temp keeps `this` undefined: `(t = a.b)?.()` => `(0, a.b)?.()`.
    fn eliminate_temp_store(&mut self, c: TempStoreCandidate) {
        let Some(store) = Self::temp_store_of(&c) else {
            return;
        };
        let value = store.right;
        let with_this_dropped = |value: Expr| {
            if value.has_value_for_this_in_call() {
                Expr::join_with_comma(
                    Expr {
                        data: crate::parser::prefill::data::ZERO,
                        loc: value.loc,
                    },
                    value,
                )
            } else {
                value
            }
        };
        match c.parent {
            TempStoreParent::Dot(mut dot) => dot.target = value,
            TempStoreParent::Index(mut index) => index.target = value,
            TempStoreParent::Call(mut call) => call.target = with_this_dropped(value),
            TempStoreParent::Nullish(mut binary) => binary.left = value,
        }
        self.ignore_usage(c.temp);
    }

    /// Drops `var t;` (or the `t` entry of `var a, t, b;`) from the top
    /// level of a function body. A `var t;` inside a nested block stays: it
    /// is then a dead declaration, and the collapsed stores are still correct.
    fn remove_uninitialized_decl(stmts: &mut ArenaVec<'a, Stmt>, ref_: Ref) {
        for stmt in stmts.iter_mut() {
            let StmtData::SLocal(mut local) = stmt.data else {
                continue;
            };
            if local.is_export || local.kind.is_using() {
                continue;
            }
            let position = local.decls.slice().iter().position(|decl| {
                decl.value.is_none()
                    && matches!(decl.binding.data, BData::BIdentifier(id) if id.r#ref.eql(ref_))
            });
            let Some(position) = position else {
                continue;
            };
            local.decls.ordered_remove(position);
            if local.decls.len_u32() == 0 {
                *stmt = stmt.to_empty();
            }
            return;
        }
    }

    fn rewrite_arguments_copy_loop(
        &mut self,
        c: ArgumentsCopyLoopCandidate,
        stmts: &mut ArenaVec<'a, Stmt>,
    ) {
        if let Some((length, uses)) = c.length
            && (self.use_count(length) != uses || !self.is_local_temp_of_current_fn_body(length))
        {
            return;
        }
        if self.use_count(c.index.0) != c.index.1
            || !self.is_local_temp_of_current_fn_body(c.index.0)
            || !self.is_local_temp_of_current_fn_body(c.array)
        {
            return;
        }
        let Some(position) = stmts.iter().position(
            |stmt| matches!(stmt.data, StmtData::SFor(f) if core::ptr::eq(f.as_ptr(), c.for_stmt.as_ptr())),
        ) else {
            return;
        };
        let loc = stmts[position].loc;

        // The loop's own reads of its temps and of `arguments` go away.
        if let Some((length, uses)) = c.length {
            for _ in 0..uses {
                self.ignore_usage(length);
            }
        }
        for _ in 0..c.index.1 {
            self.ignore_usage(c.index.0);
        }
        self.ignore_usage(c.array);
        self.ignore_usage(c.arguments_ref);

        // The copy is only needed when the array is read after the loop.
        if self.use_count(c.array) == 0 {
            self.ignore_usage(c.arguments_ref);
            stmts[position] = stmts[position].to_empty();
            return;
        }

        let spread = self.new_expr(
            E::Spread {
                value: Expr::init_identifier(c.arguments_ref, loc),
            },
            loc,
        );
        let mut value = self.new_expr(
            E::Array {
                items: ExprNodeList::init_one(spread),
                is_single_line: true,
                ..Default::default()
            },
            loc,
        );
        if c.offset > 0.0 {
            let slice = self.new_expr(
                E::Dot {
                    target: value,
                    name: E::Str::new(b"slice"),
                    name_loc: loc,
                    ..Default::default()
                },
                loc,
            );
            let offset = self.new_expr(E::Number::new(c.offset), loc);
            value = self.new_expr(
                E::Call {
                    target: slice,
                    args: ExprNodeList::init_one(offset),
                    ..Default::default()
                },
                loc,
            );
        }
        let decl = G::Decl {
            binding: self.b(bun_ast::b::Identifier { r#ref: c.array }, loc),
            value: Some(value),
        };
        stmts[position] = self.s(
            S::Local {
                kind: S::Kind::KVar,
                decls: G::DeclList::init_one(decl),
                ..Default::default()
            },
            loc,
        );
    }

    /// `["a", "b", ...]` => `"a.b...".split(".")` when the array holds at
    /// least 16 string literals. Each element saves its quotes and comma.
    pub(crate) fn mangle_string_array_to_split(&mut self, e: &mut Expr) {
        const MIN_ITEMS: usize = 16;
        const DELIMITERS: &[u8] = b".,() ";

        let Some(array) = e.data.e_array() else {
            return;
        };
        let items = array.items.slice();
        if items.len() < MIN_ITEMS {
            return;
        }
        let mut total_len = 0usize;
        let mut all_single_byte = true;
        for item in items {
            let Some(str) = item.data.e_string() else {
                return;
            };
            if !str.is_utf8() || str.next.is_some() || str.toml_datetime.is_some() {
                return;
            }
            total_len += str.slice8().len();
            all_single_byte &= str.slice8().len() == 1;
        }

        let delimiter: &[u8] = if all_single_byte {
            b""
        } else {
            let Some(d) = DELIMITERS.iter().find(|&&d| {
                items.iter().all(|item| {
                    !bun_core::strings::contains_char(item.data.e_string().unwrap().slice8(), d)
                })
            }) else {
                return;
            };
            core::slice::from_ref(d)
        };

        let mut joined: ArenaVec<'a, u8> =
            ArenaVec::with_capacity_in(total_len + items.len() * delimiter.len(), self.arena);
        for (i, item) in items.iter().enumerate() {
            if i > 0 {
                joined.extend_from_slice(delimiter);
            }
            joined.extend_from_slice(item.data.e_string().unwrap().slice8());
        }
        let joined: &'a [u8] = joined.into_bump_slice();

        let loc = e.loc;
        let string = self.new_expr(E::EString::init(joined), loc);
        let split = self.new_expr(
            E::Dot {
                target: string,
                name: E::Str::new(b"split"),
                name_loc: loc,
                ..Default::default()
            },
            loc,
        );
        let delimiter_expr = self.new_expr(E::EString::init(delimiter), loc);
        *e = self.new_expr(
            E::Call {
                target: split,
                args: ExprNodeList::init_one(delimiter_expr),
                can_be_unwrapped_if_unused: E::CallUnwrap::IfUnused,
                ..Default::default()
            },
            loc,
        );
    }
}
