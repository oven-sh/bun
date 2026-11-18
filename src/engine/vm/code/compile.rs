//! From source text to code that is not linked to a realm yet.

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_engine_bytecode::{
    Code, CodeFlags, Compiler, Dump, Eval, EvalContext, FunctionRef, Instrumentation, Module,
    Origin, Request, ScopeKind, Script, Specialization, StaticScope, verify,
};
pub use bun_engine_syntax::{
    Error as CompileError, ErrorKind as CompileErrorKind, Recovery as CompileErrorRecovery,
};
use bun_engine_syntax::{KnownCapture, KnownFunction, LineTable, PausePosition, SourceCache};

use super::cache::{CodeCache, Goal, Key, Unit};
use crate::heap::Scope;
use crate::{
    Cx, ErrorInstance, ErrorType, FastHashMap, FunctionExecutable, Gc, GlobalObject, JsResult,
    Message, SourceProvider, SourceProviderRef, SourceType, Thrown, Vm, options,
};

#[derive(Default)]
pub(super) struct Compilation {
    compiler: RefCell<Option<Box<Compiler>>>,
    /// The longest text that it has been given, and that since the last collection.
    longest_text: Cell<u32>,
    longest_recent_text: Cell<u32>,
    /// By the address of the provider: what is valid in a text depends on what it is parsed as.
    source_caches: RefCell<FastHashMap<usize, KeptSourceCache>>,
    code_cache: RefCell<CodeCache>,
    covers: Cell<bool>,
    records_origins: Cell<bool>,
}

struct KeptSourceCache {
    _provider: SourceProviderRef,
    cache: SourceCache,
    was_used: bool,
}

type Outer<'a> = Option<&'a Rc<StaticScope>>;

/// And the code of inner functions that has come with it.
fn check(code: &Code, scope: Outer<'_>, provider: &SourceProvider) {
    if options().log_compilation {
        let hash = provider.hash();
        bun_engine_platform::log(format_args!("Compiled #{hash:08x} into bytecode\n"));
    }
    if !options().dump_bytecode && !options().validate_bytecode {
        return;
    }
    if options().dump_bytecode {
        let dump = Dump::new(code, provider.text());
        bun_engine_platform::log(format_args!("{dump}\n"));
    }
    if options().validate_bytecode
        && let Err(error) = verify(code, scope.map(|it| &**it))
    {
        panic!("{error:?} in\n{}", Dump::new(code, provider.text()));
    }
    for function in &*code.functions {
        if let Some(inner) = function.code(Specialization::Call) {
            check(&inner, function.outer_scope(), provider);
        }
    }
}

impl Vm {
    /// Whether code counts the executions of its blocks.
    pub fn collects_coverage(&self) -> &Cell<bool> {
        &self.services.code.compilation.covers
    }

    /// Whether what is compiled to machine code can answer `CompiledCode::origin_of_address`.
    pub fn records_code_origins(&self) -> &Cell<bool> {
        &self.services.code.compilation.records_origins
    }

    pub fn clear_code_cache(&self) {
        self.services
            .code
            .compilation
            .code_cache
            .borrow_mut()
            .clear();
        self.forget_static_builtins();
    }

    pub fn clear_source_caches(&self) {
        self.services.code.compilation.source_caches.take();
        self.services.code.compilation.compiler.take();
    }

    /// Before anything in the text is compiled. See `SourceCache::add_known`.
    pub fn add_known_functions(
        &self,
        provider: &SourceProvider,
        functions: &[KnownFunction],
        captures: &[KnownCapture],
    ) {
        if !options().use_source_cache {
            return;
        }
        let source = provider.source();
        let mut kept = KeptSourceCache {
            _provider: SourceProviderRef::retain(provider),
            cache: SourceCache::default(),
            was_used: true,
        };
        kept.cache.add_known(source.len(), functions, captures);
        let mut caches = self.services.code.compilation.source_caches.borrow_mut();
        caches.insert(core::ptr::from_ref(provider).addr(), kept);
    }

    /// If it has grown for texts that are much longer than those that it gets now.
    pub(super) fn release_compiler(&self, scope: Scope) {
        const LONG: u32 = 1 << 14;
        let state = &self.services.code.compilation;
        let (longest, recent) = (state.longest_text.get(), state.longest_recent_text.take());
        if recent <= longest / 8 && (longest >= LONG || scope == Scope::Full) {
            state.longest_text.set(0);
            state.compiler.take();
        }
    }

    /// Of what has not been used for a while.
    pub(super) fn prune_compilation_caches(&self) {
        let state = &self.services.code.compilation;
        let mut caches = state.source_caches.borrow_mut();
        caches.retain(|_, kept| core::mem::take(&mut kept.was_used));
        state.code_cache.borrow_mut().prune();
    }

    pub fn code_cache_max_entries(&self) -> usize {
        let cache = self.services.code.compilation.code_cache.borrow();
        cache.max_entries()
    }

    /// For an embedder that loads the same sources into one realm after another. Never below the default.
    pub fn set_code_cache_max_entries(&self, count: usize) {
        let mut cache = self.services.code.compilation.code_cache.borrow_mut();
        cache.set_max_entries(count);
    }

    pub(super) fn with_compiler<T>(
        &self,
        provider: &SourceProvider,
        instrumentation: Instrumentation,
        compile: impl FnOnce(&mut Compiler, Request<'_>) -> T,
    ) -> T {
        /// It takes less to read a shorter text again.
        const SHORT: usize = 512;
        let state = &self.services.code.compilation;
        let source = provider.source();
        let mut caches = state.source_caches.borrow_mut();
        let mut new_cache = SourceCache::default();
        let needs_cache = source.len() >= SHORT && options().use_source_cache;
        let request = Request {
            source,
            cache: match caches.get_mut(&core::ptr::from_ref(provider).addr()) {
                Some(kept) => {
                    kept.was_used = true;
                    Some(&mut kept.cache)
                }
                None => needs_cache.then_some(&mut new_cache),
            },
            host: self,
            instrumentation,
            stack_limit: self.hard_stack_limit(),
        };
        let mut compiler = state.compiler.borrow_mut();
        let compiler = compiler.get_or_insert_default();
        let result = compile(compiler, request);
        for longest in [&state.longest_text, &state.longest_recent_text] {
            longest.update(|it| it.max(compiler.last_text_length()));
        }
        if !new_cache.is_empty() {
            let kept = KeptSourceCache {
                _provider: SourceProviderRef::retain(provider),
                cache: new_cache,
                was_used: true,
            };
            caches.insert(core::ptr::from_ref(provider).addr(), kept);
        }
        result
    }

    fn compile_unit(
        &self,
        key: &Key<'_>,
        compile: impl FnOnce(&mut Compiler, Request<'_>) -> Result<Unit, CompileError>,
    ) -> Result<Unit, CompileError> {
        let cache = &self.services.code.compilation.code_cache;
        // Each `with` scope around a whole text is made for the occasion.
        let uses_cache =
            options().use_code_cache && key.outer.is_none_or(|it| it.kind() != ScopeKind::With);
        let cached = uses_cache.then(|| cache.borrow_mut().find(key));
        let unit = match cached.flatten() {
            Some(unit) => unit,
            None => {
                let stored = self.load_unit(key);
                if key.goal == Goal::Script {
                    super::log_origin_of_code(stored.is_some());
                }
                let unit = match stored {
                    Some(unit) => unit,
                    None => self.with_compiler(key.provider, key.instrumentation, compile)?,
                };
                // While the text is in the caches of the machine.
                let prepared = LineTable::SHORTEST_TEXT_TO_PREPARE..CodeCache::MAX_SIZE;
                if prepared.contains(&key.provider.text().len()) {
                    key.provider.lines();
                }
                if uses_cache {
                    cache.borrow_mut().add(key, unit.clone());
                }
                unit
            }
        };
        key.provider.set_directives(unit.directives());
        Ok(unit)
    }

    pub fn check_script_syntax(&self, provider: &SourceProvider) -> Result<(), CompileError> {
        self.with_compiler(provider, Instrumentation::empty(), |compiler, request| {
            compiler.check_syntax(request, false)
        })
    }

    /// Where a debugger can pause in a script or a module. None if the text is neither.
    pub fn pause_positions(&self, provider: &SourceProvider) -> Vec<PausePosition> {
        let is_module = match provider.source_type() {
            SourceType::Program => false,
            SourceType::Module | SourceType::AnalyzedModule => true,
            _ => return Vec::new(),
        };
        self.with_compiler(provider, Instrumentation::empty(), |compiler, request| {
            (compiler.pause_positions(&request, is_module)).unwrap_or_default()
        })
    }

    pub fn check_module_syntax(&self, provider: &SourceProvider) -> Result<(), CompileError> {
        self.with_compiler(provider, Instrumentation::empty(), |compiler, request| {
            compiler.check_syntax(request, true)
        })
    }
}

impl GlobalObject {
    /// What code that is compiled for the realm has in it besides the program.
    pub fn instrumentation(&self, vm: &Vm) -> Instrumentation {
        let mut instrumentation = Instrumentation::empty();
        instrumentation.set(Instrumentation::DEBUGGER, self.needs_debug_hooks().get());
        instrumentation.set(Instrumentation::COVERAGE, vm.collects_coverage().get());
        instrumentation
    }
}

impl Cx {
    fn key<'a>(&self, provider: &'a SourceProvider, goal: Goal, outer: Outer<'a>) -> Key<'a> {
        Key {
            provider,
            goal,
            instrumentation: self.global().instrumentation(self),
            outer,
        }
    }

    fn did_parse<T>(&self, provider: &SourceProvider, result: &Result<T, CompileError>) {
        if let Some(debugger) = self.global().debugger() {
            debugger.did_parse(self, provider, result.as_ref().err());
        }
    }

    /// `outer` is what lies between the code and the global scope, here and below.
    pub fn compile_script(
        &self,
        provider: &SourceProvider,
        outer: Outer<'_>,
    ) -> Result<Rc<Script>, CompileError> {
        let key = self.key(provider, Goal::Script, outer);
        let result = self.compile_unit(&key, |compiler, request| {
            let script = compiler.script(request, false, outer.cloned())?;
            check(&script.code, outer, provider);
            Ok(Unit::Script(Rc::new(script)))
        });
        self.did_parse(provider, &result);
        match result? {
            Unit::Script(script) => Ok(script),
            _ => unreachable!(),
        }
    }

    pub fn compile_module(
        &self,
        provider: &SourceProvider,
        outer: Outer<'_>,
        needs_interface: bool,
    ) -> Result<Rc<Module>, CompileError> {
        let goal = match needs_interface {
            true => Goal::Module,
            false => Goal::AnalyzedModule,
        };
        let key = self.key(provider, goal, outer);
        let result = self.compile_unit(&key, |compiler, request| {
            let module = compiler.module(request, options().eval_mode, outer.cloned())?;
            check(&module.code, Some(&module.scope), provider);
            Ok(Unit::Module(Rc::new(module)))
        });
        self.did_parse(provider, &result);
        match result? {
            Unit::Module(module) => Ok(module),
            _ => unreachable!(),
        }
    }

    pub(super) fn compile_indirect_eval(
        &self,
        provider: &SourceProvider,
    ) -> Result<Rc<Eval>, CompileError> {
        let key = self.key(provider, Goal::Eval, None);
        let result = self.compile_unit(&key, |compiler, request| {
            let eval = compiler.eval(request, EvalContext::empty(), None)?;
            check(&eval.code, None, provider);
            Ok(Unit::Eval(Rc::new(eval)))
        });
        self.did_parse(provider, &result);
        match result? {
            Unit::Eval(eval) => Ok(eval),
            _ => unreachable!(),
        }
    }

    pub(super) fn compile_direct_eval(
        &self,
        provider: &SourceProvider,
        context: EvalContext,
        outer: Outer<'_>,
    ) -> Result<Rc<Eval>, CompileError> {
        let instrumentation = self.global().instrumentation(self);
        let result = self.with_compiler(provider, instrumentation, |compiler, request| {
            compiler.eval(request, context, outer.cloned())
        });
        if let Ok(eval) = &result {
            check(&eval.code, outer, provider);
            provider.set_directives(&eval.directives);
        }
        self.did_parse(provider, &result);
        result.map(Rc::new)
    }

    pub(super) fn compile_single_function(
        &self,
        provider: &SourceProvider,
        parameters_end: Option<u32>,
    ) -> Result<FunctionRef, CompileError> {
        let key = self.key(provider, Goal::Function { parameters_end }, None);
        let result = self.compile_unit(&key, |compiler, request| {
            let (function, directives) = compiler.single_function(request, parameters_end, None)?;
            Ok(Unit::Function(function, Rc::new(directives)))
        });
        self.did_parse(provider, &result);
        match result? {
            Unit::Function(function, _) => Ok(function),
            _ => unreachable!(),
        }
    }
}

impl FunctionExecutable {
    pub(super) fn compile(&self, cx: &Cx, specialization: Specialization) -> JsResult<Rc<Code>> {
        let this = crate::anchor!(self);
        let (function, provider) = (this.info(), this.provider());
        let mut instrumentation = cx.global().instrumentation(cx);
        if function.origin().contains(Origin::NO_POSITIONS) {
            instrumentation = Instrumentation::empty();
        }
        if let Some(code) = function.load_code(specialization, instrumentation, &**cx) {
            let flags = code.body.flags();
            if flags.contains(CodeFlags::HAS_DEBUG_HOOKS)
                == instrumentation.contains(Instrumentation::DEBUGGER)
                && flags.contains(CodeFlags::HAS_COVERAGE)
                    == instrumentation.contains(Instrumentation::COVERAGE)
            {
                return Ok(code);
            }
        }
        let result = cx.with_compiler(provider, instrumentation, |compiler, request| {
            compiler.function(request, function, specialization)
        });
        let code = result.map_err(|error| cx.throw(create_compile_error(cx, &error).into()))?;
        check(&code, function.outer_scope(), provider);
        function.set_code(specialization, Some(Rc::clone(&code)));
        Ok(code)
    }
}

/// Says nothing of where in the text the error is.
#[cold]
pub fn create_compile_error(cx: &Cx, error: &CompileError) -> Gc<ErrorInstance> {
    let instance = match error.kind {
        CompileErrorKind::Syntax => {
            ErrorInstance::new(cx, ErrorType::SyntaxError, Some(error.message.clone()))
        }
        CompileErrorKind::StackOverflow => {
            let was_handling_error = cx.replace_is_handling_error(true);
            let instance = ErrorInstance::stack_overflow(cx);
            cx.replace_is_handling_error(was_handling_error);
            instance
        }
        CompileErrorKind::OutOfMemory => {
            ErrorInstance::out_of_memory(cx, "Out of memory".into_string())
        }
    };
    instance.set_parse_error();
    instance
}

/// With the line and the URL of the text.
#[cold]
pub fn create_compile_error_in(
    cx: &mut Cx,
    error: &CompileError,
    provider: &SourceProvider,
) -> Gc<ErrorInstance> {
    let instance = create_compile_error(cx, error);
    if error.kind == CompileErrorKind::Syntax {
        let line = provider.position_in_document(error.offset).line;
        instance.locate_in_source(cx, line, provider.url());
    }
    instance
}

#[cold]
pub fn throw_compile_error(cx: &mut Cx, error: &CompileError, provider: &SourceProvider) -> Thrown {
    let instance = create_compile_error_in(cx, error, provider);
    cx.throw(instance.into())
}
