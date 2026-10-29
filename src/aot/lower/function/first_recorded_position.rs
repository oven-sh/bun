use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, Flags, FnBody, FnId, IdList, MemberKind, PatKind, StmtId,
    StmtKind, UnOp,
};

/// An error out of making `this` has no position of its own. JSC's lookup falls on the first
/// expression of the constructor that records one, and on the parameters if there is none.
/// `None`: there is none, or this does not know the form.
pub(super) fn first_recorded_position(
    hir: &hir::File<'_>,
    class: hir::ClassId,
    function: FnId,
) -> Option<u32> {
    let node = hir[function];
    let has_fields = hir[class].members.iter().any(|member| {
        matches!(hir[member].kind, MemberKind::Property)
            && !hir[member].flags.contains(Flags::STATIC)
    });
    let has_plain_parameters = node.params.iter().all(|parameter| {
        let parameter = hir[parameter];
        matches!(hir[parameter.pat].kind, PatKind::Ident(_))
            && parameter.default.is_none()
            && parameter.flags.is_empty()
    });
    let FnBody::Block(statements) = node.body else {
        return None;
    };
    if has_fields || !has_plain_parameters {
        return None;
    }
    match first_of_statements(hir, statements) {
        First::Position(position) => Some(position),
        First::Nothing | First::Unknown => None,
    }
}

#[derive(Copy, Clone)]
enum First {
    Position(u32),
    Nothing,
    Unknown,
}

impl First {
    fn or_else(self, next: impl FnOnce() -> First) -> First {
        match self {
            First::Nothing => next(),
            found => found,
        }
    }
}

fn first_of_statements(hir: &hir::File<'_>, statements: IdList<StmtId>) -> First {
    for index in 0..statements.len as usize {
        match first_of_statement(hir, hir.id_at(statements, index)) {
            First::Nothing => {}
            found => return found,
        }
    }
    First::Nothing
}

fn first_of_statement(hir: &hir::File<'_>, statement: StmtId) -> First {
    match hir[statement].kind {
        StmtKind::Empty | StmtKind::Fn(_) | StmtKind::Directive { .. } => First::Nothing,
        StmtKind::Expr(expression) => first_of_expression(hir, expression),
        StmtKind::Var(declarations) => {
            for declaration in declarations.iter() {
                let declaration = hir[declaration];
                if !matches!(hir[declaration.pat].kind, PatKind::Ident(_)) {
                    return First::Unknown;
                }
                if declaration.init.is_none() {
                    continue;
                }
                match first_of_expression(hir, declaration.init) {
                    First::Nothing => {}
                    found => return found,
                }
            }
            First::Nothing
        }
        // What stands behind it may never be emitted.
        StmtKind::Return(value) if value.is_some() => match first_of_expression(hir, value) {
            First::Nothing => First::Unknown,
            found => found,
        },
        StmtKind::Throw(value) => First::Position(hir::start_of(hir, value)),
        StmtKind::Block(statements) => first_of_statements(hir, statements),
        StmtKind::Class(_) => First::Position(hir[statement].start),
        StmtKind::Labeled { body, .. } => first_of_statement(hir, body),
        StmtKind::Try { block, .. } => first_of_statement(hir, block),
        StmtKind::While { test, .. } => first_of_expression(hir, test),
        StmtKind::DoWhile { body, .. } => first_of_statement(hir, body),
        StmtKind::Switch { expr, .. } => {
            first_of_expression(hir, expr).or_else(|| First::Position(hir::start_of(hir, expr)))
        }
        StmtKind::If { test, yes, no } => match hir[hir.skip_type_assertions(test)].kind {
            // The transpiler drops a test of a name whose arms are empty.
            ExprKind::Ident(_) => match (first_of_statement(hir, yes), no.some()) {
                (First::Nothing, None) => First::Nothing,
                _ => First::Position(hir::start_of(hir, test)),
            },
            ExprKind::Call(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                first_of_expression(hir, test)
            }
            _ => First::Unknown,
        },
        _ => First::Unknown,
    }
}

fn first_of_expression(hir: &hir::File<'_>, expression: ExprId) -> First {
    let expression = hir.skip_type_assertions(expression);
    let start = || First::Position(hir::start_of(hir, expression));
    match hir[expression].kind {
        ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Ident(_)
        | ExprKind::This
        | ExprKind::Fn(_) => First::Nothing,
        ExprKind::Dot {
            chain: Chain::No, ..
        }
        | ExprKind::Index {
            chain: Chain::No, ..
        } => start(),
        ExprKind::TaggedTemplate(_) => start(),
        ExprKind::Array(elements) => {
            for index in 0..elements.len as usize {
                match first_of_expression(hir, hir.id_at(elements, index)) {
                    First::Nothing => {}
                    found => return found,
                }
            }
            First::Nothing
        }
        ExprKind::Object(properties) if properties.iter().next().is_none() => First::Nothing,
        ExprKind::Unary {
            op: UnOp::PostInc | UnOp::PostDec,
            ..
        } => start(),
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec,
            operand,
        } => First::Position(hir::start_of(hir, operand)),
        ExprKind::Call(site) if matches!(hir[site].chain, Chain::No) => {
            match hir[hir.skip_type_assertions(hir[site].callee)].kind {
                ExprKind::Ident(_) | ExprKind::Dot { .. } | ExprKind::Index { .. } => start(),
                _ => First::Unknown,
            }
        }
        ExprKind::New(site) => {
            let callee = hir.skip_type_assertions(hir[site].callee);
            match hir[callee].kind {
                ExprKind::Ident(_) => First::Position(hir::start_of(hir, callee)),
                _ => First::Unknown,
            }
        }
        ExprKind::Unary {
            op: UnOp::Not | UnOp::Typeof | UnOp::Void | UnOp::Delete,
            operand,
        } => first_of_expression(hir, operand),
        ExprKind::Unary {
            op: UnOp::Minus | UnOp::Plus | UnOp::BitNot,
            operand,
        } => first_of_expression(hir, operand)
            .or_else(|| First::Position(hir::start_of(hir, operand))),
        ExprKind::Binary {
            op: BinOp::EqEqEq | BinOp::NotEqEq | BinOp::Comma,
            left,
            right,
        } => first_of_expression(hir, left).or_else(|| first_of_expression(hir, right)),
        ExprKind::Binary {
            op: BinOp::And | BinOp::Or | BinOp::Nullish,
            ..
        }
        | ExprKind::Cond { .. } => start(),
        ExprKind::Binary {
            op:
                BinOp::Add
                | BinOp::Sub
                | BinOp::Mul
                | BinOp::Div
                | BinOp::Rem
                | BinOp::Lt
                | BinOp::Le
                | BinOp::Gt
                | BinOp::Ge,
            left,
            right,
        } => match hir[hir.skip_type_assertions(left)].kind {
            ExprKind::Number(_) | ExprKind::String(_) => first_of_expression(hir, right)
                .or_else(|| First::Position(hir::start_of(hir, right))),
            ExprKind::Ident(_) => start(),
            _ => first_of_expression(hir, left),
        },
        ExprKind::Assign {
            op: None,
            target,
            value,
        } => match hir[hir.skip_type_assertions(target)].kind {
            ExprKind::Ident(_)
            | ExprKind::Dot {
                chain: Chain::No, ..
            } => match hir[hir.skip_type_assertions(value)].kind {
                ExprKind::Ident(_) => First::Position(hir::start_of(hir, value)),
                _ => first_of_expression(hir, value).or_else(start),
            },
            _ => First::Unknown,
        },
        ExprKind::Assign {
            op: Some(_),
            target,
            ..
        } => match hir[hir.skip_type_assertions(target)].kind {
            ExprKind::Ident(_) => start(),
            _ => First::Unknown,
        },
        _ => First::Unknown,
    }
}
