//! `get-static-value.mjs`

use super::builtins::{Member, get_member, global_value, set_property};
use super::calls::{assign, call, construct, iterate, sorted_flags, string_raw};
use super::find_variable::find_variable_of;
use super::js_string;
use super::operators::{binary, unary};
use super::static_value::{Eval, MAX_LEN, PropertyKey, StaticValue, Stop, parse_bigint_digits};
use crate::ast::{
    BinOp, Call, Chain, Expr, ExprKind, Key, KeyKind, List, Node, PropKind, Stmt, StmtKind,
    Template, UnOp, VarKind,
};
use crate::semantic::{Declaration, Scope, Symbol};
use crate::utils::estree_compat::is_assignment_target;
use bun_core::strings;
use smallvec::SmallVec;
use std::borrow::Cow;

/// eslint-utils' `getStaticValue`: the value of `expr`, if it is known without running the
/// program. `None` is upstream's `null`, `Some(StaticValue::Null)` its `{ value: null }`.
///
/// With a `scope`, identifiers are resolved: the global variables of the standard library that
/// the file does not shadow (`undefined`, `Number`, `Symbol.iterator`, ..), and variables that
/// are declared once with an initializer and never written again. Which scope it is makes no
/// difference, an identifier is looked up from where it is written. Without one, an identifier has no static
/// value.
///
/// Only the functions that upstream calls are called: `"a".repeat(2)` has no static value. What
/// upstream computes and this cannot (a `bigint` beyond 128 bits, `new Date(0)`,
/// `"é".normalize()`, a string of more than a megabyte, ..) has none either.
///
/// Upstream's `optional`, which tells that the value is the `undefined` of a `?.` that cut the
/// evaluation short, is only used inside: no rule reads it.
pub fn get_static_value<'a>(expr: Expr<'a>, scope: Option<Scope<'a>>) -> Option<StaticValue<'a>> {
    match expr.kind() {
        // ESTree has a pattern there, which has no value.
        ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Assign { .. }
            if is_assignment_target(expr) =>
        {
            return None;
        }
        // `JSXText`, and the name of an element.
        ExprKind::String(_) | ExprKind::Ident(_) | ExprKind::Dot { .. }
            if matches!(
                expr.parent().as_expr().map(Expr::kind),
                Some(ExprKind::Jsx(_))
            ) && expr.jsx_container_span().is_none() =>
        {
            return None;
        }
        _ => {}
    }
    let mut evaluator = Evaluator {
        resolves: scope.is_some(),
        depth: 0,
        budget: 20_000,
        symbols: SmallVec::new(),
    };
    evaluator.eval(expr).ok()
}

struct Evaluator<'a> {
    /// Whether identifiers are resolved.
    resolves: bool,
    /// How deep the recursion is.
    depth: u32,
    /// How many more expressions are evaluated. A variable is evaluated anew each time it is
    /// read, which takes exponential time for `const b = [a, a], c = [b, b], ..`.
    budget: u32,
    /// The variables that are being evaluated.
    symbols: SmallVec<[Symbol<'a>; 4]>,
}

/// A value, and upstream's `optional`.
type Link<'a> = (StaticValue<'a>, bool);

const SHORT_CIRCUITED: Link<'static> = (StaticValue::Undefined, true);

impl<'a> Evaluator<'a> {
    fn eval(&mut self, e: Expr<'a>) -> Eval<StaticValue<'a>> {
        Ok(self.eval_link(e)?.0)
    }

    /// The object of a member access or the callee of a call. ESTree has a `ChainExpression`
    /// around an optional chain in parentheses, where `optional` ends.
    fn eval_object(&mut self, e: Expr<'a>) -> Eval<Link<'a>> {
        let (value, is_optional) = self.eval_link(e)?;
        Ok((value, is_optional && !e.is_parenthesized()))
    }

    fn eval_link(&mut self, e: Expr<'a>) -> Eval<Link<'a>> {
        if self.depth >= 500 || self.budget == 0 {
            return Err(Stop::Abort);
        }
        self.depth += 1;
        self.budget -= 1;
        let result = match e.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => self.member(e, obj),
            ExprKind::Call(call) => self.call(e, call),
            ExprKind::NonNull(inner) => self.eval_object(inner),
            _ => self.eval_other(e).map(|value| (value, false)),
        };
        self.depth -= 1;
        result
    }

    fn eval_other(&mut self, e: Expr<'a>) -> Eval<StaticValue<'a>> {
        match e.kind() {
            ExprKind::Null => Ok(StaticValue::Null),
            ExprKind::True => Ok(StaticValue::Bool(true)),
            ExprKind::False => Ok(StaticValue::Bool(false)),
            ExprKind::Number(n) => Ok(StaticValue::Number(n)),
            ExprKind::String(text) => Ok(StaticValue::string(text.bytes())),
            ExprKind::BigInt(_) => {
                let digits: Vec<u8> = e
                    .text()
                    .iter()
                    .copied()
                    .filter(|&c| c != b'_' && c != b'n')
                    .collect();
                Ok(StaticValue::BigInt(
                    parse_bigint_digits(&digits)?.ok_or(Stop::Abort)?,
                ))
            }
            // The parser has validated it.
            ExprKind::Regex(regex) => Ok(StaticValue::Regex {
                pattern: Cow::Borrowed(regex.pattern()),
                flags: sorted_flags(regex.flags()).ok_or(Stop::NotStatic)?,
            }),
            ExprKind::Ident(_) => self.identifier(e),
            ExprKind::Template(template) => self.template(template),
            ExprKind::TaggedTemplate(call) => self.tagged_template(call),
            ExprKind::Array(elements) => Ok(StaticValue::Array(self.elements(elements)?)),
            ExprKind::Object(_) => self.object(e),
            ExprKind::New(call) => {
                let callee = self.eval(call.callee())?;
                let args = self.elements(call.args())?;
                match callee {
                    StaticValue::Builtin(function) if function.member() == Member::Call => {
                        construct(function, &args)
                    }
                    _ => Err(Stop::NotStatic),
                }
            }
            ExprKind::Unary { op: UnOp::Void, .. } => Ok(StaticValue::Undefined),
            ExprKind::Unary {
                op: op @ (UnOp::Minus | UnOp::Plus | UnOp::Not | UnOp::BitNot | UnOp::Typeof),
                operand,
            } => unary(op, &self.eval(operand)?),
            ExprKind::Binary {
                op: BinOp::In | BinOp::Instanceof,
                ..
            } => Err(Stop::NotStatic),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.eval(right),
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                left,
                right,
            } => {
                let left = self.eval(left)?;
                let is_decided = match op {
                    BinOp::Or => left.is_truthy(),
                    BinOp::And => !left.is_truthy(),
                    _ => !left.is_nullish(),
                };
                if is_decided {
                    Ok(left)
                } else {
                    self.eval(right)
                }
            }
            ExprKind::Binary { op, left, right } => {
                binary(op, &self.eval(left)?, &self.eval(right)?)
            }
            ExprKind::Assign {
                op: None, value, ..
            } => self.eval(value),
            ExprKind::Cond { test, yes, no } => match self.eval(test)?.is_truthy() {
                true => self.eval(yes),
                false => self.eval(no),
            },
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::Instantiation { expr, .. } => self.eval(expr),
            _ => Err(Stop::NotStatic),
        }
    }

    /// Upstream's `getElementValues`: the elements of an array literal, or the arguments of a
    /// call.
    fn elements(&mut self, list: List<'a, Expr<'a>>) -> Eval<Vec<StaticValue<'a>>> {
        let mut values = Vec::with_capacity(list.len());
        for element in list {
            match element.kind() {
                ExprKind::Missing => values.push(StaticValue::Hole),
                ExprKind::Spread(spread) => values.extend(iterate(&self.eval(spread)?)?),
                _ => values.push(self.eval(element)?),
            }
            if values.len() > MAX_LEN {
                return Err(Stop::Abort);
            }
        }
        Ok(values)
    }

    fn identifier(&mut self, e: Expr<'a>) -> Eval<StaticValue<'a>> {
        if !self.resolves {
            return Err(Stop::NotStatic);
        }
        let Some(symbol) = find_variable_of(e) else {
            let name = e.as_ident().map_or(&b""[..], |name| name.bytes());
            return match global_value(name) {
                Some(value) if e.file().global(name).is_some() => Ok(value),
                _ => Err(Stop::NotStatic),
            };
        };
        let mut declarations = symbol.declarations();
        let (Some(Declaration::Var(pat)), None) = (declarations.next(), declarations.next()) else {
            return Err(Stop::NotStatic);
        };
        let Node::VarDecl(declaration) = pat.parent() else {
            return Err(Stop::NotStatic);
        };
        if !matches!(
            declaration.parent().as_stmt().map(Stmt::kind),
            Some(StmtKind::Var(_))
        ) || (declaration.var_kind() != VarKind::Const && !is_effectively_const(symbol))
        {
            return Err(Stop::NotStatic);
        }
        let init = declaration.init().ok_or(Stop::NotStatic)?;
        // Upstream recurses until the stack overflows, and catches that.
        if self.symbols.contains(&symbol) {
            return Err(Stop::Abort);
        }
        self.symbols.push(symbol);
        let result = self.eval(init).and_then(|value| {
            match value.type_of() == "object"
                && value != StaticValue::Null
                && self.has_mutation_in_property(symbol)?
            {
                true => Err(Stop::NotStatic),
                false => Ok(value),
            }
        });
        self.symbols.pop();
        result
    }

    /// Upstream's `hasMutationInProperty`: whether a property of the variable is assigned to, or a
    /// method that changes an array is called on it.
    fn has_mutation_in_property(&mut self, symbol: Symbol<'a>) -> Eval<bool> {
        for reference in symbol.references() {
            let Some(mut node) = reference.expr() else {
                continue;
            };
            while let Some(parent) = node.parent().as_expr()
                && matches!(parent.kind(), ExprKind::Dot { .. } | ExprKind::Index { .. })
            {
                node = parent;
            }
            let Some(parent) = node.parent().as_expr() else {
                continue;
            };
            match parent.kind() {
                ExprKind::Assign { target, .. }
                    if target == node && !is_assignment_target(parent) =>
                {
                    return Ok(true);
                }
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    ..
                } => return Ok(true),
                ExprKind::Call(call) if call.callee() == node => {
                    let name = match self.member_name(node) {
                        Ok(name) => name,
                        Err(Stop::NotStatic) => continue,
                        Err(Stop::Abort) => return Err(Stop::Abort),
                    };
                    if matches!(
                        name.as_str(),
                        Some(
                            b"copyWithin"
                                | b"fill"
                                | b"pop"
                                | b"push"
                                | b"reverse"
                                | b"shift"
                                | b"sort"
                                | b"splice"
                                | b"unshift"
                        )
                    ) {
                        return Ok(true);
                    }
                }
                _ => {}
            }
        }
        Ok(false)
    }

    /// Upstream's `getStaticPropertyNameValue` for a member access.
    fn member_name(&mut self, member: Expr<'a>) -> Eval<StaticValue<'a>> {
        match member.kind() {
            ExprKind::Dot { name, .. } if !name.bytes().starts_with(b"#") => {
                Ok(StaticValue::string(name.bytes()))
            }
            ExprKind::Index { index, .. } => self.eval(index),
            _ => Err(Stop::NotStatic),
        }
    }

    /// Upstream's `getStaticPropertyNameValue` for a property of an object literal.
    fn key_name(&mut self, key: Key<'a>) -> Eval<PropertyKey<'a>> {
        match key.kind() {
            KeyKind::Computed(e) => self.eval(e)?.to_property_key(),
            KeyKind::Private(_) => Err(Stop::NotStatic),
            _ => Ok(PropertyKey::String(Cow::Borrowed(
                key.name().ok_or(Stop::NotStatic)?.bytes(),
            ))),
        }
    }

    fn member(&mut self, e: Expr<'a>, obj: Expr<'a>) -> Eval<Link<'a>> {
        if matches!(e.kind(), ExprKind::Dot { name, .. } if name.bytes().starts_with(b"#")) {
            return Err(Stop::NotStatic);
        }
        let (object, is_optional) = self.eval_object(obj)?;
        if object.is_nullish() && (is_optional || e.is_optional()) {
            return Ok(SHORT_CIRCUITED);
        }
        let key = self.member_name(e)?.to_property_key()?;
        Ok((get_member(&object, &key)?, false))
    }

    fn call(&mut self, e: Expr<'a>, call_: Call<'a>) -> Eval<Link<'a>> {
        let callee = call_.callee();
        let args = self.elements(call_.args())?;
        // ESTree has a `ChainExpression` around the callee of `(a?.b)()`, which is then not a member access.
        let is_chain = callee.is_parenthesized() && callee.chain() != Chain::No;
        let (function, this) = match callee.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if !is_chain => {
                if matches!(callee.kind(), ExprKind::Dot { name, .. } if name.bytes().starts_with(b"#"))
                {
                    return Err(Stop::NotStatic);
                }
                let (object, is_optional) = self.eval_object(obj)?;
                if object.is_nullish() && (is_optional || e.is_optional()) {
                    return Ok(SHORT_CIRCUITED);
                }
                let key = self.member_name(callee)?.to_property_key()?;
                (get_member(&object, &key)?, object)
            }
            _ => {
                let function = self.eval(callee)?;
                if function.is_nullish() && e.is_optional() {
                    return Ok(SHORT_CIRCUITED);
                }
                (function, StaticValue::Undefined)
            }
        };
        let StaticValue::Builtin(function) = function else {
            return Err(Stop::NotStatic);
        };
        match function.member() {
            Member::Call => Ok((call(function, &this, &args)?, false)),
            Member::PassThrough => Ok((
                args.into_iter().next().unwrap_or(StaticValue::Undefined),
                false,
            )),
            _ => Err(Stop::NotStatic),
        }
    }

    fn object(&mut self, e: Expr<'a>) -> Eval<StaticValue<'a>> {
        let ExprKind::Object(props) = e.kind() else {
            return Err(Stop::NotStatic);
        };
        let mut properties = Vec::with_capacity(props.len());
        for prop in props {
            let value = prop.value().ok_or(Stop::NotStatic)?;
            match prop.kind() {
                PropKind::Init | PropKind::Shorthand | PropKind::Method => {
                    let key = self.key_name(prop.key().ok_or(Stop::NotStatic)?)?;
                    set_property(&mut properties, key, self.eval(value)?)?;
                }
                PropKind::Spread => assign(&mut properties, &self.eval(value)?)?,
                PropKind::Getter | PropKind::Setter => return Err(Stop::NotStatic),
            }
        }
        Ok(StaticValue::Object(properties))
    }

    fn template(&mut self, template: Template<'a>) -> Eval<StaticValue<'a>> {
        if let Some(text) = template.as_static() {
            return Ok(StaticValue::string(text.bytes()));
        }
        let values = self.elements(template.exprs())?;
        let mut text = Vec::new();
        for i in 0..template.quasi_count() {
            js_string::push_str(&mut text, template.cooked(i).ok_or(Stop::Abort)?.bytes());
            if let Some(value) = values.get(i) {
                js_string::push_str(&mut text, &value.to_primitive()?.to_string()?);
            }
            if text.len() > MAX_LEN {
                return Err(Stop::Abort);
            }
        }
        Ok(StaticValue::string(text))
    }

    fn tagged_template(&mut self, call: Call<'a>) -> Eval<StaticValue<'a>> {
        let tag = self.eval(call.callee())?;
        let Some(ExprKind::Template(template)) = call.template().map(Expr::kind) else {
            return Err(Stop::NotStatic);
        };
        let values = self.elements(template.exprs())?;
        if !matches!(tag, StaticValue::Builtin(function) if function.name() == "String.raw") {
            return Err(Stop::NotStatic);
        }
        let raw: Vec<Cow<'a, [u8]>> = (0..template.quasi_count())
            .map(|i| normalize_line_breaks(template.raw(i)))
            .collect();
        string_raw(&raw, &values)
    }
}

/// The raw text of a template has `\n` for `\r\n` and for `\r`.
fn normalize_line_breaks(raw: &[u8]) -> Cow<'_, [u8]> {
    if !strings::contains_char(raw, b'\r') {
        return Cow::Borrowed(raw);
    }
    let mut text = Vec::with_capacity(raw.len());
    let mut rest = raw;
    while let [byte, after @ ..] = rest {
        rest = after;
        if *byte == b'\r' {
            text.push(b'\n');
            rest = after.strip_prefix(b"\n").unwrap_or(after);
        } else {
            text.push(*byte);
        }
    }
    Cow::Owned(text)
}

/// Upstream's `isEffectivelyConst`: the variable is only written by its initializer.
fn is_effectively_const(symbol: Symbol<'_>) -> bool {
    let mut initializers = 0;
    for reference in symbol.references() {
        if reference.is_init() {
            initializers += 1;
        } else if !reference.is_read_only() {
            return false;
        }
    }
    initializers == 1
}
