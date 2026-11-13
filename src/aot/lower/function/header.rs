use bun_sema::bind::{Binding, Bound, CodeUnit, Decl, FnOwner};
use bun_sema::check::aot::FunctionRef;
use bun_sema::file_analysis::has_live_await;
use bun_sema::hir::{self, ExprKind, Flags, FnBody, FnId, FnKind, StmtKind};

use crate::builtins::SourceDialect;
use crate::builtins::id::BuiltinClass;
use crate::builtins::table::{FramesMark, frames_mark_of};
use crate::ir::generated::{Function, FunctionFlags, FunctionKind, FunctionSyntax, SourceRange};
use crate::ir::{
    Body, DeclaredType, FunctionId, FunctionKey, Mapped, PositionFlags, Primitives, StringId, Type,
    TypeRef, TypeTable,
};
use crate::lower::{FileLowering, class, generator};

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn intern_own_name(&mut self, function: FnId) -> StringId {
        let func = self.hir[function];
        let binding = match func.kind {
            FnKind::Decl | FnKind::Expr => {
                Binding::Symbol(self.bound.declared_symbol(Decl::Fn(function)))
            }
            _ => Binding::Free,
        };
        self.intern_function_name(binding, func.name)
    }

    pub(in crate::lower) fn is_derived_constructor(&self, function: FnId) -> bool {
        let class = self.bound.function_class(function);
        self.hir.runtime_function_kind(function) == FnKind::Constructor
            && class.is_some_and(|class| class::is_derived_class(self.hir, class))
    }

    fn find_enclosing_key(&self, key: FunctionKey) -> Option<FunctionKey> {
        let bound = self.bound;
        let mut scope = match key {
            FunctionKey::Source(source)
                if self
                    .inputs
                    .modules
                    .inner_module(self.file, source.function)
                    .is_some() =>
            {
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
            _ => {
                return None;
            }
        };
        loop {
            let unit = bound.code_unit(scope);
            let initialized_class = match unit {
                CodeUnit::File => return None,
                CodeUnit::Function(_) => match self.scopes.function_key(unit) {
                    FunctionKey::StaticInitializer(class) => class.class,
                    enclosing @ (FunctionKey::ModuleBody(_)
                    | FunctionKey::WrappedModuleBody(_)
                    | FunctionKey::FacadeBody(_)
                    | FunctionKey::CheckBody(_)
                    | FunctionKey::Instantiation(_)
                    | FunctionKey::Source(_)
                    | FunctionKey::Signature(_)
                    | FunctionKey::ClassSignature(_)
                    | FunctionKey::ImplicitConstructor(_)
                    | FunctionKey::InstanceInitializer(_)
                    | FunctionKey::AccessorGetter { .. }
                    | FunctionKey::AccessorSetter { .. }
                    | FunctionKey::PrivateNameTest { .. }
                    | FunctionKey::ModuleRequest { .. }
                    | FunctionKey::CopiedGetter { .. }
                    | FunctionKey::PrototypeMaker(_)) => return Some(enclosing),
                },
                CodeUnit::FieldInitializer(member) => bound.member_class(member)?,
            };
            scope = bound.class_scope[initialized_class.idx()];
        }
    }

    fn compute_function_kind(&self, function: FnId) -> FunctionKind {
        match self.hir.runtime_function_kind(function) {
            FnKind::Decl | FnKind::Expr => FunctionKind::Plain,
            FnKind::Arrow => FunctionKind::Arrow,
            FnKind::Method | FnKind::StaticBlock => FunctionKind::Method,
            FnKind::Getter => FunctionKind::Getter,
            FnKind::Setter => FunctionKind::Setter,
            FnKind::Constructor if self.is_derived_constructor(function) => {
                FunctionKind::DerivedConstructor
            }
            FnKind::Constructor => FunctionKind::BaseConstructor,
            _ => {
                debug_assert!(false, "this kind of function has no code of its own");
                FunctionKind::Plain
            }
        }
    }

    fn compute_rest_position(&mut self, position: DeclaredType) -> DeclaredType {
        let types = &mut self.fragment.types;
        let declared = types.without_primitives(position.ty, Primitives::NULLISH);
        let ty = match is_array_type(&types.get(declared)) {
            true => declared,
            false => TypeTable::ARRAY,
        };
        let flags = position.flags.without(PositionFlags::IS_EXPECTED);
        DeclaredType::new(
            Mapped::checked(ty),
            None,
            flags | PositionFlags::IS_FROM_COMPILER,
        )
    }

    pub(in crate::lower) fn find_end_of_function(&self, function: FnId) -> Option<u32> {
        end_of_function(self.hir, self.bound, function)
    }

    /// Where the file has the text of a function or of a class that may be in a copy.
    pub(in crate::lower) fn written_range(&self, start: u32, end: u32) -> SourceRange {
        SourceRange {
            start: self.hir.written_position(start),
            end: self.hir.written_position(end),
        }
    }

    pub(super) fn compute_text_range(&self, function: FnId) -> SourceRange {
        let Some(end) = self.find_end_of_function(function) else {
            return SourceRange::default();
        };
        self.written_range(self.hir[function].text_start, end)
    }
}

pub(in crate::lower) fn end_of_function(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> Option<u32> {
    match bound.fns[function.idx()].owner {
        FnOwner::Expr(expression) => Some(hir[expression].end),
        FnOwner::Stmt(statement) => Some(hir[statement].loc.end),
        FnOwner::Member(member) => Some(hir[member].loc.end),
        FnOwner::Type(_) | FnOwner::None => None,
    }
}

pub(crate) fn create_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
    kind: FunctionKind,
    position: u32,
) -> Function {
    let mut syntax = FunctionSyntax::default();
    // A wrapper that another part lowers hands nothing down.
    let enclosing = file.find_enclosing_key(key);
    let enclosing = enclosing.filter(|&enclosing| !file.is_key_of_other_part(enclosing));
    let (enclosing_runtime_function, inherited_flags) = match enclosing {
        Some(enclosing) => {
            let enclosing = file.reference_function(enclosing);
            let header = file.function_header(enclosing);
            let hidden = match file.fragment.lists_functions_inside(enclosing) {
                true => FunctionFlags::default(),
                false => header.flags & FunctionFlags::IS_HIDDEN_IN_STACK_TRACES,
            };
            syntax |= header.syntax & FunctionSyntax::IS_SHOWN_AS_NATIVE_CODE;
            (header.enclosing_runtime_function, hidden)
        }
        None => (None, FunctionFlags::default()),
    };
    let mut flags = file.scopes.entry_flags(key) | inherited_flags;
    if file.is_checked() {
        flags |= FunctionFlags::IS_CHECKED;
    }
    Function {
        name: None,
        module: file.module_id(),
        position: file.hir.written_position(position),
        source_range: SourceRange::default(),
        kind,
        role: file.source.function_role(),
        flags,
        length: 0,
        syntax,
        enclosing_runtime_function,
        captures: file.capture_positions(key),
        this_type: DeclaredType::untyped(),
        parameters: Vec::new(),
        results: vec![DeclaredType::untyped()],
        body: Body::default(),
        function_types: Vec::new(),
        builtin_members: Vec::new(),
        requested_originals: Vec::new(),
    }
}

pub(crate) fn declare_source_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    name: Option<StringId>,
) -> FunctionId {
    declare(file, function, |file| {
        create_source_header(file, function, name)
    })
}

/// A function that shows itself as `function` and captures nothing.
pub(in crate::lower) fn create_header_of_copy(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
    function: FnId,
    name: StringId,
) -> Function {
    let mut header = create_source_header(file, function, Some(name));
    header.captures = file.capture_positions(key);
    header
}

pub(in crate::lower) fn create_header_of_missing_function(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FnId,
    name: Option<StringId>,
) -> Function {
    let flags = match file.is_checked() {
        true => FunctionFlags::IS_CHECKED,
        false => FunctionFlags::default(),
    };
    Function {
        name,
        module: file.module_id(),
        position: file.hir.written_position(file.hir[function].start),
        kind: FunctionKind::Plain,
        role: file.source.function_role(),
        flags,
        this_type: DeclaredType::untyped(),
        results: vec![DeclaredType::untyped()],
        ..Function::default()
    }
}

pub(crate) fn declare_source_function_with(
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
    if !file.inputs.library_functions.is_left_out(source) && !file.is_of_other_part(function) {
        file.constructor_function_layout(source);
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
    let source = FunctionRef {
        file: file.file,
        function,
    };
    let key = FunctionKey::Source(source);
    let is_of_other_part = file.is_of_other_part(function);
    let kind = file.compute_function_kind(function);
    let position = match kind {
        FunctionKind::BaseConstructor | FunctionKind::DerivedConstructor => {
            file.parameters_position(function)
        }
        _ => func.start,
    };
    let mut header = create_header(file, key, kind, position);
    match find_frames_mark(file, function) {
        Some(FramesMark::NativeCode) => header.syntax |= FunctionSyntax::IS_SHOWN_AS_NATIVE_CODE,
        Some(FramesMark::Hidden) => header.flags |= FunctionFlags::IS_HIDDEN_IN_STACK_TRACES,
        None => {}
    }
    if header.enclosing_runtime_function.is_some()
        || header
            .syntax
            .contains(FunctionSyntax::IS_SHOWN_AS_NATIVE_CODE)
    {
        header.position = file.parameters_position(function);
    }
    header.flags |= compute_source_flags(hir, function);
    if file.inputs.library_functions.is_left_out(source) {
        header.flags = header
            .flags
            .without(generator::coroutine_flags(hir, function));
    }
    header.name = match name {
        Some(name) => Some(name),
        None if func.name.is_some() => Some(file.intern_own_name(function)),
        None if func.flags.contains(Flags::DEFAULT) => {
            header.flags |= FunctionFlags::HAS_EXPLICIT_NAME;
            file.default_export_name()
        }
        None => None,
    };
    if header.flags.contains(FunctionFlags::IS_ASYNC)
        && has_live_await(hir, &file.decisions().as_folded_by_bun_run(), function)
    {
        header.syntax |= FunctionSyntax::HAS_LIVE_AWAIT;
    }
    let wrapped = file.inputs.modules.wrapped();
    if wrapped.runs_once_per_closure(source.file, function) {
        header.syntax |= FunctionSyntax::RUNS_ONCE_PER_CLOSURE;
    }
    header.source_range = file.compute_text_range(function);
    let asked = file.find_originals_asked_for(function, header.source_range);
    if asked.may_be_own {
        header.syntax |= FunctionSyntax::MAY_IMPORT_OWN_ORIGINAL;
    }
    header.requested_originals = asked.names;
    header.length = func
        .params
        .iter()
        .take_while(|&parameter| {
            hir[parameter].default.is_none() && !hir[parameter].flags.contains(Flags::REST)
        })
        .count() as u32;
    if !is_of_other_part {
        add_positions(file, function, &mut header);
    }
    if hir.runtime_function_kind(function) == FnKind::Constructor {
        let class = file.bound.function_class(function);
        let class = class.expect("a constructor has a class");
        file.finish_constructor_header(class, name, &mut header);
    }
    header
}

fn add_positions(file: &mut FileLowering<'_, '_, '_, '_>, function: FnId, header: &mut Function) {
    let declared = file.function_positions(function);
    let has_strict_this = header.flags.contains(FunctionFlags::HAS_THIS)
        && !header.flags.contains(FunctionFlags::IS_SLOPPY);
    if has_strict_this {
        header.this_type = declared.this;
    }
    header.parameters.clone_from(&declared.parameters);
    if header.flags.contains(FunctionFlags::HAS_REST_PARAMETER)
        && let Some(rest) = header.parameters.last_mut()
    {
        *rest = file.compute_rest_position(*rest);
    }
    let key = FunctionKey::Source(FunctionRef {
        file: file.file,
        function,
    });
    let undeclared = file.scopes.undeclared_parameters(key) as usize;
    header
        .parameters
        .extend(std::iter::repeat_n(DeclaredType::untyped(), undeclared));
    header.results.clear();
    header.results.push(declared.result);
}

/// The header of a function that another part lowers has no positions until a call asks for them.
pub(crate) fn complete_header(file: &mut FileLowering<'_, '_, '_, '_>, id: FunctionId) {
    let FunctionKey::Source(source) = file.function_key(id) else {
        return;
    };
    let function = source.function;
    if file.is_of_other_part(function) && file.needs_positions_of_other_part(function) {
        let mut header = file.function_header(id).clone();
        add_positions(file, function, &mut header);
        *file.function_header_mut(id) = header;
    }
}

fn find_frames_mark(file: &FileLowering<'_, '_, '_, '_>, function: FnId) -> Option<FramesMark> {
    let hir = file.hir;
    if file.source.dialect() == SourceDialect::Runtime
        && let FnBody::Block(statements) = hir[function].body
        && statements.len != 0
        && let StmtKind::Expr(first) = hir[hir.id_at(statements, 0)].kind
        && let ExprKind::String(text) = hir[first].kind
    {
        return frames_mark_of(file.queries.atom_bytes(text));
    }
    None
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
    let has_written_this = match hir.runtime_function_kind(function) {
        FnKind::Arrow | FnKind::Constructor => false,
        _ => func.this_param.is_some(),
    };
    if has_written_this {
        flags |= FunctionFlags::HAS_THIS;
    }
    flags
}

fn is_array_type(ty: &TypeRef<'_>) -> bool {
    let [part] = ty.classes else {
        return false;
    };
    part.builtin_class == BuiltinClass::Array
        && *ty == Type::class(BuiltinClass::Array, &part.contents)
}
