#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/utils/ast-utils/utils.ts` and `lib/utils/ast-utils/regex.ts` of eslint-plugin-regexp.
//!
//! No function takes a `context` or a `sourceCode`: every handle knows its file.

use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::utils::char_source::parse_string_literal;
use bun_lint::utils::eslint_utils::{StaticValue, find_variable_of};
use smallvec::SmallVec;
use std::borrow::Cow;

/// upstream's `findSimpleVariable`: a variable that is defined once, by `var`, `let` or `const`
/// and without a pattern, and its `defs[0].node`.
fn find_simple_variable<'a>(identifier: Expr<'a>) -> Option<(Symbol<'a>, VarDecl<'a>)> {
    if identifier.tag() != ExprTag::Ident {
        return None;
    }
    let variable = find_variable_of(identifier)?;
    if variable.declaration_count() != 1 {
        return None;
    }
    let def = variable.declarations().next()?;
    if def.kind() != Some(DeclarationKind::Variable) {
        return None;
    }
    let Declaration::Var(id) = def else {
        return None;
    };
    match id.parent() {
        Node::VarDecl(node) => Some((variable, node)),
        _ => None,
    }
}

/// upstream's `getStringIfConstant`
pub(crate) fn get_string_if_constant<'a>(node: Expr<'a>) -> Option<Cow<'a, [u8]>> {
    Evaluator::new().get_string_if_constant(node)
}

/// upstream's `getStaticValue`: eslint-utils', which also knows `regexp.source` and takes a
/// variable that is written once for its value on both sides of a `+` and in a template.
pub(crate) fn get_static_value<'a>(node: Expr<'a>) -> Option<StaticValue<'a>> {
    Evaluator::new().get_static_value(node)
}

/// What an evaluation may still take. Upstream recurses until the stack overflows, and evaluates
/// a variable anew each time it is read: `const b = a + a, c = b + b, ..` doubles each time.
struct Evaluator {
    depth: u32,
    budget: u32,
}

const MAX_DEPTH: u32 = 200;

/// No string that is computed is longer, as in `eslint_utils::get_static_value`.
const MAX_LEN: usize = 1 << 20;

impl Evaluator {
    const fn new() -> Self {
        Evaluator {
            depth: 0,
            budget: 20_000,
        }
    }

    fn get_string_if_constant<'a>(&mut self, node: Expr<'a>) -> Option<Cow<'a, [u8]>> {
        match node.tag() {
            ExprTag::Binary
            | ExprTag::Dot
            | ExprTag::Index
            | ExprTag::Ident
            | ExprTag::Template => self.get_static_value(node)?.to_js_string(),
            _ => eslint_utils::get_string_if_constant(node, Some(node.file().scope())),
        }
    }

    fn get_static_value<'a>(&mut self, node: Expr<'a>) -> Option<StaticValue<'a>> {
        if self.depth >= MAX_DEPTH || self.budget == 0 {
            return None;
        }
        self.depth += 1;
        self.budget -= 1;
        let value = self.evaluate(node);
        self.depth -= 1;
        value
    }

    fn evaluate<'a>(&mut self, node: Expr<'a>) -> Option<StaticValue<'a>> {
        match node.kind() {
            ExprKind::Binary { op: BinOp::Add, .. } => return self.add(node),
            // The whole of an optional chain is a `ChainExpression`, not a `MemberExpression`.
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } if !node.is_chain_root() => {
                let prop_name = self.get_property_name(node, true);
                if prop_name.is_some_and(|name| &*name == b"source")
                    && let Some(StaticValue::Regex { pattern, .. }) = self.get_static_value(obj)
                {
                    return Some(StaticValue::String(pattern));
                }
            }
            ExprKind::Template(template) => return self.template(template),
            ExprKind::Ident(_) => {
                let de_ref = dereference_variable(node);
                if de_ref != node {
                    return self.get_static_value(de_ref);
                }
            }
            _ => {}
        }
        eslint_utils::get_static_value(node, Some(node.file().scope()))
    }

    /// `a + b + c + ..` is as deep as it is long: a loop down the left side.
    fn add<'a>(&mut self, node: Expr<'a>) -> Option<StaticValue<'a>> {
        let mut operands: SmallVec<[Expr<'a>; 8]> = SmallVec::new();
        let mut first = node;
        while let ExprKind::Binary {
            op: BinOp::Add,
            left,
            right,
        } = first.kind()
        {
            operands.push(right);
            first = left;
        }
        let mut value = self.get_static_value(first)?;
        while let Some(operand) = operands.pop() {
            value = match (value, self.get_static_value(operand)?) {
                // `js_add` copies what is there, which is quadratic in a chain.
                (StaticValue::String(sum), StaticValue::String(more)) => {
                    let mut sum = sum.into_owned();
                    strings::push_wtf8(&mut sum, &more);
                    if sum.len() > MAX_LEN {
                        return None;
                    }
                    StaticValue::String(Cow::Owned(sum))
                }
                (value, other) => value.js_add(&other)?,
            };
        }
        Some(value)
    }

    fn template<'a>(&mut self, template: Template<'a>) -> Option<StaticValue<'a>> {
        if let Some(value) = template.as_static() {
            return Some(StaticValue::string(value.bytes()));
        }
        let mut value = Vec::new();
        for i in 0..template.quasi_count() {
            strings::push_wtf8(&mut value, template.cooked(i)?.bytes());
            if let Some(expr) = template.exprs().get(i) {
                strings::push_wtf8(&mut value, &self.get_static_value(expr)?.to_js_string()?);
            }
            if value.len() > MAX_LEN {
                return None;
            }
        }
        Some(StaticValue::string(value))
    }

    fn get_property_name<'a>(&mut self, node: Expr<'a>, evaluates: bool) -> Option<Cow<'a, [u8]>> {
        match node.kind() {
            ExprKind::Dot { .. } if node.is_private_member() => None,
            ExprKind::Dot { name, .. } => Some(Cow::Borrowed(name.bytes())),
            ExprKind::Index { index, .. } if evaluates => self.get_string_if_constant(index),
            ExprKind::Index { index, .. } if is_string_literal(index) => {
                Some(Cow::Borrowed(index.as_string()?.bytes()))
            }
            _ => None,
        }
    }
}

/// upstream's `findFunction`
pub(crate) fn find_function<'a>(id: Expr<'a>) -> Option<Func<'a>> {
    let mut target = id;
    // Upstream stops at an identifier that it has seen: by then each variable has had its turn.
    for _ in 0..=id.file().symbol_key_limit() {
        let callee_variable = find_variable_of(target)?;
        if callee_variable.declaration_count() != 1 {
            return None;
        }
        let def = callee_variable.declarations().next()?;
        let node = match def.node()? {
            // `def.node` of a parameter is its function as well.
            Node::Func(func) if func.kind() == FnKind::Decl && func.has_body() => {
                return Some(func);
            }
            Node::VarDecl(node) if def.kind() == Some(DeclarationKind::Variable) => node,
            _ => return None,
        };
        if node.var_kind() != VarKind::Const {
            return None;
        }
        let init = node.init()?;
        if let Some(func) = init.as_fn() {
            return Some(func);
        }
        if init.tag() != ExprTag::Ident {
            return None;
        }
        target = init;
    }
    None
}

/// upstream's `KnownMethodCall`
#[derive(Copy, Clone)]
pub(crate) struct KnownMethodCall<'a> {
    pub(crate) call: Expr<'a>,
    /// `callee.object`
    pub(crate) object: Expr<'a>,
    /// `callee.property`
    pub(crate) property: Ident<'a>,
    pub(crate) args: List<'a, Expr<'a>>,
}

/// upstream's `isKnownMethodCall`. `methods`: the names, each with its number of arguments.
pub(crate) fn is_known_method_call<'a>(
    node: Expr<'a>,
    methods: &[(&str, usize)],
) -> Option<KnownMethodCall<'a>> {
    let call = node.as_call()?;
    let mem = call.callee();
    let ExprKind::Dot {
        obj: object,
        name: property,
        ..
    } = mem.kind()
    else {
        return None;
    };
    // A `ChainExpression` is around the callee of `(a?.b)()`.
    if mem.is_private_member() || mem.is_chain_root() {
        return None;
    }
    let args = call.args();
    let (_, arg_length) = methods.iter().find(|it| property.name().is(it.0))?;
    if args.len() != *arg_length
        || args.iter().any(|arg| arg.tag() == ExprTag::Spread)
        || object.tag() == ExprTag::Super
    {
        return None;
    }
    Some(KnownMethodCall {
        call: node,
        object,
        property,
        args,
    })
}

/// upstream's `getStringValueRange`: where the UTF-16 code units of the value of the string
/// literal `node` from `start_offset` to `end_offset` are written.
pub(crate) fn get_string_value_range(
    node: Expr<'_>,
    start_offset: u32,
    end_offset: u32,
) -> Option<Span> {
    if !is_string_literal(node) {
        return None;
    }
    let (raw, node_start) = (node.text(), node.span().start);
    let units = parse_string_literal(raw);
    if (units.len() as u32) < end_offset {
        return None;
    }
    let (mut value_index, mut start) = (0, None);
    // The body of upstream's loop, for a token from `from` to `to` whose value has `len` units.
    let mut token = |from: u32, to: u32, len: u32| {
        let end_index = value_index + len;
        if start.is_none() && value_index <= start_offset && start_offset < end_index {
            start = Some(from);
        }
        let has_end = value_index < end_offset && end_offset <= end_index;
        value_index = end_index;
        start
            .filter(|_| has_end)
            .map(|start| Span::new(node_start + start, node_start + to))
    };
    let closing_quote = raw.len().saturating_sub(1) as u32;
    let (mut at, mut rest) = (1, &units[..]);
    loop {
        // A line continuation has no unit. For upstream `\` and a line separator are a character.
        let next = rest.first().map_or(closing_quote, |t| t.start);
        while at < next {
            let len = match raw.get(at as usize + 1..) {
                Some([0xE2, ..]) => 4,
                Some([b'\r', b'\n', ..]) => 3,
                _ => 2,
            };
            if len == 4
                && let Some(range) = token(at, at + len, 1)
            {
                return Some(range);
            }
            at += len;
        }
        let [t, after @ ..] = rest else {
            return None;
        };
        // Upstream's tokenizer throws at a line separator that is written as it is.
        if matches!(t.code_unit, 0x2028 | 0x2029) && t.end - t.start == 3 {
            return None;
        }
        // The two halves of a character are one token of upstream's.
        let is_pair = after.first().is_some_and(|next| next.start == t.start);
        if let Some(range) = token(t.start, t.end, if is_pair { 2 } else { 1 }) {
            return Some(range);
        }
        at = t.end;
        rest = after.get(usize::from(is_pair)..).unwrap_or_default();
    }
}

/// upstream's `isStringLiteral`: a template is none.
pub(crate) fn is_string_literal(node: Expr<'_>) -> bool {
    node.tag() == ExprTag::String && !node.is_jsx_text() && !node.is_jsx_tag_name()
}

/// upstream's `getPropertyName`: `None` for a private name. `evaluates`: a `context` is given, so
/// a computed name can be any constant, else only a string literal.
pub(crate) fn get_property_name<'a>(node: Expr<'a>, evaluates: bool) -> Option<Cow<'a, [u8]>> {
    Evaluator::new().get_property_name(node, evaluates)
}

/// From `expression` along `step` to where that ends. Upstream recurses, for ever in
/// `const a = b, b = a`, where `expression` stays as it is here.
fn dereference<'a>(expression: Expr<'a>, step: fn(Expr<'a>) -> Option<Expr<'a>>) -> Expr<'a> {
    let Some(mut value) = step(expression) else {
        return expression;
    };
    for _ in 0..expression.file().symbol_key_limit() {
        match step(value) {
            Some(next) => value = next,
            None => return value,
        }
    }
    expression
}

/// upstream's `dereferenceOwnedVariable`: the value of a variable that is written once and only
/// read by `expression`, and so on from that value.
pub(crate) fn dereference_owned_variable<'a>(expression: Expr<'a>) -> Expr<'a> {
    dereference(expression, init_of_owned_variable)
}

fn init_of_owned_variable<'a>(expression: Expr<'a>) -> Option<Expr<'a>> {
    let (variable, node) = find_simple_variable(expression)?;
    // An `ExportNamedDeclaration` is around it: other modules can refer to the variable.
    if node.parent().as_stmt().is_some_and(Stmt::is_exported) {
        return None;
    }
    let mut references = variable.references();
    if references.len() != 2 {
        return None;
    }
    let (init_ref, this_ref) = (references.next()?, references.next()?);
    let init = node.init()?;
    let is_owned = init_ref.is_init()
        && init_ref.write_expr() == Some(init)
        && this_ref.expr() == Some(expression);
    is_owned.then_some(init)
}

/// upstream's `dereferenceVariable`: the value of a variable that is never assigned to again, and
/// so on from that value.
pub(crate) fn dereference_variable<'a>(expression: Expr<'a>) -> Expr<'a> {
    dereference(expression, init_of_variable)
}

fn init_of_variable<'a>(expression: Expr<'a>) -> Option<Expr<'a>> {
    let (variable, node) = find_simple_variable(expression)?;
    let init = node.init()?;
    if node.var_kind() == VarKind::Const {
        return Some(init);
    }
    let mut inits = 0;
    for reference in variable.references() {
        if reference.is_init() {
            inits += 1;
        } else if !reference.is_read_only() {
            return None;
        }
    }
    (inits == 1).then_some(init)
}

/// upstream's `getFlagsRange`
pub(crate) fn get_flags_range(flags_node: Option<Expr<'_>>) -> Option<Span> {
    let flags_node = flags_node?;
    let range = flags_node.span();
    if let ExprKind::Regex(regex) = flags_node.kind() {
        let start = range.end.saturating_sub(regex.flags().len() as u32);
        return Some(Span::new(start, range.end));
    }
    is_string_literal(flags_node).then(|| range.shrink(1, 1))
}

/// upstream's `getFlagsLocation`
pub(crate) fn get_flags_location(regexp_node: Expr<'_>, flags_node: Option<Expr<'_>>) -> Span {
    let Some(mut range) = get_flags_range(flags_node) else {
        return flags_node.map_or_else(|| regexp_node.span(), Expr::span);
    };
    if range.start == range.end {
        range.start = range.start.saturating_sub(1);
    }
    range
}

/// upstream's `getFlagRange`
pub(crate) fn get_flag_range(flags_node: Option<Expr<'_>>, flag: &[u8]) -> Option<Span> {
    let flags_node = flags_node?;
    if flag.is_empty() {
        return None;
    }
    if let ExprKind::Regex(regex) = flags_node.kind() {
        let flags = regex.flags();
        let after = flags.len() - strings::index_of(flags, flag)?;
        let start = flags_node.span().end.saturating_sub(after as u32);
        return Some(Span::new(start, start + 1));
    }
    if !is_string_literal(flags_node) {
        return None;
    }
    let value = flags_node.as_string()?.bytes();
    let index = strings::wtf8_len_utf16(value.get(..strings::index_of(value, flag)?)?);
    get_string_value_range(flags_node, index, index + 1)
}

/// upstream's `getFlagLocation`
pub(crate) fn get_flag_location(
    regexp_node: Expr<'_>,
    flags_node: Option<Expr<'_>>,
    flag: &[u8],
) -> Span {
    get_flag_range(flags_node, flag)
        .or_else(|| flags_node.map(Expr::span))
        .unwrap_or_else(|| regexp_node.span())
}
