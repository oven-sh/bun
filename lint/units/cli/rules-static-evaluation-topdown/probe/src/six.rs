//! Research probe: the six rules on expression shape as they are to be written in src/lint, on the tree and the wrapper
//! records of `Parser::parse_for_lint`. Not the final text: it uses String, index syntax and println, which the workspace refuses.
use bun_ast::walk::{self, Visitor};
use bun_ast::{B, E, Expr, ExprData, G, Loc, OpCode, S, StmtData};
use bun_js_parser::parse::wrappers::WrapperData;

use crate::dupe::{self, Ctx};

/// The names of `ECMASCRIPT_GLOBALS` of ESLint's ast-utils (conf/globals.js, es2026), sorted by their bytes.
pub const ES_GLOBALS: [&[u8]; 73] = [
    b"AggregateError", b"Array", b"ArrayBuffer", b"AsyncDisposableStack", b"Atomics", b"BigInt", b"BigInt64Array",
    b"BigUint64Array", b"Boolean", b"DataView", b"Date", b"DisposableStack", b"Error", b"EvalError",
    b"FinalizationRegistry", b"Float16Array", b"Float32Array", b"Float64Array", b"Function", b"Infinity",
    b"Int16Array", b"Int32Array", b"Int8Array", b"Intl", b"Iterator", b"JSON", b"Map", b"Math", b"NaN", b"Number",
    b"Object", b"Promise", b"Proxy", b"RangeError", b"ReferenceError", b"Reflect", b"RegExp", b"Set",
    b"SharedArrayBuffer", b"String", b"SuppressedError", b"Symbol", b"SyntaxError", b"Temporal", b"TypeError",
    b"URIError", b"Uint16Array", b"Uint32Array", b"Uint8Array", b"Uint8ClampedArray", b"WeakMap", b"WeakRef",
    b"WeakSet", b"constructor", b"decodeURI", b"decodeURIComponent", b"encodeURI", b"encodeURIComponent", b"escape",
    b"eval", b"globalThis", b"hasOwnProperty", b"isFinite", b"isNaN", b"isPrototypeOf", b"parseFloat", b"parseInt",
    b"propertyIsEnumerable", b"toLocaleString", b"toString", b"undefined", b"unescape", b"valueOf",
];

fn is_assign(op: OpCode) -> bool {
    (op as u8) >= (OpCode::BinAssign as u8)
}

fn is_logical(op: OpCode) -> bool {
    matches!(op, OpCode::BinLogicalOr | OpCode::BinLogicalAnd | OpCode::BinNullishCoalescing)
}

fn is_comma(op: OpCode) -> bool {
    op == OpCode::BinComma
}

fn operator(op: OpCode) -> &'static [u8] {
    bun_ast::Op::TABLE.get_ptr_const(op).text
}

fn address(node: &E::Binary) -> usize {
    core::ptr::from_ref(node).addr()
}

impl Ctx<'_, '_> {
    fn report(&mut self, rule: &'static str, at: u32, text: &[u8]) {
        self.reports.push((rule, at, text.to_vec()));
    }

    /// `sourceCode.isGlobalReference`: `name` is one of the table and no declaration of the file.
    fn is_global(&self, name: &[u8]) -> bool {
        ES_GLOBALS.binary_search(&name).is_ok_and(|at| self.declared & (1u128 << at) == 0)
    }

    /// `isReferenceToGlobalVariable(scope, node)` of ast-utils with the scope of the node that a rule checks: not where that scope is not the one of the reference.
    fn is_global_variable(&self, name: &[u8]) -> bool {
        !self.detached && self.is_global(name)
    }

    /// `sourceCode.isGlobalReference` of the callee `place`: an identifier named one of `names`, and that name is the global.
    fn is_global_callee(&self, place: &Expr, names: &[&[u8]]) -> bool {
        let Some(Expr { data: ExprData::EIdentifier(identifier), .. }) = self.plain_callee(place) else {
            return false;
        };
        let name = self.parsed.name_of(identifier.ref_);
        names.contains(&name) && self.is_global(name)
    }

    /// What ESLint has at the place of `place` is an identifier named one of `names`, and `isReferenceToGlobalVariable` holds for it.
    fn is_global_identifier(&self, place: &Expr, names: &[&[u8]]) -> bool {
        let Some(Expr { data: ExprData::EIdentifier(identifier), .. }) = self.plain(place) else {
            return false;
        };
        let name = self.parsed.name_of(identifier.ref_);
        names.contains(&name) && self.is_global_variable(name)
    }

    /// A call that is no optional call, of a global of `names` for `isReferenceToGlobalVariable`.
    fn calls_global(&self, call: &E::Call, names: &[&[u8]]) -> bool {
        if call.optional_chain.is_some() {
            return false;
        }
        let Some(Expr { data: ExprData::EIdentifier(identifier), .. }) = self.plain_callee(&call.target) else {
            return false;
        };
        let name = self.parsed.name_of(identifier.ref_);
        names.contains(&name) && self.is_global_variable(name)
    }
}

// ---- no-cond-assign ----

/// `testForAssign`: `needed` pairs of parentheses of its own excuse an assignment that is a test.
fn cond_assign(ctx: &mut Ctx<'_, '_>, test: &Expr, needed: u32) {
    let Some(node) = ctx.plain(test) else { return };
    let ExprData::EBinary(binary) = &node.data else { return };
    if !is_assign(binary.op) || ctx.parens(test) >= needed {
        return;
    }
    let at = ctx.start_of_node(node);
    ctx.report("no-cond-assign", at, b"Expected a conditional expression and instead saw an assignment.");
}

// ---- ast-utils: getBooleanValue, isLogicalIdentity, isConstant ----

fn big_int_is_zero(text: &[u8]) -> bool {
    let digits = match text {
        [b'0', b'x' | b'X' | b'o' | b'O' | b'b' | b'B', rest @ ..] => rest,
        _ => text,
    };
    digits.iter().all(|&digit| digit == b'0')
}

/// `getBooleanValue` of what ESTree calls a `Literal`. `None`: `node` is none.
fn boolean_value(node: &Expr) -> Option<bool> {
    match &node.data {
        ExprData::ENull(_) => Some(false),
        ExprData::ERegExp(_) => Some(true),
        ExprData::EBoolean(boolean) => Some(boolean.value),
        ExprData::ENumber(number) => Some(number.value() != 0.0 && !number.value().is_nan()),
        ExprData::EString(string) if !string.prefer_template => Some(string.is_present()),
        ExprData::EBigInt(big) => Some(!big_int_is_zero(big.value.slice())),
        _ => None,
    }
}

/// A logical expression or a `BinaryExpression`: what `isConstant` reads the left operand of.
fn spine(node: &Expr) -> Option<&E::Binary> {
    match &node.data {
        ExprData::EBinary(binary) if !is_assign(binary.op) && !is_comma(binary.op) => Some(binary),
        _ => None,
    }
}

fn cooked_present(contents: &E::TemplateContents) -> bool {
    matches!(contents, E::TemplateContents::Cooked(cooked) if cooked.is_present())
}

/// `isConstant` of the binary expression at `place`, its operator when it is a logical one, and `isLogicalIdentity` of it for that operator.
/// The left operands of a chain are folded in a loop, the innermost first, and each link is remembered: a chain costs one pass.
fn fold(ctx: &mut Ctx<'_, '_>, place: &Expr, mut flag: bool) -> (bool, Option<OpCode>, bool) {
    let mut links: Vec<(&E::Binary, bool)> = Vec::new();
    let mut leaf = place;
    let mut known = None;
    while let Some(binary) = ctx.plain(leaf).and_then(spine) {
        if let Some(hit) = ctx.folded.get(&(address(binary), flag)) {
            known = Some((*hit, binary.op));
            break;
        }
        links.push((binary, flag));
        if !is_logical(binary.op) {
            flag = false;
        }
        leaf = &binary.left;
    }
    let mut below = match known {
        Some(((constant, identity), op)) => (constant, is_logical(op).then_some(op), identity),
        None => (is_constant_leaf(ctx, leaf, flag), None, false),
    };
    for (binary, flag) in links.into_iter().rev() {
        let (constant, identity);
        if is_logical(binary.op) {
            let left_identity = match below.1 {
                Some(op) => op == binary.op && below.2,
                None => is_logical_identity_leaf(ctx, &binary.left, binary.op),
            };
            let right_identity = is_logical_identity(ctx, &binary.right, binary.op);
            let right = is_constant(ctx, &binary.right, flag);
            constant = (below.0 && right) || (below.0 && left_identity) || (flag && right && right_identity);
            identity = left_identity || right_identity;
        } else {
            constant = below.0 && is_constant(ctx, &binary.right, false) && binary.op != OpCode::BinIn;
            identity = false;
        }
        ctx.folded.insert((address(binary), flag), (constant, identity));
        below = (constant, is_logical(binary.op).then_some(binary.op), identity);
    }
    below
}

/// `isLogicalIdentity` of what is no logical expression.
fn is_logical_identity_leaf(ctx: &mut Ctx<'_, '_>, place: &Expr, op: OpCode) -> bool {
    let Some(node) = ctx.plain(place) else { return false };
    if let Some(value) = boolean_value(node) {
        return (op == OpCode::BinLogicalOr && value) || (op == OpCode::BinLogicalAnd && !value);
    }
    match &node.data {
        ExprData::EUnary(unary) => op == OpCode::BinLogicalAnd && unary.op == OpCode::UnVoid,
        ExprData::EBinary(binary) => {
            let of = match binary.op {
                OpCode::BinLogicalOrAssign => OpCode::BinLogicalOr,
                OpCode::BinLogicalAndAssign => OpCode::BinLogicalAnd,
                _ => return false,
            };
            op == of && is_logical_identity(ctx, &binary.right, op)
        }
        _ => false,
    }
}

fn is_logical_identity(ctx: &mut Ctx<'_, '_>, place: &Expr, op: OpCode) -> bool {
    if !ctx.stack_check.is_safe_to_recurse() {
        return false;
    }
    match ctx.plain(place).and_then(spine) {
        Some(binary) if is_logical(binary.op) => op == binary.op && fold(ctx, place, false).2,
        _ => is_logical_identity_leaf(ctx, place, op),
    }
}

fn is_constant(ctx: &mut Ctx<'_, '_>, place: &Expr, in_boolean_position: bool) -> bool {
    if !ctx.stack_check.is_safe_to_recurse() {
        return false;
    }
    if ctx.plain(place).and_then(spine).is_some() {
        return fold(ctx, place, in_boolean_position).0;
    }
    is_constant_leaf(ctx, place, in_boolean_position)
}

/// `isConstant` of what is neither a logical expression nor a `BinaryExpression`.
fn is_constant_leaf(ctx: &mut Ctx<'_, '_>, place: &Expr, in_boolean_position: bool) -> bool {
    let Some(node) = ctx.plain(place) else { return false };
    match &node.data {
        // A hole of an array: ESLint's `!node`.
        ExprData::EMissing(_) => true,
        ExprData::EArrow(_) | ExprData::EFunction(_) | ExprData::EClass(_) | ExprData::EObject(_) => true,
        // A string, or a template without a substitution.
        ExprData::EString(_) => true,
        ExprData::ENumber(_) | ExprData::EBoolean(_) | ExprData::ENull(_) | ExprData::EBigInt(_) | ExprData::ERegExp(_) => true,
        ExprData::ETemplate(template) => {
            if template.tag.is_some() {
                return false;
            }
            let parts = template.parts();
            if in_boolean_position && (cooked_present(&template.head) || parts.iter().any(|part| cooked_present(&part.tail))) {
                return true;
            }
            parts.iter().all(|part| is_constant(ctx, &part.value, false))
        }
        ExprData::EArray(array) => in_boolean_position || array.items.iter().all(|item| is_constant(ctx, item, false)),
        ExprData::EUnary(unary) => match unary.op {
            OpCode::UnVoid => true,
            OpCode::UnTypeof if in_boolean_position => true,
            OpCode::UnNot => is_constant(ctx, &unary.value, true),
            OpCode::UnPos | OpCode::UnNeg | OpCode::UnCpl | OpCode::UnTypeof | OpCode::UnDelete => is_constant(ctx, &unary.value, false),
            // `++` and `--` are an `UpdateExpression`.
            _ => false,
        },
        // Only `,` and the assignments come here: `fold` has the others.
        ExprData::EBinary(binary) => match binary.op {
            OpCode::BinComma | OpCode::BinAssign => is_constant(ctx, &binary.right, in_boolean_position),
            OpCode::BinLogicalOrAssign if in_boolean_position => is_logical_identity(ctx, &binary.right, OpCode::BinLogicalOr),
            OpCode::BinLogicalAndAssign if in_boolean_position => is_logical_identity(ctx, &binary.right, OpCode::BinLogicalAnd),
            _ => false,
        },
        ExprData::ENew(_) => in_boolean_position,
        ExprData::ESpread(spread) => is_constant(ctx, &spread.value, in_boolean_position),
        ExprData::ECall(call) => ctx.calls_global(call, &[b"Boolean"]) && call.args.first().is_none_or(|first| is_constant(ctx, first, true)),
        ExprData::EIdentifier(_) => ctx.is_global_identifier(node, &[b"undefined"]),
        _ => false,
    }
}

// ---- no-constant-condition ----

const CONSTANT_CONDITION: &[u8] = b"Unexpected constant condition.";

/// `reportIfConstant`, for the test of an `if` and of a `?:`.
fn constant_condition(ctx: &mut Ctx<'_, '_>, test: &Expr) {
    if is_constant(ctx, test, true) {
        let at = ctx.start_of_place(test);
        ctx.report("no-constant-condition", at, CONSTANT_CONDITION);
    }
}

/// `trackConstantConditionLoop`: the test of a loop is constant, and is not the `true` of a `while (true)`.
fn loop_is_tracked(ctx: &mut Ctx<'_, '_>, test: &Expr, is_while: bool) -> bool {
    if is_while && matches!(ctx.plain(test).map(|node| &node.data), Some(ExprData::EBoolean(boolean)) if boolean.value) {
        return false;
    }
    is_constant(ctx, test, true)
}

// ---- no-constant-binary-expression ----

fn is_null_or_undefined(ctx: &mut Ctx<'_, '_>, place: &Expr) -> bool {
    let Some(node) = ctx.plain(place) else { return false };
    match &node.data {
        ExprData::ENull(_) => true,
        ExprData::EUnary(unary) => unary.op == OpCode::UnVoid,
        ExprData::EIdentifier(_) => ctx.is_global_identifier(node, &[b"undefined"]),
        _ => false,
    }
}

fn is_literal(node: &Expr) -> bool {
    matches!(node.data, ExprData::ENumber(_) | ExprData::EBoolean(_) | ExprData::ENull(_) | ExprData::EBigInt(_) | ExprData::ERegExp(_) | ExprData::EString(_))
}

fn is_logical_assign(op: OpCode) -> bool {
    matches!(op, OpCode::BinLogicalOrAssign | OpCode::BinLogicalAndAssign | OpCode::BinNullishCoalescingAssign)
}

fn has_constant_nullishness(ctx: &mut Ctx<'_, '_>, place: &Expr, non_nullish: bool) -> bool {
    if !ctx.stack_check.is_safe_to_recurse() || (non_nullish && is_null_or_undefined(ctx, place)) {
        return false;
    }
    let Some(node) = ctx.plain(place) else { return false };
    match &node.data {
        ExprData::EObject(_) | ExprData::EArray(_) | ExprData::EArrow(_) | ExprData::EFunction(_) | ExprData::EClass(_) | ExprData::ENew(_) => true,
        ExprData::ETemplate(template) => template.tag.is_none(),
        // Every `UnaryExpression` and every `UpdateExpression`.
        ExprData::EUnary(_) => true,
        ExprData::ECall(call) => ctx.calls_global(call, &[b"Boolean", b"String", b"Number", b"Symbol", b"BigInt"]),
        ExprData::EBinary(binary) => match binary.op {
            OpCode::BinComma | OpCode::BinAssign => has_constant_nullishness(ctx, &binary.right, non_nullish),
            OpCode::BinNullishCoalescing => has_constant_nullishness(ctx, &binary.right, true),
            OpCode::BinLogicalOr | OpCode::BinLogicalAnd => false,
            op if is_assign(op) => !is_logical_assign(op),
            _ => true,
        },
        ExprData::EIdentifier(_) => ctx.is_global_identifier(node, &[b"undefined"]),
        _ => is_literal(node),
    }
}

/// `Boolean()` or `Boolean(x)` with a constant `x`, of the global.
fn is_constant_boolean_call(ctx: &mut Ctx<'_, '_>, call: &E::Call) -> bool {
    ctx.calls_global(call, &[b"Boolean"]) && call.args.first().is_none_or(|first| is_constant(ctx, first, true))
}

fn is_static_boolean(ctx: &mut Ctx<'_, '_>, place: &Expr) -> bool {
    let Some(node) = ctx.plain(place) else { return false };
    match &node.data {
        ExprData::EBoolean(_) => true,
        ExprData::ECall(call) => is_constant_boolean_call(ctx, call),
        ExprData::EUnary(unary) => unary.op == OpCode::UnNot && is_constant(ctx, &unary.value, true),
        _ => false,
    }
}

fn has_constant_loose_boolean_comparison(ctx: &mut Ctx<'_, '_>, place: &Expr) -> bool {
    if !ctx.stack_check.is_safe_to_recurse() {
        return false;
    }
    let Some(node) = ctx.plain(place) else { return false };
    match &node.data {
        ExprData::EObject(_) | ExprData::EClass(_) | ExprData::EArrow(_) | ExprData::EFunction(_) => true,
        ExprData::EArray(array) => {
            let others = array.items.iter().filter(|item| !matches!(item.data, ExprData::EMissing(_) | ExprData::ESpread(_))).count();
            array.items.is_empty() || others > 1
        }
        ExprData::EUnary(unary) => match unary.op {
            OpCode::UnVoid | OpCode::UnTypeof => true,
            OpCode::UnNot => is_constant(ctx, &unary.value, true),
            _ => false,
        },
        ExprData::ECall(call) => is_constant_boolean_call(ctx, call),
        ExprData::EIdentifier(_) => ctx.is_global_identifier(node, &[b"undefined"]),
        ExprData::EBinary(binary) => matches!(binary.op, OpCode::BinComma | OpCode::BinAssign) && has_constant_loose_boolean_comparison(ctx, &binary.right),
        // A `Literal`, and a template without a substitution.
        _ => is_literal(node),
    }
}

fn has_constant_strict_boolean_comparison(ctx: &mut Ctx<'_, '_>, place: &Expr) -> bool {
    if !ctx.stack_check.is_safe_to_recurse() {
        return false;
    }
    let Some(node) = ctx.plain(place) else { return false };
    match &node.data {
        ExprData::EObject(_) | ExprData::EArray(_) | ExprData::EArrow(_) | ExprData::EFunction(_) | ExprData::EClass(_) | ExprData::ENew(_) => true,
        ExprData::ETemplate(template) => template.tag.is_none(),
        ExprData::EUnary(unary) => match unary.op {
            OpCode::UnDelete => false,
            OpCode::UnNot => is_constant(ctx, &unary.value, true),
            _ => true,
        },
        ExprData::EBinary(binary) => match binary.op {
            OpCode::BinComma | OpCode::BinAssign => has_constant_strict_boolean_comparison(ctx, &binary.right),
            op if is_assign(op) => !is_logical_assign(op),
            OpCode::BinAdd
            | OpCode::BinSub
            | OpCode::BinMul
            | OpCode::BinDiv
            | OpCode::BinRem
            | OpCode::BinBitwiseOr
            | OpCode::BinBitwiseXor
            | OpCode::BinBitwiseAnd
            | OpCode::BinPow
            | OpCode::BinShl
            | OpCode::BinShr
            | OpCode::BinUShr => true,
            _ => false,
        },
        ExprData::EIdentifier(_) => ctx.is_global_identifier(node, &[b"undefined"]),
        ExprData::ECall(call) => ctx.calls_global(call, &[b"String", b"Number", b"BigInt", b"Symbol"]) || is_constant_boolean_call(ctx, call),
        _ => is_literal(node),
    }
}

fn is_always_new(ctx: &mut Ctx<'_, '_>, place: &Expr) -> bool {
    if !ctx.stack_check.is_safe_to_recurse() {
        return false;
    }
    let Some(node) = ctx.plain(place) else { return false };
    match &node.data {
        ExprData::EObject(_) | ExprData::EArray(_) | ExprData::EArrow(_) | ExprData::EFunction(_) | ExprData::EClass(_) => true,
        // `is_global` is true of a name of `ES_GLOBALS` only.
        ExprData::ENew(new) => match ctx.plain_callee(&new.target) {
            Some(Expr { data: ExprData::EIdentifier(identifier), .. }) => ctx.is_global_variable(ctx.parsed.name_of(identifier.ref_)),
            _ => false,
        },
        ExprData::ERegExp(_) => true,
        ExprData::EBinary(binary) => matches!(binary.op, OpCode::BinComma | OpCode::BinAssign) && is_always_new(ctx, &binary.right),
        ExprData::EIf(conditional) => is_always_new(ctx, &conditional.yes) && is_always_new(ctx, &conditional.no),
        _ => false,
    }
}

/// `findBinaryExpressionConstantOperand`: whether `b` makes the comparison with `a` constant.
fn is_constant_operand(ctx: &mut Ctx<'_, '_>, a: &Expr, b: &Expr, strict: bool) -> bool {
    if is_null_or_undefined(ctx, a) && has_constant_nullishness(ctx, b, false) {
        return true;
    }
    is_static_boolean(ctx, a) && if strict { has_constant_strict_boolean_comparison(ctx, b) } else { has_constant_loose_boolean_comparison(ctx, b) }
}

fn constant_binary(ctx: &mut Ctx<'_, '_>, node: &E::Binary) {
    const RULE: &str = "no-constant-binary-expression";
    let text = |parts: &[&[u8]]| parts.concat();
    match node.op {
        OpCode::BinLogicalAnd | OpCode::BinLogicalOr => {
            if is_constant(ctx, &node.left, true) {
                let at = ctx.start_of_place(&node.left);
                ctx.report(RULE, at, &text(&[b"Unexpected constant truthiness on the left-hand side of a `", operator(node.op), b"` expression."]));
            }
        }
        OpCode::BinNullishCoalescing => {
            if has_constant_nullishness(ctx, &node.left, false) {
                let at = ctx.start_of_place(&node.left);
                ctx.report(RULE, at, b"Unexpected constant nullishness on the left-hand side of a `??` expression.");
            }
        }
        OpCode::BinLooseEq | OpCode::BinLooseNe | OpCode::BinStrictEq | OpCode::BinStrictNe => {
            let strict = matches!(node.op, OpCode::BinStrictEq | OpCode::BinStrictNe);
            if is_constant_operand(ctx, &node.left, &node.right, strict) {
                let at = ctx.start_of_place(&node.right);
                ctx.report(RULE, at, &text(&[b"Unexpected constant binary expression. Compares constantly with the left-hand side of the `", operator(node.op), b"`."]));
            } else if is_constant_operand(ctx, &node.right, &node.left, strict) {
                let at = ctx.start_of_place(&node.left);
                ctx.report(RULE, at, &text(&[b"Unexpected constant binary expression. Compares constantly with the right-hand side of the `", operator(node.op), b"`."]));
            } else if strict {
                const ALWAYS_NEW: &[u8] = b"Unexpected comparison to newly constructed object. These two values can never be equal.";
                if is_always_new(ctx, &node.left) {
                    let at = ctx.start_of_place(&node.left);
                    ctx.report(RULE, at, ALWAYS_NEW);
                } else if is_always_new(ctx, &node.right) {
                    let at = ctx.start_of_place(&node.right);
                    ctx.report(RULE, at, ALWAYS_NEW);
                }
            } else if is_always_new(ctx, &node.left) && is_always_new(ctx, &node.right) {
                let at = ctx.start_of_place(&node.left);
                ctx.report(RULE, at, b"Unexpected comparison of two newly constructed objects. These two values can never be equal.");
            }
        }
        _ => {}
    }
}

// ---- no-extra-boolean-cast ----

/// `place` is where a value becomes a boolean: the test of `if`, `while`, `do`, `for` and `?:`, the operand of `!`, the first argument of `Boolean`.
fn boolean_context(ctx: &mut Ctx<'_, '_>, place: &Expr) {
    let Some(node) = ctx.plain(place) else { return };
    match &node.data {
        ExprData::EUnary(unary) if unary.op == OpCode::UnNot => {
            if matches!(ctx.plain(&unary.value).map(|inner| &inner.data), Some(ExprData::EUnary(inner)) if inner.op == OpCode::UnNot) {
                ctx.report("no-extra-boolean-cast", node.loc.start as u32, b"Redundant double negation.");
            }
        }
        // An optional call too: ESLint looks through the `ChainExpression` around it.
        ExprData::ECall(call) if ctx.is_global_callee(&call.target, &[b"Boolean"]) => {
            let at = ctx.start_of_node(node);
            ctx.report("no-extra-boolean-cast", at, b"Redundant Boolean call.");
        }
        _ => {}
    }
}

/// The first argument of a call of the global `Boolean`, with `new` or without, is a boolean context.
fn boolean_call(ctx: &mut Ctx<'_, '_>, target: &Expr, args: &[Expr]) {
    if let Some(first) = args.first() {
        if ctx.is_global_callee(target, &[b"Boolean"]) {
            boolean_context(ctx, first);
        }
    }
}

// ---- no-unsafe-optional-chaining ----

/// What ESLint has at the place of `place` is a `ChainExpression`: a chain ends there, with `!` right after it at most, then parentheses.
fn is_chain_expression(ctx: &Ctx<'_, '_>, place: &Expr) -> bool {
    let chain = match &place.data {
        ExprData::EDot(node) => node.optional_chain,
        ExprData::EIndex(node) => node.optional_chain,
        ExprData::ECall(node) => node.optional_chain,
        _ => None,
    };
    if chain.is_none() {
        return false;
    }
    let mut parenthesized = false;
    for wrapper in ctx.wrappers(place) {
        match wrapper.data {
            WrapperData::Parenthesized => parenthesized = true,
            WrapperData::NonNull if !parenthesized => {}
            _ => return false,
        }
    }
    true
}

/// `checkUndefinedShortCircuit`: every chain that can be the value of `place` is reported.
fn unsafe_chain(ctx: &mut Ctx<'_, '_>, place: &Expr) {
    if !ctx.stack_check.is_safe_to_recurse() {
        return;
    }
    let mut place = place;
    loop {
        if is_chain_expression(ctx, place) {
            let at = ctx.start_of_node(place);
            ctx.report("no-unsafe-optional-chaining", at, b"Unsafe usage of optional chaining. If it short-circuits with 'undefined' the evaluation will throw TypeError.");
            return;
        }
        let Some(node) = ctx.plain(place) else { return };
        place = match &node.data {
            ExprData::EBinary(binary) => match binary.op {
                OpCode::BinLogicalOr | OpCode::BinNullishCoalescing | OpCode::BinComma => &binary.right,
                OpCode::BinLogicalAnd => {
                    unsafe_chain(ctx, &binary.right);
                    &binary.left
                }
                _ => return,
            },
            ExprData::EIf(conditional) => {
                unsafe_chain(ctx, &conditional.yes);
                &conditional.no
            }
            ExprData::EAwait(awaited) => &awaited.value,
            _ => return,
        };
    }
}

fn is_pattern_literal(ctx: &Ctx<'_, '_>, place: &Expr) -> bool {
    matches!(ctx.plain(place).map(|node| &node.data), Some(ExprData::EArray(_) | ExprData::EObject(_)))
}

fn is_pattern_binding(binding: &bun_ast::Binding) -> bool {
    matches!(binding.data, B::B::BArray(_) | B::B::BObject(_))
}

fn unsafe_spreads(ctx: &mut Ctx<'_, '_>, items: &[Expr]) {
    for item in items {
        if let ExprData::ESpread(spread) = &item.data {
            unsafe_chain(ctx, &spread.value);
        }
    }
}

fn unsafe_args(ctx: &mut Ctx<'_, '_>, args: &[G::Arg]) {
    for arg in args {
        if let Some(default) = &arg.default {
            if is_pattern_binding(&arg.binding) {
                unsafe_chain(ctx, default);
            }
        }
    }
}

// ---- the one walk ----

struct Walk<'c, 'p, 'a> {
    ctx: &'c mut Ctx<'p, 'a>,
    /// The `if` that is the `else` of the `if` being walked: not the first of its chain.
    else_if: Option<usize>,
    /// The loops with a constant test that are open in the function being walked and that no `yield` was met in.
    loops: u32,
    /// How many decorators that the walk reaches next stand outside the scope that ESLint gives them: those of the class being entered, those of the parameters of the method being entered.
    outside: usize,
}

impl Walk<'_, '_, '_> {
    fn class(&mut self, class: &G::Class) {
        if let Some(extends) = &class.extends {
            unsafe_chain(self.ctx, extends);
        }
    }

    /// What `inside` walks is in a scope of its own; `outside` decorators come first and are not.
    fn scope(&mut self, outside: usize, inside: impl FnOnce(&mut Self)) {
        let detached = core::mem::replace(&mut self.ctx.detached, false);
        let outer = core::mem::replace(&mut self.outside, outside);
        inside(self);
        self.outside = outer;
        self.ctx.detached = detached;
    }

    /// `expr` is walked where the scope of `getScope` is not the scope of its references.
    fn detached(&mut self, expr: &Expr) {
        let detached = core::mem::replace(&mut self.ctx.detached, true);
        self.visit_expr(expr);
        self.ctx.detached = detached;
    }

    /// What a loop with the test `test` walks is walked by `inside`; the test is reported after it when it is constant and no `yield` was met.
    fn enter_loop(&mut self, test: Option<&Expr>, is_while: bool) -> Option<u32> {
        let tracked = test.is_some_and(|test| loop_is_tracked(self.ctx, test, is_while));
        tracked.then(|| {
            self.loops += 1;
            self.loops - 1
        })
    }

    fn exit_loop(&mut self, entered: Option<u32>, test: Option<&Expr>) {
        if let (Some(index), Some(test)) = (entered, test) {
            if self.loops > index {
                self.loops = index;
                let at = self.ctx.start_of_place(test);
                self.ctx.report("no-constant-condition", at, CONSTANT_CONDITION);
            }
        }
    }
}

impl<'ast> Visitor<'ast> for Walk<'_, '_, '_> {
    fn visit_s_if(&mut self, node: &'ast S::If, _: Loc) {
        cond_assign(self.ctx, &node.test, 1);
        constant_condition(self.ctx, &node.test);
        boolean_context(self.ctx, &node.test);
        if self.else_if.take() != Some(core::ptr::from_ref(node).addr()) {
            dupe::s_if(self.ctx, node);
        }
        self.visit_expr(&node.test);
        self.visit_stmt(&node.yes);
        if let Some(no) = &node.no {
            if let StmtData::SIf(next) = &no.data {
                self.else_if = Some(core::ptr::from_ref::<S::If>(next).addr());
            }
            self.visit_stmt(no);
        }
    }

    fn visit_s_while(&mut self, node: &'ast S::While, _: Loc) {
        cond_assign(self.ctx, &node.test, 1);
        boolean_context(self.ctx, &node.test);
        let entered = self.enter_loop(Some(&node.test), true);
        walk::walk_s_while(self, node);
        self.exit_loop(entered, Some(&node.test));
    }

    fn visit_s_do_while(&mut self, node: &'ast S::DoWhile, _: Loc) {
        cond_assign(self.ctx, &node.test, 1);
        boolean_context(self.ctx, &node.test);
        let entered = self.enter_loop(Some(&node.test), false);
        walk::walk_s_do_while(self, node);
        self.exit_loop(entered, Some(&node.test));
    }

    fn visit_s_for(&mut self, node: &'ast S::For, _: Loc) {
        if let Some(test) = &node.test {
            cond_assign(self.ctx, test, 1);
            boolean_context(self.ctx, test);
        }
        // A `yield` in the initializer is not one of the loop: ESLint tracks the loop again when it reaches the test.
        if let Some(init) = &node.init {
            self.visit_stmt(init);
        }
        let entered = self.enter_loop(node.test.as_ref(), false);
        if let Some(test) = &node.test {
            self.visit_expr(test);
        }
        if let Some(update) = &node.update {
            self.visit_expr(update);
        }
        self.visit_stmt(&node.body);
        self.exit_loop(entered, node.test.as_ref());
    }

    fn visit_s_for_of(&mut self, node: &'ast S::ForOf, _: Loc) {
        unsafe_chain(self.ctx, &node.value);
        walk::walk_s_for_of(self, node);
    }

    fn visit_s_with(&mut self, node: &'ast S::With, _: Loc) {
        unsafe_chain(self.ctx, &node.value);
        self.detached(&node.value);
        self.visit_stmt(&node.body);
    }

    fn visit_s_switch(&mut self, node: &'ast S::Switch, _: Loc) {
        self.detached(&node.test);
        for case in node.cases.slice() {
            if let Some(value) = &case.value {
                self.visit_expr(value);
            }
            for stmt in case.body.slice() {
                self.visit_stmt(stmt);
            }
        }
    }

    fn visit_decorator(&mut self, decorator: &'ast Expr) {
        if self.outside == 0 {
            return self.visit_expr(decorator);
        }
        let left = self.outside - 1;
        self.outside = 0;
        self.detached(decorator);
        self.outside = left;
    }

    fn visit_s_local(&mut self, node: &'ast S::Local, _: Loc) {
        for decl in node.decls.iter() {
            if let Some(value) = &decl.value {
                if is_pattern_binding(&decl.binding) {
                    unsafe_chain(self.ctx, value);
                }
            }
        }
        walk::walk_s_local(self, node);
    }

    fn visit_s_function(&mut self, node: &'ast S::Function, _: Loc) {
        unsafe_args(self.ctx, node.func.args.slice());
        let loops = core::mem::replace(&mut self.loops, 0);
        let outside = node.func.args.slice().iter().map(|arg| arg.ts_decorators.len() as usize).sum();
        self.scope(outside, |walk| walk::walk_s_function(walk, node));
        self.loops = loops;
    }

    fn visit_e_function(&mut self, node: &'ast E::Function, _: Loc) {
        unsafe_args(self.ctx, node.func.args.slice());
        let loops = core::mem::replace(&mut self.loops, 0);
        let outside = node.func.args.slice().iter().map(|arg| arg.ts_decorators.len() as usize).sum();
        self.scope(outside, |walk| walk::walk_e_function(walk, node));
        self.loops = loops;
    }

    fn visit_e_arrow(&mut self, node: &'ast E::Arrow, _: Loc) {
        unsafe_args(self.ctx, node.args.slice());
        self.scope(0, |walk| walk::walk_e_arrow(walk, node));
    }

    fn visit_s_class(&mut self, node: &'ast S::Class, _: Loc) {
        self.class(&node.class);
        self.scope(node.class.ts_decorators.len() as usize, |walk| walk::walk_s_class(walk, node));
    }

    fn visit_e_class(&mut self, node: &'ast E::Class, _: Loc) {
        self.class(node);
        self.scope(node.ts_decorators.len() as usize, |walk| walk::walk_e_class(walk, node));
    }

    fn visit_b_array(&mut self, node: &'ast B::Array, _: Loc) {
        for item in node.items.slice() {
            if let Some(default) = &item.default_value {
                if is_pattern_binding(&item.binding) {
                    unsafe_chain(self.ctx, default);
                }
            }
        }
        walk::walk_b_array(self, node);
    }

    fn visit_b_object(&mut self, node: &'ast B::Object, _: Loc) {
        for property in node.properties.slice() {
            if let Some(default) = &property.default_value {
                if is_pattern_binding(&property.value) {
                    unsafe_chain(self.ctx, default);
                }
            }
        }
        walk::walk_b_object(self, node);
    }

    fn visit_e_yield(&mut self, node: &'ast E::Yield, _: Loc) {
        self.loops = 0;
        walk::walk_e_yield(self, node);
    }

    fn visit_e_if(&mut self, node: &'ast E::If, _: Loc) {
        cond_assign(self.ctx, &node.test, 2);
        constant_condition(self.ctx, &node.test);
        boolean_context(self.ctx, &node.test);
        walk::walk_e_if(self, node);
    }

    fn visit_e_unary(&mut self, node: &'ast E::Unary, _: Loc) {
        if node.op == OpCode::UnNot {
            boolean_context(self.ctx, &node.value);
        }
        walk::walk_e_unary(self, node);
    }

    fn visit_e_call(&mut self, node: &'ast E::Call, _: Loc) {
        boolean_call(self.ctx, &node.target, node.args.as_slice());
        if node.optional_chain.is_none() {
            unsafe_chain(self.ctx, &node.target);
        }
        unsafe_spreads(self.ctx, node.args.as_slice());
        walk::walk_e_call(self, node);
    }

    fn visit_e_new(&mut self, node: &'ast E::New, _: Loc) {
        boolean_call(self.ctx, &node.target, node.args.as_slice());
        unsafe_chain(self.ctx, &node.target);
        unsafe_spreads(self.ctx, node.args.as_slice());
        walk::walk_e_new(self, node);
    }

    fn visit_e_dot(&mut self, node: &'ast E::Dot, _: Loc) {
        if node.optional_chain.is_none() {
            unsafe_chain(self.ctx, &node.target);
        }
        walk::walk_e_dot(self, node);
    }

    fn visit_e_index(&mut self, node: &'ast E::Index, _: Loc) {
        if node.optional_chain.is_none() {
            unsafe_chain(self.ctx, &node.target);
        }
        walk::walk_e_index(self, node);
    }

    fn visit_e_template(&mut self, node: &'ast E::Template, _: Loc) {
        if let Some(tag) = &node.tag {
            unsafe_chain(self.ctx, tag);
        }
        walk::walk_e_template(self, node);
    }

    // The linter of the tree knows an array that is a pattern, whose `...` is a rest element: here every array is a literal.
    fn visit_e_array(&mut self, node: &'ast E::Array, _: Loc) {
        unsafe_spreads(self.ctx, node.items.as_slice());
        walk::walk_e_array(self, node);
    }

    fn visit_e_binary(&mut self, node: &'ast E::Binary, _: Loc) -> Option<&'ast Expr> {
        constant_binary(self.ctx, node);
        if matches!(node.op, OpCode::BinIn | OpCode::BinInstanceof) || (node.op == OpCode::BinAssign && is_pattern_literal(self.ctx, &node.left)) {
            unsafe_chain(self.ctx, &node.right);
        }
        walk::walk_e_binary(self, node)
    }
}

pub fn run(path: &str) {
    debug_assert!(ES_GLOBALS.is_sorted());
    let Ok(text) = std::fs::read(path) else { return };
    let arena = bun_alloc::Arena::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
    let _ast_scope = ast_memory_allocator.enter();
    let text: &'static [u8] = text.leak();
    let source = bun_ast::Source::init_path_string(path.as_bytes().to_vec().leak() as &'static [u8], text);
    let loader = if path.ends_with(".tsx") {
        bun_ast::Loader::Tsx
    } else if path.ends_with("ts") {
        bun_ast::Loader::Ts
    } else {
        bun_ast::Loader::Jsx
    };
    let mut options = bun_js_parser::ParserOptions::init(Default::default(), loader);
    options.features.no_macros = true;
    options.features.is_macro_runtime = true;
    options.features.top_level_await = true;
    options.features.standard_decorators = true;
    let define = bun_js_parser::Define::default();
    let mut log = bun_ast::Log::init();
    let Ok(parser) = bun_js_parser::Parser::init(options, &mut log, &source, &define, &arena) else {
        println!("{path}: PARSE_ERROR");
        return;
    };
    let started = std::time::Instant::now();
    let reports = parser.parse_for_lint(|parsed| {
        let mut ctx = Ctx::new(parsed, &source, &arena);
        let mut walk = Walk { ctx: &mut ctx, else_if: None, loops: 0, outside: 0 };
        for stmt in parsed.stmts {
            walk.visit_stmt(stmt);
        }
        for record in &parsed.sidecar.erased.statements {
            match &record.data {
                bun_js_parser::parse::erased::ErasedData::Declaration(stmt) => walk.visit_stmt(stmt),
                bun_js_parser::parse::erased::ErasedData::Module(module) => {
                    if let Some(body) = &module.body {
                        for stmt in body.slice() {
                            walk.visit_stmt(stmt);
                        }
                    }
                }
                _ => {}
            }
        }
        for member in &parsed.sidecar.erased.members {
            if let bun_js_parser::parse::erased::ErasedMemberData::Property(property) = &member.data {
                for decorator in property.ts_decorators.iter() {
                    walk.visit_decorator(decorator);
                }
                for expr in [&property.key, &property.value, &property.initializer].into_iter().flatten() {
                    walk.visit_expr(expr);
                }
            }
        }
        ctx.reports
    });
    match reports {
        Err(_) => println!("{path}: PARSE_ERROR"),
        Ok(mut reports) => {
            println!("{path}: OK {:?}", started.elapsed());
            reports.sort();
            reports.dedup();
            for (rule, at, message) in reports {
                let before = &text[..at as usize];
                let line = before.iter().filter(|&&b| b == b'\n').count() + 1;
                let column = before.len() - before.iter().rposition(|&b| b == b'\n').map_or(0, |i| i + 1) + 1;
                println!("{path}({line},{column}): {rule}: {}", String::from_utf8_lossy(&message));
            }
        }
    }
}
