//! `object-type-checker.js` of eslint-plugin-es-x: what kind of object an expression is, as far as the syntax tells.

use bun_lint::prelude::*;
use rustc_hash::FxHashMap;

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
    e.reference()
        .is_some_and(|it| it.symbol().is_none() && it.global().is_some())
}

/// `buildExpressionTypeProvider`, for a file.
#[derive(Default)]
pub(crate) struct ExpressionTypes<'a> {
    /// The expressions that are being looked at.
    tracked: Vec<Expr<'a>>,
    /// The least position in `tracked` of an expression that was come to again since the one on top was come to.
    came_again_to: Option<usize>,
    /// How many expressions have been looked at for the first of `tracked`.
    steps: u32,
    /// What was found about an expression at a position in `tracked`, if it does not depend on what else was in there.
    known: FxHashMap<(Expr<'a>, usize), Option<&'static str>>,
    /// Whether a variable only has the value that it is declared with.
    is_never_written: FxHashMap<Symbol<'a>, bool>,
}

impl<'a> ExpressionTypes<'a> {
    /// Variables whose values refer to each other, several times each, lead to the same expressions in ever different ways. Nothing
    /// is said about what takes more steps.
    const MOST_STEPS: u32 = 4096;

    pub(crate) fn get_type(&mut self, node: Expr<'a>) -> Option<&'static str> {
        let depth = self.tracked.len();
        if depth == 0 {
            self.steps = 0;
        }
        if depth > 64 || self.steps >= Self::MOST_STEPS {
            return None;
        }
        if let Some(at) = self.tracked.iter().position(|it| *it == node) {
            self.came_again_to = Some(self.came_again_to.map_or(at, |it| it.min(at)));
            return None;
        }
        if let Some(&known) = self.known.get(&(node, depth)) {
            return known;
        }
        self.steps += 1;
        let before = self.came_again_to.take();
        self.tracked.push(node);
        let result = self.compute(node);
        self.tracked.pop();
        if self.came_again_to.is_none_or(|it| it >= depth) {
            self.came_again_to = before;
            if self.steps < Self::MOST_STEPS {
                self.known.insert((node, depth), result);
            }
        } else {
            self.came_again_to = self.came_again_to.min(before.or(self.came_again_to));
        }
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
            ExprKind::Assign {
                op: None, value, ..
            } => self.get_type(value),
            ExprKind::Assign {
                op: Some(op),
                target,
                value,
            } => self.operator_type(op, target, value),
            ExprKind::Unary { op, operand } => match op {
                UnOp::Not | UnOp::Delete => Some("Boolean"),
                UnOp::Plus | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                    Some("Number")
                }
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
                    ExprKind::Ident(name) if is_global_object(callee) => {
                        return_type_of_global(name.bytes())
                    }
                    ExprKind::Dot { obj, name, .. }
                        if obj.is_ident("Intl") && is_global_object(obj) =>
                    {
                        return_type_of_intl(name.bytes())
                    }
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
                    || *self.is_never_written.entry(variable).or_insert_with(|| {
                        variable.references().all(|it| {
                            it.is_read_only() || Some(it.span()) == declaration.name_span()
                        })
                    });
                if is_never_written {
                    self.get_type(init)
                } else {
                    None
                }
            }
            DeclarationKind::FunctionName => Some("Function"),
            _ => None,
        }
    }

    fn operator_type(
        &mut self,
        op: BinOp,
        left: Expr<'a>,
        right: Expr<'a>,
    ) -> Option<&'static str> {
        match op {
            BinOp::Add => {
                let (left, right) = (self.get_type(left), self.get_type(right));
                match (left, right) {
                    (Some("String"), _) | (_, Some("String")) => Some("String"),
                    (Some("BigInt"), _) | (_, Some("BigInt")) => Some("BigInt"),
                    (_, Some("Number")) | (Some("Number"), Some("null" | "undefined")) => {
                        Some("Number")
                    }
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
            BinOp::Sub
            | BinOp::Mul
            | BinOp::Div
            | BinOp::Rem
            | BinOp::BitXor
            | BinOp::Pow
            | BinOp::BitAnd
            | BinOp::BitOr => match (self.get_type(left), self.get_type(right)) {
                (Some("BigInt"), _) | (_, Some("BigInt")) => Some("BigInt"),
                (None, None) => None,
                _ => Some("Number"),
            },
            BinOp::Shl | BinOp::Shr | BinOp::UShr => Some("Number"),
            BinOp::And | BinOp::Or | BinOp::Nullish => {
                let (left, right) = (self.get_type(left), self.get_type(right));
                left.filter(|_| left == right)
            }
            BinOp::Comma => None,
        }
    }
}
