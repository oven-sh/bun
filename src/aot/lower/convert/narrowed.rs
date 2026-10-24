use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, PatParent, PrivateMembers, SymbolId};
use bun_sema::check::aot::{ClassRef, MemberLookup, ObjectMemberKind, ShapeKind};
use bun_sema::fold::Constant;
use bun_sema::hir::{ExprId, ExprKind, MemberKey, PatId};
use bun_sema::program::FileRole;

use crate::ir::generated::{FunctionFlags, FunctionKind, TypeSiteKind};
use crate::ir::{DeclaredType, Id, LayoutId, Mapped, PositionFlags, TypeId, TypeTable, ValueId};
use crate::lower::positions::SiteOrigin;
use crate::lower::private_names::PrivateHolder;
use crate::lower::types::has_layout_in_every_value;
use crate::lower::{CheckerTypeId, FileLowering, FunctionLowering, expression, function};

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

impl FileLowering<'_, '_, '_, '_> {
    // `X["foo"]` is `X.foo`.
    fn has_constant_key(&self, key: MemberKey) -> bool {
        match key {
            MemberKey::Name(_) | MemberKey::PrivateName(_) => true,
            MemberKey::Computed(index) => match expression::find_constant(self, index) {
                Some(Constant::String(_) | Constant::Number(_)) => true,
                Some(
                    Constant::Undefined
                    | Constant::Null
                    | Constant::Boolean(_)
                    | Constant::BigInt(_),
                )
                | None => false,
            },
        }
    }

    fn classify_member(&self, access: ExprId) -> Reference {
        let mut root = access;
        while let Some((object, key)) = self.hir.member_key(root) {
            if !self.has_constant_key(key) {
                return Reference::NotAReference;
            }
            root = self.skip_type_syntax(object);
        }
        match self.classify_reference(root) {
            Reference::Binding(_) | Reference::This | Reference::Member => Reference::Member,
            Reference::NotAReference => Reference::NotAReference,
        }
    }

    fn classify_reference(&self, expression: ExprId) -> Reference {
        match self.hir[expression].kind {
            ExprKind::Ident(_) => match self.bound.binding(expression) {
                Binding::Symbol(symbol) => Reference::Binding(symbol),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                    Reference::NotAReference
                }
            },
            ExprKind::This => Reference::This,
            ExprKind::Dot { .. } | ExprKind::Index { .. } => self.classify_member(expression),
            _ => Reference::NotAReference,
        }
    }

    // The types of the fields of a class are only expected where nobody checked the file of the class.
    fn has_typed_fields(&self, class: ClassRef) -> bool {
        match self.queries.role(class.file) {
            FileRole::Checked => true,
            FileRole::Inferred | FileRole::TypesOnly => false,
        }
    }

    fn classify_receiver_type(&mut self, ty: CheckerTypeId) -> Receiver {
        let Ok(shape) = self.queries.type_shape(ty) else {
            return Receiver::WithoutSlots;
        };
        match shape.kind {
            ShapeKind::Class(class) if !self.has_typed_fields(class) => Receiver::WithoutSlots,
            ShapeKind::Class(class) if class.file == self.file => {
                Receiver::Class(self.class_layout(class))
            }
            ShapeKind::Class(_) => Receiver::Declared,
            ShapeKind::Object if !has_layout_in_every_value(self, ty) => Receiver::WithoutSlots,
            ShapeKind::Object => match self.object_type_layout(ty) {
                Some(layout) => Receiver::ObjectType(layout),
                None => Receiver::WithoutSlots,
            },
            ShapeKind::Union(members) => {
                for &member in members {
                    match self.classify_receiver_type(member) {
                        Receiver::ObjectType(_) | Receiver::Class(_) | Receiver::Declared => {}
                        Receiver::WithoutSlots => return Receiver::WithoutSlots,
                    }
                }
                Receiver::Declared
            }
            _ => Receiver::WithoutSlots,
        }
    }

    fn find_listed_slot(&mut self, receiver: Receiver, key: MemberKey) -> Option<(LayoutId, u32)> {
        let layout = match receiver {
            Receiver::ObjectType(layout) | Receiver::Class(layout) => layout,
            Receiver::Declared | Receiver::WithoutSlots => return None,
        };
        let name = find_constant_name(self, key)?;
        let key = self.name_key(name);
        Some((layout, self.find_field(layout, key)?))
    }

    fn find_private_slot(&mut self, access: ExprId) -> Option<(LayoutId, u32)> {
        let name = self.bound.private_name_of_reference(access)?;
        let binding = self.resolve_private_name(name);
        let is_read_from_slot = match binding.members {
            PrivateMembers::Field(_) => true,
            PrivateMembers::AutoAccessor(_) => !binding.is_decorated,
            PrivateMembers::Method(_) | PrivateMembers::Accessor { .. } => false,
        };
        match binding.holder {
            PrivateHolder::Instance { layout, field } if is_read_from_slot => Some((layout, field)),
            PrivateHolder::Instance { .. } | PrivateHolder::ClassObject => None,
        }
    }

    fn map_position(&mut self, access: ExprId, ty: Option<CheckerTypeId>) -> DeclaredType {
        let Some(ty) = ty else {
            return DeclaredType::untyped();
        };
        let mapped = self.map_type_at(ty, self.hir[access].pos);
        DeclaredType::new(mapped, None, PositionFlags::default())
    }

    // What is written at a field of a class is the type of its slot, whoever inherits or instantiates the class.
    fn find_declared_position(&mut self, access: ExprId, fields_have_slots: bool) -> DeclaredType {
        match self.queries.member_access(access) {
            Ok(MemberLookup::Member(member)) => match member.kind {
                ObjectMemberKind::Method => method_position(),
                ObjectMemberKind::Field if fields_have_slots => {
                    let declared = member
                        .types
                        .written
                        .written()
                        .or_else(|| member.types.checked.ok());
                    let position = self.map_position(access, declared);
                    match member.is_optional {
                        true => self.add_undefined(position),
                        false => position,
                    }
                }
                _ => DeclaredType::untyped(),
            },
            Ok(MemberLookup::Index(signature)) => {
                self.map_position(access, signature.types.checked.ok())
            }
            Ok(MemberLookup::Absent) | Err(_) => DeclaredType::untyped(),
        }
    }

    fn find_member_position(&mut self, access: ExprId) -> DeclaredType {
        let Some((object, key)) = self.hir.member_key(access) else {
            debug_assert!(false, "a member is a Dot or an Index expression");
            return DeclaredType::untyped();
        };
        let (slot, fields_have_slots) = match key {
            MemberKey::PrivateName(_) => (self.find_private_slot(access), false),
            MemberKey::Name(_) | MemberKey::Computed(_) => {
                let receiver = self.queries.expression_type(object);
                let receiver = receiver.and_then(|receiver| self.queries.without_nullish(receiver));
                let receiver = match receiver {
                    Ok(receiver) => self.classify_receiver_type(receiver),
                    Err(_) => Receiver::WithoutSlots,
                };
                let fields_have_slots = match receiver {
                    Receiver::Class(_) | Receiver::Declared => true,
                    Receiver::ObjectType(_) | Receiver::WithoutSlots => false,
                };
                (self.find_listed_slot(receiver, key), fields_have_slots)
            }
        };
        let Some((layout, field)) = slot else {
            return self.find_declared_position(access, fields_have_slots);
        };
        if self.is_method_field(layout, field) {
            return method_position();
        }
        let position = self.field_position(layout, field);
        // What is an `int32` in the definitions seen so far may be a `number` in one that comes later or lies in another file, so each read claims the `int32` for itself.
        let is_united = self.fragment.layout_keys()[layout.index()].has_united_definitions();
        if !is_united || !position.flags.contains(PositionFlags::IS_INT32_PROMISE) {
            return position;
        }
        let ty = self.fragment.types.union(position.ty, TypeTable::NUMBER);
        let flags = position.flags.without(PositionFlags::IS_INT32_PROMISE);
        DeclaredType::new(Mapped::checked(ty), position.site, flags)
    }

    fn includes_all_of(&mut self, ty: TypeId, position: TypeId) -> bool {
        if ty == position || position == TypeTable::ANYTHING {
            return ty == position;
        }
        self.fragment.types.union(ty, position) == ty
    }

    // TypeScript gives `C.prototype` the type of the instances of `C`. The object has their methods and none of their fields: it is no instance.
    fn reads_prototype_object_of_declaration(&mut self, access: ExprId) -> bool {
        match self.hir.member_key(access) {
            Some((owner, MemberKey::Name(name))) if name == known::prototype => {
                let declaration = self.queries.constructed_declaration(self.file, owner);
                declaration.is_some()
            }
            _ => false,
        }
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
        _ => match function.flags.contains(FunctionFlags::HAS_THIS) {
            true => function.this_type,
            false => DeclaredType::untyped(),
        },
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

// Nothing narrows a method: its type names its declaration, whatever the type arguments of the receiver are.
fn method_position() -> DeclaredType {
    DeclaredType::from_compiler(TypeTable::FUNCTION)
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // The checker keeps what it knows of a member across calls and aliases, so each read has its own conversion and nothing rests on an earlier one.
    pub(in crate::lower) fn convert_narrowed_reference(
        &mut self,
        expression: ExprId,
        value: ValueId,
    ) -> ValueId {
        if !self.file.is_checked() {
            return value;
        }
        let reference = self.file.classify_reference(expression);
        // A built-in that the table resolves says more than the type the checker has for it.
        let names_resolved_builtin = match reference {
            Reference::Binding(symbol) => self.file.builtins.of_symbol(symbol).is_some(),
            Reference::This | Reference::Member | Reference::NotAReference => false,
        };
        if reference == Reference::NotAReference || names_resolved_builtin {
            return value;
        }
        if self.file.reads_prototype_object_of_declaration(expression) {
            return value;
        }
        let before = match reference {
            Reference::Binding(symbol) => self.file.binding_position(symbol),
            Reference::This => find_this_position(self),
            Reference::Member => self.file.find_member_position(expression),
            Reference::NotAReference => DeclaredType::untyped(),
        };
        // The compiler says which function, class or instance it is.
        if before.flags.contains(PositionFlags::IS_FROM_COMPILER) {
            return value;
        }
        let Ok(ty) = self.file.queries.expression_type(expression) else {
            return value;
        };
        let position = self.file.hir[expression].pos;
        let narrowed = self.file.map_type_at(ty, position);
        if self.file.includes_all_of(narrowed.ty, before.ty) {
            return value;
        }
        // The type that the receiver's type declares for a member is as much written as that of a field. What the checker concludes from the control flow is not.
        let is_declared = reference == Reference::Member
            && self.file.find_declared_member_type(expression) == Some(ty);
        let origin = is_declared.then_some(SiteOrigin {
            kind: TypeSiteKind::PropertyRead,
            position,
        });
        self.convert_narrowed(value, before.ty, narrowed, origin)
    }

    // A variable and a parameter have the type in their position, and the pattern itself makes what a rest element receives.
    pub(in crate::lower) fn convert_pattern_element(
        &mut self,
        pattern: PatId,
        value: ValueId,
    ) -> ValueId {
        if !self.file.is_checked() {
            return value;
        }
        let hir = self.file.hir;
        let parent = self.file.bound.pat_parent[pattern.idx()];
        let is_taken_out = match parent {
            PatParent::Prop(..) | PatParent::Elem(..) => !parent.has_dot_dot_dot_token(hir),
            PatParent::None | PatParent::Var(_) | PatParent::Param(_) => false,
        };
        if !is_taken_out {
            return value;
        }
        // The build proves the promise of an `int32` from what is known about the value before it enters the binding.
        match self.file.bound.initialized_binding(pattern) {
            Binding::Symbol(symbol) => {
                let flags = self.file.binding_position(symbol).flags;
                if flags.contains(PositionFlags::IS_INT32_PROMISE) {
                    return value;
                }
            }
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {}
        }
        let Ok(ty) = self.file.queries.binding_type(pattern) else {
            return value;
        };
        let taken_out = self.file.map_type_at(ty, hir[pattern].pos);
        self.convert_narrowed(value, TypeTable::ANYTHING, taken_out, None)
    }
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
            minifies_identifiers: false,
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
    fn what_has_its_declared_type_is_not_converted() {
        let methods = "class C { m(): number { return 1; } }
interface I { m(): number }
export function ofClass(c: C) { return c.m(); }
export function ofInterface(i: I) { return i.m(); }
";
        let cases = [
            (
                "probe",
                "function g() {}
export function probe() { return g; }
",
            ),
            ("ofClass", methods),
            ("ofInterface", methods),
            (
                "probe",
                "type Counts = { [name: string]: number };
export function probe(counts: Counts) { return counts.a; }
",
            ),
            (
                "probe",
                "export class C {
  x = 1;
  #y = 2;
  probe() { return this.x + this.#y; }
}
",
            ),
            (
                "Probe",
                "export class Probe {
  x: number;
  constructor() { this.x = 1; }
}
",
            ),
            (
                "probe",
                "class Base { x: number = 1; }
class Derived extends Base { y: number = 2; }
export function probe(d: Derived) { return d.x + d.y; }
",
            ),
            (
                "probe",
                "interface A { kind: 1; a: number }
interface B { kind: 2; b: number }
export function probe(node: A | B) { return node.kind; }
",
            ),
        ];
        for (function_name, source) in cases {
            let narrowed = narrowed_types(source, function_name);
            assert!(
                narrowed.is_empty(),
                "{function_name} of {source}: {narrowed:?}"
            );
        }
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
    fn int32_member_of_a_plain_object_is_converted_at_each_read() {
        let main = "/// <reference path=\"./bun-declarations.d.ts\" />
import type { int32 } from \"bun\";
interface Point { x: int32; y?: int32 }
class Pixel { x: int32 = 0; }
export function plain(point: Point) { return [point.x, point[\"x\"], point.y]; }
export function instance(pixel: Pixel) { return pixel.x; }
";
        let declarations = "declare module \"bun\" {
  type int32 = number & { readonly \"bun.int32\"?: true };
}
";
        let files = [("main.ts", main), ("bun-declarations.d.ts", declarations)];
        let int32 = Type::integers(i32::MIN.into(), i32::MAX.into());
        assert_eq!(narrowed_types_in(&files, "plain"), vec![int32; 3]);
        let narrowed = narrowed_types_in(&files, "instance");
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
