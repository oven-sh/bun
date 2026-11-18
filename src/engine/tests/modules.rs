use core::cell::RefCell;
use std::rc::Rc;

use bun_engine_bytecode::{ImportPhase, ScopeKind, StaticScope};
use bun_engine_macros::native_abi;
use bun_engine_standalone as _;
use bun_engine_text::{Identifier, StringRef, private_names};
use bun_engine_vm::heap::{HeapKind, Scope};
use bun_engine_vm::*;

/// A key that starts with `object:` names a global, whose properties are the exports. One that is undefined is read
/// later. With `live:` all of them are read each time.
type Files = &'static [(&'static str, &'static str)];

thread_local! {
    static FILES: RefCell<Files> = const { RefCell::new(&[]) };
    static FETCHED: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

fn name(text: &str) -> Identifier {
    Identifier::new(StringRef::from_str(text).text())
}

fn source(text: &str, url: &str, source_type: SourceType) -> SourceCode {
    let (text, url) = (StringRef::from_str(text), StringRef::from_str(url));
    SourceCode::whole(SourceProvider::build(text, Some(url), source_type).finish())
}

/// What is under `slow/` arrives only if the load is synchronous.
fn fetch(
    cx: &mut Cx,
    _: Gc<ModuleLoader>,
    key: Value,
    _: Option<&StringRef>,
    _: Option<Rc<FetchParameters>>,
) -> JsResult<Gc<JsPromise>> {
    let key = text(cx, key);
    FETCHED.with_borrow_mut(|fetched| fetched.push(key.clone()));
    if key.starts_with("slow/") && !cx.has_synchronous_module_queue() {
        return Ok(JsPromise::new(cx));
    }
    let live = key.strip_prefix("live:");
    let code = if let Some(global) = live.or_else(|| key.strip_prefix("object:")) {
        let code = source(global, &key, SourceType::Synthetic);
        code.provider.has_live_exports().set(live.is_some());
        code
    } else if let Some(file) = FILES.with_borrow(|files| files.iter().find(|it| it.0 == key)) {
        source(file.1, &key, SourceType::Module)
    } else {
        let thrown = cx.throw_error(ErrorType::Error, format_args!("no {key}"));
        return JsPromise::rejected_with_caught(cx, thrown);
    };
    let code = JsSourceCode::create(cx, code);
    Ok(JsPromise::fulfilled(cx, code.into()))
}

fn generate_exports(
    cx: &mut Cx,
    provider: &SourceProvider,
    _: &Identifier,
    exports: &mut SyntheticExports,
) -> JsResult<()> {
    let global = Identifier::new(provider.text());
    let object = cx.global().get(cx, global.name())?.to_object(cx)?;
    let keys = object.own_keys(cx, PropertyNameMode::Strings, DontEnumMode::Exclude)?;
    for key in keys.into_vec() {
        let descriptor = object.get_own_property_descriptor(cx, key.name())?;
        exports.values.push(descriptor.and_then(|it| it.value()));
        exports.names.push(key);
    }
    exports.source = Some(object);
    Ok(())
}

static HOOKS: RealmHooks = RealmHooks {
    modules: ModuleHooks {
        import: |cx, loader, specifier, parameters, _, phase| {
            let specifier = specifier.to_identifier(cx)?;
            loader.request_import(cx, &specifier, None, parameters, phase, None)
        },
        fetch,
        generate_exports,
        ..ModuleHooks::DEFAULT
    },
    promise_rejection_tracker: |_, _, _| {},
    report_uncaught_exception: |_, _| {},
    current_script_execution_owner: |cx| cx.global().upcast(),
    script_execution_status: |_, _| ScriptExecutionStatus::Running,
    default_language: StringRef::empty,
    derive_shadow_realm: |cx| Ok(cx.global()),
    compile_wasm_streaming: None,
    instantiate_wasm_streaming: None,
};

fn entry(cx: &Cx, key: &str) -> Option<Gc<ModuleRegistryEntry>> {
    cx.module_loader().find_entry_of_any_type(name(key).name())
}

/// The namespace object, or the string `pending`.
#[native_abi]
fn require(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let key = frame.argument(0).to_property_key(cx)?.to_identifier();
    let promise = cx.module_loader().load_synchronously(cx, &key, None)?;
    if promise.status() == PromiseStatus::Rejected {
        return Err(cx.throw(promise.result()));
    }
    let entry = cx.module_loader().find_entry_of_any_type(key.name());
    match entry.and_then(|it| it.record()) {
        Some(module) if !promise.is_pending() => module.extensible_namespace(cx).map(Into::into),
        _ => Ok(JsString::from_literal(cx, "pending").into()),
    }
}

#[native_abi]
fn override_export(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    let key = frame.argument(1).to_property_key(cx)?.to_identifier();
    let namespace = frame.argument(0).cast::<ModuleNamespace>();
    (namespace.override_export(cx, &key, frame.argument(2))).map(Into::into)
}

#[native_abi]
fn forget_modules(cx: &mut Cx, _: &CallFrame) -> JsResult<Value> {
    cx.module_loader().clear();
    Ok(Value::UNDEFINED)
}

fn with_files(files: Files, body: impl FnOnce(&mut Cx)) {
    let mut options = Options::default();
    options.collect_every_n_allocations = 7;
    options.eval_mode = true;
    set_options(options);
    FILES.set(files);
    let vm = bun_engine::create_vm(HeapKind::Small);
    // SAFETY: nothing else uses the `Vm`.
    let cx = unsafe { Cx::from_global(GlobalObject::create(vm.get(), &HOOKS)) };
    let functions: [(_, NativeFunction); 3] = [
        ("require", require),
        ("mock", override_export),
        ("forgetModules", forget_modules),
    ];
    for (key, function) in functions {
        let (global, key, attributes) = (cx.global(), name(key), Attributes::NONE);
        global.put_direct_native_function(cx, key.name(), 0, function, Intrinsic::None, attributes);
    }
    run(cx, "var log = []");
    body(cx);
}

fn text(cx: &mut Cx, value: Value) -> String {
    value.to_string_view(cx).unwrap().text().to_string()
}

/// What it evaluates to or throws, once the microtasks have run.
fn run(cx: &mut Cx, code: &str) -> String {
    let code = source(code, "test.js", SourceType::Program);
    let value = evaluate_script(cx, &code, Value::UNDEFINED);
    let value = value.or_else(|thrown| cx.catch_value(thrown)).unwrap();
    cx.drain_microtasks().unwrap();
    settled(cx, value)
}

fn settled(cx: &mut Cx, value: Value) -> String {
    match value.downcast::<JsPromise>() {
        Some(promise) if promise.is_pending() => "pending".to_owned(),
        Some(promise) => text(cx, promise.result()),
        None => text(cx, value),
    }
}

fn fetched() -> String {
    FETCHED.take().join(" ")
}

#[test]
fn a_synchronous_load_runs_no_other_microtask() {
    let files = &[
        (
            "a",
            "import { b } from 'b'; log.push('a'); export const a = b + 1;",
        ),
        ("b", "log.push('b'); export const b = 1;"),
    ];
    with_files(files, |cx| {
        let code = "Promise.resolve().then(() => log.push('job')); log.push(require('a').a);";
        run(cx, code);
        assert_eq!(run(cx, "log"), "b,a,2,job");
    });
}

#[test]
fn a_synchronous_load_does_not_wait_for_a_pending_await() {
    let files = &[
        ("settled", "export let x = 1; x = await Promise.resolve(2);"),
        (
            "pending",
            "await new Promise(resolve => (globalThis.go = resolve)); log.push('end');",
        ),
    ];
    with_files(files, |cx| {
        assert_eq!(run(cx, "require('settled').x"), "2");
        assert_eq!(run(cx, "require('pending')"), "pending");
        run(cx, "go()");
        assert_eq!(run(cx, "log"), "end");
    });
}

#[test]
fn a_synchronous_load_takes_over_what_is_being_fetched() {
    let files = &[
        ("root", "import 'slow/leaf'; log.push('root');"),
        ("other", "export { leaf } from 'slow/leaf';"),
        ("slow/leaf", "log.push('leaf'); export const leaf = 3;"),
        ("slow/top", "export default 4;"),
    ];
    with_files(files, |cx| {
        assert_eq!(run(cx, "globalThis.root = import('root')"), "pending");
        assert_eq!(run(cx, "require('other').leaf"), "3");
        assert_eq!(run(cx, "root.then(() => log)"), "leaf,root");
        assert_eq!(fetched(), "root slow/leaf other slow/leaf");
        assert_eq!(run(cx, "import('slow/top')"), "pending");
        assert_eq!(run(cx, "require('slow/top').default"), "4");
    });
}

#[test]
fn a_synchronous_load_at_any_step_of_an_import() {
    let files = &[
        (
            "root",
            "import { leaf } from 'leaf'; log.push('root'); export default leaf;",
        ),
        ("leaf", "log.push('leaf'); export const leaf = 5;"),
    ];
    for ticks in 0..24 {
        with_files(files, |cx| {
            let code = format!(
                "(async () => {{
                    const imported = import('root');
                    for (let i = 0; i < {ticks}; i++) await 0;
                    const required = require('root');
                    return [required.default, required === await imported, log];
                }})()"
            );
            assert_eq!(run(cx, &code), "5,true,leaf,root", "after {ticks}");
        });
    }
}

#[test]
fn a_module_requires_one_that_imports_it() {
    let files = &[
        (
            "outer",
            "export function f() { return 'f' } log.push(require('inner').value); export let late = 1;",
        ),
        (
            "inner",
            "import { f, late } from 'outer'; try { late } catch (e) { log.push(e.message) } export const value = f();",
        ),
    ];
    with_files(files, |cx| {
        let result = run(cx, "import('outer').then(() => log)");
        assert_eq!(result, "Cannot access 'late' before initialization.,f");
    });
}

#[test]
fn lazy_exports_are_read_once_when_they_are_needed() {
    let files = &[
        (
            "named",
            "import { x, plain } from 'object:lazy'; log.push('body'); export default x + plain;",
        ),
        ("star", "export * from 'object:lazy';"),
    ];
    with_files(files, |cx| {
        run(
            cx,
            "var lazy = { plain: 1, get x() { log.push('x'); return 2 }, get y() { log.push('y'); return 3 } }",
        );
        assert_eq!(run(cx, "[require('named').default, log]"), "3,x,body");
        let result = run(
            cx,
            "var star = require('star'); ['y' in star, log.length, star.y, star.y, star.x, log]",
        );
        assert_eq!(result, "true,2,3,3,2,x,body,y");
    });
}

#[test]
fn live_exports_are_read_each_time() {
    let files = &[
        (
            "direct",
            "import { a, missing } from 'live:mocked'; export const read = () => a; export const fail = () => missing;",
        ),
        (
            "again",
            "export { missing } from 'live:mocked'; export * from 'live:mocked'; export * from 'plain';",
        ),
        ("plain", "export const a = 'plain', b = 'b';"),
        (
            "indirect",
            "import { a, b, missing, unheard } from 'again'; export const read = () => [a, b, missing, unheard];",
        ),
    ];
    with_files(files, |cx| {
        run(
            cx,
            "var mocked = new Proxy({ a: 1 }, { get(target, key) { if (key in target) return target[key]; throw `no ${key}` } })",
        );
        let result = run(
            cx,
            "var { read, fail } = require('direct'); [read(), (mocked.a = 2, read())]",
        );
        assert_eq!(result, "1,2");
        assert_eq!(run(cx, "fail()"), "no missing");
        assert_eq!(run(cx, "require('indirect').read()"), "2,b,,");
        assert_eq!(run(cx, "Object.keys(require('again'))"), "a,b,missing");
        let result = run(
            cx,
            "var live = require('live:mocked'); live.c = 3; [Object.keys(live), mocked.c, delete live.c, 'c' in live, mock(live, 'a', 0)]",
        );
        assert_eq!(result, "a,c,3,true,false,false");
    });
}

#[test]
fn exports_can_be_overridden() {
    let files = &[
        (
            "origin",
            "export const c = 1; export function f() { return 'f' } export default class {} export const own = () => [c, f()];",
        ),
        (
            "again",
            "export { c as renamed } from 'origin'; export * as all from 'origin';",
        ),
        (
            "user",
            "import { renamed, all } from 'again'; import d, { f } from 'origin'; export const read = () => [renamed, f(), d, all];",
        ),
    ];
    with_files(files, |cx| {
        run(
            cx,
            "var origin = require('origin'), again = require('again'), { read } = require('user')",
        );
        let result = run(
            cx,
            "[mock(again, 'renamed', 2), mock(origin, 'f', () => 'g'), mock(origin, 'default', 3), mock(again, 'all', 4), mock(origin, 'none', 5)]",
        );
        assert_eq!(result, "true,true,true,true,false");
        assert_eq!(
            run(cx, "[read(), origin.own(), origin.c, again.all]"),
            "2,g,3,4,2,g,2,4"
        );
    });
}

#[test]
fn an_extensible_namespace_takes_the_marker_only() {
    with_files(&[("a", "export const a = 1;")], |cx| {
        let result = run(
            cx,
            "var a = require('a'); a.__esModule = true; a.other = 1; [a.__esModule, a.other, Object.keys(a), Reflect.defineProperty(a, 'other', {})]",
        );
        assert_eq!(result, "true,,a,false");
    });
}

fn request(specifier: &str) -> ModuleKey {
    ModuleKeyRef::new(name(specifier).name(), ModuleType::JavaScript).to_key()
}

fn import(kind: ImportKind, imported: &str, from: &str) -> ImportEntry {
    ImportEntry {
        kind,
        phase: ImportPhase::Evaluation,
        module: request(from),
        imported: name(imported),
        local: name(imported),
    }
}

fn provide(cx: &Cx, key: &str, code: &str, describe: impl FnOnce(&mut ModuleEntries)) {
    let (loader, code) = (
        cx.module_loader(),
        source(code, key, SourceType::AnalyzedModule),
    );
    let module = SourceTextModuleRecord::create(cx, loader, name(key), code);
    module.is_typescript().set(true);
    module.edit_entries(describe);
    (loader.ensure_entry(cx, request(key).borrow())).provide_module(cx, module.upcast());
}

#[test]
fn what_names_a_type_hides_no_value() {
    with_files(&[("types", "export const value = 1;")], |cx| {
        let code = "import { Map, Missing, value } from 'types'; export { Missing };
            export default [typeof Map, value]; export const fail = () => Missing;";
        provide(cx, "typed", code, |entries| {
            entries.add_request(ModuleRequest::new(name("types"), None));
            for imported in ["Map", "Missing", "value"] {
                entries.add_import(import(ImportKind::SingleTypeScript, imported, "types"));
            }
            let (module, imported) = (request("types"), name("Missing"));
            entries.add_export(name("Missing"), ExportSource::Indirect { module, imported });
            let local = private_names::starDefault.to_identifier();
            entries.add_export(name("default"), ExportSource::Local(local));
            entries.add_export(name("fail"), ExportSource::Local(name("fail")));
        });
        let result = run(
            cx,
            "var typed = require('typed'); [Object.keys(typed), typed.default]",
        );
        assert_eq!(result, "default,fail,function,1");
        assert_eq!(
            run(cx, "typed.fail()"),
            "ReferenceError: Missing is not defined"
        );
        assert_eq!(fetched(), "types");
    });
}

#[test]
fn entries_that_do_not_match_the_code_end_in_errors() {
    with_files(&[("user", "import { ghost } from 'liar';")], |cx| {
        provide(cx, "liar", "await 0;", |entries| {
            entries.add_export(name("ghost"), ExportSource::Local(name("ghost")));
            entries.add_export(name("all"), ExportSource::Namespace(request("nowhere")));
            entries.add_star_export(request("nowhere"));
        });
        provide(cx, "lost", "import { x } from 'nowhere';", |entries| {
            entries.add_import(import(ImportKind::Single, "x", "nowhere"));
        });
        provide(cx, "broken", "let let;", |_| {});
        let result = run(cx, "import('user')");
        assert_eq!(
            result,
            "SyntaxError: Export named 'ghost' not found in module 'liar'."
        );
        assert_eq!(
            run(cx, "import('liar').then(it => [Object.keys(it), it.ghost])"),
            "ghost,"
        );
        let result = run(cx, "import('lost')");
        assert_eq!(
            result,
            "SyntaxError: Importing module 'nowhere' is not found."
        );
        assert!(run(cx, "import('broken')").starts_with("SyntaxError: "));
    });
}

#[test]
fn a_removed_entry_is_loaded_again() {
    let files = &[
        ("counter", "export const n = log.push('counter');"),
        ("user", "export { n } from 'counter';"),
        ("bad", "throw log.push('bad');"),
    ];
    with_files(files, |cx| {
        assert_eq!(run(cx, "var user = require('user'); user.n"), "1");
        assert!(cx.module_loader().remove_entries(name("counter").name()));
        assert!(!cx.module_loader().remove_entries(name("counter").name()));
        cx.heap.collect_and_sweep(Some(Scope::Full));
        assert_eq!(run(cx, "[require('counter').n, user.n]"), "2,1");
        assert_eq!(run(cx, "import('bad')"), "3");
        assert_eq!(run(cx, "import('bad')"), "3");
        assert_eq!(
            entry(cx, "bad").unwrap().status(),
            RegistryStatus::EvaluationFailed
        );
        cx.module_loader().clear();
        assert_eq!(run(cx, "import('bad')"), "4");
    });
}

#[test]
fn an_entry_that_is_removed_while_it_loads() {
    let files = &[("root", "import 'leaf'; export default 1;"), ("leaf", "")];
    for ticks in 0..24 {
        with_files(files, |cx| {
            let code = format!(
                "(async () => {{
                    const imported = import('root');
                    for (let i = 0; i < {ticks}; i++) await 0;
                    forgetModules();
                    return [(await imported).default, (await import('root')).default];
                }})()"
            );
            assert_eq!(run(cx, &code), "1,1", "after {ticks}");
        });
    }
}

#[test]
fn a_failed_fetch_is_tried_again_but_for_dependencies() {
    let files = &[("a", "import 'none';"), ("b", "import 'none';")];
    with_files(files, |cx| {
        let result = run(
            cx,
            "import('a').catch(a => import('b').catch(b => [a, b, a === b]))",
        );
        assert_eq!(result, "Error: no none,Error: no none,false");
        assert_eq!(fetched(), "a none b");
        assert_eq!(run(cx, "import('none')"), "Error: no none");
        assert_eq!(fetched(), "none");
    });
}

#[test]
fn modules_that_the_embedder_links() {
    with_files(&[], |cx| {
        let analyze = |cx: &Cx, key, code| {
            let code = source(code, key, SourceType::Module);
            let module = SourceTextModuleRecord::analyze(cx, cx.module_loader(), name(key), code);
            let module = module.ok().unwrap();
            module.set_status(ModuleStatus::Unlinked);
            module
        };
        let a = analyze(
            cx,
            "a",
            "import { b } from 'x'; export const a = 1; b() + import.meta.n",
        );
        let b = analyze(
            cx,
            "b",
            "import { a } from 'y'; export function b() { return a }",
        );
        let thrown = a.link(cx).unwrap_err();
        let error = cx.catch_value(thrown).unwrap();
        assert_eq!(
            text(cx, error),
            "SyntaxError: Importing module 'x' is not found."
        );
        a.set_imported_module(request("x").borrow(), b.upcast());
        b.set_imported_module(request("y").borrow(), a.upcast());
        a.link(cx).unwrap();
        assert!(b.import_meta(cx).unwrap().is_none());
        let meta = a.import_meta(cx).unwrap().unwrap();
        meta.put_direct(cx, name("n").name(), 1.into(), Attributes::NONE);
        let promise = a.evaluate(cx).unwrap();
        assert_eq!(promise.status(), PromiseStatus::Fulfilled);
        assert!(a.is_cycle_evaluated() && b.is_cycle_evaluated());
    });
}

#[test]
fn code_that_awaits_settles_with_its_completion_value() {
    with_files(&[("a", "(await 1) + 1")], |cx| {
        run(cx, "void import('a')");
        let module = entry(cx, "a").unwrap().record().unwrap();
        let promise = module.cast::<SourceTextModuleRecord>().async_promise();
        assert_eq!(settled(cx, promise.unwrap().into()), "2");
    });
}

#[test]
fn a_suspended_module_goes_on_after_its_cycle_has_failed() {
    let files = &[
        ("root", "import 'waits'; import 'throws';"),
        (
            "waits",
            "import 'root'; log.push(1); await 0; log.push((() => 2)());",
        ),
        ("throws", "throw 'thrown';"),
    ];
    with_files(files, |cx| {
        assert_eq!(run(cx, "import('root').catch(e => [e, log])"), "thrown,1,2");
    });
}

#[test]
fn a_dependency_ends_while_its_sibling_requires_a_module() {
    const WAITS: &str =
        "await new Promise((...both) => (globalThis.settle = both)); log.push('waited');";
    let files = &[
        ("a", "import 'a1'; import 'a2'; log.push('a');"),
        ("a1", WAITS),
        ("a2", "require('a3'); log.push('a2');"),
        ("a3", "settle[0]();"),
        ("b", "import 'b0'; import 'b2'; log.push('b');"),
        ("b0", "import 'b'; import 'b1'; log.push('b0');"),
        ("b1", WAITS),
        ("b2", "require('b3'); log.push('b2');"),
        ("b3", "settle[0]();"),
        ("c", "import 'c1'; import 'c2'; log.push('c');"),
        ("c1", WAITS),
        ("c2", "require('c3'); log.push('c2');"),
        ("c3", "settle[1]('rejected');"),
    ];
    with_files(files, |cx| {
        let result = run(cx, "import('a').then(() => log.splice(0))");
        assert_eq!(result, "waited,a2,a");
        let result = run(cx, "import('b').then(() => log.splice(0))");
        assert_eq!(result, "waited,b0,b2,b");
        let result = run(cx, "import('c').catch(e => [e, log])");
        assert_eq!(result, "rejected,c2");
    });
}

#[test]
fn a_loader_with_a_scope_of_its_own() {
    let files = &[
        (
            "a",
            "export const read = () => [extra, eval('extra')]; export const load = () => import('b');",
        ),
        ("b", "export default extra + 1;"),
    ];
    with_files(files, |cx| {
        let names = [name("extra"), private_names::moduleLoader.to_identifier()];
        let scope = StaticScope::of_names(ScopeKind::Block, None, names.clone().into());
        let template = ScopeTemplate::create(cx, scope);
        for extra in [10, 20] {
            // SAFETY: nothing but the global scope is around it.
            let overlay =
                unsafe { Environment::create(cx, &cx.global(), cx.global().cell(), template) };
            let loader = ModuleLoader::create(cx, overlay.cell());
            assert!(overlay.overwrite(cx, names[0].name(), extra.into()));
            assert!(overlay.overwrite(cx, names[1].name(), loader.into()));
            let code = "(async () => { const a = await import('a'); return [a.read(), (await a.load()).default] })()";
            let code = source(code, "test.js", SourceType::Program);
            let result = evaluate_script_in_scope(cx, &code, overlay.cell(), Value::UNDEFINED);
            let result = result.unwrap();
            cx.drain_microtasks().unwrap();
            assert_eq!(
                settled(cx, result),
                format!("{extra},{extra},{}", extra + 1)
            );
        }
        assert!(entry(cx, "a").is_none());
    });
}

#[test]
fn a_graph_that_is_too_deep_for_the_stack() {
    const DEPTH: usize = 20_000;
    with_files(&[], |cx| {
        for index in 0..DEPTH {
            let next = format!("m{}", index + 1);
            let is_last = index + 1 == DEPTH;
            provide(cx, &format!("m{index}"), "", |entries| {
                if !is_last {
                    entries.add_request(ModuleRequest::new(name(&next), None));
                    entries.add_star_export(request(&next));
                }
            });
        }
        for index in 0..DEPTH {
            let this = entry(cx, &format!("m{index}")).unwrap();
            this.mark_loaded();
            let next = format!("m{}", index + 1);
            if let Some(next_module) = entry(cx, &next).and_then(|it| it.record()) {
                let module = this.record().unwrap();
                module.set_imported_module(request(&next).borrow(), next_module);
            }
        }
        let result = run(cx, "import('m0')");
        assert_eq!(result, "RangeError: Maximum call stack size exceeded");
    });
}

#[test]
fn the_extension_of_the_global_scope_comes_last() {
    with_files(&[], |cx| {
        run(
            cx,
            "var own = 1, extension = { own: 2, more: 3, self() { return this === extension } }",
        );
        let object = cx.global().get(cx, name("extension").name()).unwrap();
        let scope = Environment::create_for_object(cx, cx.global().cell(), object.cast());
        cx.global().set_scope_extension(Some(scope));
        let result = run(
            cx,
            "with ({}) var self_ = self(); more++; [own, more, extension.more, self_, delete more, typeof more]",
        );
        assert_eq!(result, "1,4,4,true,true,undefined");
        cx.global().set_scope_extension(None);
        assert_eq!(run(cx, "typeof self"), "undefined");
    });
}

#[test]
fn code_is_made_again_after_it_is_discarded() {
    let files = &[(
        "a",
        "function late() { return tag`x` } const tag = it => it; export const get = () => late();",
    )];
    with_files(files, |cx| {
        run(
            cx,
            "var { get } = require('a'), first = get();
            function* count() { for (let i = 0; ; i++) yield () => i }
            function outer(x) { return () => eval('x') }
            var counter = count(), zero = counter.next().value, inner = outer(7); inner()",
        );
        cx.discard_unlinked_code();
        cx.shrink_footprint();
        let result = run(
            cx,
            "[get() === first, zero(), counter.next().value(), inner(), outer(8)()]",
        );
        assert_eq!(result, "true,0,1,7,8");
    });
}
