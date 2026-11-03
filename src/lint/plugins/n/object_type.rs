//! `object-type-checker.js` from eslint-plugin-es-x: infers what kind of object an expression is, from syntax only.

use bun_lint::prelude::*;
use bun_lint::types::IdMap;
use rustc_hash::FxHashMap;

/// `WELLKNOWN_GLOBALS`: the return type of the global function `name`.
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

/// True if `e` is an identifier that refers to a global variable the file doesn't declare.
fn is_global_object(e: Expr) -> bool {
    e.reference()
        .is_some_and(|it| it.symbol().is_none() && it.global().is_some())
}

/// `buildExpressionTypeProvider`, for a file.
#[derive(Default)]
pub(crate) struct ExpressionTypes<'a> {
    /// The stack of expressions currently being evaluated.
    tracked: Vec<Expr<'a>>,
    /// The lowest index in `tracked` of an expression that was reached again (a cycle) since the top one was pushed.
    lowest_cycle_index: Option<usize>,
    /// The cached result for an expression at a given depth of `tracked`. Only cached if it doesn't depend on what else
    /// was on the stack.
    known: FxHashMap<(Expr<'a>, usize), Option<&'static str>>,
    /// True if a variable only ever has the value it's declared with.
    is_never_written: IdMap<Symbol<'a>, bool>,
}

impl<'a> ExpressionTypes<'a> {
    pub(crate) fn get_type(&mut self, node: Expr<'a>) -> Option<&'static str> {
        let depth = self.tracked.len();
        if !bun_core::StackCheck::init().is_safe_to_recurse() {
            return None;
        }
        if let Some(at) = self.tracked.iter().position(|it| *it == node) {
            self.lowest_cycle_index = Some(self.lowest_cycle_index.map_or(at, |it| it.min(at)));
            return None;
        }
        if let Some(&known) = self.known.get(&(node, depth)) {
            return known;
        }
        let before = self.lowest_cycle_index.take();
        self.tracked.push(node);
        let result = self.compute(node);
        self.tracked.pop();
        if self.lowest_cycle_index.is_none_or(|it| it >= depth) {
            self.lowest_cycle_index = before;
            self.known.insert((node, depth), result);
        } else {
            self.lowest_cycle_index = self
                .lowest_cycle_index
                .min(before.or(self.lowest_cycle_index));
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
                    || *self.is_never_written.get_or_insert_with(variable, || {
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
