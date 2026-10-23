use bun_sema::bind::FnOwner;
use bun_sema::check::aot::{
    ClassRef, FunctionRef, GaveUp, PositionTypes, SignatureParameter, SignatureShape, WrittenType,
};
use bun_sema::hir::{ClassId, Flags, FnId, Member, MemberId, MemberKind};

use super::{FunctionPositions, SiteOrigin, add_type_site, add_undefined, create_position};
use crate::ir::generated::TypeSiteKind;
use crate::ir::{ContentsSlot, DeclaredType, Mapped, PositionFlags, Type, TypeId, TypeTable};
use crate::lower::types::find_contents_type;
use crate::lower::{FileLowering, layouts};

pub(super) fn compute_function_positions(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> FunctionPositions {
    let func = file.hir[function];
    let source = FunctionRef {
        file: file.file,
        function,
    };
    if file.inputs.library_functions.is_left_out(source) {
        let untyped = DeclaredType::untyped();
        return FunctionPositions {
            this: untyped,
            parameters: vec![untyped; func.params.len()],
            result: untyped,
            returned: untyped,
            yielded: untyped,
        };
    }
    let shape = file.queries.function_signature(source);
    let parameters = compute_parameter_positions(file, function, &shape);
    let this = compute_this_position(file, function, &shape);
    let result_origin = SiteOrigin {
        kind: TypeSiteKind::Result,
        position: func.start,
    };
    let result = create_position(file, shape.result, result_origin);
    let is_async = func.flags.contains(Flags::ASYNC);
    let is_generator = func.flags.contains(Flags::GENERATOR);
    let (returned, yielded) = match (is_async, is_generator) {
        (false, false) => (result, DeclaredType::untyped()),
        (true, false) => {
            let awaited = get_awaited_types(file, shape.result);
            let returned = create_awaited_position(file, awaited, result_origin);
            (returned, DeclaredType::untyped())
        }
        (false, true) | (true, true) => {
            let contents = get_contents_types(file, shape.result, ContentsSlot::Element);
            let yielded = create_position(file, contents, result_origin);
            (DeclaredType::untyped(), yielded)
        }
    };
    FunctionPositions {
        this,
        parameters,
        result,
        returned,
        yielded,
    }
}

pub(super) fn compute_class_this_type(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassRef,
    member: Option<MemberId>,
) -> DeclaredType {
    let hir = file.queries.files().hir(class.file);
    let member = member.map(|member| &hir[member]);
    let is_receiver_known = member.is_none_or(has_known_receiver);
    if member.is_some_and(is_static_member) {
        return match is_receiver_known {
            true => DeclaredType::from_compiler(TypeTable::FUNCTION),
            false => expect_type(TypeTable::FUNCTION),
        };
    }
    let layout = layouts::class_layout(file, class);
    let instance = file.fragment.types.intern(Type::layout(layout));
    match member {
        Some(member) if !is_receiver_known => {
            let is_written_here = class.file == file.file && member.func.is_some();
            let position = is_written_here.then(|| hir[member.func].start);
            create_receiver_position(file, instance, position)
        }
        Some(_) | None => DeclaredType::from_compiler(instance),
    }
}

fn compute_parameter_positions(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    shape: &SignatureShape<'_>,
) -> Vec<DeclaredType> {
    let hir = file.hir;
    let parameters = hir[function].params;
    let mut positions = Vec::with_capacity(parameters.len());
    for (index, parameter) in parameters.iter().enumerate() {
        let position = match shape.parameters.get(index) {
            Some(entry) => {
                let origin = SiteOrigin {
                    kind: TypeSiteKind::Parameter,
                    position: hir[hir[parameter].pat].pos,
                };
                create_parameter_position(file, entry, origin)
            }
            None => DeclaredType::untyped(),
        };
        positions.push(position);
    }
    positions
}

// An argument that is left out arrives as `undefined`, before the default value takes its place.
fn create_parameter_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    parameter: &SignatureParameter,
    origin: SiteOrigin,
) -> DeclaredType {
    let position = create_position(file, parameter.types, origin);
    match parameter.is_optional {
        true => add_undefined(file, position),
        false => position,
    }
}

fn compute_this_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    shape: &SignatureShape<'_>,
) -> DeclaredType {
    let func = file.hir[function];
    let source = FunctionRef {
        file: file.file,
        function,
    };
    if func.this_param.is_some() {
        // `new` and the constructors below bring what the function makes, not everything that fits the written type.
        if file.queries.is_prototype_object_used(source)
            && let Some(layout) = layouts::constructor_function_layout(file, source)
        {
            let instance = file.fragment.types.intern(Type::layout(layout));
            return create_receiver_position(file, instance, Some(file.hir[func.this_param].pos));
        }
        let origin = SiteOrigin {
            kind: TypeSiteKind::This,
            position: file.hir[func.this_param].pos,
        };
        return create_position(file, shape.this_type, origin);
    }
    if let Some((class, member)) = find_class_member(file, function) {
        let class = ClassRef {
            file: file.file,
            class,
        };
        return compute_class_this_type(file, class, Some(member));
    }
    if let Some(layout) = layouts::constructor_function_layout(file, source) {
        let instance = file.fragment.types.intern(Type::layout(layout));
        return create_receiver_position(file, instance, Some(func.start));
    }
    // Nobody wrote it, so no entry tests it.
    match super::choose_source(file, shape.this_type, None) {
        Some(source) => expect_type(source.mapped.ty),
        None => DeclaredType::untyped(),
    }
}

fn find_class_member(
    file: &FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> Option<(ClassId, MemberId)> {
    match file.bound.fns[function.idx()].owner {
        FnOwner::Member(member) => Some((file.bound.member_class(member)?, member)),
        FnOwner::None | FnOwner::Expr(_) | FnOwner::Stmt(_) | FnOwner::Type(_) => None,
    }
}

fn is_static_member(member: &Member) -> bool {
    match member.kind {
        MemberKind::StaticBlock => true,
        MemberKind::Property
        | MemberKind::Method
        | MemberKind::Getter
        | MemberKind::Setter
        | MemberKind::Constructor
        | MemberKind::CallSignature
        | MemberKind::ConstructSignature
        | MemberKind::IndexSignature => member.flags.contains(Flags::STATIC),
    }
}

fn has_known_receiver(member: &Member) -> bool {
    match member.kind {
        MemberKind::Property | MemberKind::StaticBlock => true,
        // `static constructor() {}` is a static method.
        MemberKind::Constructor => !member.flags.contains(Flags::STATIC),
        MemberKind::Method
        | MemberKind::Getter
        | MemberKind::Setter
        | MemberKind::CallSignature
        | MemberKind::ConstructSignature
        | MemberKind::IndexSignature => false,
    }
}

fn expect_type(ty: TypeId) -> DeclaredType {
    DeclaredType::new(Mapped::expected(ty), None, PositionFlags::default())
}

// Whoever holds a method can call it on anything, so the entry tests `this` like a parameter. It tests what has a site.
fn create_receiver_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    receiver: TypeId,
    position: Option<u32>,
) -> DeclaredType {
    let Some(position) = position.filter(|_| file.is_checked()) else {
        return expect_type(receiver);
    };
    let origin = SiteOrigin {
        kind: TypeSiteKind::This,
        position,
    };
    let site = add_type_site(file, origin, None);
    DeclaredType::new(
        Mapped::checked(receiver),
        Some(site),
        PositionFlags::default(),
    )
}

fn get_awaited_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    types: PositionTypes,
) -> PositionTypes {
    let written = match types.written {
        WrittenType::Written(ty) => match file.queries.awaited_type(ty) {
            Ok(awaited) => WrittenType::Written(awaited),
            Err(reason) => WrittenType::GaveUp(reason),
        },
        WrittenType::Unwritten | WrittenType::GaveUp(_) => types.written,
    };
    let checked = types.checked.and_then(|ty| file.queries.awaited_type(ty));
    PositionTypes { written, checked }
}

fn get_contents_types(
    file: &mut FileLowering<'_, '_, '_, '_>,
    types: PositionTypes,
    slot: ContentsSlot,
) -> PositionTypes {
    let written = match types.written {
        WrittenType::Written(ty) => match find_contents_type(file, ty, slot) {
            Some(contents) => WrittenType::Written(contents),
            None => WrittenType::Unwritten,
        },
        WrittenType::Unwritten | WrittenType::GaveUp(_) => types.written,
    };
    let checked = types
        .checked
        .and_then(|ty| find_contents_type(file, ty, slot).ok_or(GaveUp::Unresolved));
    PositionTypes { written, checked }
}

// `return promise` in an async function returns what the promise is fulfilled with.
fn create_awaited_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    types: PositionTypes,
    origin: SiteOrigin,
) -> DeclaredType {
    let Some(mut source) = super::choose_source(file, types, Some(origin)) else {
        return DeclaredType::untyped();
    };
    source.mapped.ty = file
        .fragment
        .types
        .union(source.mapped.ty, TypeTable::OBJECT);
    super::finish_position(file, source, Some(origin), PositionFlags::default())
}
