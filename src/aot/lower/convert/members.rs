use bun_sema::atom::Atom;
use bun_sema::bind::Binding;
use bun_sema::check::aot::{
    GaveUp, MemberLookup, ObjectMemberKind, PositionTypes, ShapeKind, WrittenType,
};
use bun_sema::hir::{ExprId, ExprKind, MemberKey};
use smallvec::{SmallVec, smallvec};

use super::edges::Construct;
use crate::ir::generated::TypeSiteKind;
use crate::ir::{LayoutId, ValueId};
use crate::lower::positions::{self, SiteOrigin};
use crate::lower::types::map_type_at;
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering, layouts};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum FoundKind {
    Field,
    Accessor,
    IndexSignature,
    Contents,
}

#[derive(Copy, Clone)]
struct FoundMember {
    kind: FoundKind,
    types: PositionTypes,
    is_optional: bool,
}

fn classify_lookup(lookup: Result<MemberLookup, GaveUp>) -> Option<FoundMember> {
    match lookup {
        Ok(MemberLookup::Member(member)) => Some(FoundMember {
            kind: match member.kind {
                ObjectMemberKind::Field | ObjectMemberKind::Method => FoundKind::Field,
                ObjectMemberKind::Getter
                | ObjectMemberKind::Setter
                | ObjectMemberKind::GetterAndSetter => FoundKind::Accessor,
            },
            types: member.types,
            is_optional: member.is_optional,
        }),
        Ok(MemberLookup::Index(signature)) => Some(FoundMember {
            kind: FoundKind::IndexSignature,
            types: signature.types,
            is_optional: false,
        }),
        Ok(MemberLookup::Absent) | Err(_) => None,
    }
}

fn look_up_member(file: &mut FileLowering<'_, '_, '_, '_>, access: ExprId) -> Option<FoundMember> {
    let found = resolve_member(file, access);
    let written = found.and_then(|found| found.types.written.written());
    let memo = &mut file.types.conversions.written_expressions;
    memo.insert(access, written);
    found
}

// What the type of the receiver declares for the member, whatever the checker knows of this read beyond that.
pub(super) fn find_declared_member_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    access: ExprId,
) -> Option<CheckerTypeId> {
    resolve_member(file, access)?.types.checked.ok()
}

fn resolve_member(file: &mut FileLowering<'_, '_, '_, '_>, access: ExprId) -> Option<FoundMember> {
    let (object, key) = file.hir.member_key(access)?;
    match key {
        MemberKey::Name(name) => look_up_named_member(file, access, object, name),
        MemberKey::Computed(index) => {
            let found = classify_lookup(file.queries.member_access(access));
            found.or_else(|| look_up_element(file, object, index))
        }
        MemberKey::PrivateName(_) => None,
    }
}

fn look_up_named_member(
    file: &mut FileLowering<'_, '_, '_, '_>,
    access: ExprId,
    object: ExprId,
    name: Atom,
) -> Option<FoundMember> {
    let receiver = find_written_type(file, object)
        .and_then(|receiver| file.queries.without_nullish(receiver).ok());
    if let Some(receiver) = receiver {
        let found = classify_lookup(file.queries.find_member(receiver, name));
        if found.is_some() {
            return found;
        }
    }
    classify_lookup(file.queries.member_access(access))
}

fn look_up_element(
    file: &mut FileLowering<'_, '_, '_, '_>,
    object: ExprId,
    index: ExprId,
) -> Option<FoundMember> {
    if !has_number_type(file, index) {
        return None;
    }
    let written = find_written_type(file, object);
    let written = written.and_then(|ty| find_array_element_type(file, ty));
    let checked = file.queries.expression_type(object).ok();
    let checked = checked.and_then(|ty| find_array_element_type(file, ty));
    if written.is_none() && checked.is_none() {
        return None;
    }
    Some(FoundMember {
        kind: FoundKind::Contents,
        types: PositionTypes {
            written: written.map_or(WrittenType::Unwritten, WrittenType::Written),
            checked: checked.ok_or(GaveUp::Unresolved),
        },
        is_optional: false,
    })
}

pub(in crate::lower) fn find_array_element_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    container: CheckerTypeId,
) -> Option<CheckerTypeId> {
    let container = file.queries.without_nullish(container).ok()?;
    match file.queries.type_shape(container).ok()?.kind {
        ShapeKind::Array { element, .. } => Some(element),
        ShapeKind::Constrained { base, .. } => find_array_element_type(file, base),
        ShapeKind::Anything(_)
        | ShapeKind::TypeVariable { .. }
        | ShapeKind::Never
        | ShapeKind::Undefined
        | ShapeKind::Null
        | ShapeKind::Boolean
        | ShapeKind::BooleanLiteral(_)
        | ShapeKind::Number
        | ShapeKind::NumberLiteral(_)
        | ShapeKind::NumericEnumMember(_)
        | ShapeKind::BigInt
        | ShapeKind::BigIntLiteral { .. }
        | ShapeKind::String
        | ShapeKind::StringLiteral(_)
        | ShapeKind::TemplateLiteral { .. }
        | ShapeKind::Symbol
        | ShapeKind::AnyObject
        | ShapeKind::Function(_)
        | ShapeKind::ClassConstructor(_)
        | ShapeKind::Tuple { .. }
        | ShapeKind::Builtin { .. }
        | ShapeKind::Class(_)
        | ShapeKind::Object
        | ShapeKind::Union(_) => None,
    }
}

fn has_number_type(file: &mut FileLowering<'_, '_, '_, '_>, expression: ExprId) -> bool {
    let Ok(ty) = file.queries.expression_type(expression) else {
        return false;
    };
    let mut pending: SmallVec<[CheckerTypeId; 4]> = smallvec![ty];
    while let Some(ty) = pending.pop() {
        let Ok(shape) = file.queries.type_shape(ty) else {
            return false;
        };
        match shape.kind {
            ShapeKind::Number | ShapeKind::NumberLiteral(_) | ShapeKind::NumericEnumMember(_) => {}
            ShapeKind::Union(members) => pending.extend_from_slice(members),
            ShapeKind::Constrained { base, .. } => pending.push(base),
            ShapeKind::Anything(_)
            | ShapeKind::TypeVariable { .. }
            | ShapeKind::Never
            | ShapeKind::Undefined
            | ShapeKind::Null
            | ShapeKind::Boolean
            | ShapeKind::BooleanLiteral(_)
            | ShapeKind::BigInt
            | ShapeKind::BigIntLiteral { .. }
            | ShapeKind::String
            | ShapeKind::StringLiteral(_)
            | ShapeKind::TemplateLiteral { .. }
            | ShapeKind::Symbol
            | ShapeKind::AnyObject
            | ShapeKind::Function(_)
            | ShapeKind::ClassConstructor(_)
            | ShapeKind::Array { .. }
            | ShapeKind::Tuple { .. }
            | ShapeKind::Builtin { .. }
            | ShapeKind::Class(_)
            | ShapeKind::Object => return false,
        }
    }
    true
}

pub(super) fn find_written_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<CheckerTypeId> {
    if let Some(&written) = file.types.conversions.written_expressions.get(&expression) {
        return written;
    }
    let written = compute_written_type(file, expression);
    let memo = &mut file.types.conversions.written_expressions;
    memo.insert(expression, written);
    written
}

fn compute_written_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    expression: ExprId,
) -> Option<CheckerTypeId> {
    match file.hir[expression].kind {
        ExprKind::Ident(_) => match file.bound.binding(expression) {
            Binding::Symbol(symbol) => {
                let symbol = file.queries.canonical_symbol(file.file, symbol);
                file.queries.written_variable_type(symbol).written()
            }
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        },
        ExprKind::Dot { .. } | ExprKind::Index { .. } => {
            look_up_member(file, expression)?.types.written.written()
        }
        ExprKind::Call(_) | ExprKind::New(_) | ExprKind::TaggedTemplate(_) => {
            let target = file.queries.resolved_call(expression).ok()??;
            target.result.written.written()
        }
        ExprKind::As { ty, .. } => file.queries.written_type(ty).written(),
        ExprKind::Satisfies { expr, .. }
        | ExprKind::NonNull(expr)
        | ExprKind::AsConst(expr)
        | ExprKind::Instantiation { expr, .. } => find_written_type(file, expr),
        ExprKind::Await(operand) => {
            let operand_type = find_written_type(file, operand)?;
            file.queries.awaited_type(operand_type).ok()
        }
        ExprKind::Missing
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
        | ExprKind::Array(_)
        | ExprKind::Object(_)
        | ExprKind::Fn(_)
        | ExprKind::Class(_)
        | ExprKind::Unary { .. }
        | ExprKind::Binary { .. }
        | ExprKind::Assign { .. }
        | ExprKind::Cond { .. }
        | ExprKind::Spread(_)
        | ExprKind::Yield { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportCall { .. }
        | ExprKind::ImportMeta
        | ExprKind::NewTarget(_)
        | ExprKind::JsxText(_) => None,
    }
}

// A store goes into the slot of whatever object the receiver is, so the types of the receiver say what the slot holds.
fn note_views_of_receiver(file: &mut FileLowering<'_, '_, '_, '_>, access: ExprId) {
    let Some((object, _)) = file.hir.member_key(access) else {
        return;
    };
    let Ok(receiver) = file.queries.expression_type(object) else {
        return;
    };
    let mapped = map_type_at(file, receiver, file.hir[object].pos).ty;
    let views: SmallVec<[LayoutId; 4]> = SmallVec::from_slice(&file.fragment.types.get(mapped).layouts);
    for layout in views {
        layouts::note_view(file, layout);
    }
}

pub(super) fn convert_to_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    value: ValueId,
    source: Option<ExprId>,
) -> ValueId {
    let Some(found) = look_up_member(lowering.file, access) else {
        return value;
    };
    note_views_of_receiver(lowering.file, access);
    if matches!(found.kind, FoundKind::Accessor) && found.types.written.written().is_none() {
        return value;
    }
    let kind = match found.kind {
        FoundKind::Field | FoundKind::Accessor => TypeSiteKind::Field,
        FoundKind::IndexSignature | FoundKind::Contents => TypeSiteKind::Element,
    };
    let origin = SiteOrigin {
        kind,
        position: lowering.file.hir[access].pos,
    };
    let position = positions::create_position(lowering.file, found.types, origin);
    let position = match found.is_optional {
        true => positions::add_undefined(lowering.file, position),
        false => position,
    };
    super::describe_int32_flow(lowering, position, super::Int32Subject::Member(access), source);
    super::convert(lowering, value, position, source)
}

// The slot of a field holds what the type of the field says, and an accessor returns what its getter was converted to.
// Neither a container nor an object behind an index signature says what it holds.
pub(super) fn claim_member_read(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
    value: ValueId,
) -> ValueId {
    if !lowering.file.is_checked() {
        return value;
    }
    let Some(found) = look_up_member(lowering.file, access) else {
        return value;
    };
    let construct = match found.kind {
        FoundKind::Field | FoundKind::Accessor => return value,
        FoundKind::Contents => Construct::ContentsRead,
        FoundKind::IndexSignature => Construct::IndexSignatureRead,
    };
    let types = PositionTypes {
        written: WrittenType::Unwritten,
        ..found.types
    };
    let origin = SiteOrigin {
        kind: TypeSiteKind::Element,
        position: lowering.file.hir[access].pos,
    };
    let position = positions::create_position(lowering.file, types, origin);
    // The checker leaves out the `undefined` of a name that the object lacks, and programs read such names all the time.
    let position = match found.kind {
        FoundKind::IndexSignature => positions::add_undefined(lowering.file, position),
        FoundKind::Field | FoundKind::Accessor | FoundKind::Contents => position,
    };
    super::convert_read(lowering, value, position, construct)
}
