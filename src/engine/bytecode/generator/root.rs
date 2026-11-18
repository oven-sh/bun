//! Where generation starts and ends.

use std::rc::Rc;

use bun_engine_syntax::ast::{self, Ast, BindingFlags, BindingKind, Features, ScopeId, StmtKind};
use bun_engine_syntax::{
    Error, ErrorKind, EvalContext, FunctionFlags, FunctionKind, Name, Recovery,
};
use bun_engine_text::{Identifier, StringRef, Text};

use super::control::Targets;
use super::function::Arguments;
use super::scope::{Layout, Place};
use super::{Buffers, Generator, NameState, Suspension, This};
use crate::code::{
    Code, CodeFlags, CodeKind, Declarations, ExportEntry, ImportEntry, ModuleRequest,
};
use crate::function::{FunctionInfo, FunctionRef, Origin, Specialization, Visibility};
use crate::host::Host;
use crate::operand::{DebugHook, ImportPhase, Operand, Register};
use crate::scope::{ScopeKind, StaticScope};

pub(crate) enum Failure {
    TooLarge,
    UnknownBuiltinName(StringRef),
}

impl From<Failure> for Error {
    fn from(failure: Failure) -> Error {
        let (kind, message) = match failure {
            Failure::TooLarge => (ErrorKind::OutOfMemory, StringRef::empty()),
            Failure::UnknownBuiltinName(name) => {
                let parts = [
                    Text::from_ascii("Invalid private name '@"),
                    name.text(),
                    Text::from_ascii("'"),
                ];
                let message = StringRef::try_concat(&parts).unwrap_or_default();
                (ErrorKind::Syntax, message)
            }
        };
        Error {
            kind,
            recovery: Recovery::Irrecoverable,
            message,
            token: 0..0,
            offset: 0,
        }
    }
}

/// What is the same for all kinds of code.
pub(crate) struct Environment<'a> {
    pub(crate) source: &'a StringRef,
    pub(crate) host: &'a dyn Host,
    pub(crate) stack_limit: usize,
    pub(crate) debugs: bool,
    pub(crate) covers: bool,
}

pub(crate) struct ModuleCode {
    pub(crate) code: Rc<Code>,
    pub(crate) scope: Rc<StaticScope>,
    pub(crate) requests: Box<[ModuleRequest]>,
    pub(crate) imports: Box<[ImportEntry]>,
    pub(crate) exports: Box<[ExportEntry]>,
}

impl Buffers {
    fn reset(&mut self, names: usize) {
        self.asm.reset();
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.names.clear();
        }
        if self.names.len() < names {
            self.names.resize(names, NameState::default());
        }
        self.bindings.clear();
        self.outers.clear();
        self.open_scopes.clear();
        self.labels.clear();
        self.cleanups.clear();
        self.usings.clear();
        self.deferred_handlers.clear();
        self.for_ins.clear();
        self.optional_chains.clear();
        self.spine.clear();
        self.allocations.clear();
        self.kept_bindings.clear();
        self.kept_inputs.clear();
        self.identifiers.clear();
        self.constants.clear();
        self.constant_table.clear();
        self.functions.clear();
        self.trees.clear();
        self.scopes.clear();
        self.name_lists.clear();
        self.string_switches.clear();
    }

    pub(crate) fn script(
        &mut self,
        environment: &Environment<'_>,
        ast: &Ast,
        outer: Option<Rc<StaticScope>>,
    ) -> Result<(Rc<Code>, Declarations), Failure> {
        let mut generator = Generator::new(self, environment, ast, CodeKind::Script, outer);
        let declarations = generator.declarations();
        generator.script_code();
        Ok((generator.finish()?, declarations))
    }

    pub(crate) fn eval(
        &mut self,
        environment: &Environment<'_>,
        ast: &Ast,
        outer: Option<Rc<StaticScope>>,
        context: EvalContext,
    ) -> Result<(Rc<Code>, Declarations), Failure> {
        let mut generator = Generator::new(self, environment, ast, CodeKind::Eval, outer);
        generator.context = context;
        (generator.origin).set(Origin::DEBUGGER, context.contains(EvalContext::BY_DEBUGGER));
        let declarations = generator.declarations();
        generator.script_code();
        Ok((generator.finish()?, declarations))
    }

    pub(crate) fn module(
        &mut self,
        environment: &Environment<'_>,
        ast: &Ast,
        outer: Option<Rc<StaticScope>>,
        keeps_completion_value: bool,
    ) -> Result<ModuleCode, Failure> {
        let mut generator = Generator::new(self, environment, ast, CodeKind::Module, outer);
        generator.origin = Origin::MODULE;
        generator.outer_depth = 1;
        generator.this = This::Undefined;
        let scope = generator.module_code(keeps_completion_value);
        let (requests, imports) = (generator.requests(), generator.imports());
        let exports = generator.exports();
        Ok(ModuleCode {
            code: generator.finish()?,
            scope,
            requests,
            imports,
            exports,
        })
    }

    /// After the code of the root. What fails is left for when it is called.
    pub(crate) fn functions_with_trees(&mut self, environment: &Environment<'_>, ast: &Ast) {
        let call = Specialization::Call;
        while let Some((function, tree)) = self.waiting.pop() {
            let code = self.function(environment, ast, &ast[tree], &function, call);
            function.set_code(call, code.ok());
        }
    }

    /// The tree is not looked at if the function has no source or cannot be called that way.
    pub(crate) fn function(
        &mut self,
        environment: &Environment<'_>,
        ast: &Ast,
        tree: &ast::Tree,
        function: &FunctionInfo,
        specialization: Specialization,
    ) -> Result<Rc<Code>, Failure> {
        let kind = match specialization {
            Specialization::Call => CodeKind::Call,
            Specialization::Construct => CodeKind::Construct,
        };
        let mut generator = Generator::new(self, environment, ast, kind, function.scope.clone());
        generator.describe_function(function, tree);
        if function.needs_new() && specialization == Specialization::Call {
            generator.constructor_called_without_new();
        } else if function.origin.contains(Origin::DEFAULT_CONSTRUCTOR) {
            generator.default_constructor();
        } else {
            generator.function_code();
        }
        generator.finish()
    }

    /// The function that the tree of `Goal::SingleFunction` declares.
    pub(crate) fn single_function(
        &mut self,
        environment: &Environment<'_>,
        ast: &Ast,
        outer: Option<Rc<StaticScope>>,
    ) -> Option<FunctionInfo> {
        let StmtKind::Function(function) = ast[ast.get(ast.root.tree.body, 0)?].kind else {
            return None;
        };
        let mut generator = Generator::new(self, environment, ast, CodeKind::Script, outer);
        Some(generator.function_info(&ast[function], 0))
    }
}

impl<'a> Generator<'a> {
    fn new(
        buffers: &'a mut Buffers,
        environment: &Environment<'a>,
        ast: &'a Ast,
        kind: CodeKind,
        outer: Option<Rc<StaticScope>>,
    ) -> Generator<'a> {
        buffers.reset(ast.names.limit());
        Generator {
            ast,
            tree: &ast.root.tree,
            source: environment.source,
            text: environment.source.text(),
            host: environment.host,
            b: buffers,
            stack_limit: environment.stack_limit,
            failure: None,
            kind,
            function_kind: FunctionKind::Normal,
            function_flags: FunctionFlags::empty(),
            function: None,
            flags: CodeFlags::empty(),
            origin: Origin::empty(),
            visibility: Visibility::Public,
            context: EvalContext::empty(),
            suspension: Suspension::None,
            is_strict: ast.root.tree.features.contains(Features::STRICT),
            debugs: environment.debugs,
            covers: environment.covers,
            top: 1,
            locals: 1,
            parameters: 1,
            this: This::Register(Register::THIS),
            new_target: None,
            generator: None,
            arguments: Arguments::None,
            lazy_rest: None,
            chain: outer.clone(),
            outer,
            outer_depth: 0,
            created_at: 0,
            scope: Register::SCOPE,
            barrier: None,
            closure_position: None,
            depth: 0,
            evaluated: None,
            targets: Targets::default(),
            first_label_of_loop: usize::MAX,
            last_jump: 0,
            epilogue: None,
            body_top: 0,
            tail_blockers: 0,
            base_try_depth: 0,
            suspensions: 0,
            statements_end: u32::MAX,
            is_in_case_test: false,
            last_hook: None,
        }
    }

    fn describe_function(&mut self, function: &'a FunctionInfo, tree: &'a ast::Tree) {
        let (kind, flags) = (function.kind, function.flags);
        self.tree = tree;
        self.function = Some(function);
        self.function_kind = kind;
        self.function_flags = flags;
        self.origin = function.origin;
        self.visibility = function.visibility;
        self.created_at = function.created_at;
        self.is_strict = function.is_strict();
        self.context = function.eval_context();
        self.suspension = match (function.is_async(), function.is_generator()) {
            (false, false) => Suspension::None,
            (false, true) => Suspension::Generator,
            (true, false) => Suspension::AsyncFunction,
            (true, true) => Suspension::AsyncGenerator,
        };
        if function.is_generator() || self.tree.features.contains(Features::AWAITS) {
            self.flags |= CodeFlags::SUSPENDS;
        }
        if function.origin.contains(Origin::NO_POSITIONS) {
            self.debugs = false;
            self.asm().set_records_positions(false);
        }
    }

    fn finish(mut self) -> Result<Rc<Code>, Failure> {
        self.emit_deferred_handlers();
        while let Some(allocation) = self.b.allocations.pop() {
            self.patch_capacity(&allocation);
        }
        if let Some(failure) = self.failure.take() {
            return Err(failure);
        }
        let mut flags = self.flags;
        flags.set(CodeFlags::STRICT, self.is_strict);
        flags.set(CodeFlags::BUILTIN, self.origin.contains(Origin::BUILTIN));
        flags.set(CodeFlags::HAS_DEBUG_HOOKS, self.debugs);
        flags.set(CodeFlags::HAS_COVERAGE, self.covers);
        let locals = self.locals.next_multiple_of(2);
        let body = (self.b.asm)
            .finish(self.kind, flags, locals, self.parameters)
            .map_err(|_| Failure::TooLarge)?;
        let buffers = self.b;
        let functions = if buffers.functions.is_empty() {
            Rc::clone(&buffers.no_functions)
        } else {
            buffers.functions.drain(..).collect()
        };
        for (index, tree) in buffers.trees.drain(..) {
            let function = FunctionRef::new(Rc::clone(&functions), index.0);
            buffers.waiting.push((function, tree));
        }
        Ok(Rc::new(Code {
            body,
            identifiers: buffers.identifiers.drain(..).collect(),
            constants: buffers.constants.drain(..).collect(),
            functions,
            scopes: buffers.scopes.drain(..).collect(),
            name_lists: buffers.name_lists.drain(..).collect(),
            string_switches: buffers.string_switches.drain(..).collect(),
            machine_code: Default::default(),
        }))
    }

    // Scripts and `eval` code

    fn declarations(&mut self) -> Declarations {
        let ast = self.ast;
        let Some(scope) = (self.tree.scope).filter(|&it| ast[it].kind == ast::ScopeKind::Script)
        else {
            return Declarations::default();
        };
        let is_script = self.kind == CodeKind::Script;
        let mut names = |select: &dyn Fn(BindingKind, BindingFlags) -> bool| -> Box<[Identifier]> {
            (ast.bindings(scope).iter())
                .filter(|it| select(it.kind, it.flags))
                .map(|it| self.make_identifier(it.name))
                .collect()
        };
        let is_function = BindingFlags::FUNCTION | BindingFlags::HOISTED;
        Declarations {
            variables: names(&|kind, flags| {
                kind == BindingKind::Var && !flags.intersects(is_function)
            }),
            functions: names(&|_, flags| flags.contains(BindingFlags::FUNCTION)),
            hoisted_functions: names(&|_, flags| flags.contains(BindingFlags::HOISTED)),
            lets: names(&|kind, _| is_script && kind == BindingKind::Let),
            constants: names(&|kind, _| is_script && kind == BindingKind::Const),
        }
    }

    fn script_code(&mut self) {
        let ast = self.ast;
        let Some(scope) = self.tree.scope else {
            return;
        };
        let owns_variables = ast[scope].kind != ast::ScopeKind::Script;
        let variables = self.reserve_variables([owns_variables.then_some(scope), None]);
        self.asm().enter(variables);
        if self.kind == CodeKind::Eval {
            self.inherit_context();
        }
        self.enter_script_scope(scope, owns_variables);
        if owns_variables {
            self.instantiate_functions(scope);
        } else {
            self.declare_outer_functions(scope);
        }
        self.program_body(true);
    }

    fn enter_script_scope(&mut self, scope: ScopeId, owns_variables: bool) {
        let ast = self.ast;
        let inherits_this = self.resolve_outer_internal(Name::THIS_VALUE).is_some();
        let is_eval = self.kind == CodeKind::Eval;
        let owned = || {
            ast.bindings(scope).iter().filter(move |it| match it.kind {
                BindingKind::Internal => !inherits_this,
                BindingKind::Var => owns_variables,
                _ => is_eval,
            })
        };
        let is_captured = |it: &ast::Binding| it.flags.contains(BindingFlags::CAPTURED);
        if owned().any(is_captured) {
            let register = self.temp();
            let mut layout = Layout::new(if owns_variables {
                ScopeKind::Function
            } else {
                ScopeKind::Program
            });
            for is_variable in [true, false] {
                for binding in owned() {
                    if is_captured(binding) && (binding.kind == BindingKind::Var) == is_variable {
                        let slot = self.add_slot(&mut layout, binding);
                        self.bind_slot(binding, register, slot);
                    }
                }
                if is_variable {
                    layout.end_undefined_slots();
                }
            }
            self.create_scope(layout, register);
        }
        let mut next_variable = 1;
        for binding in owned() {
            if !is_captured(binding) {
                self.bind_frame_variable(binding, &mut next_variable);
            } else if binding.kind == BindingKind::Internal {
                self.initialize_internal(binding);
            }
        }
    }

    fn declare_outer_functions(&mut self, scope: ScopeId) {
        let ast = self.ast;
        let value = self.temp();
        for function in ast.iter(ast[scope].functions) {
            let name = self.declared_name(function);
            self.new_function(value, function, 0);
            if self.kind == CodeKind::Eval {
                let name = self.identifier(name);
                self.asm().put_hoisted(Register::SCOPE, name, value);
            } else {
                self.put(Place::Global, name, None, value.into());
            }
        }
        self.top -= 1;
    }

    fn program_body(&mut self, keeps_completion_value: bool) {
        let root = self.tree;
        self.debug_hook(DebugHook::WillExecuteProgram, root.start);
        let (completion, undefined) = (
            keeps_completion_value.then(|| self.temp()),
            self.undefined(),
        );
        if let Some(completion) = completion {
            self.asm().mov(completion, undefined);
        }
        if self.kind != CodeKind::Eval {
            self.cover(root.start, 0);
        }
        self.with_disposal(root.scope, |generator| {
            generator.statements(root.body, completion, root.end);
        });
        self.debug_hook(DebugHook::DidExecuteProgram, root.end);
        self.leave_frame(completion.map_or(undefined, Operand::from));
    }

    // Modules

    fn module_code(&mut self, keeps_completion_value: bool) -> Rc<StaticScope> {
        let Some(id) = self.tree.scope else {
            return self.chain_scope(Layout::new(ScopeKind::Module), Register::SCOPE);
        };
        let variables = self.reserve_variables([Some(id), None]);
        self.asm().enter(variables);
        let mut handler = None;
        if self.tree.features.contains(Features::AWAITS) {
            self.flags |= CodeFlags::SUSPENDS;
            self.suspension = Suspension::AsyncFunction;
            self.asm().resume_dispatch();
            self.generator = Some(self.temp());
            handler = Some(self.begin_async_function());
        }
        let scope = self.enter_module_scope(id);
        self.instantiate_functions(id);
        self.program_body(keeps_completion_value);
        if let Some(handler) = handler {
            self.end_suspending_code(handler);
        }
        scope
    }

    fn enter_module_scope(&mut self, id: ScopeId) -> Rc<StaticScope> {
        let ast = self.ast;
        let bindings = ast.bindings(id);
        let in_scope = |it: &ast::Binding| {
            it.flags.contains(BindingFlags::CAPTURED)
                || matches!(
                    it.kind,
                    BindingKind::Import | BindingKind::ImportNamespace | BindingKind::Internal
                )
        };
        let mut layout = Layout::new(ScopeKind::Module);
        for binding in bindings {
            if binding.kind == BindingKind::Var && in_scope(binding) {
                let slot = self.add_slot(&mut layout, binding);
                self.bind_slot(binding, Register::SCOPE, slot);
            }
        }
        layout.end_undefined_slots();
        let mut functions = ast.iter(ast[id].functions);
        let mut lazy_functions = Vec::new();
        for binding in bindings {
            if binding.kind == BindingKind::LexicalFunction {
                let function = functions.next();
                if in_scope(binding) {
                    let index = lazy_functions.len() as u32;
                    lazy_functions.extend(function);
                    let slot = self.add_lazy_function_slot(&mut layout, binding, index);
                    self.bind_slot(binding, Register::SCOPE, slot);
                    self.make_last_binding_lazy();
                }
            } else if binding.kind != BindingKind::Var && in_scope(binding) {
                let slot = self.add_slot(&mut layout, binding);
                match binding.kind {
                    BindingKind::Import => self.bind(binding, Place::Import { depth: 0, slot }),
                    _ => self.bind_slot(binding, Register::SCOPE, slot),
                }
            }
        }
        let scope = self.chain_scope(layout, Register::SCOPE);
        for function in lazy_functions {
            let info = self.function_info(&ast[function], 0);
            self.add_function(info);
        }
        let mut next_variable = 1;
        for binding in bindings {
            if !in_scope(binding) {
                self.bind_frame_variable(binding, &mut next_variable);
            }
        }
        scope
    }

    fn module_slot(&mut self, name: Name) -> u32 {
        match self.resolve_declared(name) {
            Place::Slot { slot, .. } | Place::Import { slot, .. } => slot,
            _ => 0,
        }
    }

    fn requests(&self) -> Box<[ModuleRequest]> {
        let ast = self.ast;
        let request = |it: &ast::ModuleRequest| {
            let keys = ast.iter(it.attributes).flatten().step_by(2);
            let values = ast.iter(it.attributes).flatten().skip(1).step_by(2);
            ModuleRequest {
                specifier: self.atom(it.specifier),
                attributes: (keys.zip(values))
                    .map(|(key, value)| (self.atom(key), self.atom(value)))
                    .collect(),
                phase: if it.is_deferred {
                    ImportPhase::Defer
                } else {
                    ImportPhase::Evaluation
                },
            }
        };
        ast.root.module.requests.iter().map(request).collect()
    }

    fn imports(&mut self) -> Box<[ImportEntry]> {
        (self.ast.root.module.imports.iter())
            .map(|it| ImportEntry {
                request: it.request,
                imported: it.imported.map(|name| self.atom(name)),
                local: self.atom(it.local),
                slot: self.module_slot(it.local),
            })
            .collect()
    }

    fn exports(&mut self) -> Box<[ExportEntry]> {
        (self.ast.root.module.exports.iter())
            .map(|&it| match it {
                ast::Export::Local { exported, local } => ExportEntry::Local {
                    exported: self.atom(exported),
                    slot: self.module_slot(local),
                },
                ast::Export::Indirect {
                    exported,
                    request,
                    imported,
                } => ExportEntry::Indirect {
                    exported: self.atom(exported),
                    request,
                    imported: imported.map(|name| self.atom(name)),
                },
                ast::Export::Star { request } => ExportEntry::Star { request },
            })
            .collect()
    }
}
