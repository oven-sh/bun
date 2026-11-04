use bun_sema::atom::{Atom, written_name};
use bun_sema::bind::{Decl, FnOwner, Parent, PatParent, SymbolId};
use bun_sema::check::aot::{AnythingReason, ClassRef, FunctionRef, ShapeKind};
use bun_sema::hir::{
    BinOp, ExprId, ExprKind, FnKind, MemberId, MemberKey, ParamId, PatKind, PropKey, StmtKind,
    UnOp, is_parenthesized,
};
use bun_sema::node::NodeData;

use crate::diagnostics::{Int32Flow, Int32FlowValue, range_of_node};
use crate::ir::{DeclaredType, FunctionKey, PositionFlags};
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering};

fn concat(parts: &[&[u8]]) -> Vec<u8> {
    parts.concat()
}

fn quoted(name: &[u8]) -> Vec<u8> {
    concat(&[b"'", name, b"'"])
}

fn parenthesized(text: &[u8]) -> Vec<u8> {
    concat(&[b"(", text, b")"])
}

fn operator_text(op: BinOp) -> &'static [u8] {
    match op {
        BinOp::Add => b"+",
        BinOp::Sub => b"-",
        BinOp::Mul => b"*",
        BinOp::Div => b"/",
        BinOp::Rem => b"%",
        BinOp::Pow => b"**",
        BinOp::Shl => b"<<",
        BinOp::Shr => b">>",
        BinOp::UShr => b">>>",
        BinOp::BitAnd => b"&",
        BinOp::BitOr => b"|",
        BinOp::BitXor => b"^",
        BinOp::Lt => b"<",
        BinOp::Le => b"<=",
        BinOp::Gt => b">",
        BinOp::Ge => b">=",
        BinOp::EqEq => b"==",
        BinOp::NotEq => b"!=",
        BinOp::EqEqEq => b"===",
        BinOp::NotEqEq => b"!==",
        BinOp::In => b"in",
        BinOp::Instanceof => b"instanceof",
        BinOp::And => b"&&",
        BinOp::Or => b"||",
        BinOp::Nullish => b"??",
        BinOp::Comma => b",",
    }
}

fn name_text<'p>(file: &FileLowering<'_, '_, 'p, '_>, name: Atom) -> &'p [u8] {
    written_name(file.queries.atom_bytes(name))
}

fn present_name<'p>(file: &FileLowering<'_, '_, 'p, '_>, name: Atom) -> Option<&'p [u8]> {
    if name.is_none() {
        return None;
    }
    Some(name_text(file, name)).filter(|text| !text.is_empty())
}

fn class_name<'p>(file: &FileLowering<'_, '_, 'p, '_>, class: ClassRef) -> Option<&'p [u8]> {
    present_name(file, file.queries.files().hir(class.file)[class.class].name)
}

fn function_name<'p>(
    file: &FileLowering<'_, '_, 'p, '_>,
    function: FunctionRef,
) -> Option<&'p [u8]> {
    let files = file.queries.files();
    let (hir, bound) = (files.hir(function.file), files.bound(function.file));
    let declaration = hir[function.function];
    if declaration.kind == FnKind::Constructor
        && let Some(class) = bound.function_class(function.function)
    {
        let class = ClassRef {
            file: function.file,
            class,
        };
        return class_name(file, class);
    }
    if let Some(name) = present_name(file, declaration.name) {
        return Some(name);
    }
    if let FnOwner::Expr(expression) = bound.fns[function.function.idx()].owner
        && let Parent::VarInit(variable) = bound.parent_of_expr(expression)
        && let PatKind::Ident(name) = hir[hir[variable].pat].kind
    {
        return present_name(file, name);
    }
    None
}

fn property_text(name: &[u8], owner: Option<Vec<u8>>) -> Vec<u8> {
    let property = concat(&[b"Property ", &quoted(name)]);
    match owner.filter(|owner| !owner.is_empty()) {
        Some(owner) => concat(&[&property, b" of ", &quoted(&owner)]),
        None => property,
    }
}

fn type_name(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> Option<Vec<u8>> {
    if let Ok(shape) = file.queries.type_shape(ty)
        && let ShapeKind::Class(class) = shape.kind
    {
        return class_name(file, class).map(<[u8]>::to_vec);
    }
    Some(file.queries.type_text(ty))
}

fn binding_text(file: &FileLowering<'_, '_, '_, '_>, symbol: SymbolId) -> Vec<u8> {
    let bound = file.bound;
    let declared = bound.symbol(symbol);
    if let Some(&Decl::Param(pattern)) = declared.decls.first()
        && let PatParent::Param(parameter) = bound.pat_parent[pattern.idx()]
    {
        return file.own_parameter_text(parameter);
    }
    quoted(name_text(file, declared.name))
}

fn class_field_text(file: &FileLowering<'_, '_, '_, '_>, member: MemberId) -> Option<Vec<u8>> {
    let (PropKey::Name(name) | PropKey::Private(name)) = file.hir[member].key else {
        return None;
    };
    let class = ClassRef {
        file: file.file,
        class: file.bound.member_class(member)?,
    };
    let owner = class_name(file, class).map(<[u8]>::to_vec);
    Some(property_text(name_text(file, name), owner))
}

fn text_of<'p>(file: &FileLowering<'_, '_, 'p, '_>, expression: ExprId) -> &'p [u8] {
    let (start, end) = range_of_node(file.hir, NodeData::Expr(expression));
    let hir = file.hir;
    hir.text
        .get(start as usize..end as usize)
        .unwrap_or_default()
}

fn is_any(file: &mut FileLowering<'_, '_, '_, '_>, expression: ExprId) -> bool {
    let queries = &mut *file.queries;
    let shape = queries
        .expression_type(expression)
        .and_then(|ty| queries.type_shape(ty));
    shape.is_ok_and(|shape| shape.kind == ShapeKind::Anything(AnythingReason::Any))
}

impl FileLowering<'_, '_, '_, '_> {
    fn parameter_text(&self, function: FunctionRef, parameter: ParamId) -> Vec<u8> {
        let hir = self.queries.files().hir(function.file);
        let label = match hir[hir[parameter].pat].kind {
            PatKind::Ident(name) => Some(quoted(name_text(self, name))),
            PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => {
                let mut parameters = hir[function.function].params.iter();
                let position = parameters.position(|other| other == parameter);
                position.map(|position| (position + 1).to_string().into_bytes())
            }
        };
        let mut text = b"Parameter".to_vec();
        if let Some(label) = label {
            text.push(b' ');
            text.extend(label);
        }
        if let Some(name) = function_name(self, function) {
            text.extend(concat(&[b" of ", &quoted(name)]));
        }
        text
    }

    fn own_parameter_text(&self, parameter: ParamId) -> Vec<u8> {
        let function = FunctionRef {
            file: self.file,
            function: self.bound.param_fn[parameter.idx()],
        };
        self.parameter_text(function, parameter)
    }

    fn member_text(&mut self, access: ExprId) -> Option<Vec<u8>> {
        let (object, key) = self.hir.member_key(access)?;
        let name = match key {
            MemberKey::Name(name) | MemberKey::PrivateName(name) => name,
            MemberKey::Computed(_) => return None,
        };
        let owner = match self.queries.expression_type(object) {
            Ok(ty) => type_name(self, ty),
            Err(_) => None,
        };
        Some(property_text(name_text(self, name), owner))
    }

    fn literal_property_text(&mut self, value: ExprId) -> Option<Vec<u8>> {
        let Parent::Prop(property) = self.bound.parent_of_expr(value) else {
            return None;
        };
        let PropKey::Name(name) = self.hir[property].key else {
            return None;
        };
        let literal = self.bound.prop_owner[property.idx()];
        let owner = match self.queries.contextual_type(literal) {
            Ok(Some(ty)) => type_name(self, ty),
            Ok(None) | Err(_) => None,
        };
        Some(property_text(name_text(self, name), owner))
    }

    fn result_text(&self, function: FunctionKey) -> Vec<u8> {
        let name = match function {
            FunctionKey::Source(function) => function_name(self, function),
            _ => None,
        };
        match name {
            Some(name) => concat(&[b"The return value of ", &quoted(name)]),
            None => b"The return value".to_vec(),
        }
    }

    fn assignment_target_text(&mut self, target: ExprId) -> Option<Vec<u8>> {
        match self.hir[target].kind {
            ExprKind::Ident(_) => Some(quoted(text_of(self, target))),
            _ => self.member_text(target),
        }
    }

    /// The position that `stored` flows into, by what stands around it in the source.
    fn text_of_position_around(&mut self, stored: ExprId) -> Option<Vec<u8>> {
        match self.hir[stored].kind {
            ExprKind::Assign {
                op: Some(_),
                target,
                ..
            } => return self.assignment_target_text(target),
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PostInc | UnOp::PreDec | UnOp::PostDec,
                operand,
            } => return self.assignment_target_text(operand),
            _ => {}
        }
        match self.bound.parent_of_expr(stored) {
            Parent::VarInit(variable) => match self.hir[self.hir[variable].pat].kind {
                PatKind::Ident(name) => Some(quoted(name_text(self, name))),
                PatKind::Missing | PatKind::Object(_) | PatKind::Array(_) => None,
            },
            Parent::ParamDefault(parameter) => Some(self.own_parameter_text(parameter)),
            Parent::MemberInit(member) => class_field_text(self, member),
            Parent::Prop(_) => self.literal_property_text(stored),
            Parent::Expr(parent) => match self.hir[parent].kind {
                ExprKind::Assign {
                    op: None,
                    target,
                    value,
                } if value == stored => self.assignment_target_text(target),
                _ => None,
            },
            _ => None,
        }
    }

    fn tight_text(&self, expression: ExprId) -> Vec<u8> {
        let text = text_of(self, expression);
        let is_tight = matches!(
            self.hir[expression].kind,
            ExprKind::Ident(_)
                | ExprKind::This
                | ExprKind::Number(_)
                | ExprKind::String(_)
                | ExprKind::Template { .. }
                | ExprKind::Dot { .. }
                | ExprKind::Index { .. }
                | ExprKind::Call(_)
                | ExprKind::New(_)
                | ExprKind::Unary { .. }
                | ExprKind::Array(_)
                | ExprKind::Object(_)
        );
        if is_tight {
            text.to_vec()
        } else {
            parenthesized(text)
        }
    }

    fn argument_text(&self, expression: ExprId) -> Vec<u8> {
        let text = text_of(self, expression);
        let is_sequence = matches!(
            self.hir[expression].kind,
            ExprKind::Binary {
                op: BinOp::Comma,
                ..
            }
        );
        if is_sequence {
            parenthesized(text)
        } else {
            text.to_vec()
        }
    }

    /// `back`: how to get from the new value to the one that `top++` and `top--` answer with.
    fn step_advice(
        &self,
        step: ExprId,
        operand: ExprId,
        sign: &[u8],
        back: Option<&[u8]>,
    ) -> Vec<u8> {
        let target = self.tight_text(operand);
        let stored = concat(&[&target, b" = (", &target, b" ", sign, b" 1) | 0"]);
        let advice = match back.filter(|_| !self.is_value_dropped(step)) {
            Some(back) => concat(&[b"((", &stored, b") ", back, b" 1) | 0"]),
            None => stored,
        };
        match self.stands_where_any_expression_may(step) {
            true => advice,
            false => parenthesized(&advice),
        }
    }

    fn is_value_dropped(&self, expression: ExprId) -> bool {
        match self.bound.parent_of_expr(expression) {
            Parent::Stmt(statement) => match self.hir[statement].kind {
                StmtKind::Expr(_) => true,
                StmtKind::For { update, .. } => update == expression,
                _ => false,
            },
            Parent::Expr(parent) => match self.hir[parent].kind {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    left,
                    ..
                } => left == expression || self.is_value_dropped(parent),
                ExprKind::Unary { op: UnOp::Void, .. } => true,
                _ => false,
            },
            _ => false,
        }
    }

    /// A step binds tighter than what is written in its place: `++i * 3` is not `i = (i + 1) | 0 * 3`.
    fn stands_where_any_expression_may(&self, expression: ExprId) -> bool {
        if is_parenthesized(self.hir, expression) {
            return true;
        }
        let Parent::Expr(parent) = self.bound.parent_of_expr(expression) else {
            return true;
        };
        match self.hir[parent].kind {
            ExprKind::Index { index, .. } => index == expression,
            ExprKind::Assign { value, .. } => value == expression,
            ExprKind::Cond { test, .. } => test != expression,
            ExprKind::Call(call) | ExprKind::New(call) => self.hir[call].callee != expression,
            ExprKind::Binary {
                op: BinOp::Comma, ..
            }
            | ExprKind::Array(_)
            | ExprKind::Template { .. } => true,
            _ => false,
        }
    }

    /// What to write in place of the stored expression so that the value is an int32 in plain Bun too.
    fn advice_text(&self, stored: ExprId) -> Vec<u8> {
        match self.hir[stored].kind {
            ExprKind::Assign {
                op: Some(BinOp::Mul),
                target,
                value,
            } => {
                let (target, value) = (self.tight_text(target), self.argument_text(value));
                concat(&[&target, b" = Math.imul(", &target, b", ", &value, b")"])
            }
            ExprKind::Assign {
                op: Some(op),
                target,
                value,
            } => {
                let (target, value) = (self.tight_text(target), self.tight_text(value));
                let operator = operator_text(op);
                concat(&[
                    &target, b" = (", &target, b" ", operator, b" ", &value, b") | 0",
                ])
            }
            ExprKind::Unary {
                op: op @ (UnOp::PreInc | UnOp::PostInc),
                operand,
            } => self.step_advice(
                stored,
                operand,
                b"+",
                (op == UnOp::PostInc).then_some(b"-".as_slice()),
            ),
            ExprKind::Unary {
                op: op @ (UnOp::PreDec | UnOp::PostDec),
                operand,
            } => self.step_advice(
                stored,
                operand,
                b"-",
                (op == UnOp::PostDec).then_some(b"+".as_slice()),
            ),
            ExprKind::Binary {
                op: BinOp::Mul,
                left,
                right,
            } => {
                let (left, right) = (self.argument_text(left), self.argument_text(right));
                concat(&[b"Math.imul(", &left, b", ", &right, b")"])
            }
            _ => concat(&[&self.tight_text(stored), b" | 0"]),
        }
    }

    fn describe_flowing_expression(&mut self, stored: ExprId) -> Int32FlowValue {
        Int32FlowValue::Expression {
            start: range_of_node(self.hir, NodeData::Expr(stored)).0,
            text: text_of(self, stored).to_vec(),
            advice: self.advice_text(stored),
            is_any: is_any(self, stored),
        }
    }

    fn add_int32_flow(&mut self, position: u32, subject: Vec<u8>, value: Int32FlowValue) {
        let file = self.file;
        self.diagnostics.add_int32_flow(Int32Flow {
            file,
            position,
            subject,
            value,
        });
    }
}

fn owes_proof(position: DeclaredType) -> bool {
    position.flags.contains(PositionFlags::IS_INT32_PROMISE)
}

// Each keeps what the error about a flow says beside the engine's reason. The conversion is emitted next.
// Of two descriptions of one conversion the first stays, so whoever holds the binding or the callee describes the flow ahead of `convert_as`.
impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn describe_int32_flow(
        &mut self,
        position: DeclaredType,
        stored: Option<ExprId>,
        is_assertion: bool,
    ) {
        let (true, Some(stored)) = (owes_proof(position), stored) else {
            return;
        };
        let at = self.position();
        let subject = match is_assertion {
            true => Some(b"This expression".to_vec()),
            false => self.file.text_of_position_around(stored),
        };
        let subject = subject.unwrap_or_else(|| b"The value".to_vec());
        let value = self.file.describe_flowing_expression(stored);
        self.file.add_int32_flow(at, subject, value);
    }

    pub(in crate::lower) fn describe_int32_result(
        &mut self,
        position: DeclaredType,
        returned: Option<ExprId>,
    ) {
        let (true, Some(returned)) = (owes_proof(position), returned) else {
            return;
        };
        let at = self.position();
        let subject = self.file.result_text(self.key);
        let value = self.file.describe_flowing_expression(returned);
        self.file.add_int32_flow(at, subject, value);
    }

    /// Without an expression the value is assigned by a pattern, or by the head of a `for...of` or a `for...in` loop.
    pub(in crate::lower) fn describe_int32_flow_into_binding(
        &mut self,
        position: DeclaredType,
        symbol: SymbolId,
        stored: Option<ExprId>,
    ) {
        if !owes_proof(position) {
            return;
        }
        let at = self.position();
        let subject = binding_text(self.file, symbol);
        let value = match stored {
            Some(stored) => self.file.describe_flowing_expression(stored),
            None => {
                let name = self.file.bound.symbol(symbol).name;
                Int32FlowValue::PatternTarget(name_text(self.file, name).to_vec())
            }
        };
        self.file.add_int32_flow(at, subject, value);
    }

    /// As for a binding. A member under a computed key has no name to call the position by.
    pub(super) fn describe_int32_flow_into_member(
        &mut self,
        position: DeclaredType,
        access: ExprId,
        stored: Option<ExprId>,
    ) {
        if !owes_proof(position) {
            return;
        }
        let at = self.position();
        let Some(subject) = self.file.member_text(access) else {
            return;
        };
        let value = match stored {
            Some(stored) => self.file.describe_flowing_expression(stored),
            None => Int32FlowValue::PatternTarget(text_of(self.file, access).to_vec()),
        };
        self.file.add_int32_flow(at, subject, value);
    }

    /// `at`: where the conversion of the argument is emitted. Without an expression the parameter is reached by a spread.
    pub(super) fn describe_int32_argument(
        &mut self,
        at: u32,
        position: DeclaredType,
        callee: FunctionRef,
        index: usize,
        stored: Option<ExprId>,
    ) {
        if !owes_proof(position) {
            return;
        }
        let parameters = self.file.queries.files().hir(callee.file)[callee.function].params;
        let Some(parameter) = parameters.iter().nth(index) else {
            return;
        };
        let subject = self.file.parameter_text(callee, parameter);
        let value = match stored {
            Some(stored) => self.file.describe_flowing_expression(stored),
            None => Int32FlowValue::SpreadArgument,
        };
        self.file.add_int32_flow(at, subject, value);
    }
}
