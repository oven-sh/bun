use bun_sema::atom::{Atom, written_name};
use bun_sema::bind::{Decl, FnOwner, Parent, PatParent, SymbolId};
use bun_sema::check::aot::{AnythingReason, ClassRef, FunctionRef, ShapeKind};
use bun_sema::hir::{
    BinOp, ExprId, ExprKind, FnKind, MemberId, MemberKey, ParamId, PatKind, PropKey, UnOp,
};
use bun_sema::node::NodeData;

use crate::diagnostics::{Int32Flow, Int32FlowValue, range_of_node};
use crate::ir::{DeclaredType, FunctionKey, PositionFlags};
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering};

/// The position a flow enters, as the code that lowers the flow knows it.
#[derive(Copy, Clone)]
pub(in crate::lower) enum Subject {
    Binding(SymbolId),
    Parameter(ParamId),
    Argument { callee: FunctionRef, index: usize },
    Member(ExprId),
    LiteralProperty,
    ClassField(MemberId),
    Result,
    Assertion,
}

#[derive(Copy, Clone)]
pub(in crate::lower) enum FlowingValue {
    Expression(ExprId),
    AssignedByPattern,
    PassedBySpread,
}

#[derive(Copy, Clone)]
pub(in crate::lower) struct FlowDescription {
    pub(super) subject: Subject,
    pub(super) value: FlowingValue,
}

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

fn parameter_text(
    file: &FileLowering<'_, '_, '_, '_>,
    function: FunctionRef,
    parameter: ParamId,
) -> Vec<u8> {
    let hir = file.queries.files().hir(function.file);
    let label = match hir[hir[parameter].pat].kind {
        PatKind::Ident(name) => Some(quoted(name_text(file, name))),
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
    if let Some(name) = function_name(file, function) {
        text.extend(concat(&[b" of ", &quoted(name)]));
    }
    text
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
        let function = FunctionRef {
            file: file.file,
            function: bound.param_fn[parameter.idx()],
        };
        return parameter_text(file, function, parameter);
    }
    quoted(name_text(file, declared.name))
}

fn member_text(file: &mut FileLowering<'_, '_, '_, '_>, access: ExprId) -> Option<Vec<u8>> {
    let (object, key) = file.hir.member_key(access)?;
    let name = match key {
        MemberKey::Name(name) | MemberKey::PrivateName(name) => name,
        MemberKey::Computed(_) => return None,
    };
    let owner = match file.queries.expression_type(object) {
        Ok(ty) => type_name(file, ty),
        Err(_) => None,
    };
    Some(property_text(name_text(file, name), owner))
}

fn literal_property_text(
    file: &mut FileLowering<'_, '_, '_, '_>,
    value: ExprId,
) -> Option<Vec<u8>> {
    let Parent::Prop(property) = file.bound.parent_of_expr(value) else {
        return None;
    };
    let PropKey::Name(name) = file.hir[property].key else {
        return None;
    };
    let literal = file.bound.prop_owner[property.idx()];
    let owner = match file.queries.contextual_type(literal) {
        Ok(Some(ty)) => type_name(file, ty),
        Ok(None) | Err(_) => None,
    };
    Some(property_text(name_text(file, name), owner))
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

fn result_text(file: &FileLowering<'_, '_, '_, '_>, function: FunctionKey) -> Vec<u8> {
    let name = match function {
        FunctionKey::Source(function) => function_name(file, function),
        _ => None,
    };
    match name {
        Some(name) => concat(&[b"The return value of ", &quoted(name)]),
        None => b"The return value".to_vec(),
    }
}

fn subject_text(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    subject: Subject,
    value: FlowingValue,
) -> Option<Vec<u8>> {
    let key = lowering.key;
    let file = &mut *lowering.file;
    match subject {
        Subject::Binding(symbol) => Some(binding_text(file, symbol)),
        Subject::Parameter(parameter) => {
            let function = FunctionRef {
                file: file.file,
                function: file.bound.param_fn[parameter.idx()],
            };
            Some(parameter_text(file, function, parameter))
        }
        Subject::Argument { callee, index } => {
            let parameters = file.queries.files().hir(callee.file)[callee.function].params;
            let parameter = parameters.iter().nth(index)?;
            Some(parameter_text(file, callee, parameter))
        }
        Subject::Member(access) => member_text(file, access),
        Subject::LiteralProperty => match value {
            FlowingValue::Expression(initializer) => literal_property_text(file, initializer),
            FlowingValue::AssignedByPattern | FlowingValue::PassedBySpread => None,
        },
        Subject::ClassField(member) => class_field_text(file, member),
        Subject::Result => Some(result_text(file, key)),
        Subject::Assertion => Some(b"This expression".to_vec()),
    }
}

fn text_of<'p>(file: &FileLowering<'_, '_, 'p, '_>, expression: ExprId) -> &'p [u8] {
    let (start, end) = range_of_node(file.hir, NodeData::Expr(expression));
    let hir = file.hir;
    hir.text
        .get(start as usize..end as usize)
        .unwrap_or_default()
}

fn tight_text(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> Vec<u8> {
    let text = text_of(file, expression);
    let is_tight = matches!(
        file.hir[expression].kind,
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

fn argument_text(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> Vec<u8> {
    let text = text_of(file, expression);
    let is_sequence = matches!(
        file.hir[expression].kind,
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

fn step_advice(file: &FileLowering<'_, '_, '_, '_>, operand: ExprId, step: &[u8]) -> Vec<u8> {
    let target = tight_text(file, operand);
    concat(&[&target, b" = (", &target, b" ", step, b" 1) | 0"])
}

/// What to write in place of the stored expression so that the value is an int32 in plain Bun too.
fn advice_text(file: &FileLowering<'_, '_, '_, '_>, stored: ExprId) -> Vec<u8> {
    match file.hir[stored].kind {
        ExprKind::Assign {
            op: Some(BinOp::Mul),
            target,
            value,
        } => {
            let (target, value) = (tight_text(file, target), argument_text(file, value));
            concat(&[&target, b" = Math.imul(", &target, b", ", &value, b")"])
        }
        ExprKind::Assign {
            op: Some(op),
            target,
            value,
        } => {
            let (target, value) = (tight_text(file, target), tight_text(file, value));
            let operator = operator_text(op);
            concat(&[
                &target, b" = (", &target, b" ", operator, b" ", &value, b") | 0",
            ])
        }
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PostInc,
            operand,
        } => step_advice(file, operand, b"+"),
        ExprKind::Unary {
            op: UnOp::PreDec | UnOp::PostDec,
            operand,
        } => step_advice(file, operand, b"-"),
        ExprKind::Binary {
            op: BinOp::Mul,
            left,
            right,
        } => {
            let (left, right) = (argument_text(file, left), argument_text(file, right));
            concat(&[b"Math.imul(", &left, b", ", &right, b")"])
        }
        ExprKind::Missing
        | ExprKind::Ident(_)
        | ExprKind::PrivateIdentifier(_)
        | ExprKind::This
        | ExprKind::Super
        | ExprKind::Null
        | ExprKind::True
        | ExprKind::False
        | ExprKind::Number(_)
        | ExprKind::String(_)
        | ExprKind::BigInt(_)
        | ExprKind::Regex { .. }
        | ExprKind::Template { .. }
        | ExprKind::TaggedTemplate(_)
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Dot { .. }
        | ExprKind::Index { .. }
        | ExprKind::Call(_)
        | ExprKind::New(_)
        | ExprKind::Unary {
            op:
                UnOp::Plus
                | UnOp::Minus
                | UnOp::BitNot
                | UnOp::Not
                | UnOp::Typeof
                | UnOp::Void
                | UnOp::Delete,
            ..
        }
        | ExprKind::Binary { .. }
        | ExprKind::Assign { op: None, .. }
        | ExprKind::Cond { .. }
        | ExprKind::Spread(_)
        | ExprKind::Await(_)
        | ExprKind::Yield { .. }
        | ExprKind::As { .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => concat(&[&tight_text(file, stored), b" | 0"]),
    }
}

fn is_any(file: &mut FileLowering<'_, '_, '_, '_>, expression: ExprId) -> bool {
    let queries = &mut *file.queries;
    let shape = queries
        .expression_type(expression)
        .and_then(|ty| queries.type_shape(ty));
    shape.is_ok_and(|shape| shape.kind == ShapeKind::Anything(AnythingReason::Any))
}

fn target_text(file: &FileLowering<'_, '_, '_, '_>, subject: Subject) -> Option<Vec<u8>> {
    match subject {
        Subject::Binding(symbol) => Some(name_text(file, file.bound.symbol(symbol).name).to_vec()),
        Subject::Member(access) => Some(text_of(file, access).to_vec()),
        _ => None,
    }
}

fn describe_value(
    file: &mut FileLowering<'_, '_, '_, '_>,
    subject: Subject,
    value: FlowingValue,
) -> Option<Int32FlowValue> {
    match value {
        FlowingValue::Expression(stored) => Some(Int32FlowValue::Expression {
            start: range_of_node(file.hir, NodeData::Expr(stored)).0,
            text: text_of(file, stored).to_vec(),
            advice: advice_text(file, stored),
            is_any: is_any(file, stored),
        }),
        FlowingValue::AssignedByPattern => {
            target_text(file, subject).map(Int32FlowValue::PatternTarget)
        }
        FlowingValue::PassedBySpread => Some(Int32FlowValue::SpreadArgument),
    }
}

/// Keeps what a message about the flow says beside the engine's reason. The request of the flow is emitted next, at the current position.
pub(super) fn record_flow(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    position: DeclaredType,
    description: FlowDescription,
) {
    if !position.flags.contains(PositionFlags::IS_INT32_PROMISE) {
        return;
    }
    let FlowDescription { subject, value } = description;
    let Some(subject_text) = subject_text(lowering, subject, value) else {
        return;
    };
    let request_position = lowering.position();
    let file = &mut *lowering.file;
    let Some(value) = describe_value(file, subject, value) else {
        return;
    };
    let site = position.site.map(|site| file.fragment.type_site(site));
    file.diagnostics.add_int32_flow(Int32Flow {
        file: file.file,
        position: request_position,
        site: site.map(|site| (site.position, site.kind)),
        subject: subject_text,
        value,
    });
}
