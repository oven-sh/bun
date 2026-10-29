use bun_sema::bind::FnOwner;
use bun_sema::check::aot::{
    ClassRef, FunctionRef, GaveUp, PositionTypes, SignatureShape, WrittenType,
};
use bun_sema::hir::{ClassId, Flags, FnId, Member, MemberId, MemberKind};

use super::{FunctionPositions, SiteOrigin, add_type_site};
use crate::ir::generated::TypeSiteKind;
use crate::ir::{ContentsSlot, DeclaredType, Mapped, PositionFlags, Type, TypeId, TypeTable};
use crate::lower::FileLowering;
use crate::lower::types::find_contents_type;

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
    let parameters = file.compute_parameter_positions(function, &shape);
    let this = compute_this_position(file, source, &shape);
    let result_origin = SiteOrigin {
        kind: TypeSiteKind::Result,
        position: func.start,
    };
    let result = file.create_position(shape.result, result_origin);
    let is_async = func.flags.contains(Flags::ASYNC);
    let is_generator = func.flags.contains(Flags::GENERATOR);
    let (returned, yielded) = match (is_async, is_generator) {
        (false, false) => (result, DeclaredType::untyped()),
        (true, false) => {
            let returned = file.create_awaited_position(shape.result, result_origin);
            (returned, DeclaredType::untyped())
        }
        (false, true) | (true, true) => {
            let contents = file.get_contents_types(shape.result, ContentsSlot::Element);
            let yielded = file.create_position(contents, result_origin);
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

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn class_this_type(
        &mut self,
        class: ClassRef,
        member: Option<MemberId>,
    ) -> DeclaredType {
        let hir = self.queries.files().hir(class.file);
        let member = member.map(|member| &hir[member]);
        let is_receiver_known = member.is_none_or(has_known_receiver);
        if member.is_some_and(is_static_member) {
            return match is_receiver_known {
                true => DeclaredType::from_compiler(TypeTable::FUNCTION),
                false => expect_type(TypeTable::FUNCTION),
            };
        }
        let layout = self.class_layout(class);
        let instance = self.fragment.types.intern(Type::layout(layout));
        match member {
            Some(member) if !is_receiver_known => {
                let is_written_here = class.file == self.file && member.func.is_some();
                let position = is_written_here.then(|| hir[member.func].start);
                self.create_receiver_position(instance, position)
            }
            Some(_) | None => DeclaredType::from_compiler(instance),
        }
    }

    fn compute_parameter_positions(
        &mut self,
        function: FnId,
        shape: &SignatureShape<'_>,
    ) -> Vec<DeclaredType> {
        let hir = self.hir;
        let parameters = hir[function].params;
        let mut positions = Vec::with_capacity(parameters.len());
        for (index, parameter) in parameters.iter().enumerate() {
            let Some(entry) = shape.parameters.get(index) else {
                positions.push(DeclaredType::untyped());
                continue;
            };
            let origin = SiteOrigin {
                kind: TypeSiteKind::Parameter,
                position: hir[hir[parameter].pat].pos,
            };
            let position = self.create_position(entry.types, origin);
            // An argument that is left out arrives as `undefined`, before the default value takes its place.
            positions.push(match entry.is_optional {
                true => self.add_undefined(position),
                false => position,
            });
        }
        positions
    }

    fn find_class_member(&self, function: FnId) -> Option<(ClassId, MemberId)> {
        match self.bound.fns[function.idx()].owner {
            FnOwner::Member(member) => Some((self.bound.member_class(member)?, member)),
            FnOwner::None | FnOwner::Expr(_) | FnOwner::Stmt(_) | FnOwner::Type(_) => None,
        }
    }

    // Whoever holds a method can call it on anything, so the entry tests `this` like a parameter. It tests what has a site.
    fn create_receiver_position(
        &mut self,
        receiver: TypeId,
        position: Option<u32>,
    ) -> DeclaredType {
        let Some(position) = position.filter(|_| self.is_checked()) else {
            return expect_type(receiver);
        };
        let origin = SiteOrigin {
            kind: TypeSiteKind::This,
            position,
        };
        let site = add_type_site(self, origin, None);
        DeclaredType::new(
            Mapped::checked(receiver),
            Some(site),
            PositionFlags::default(),
        )
    }

    fn get_contents_types(&mut self, types: PositionTypes, slot: ContentsSlot) -> PositionTypes {
        let written = match types.written {
            WrittenType::Written(ty) => match find_contents_type(self, ty, slot) {
                Some(contents) => WrittenType::Written(contents),
                None => WrittenType::Unwritten,
            },
            WrittenType::Unwritten | WrittenType::GaveUp(_) => types.written,
        };
        let checked = types
            .checked
            .and_then(|ty| find_contents_type(self, ty, slot).ok_or(GaveUp::Unresolved));
        PositionTypes { written, checked }
    }

    // `return promise` in an async function returns what the promise is fulfilled with.
    fn create_awaited_position(
        &mut self,
        types: PositionTypes,
        origin: SiteOrigin,
    ) -> DeclaredType {
        let written = match types.written {
            WrittenType::Written(ty) => match self.queries.awaited_type(ty) {
                Ok(awaited) => WrittenType::Written(awaited),
                Err(reason) => WrittenType::GaveUp(reason),
            },
            WrittenType::Unwritten | WrittenType::GaveUp(_) => types.written,
        };
        let checked = types.checked.and_then(|ty| self.queries.awaited_type(ty));
        let awaited = PositionTypes { written, checked };
        let Some(mut source) = self.choose_source(awaited, Some(origin)) else {
            return DeclaredType::untyped();
        };
        let types = &mut self.fragment.types;
        source.mapped.ty = types.union(source.mapped.ty, TypeTable::OBJECT);
        self.finish_position(source, Some(origin), PositionFlags::default())
    }
}

fn compute_this_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: FunctionRef,
    shape: &SignatureShape<'_>,
) -> DeclaredType {
    let func = file.hir[source.function];
    if func.this_param.is_some() {
        // `new` and the constructors below bring what the function makes, not everything that fits the written type.
        if file.queries.is_prototype_object_used(source)
            && let Some(layout) = file.constructor_function_layout(source)
        {
            let instance = file.fragment.types.intern(Type::layout(layout));
            return file.create_receiver_position(instance, Some(file.hir[func.this_param].pos));
        }
        let origin = SiteOrigin {
            kind: TypeSiteKind::This,
            position: file.hir[func.this_param].pos,
        };
        return file.create_position(shape.this_type, origin);
    }
    if let Some((class, member)) = file.find_class_member(source.function) {
        let class = ClassRef {
            file: file.file,
            class,
        };
        return file.class_this_type(class, Some(member));
    }
    if let Some(layout) = file.constructor_function_layout(source) {
        let instance = file.fragment.types.intern(Type::layout(layout));
        return file.create_receiver_position(instance, Some(func.start));
    }
    // Nobody wrote it, so no entry tests it.
    match file.choose_source(shape.this_type, None) {
        Some(source) => expect_type(source.mapped.ty),
        None => DeclaredType::untyped(),
    }
}

fn is_static_member(member: &Member) -> bool {
    member.kind == MemberKind::StaticBlock || member.flags.contains(Flags::STATIC)
}

fn has_known_receiver(member: &Member) -> bool {
    match member.kind {
        MemberKind::Property | MemberKind::StaticBlock => true,
        // `static constructor() {}` is a static method.
        MemberKind::Constructor => !member.flags.contains(Flags::STATIC),
        _ => false,
    }
}

fn expect_type(ty: TypeId) -> DeclaredType {
    DeclaredType::new(Mapped::expected(ty), None, PositionFlags::default())
}
