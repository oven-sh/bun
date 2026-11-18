//! PerformEval of ECMA-262.

use core::hash::{Hash, Hasher};
use std::rc::Rc;

use bun_engine_bytecode::{Declarations, EvalContext, StaticScope};
use bun_engine_text::{StringRef, Text, names};

use crate::realm::Declarer;
use crate::scope::{VariableScope, static_scope_of};
use crate::{
    CodeBlock, Cx, ErrorType, EvalExecutable, Gc, JsCell, JsResult, SourceCode, SourceProvider,
    SourceProviderRef, SourceType, StackVisitor, Value, Vm, create_compile_error, errors, json,
    options,
};

#[derive(Clone)]
pub(super) struct EvalKey {
    text: StringRef,
    scope: Option<Rc<StaticScope>>,
    context: EvalContext,
}

impl PartialEq for EvalKey {
    fn eq(&self, other: &EvalKey) -> bool {
        self.scope.as_ref().map(Rc::as_ptr) == other.scope.as_ref().map(Rc::as_ptr)
            && self.context == other.context
            && self.text == other.text
    }
}

impl Eq for EvalKey {}

impl Hash for EvalKey {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.text.hash(state);
    }
}

// SAFETY: text and what is known of scopes before they exist.
unsafe impl crate::heap::PlainKey for EvalKey {}

const MAX_CACHED_EVALS: usize = 64;

/// What text that the running native function turns into code has for an origin.
pub fn origin_of_caller(vm: &Vm) -> Option<SourceProviderRef> {
    StackVisitor::frames(vm)
        .skip(1)
        .take_while(|frame| frame.callee.is_some())
        .filter_map(|frame| Some(frame.code_block?.executable()))
        .find(|executable| !executable.is_private_builtin())
        .map(|executable| SourceProviderRef::retain(executable.provider().origin()))
}

pub(super) fn generated_source(
    vm: &Vm,
    text: StringRef,
    origin: Option<&SourceProvider>,
) -> SourceCode {
    (vm.heap).count_extra_memory_allocated(size_of::<SourceProvider>() + text.len());
    let provider = SourceProvider::build(text, None, SourceType::Program);
    SourceCode::whole(provider.origin(origin).finish())
}

/// The value of a program that is JSON text, in parentheses or not, takes no code to find.
fn evaluate_data(cx: &Cx, program: Text<'_>) -> JsResult<Option<Value>> {
    let program = program.trim_matches(|unit| matches!(unit, 0x20 | 0x09 | 0x0a | 0x0d));
    let data = match program.get(0).map(u8::try_from) {
        Some(Ok(b'(')) if program.ends_with(Text::from_ascii(")")) => {
            program.slice(1..program.len() - 1)
        }
        Some(Ok(b'[' | b'"' | b'-' | b'0'..=b'9')) => program,
        _ => return Ok(None),
    };
    let value = json::try_parse(cx, data.into())?;
    // In a literal, `__proto__` sets the prototype however it is spelled.
    let may_set_prototype =
        || data.contains(names::__proto__.text()) || data.contains(Text::from_ascii("\\u"));
    Ok(value.filter(|it| !it.is_object() || !may_set_prototype()))
}

impl Cx {
    /// HostEnsureCanCompileStrings
    pub fn ensure_can_compile_strings(&self) -> JsResult<()> {
        let message = self.global().eval_disabled_message().borrow().clone();
        match message {
            Some(message) => Err(self.throw_error(ErrorType::EvalError, message)),
            None => Ok(()),
        }
    }

    /// Before anything is done on behalf of code from that text.
    #[inline]
    pub(crate) fn ensure_can_run(&self, provider: &SourceProvider) -> JsResult<()> {
        if !options().runs_only_static_code || provider.is_static() {
            return Ok(());
        }
        let message = self.global().eval_disabled_message().borrow().clone();
        let message = message.filter(|it| !it.is_empty()).unwrap_or_else(|| {
            StringRef::from_literal("Code generation from strings disallowed for this context")
        });
        Err(self.throw_error(ErrorType::EvalError, message))
    }
}

/// `scope` is the one that `caller` is in where it calls `eval`, and `context` is what the code there allows.
pub fn direct_eval(
    cx: &mut Cx,
    caller: &CodeBlock,
    program: Value,
    scope: Gc<JsCell>,
    context: EvalContext,
) -> JsResult<Value> {
    let Some(program) = program.as_string() else {
        return Ok(program);
    };
    cx.ensure_can_compile_strings()?;
    let key = EvalKey {
        text: program.to_string_ref(cx)?,
        scope: static_scope_of(scope),
        context,
    };
    let caller = caller.executable();
    if let Some(executable) = caller.evals().get(&key) {
        return execute(cx, executable, scope);
    }
    if let Some(value) = evaluate_data(cx, key.text.text())? {
        return Ok(value);
    }
    let source = generated_source(cx, key.text.clone(), Some(caller.provider()));
    let eval = cx.compile_direct_eval(&source.provider, context, key.scope.as_ref());
    let eval = eval.map_err(|error| cx.throw(create_compile_error(cx, &error).into()))?;
    let executable = EvalExecutable::create(cx, &source, eval);
    if !executable.unit().is_reusable || caller.evals().len() >= MAX_CACHED_EVALS {
        return execute_once(cx, executable, scope);
    }
    caller.evals().insert(key, executable);
    execute(cx, executable, scope)
}

/// For text that is not the argument of a call.
pub(crate) fn evaluate_in_scope(
    cx: &mut Cx,
    text: StringRef,
    origin: &SourceProvider,
    scope: Gc<JsCell>,
    context: EvalContext,
) -> JsResult<Value> {
    let source = generated_source(cx, text, Some(origin));
    let outer = static_scope_of(scope);
    let eval = cx.compile_direct_eval(&source.provider, context, outer.as_ref());
    let eval = eval.map_err(|error| cx.throw(create_compile_error(cx, &error).into()))?;
    execute_once(cx, EvalExecutable::create(cx, &source, eval), scope)
}

/// What `eval` does when it is called as any function is.
pub fn indirect_eval(cx: &mut Cx, program: Value) -> JsResult<Value> {
    let Some(program) = program.as_string() else {
        return Ok(program);
    };
    let text = program.to_string_ref(cx)?;
    cx.ensure_can_compile_strings()?;
    if let Some(value) = evaluate_data(cx, text.text())? {
        return Ok(value);
    }
    let executable = prepare_indirect_eval(cx, text, origin_of_caller(cx).as_deref())?;
    execute_indirect_eval(cx, executable)
}

/// The first half of `indirect_eval`, for a caller that tells errors in the text from those that it throws.
pub fn prepare_indirect_eval(
    cx: &Cx,
    text: StringRef,
    origin: Option<&SourceProvider>,
) -> JsResult<Gc<EvalExecutable>> {
    let source = generated_source(cx, text, origin);
    match cx.compile_indirect_eval(&source.provider) {
        Ok(eval) => Ok(EvalExecutable::create(cx, &source, eval)),
        Err(error) => Err(cx.throw(create_compile_error(cx, &error).into())),
    }
}

/// Once, in the realm that it was prepared in.
pub fn execute_indirect_eval(cx: &mut Cx, executable: Gc<EvalExecutable>) -> JsResult<Value> {
    execute_once(cx, executable, cx.global().cell())
}

fn execute_once(cx: &mut Cx, executable: Gc<EvalExecutable>, scope: Gc<JsCell>) -> JsResult<Value> {
    let result = execute(cx, executable, scope);
    executable.release_code();
    result
}

fn execute(cx: &mut Cx, executable: Gc<EvalExecutable>, scope: Gc<JsCell>) -> JsResult<Value> {
    cx.check_stack()?;
    cx.ensure_can_run(executable.anchor().provider())?;
    declare(cx, &executable.unit().declarations, scope)?;
    cx.execute(executable.upcast(), scope, cx.global_this().into())
}

/// EvalDeclarationInstantiation. Strict code declares nothing outside itself, and the code makes the functions.
fn declare(cx: &mut Cx, declarations: &Declarations, scope: Gc<JsCell>) -> JsResult<()> {
    let Declarations {
        variables,
        functions,
        hoisted_functions,
        ..
    } = declarations;
    if variables.is_empty() && functions.is_empty() && hoisted_functions.is_empty() {
        return Ok(());
    }
    let target = VariableScope::around(scope);
    for name in variables.iter().chain(functions) {
        if target.is_hidden(name.name()) {
            return Err(errors::throw_naming(
                cx,
                ErrorType::SyntaxError,
                "Can't create duplicate variable in eval: '",
                name.name(),
                "'",
                "Can't create duplicate variable in eval",
            ));
        }
    }
    let hoisted = (hoisted_functions.iter()).filter(|name| !target.is_hidden(name.name()));
    if let Some(environment) = target.environment() {
        for name in hoisted.chain(functions).chain(variables) {
            environment.declare_eval_variable(cx, name.name());
        }
        return Ok(());
    }
    let global = cx.global();
    global.check_can_declare(cx, declarations)?;
    for name in hoisted {
        if global.can_declare_variable(cx, name.name())? {
            global.declare_variable(cx, name.name(), Declarer::Eval)?;
        }
    }
    global.declare_functions_and_variables(cx, declarations, Declarer::Eval)
}
