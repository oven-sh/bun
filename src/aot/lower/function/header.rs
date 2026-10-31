use bun_sema::bind::{Binding, CodeUnit, Decl, FnOwner};
use bun_sema::check::aot::FunctionRef;
use bun_sema::file_analysis::has_live_await;
use bun_sema::hir::{self, Flags, FnId, FnKind};

use crate::builtins::id::BuiltinClass;
use crate::ir::generated::{
    Function, FunctionFlags, FunctionKind, FunctionSyntax, LimitId, SourceRange,
};
use crate::ir::{
    Body, DeclaredType, FunctionId, FunctionKey, Mapped, PositionFlags, Primitives, StringId, Type,
    TypeTable,
};
use crate::load;
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
        self.intern_function_name(binding, func.name, func.name_pos)
    }

    // What an indirect `eval` is given is the body of a function without a name, which is all that its file holds. `Function` makes a function that has a name.
    fn is_evaluated_script(&self, key: FunctionKey) -> bool {
        let FunctionKey::Source(source) = key else {
            return false;
        };
        self.inputs.sources.kind(self.file) == load::SourceKind::EvaluatedText
            && self.hir[source.function].name.is_none()
            && self.find_enclosing_key(key).is_none()
    }

    pub(in crate::lower) fn is_derived_constructor(&self, function: FnId) -> bool {
        let class = self.bound.function_class(function);
        self.hir.runtime_function_kind(function) == FnKind::Constructor
            && class.is_some_and(|class| class::is_derived_class(self.hir, class))
    }

    fn find_enclosing_key(&self, key: FunctionKey) -> Option<FunctionKey> {
        let bound = self.bound;
        let mut scope = match key {
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

    // The function makes the array itself, so nothing tests that it is one. What an array type says it holds is expected.
    fn compute_rest_position(&mut self, position: DeclaredType) -> DeclaredType {
        let types = &mut self.fragment.types;
        let declared = types.without_primitives(position.ty, Primitives::NULLISH);
        let (ty, site) = match is_array_type(types.get(declared)) {
            true => (declared, position.site),
            false => (TypeTable::ARRAY, None),
        };
        let flags = position.flags.without(PositionFlags::IS_EXPECTED);
        DeclaredType::new(
            Mapped::checked(ty),
            site,
            flags | PositionFlags::IS_FROM_COMPILER,
        )
    }

    pub(in crate::lower) fn find_end_of_function(&self, function: FnId) -> Option<u32> {
        let hir = self.hir;
        match self.bound.fns[function.idx()].owner {
            FnOwner::Expr(expression) => Some(hir[expression].end),
            FnOwner::Stmt(statement) => Some(hir[statement].loc.end),
            FnOwner::Member(member) => Some(hir[member].loc.end),
            FnOwner::Type(_) | FnOwner::None => None,
        }
    }

    fn compute_text_range(&self, function: FnId) -> SourceRange {
        let Some(end) = self.find_end_of_function(function) else {
            return SourceRange::default();
        };
        SourceRange {
            start: self.type_ranges.map_offset(self.hir[function].text_start),
            end: self.type_ranges.map_offset(end),
        }
    }
}

pub(crate) fn create_header(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: FunctionKey,
    kind: FunctionKind,
    position: u32,
) -> Function {
    let (enclosing_runtime_function, inherited_flags) = match file.find_enclosing_key(key) {
        Some(enclosing) => {
            let enclosing = file.reference_function(enclosing);
            let header = file.function_header(enclosing);
            let hidden = match file.fragment.lists_functions_inside(enclosing) {
                true => FunctionFlags::default(),
                false => header.flags & FunctionFlags::IS_HIDDEN_IN_STACK_TRACES,
            };
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
    if file.scopes.has_fields_for_handlers(key) {
        file.gave_up(LimitId::MaxHandlerArguments, position);
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
        syntax: match file.is_evaluated_script(key) {
            true => FunctionSyntax::IS_EVALUATED_SCRIPT,
            false => FunctionSyntax::default(),
        },
        enclosing_runtime_function,
        captures: file.capture_positions(key),
        this_type: DeclaredType::untyped(),
        parameters: Vec::new(),
        results: vec![DeclaredType::untyped()],
        body: Body::default(),
        function_types: Vec::new(),
        builtin_members: Vec::new(),
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
    if !file.inputs.library_functions.is_left_out(source) {
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
    let declared = file.function_positions(function);
    let kind = file.compute_function_kind(function);
    // JSC reports what has no position of its own in a constructor where the parameters start.
    let position = match kind {
        FunctionKind::BaseConstructor | FunctionKind::DerivedConstructor => {
            file.parameters_position(function)
        }
        _ => func.start,
    };
    let mut header = create_header(file, key, kind, position);
    // JSC records no positions in a function that is written inside a built-in function.
    if header.enclosing_runtime_function.is_some() {
        header.position = file.parameters_position(function);
    }
    header.flags |= compute_source_flags(hir, function);
    if file.is_anonymous_in_bundle(func.name_pos) {
        header.flags = header.flags.without(FunctionFlags::HAS_EXPLICIT_NAME);
    }
    if file.inputs.library_functions.is_left_out(source) {
        header.flags = header
            .flags
            .without(generator::coroutine_flags(hir, function));
    }
    header.name = match name {
        Some(name) => Some(name),
        None if func.name.is_some() => Some(file.intern_own_name(function)),
        None if func.flags.contains(Flags::DEFAULT) => {
            if file.is_default_export_name_its_own(func.start) {
                header.flags |= FunctionFlags::HAS_EXPLICIT_NAME;
            }
            file.default_export_name(func.start)
        }
        None => None,
    };
    if header.flags.contains(FunctionFlags::IS_ASYNC)
        && !header.flags.contains(FunctionFlags::HAS_EXPLICIT_NAME)
        && has_live_await(hir, &file.decisions().as_folded_by_bun_run(), function)
    {
        header.syntax |= FunctionSyntax::HAS_WRITTEN_AWAIT;
    }
    header.text = file.compute_text_range(function);
    header.length = func
        .params
        .iter()
        .take_while(|&parameter| {
            hir[parameter].default.is_none() && !hir[parameter].flags.contains(Flags::REST)
        })
        .count() as u32;
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
    let undeclared = file.scopes.undeclared_parameters(key) as usize;
    header
        .parameters
        .extend(std::iter::repeat_n(DeclaredType::untyped(), undeclared));
    header.results = vec![declared.result];
    if hir.runtime_function_kind(function) == FnKind::Constructor {
        let class = file.bound.function_class(function);
        let class = class.expect("a constructor has a class");
        file.finish_constructor_header(class, name, &mut header);
    }
    header
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

fn is_array_type(ty: &Type) -> bool {
    let [part] = ty.classes.as_slice() else {
        return false;
    };
    part.builtin_class == BuiltinClass::Array
        && *ty == Type::class(BuiltinClass::Array, &part.contents)
}
