use bun_sema::atom::known;
use bun_sema::bind::{Binding, BindingInitializer, CodeUnit, FnOwner, Parent, SymbolId};
use bun_sema::check::aot::{
    ClassRef, FunctionRef, GaveUp, PositionTypes, ShapeKind, SignatureShape, WrittenType,
};
use bun_sema::hir::{
    ClassId, ExprKind, Flags, FnId, FnKind, Member, MemberId, MemberKind, StmtKind,
};

use smallvec::SmallVec;

use super::FunctionPositions;
use crate::ir::{ContentsSlot, DeclaredType, LayoutId, Mapped, PositionFlags, TypeId, TypeTable};
use crate::lower::scope::{BindingRef, ScopeSlot};
use crate::lower::types::find_contents_type;
use crate::lower::{CheckerTypeId, FileLowering};

pub(super) fn compute_function_positions(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> FunctionPositions {
    let func = file.hir[function];
    let source = FunctionRef {
        file: file.file,
        function,
    };
    let untyped = DeclaredType::untyped();
    if file.inputs.library_functions.is_left_out(source) {
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
    let mut positions = FunctionPositions {
        this,
        parameters,
        result: untyped,
        returned: untyped,
        yielded: untyped,
    };
    if shape.result.written.written().is_none() {
        return positions;
    }
    positions.result = file.create_position(shape.result);
    let is_async = func.flags.contains(Flags::ASYNC);
    let is_generator = func.flags.contains(Flags::GENERATOR);
    match (is_async, is_generator) {
        (false, false) => positions.returned = positions.result,
        (true, false) => positions.returned = file.create_awaited_position(shape.result),
        (false, true) | (true, true) => {
            let contents = file.get_contents_types(shape.result, ContentsSlot::Element);
            positions.yielded = file.create_position(contents);
        }
    }
    positions
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
        let instance = self.fragment.types.intern_layout(layout);
        match member {
            Some(member) if !is_receiver_known => {
                let is_written_here = class.file == self.file && member.func.is_some();
                let is_tested = is_written_here && self.is_receiver_tested(member.func);
                self.create_receiver_position(instance, is_tested)
            }
            Some(_) | None => self.create_receiver_position(instance, true),
        }
    }

    fn compute_parameter_positions(
        &mut self,
        function: FnId,
        shape: &SignatureShape<'_>,
    ) -> Vec<DeclaredType> {
        let parameters = self.hir[function].params;
        let mut positions = Vec::with_capacity(parameters.len());
        for index in 0..parameters.len() {
            let Some(entry) = shape.parameters.get(index) else {
                positions.push(DeclaredType::untyped());
                continue;
            };
            let position = self.create_position(entry.types);
            if !self.is_checked() {
                self.note_declared_records(function, index as u32, entry.types);
            }
            positions.push(match entry.is_optional {
                true => self.add_undefined(position),
                false => position,
            });
        }
        positions
    }

    fn note_declared_records(&mut self, function: FnId, parameter: u32, types: PositionTypes) {
        let mut open: SmallVec<[CheckerTypeId; 8]> = SmallVec::new();
        open.extend(types.written.written());
        open.extend(types.checked.ok());
        while let Some(ty) = open.pop() {
            match self.queries.type_shape(ty).map(|shape| shape.kind) {
                Ok(ShapeKind::Union(members)) => open.extend_from_slice(members),
                Ok(ShapeKind::Object) => self.note_declared_record(function, parameter, ty),
                Ok(_) | Err(_) => {}
            }
        }
    }

    fn find_class_member(&self, function: FnId) -> Option<(ClassId, MemberId)> {
        match self.bound.fns[function.idx()].owner {
            FnOwner::Member(member) => Some((self.bound.member_class(member)?, member)),
            FnOwner::None | FnOwner::Expr(_) | FnOwner::Stmt(_) | FnOwner::Type(_) => None,
        }
    }

    fn is_receiver_tested(&self, function: FnId) -> bool {
        let this = BindingRef::Slot(self.bound.fns[function.idx()].scope, ScopeSlot::This);
        let placement = self.scopes.placement(this);
        self.is_checked() || placement.is_some_and(|placement| placement.is_shared)
    }

    fn create_receiver_position(&self, receiver: TypeId, is_tested: bool) -> DeclaredType {
        if !is_tested {
            return expect_type(receiver);
        }
        DeclaredType::new(Mapped::checked(receiver), None, PositionFlags::default())
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

    fn create_awaited_position(&mut self, types: PositionTypes) -> DeclaredType {
        let written = match types.written {
            WrittenType::Written(ty) => match self.queries.awaited_type(ty) {
                Ok(awaited) => WrittenType::Written(awaited),
                Err(reason) => WrittenType::GaveUp(reason),
            },
            WrittenType::Unwritten | WrittenType::GaveUp(_) => types.written,
        };
        let checked = types.checked.and_then(|ty| self.queries.awaited_type(ty));
        let awaited = PositionTypes { written, checked };
        let Some(mut source) = self.choose_source(awaited) else {
            return DeclaredType::untyped();
        };
        let types = &mut self.fragment.types;
        source.mapped.ty = types.union(source.mapped.ty, TypeTable::OBJECT);
        self.finish_position(source, PositionFlags::default())
    }
}

fn compute_this_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    source: FunctionRef,
    shape: &SignatureShape<'_>,
) -> DeclaredType {
    let func = file.hir[source.function];
    if func.this_param.is_some() {
        if file.queries.is_prototype_object_used(source)
            && let Some(layout) = file.constructor_function_layout(source)
        {
            let instance = file.fragment.types.intern_layout(layout);
            let is_tested = file.is_receiver_tested(source.function);
            return file.create_receiver_position(instance, is_tested);
        }
        return file.create_position(shape.this_type);
    }
    if let Some((class, member)) = file.find_class_member(source.function) {
        let class = ClassRef {
            file: file.file,
            class,
        };
        return file.class_this_type(class, Some(member));
    }
    if let Some(layout) = find_layout_whose_prototype_holds(file, source.function) {
        return expect_type(file.fragment.types.intern_layout(layout));
    }
    if let Some(constructor) = file.queries.find_constructor_of_prototype_function(source)
        && let Some(layout) = find_layout_made_by(file, constructor)
    {
        return expect_type(file.fragment.types.intern_layout(layout));
    }
    if let Some(layout) = file.constructor_function_layout(source)
        && file
            .queries
            .stores_into_instances_or_prototype_object(source)
    {
        let instance = file.fragment.types.intern_layout(layout);
        let is_tested = file.is_receiver_tested(source.function);
        return file.create_receiver_position(instance, is_tested);
    }
    DeclaredType::untyped()
}

fn find_layout_whose_prototype_holds(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
) -> Option<LayoutId> {
    let (hir, bound) = (file.hir, file.bound);
    if hir[function].kind != FnKind::Expr {
        return None;
    }
    let FnOwner::Expr(mut owner) = bound.fns[function.idx()].owner else {
        return None;
    };
    while let Parent::Stmt(statement) = bound.parent_of_expr(owner) {
        let StmtKind::Return(_) = hir[statement].kind else {
            return None;
        };
        let CodeUnit::Function(around) = bound.code_unit(bound.scope_of_stmt(statement)) else {
            return None;
        };
        bound.get_immediately_invoked_function_expression(hir, around)?;
        let FnOwner::Expr(written) = bound.fns[around.idx()].owner else {
            return None;
        };
        let Parent::Expr(call) = bound.parent_of_expr(written) else {
            return None;
        };
        owner = call;
    }
    let Parent::Expr(assignment) = bound.parent_of_expr(owner) else {
        return None;
    };
    let ExprKind::Assign {
        op: None,
        target,
        value,
    } = hir[assignment].kind
    else {
        return None;
    };
    let ExprKind::Dot { obj: prototype, .. } = hir[target].kind else {
        return None;
    };
    let ExprKind::Dot { obj, name, .. } = hir[prototype].kind else {
        return None;
    };
    if value != owner || name != known::prototype || !matches!(hir[obj].kind, ExprKind::Ident(_)) {
        return None;
    }
    let Binding::Symbol(symbol) = bound.binding(obj) else {
        return None;
    };
    find_layout_made_by(file, symbol)
}

fn find_layout_made_by(
    file: &mut FileLowering<'_, '_, '_, '_>,
    constructor: SymbolId,
) -> Option<LayoutId> {
    let (hir, bound) = (file.hir, file.bound);
    let constructor = match bound.binding_initializer(hir, constructor) {
        BindingInitializer::Class(class) => return Some(file.own_class_layout(class)),
        BindingInitializer::Function(constructor) => constructor,
        BindingInitializer::Expression(initializer) => match hir[initializer].kind {
            ExprKind::Fn(constructor) => constructor,
            _ => return None,
        },
        _ => return None,
    };
    file.constructor_function_layout(FunctionRef {
        file: file.file,
        function: constructor,
    })
}

fn is_static_member(member: &Member) -> bool {
    member.kind == MemberKind::StaticBlock || member.flags.contains(Flags::STATIC)
}

fn has_known_receiver(member: &Member) -> bool {
    match member.kind {
        MemberKind::Property | MemberKind::StaticBlock => true,
        MemberKind::Constructor => !member.flags.contains(Flags::STATIC),
        _ => false,
    }
}

fn expect_type(ty: TypeId) -> DeclaredType {
    DeclaredType::new(Mapped::expected(ty), None, PositionFlags::default())
}
