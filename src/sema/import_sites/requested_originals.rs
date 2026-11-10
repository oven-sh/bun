use crate::atom::{Atom, known};
use crate::bind::{Binding, BindingInitializer, BindingKind, Bound, Decl};
use crate::fold::{TreeNode, push_children};
use crate::hir::{
    BinOp, Branches, Chain, EnumId, ExprId, ExprKind, File, FnBody, FnId, IdList, MemberKey,
    StmtId, StmtKind, UnOp, find_transpiled_mark,
};

#[derive(Default)]
pub struct RequestedOriginals {
    pub may_be_any_module: bool,
    pub names: Vec<Vec<u8>>,
}

impl RequestedOriginals {
    pub fn is_empty(&self) -> bool {
        !self.may_be_any_module && self.names.is_empty()
    }
}

fn requests_original(hir: &File<'_>, member_or_callee: ExprId, is_callee: bool) -> bool {
    let name = match hir[member_or_callee].kind {
        ExprKind::Dot { name, .. } if !hir.is_written_in_brackets(member_or_callee) => name,
        ExprKind::Ident(name) if is_callee => name,
        _ => return false,
    };
    name == known::importActual || name == known::requireActual
}

fn may_request_originals(hir: &File<'_>) -> bool {
    bun_core::strings::contains(&hir.text, b"Actual") && find_transpiled_mark(&hir.text).is_none()
}

pub fn find_request_positions(hir: &File<'_>) -> Vec<u32> {
    if !may_request_originals(hir) {
        return Vec::new();
    }
    let requests = (0..hir.exprs.len() as u32)
        .map(ExprId)
        .filter(|&it| requests_original(hir, it, true));
    let mut positions: Vec<u32> = requests.map(|it| hir[it].pos).collect();
    positions.sort_unstable();
    positions
}

fn find_dead_statements(hir: &File<'_>, list: IdList<StmtId>) -> Vec<TreeNode> {
    let mut dead = Vec::new();
    let mut is_after_jump = false;
    for statement in hir.ids(list) {
        let kind = hir[statement].kind;
        if hir.is_erased_statement(statement) || (is_after_jump && !matches!(kind, StmtKind::Fn(_)))
        {
            dead.push(TreeNode::Stmt(statement));
            continue;
        }
        is_after_jump |= matches!(
            kind,
            StmtKind::Return(_) | StmtKind::Throw(_) | StmtKind::Break(_) | StmtKind::Continue(_)
        );
    }
    dead
}

struct Literals<'f, 's, B> {
    hir: &'f File<'s>,
    bound: &'f Bound<'s>,
    bytes_of: B,
}

enum LiteralValue {
    String(Vec<u8>),
    Number(f64),
}

impl LiteralValue {
    fn into_string(self) -> Option<Vec<u8>> {
        match self {
            LiteralValue::String(value) => Some(value),
            LiteralValue::Number(value) => (value == 0.0
                || (1e-6..9007199254740992.0).contains(&value))
            .then(|| value.to_string().into_bytes()),
        }
    }
}

impl<'x, B: Fn(Atom) -> &'x [u8]> Literals<'_, '_, B> {
    fn find_truth(&self, test: ExprId) -> Option<bool> {
        let hir = self.hir;
        let is_nonzero = |number: u32| hir.numbers[number as usize] != 0.0;
        match hir[hir.skip_type_assertions(test)].kind {
            ExprKind::True => Some(true),
            ExprKind::False | ExprKind::Null => Some(false),
            ExprKind::Number(number) => Some(is_nonzero(number)),
            ExprKind::String(literal) => Some(!(self.bytes_of)(literal).is_empty()),
            ExprKind::Template { exprs } if exprs.is_empty() => {
                let text = hir.ids(hir.template_texts(exprs)).next()?;
                Some(!(self.bytes_of)(text).is_empty())
            }
            ExprKind::Unary { op, operand } => match op {
                UnOp::Not => self.find_truth(operand).map(|is_true| !is_true),
                UnOp::Void => Some(false),
                UnOp::Minus | UnOp::Plus => match hir[hir.skip_type_assertions(operand)].kind {
                    ExprKind::Number(number) => Some(is_nonzero(number)),
                    _ => None,
                },
                _ => None,
            },
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or),
                left,
                right,
            } => {
                let left = self.find_truth(left)?;
                match left == (op == BinOp::Or) {
                    true => Some(left),
                    false => self.find_truth(right),
                }
            }
            _ => None,
        }
    }

    fn find_constant(&self, variable: ExprId, enum_member: Option<Atom>) -> Option<ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        let variable = hir.skip_type_assertions(variable);
        let ExprKind::Ident(_) = hir[variable].kind else {
            return None;
        };
        let Binding::Symbol(symbol) = bound.binding(variable) else {
            return None;
        };
        let Some(enum_member) = enum_member else {
            return match bound.binding_initializer(hir, symbol) {
                BindingInitializer::Expression(value)
                    if bound.binding_kind(symbol) == BindingKind::Const =>
                {
                    Some(value)
                }
                _ => None,
            };
        };
        let blocks = (0..hir.enums.len() as u32).map(EnumId);
        let mut members = blocks
            .filter(|&block| bound.declared_symbol(Decl::Enum(block)) == symbol)
            .flat_map(|block| hir[block].members.iter());
        let member = members.find(|&member| hir[member].name == enum_member)?;
        hir[member].init.some()
    }

    fn evaluate(&self, expr: ExprId, follows_names: bool) -> Option<LiteralValue> {
        let hir = self.hir;
        let string = |literal: Atom| {
            let bytes = (self.bytes_of)(literal);
            core::str::from_utf8(bytes).map_or(&b"\0"[..], str::as_bytes)
        };
        let expr = hir.skip_type_assertions(expr);
        match hir[expr].kind {
            ExprKind::String(literal) => Some(LiteralValue::String(string(literal).to_vec())),
            ExprKind::Number(number) => Some(LiteralValue::Number(hir.numbers[number as usize])),
            ExprKind::Ident(_) if follows_names => {
                self.evaluate(self.find_constant(expr, None)?, false)
            }
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } if follows_names => self.evaluate(self.find_constant(obj, Some(name))?, false),
            ExprKind::Index {
                obj,
                index,
                chain: Chain::No,
            } if follows_names => {
                let MemberKey::Name(name) = hir.index_member_key(hir.skip_type_assertions(index))
                else {
                    return None;
                };
                self.evaluate(self.find_constant(obj, Some(name))?, false)
            }
            ExprKind::Binary {
                op: BinOp::Add,
                left,
                right,
            } => {
                let left = self.evaluate(left, follows_names)?;
                let right = self.evaluate(right, follows_names)?;
                if let (&LiteralValue::Number(left), &LiteralValue::Number(right)) = (&left, &right)
                {
                    return Some(LiteralValue::Number(left + right));
                }
                let mut joined = left.into_string()?;
                joined.extend_from_slice(&right.into_string()?);
                Some(LiteralValue::String(joined))
            }
            ExprKind::Template { exprs } => {
                let mut strings = hir.ids(hir.template_texts(exprs));
                let mut joined = string(strings.next()?).to_vec();
                for (hole, tail) in hir.ids(exprs).zip(strings) {
                    joined.extend_from_slice(&self.evaluate(hole, follows_names)?.into_string()?);
                    joined.extend_from_slice(string(tail));
                }
                Some(LiteralValue::String(joined))
            }
            _ => None,
        }
    }
}

fn find_dead_branch<'x>(
    literals: &Literals<'_, '_, impl Fn(Atom) -> &'x [u8]>,
    node: TreeNode,
) -> Option<TreeNode> {
    let hir = literals.hir;
    let literal = |test: ExprId| literals.find_truth(test);
    match node {
        TreeNode::Stmt(statement) => match hir[statement].kind {
            StmtKind::If { test, yes, no } => {
                literal(test).map(|is_true| TreeNode::Stmt(if is_true { no } else { yes }))
            }
            _ => None,
        },
        TreeNode::Expr(expr) => match hir[expr].kind {
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = hir.branches(branches);
                literal(test).map(|is_true| TreeNode::Expr(if is_true { no } else { yes }))
            }
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or),
                left,
                right,
            } => (literal(left) == Some(op == BinOp::Or)).then_some(TreeNode::Expr(right)),
            _ => None,
        },
        _ => None,
    }
}

fn remove_pushed(stack: &mut Vec<TreeNode>, below: usize, unwanted: &[TreeNode]) {
    let pushed = stack.split_off(below);
    stack.extend(pushed.into_iter().filter(|it| !unwanted.contains(it)));
}

pub fn find_requested_originals<'x, 's>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    function: FnId,
    bytes_of: impl Fn(Atom) -> &'x [u8],
) -> RequestedOriginals {
    let mut requested = RequestedOriginals::default();
    if !may_request_originals(hir) {
        return requested;
    }
    let literals = Literals {
        hir,
        bound,
        bytes_of,
    };
    let mut stack = Vec::new();
    match hir[function].body {
        FnBody::None => {}
        FnBody::Block(statements) => {
            let dead = find_dead_statements(hir, statements);
            let all = hir.ids(statements).map(TreeNode::Stmt);
            stack.extend(all.filter(|it| !dead.contains(it)));
        }
        FnBody::Expr(value) => stack.push(TreeNode::Expr(value)),
    }
    while let Some(node) = stack.pop() {
        let below = stack.len();
        push_children(hir, node, &mut stack);
        let list = match node {
            TreeNode::Function(inner) => match hir[inner].body {
                FnBody::Block(statements) => Some(statements),
                FnBody::None | FnBody::Expr(_) => None,
            },
            TreeNode::Stmt(statement) => match hir[statement].kind {
                StmtKind::Block(statements) => Some(statements),
                StmtKind::Module(module) => Some(hir[module].body),
                _ => None,
            },
            _ => None,
        };
        let mut dead = list.map_or(Vec::new(), |list| find_dead_statements(hir, list));
        if let TreeNode::Stmt(statement) = node
            && let StmtKind::Switch { cases, .. } = hir[statement].kind
        {
            for case in cases.iter() {
                dead.extend(find_dead_statements(hir, hir[case].body));
            }
        }
        dead.extend(find_dead_branch(&literals, node));
        if !dead.is_empty() {
            remove_pushed(&mut stack, below, &dead);
        }
        match node {
            TreeNode::Expr(expr) => match hir[expr].kind {
                ExprKind::Call(call) | ExprKind::New(call) => {
                    let written_callee = hir[call].callee;
                    let callee = hir.skip_type_assertions(written_callee);
                    if !requests_original(hir, callee, true) {
                        continue;
                    }
                    let first = hir.ids(hir[call].args).next();
                    match first.and_then(|first| literals.evaluate(first, true)) {
                        Some(LiteralValue::String(name)) => {
                            if !name.is_empty() && name.iter().all(|byte| *byte >= b' ') {
                                requested.names.push(name);
                            }
                        }
                        _ => requested.may_be_any_module = true,
                    }
                    let callee_at = stack[below..]
                        .iter()
                        .position(|&it| it == TreeNode::Expr(written_callee));
                    if let Some(callee_at) = callee_at {
                        stack.swap_remove(below + callee_at);
                    }
                    if let ExprKind::Dot { obj, .. } = hir[callee].kind {
                        stack.push(TreeNode::Expr(obj));
                    }
                }
                ExprKind::Dot { .. } if requests_original(hir, expr, false) => {
                    requested.may_be_any_module = true;
                }
                ExprKind::Jsx(jsx) => {
                    let names = [hir[jsx].tag, hir[jsx].close_tag].map(TreeNode::Expr);
                    remove_pushed(&mut stack, below, &names);
                }
                _ => {}
            },
            TreeNode::Stmt(statement)
                if matches!(hir[statement].kind, StmtKind::ImportEquals(_)) =>
            {
                stack.truncate(below);
            }
            _ => {}
        }
    }
    requested
}
