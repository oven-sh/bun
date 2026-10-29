use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Parent, PatParent, PrivateMembers, SymbolId};
use bun_sema::check::aot::{ClassRef, MemberLookup, ObjectMemberKind, ShapeKind};
use bun_sema::fold::Constant;
use bun_sema::hir::{BinOp, ExprId, ExprKind, MemberKey, PatId, UnOp};
use bun_sema::program::FileRole;

use crate::ir::generated::{FunctionFlags, FunctionKind, TypeSiteKind};
use crate::ir::{DeclaredType, Id, LayoutId, Mapped, PositionFlags, TypeId, TypeTable, ValueId};
use crate::lower::positions::SiteOrigin;
use crate::lower::private_names::PrivateHolder;
use crate::lower::types::{has_layout_in_every_value, lists_int32, lists_only_integers};
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
    // A class of another file, whose fields have no types in this fragment, or a union of classes.
    Declared,
    // A union that has an object type among its members.
    UnionWithObjectType,
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

    // The checker narrows only references, but an `int32` member is claimed at every read, whatever the receiver is. Under a key that is no constant it is claimed where an `int32` is expected or computed with. A member whose numbers are integers without being written `int32`, as the members of a numeric enum and literals are, is claimed where an `int32` is expected of it or of what is computed with it.
    fn reads_int32_member(&mut self, access: ExprId) -> bool {
        let Some((_, key)) = self.hir.member_key(access) else {
            return false;
        };
        let Ok(ty) = self.queries.expression_type(access) else {
            return false;
        };
        let is_int32 = lists_int32(self, ty);
        (is_int32 && self.has_constant_key(key))
            || ((is_int32 || lists_only_integers(self, ty))
                && self.is_used_as_int32(access, is_int32))
    }

    fn is_expected_to_be_int32(&mut self, expression: ExprId) -> bool {
        match self.queries.contextual_type(expression) {
            Ok(Some(ty)) => lists_int32(self, ty),
            Ok(None) | Err(_) => false,
        }
    }

    // A bitwise operator makes an `int32` of any operand, and an equality says the same of any two numbers.
    fn is_used_as_int32(&mut self, expression: ExprId, is_int32: bool) -> bool {
        let hir = self.hir;
        let mut child = expression;
        loop {
            if self.is_expected_to_be_int32(child) {
                return true;
            }
            let Parent::Expr(parent) = self.bound.parent_of_expr(child) else {
                return false;
            };
            let is_computed_with = match hir[parent].kind {
                ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_)
                | ExprKind::Binary {
                    op: BinOp::And | BinOp::Or | BinOp::Nullish,
                    ..
                } => false,
                ExprKind::Cond { test, .. } if test != child => false,
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } if right == child => false,
                ExprKind::Binary {
                    op:
                        BinOp::Add
                        | BinOp::Sub
                        | BinOp::Mul
                        | BinOp::Div
                        | BinOp::Rem
                        | BinOp::Pow
                        | BinOp::Lt
                        | BinOp::Le
                        | BinOp::Gt
                        | BinOp::Ge,
                    ..
                }
                | ExprKind::Unary {
                    op: UnOp::Plus | UnOp::Minus,
                    ..
                } => true,
                ExprKind::Call(site)
                    if hir[site].callee != child
                        && self
                            .builtins
                            .builtin_of_expression(hir[site].callee)
                            .is_some() =>
                {
                    true
                }
                _ => return false,
            };
            if is_computed_with && is_int32 {
                return true;
            }
            child = parent;
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
                let mut union = Receiver::Declared;
                for &member in members {
                    match self.classify_receiver_type(member) {
                        Receiver::ObjectType(_) | Receiver::UnionWithObjectType => {
                            union = Receiver::UnionWithObjectType;
                        }
                        Receiver::Class(_) | Receiver::Declared => {}
                        Receiver::WithoutSlots => return Receiver::WithoutSlots,
                    }
                }
                union
            }
            _ => Receiver::WithoutSlots,
        }
    }

    fn find_listed_slot(&mut self, receiver: Receiver, key: MemberKey) -> Option<(LayoutId, u32)> {
        let layout = match receiver {
            Receiver::ObjectType(layout) | Receiver::Class(layout) => layout,
            Receiver::Declared | Receiver::UnionWithObjectType | Receiver::WithoutSlots => {
                return None;
            }
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
    fn find_declared_position(
        &mut self,
        access: ExprId,
        receiver: Receiver,
        is_receiver_converted: bool,
    ) -> DeclaredType {
        let fields_have_slots = match receiver {
            Receiver::Class(_) | Receiver::Declared | Receiver::UnionWithObjectType => true,
            Receiver::ObjectType(_) | Receiver::WithoutSlots => false,
        };
        match self.queries.member_access(access) {
            Ok(MemberLookup::Member(member)) => match member.kind {
                ObjectMemberKind::Method => method_position(),
                ObjectMemberKind::Field if fields_have_slots => {
                    let declared = member
                        .types
                        .written
                        .written()
                        .or_else(|| member.types.checked.ok());
                    let mut position = self.map_position(access, declared);
                    let is_int32 = declared.is_some_and(|declared| lists_int32(self, declared));
                    let has_int32_slot =
                        is_receiver_converted && receiver != Receiver::UnionWithObjectType;
                    if !has_int32_slot {
                        position = self.widen_integers(access, position, is_int32);
                    }
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

    fn find_member_position(
        &mut self,
        access: ExprId,
        is_receiver_converted: bool,
    ) -> DeclaredType {
        let Some((object, key)) = self.hir.member_key(access) else {
            debug_assert!(false, "a member is a Dot or an Index expression");
            return DeclaredType::untyped();
        };
        let (slot, receiver) = match key {
            MemberKey::PrivateName(_) => (self.find_private_slot(access), Receiver::WithoutSlots),
            MemberKey::Name(_) | MemberKey::Computed(_) => {
                let receiver = self.queries.expression_type(object);
                let receiver = receiver.and_then(|receiver| self.queries.without_nullish(receiver));
                let receiver = match receiver {
                    Ok(receiver) => self.classify_receiver_type(receiver),
                    Err(_) => Receiver::WithoutSlots,
                };
                (self.find_listed_slot(receiver, key), receiver)
            }
        };
        let Some((layout, field)) = slot else {
            return self.find_declared_position(access, receiver, is_receiver_converted);
        };
        if self.is_method_field(layout, field) {
            return method_position();
        }
        let position = self.field_position(layout, field);
        let is_united = self.fragment.layout_keys()[layout.index()].has_united_definitions();
        let has_int32_slot = is_receiver_converted && !is_united;
        if has_int32_slot {
            return position;
        }
        let is_int32 = position.flags.contains(PositionFlags::IS_INT32_PROMISE);
        self.widen_integers(access, position, is_int32)
    }

    // What is an integer in the object types seen so far may be any number in one that comes later or lies in another file, and a receiver that nothing converted may be any object. Each such read of an `int32` claims it for itself, and so does a read of other integers where an `int32` is expected of it or of what is computed with it.
    fn widen_integers(
        &mut self,
        access: ExprId,
        position: DeclaredType,
        is_int32: bool,
    ) -> DeclaredType {
        let has_integers = self.fragment.types.get(position.ty).integer_range();
        if !is_int32 && !(has_integers.is_some() && self.is_used_as_int32(access, false)) {
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
        let mut reference = self.file.classify_reference(expression);
        // Only the parts of a reference are converted to their types.
        let is_receiver_converted = reference != Reference::NotAReference;
        if !is_receiver_converted && self.file.reads_int32_member(expression) {
            reference = Reference::Member;
        }
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
            Reference::Member => self
                .file
                .find_member_position(expression, is_receiver_converted),
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
            obfuscates: false,
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
interface Named { x: int32; name: string }
class Pixel { x: int32 = 0; }
class Screen { get corner(): Pixel { return new Pixel(); } }
export function plain(point: Point) { return [point.x, point[\"x\"], point.y]; }
export function unnamed(make: () => Point, list: Point[], at: number) { return [make().x, list[at].x, (at ? make() : list[0]).y]; }
export function either(value: Point | Named, other: Point | Pixel | null) { return [value.x, other?.x]; }
export function instance(pixel: Pixel) { return pixel.x; }
export function unnamedInstance(make: () => Pixel) { return [make().x, new Screen().corner.x]; }
export function counted(make: () => Record<string, int32>, list: int32[], name: string, at: number) { return [make().absent, make()[name], list[at]]; }
export function byKey(pixel: Pixel, point: Point, key: \"x\" | \"y\", only: keyof Pixel): int32 { const kept: int32 = pixel[only]; return point[key] ?? kept; }
export function byKeyAsNumber(pixel: Pixel, only: keyof Pixel) { return pixel[only] & 1; }
";
        let declarations = "declare module \"bun\" {
  type int32 = number & { readonly \"bun.int32\"?: true };
}
";
        let files = [("main.ts", main), ("bun-declarations.d.ts", declarations)];
        let int32 = Type::integers(i32::MIN.into(), i32::MAX.into());
        assert_eq!(narrowed_types_in(&files, "plain"), vec![int32.clone(); 3]);
        assert_eq!(narrowed_types_in(&files, "unnamed"), vec![int32.clone(); 3]);
        assert_eq!(narrowed_types_in(&files, "either"), vec![int32.clone(); 2]);
        assert_eq!(
            narrowed_types_in(&files, "unnamedInstance"),
            vec![int32.clone(); 2]
        );
        assert_eq!(narrowed_types_in(&files, "byKey"), vec![int32; 2]);
        for function_name in ["instance", "counted", "byKeyAsNumber"] {
            let narrowed = narrowed_types_in(&files, function_name);
            assert!(narrowed.is_empty(), "{function_name}: {narrowed:?}");
        }
    }

    #[test]
    fn member_whose_numbers_are_integers_is_converted_where_an_int32_is_expected() {
        let main = "/// <reference path=\"./bun-declarations.d.ts\" />
import type { int32 } from \"bun\";
enum Color { Red, Green, Blue }
const enum Side { Left = 1, Right = 2 }
interface Holder { color: Color; side?: Side; level: 1 | 2 | 3 }
class Pixel { color: Color = Color.Red; }
export function plain(holder: Holder): int32 { const kept: int32 = holder.color; return holder[\"side\"] ?? kept; }
export function computed(holder: Holder): int32 { return -holder.level + 1; }
export function unnamed(make: () => Holder, list: Holder[]): int32 { const kept: int32 = make().color; return list[kept].level; }
export function either(value: Holder | Pixel): int32 { return value.color; }
export function unnamedInstance(make: () => Pixel): int32 { return make().color; }
export function instance(pixel: Pixel): int32 { return pixel.color; }
export function unused(holder: Holder, make: () => Holder, value: Holder | Pixel) { return [holder.color, holder.level === 1, holder.color & 1, make().color, value.color, holder.level + 1, make().level < 2, Math.min(value.color, 1)]; }
export function fractions(holder: { ratio: 0.5 | 1; zero: 0 | 1; size: number }) { return holder.ratio + holder.zero + holder.size; }
";
        let declarations = "declare module \"bun\" {
  type int32 = number & { readonly \"bun.int32\"?: true };
}
";
        let files = [("main.ts", main), ("bun-declarations.d.ts", declarations)];
        let int32 = Type::integers(i32::MIN.into(), i32::MAX.into());
        let level = Type::integers(1, 3);
        assert_eq!(narrowed_types_in(&files, "plain"), vec![int32.clone(); 2]);
        assert_eq!(narrowed_types_in(&files, "computed"), [level.clone()]);
        assert_eq!(narrowed_types_in(&files, "unnamed"), [int32.clone(), level]);
        assert_eq!(narrowed_types_in(&files, "either"), [int32.clone()]);
        assert_eq!(narrowed_types_in(&files, "unnamedInstance"), [int32]);
        for function_name in ["instance", "unused", "fractions"] {
            let narrowed = narrowed_types_in(&files, function_name);
            assert!(narrowed.is_empty(), "{function_name}: {narrowed:?}");
        }
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
