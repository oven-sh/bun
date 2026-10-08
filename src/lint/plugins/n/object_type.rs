//! `object-type-checker.js` of eslint-plugin-es-x: what kind of object an expression is, as far as the syntax tells.

use bun_lint::prelude::*;

/// `WELLKNOWN_GLOBALS`: what a call of the global function `name` returns.
fn return_type_of_global(name: &[u8]) -> Option<&'static str> {
    const FUNCTIONS: [&str; 24] = [
        "String",
        "Number",
        "Boolean",
        "Symbol",
        "BigInt",
        "Object",
        "Function",
        "Array",
        "RegExp",
        "Date",
        "Promise",
        "Int8Array",
        "Uint8Array",
        "Uint8ClampedArray",
        "Int16Array",
        "Uint16Array",
        "Int32Array",
        "Uint32Array",
        "Float32Array",
        "Float64Array",
        "BigInt64Array",
        "BigUint64Array",
        "ArrayBuffer",
        "SharedArrayBuffer",
    ];
    FUNCTIONS.into_iter().find(|it| it.as_bytes() == name)
}

/// The same for `Intl.name`.
fn return_type_of_intl(name: &[u8]) -> Option<&'static str> {
    Some(match name {
        b"Collator" => "Intl.Collator",
        b"DateTimeFormat" => "Intl.DateTimeFormat",
        b"ListFormat" => "Intl.ListFormat",
        b"NumberFormat" => "Intl.NumberFormat",
        b"PluralRules" => "Intl.PluralRules",
        b"RelativeTimeFormat" => "Intl.RelativeTimeFormat",
        b"Segmenter" => "Intl.Segmenter",
        _ => return None,
    })
}

/// It is an identifier that refers to a global variable which the file does not declare.
fn is_global_object(e: Expr) -> bool {
    e.reference().is_some_and(|it| it.symbol().is_none() && it.global().is_some())
}

/// `buildExpressionTypeProvider`
#[derive(Default)]
pub(crate) struct ExpressionTypes<'a> {
    /// The expressions that are being looked at.
    tracked: Vec<Expr<'a>>,
}

impl<'a> ExpressionTypes<'a> {
    pub(crate) fn get_type(&mut self, node: Expr<'a>) -> Option<&'static str> {
        if self.tracked.contains(&node) || self.tracked.len() > 64 {
            return None;
        }
        self.tracked.push(node);
        let result = self.compute(node);
        self.tracked.pop();
        result
    }

    fn compute(&mut self, node: Expr<'a>) -> Option<&'static str> {
        match node.kind() {
            ExprKind::Array(_) => Some("Array"),
            ExprKind::Object(_) => Some("Object"),
            ExprKind::Fn(_) | ExprKind::Class(_) => Some("Function"),
            ExprKind::Regex(_) => Some("RegExp"),
            ExprKind::BigInt(_) => Some("BigInt"),
            ExprKind::Null => Some("null"),
            ExprKind::String(_) | ExprKind::Template(_) => Some("String"),
            ExprKind::Number(_) => Some("Number"),
            ExprKind::True | ExprKind::False => Some("Boolean"),
            ExprKind::Ident(name) => self.identifier_type(node, name),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => self.get_type(right),
            ExprKind::Binary { op, left, right } => self.operator_type(op, left, right),
            ExprKind::Assign { op: None, value, .. } => self.get_type(value),
            ExprKind::Assign {
                op: Some(op),
                target,
                value,
            } => self.operator_type(op, target, value),
            ExprKind::Unary { op, operand } => match op {
                UnOp::Not | UnOp::Delete => Some("Boolean"),
                UnOp::Plus | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => Some("Number"),
                UnOp::Minus | UnOp::BitNot => match self.get_type(operand) {
                    Some("BigInt") => Some("BigInt"),
                    argument => argument.map(|_| "Number"),
                },
                UnOp::Typeof => Some("String"),
                UnOp::Void => Some("undefined"),
            },
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => {
                let callee = call.callee();
                match callee.kind() {
                    ExprKind::Ident(name) if is_global_object(callee) => return_type_of_global(name.bytes()),
                    ExprKind::Dot { obj, name, .. } if obj.is_ident("Intl") && is_global_object(obj) => return_type_of_intl(name.bytes()),
                    _ => None,
                }
            }
            ExprKind::Cond { yes, no, .. } => {
                let (consequent, alternate) = (self.get_type(yes), self.get_type(no));
                consequent.filter(|_| consequent == alternate)
            }
            _ => None,
        }
    }

    fn identifier_type(&mut self, node: Expr<'a>, name: Name<'a>) -> Option<&'static str> {
        let reference = node.reference()?;
        let Some(variable) = reference.symbol() else {
            reference.global()?;
            return match name.bytes() {
                b"undefined" => Some("undefined"),
                b"NaN" | b"Infinity" => Some("Number"),
                b"Intl" => Some("Object"),
                name => return_type_of_global(name).map(|_| "Function"),
            };
        };
        let mut declarations = variable.declarations();
        let (Some(declaration), None) = (declarations.next(), declarations.next()) else {
            return None;
        };
        match declaration.kind()? {
            DeclarationKind::Variable => {
                let Node::VarDecl(declarator) = declaration.node()? else {
                    return None;
                };
                let init = declarator.init()?;
                let is_never_written = declarator.var_kind() == VarKind::Const
                    || variable.references().all(|it| it.is_read_only() || Some(it.span()) == declaration.name_span());
                if is_never_written { self.get_type(init) } else { None }
            }
            DeclarationKind::FunctionName => Some("Function"),
            _ => None,
        }
    }

    fn operator_type(&mut self, op: BinOp, left: Expr<'a>, right: Expr<'a>) -> Option<&'static str> {
        match op {
            BinOp::Add => {
                let (left, right) = (self.get_type(left), self.get_type(right));
                match (left, right) {
                    (Some("String"), _) | (_, Some("String")) => Some("String"),
                    (Some("BigInt"), _) | (_, Some("BigInt")) => Some("BigInt"),
                    (_, Some("Number")) | (Some("Number"), Some("null" | "undefined")) => Some("Number"),
                    (_, None) => None,
                    _ => Some("String"),
                }
            }
            BinOp::EqEq
            | BinOp::NotEq
            | BinOp::EqEqEq
            | BinOp::NotEqEq
            | BinOp::Lt
            | BinOp::Le
            | BinOp::Gt
            | BinOp::Ge
            | BinOp::In
            | BinOp::Instanceof => Some("Boolean"),
            BinOp::Sub | BinOp::Mul | BinOp::Div | BinOp::Rem | BinOp::BitXor | BinOp::Pow | BinOp::BitAnd | BinOp::BitOr => {
                match (self.get_type(left), self.get_type(right)) {
                    (Some("BigInt"), _) | (_, Some("BigInt")) => Some("BigInt"),
                    (None, None) => None,
                    _ => Some("Number"),
                }
            }
            BinOp::Shl | BinOp::Shr | BinOp::UShr => Some("Number"),
            BinOp::And | BinOp::Or | BinOp::Nullish => {
                let (left, right) = (self.get_type(left), self.get_type(right));
                left.filter(|_| left == right)
            }
            BinOp::Comma => None,
        }
    }
}
