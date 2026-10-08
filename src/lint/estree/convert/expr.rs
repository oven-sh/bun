//! Expressions.

use super::Converter;
use crate::ast::{
    BinOp, Call, Expr, ExprKind, FnKind, Prop, PropKind, Template, UnOp, assign_op_text,
    bin_op_text, un_op_text,
};
use crate::estree::NodeType::*;
use crate::estree::Sink;
use crate::span::Span;
use smallvec::SmallVec;

/// How the place of an expression changes what it is converted to.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    Value,
    /// It is assigned to: array and object literals are patterns.
    Target,
    /// It is the object or the callee of the next link of an optional chain, which has the
    /// `ChainExpression` around it.
    Link,
}

impl<'a, S: Sink> Converter<'a, '_, S> {
    #[inline]
    pub(super) fn expr(&mut self, e: Expr<'a>) {
        self.expr_at(e, Place::Value);
    }

    pub(super) fn opt_expr(&mut self, e: Option<Expr<'a>>) {
        match e {
            Some(e) => self.expr(e),
            None => self.out.null(),
        }
    }

    /// What is assigned to. Parentheses make what is in them an ordinary expression again.
    pub(super) fn target(&mut self, e: Expr<'a>) {
        let place = if e.is_parenthesized() { Place::Value } else { Place::Target };
        self.expr_at(e, place);
    }

    /// The object or the callee of an expression that can be a link of an optional chain.
    fn link(&mut self, e: Expr<'a>) {
        let place = if e.is_parenthesized() { Place::Value } else { Place::Link };
        self.expr_at(e, place);
    }

    fn expr_at(&mut self, e: Expr<'a>, place: Place) {
        if !self.can_descend() {
            return;
        }
        let span = e.span();
        let is_target = place == Place::Target;
        let kind = e.kind();
        let is_chain = place != Place::Link
            && matches!(
                kind,
                ExprKind::Dot { .. } | ExprKind::Index { .. } | ExprKind::Call(_) | ExprKind::NonNull(_)
            )
            && e.is_in_optional_chain();
        if is_chain {
            self.open(ChainExpression, span);
            self.field("expression");
        }
        match kind {
            ExprKind::Missing => self.out.null(),
            ExprKind::Ident(name) => self.identifier(name.bytes(), span),
            ExprKind::PrivateIdentifier(name) => self.private_identifier(name.bytes(), span),
            ExprKind::This => self.leaf(ThisExpression, span),
            ExprKind::Super => self.leaf(Super, span),
            ExprKind::Null => {
                self.open(Literal, span);
                self.text("raw", b"null");
                self.null("value");
                self.close();
            }
            ExprKind::True | ExprKind::False => {
                let value = matches!(kind, ExprKind::True);
                self.open(Literal, span);
                self.text("raw", if value { b"true" } else { b"false" });
                self.flag("value", value);
                self.close();
            }
            ExprKind::Number(value) => self.number_literal(span, value),
            ExprKind::String(value) => self.string_literal(span, value.bytes()),
            ExprKind::BigInt(digits) => self.bigint_literal(span, digits.bytes()),
            ExprKind::Regex(regex) => {
                self.open(Literal, span);
                self.text("raw", self.file.slice(span));
                self.field("regex");
                self.out.start_object();
                self.text("flags", regex.flags());
                self.text("pattern", regex.pattern());
                self.out.end_object();
                self.null("value");
                self.close();
            }
            ExprKind::Template(template) => self.template(span, template, false),
            ExprKind::TaggedTemplate(call) => {
                self.open(TaggedTemplateExpression, span);
                self.field("tag");
                self.expr(call.callee());
                self.type_arguments("typeArguments", call.type_args());
                self.field("quasi");
                match call.template().map(|it| (it.span(), it.kind())) {
                    Some((span, ExprKind::Template(template))) => self.template(span, template, true),
                    _ => self.out.null(),
                }
                self.close();
            }
            ExprKind::Array(elements) => {
                self.open(if is_target { ArrayPattern } else { ArrayExpression }, span);
                if is_target {
                    self.empty("decorators");
                    self.flag("optional", false);
                }
                let each: fn(&mut Self, Expr<'a>) = if is_target { Self::target } else { Self::expr };
                self.list("elements", elements, each);
                self.close();
            }
            ExprKind::Object(properties) => {
                self.open(if is_target { ObjectPattern } else { ObjectExpression }, span);
                if is_target {
                    self.empty("decorators");
                    self.flag("optional", false);
                }
                self.list("properties", properties, |this, it| this.property(it, is_target));
                self.close();
            }
            ExprKind::Fn(func) if func.kind() == FnKind::Arrow => self.arrow_function(span, func),
            ExprKind::Fn(func) => self.function_expression(span, func),
            ExprKind::Class(class) => self.class(ClassExpression, span, class),
            ExprKind::Dot { obj, name, .. } => {
                self.open(MemberExpression, span);
                self.flag("computed", false);
                self.field("object");
                self.link(obj);
                self.flag("optional", e.is_optional());
                self.field("property");
                self.property_name(name);
                self.close();
            }
            ExprKind::Index { obj, index, .. } => {
                self.open(MemberExpression, span);
                self.flag("computed", true);
                self.field("object");
                self.link(obj);
                self.flag("optional", e.is_optional());
                self.field("property");
                self.expr(index);
                self.close();
            }
            ExprKind::Call(call) => {
                self.open(CallExpression, span);
                self.field("callee");
                self.link(call.callee());
                self.arguments(call);
                self.flag("optional", call.is_optional());
                self.close();
            }
            ExprKind::New(call) => {
                self.open(NewExpression, span);
                self.field("callee");
                self.expr(call.callee());
                self.arguments(call);
                self.close();
            }
            ExprKind::Unary { op, operand } => {
                let is_update = matches!(op, UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec);
                self.open(if is_update { UpdateExpression } else { UnaryExpression }, span);
                self.field("argument");
                self.expr(operand);
                self.text("operator", un_op_text(op).as_bytes());
                self.flag("prefix", !matches!(op, UnOp::PostInc | UnOp::PostDec));
                self.close();
            }
            ExprKind::Binary {
                op: BinOp::Comma, ..
            } => {
                self.open(SequenceExpression, span);
                self.list("expressions", e.sequence(), Self::expr);
                self.close();
            }
            ExprKind::Binary { .. } => self.binary(e),
            ExprKind::Assign { target, value, .. } if is_target => {
                self.open(AssignmentPattern, span);
                self.empty("decorators");
                self.field("left");
                self.target(target);
                self.flag("optional", false);
                self.field("right");
                self.expr(value);
                self.close();
            }
            ExprKind::Assign { op, target, value } => {
                self.open(AssignmentExpression, span);
                self.field("left");
                self.target(target);
                self.text("operator", assign_op_text(op).as_bytes());
                self.field("right");
                self.expr(value);
                self.close();
            }
            ExprKind::Cond { test, yes, no } => {
                self.open(ConditionalExpression, span);
                self.field("test");
                self.expr(test);
                self.field("consequent");
                self.expr(yes);
                self.field("alternate");
                self.expr(no);
                self.close();
            }
            ExprKind::Spread(argument) => self.spread(span, argument, is_target),
            ExprKind::Await(argument) => {
                self.open(AwaitExpression, span);
                self.field("argument");
                self.expr(argument);
                self.close();
            }
            ExprKind::Yield { value, star } => {
                self.open(YieldExpression, span);
                self.field("argument");
                self.opt_expr(value);
                self.flag("delegate", star);
                self.close();
            }
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                let node_type = match kind {
                    ExprKind::Satisfies { .. } => TSSatisfiesExpression,
                    _ if e.is_angle_bracket_assertion() => TSTypeAssertion,
                    _ => TSAsExpression,
                };
                self.open(node_type, span);
                self.field("expression");
                self.expr(expr);
                self.field("typeAnnotation");
                self.ty(ty);
                self.close();
            }
            ExprKind::AsConst(expr) => {
                let is_assertion = e.is_angle_bracket_assertion();
                self.open(if is_assertion { TSTypeAssertion } else { TSAsExpression }, span);
                self.field("expression");
                self.expr(expr);
                self.field("typeAnnotation");
                let keyword = e.const_keyword_span().unwrap_or_default();
                self.open(TSTypeReference, keyword);
                self.field("typeName");
                self.identifier(b"const", keyword);
                self.close();
                self.close();
            }
            ExprKind::NonNull(expr) => {
                self.open(TSNonNullExpression, span);
                self.field("expression");
                self.link(expr);
                self.close();
            }
            ExprKind::Instantiation { expr, type_args } => {
                self.open(TSInstantiationExpression, span);
                self.field("expression");
                self.expr(expr);
                self.type_arguments("typeArguments", type_args);
                self.close();
            }
            ExprKind::Jsx(jsx) => self.jsx(span, jsx),
            ExprKind::ImportCall { args } => {
                self.open(ImportExpression, span);
                self.field("source");
                self.opt_expr(args.get(0));
                self.field("options");
                self.opt_expr(args.get(1));
                self.field("phase");
                match e.is_deferred_import_call() {
                    true => self.out.string(b"defer"),
                    false => self.out.null(),
                }
                self.close();
            }
            ExprKind::ImportMeta | ExprKind::NewTarget => {
                self.has_import_meta |= matches!(kind, ExprKind::ImportMeta);
                let (meta, property) = e.meta_property_spans().unwrap_or_default();
                self.open(MetaProperty, span);
                self.field("meta");
                self.identifier(self.file.slice(meta), meta);
                self.field("property");
                self.identifier(self.file.slice(property), property);
                self.close();
            }
        }
        if is_chain {
            self.close();
        }
    }

    /// The fields `arguments` and `typeArguments`.
    fn arguments(&mut self, call: Call<'a>) {
        self.list("arguments", call.args(), Self::expr);
        self.type_arguments("typeArguments", call.type_args());
    }

    /// `...argument`
    fn spread(&mut self, span: Span, argument: Expr<'a>, is_target: bool) {
        self.open(if is_target { RestElement } else { SpreadElement }, span);
        self.field("argument");
        if is_target {
            self.target(argument);
            self.empty("decorators");
            self.flag("optional", false);
        } else {
            self.expr(argument);
        }
        self.close();
    }

    /// A binary or a logical expression. It goes down the left operands in a loop: `a + b + c + ..`
    /// is nested as deeply as it is long.
    fn binary(&mut self, e: Expr<'a>) {
        let mut rights: SmallVec<[Expr<'a>; 8]> = SmallVec::new();
        let mut at = e;
        while let ExprKind::Binary { op, left, right } = at.kind()
            && op != BinOp::Comma
        {
            let is_logical = matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish);
            self.open(if is_logical { LogicalExpression } else { BinaryExpression }, at.span());
            self.text("operator", bin_op_text(op).as_bytes());
            self.field("left");
            rights.push(right);
            at = left;
        }
        self.expr(at);
        while let Some(right) = rights.pop() {
            self.field("right");
            self.expr(right);
            self.close();
        }
    }

    fn template(&mut self, span: Span, template: Template<'a>, is_tagged: bool) {
        self.open(TemplateLiteral, span);
        self.list("expressions", template.exprs(), Self::expr);
        let count = template.quasi_count();
        self.list("quasis", 0..count, |this, i| {
            let cooked = template.cooked(i).map(|it| it.bytes());
            let cooked = cooked.filter(|_| !is_tagged || has_valid_escapes(template.raw(i)));
            this.template_element(template.quasi_span(i), i + 1 == count, cooked, template.raw(i));
        });
        self.close();
    }

    pub(super) fn template_element(&mut self, span: Span, is_tail: bool, cooked: Option<&[u8]>, raw: &[u8]) {
        self.open(TemplateElement, span);
        self.flag("tail", is_tail);
        self.field("value");
        self.out.start_object();
        match cooked {
            Some(cooked) => self.text("cooked", cooked),
            None => self.null("cooked"),
        }
        self.text("raw", raw);
        self.out.end_object();
        self.close();
    }

    /// A property of an object literal.
    fn property(&mut self, prop: Prop<'a>, is_target: bool) {
        let span = prop.span();
        let kind = prop.kind();
        let (Some(key), Some(value)) = (prop.key(), prop.value()) else {
            return match (kind, prop.value()) {
                (PropKind::Spread, Some(argument)) => self.spread(span, argument, is_target),
                _ => self.out.null(),
            };
        };
        self.open(Property, span);
        self.key(key);
        self.text(
            "kind",
            match kind {
                PropKind::Getter => b"get",
                PropKind::Setter => b"set",
                _ => b"init",
            },
        );
        self.flag("method", kind == PropKind::Method);
        self.flag("optional", prop.func().is_some() && prop.is_optional());
        self.flag("shorthand", kind == PropKind::Shorthand);
        self.field("value");
        match (kind, value.kind()) {
            // `{ a = 1 }`
            (PropKind::Shorthand, ExprKind::Assign { target, value, .. }) => {
                self.open(AssignmentPattern, span);
                self.empty("decorators");
                self.field("left");
                self.expr(target);
                self.flag("optional", false);
                self.field("right");
                self.expr(value);
                self.close();
            }
            (PropKind::Method | PropKind::Getter | PropKind::Setter, ExprKind::Fn(func)) => {
                self.method_value(func, false);
            }
            _ if is_target => self.target(value),
            _ => self.expr(value),
        }
        self.close();
    }
}

/// `#isValidEscape`
fn has_valid_escapes(raw: &[u8]) -> bool {
    let is_hex = |bytes: Option<&[u8]>| bytes.is_some_and(|it| it.iter().all(u8::is_ascii_hexdigit));
    let mut rest = raw;
    while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\\') {
        let is_valid = match rest.get(at + 1) {
            Some(b'u') => rest.get(at + 2) == Some(&b'{') || is_hex(rest.get(at + 2..at + 6)),
            Some(b'x') => is_hex(rest.get(at + 2..at + 4)),
            _ => true,
        };
        if !is_valid {
            return false;
        }
        rest = &rest[at + 1..];
    }
    true
}
