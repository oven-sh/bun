//! ScriptEvaluation of ECMA-262.

use std::rc::Rc;

use bun_engine_bytecode::{Declarations, Instructions, Opcode, Script};
use bun_engine_text::PropertyName;

use super::lease::SPECIALIZATIONS;
use crate::realm::Declarer;
use crate::scope::static_scope_of;
use crate::{
    Attributes, Cx, Environment, ErrorType, FunctionExecutable, Gc, InternalMethod, JsCell,
    JsFunction, JsResult, ProgramExecutable, PropertySlot, SourceCode, Thrown, Value, errors,
    throw_compile_error,
};

/// In the realm of `this`, which is the global object of `cx` if it is undefined or null.
pub fn evaluate_script(cx: &mut Cx, source: &SourceCode, this: Value) -> JsResult<Value> {
    let this = this.to_sloppy_this(cx);
    let cx = cx.in_realm_of(&this);
    evaluate_script_in_scope(cx, source, cx.global().cell(), this.into())
}

/// `scope` is one of the realm of `cx`.
pub fn evaluate_script_in_scope(
    cx: &mut Cx,
    source: &SourceCode,
    scope: Gc<JsCell>,
    this: Value,
) -> JsResult<Value> {
    let script = compile(cx, source, scope)?;
    // SAFETY: just compiled from it.
    unsafe { evaluate_compiled_script(cx, source, script, scope, this) }
}

fn compile(cx: &mut Cx, source: &SourceCode, scope: Gc<JsCell>) -> JsResult<Rc<Script>> {
    cx.check_stack()?;
    cx.ensure_can_run(&source.provider)?;
    let script = cx.compile_script(&source.provider, static_scope_of(scope).as_ref());
    script.map_err(|error| {
        let thrown = throw_compile_error(cx, &error, &source.provider);
        cx.notify_debugger_of_exception();
        thrown
    })
}

fn only_makes_functions(script: &Script) -> bool {
    use Opcode::{Cover, Debug, Enter, Move, NewFunction, Return};
    let code = script.code.body.instructions();
    Instructions::new(code, 0..code.len() as u32).all(|(_, it)| {
        matches!(
            it.opcode,
            Enter | Move | NewFunction | Return | Debug | Cover
        )
    })
}

/// In the global scope. If the result is a function at the top level of the script that has not run, it has `scope`
/// around it.
pub fn evaluate_script_to_function_in(
    cx: &mut Cx,
    source: &SourceCode,
    scope: Gc<Environment>,
) -> JsResult<Value> {
    let (this, global) = (cx.global_this().into(), cx.global().cell());
    let script = compile(cx, source, scope.cell())?;
    if only_makes_functions(&script) {
        // SAFETY: just compiled from it.
        return unsafe { evaluate_compiled_script(cx, source, script, scope.cell(), this) };
    }
    let result = evaluate_script_in_scope(cx, source, global, this)?;
    let executable = (result.downcast::<JsFunction>())
        .and_then(|it| it.executable().downcast::<FunctionExecutable>())
        .filter(|it| core::ptr::eq(&raw const **it.provider(), &raw const *source.provider))
        .filter(|it| it.info().has_no_outer_scope())
        .filter(|it| SPECIALIZATIONS.map(|kind| it.code_block(kind)) == [None; 2]);
    Ok(executable.map_or(result, |executable| {
        let moved = executable.moved_to(cx, Rc::clone(scope.template().scope()));
        // SAFETY: made for it.
        unsafe { JsFunction::create(cx, moved, scope.cell()) }.into()
    }))
}

/// # Safety
/// `script` was compiled from the text of `source`.
pub unsafe fn evaluate_compiled_script(
    cx: &mut Cx,
    source: &SourceCode,
    script: Rc<Script>,
    scope: Gc<JsCell>,
    this: Value,
) -> JsResult<Value> {
    cx.ensure_can_run(&source.provider)?;
    let executable = ProgramExecutable::create(cx, source, script);
    declare_globals(cx, &executable.unit().declarations)
        .inspect_err(|_| cx.notify_debugger_of_exception())?;
    let global = cx.global();
    if global.shape().is_uncacheable_dictionary() {
        global.flatten_dictionary(cx);
    }
    let result = cx.execute(executable.upcast(), scope, this);
    executable.release_code();
    result
}

#[cold]
fn throw_duplicate(cx: &Cx, name: PropertyName<'_>) -> Thrown {
    let (before, fallback) = (
        "Can't create duplicate variable: '",
        "Can't create duplicate variable",
    );
    errors::throw_naming(cx, ErrorType::SyntaxError, before, name, "'", fallback)
}

/// GlobalDeclarationInstantiation. The code makes the functions.
fn declare_globals(cx: &mut Cx, declarations: &Declarations) -> JsResult<()> {
    let _defer = cx.defer_termination();
    let global = cx.global();
    let Declarations {
        variables,
        functions,
        hoisted_functions,
        lets,
        constants,
    } = declarations;
    for name in lets.iter().chain(constants) {
        if global.lexicals().find(name.name()).is_some() {
            if cx.allows_redeclaration() {
                continue;
            }
            return Err(throw_duplicate(cx, name.name()));
        }
        let mut slot = PropertySlot::new(global.into(), InternalMethod::GetOwnProperty);
        if global.get_own_property_slot(cx, name.name(), &mut slot)?
            && !slot.attributes().is_configurable()
        {
            return Err(errors::throw_naming(
                cx,
                ErrorType::SyntaxError,
                "Can't create duplicate variable that shadows a global property: '",
                name.name(),
                "'",
                "Can't create duplicate variable that shadows a global property",
            ));
        }
    }
    for name in functions.iter().chain(variables) {
        if global.lexicals().find(name.name()).is_some() {
            return Err(throw_duplicate(cx, name.name()));
        }
    }
    global.check_can_declare(cx, declarations)?;
    for name in hoisted_functions {
        if global.lexicals().find(name.name()).is_none()
            && global.can_declare_variable(cx, name.name())?
        {
            global.declare_variable(cx, name.name(), Declarer::Script)?;
        }
    }
    global.declare_functions_and_variables(cx, declarations, Declarer::Script)?;
    for (names, attributes) in [(lets, Attributes::NONE), (constants, Attributes::READ_ONLY)] {
        for name in names {
            if global.lexicals().find(name.name()).is_none() {
                global.add_lexical(cx, name.name(), attributes);
            } else if !cx.allows_redeclaration() {
                // By a script that the global object has run in the meantime.
                return Err(throw_duplicate(cx, name.name()));
            }
        }
    }
    Ok(())
}
