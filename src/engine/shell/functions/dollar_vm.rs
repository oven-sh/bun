//! `$vm`: a look into the engine.

use core::time::Duration;

use bun_engine_bytecode::{
    FunctionKind, ImportPhase, ScopeKind, SlotKind, StaticScope, Visibility,
};
use bun_engine_text::{StringWriter, Text, names};
use bun_engine_vm::heap::Scope;
use bun_engine_vm::{
    BuiltinOutline, DontEnumMode, Environment, FunctionExecutable, GlobalObject, GlobalProxy,
    InternalFieldTuple, JsFunction, JsPromise, ModuleLoader, ModuleNamespace, PropertyDescriptor,
    PropertyNameMode, SandboxedGlobalObject, ScopeTemplate, SourceType, StackVisitor, Tier,
    describe_builtin, options, origin_of_caller,
};

use super::tiers::{code_block_of, executable_of};
use super::{buffer_accessors, dollar, heap, io, object_with, return_false, string};
use super::{coverage, define_functions, ffi, heap_profiler, return_undefined, tiers, values};
use super::{tasks, test_objects, wasm};
use crate::files;
use crate::global::define_hidden;
use crate::prelude::*;

const FUNCTIONS: Functions = &[
    ("abort", abort, 0),
    ("crash", abort, 0),
    ("print", io::print, 1),
    ("dataLog", io::print_err, 1),
    ("dumpStack", io::print_stack, 0),
    ("value", values::describe, 1),
    ("assertEnabled", assert_enabled, 0),
    ("isMemoryLimited", return_false, 0),
    // Tiers
    ("llintTrue", caller_is_in::<{ Tier::Interpreter as u8 }>, 0),
    (
        "baselineJITTrue",
        caller_is_in::<{ Tier::Baseline as u8 }>,
        0,
    ),
    ("dfgTrue", caller_is_in::<{ Tier::QuickOptimized as u8 }>, 0),
    ("ftlTrue", caller_is_in::<{ Tier::FullyOptimized as u8 }>, 0),
    ("useJIT", use_jit, 0),
    ("useDFGJIT", use_quick_optimizer, 0),
    ("useFTLJIT", use_full_optimizer, 0),
    ("isWasmSupported", is_wasm_supported, 0),
    ("noInline", tiers::no_inline, 1),
    ("OSRExit", return_undefined, 0),
    ("setStartupJITDeferralScale", set_tier_up_scale, 1),
    ("codeBlockFor", describe_code_block, 1),
    ("codeBlockForFrame", code_block_of_frame, 1),
    ("deleteAllCodeWhenIdle", delete_all_code, 0),
    ("shrinkFootprintWhenIdle", shrink_footprint, 1),
    ("lineStartTableIsBuilt", has_lines, 1),
    // The heap
    ("gc", gc, 0),
    ("gcSweepAsynchronously", gc_without_sweeping, 0),
    ("edenGC", heap::eden_gc, 0),
    ("collectEvery", heap::collect_every, 2),
    ("heapExtraMemorySize", extra_memory_size, 0),
    // Objects
    ("createBufferAccessors", buffer_accessors::create, 0),
    ("indexingMode", indexing_mode, 1),
    ("inlineCapacity", inline_capacity, 1),
    ("allowDoubleShape", return_true, 0),
    ("ensureArrayStorage", values::ensure_array_storage, 1),
    ("haveABadTime", have_a_bad_time, 1),
    ("isHavingABadTime", is_having_a_bad_time, 1),
    ("toCacheableDictionary", to_cacheable_dictionary, 1),
    ("toUncacheableDictionary", to_uncacheable_dictionary, 1),
    ("flattenDictionaryObject", flatten_dictionary, 1),
    ("getConcurrently", is_in_shape, 2),
    ("hasOwnLengthProperty", has_original_name_and_length, 1),
    ("isPrivateSymbol", is_private_symbol, 1),
    ("isAtomString", is_atom, 1),
    ("isDefinitelyAtomString", is_atom, 1),
    ("make16BitStringIfPossible", make_16_bit_string, 1),
    // Functions and realms
    ("createBuiltin", create_builtin, 2),
    ("createEmptyFunctionWithName", create_named_function, 1),
    ("createGlobalObject", create_global_object, 0),
    ("createGlobalProxy", create_global_proxy, 1),
    ("createSandboxedGlobal", create_sandboxed_global, 1),
    ("globalObjectForObject", dollar::global_object_for, 1),
    ("callFromCPP", call_repeatedly, 2),
    ("cachedCallFromCPP", call_repeatedly, 2),
    ("callFromCPPAsFirstEntry", call_repeatedly, 2),
    ("callWithTimeLimit", call_with_time_limit, 2),
    ("cancelTermination", cancel_termination, 0),
    ("hasPendingTermination", has_pending_termination, 0),
    // Promises and modules
    ("markPromiseAsHandled", mark_promise_as_handled, 1),
    ("rejectPromiseAsHandled", reject_promise_as_handled, 1),
    ("asyncContext", async_context, 0),
    ("setAsyncContext", set_async_context, 1),
    ("createModuleLoader", create_module_loader, 2),
    ("moduleLoaderImport", module_loader_import, 2),
    (
        "uninstantiatedFunctionDeclarations",
        count_lazy_functions,
        1,
    ),
    // The host
    ("monotonicTimeNow", tasks::monotonic_now, 0),
    ("approximateTimeNow", tasks::monotonic_now, 0),
    ("overrideDateNow", override_date_now, 1),
    ("setHostTimeZone", set_time_zone, 1),
    ("setUserPreferredLanguages", set_preferred_languages, 1),
    ("icuVersion", icu_version, 0),
    ("icuHeaderVersion", icu_version, 0),
];

pub(super) fn create(cx: &Cx) -> Gc<JsObject> {
    let vm = object_with(cx, FUNCTIONS, Attributes::CONSTANT);
    for functions in [
        coverage::VM_FUNCTIONS,
        ffi::VM_FUNCTIONS,
        heap_profiler::VM_FUNCTIONS,
        test_objects::FUNCTIONS,
        wasm::VM_FUNCTIONS,
    ] {
        define_functions(cx, &vm, functions, Attributes::CONSTANT);
    }
    if ffi::has_fixtures() {
        define_functions(cx, &vm, ffi::FIXTURE_FUNCTIONS, Attributes::CONSTANT);
    }
    let constructor = heap_profiler::simple_object_constructor(cx);
    let name = Identifier::from_literal("SimpleObject");
    vm.put_direct(cx, name.name(), constructor, Attributes::CONSTANT);
    vm
}

macro_rules! answers {
    ($($name:ident($cx:pat, $argument:pat) => $answer:expr;)*) => {$(
        #[native_abi]
        fn $name($cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
            let $argument = frame.argument(0);
            Ok(Value::from($answer))
        }
    )*};
}

answers! {
    return_true(_, _) => true;
    assert_enabled(_, _) => cfg!(debug_assertions);
    use_jit(_, _) => options().use_jit;
    use_quick_optimizer(_, _) => options().use_jit && options().use_quick_optimizer;
    use_full_optimizer(_, _) => options().use_jit && options().use_full_optimizer;
    is_wasm_supported(_, _) => options().use_wasm;
    has_lines(_, function) => executable_of(function).is_some_and(|it| it.provider().has_lines());
    extra_memory_size(cx, _) => cx.heap.extra_memory_size();
    is_private_symbol(_, value) => value.as_symbol().is_some_and(|it| it.name().is_private());
    is_atom(_, value) => value.as_string().is_some_and(|it| it.is_atom());
    cancel_termination(cx, _) => cx.cancel_termination();
    has_pending_termination(cx, _) => cx.has_pending_termination();
    async_context(cx, _) => cx.async_context().fields().at(0);
    icu_version(_, _) => bun_icu::library_version().major;
    inline_capacity(_, value) =>
        value.as_object().map_or_default(|it| Value::from(it.shape().inline_capacity()));
    has_original_name_and_length(_, value) => value
        .downcast::<JsFunction>()
        .is_some_and(|it| !it.has_reified_name() && !it.has_reified_length());
}

macro_rules! actions {
    ($($name:ident($cx:pat, $argument:pat) => $action:expr;)*) => {$(
        #[native_abi]
        fn $name($cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
            let $argument = frame.argument(0);
            $action;
            Ok(Value::UNDEFINED)
        }
    )*};
}

actions! {
    delete_all_code(cx, _) => cx.discard_all_code();
    shrink_footprint(cx, _) => cx.shrink_footprint();
    gc(cx, _) => cx.heap.collect_and_sweep(Some(Scope::Full));
    gc_without_sweeping(cx, _) => cx.heap.collect(Some(Scope::Full));
    flatten_dictionary(cx, value) => value.as_object().inspect(|it| it.flatten_dictionary(cx));
    mark_promise_as_handled(_, promise) => promise.cast::<JsPromise>().mark_as_handled();
    set_tier_up_scale(cx, scale) => {
        let scale = scale.to_number(cx)?;
        cx.set_tier_up_scale(scale);
    };
    override_date_now(cx, time) => {
        let time = time.to_number(cx)?;
        cx.global().overridden_date_now().set(time);
    };
    set_async_context(cx, context) => {
        cx.start_tracking_async_context();
        cx.async_context().fields().set(0, context);
    };
}

#[native_abi]
fn abort(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let _ = io::print_err(cx, frame);
    std::process::abort()
}

#[native_abi]
fn caller_is_in<const TIER: u8>(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    let caller = StackVisitor::frames(cx).nth(1);
    let code_block = caller.and_then(|it| it.machine_frame.code_block());
    Ok(code_block.is_some_and(|it| it.tier() as u8 == TIER).into())
}

/// Of a function, or what `codeBlockForFrame` has returned.
#[native_abi]
fn describe_code_block(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let argument = frame.argument(0);
    let Some(code_block) = argument.downcast().or_else(|| code_block_of(argument)) else {
        return Ok(Value::UNDEFINED);
    };
    let (address, executable) = (code_block.address(), code_block.executable().address());
    let (tier, size) = (code_block.tier(), code_block.body().instructions().len());
    let text = format!("[{address:#x}->{executable:#x}, {tier:?}, {size}]");
    Ok(string(cx, &text))
}

#[native_abi]
fn code_block_of_frame(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let depth = frame.argument(0).as_index_int32().unwrap_or(0) as usize;
    let visited = StackVisitor::frames(cx).nth(depth + 1);
    Ok(visited
        .and_then(|it| it.code_block)
        .map_or_default(Value::from))
}

#[native_abi]
fn indexing_mode(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = frame.argument(0).as_object();
    Ok(object.map_or_default(|it| string(cx, &values::indexing_mode_name(&it))))
}

fn realm_of_argument(cx: &Cx, frame: &CallFrame, caller: &str) -> JsResult<Gc<GlobalObject>> {
    if frame.argument(0).is_undefined() {
        return Ok(cx.global());
    }
    let realm = frame.argument(0).as_object().and_then(|it| it.realm());
    realm.ok_or_else(|| {
        let message = format_args!("{caller} expects first argument to be an object if provided");
        cx.throw_type_error(message)
    })
}

#[native_abi]
fn have_a_bad_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let prototype = realm_of_argument(cx, frame, "haveABadTime")?.object_prototype();
    let index = Identifier::from_index(bun_engine_text::MAX_ARRAY_INDEX);
    let accessor = PropertyDescriptor::accessor(None, None, Attributes::NONE);
    prototype.define_own_property(cx, index.name(), &accessor, false)?;
    prototype.delete(cx, index.name())?;
    Ok(Value::TRUE)
}

#[native_abi]
fn is_having_a_bad_time(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let realm = realm_of_argument(cx, frame, "isHavingABadTime")?;
    Ok(realm.is_having_a_bad_time().into())
}

fn object_argument(cx: &Cx, frame: &CallFrame) -> JsResult<Gc<JsObject>> {
    let object = frame.argument(0).as_object();
    object.ok_or_else(|| cx.throw_type_error("Expected first argument to be an object"))
}

#[native_abi]
fn to_cacheable_dictionary(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    object_argument(cx, frame)?.convert_to_dictionary(cx);
    Ok(frame.argument(0))
}

#[native_abi]
fn to_uncacheable_dictionary(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    object_argument(cx, frame)?.convert_to_uncacheable_dictionary(cx);
    Ok(frame.argument(0))
}

#[native_abi]
fn is_in_shape(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let object = frame.argument(0).to_object(cx)?;
    let key = frame.argument(1).to_property_key(cx)?;
    Ok(object.shape().get(key.name()).is_some().into())
}

#[native_abi]
fn make_16_bit_string(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let view = frame.argument(0).to_string_view(cx)?;
    let mut writer = cx.or_out_of_memory(StringWriter::<u16>::try_new(view.text().len()))?;
    writer.push_text(view.text());
    Ok(JsString::new(cx, writer.finish()).into())
}

#[native_abi]
fn create_builtin(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(text) = frame.argument(0).as_string() else {
        return Ok(Value::UNDEFINED);
    };
    let visibility = match frame.argument(1).as_string() {
        Some(it) if it.view(cx)?.text().eq_ascii("private") => Visibility::Private,
        _ => Visibility::Public,
    };
    let source = files::source(text.to_string_ref(cx)?, None, None, SourceType::Program);
    let Text::Latin1(characters) = source.text() else {
        return Ok(Value::UNDEFINED);
    };
    let (outline, name) = (
        BuiltinOutline::of(characters),
        Identifier::from_literal("foo"),
    );
    let function = describe_builtin(&source, &outline, name, FunctionKind::Method, visibility);
    let executable = FunctionExecutable::create(cx, source.provider, function);
    Ok(JsFunction::builtin(cx, executable).into())
}

#[native_abi]
fn create_named_function(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let name = frame.argument(0).to_string_ref(cx)?;
    Ok(JsFunction::native(cx, 1, &name, create_named_function).into())
}

/// The global object itself, which has nothing of the shell but `$vm`. The argument is its prototype.
#[native_abi]
fn create_global_object(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let global = GlobalObject::create(cx, cx.global().hooks());
    if frame.argument(0).is_object() {
        global.set_prototype_direct(cx, frame.argument(0));
    }
    let cx = cx.in_realm(global);
    define_hidden(cx, "$vm", create(cx).into());
    Ok(global.into())
}

#[native_abi]
fn create_global_proxy(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let global = frame.argument(0).downcast::<GlobalObject>();
    Ok(global.map_or_default(|it| GlobalProxy::create(cx, it).into()))
}

/// `globalThis` of a realm whose global object asks the argument first.
#[native_abi]
fn create_sandboxed_global(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let sandbox = object_argument(cx, frame)?;
    let global = SandboxedGlobalObject::create(cx, cx.global().hooks(), sandbox);
    Ok(global.global_this().into())
}

#[native_abi]
fn call_repeatedly(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    if frame.argument(0).is_callable() {
        for _ in 0..frame.argument(1).to_int32(cx)? {
            cx.call(frame.argument(0), Value::NULL, frame.rest(2))?;
        }
    }
    Ok(Value::UNDEFINED)
}

#[native_abi]
fn call_with_time_limit(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let milliseconds = frame.argument(1).to_number(cx)?;
    if !frame.argument(0).is_callable() {
        return Err(cx.throw_type_error("expected a function"));
    }
    let Ok(limit) = Duration::try_from_secs_f64(milliseconds / 1000.0) else {
        let message = "expected a finite, non-negative number of milliseconds";
        return Err(cx.throw_range_error(message));
    };
    let (state, deadline) = (State::of(cx), cx.add_termination_deadline(limit));
    state.deadlines.borrow_mut().push(deadline);
    let result = cx.call(frame.argument(0), Value::UNDEFINED, &[]);
    let deadline = state.deadlines.borrow_mut().pop().expect("pushed above");
    deadline.cancel();
    if !deadline.did_fire() {
        return result;
    }
    let was_cut_short = cx.has_termination_request();
    cx.cancel_termination();
    if state.deadlines.borrow().iter().any(|it| it.did_fire()) {
        cx.traps().request_termination();
    }
    if was_cut_short {
        return Err(cx.throw_range_error("timed out"));
    }
    result
}

#[native_abi]
fn reject_promise_as_handled(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    (frame.argument(0).cast::<JsPromise>()).reject_as_handled(cx, frame.argument(1));
    Ok(Value::UNDEFINED)
}

fn loader_in(holder: Value) -> Option<Gc<ModuleLoader>> {
    (holder.downcast::<InternalFieldTuple>()?.fields().at(0)).downcast()
}

/// The arguments are an object whose properties the modules see as variables, and a loader to share code with.
#[native_abi]
fn create_module_loader(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let mut scope = cx.global().cell();
    if let Some(bindings) = frame.argument(0).as_object() {
        let keys = bindings.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Exclude)?;
        let template = if frame.argument(1).is_undefined() {
            let names = keys.to_vec().into();
            ScopeTemplate::create(cx, StaticScope::of_names(ScopeKind::Block, None, names))
        } else {
            let has_keys = |it: &Gc<ScopeTemplate>| {
                it.slot_count() as usize == keys.len()
                    && (keys.iter()).all(|key| it.scope().find(key.name()).is_some())
            };
            let other = loader_in(frame.argument(1));
            let other = other.and_then(|it| it.module_scope().downcast::<Environment>());
            (other.map(|it| it.template()).filter(has_keys)).ok_or_else(|| {
                cx.throw_type_error(
                    "expected the result of $vm.createModuleLoader() with the same bindings",
                )
            })?
        };
        // SAFETY: nothing but the global scope is around it.
        let environment = unsafe { Environment::create(cx, &cx.global(), scope, template) };
        for key in keys.iter() {
            let value = bindings.get(cx, key.name())?;
            environment.overwrite(cx, key.name(), value);
        }
        scope = environment.cell();
    }
    let loader = ModuleLoader::create(cx, scope);
    Ok(InternalFieldTuple::create(cx, loader.into(), Value::UNDEFINED).into())
}

#[native_abi]
fn module_loader_import(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(loader) = loader_in(frame.argument(0)) else {
        return Err(cx.throw_type_error("expected the result of $vm.createModuleLoader()"));
    };
    let (specifier, origin) = (frame.argument(1).to_string(cx)?, origin_of_caller(cx));
    let (options, phase) = (Value::UNDEFINED, ImportPhase::Evaluation);
    (loader.import(cx, specifier, options, origin.as_deref(), phase)).map(Into::into)
}

#[native_abi]
fn count_lazy_functions(_: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let namespace = frame.argument(0).downcast::<ModuleNamespace>();
    let Some(environment) = namespace.and_then(|it| it.module().environment()) else {
        return Ok(Value::UNDEFINED);
    };
    let template = environment.template();
    let slots = template.scope().slots().iter();
    let lazy =
        slots.filter(|it| it.kind == SlotKind::LazyFunction && environment.get(it.index).is_none());
    Ok(lazy.count().into())
}

#[native_abi]
fn set_time_zone(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let name = frame.argument(0).to_string_view(cx)?;
    Ok(bun_engine_date::set_time_zone_override(name.text()).into())
}

#[native_abi]
fn set_preferred_languages(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let Some(array) = frame.argument(0).downcast::<bun_engine_vm::JsArray>() else {
        return Err(cx.throw_type_error("Expected first argument to be an array"));
    };
    let mut languages = Vec::new();
    for index in 0..array.get(cx, names::length)?.to_length(cx)? {
        languages.push(array.get_index(cx, index)?.to_string_ref(cx)?);
    }
    let languages: Vec<Text<'_>> = languages.iter().map(|it| it.text()).collect();
    bun_engine_intl::set_preferred_languages(cx, &languages);
    Ok(Value::UNDEFINED)
}
