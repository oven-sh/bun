use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, PatParent, PrivateMembers, SymbolId};
use bun_sema::check::aot::{ClassRef, MemberLookup, ObjectMemberKind, ShapeKind};
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, ExprKind, MemberKey, PatId};
use bun_sema::program::FileRole;

use super::members;
use crate::ir::generated::{FunctionFlags, FunctionKind, TypeSiteKind};
use crate::ir::{DeclaredType, LayoutId, PositionFlags, TypeId, TypeTable, ValueId};
use crate::lower::positions::SiteOrigin;
use crate::lower::private_names::{self, PrivateHolder};
use crate::lower::types::{has_layout_in_every_value, map_type_at};
use crate::lower::{
    CheckerTypeId, FileLowering, FunctionLowering, expression, function, layouts, member, positions,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Reference {
    Binding(SymbolId),
    This,
    Member,
    NotAReference,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Receiver {
    // The layout lists every member that has a slot.
    ObjectType(LayoutId),
    // A class of this file. The layout lists the fields that the class itself declares.
    Class(LayoutId),
    // A class of another file, whose fields have no types in this fragment, or a union of classes and object types.
    Declared,
    WithoutSlots,
}

#[derive(Copy, Clone)]
struct Slot {
    layout: LayoutId,
    field: u32,
}

// `X["foo"]` is `X.foo`.
fn has_constant_key(file: &FileLowering<'_, '_, '_, '_>, key: MemberKey) -> bool {
    match key {
        MemberKey::Name(_) | MemberKey::PrivateName(_) => true,
        MemberKey::Computed(index) => match expression::find_constant(file, index) {
            Some(Constant::String(_) | Constant::Number(_)) => true,
            Some(
                Constant::Undefined | Constant::Null | Constant::Boolean(_) | Constant::BigInt(_),
            )
            | None => false,
        },
    }
}

fn classify_member(file: &FileLowering<'_, '_, '_, '_>, access: ExprId) -> Reference {
    let mut root = access;
    while let Some((object, key)) = file.hir.member_key(root) {
        if !has_constant_key(file, key) {
            return Reference::NotAReference;
        }
        root = expression::skip_type_syntax(file, object);
    }
    match classify_reference(file, root) {
        Reference::Binding(_) | Reference::This | Reference::Member => Reference::Member,
        Reference::NotAReference => Reference::NotAReference,
    }
}

fn classify_reference(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> Reference {
    match file.hir[expression].kind {
        ExprKind::Ident(_) => match file.bound.binding(expression) {
            Binding::Symbol(symbol) => Reference::Binding(symbol),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                Reference::NotAReference
            }
        },
        ExprKind::This => Reference::This,
        ExprKind::Dot { .. } | ExprKind::Index { .. } => classify_member(file, expression),
        ExprKind::Missing
        | ExprKind::PrivateIdentifier(_)
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
        | ExprKind::Call(_)
        | ExprKind::New(_)
        | ExprKind::Unary { .. }
        | ExprKind::Binary { .. }
        | ExprKind::Assign { .. }
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
        | ExprKind::JsxText(_) => Reference::NotAReference,
    }
}

// A built-in that the table resolves says more than the type the checker has for it.
fn names_resolved_builtin(file: &FileLowering<'_, '_, '_, '_>, reference: Reference) -> bool {
    match reference {
        Reference::Binding(symbol) => file.builtins.of_symbol(symbol).is_some(),
        Reference::This | Reference::Member | Reference::NotAReference => false,
    }
}

fn find_this_position(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>) -> DeclaredType {
    if let Some(position) = function::find_this_position(lowering) {
        return position;
    }
    let function = lowering.builder.function();
    match function.kind {
        // The constructor made it.
        FunctionKind::BaseConstructor | FunctionKind::DerivedConstructor => {
            DeclaredType::from_compiler(TypeTable::OBJECT)
        }
        FunctionKind::Plain
        | FunctionKind::Arrow
        | FunctionKind::Method
        | FunctionKind::Getter
        | FunctionKind::Setter
        | FunctionKind::Initializer
        | FunctionKind::Module
        | FunctionKind::CommonJsModule => match function.flags.contains(FunctionFlags::HAS_THIS) {
            true => function.this_type,
            false => DeclaredType::untyped(),
        },
    }
}

// The types of the fields of a class are only expected where nobody checked the file of the class.
fn has_typed_fields(file: &FileLowering<'_, '_, '_, '_>, class: ClassRef) -> bool {
    match file.queries.role(class.file) {
        FileRole::Checked => true,
        FileRole::Inferred | FileRole::TypesOnly => false,
    }
}

fn classify_receiver_type(file: &mut FileLowering<'_, '_, '_, '_>, ty: CheckerTypeId) -> Receiver {
    let Ok(shape) = file.queries.type_shape(ty) else {
        return Receiver::WithoutSlots;
    };
    match shape.kind {
        ShapeKind::Class(class) if !has_typed_fields(file, class) => Receiver::WithoutSlots,
        ShapeKind::Class(class) if class.file == file.file => {
            Receiver::Class(layouts::class_layout(file, class))
        }
        ShapeKind::Class(_) => Receiver::Declared,
        ShapeKind::Object if !has_layout_in_every_value(file, ty) => Receiver::WithoutSlots,
        ShapeKind::Object => match layouts::object_type_layout(file, ty) {
            Some(layout) => Receiver::ObjectType(layout),
            None => Receiver::WithoutSlots,
        },
        ShapeKind::Union(members) => {
            let has_slots_in_every_member =
                members
                    .iter()
                    .all(|&member| match classify_receiver_type(file, member) {
                        Receiver::ObjectType(_) | Receiver::Class(_) | Receiver::Declared => true,
                        Receiver::WithoutSlots => false,
                    });
            match has_slots_in_every_member {
                true => Receiver::Declared,
                false => Receiver::WithoutSlots,
            }
        }
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
        | ShapeKind::Array { .. }
        | ShapeKind::Tuple { .. }
        | ShapeKind::Builtin { .. }
        | ShapeKind::Constrained { .. } => Receiver::WithoutSlots,
    }
}

fn classify_receiver(file: &mut FileLowering<'_, '_, '_, '_>, object: ExprId) -> Receiver {
    let receiver = file.queries.expression_type(object);
    match receiver.and_then(|receiver| file.queries.without_nullish(receiver)) {
        Ok(receiver) => classify_receiver_type(file, receiver),
        Err(_) => Receiver::WithoutSlots,
    }
}

fn find_constant_name(file: &FileLowering<'_, '_, '_, '_>, key: MemberKey) -> Option<Atom> {
    match key {
        MemberKey::Name(name) => Some(name),
        MemberKey::PrivateName(_) => None,
        MemberKey::Computed(index) => match expression::find_constant(file, index) {
            Some(Constant::String(name)) => Some(name),
            Some(
                Constant::Undefined
                | Constant::Null
                | Constant::Boolean(_)
                | Constant::Number(_)
                | Constant::BigInt(_),
            )
            | None => None,
        },
    }
}

fn find_listed_slot(
    file: &mut FileLowering<'_, '_, '_, '_>,
    receiver: Receiver,
    key: MemberKey,
) -> Option<Slot> {
    let layout = match receiver {
        Receiver::ObjectType(layout) | Receiver::Class(layout) => layout,
        Receiver::Declared | Receiver::WithoutSlots => return None,
    };
    let name = find_constant_name(file, key)?;
    let key = member::name_key(file, name);
    let field = layouts::find_field(file, layout, key)?;
    Some(Slot { layout, field })
}

fn find_private_slot(file: &mut FileLowering<'_, '_, '_, '_>, access: ExprId) -> Option<Slot> {
    let name = file.bound.private_name_of_reference(access)?;
    let binding = private_names::resolve_private_name(file, name);
    let is_read_from_slot = match binding.members {
        PrivateMembers::Field(_) => true,
        PrivateMembers::AutoAccessor(_) => !binding.is_decorated,
        PrivateMembers::Method(_) | PrivateMembers::Accessor { .. } => false,
    };
    match binding.holder {
        PrivateHolder::Instance { layout, field } if is_read_from_slot => {
            Some(Slot { layout, field })
        }
        PrivateHolder::Instance { .. } | PrivateHolder::ClassObject => None,
    }
}

// Nothing narrows a method: its type names its declaration, whatever the type arguments of the receiver are.
fn method_position() -> DeclaredType {
    DeclaredType::from_compiler(TypeTable::FUNCTION)
}

fn map_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    access: ExprId,
    ty: Option<CheckerTypeId>,
) -> DeclaredType {
    let Some(ty) = ty else {
        return DeclaredType::untyped();
    };
    let mapped = map_type_at(file, ty, file.hir[access].pos);
    DeclaredType::new(mapped, None, PositionFlags::default())
}

// What is written at a field of a class is the type of its slot, whoever inherits or instantiates the class.
fn find_declared_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    access: ExprId,
    fields_have_slots: bool,
) -> DeclaredType {
    match file.queries.member_access(access) {
        Ok(MemberLookup::Member(member)) => match member.kind {
            ObjectMemberKind::Method => method_position(),
            ObjectMemberKind::Field if fields_have_slots => {
                let declared = member
                    .types
                    .written
                    .written()
                    .or_else(|| member.types.checked.ok());
                let position = map_position(file, access, declared);
                match member.is_optional {
                    true => positions::add_undefined(file, position),
                    false => position,
                }
            }
            ObjectMemberKind::Field
            | ObjectMemberKind::Getter
            | ObjectMemberKind::Setter
            | ObjectMemberKind::GetterAndSetter => DeclaredType::untyped(),
        },
        Ok(MemberLookup::Index(signature)) => {
            map_position(file, access, signature.types.checked.ok())
        }
        Ok(MemberLookup::Absent) | Err(_) => DeclaredType::untyped(),
    }
}

fn find_member_position(file: &mut FileLowering<'_, '_, '_, '_>, access: ExprId) -> DeclaredType {
    let Some((object, key)) = file.hir.member_key(access) else {
        debug_assert!(false, "a member is a Dot or an Index expression");
        return DeclaredType::untyped();
    };
    let (slot, fields_have_slots) = match key {
        MemberKey::PrivateName(_) => (find_private_slot(file, access), false),
        MemberKey::Name(_) | MemberKey::Computed(_) => {
            let receiver = classify_receiver(file, object);
            let fields_have_slots = match receiver {
                Receiver::Class(_) | Receiver::Declared => true,
                Receiver::ObjectType(_) | Receiver::WithoutSlots => false,
            };
            (find_listed_slot(file, receiver, key), fields_have_slots)
        }
    };
    let Some(slot) = slot else {
        return find_declared_position(file, access, fields_have_slots);
    };
    match layouts::is_method_field(file, slot.layout, slot.field) {
        true => method_position(),
        false => layouts::field_position(file, slot.layout, slot.field),
    }
}

// The position that the reference reads. It is untyped where nothing holds what is read to a type.
fn find_position_before_narrowing(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    reference: Reference,
) -> DeclaredType {
    match reference {
        Reference::Binding(symbol) => positions::binding_position(lowering.file, symbol),
        Reference::This => find_this_position(lowering),
        Reference::Member => find_member_position(lowering.file, expression),
        Reference::NotAReference => DeclaredType::untyped(),
    }
}

// A type that lists all that the position lists adds nothing to it.
fn includes_all_of(file: &mut FileLowering<'_, '_, '_, '_>, ty: TypeId, position: TypeId) -> bool {
    if ty == position || position == TypeTable::ANYTHING {
        return ty == position;
    }
    file.fragment.types.union(ty, position) == ty
}

// The checker keeps what it knows of a member across calls and aliases, so each read has its own conversion and nothing rests on an earlier one.
pub(in crate::lower) fn convert_narrowed_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
    value: ValueId,
) -> ValueId {
    if !lowering.file.is_checked() {
        return value;
    }
    let reference = classify_reference(lowering.file, expression);
    if reference == Reference::NotAReference || names_resolved_builtin(lowering.file, reference) {
        return value;
    }
    let before = find_position_before_narrowing(lowering, expression, reference);
    // The compiler says which function, class or instance it is.
    if before.flags.contains(PositionFlags::IS_FROM_COMPILER) {
        return value;
    }
    let Ok(ty) = lowering.file.queries.expression_type(expression) else {
        return value;
    };
    let position = lowering.file.hir[expression].pos;
    let narrowed = map_type_at(lowering.file, ty, position);
    if includes_all_of(lowering.file, narrowed.ty, before.ty) {
        return value;
    }
    // The type that the receiver's type declares for a member is as much written as that of a field. What the checker concludes from the control flow is not.
    let is_declared = reference == Reference::Member
        && members::find_declared_member_type(lowering.file, expression) == Some(ty);
    let origin = is_declared.then_some(SiteOrigin {
        kind: TypeSiteKind::PropertyRead,
        position,
    });
    super::convert_narrowed(lowering, value, before.ty, narrowed, origin)
}

// The build proves the promise from what is known about the value before it enters the binding.
fn is_int32_promise(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, pattern: PatId) -> bool {
    match lowering.file.bound.initialized_binding(pattern) {
        Binding::Symbol(symbol) => positions::binding_position(lowering.file, symbol)
            .flags
            .contains(PositionFlags::IS_INT32_PROMISE),
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
    }
}

// A variable and a parameter have the type in their position, and the pattern itself makes what a rest element receives.
pub(in crate::lower) fn convert_pattern_element(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    pattern: PatId,
    value: ValueId,
) -> ValueId {
    if !lowering.file.is_checked() {
        return value;
    }
    let hir = lowering.file.hir;
    let parent = lowering.file.bound.pat_parent[pattern.idx()];
    let is_taken_out = match parent {
        PatParent::Prop(..) | PatParent::Elem(..) => !parent.has_dot_dot_dot_token(hir),
        PatParent::None | PatParent::Var(_) | PatParent::Param(_) => false,
    };
    if !is_taken_out || is_int32_promise(lowering, pattern) {
        return value;
    }
    let Ok(ty) = lowering.file.queries.binding_type(pattern) else {
        return value;
    };
    let taken_out = map_type_at(lowering.file, ty, hir[pattern].pos);
    super::convert_narrowed(lowering, value, TypeTable::ANYTHING, taken_out, None)
}

#[cfg(test)]
mod tests {
    use crate::compile::testing::lower_program;
    use crate::ir::generated::{IllTypedCause, TypeSiteKind};
    use crate::ir::{DeclaredType, Id, Opcode, Primitives, Type};
    use crate::load::host_platform;
    use crate::lower::LoweringOptions;

    #[track_caller]
    fn narrowed_types_in(files: &[(&str, &str)], function_name: &str) -> Vec<Type> {
        let options = LoweringOptions {
            platform: host_platform(),
            embeds_function_text: false,
            reports_type_mismatches: false,
            removable: Default::default(),
        };
        let lowered = lower_program(files, options);
        let fragments = lowered.iter().map(|(_, lowered)| &lowered.fragment);
        let mut functions = fragments.flat_map(|fragment| {
            let functions = fragment.functions.iter();
            functions.map(move |(_, function)| (fragment, function))
        });
        let found = functions.find(|(fragment, function)| {
            let name = function.name.map(|name| fragment.strings.get(name));
            name == Some(function_name.as_bytes())
        });
        let (fragment, function) = found.expect("the program defines the function");
        let values = function.body.blocks().flat_map(|block| block.values());
        values
            .filter(|value| value.opcode == Opcode::Convert)
            .filter(|value| {
                let cause = value.fields.get(1 + DeclaredType::WORDS).copied();
                cause == Some(IllTypedCause::Assertion.to_wire())
            })
            .filter_map(|value| DeclaredType::from_words(&value.fields[1..]))
            .filter(|declared| {
                let kind = declared
                    .site
                    .map(|site| fragment.type_sites[site.index()].kind);
                matches!(kind, None | Some(TypeSiteKind::PropertyRead))
            })
            .map(|declared| {
                let mut ty = fragment.types.get(declared.ty).clone();
                ty.primitives = ty.primitives.without(Primitives::NULLISH);
                ty
            })
            .collect()
    }

    #[track_caller]
    fn narrowed_types(source: &str, function_name: &str) -> Vec<Type> {
        narrowed_types_in(&[("main.ts", source)], function_name)
    }

    #[test]
    fn function_binding_is_not_converted() {
        let source = "function g() {}
export function probe() { return g; }
";
        let narrowed = narrowed_types(source, "probe");
        assert!(narrowed.is_empty(), "{narrowed:?}");
    }

    #[test]
    fn called_method_is_not_converted() {
        let source = "class C { m(): number { return 1; } }
interface I { m(): number }
export function ofClass(c: C) { return c.m(); }
export function ofInterface(i: I) { return i.m(); }
";
        for function_name in ["ofClass", "ofInterface"] {
            let narrowed = narrowed_types(source, function_name);
            assert!(narrowed.is_empty(), "{function_name}: {narrowed:?}");
        }
    }

    #[test]
    fn read_through_index_signature_is_not_converted_again() {
        let source = "type Counts = { [name: string]: number };
export function probe(counts: Counts) { return counts.a; }
";
        let narrowed = narrowed_types(source, "probe");
        assert!(narrowed.is_empty(), "{narrowed:?}");
    }

    #[test]
    fn receiver_and_fields_with_their_declared_types_are_not_converted() {
        let source = "export class C {
  x = 1;
  #y = 2;
  probe() { return this.x + this.#y; }
}
";
        let narrowed = narrowed_types(source, "probe");
        assert!(narrowed.is_empty(), "{narrowed:?}");
    }

    #[test]
    fn instance_in_its_constructor_is_not_converted() {
        let source = "export class Probe {
  x: number;
  constructor() { this.x = 1; }
}
";
        let narrowed = narrowed_types(source, "Probe");
        assert!(narrowed.is_empty(), "{narrowed:?}");
    }

    #[test]
    fn inherited_field_with_its_declared_type_is_not_converted() {
        let source = "class Base { x: number = 1; }
class Derived extends Base { y: number = 2; }
export function probe(d: Derived) { return d.x + d.y; }
";
        let narrowed = narrowed_types(source, "probe");
        assert!(narrowed.is_empty(), "{narrowed:?}");
    }

    #[test]
    fn inherited_field_typed_by_a_type_parameter_is_converted() {
        let source = "class Store<T> { constructor(public held: T) {} }
class Numbers extends Store<number> {}
export function probe(numbers: Numbers) { return numbers.held + 1; }
";
        let narrowed = narrowed_types(source, "probe");
        assert_eq!(narrowed, [Type::primitives(Primitives::NUMBER)]);
    }

    #[test]
    fn field_of_a_class_of_another_file_is_not_converted() {
        let main = "import { C } from \"./c\";
export function probe(c: C) { return c.x + 1; }
";
        let files = [
            ("main.ts", main),
            ("c.ts", "export class C { x: number = 1; }\n"),
        ];
        let narrowed = narrowed_types_in(&files, "probe");
        assert!(narrowed.is_empty(), "{narrowed:?}");
    }

    #[test]
    fn field_of_a_union_with_its_declared_type_is_not_converted() {
        let source = "interface A { kind: 1; a: number }
interface B { kind: 2; b: number }
export function probe(node: A | B) { return node.kind; }
";
        let narrowed = narrowed_types(source, "probe");
        assert!(narrowed.is_empty(), "{narrowed:?}");
    }

    #[test]
    fn rest_element_is_not_converted() {
        let source = "export function probe(o: { a: number; b: string }) {
  const { a, ...rest } = o;
  return [a, rest];
}
";
        let narrowed = narrowed_types(source, "probe");
        assert_eq!(narrowed, [Type::primitives(Primitives::NUMBER)]);
    }
}
