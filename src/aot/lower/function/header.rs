use bun_sema::atom::known;
use bun_sema::bind::{CodeUnit, FnOwner};
use bun_sema::check::aot::FunctionRef;
use bun_sema::hir::{self, Flags, FnId, FnKind};

use crate::builtins::id::BuiltinClass;
use crate::ir::generated::{
    Function, FunctionFlags, FunctionKind, FunctionRelations, LimitId, SourceRange,
};
use crate::ir::{
    Body, DeclaredType, FunctionId, FunctionKey, Mapped, PositionFlags, Primitives, StringId, Type,
    TypeTable,
};
use crate::lower::{FileLowering, captures, class, generator, layouts, positions};

pub(super) fn create_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
    kind: FunctionKind,
    position: u32,
) -> Function {
    let (enclosing_runtime_function, inherited_flags) = match find_enclosing_key(file, key) {
        Some(enclosing) => {
            let enclosing = file.reference_function(enclosing);
            let header = file.function_header(enclosing);
            let hidden = header.flags & FunctionFlags::IS_HIDDEN_IN_STACK_TRACES;
            (header.enclosing_runtime_function, hidden)
        }
        None => (None, FunctionFlags::default()),
    };
    let mut flags = file.scopes.entry_flags(key) | inherited_flags;
    if file.is_checked() {
        flags |= FunctionFlags::IS_CHECKED;
    }
    if file.scopes.has_too_many_captures(key) {
        file.gave_up(LimitId::MaxCaptures, position);
    }
    Function {
        name: None,
        module: file.module_id(),
        position,
        text: SourceRange::default(),
        kind,
        role: file.source.function_role(),
        flags,
        length: 0,
        enclosing_runtime_function,
        captures: captures::capture_positions(file, key),
        this_type: DeclaredType::untyped(),
        parameters: Vec::new(),
        results: vec![DeclaredType::untyped()],
        body: Body::default(),
        function_types: Vec::new(),
        builtin_members: Vec::new(),
        relations: FunctionRelations::default(),
    }
}

pub(super) fn declare_source_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    name: Option<StringId>,
) -> FunctionId {
    declare(file, function, |file| create_source_header(file, function, name))
}

pub(super) fn declare_source_function_with(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    adjust_header: &mut dyn FnMut(&mut FileLowering<'_, '_, '_, '_>, &mut Function),
) -> FunctionId {
    declare(file, function, |file| {
        let mut header = create_source_header(file, function, None);
        adjust_header(file, &mut header);
        header
    })
}

pub(super) fn is_derived_constructor(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> bool {
    let class = file.bound.function_class(function);
    file.hir.runtime_function_kind(function) == FnKind::Constructor
        && class.is_some_and(|class| class::is_derived_class(file.hir, class))
}

fn declare(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    create: impl FnOnce(&mut FileLowering<'_, '_, '_, '_>) -> Function,
) -> FunctionId {
    let source = FunctionRef {
        file: file.file,
        function,
    };
    let id = file.declare_function(FunctionKey::Source(source), create);
    if !file.inputs.library_functions.is_left_out(source) {
        layouts::constructor_function_layout(file, source);
    }
    id
}

fn create_source_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    name: Option<StringId>,
) -> Function {
    let hir = file.hir;
    let func = hir[function];
    let key = FunctionKey::Source(FunctionRef {
        file: file.file,
        function,
    });
    let declared = positions::function_positions(file, function);
    let kind = compute_function_kind(file, function);
    let mut header = create_header(file, key, kind, func.start);
    header.flags |= compute_source_flags(hir, function);
    let source = FunctionRef {
        file: file.file,
        function,
    };
    if file.inputs.library_functions.is_left_out(source) {
        header.flags = header.flags.without(generator::coroutine_flags(hir, function));
    }
    header.name = match name {
        Some(name) => Some(name),
        None if func.name.is_some() => Some(file.intern_atom(func.name)),
        None if func.flags.contains(Flags::DEFAULT) => Some(file.intern_atom(known::default)),
        None => None,
    };
    header.text = compute_text_range(file, function);
    header.length = compute_length(hir, function);
    let has_strict_this = header.flags.contains(FunctionFlags::HAS_THIS)
        && !header.flags.contains(FunctionFlags::IS_SLOPPY);
    if has_strict_this {
        header.this_type = declared.this;
    }
    header.parameters = declared.parameters.clone();
    if header.flags.contains(FunctionFlags::HAS_REST_PARAMETER)
        && let Some(rest) = header.parameters.last_mut()
    {
        *rest = compute_rest_position(file, *rest);
    }
    let undeclared = file.scopes.undeclared_parameters(key) as usize;
    header.parameters.extend(std::iter::repeat_n(DeclaredType::untyped(), undeclared));
    header.results = vec![declared.result];
    if hir.runtime_function_kind(function) == FnKind::Constructor {
        let class = file.bound.function_class(function);
        let class = class.expect("a constructor has a class");
        class::finish_constructor_header(file, class, name, &mut header);
    }
    header
}

fn find_enclosing_key(
    file: &FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
) -> Option<FunctionKey> {
    let bound = file.bound;
    let mut scope = match key {
        FunctionKey::ModuleBody(_)
        | FunctionKey::WrappedModuleBody(_)
        | FunctionKey::FaceBody(_)
        | FunctionKey::CheckBody(_)
        | FunctionKey::Signature(_)
        | FunctionKey::ClassSignature(_) => {
            return None;
        }
        FunctionKey::Source(source) => {
            let top = bound.fns[source.function.idx()].scope;
            bound.scopes[top.idx()].parent
        }
        FunctionKey::ImplicitConstructor(class)
        | FunctionKey::InstanceInitializer(class)
        | FunctionKey::StaticInitializer(class) => bound.class_scope[class.class.idx()],
        FunctionKey::AccessorGetter { member, .. }
        | FunctionKey::AccessorSetter { member, .. }
        | FunctionKey::PrivateNameTest { member, .. } => {
            bound.class_scope[bound.member_class(member)?.idx()]
        }
    };
    loop {
        let unit = bound.code_unit(scope);
        let initialized_class = match unit {
            CodeUnit::File => return None,
            CodeUnit::Function(_) => match file.scopes.function_key(unit) {
                FunctionKey::StaticInitializer(class) => class.class,
                enclosing @ (FunctionKey::ModuleBody(_)
                | FunctionKey::WrappedModuleBody(_)
                | FunctionKey::FaceBody(_)
                | FunctionKey::CheckBody(_)
                | FunctionKey::Source(_)
                | FunctionKey::Signature(_)
                | FunctionKey::ClassSignature(_)
                | FunctionKey::ImplicitConstructor(_)
                | FunctionKey::InstanceInitializer(_)
                | FunctionKey::AccessorGetter { .. }
                | FunctionKey::AccessorSetter { .. }
                | FunctionKey::PrivateNameTest { .. }) => return Some(enclosing),
            },
            CodeUnit::FieldInitializer(member) => bound.member_class(member)?,
        };
        scope = bound.class_scope[initialized_class.idx()];
    }
}

fn compute_function_kind(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> FunctionKind {
    match file.hir.runtime_function_kind(function) {
        FnKind::Decl | FnKind::Expr => FunctionKind::Plain,
        FnKind::Arrow => FunctionKind::Arrow,
        FnKind::Method | FnKind::StaticBlock => FunctionKind::Method,
        FnKind::Getter => FunctionKind::Getter,
        FnKind::Setter => FunctionKind::Setter,
        FnKind::Constructor if is_derived_constructor(file, function) => {
            FunctionKind::DerivedConstructor
        }
        FnKind::Constructor => FunctionKind::BaseConstructor,
        FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => {
            debug_assert!(false, "this kind of function has no code of its own");
            FunctionKind::Plain
        }
    }
}

fn compute_source_flags(hir: &hir::File<'_>, function: FnId) -> FunctionFlags {
    let func = hir[function];
    let mut flags = generator::coroutine_flags(hir, function);
    if !func.is_strict {
        flags |= FunctionFlags::IS_SLOPPY;
    }
    if func.name.is_some() {
        flags |= FunctionFlags::HAS_EXPLICIT_NAME;
    }
    let last_parameter = func.params.iter().next_back();
    if last_parameter.is_some_and(|parameter| hir[parameter].flags.contains(Flags::REST)) {
        flags |= FunctionFlags::HAS_REST_PARAMETER;
    }
    if has_written_this(hir, function) {
        flags |= FunctionFlags::HAS_THIS;
    }
    flags
}

fn has_written_this(hir: &hir::File<'_>, function: FnId) -> bool {
    match hir.runtime_function_kind(function) {
        FnKind::Arrow | FnKind::Constructor => false,
        FnKind::Decl
        | FnKind::Expr
        | FnKind::Method
        | FnKind::Getter
        | FnKind::Setter
        | FnKind::StaticBlock
        | FnKind::CallSignature
        | FnKind::ConstructSignature
        | FnKind::FunctionType
        | FnKind::ConstructorType
        | FnKind::IndexSignature => hir[function].this_param.is_some(),
    }
}

fn is_array_type(ty: &Type) -> bool {
    let [part] = ty.classes.as_slice() else {
        return false;
    };
    part.builtin_class == BuiltinClass::Array
        && *ty == Type::class(BuiltinClass::Array, &part.contents)
}

// The function makes the array itself, so nothing tests that it is one. What an array type says it holds is expected.
fn compute_rest_position(
    file: &mut FileLowering<'_, '_, '_, '_>,
    position: DeclaredType,
) -> DeclaredType {
    let types = &mut file.fragment.types;
    let declared = types.without_primitives(position.ty, Primitives::NULLISH);
    let (ty, site) = match is_array_type(types.get(declared)) {
        true => (declared, position.site),
        false => (TypeTable::ARRAY, None),
    };
    let flags = position.flags.without(PositionFlags::IS_EXPECTED);
    DeclaredType::new(Mapped::checked(ty), site, flags | PositionFlags::IS_FROM_COMPILER)
}

fn compute_length(hir: &hir::File<'_>, function: FnId) -> u32 {
    let length = hir[function]
        .params
        .iter()
        .take_while(|&parameter| {
            hir[parameter].default.is_none() && !hir[parameter].flags.contains(Flags::REST)
        })
        .count();
    length as u32
}

fn compute_text_range(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> SourceRange {
    if let Some(installed) = file.compiled.installed_text {
        let (start, end) = (installed.functions.get(function.idx()).copied()).unwrap_or_default();
        return SourceRange { start, end };
    }
    let hir = file.hir;
    let end = match file.bound.fns[function.idx()].owner {
        FnOwner::Expr(expression) => hir[expression].end,
        FnOwner::Stmt(statement) => hir[statement].loc.end,
        FnOwner::Member(member) => hir[member].loc.end,
        FnOwner::Type(_) | FnOwner::None => return SourceRange::default(),
    };
    SourceRange {
        start: file.type_ranges.map_offset(hir[function].text_start),
        end: file.type_ranges.map_offset(end),
    }
}
