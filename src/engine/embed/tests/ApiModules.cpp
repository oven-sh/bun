#include "ApiFixtures.h"

using namespace JSC;
using Test::Realm;

static ASCIILiteral textOfModule(const String& key)
{
    if (key == "all"_s)
        return "import { b } from 'b'; import { eager, lazy } from 'synthetic'; import t from 'x' with { type: 'toml' };"
               "export const a = [b, eager, lazy, t].join(); export * from 'b'; export { b as c } from 'b';"_s;
    if (key == "b"_s)
        return "export let b = 1;"_s;
    if (key == "sum"_s)
        return "import { b } from 'b'; export default b + 1;"_s;
    if (key == "outer"_s)
        return "export default outer;"_s;
    return "throw 1;"_s;
}

static JSObject* generateExports(JSGlobalObject* global, Identifier, Vector<Identifier, 4>& names, MarkedArgumentBuffer& values)
{
    auto& vm = global->vm();
    names.append(Identifier::fromString(vm, "eager"_s));
    values.append(jsNumber(5));
    names.append(Identifier::fromString(vm, "lazy"_s));
    values.append(JSValue());
    auto* source = constructEmptyObject(global);
    source->putDirect(vm, names.last(), jsNumber(7));
    return source;
}

static JSPromise* fetch(JSGlobalObject* global, JSModuleLoader*, JSValue keyValue, const String&, RefPtr<ScriptFetchParameters> parameters, RefPtr<ScriptFetcher>)
{
    auto& vm = global->vm();
    String key = keyValue.toWTFString(global);
    auto* promise = JSPromise::create(vm, global->promiseStructure());
    if (parameters && parameters->type() == ScriptFetchParameters::HostDefined)
        promise->fulfill(vm, jsString(vm, parameters->hostDefinedImportType()));
    else if (key == "synthetic"_s)
        promise->fulfill(vm, JSSourceCode::create(vm, SourceCode(SyntheticSourceProvider::createWithLazyExports(generateExports, {}, key))));
    else
        promise->fulfill(vm, JSSourceCode::create(vm, makeSource(textOfModule(key), {}, SourceTaintedOrigin::Untainted, key, {}, SourceProviderSourceType::Module)));
    return promise;
}

static JSPromise* import(JSGlobalObject* global, JSModuleLoader* loader, JSString* specifier, RefPtr<ScriptFetchParameters> parameters, const SourceOrigin&, bool)
{
    if (parameters) {
        for (auto& [key, value] : parameters->attributes())
            Realm::log(makeString(StringView(key.get()), '=', value));
    }
    return loader->requestImportModule(global, Identifier::fromString(global->vm(), specifier->value(global)), {}, WTF::move(parameters), nullptr);
}

static constexpr GlobalObjectMethodTable methods {
    .moduleLoaderImportModule = import,
    .moduleLoaderFetch = fetch,
    .reportUncaughtExceptionAtEventLoop = JSGlobalObject::reportUncaughtExceptionAtEventLoop,
    .currentScriptExecutionOwner = JSGlobalObject::currentScriptExecutionOwner,
    .scriptExecutionStatus = JSGlobalObject::scriptExecutionStatus,
};

static SourceCode script(ASCIILiteral text) { return makeSource(text, {}, SourceTaintedOrigin::Untainted); }
static SourceCode module(ASCIILiteral text) { return makeSource(text, {}, SourceTaintedOrigin::Untainted, {}, {}, SourceProviderSourceType::Module); }

TEST(ModuleRegistry)
{
    Realm realm(&methods);
    auto& vm = realm.vm;
    auto* global = realm.global;
    auto name = [&](ASCIILiteral text) { return Identifier::fromString(vm, text); };

    auto* promise = loadAndEvaluateModule(global, "all"_s, nullptr, nullptr);
    vm.drainMicrotasks();
    EXPECT(promise->status() == JSPromise::Status::Fulfilled);

    auto* loader = global->moduleLoader();
    auto* entry = loader->registryEntry(name("all"_s));
    EXPECT(entry->key() == name("all"_s) && entry->status() == ModuleRegistryEntry::Status::Fetched && entry->isLoaded() && entry->loadPromise());
    EXPECT(loader->getRegisteredMayBeNull(name("x"_s), ScriptFetchParameters::HostDefined) && !loader->getRegisteredMayBeNull(name("x"_s), ScriptFetchParameters::JavaScript));
    EXPECT(loader->asyncEvaluationOrderForKey(name("all"_s)) == -1 && !loader->registryEntry({}) && !loader->removeEntry({}));

    auto* record = downcast<JSModuleRecord>(entry->record());
    EXPECT(record->moduleKey() == name("all"_s) && record->status() == CyclicModuleRecord::Status::Evaluated);
    EXPECT(!record->hasTLA() && !record->evaluationError() && record->isSCCEvaluated() && !record->hasLiveExports());
    auto& requests = record->requestedModules();
    EXPECT(requests.size() == 3 && record->requestedModuleCount() == 3 && record->requestedModuleKey(2) == requests[2].key());
    EXPECT(!requests[0].m_attributes && requests[2].m_attributes->hostDefinedImportType() == "toml"_s);
    EXPECT(record->loadedModules().size() == 3 && record->loadedModule(requests[0].key())->moduleKey() == name("b"_s));
    EXPECT(record->resolvedRequests().isEmpty() && !record->resolvedRequest(requests[0].key()));

    auto* namespaceObject = record->getModuleNamespace(global);
    EXPECT(namespaceObject->moduleRecord() == record && !namespaceObject->hasESModuleMarker());
    EXPECT(realm.text(namespaceObject->get(global, name("a"_s))) == "1,5,7,toml"_s);
    auto resolution = record->resolveExport(global, name("c"_s));
    EXPECT(resolution.type == AbstractModuleRecord::Resolution::Type::Resolved && resolution.localName == name("b"_s) && !resolution.isLiveExport(vm));
    auto* environment = resolution.moduleRecord->moduleEnvironment();
    EXPECT(environment->hasBinding(name("b"_s)) && !environment->hasBinding(name("c"_s)) && environment->readBinding(vm, name("b"_s)) == jsNumber(1));
    EXPECT(record->resolveExport(global, name("d"_s)).type != AbstractModuleRecord::Resolution::Type::Resolved);
    EXPECT(namespaceObject->overrideExportValue(global, name("c"_s), jsNumber(2)) && namespaceObject->get(global, name("b"_s)) == jsNumber(2));

    EXPECT(loader->removeEntry(name("x"_s)) && loader->moduleCount() == 3);
    size_t length = 0;
    for (auto& [key, it] : loader->moduleMap()) {
        loader->clearAll();
        realm.collect();
        length += key.first->length() + (it->moduleType() == key.second);
    }
    EXPECT(length == strlen("all"
                            "b"
                            "synthetic")
                + 3
        && !loader->moduleCount());
}

TEST(ModuleLoads)
{
    Realm realm(&methods);
    auto& vm = realm.vm;
    auto* global = realm.global;
    auto* loader = global->moduleLoader();
    auto sum = Identifier::fromString(vm, "sum"_s);
    auto throws = Identifier::fromString(vm, "throws"_s);

    EXPECT(loader->loadModuleSync(global, sum, nullptr, nullptr)->status() == JSPromise::Status::Fulfilled);

    auto* promise = loader->loadModule(global, throws, nullptr, nullptr, {});
    vm.drainMicrotasks();
    EXPECT(promise->status() == JSPromise::Status::Fulfilled);
    EXPECT(downcast<CyclicModuleRecord>(loader->registryEntry(throws)->record())->status() == CyclicModuleRecord::Status::Unlinked);

    promise = loader->loadModule(global, throws, nullptr, nullptr, { ModuleLoadFlag::Evaluate, ModuleLoadFlag::Dynamic });
    vm.drainMicrotasks();
    EXPECT(promise->status() == JSPromise::Status::Rejected && promise->result() == jsNumber(1));

    promise = importModule(global, sum, {}, nullptr, nullptr);
    vm.drainMicrotasks();
    EXPECT(is<JSModuleNamespaceObject>(promise->result()));

    realm.run("import('y', { with: { k: 'v', type: 'text' } })"_s);
    EXPECT(Realm::takeLog() == "k=v, type=text"_s);
}

TEST(ModulesWithoutLoader)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* caller = realm.global;
    auto* global = realm.createGlobalObject();
    auto* loader = global->moduleLoader();
    auto name = [&](ASCIILiteral text) { return Identifier::fromString(vm, text); };

    ParserError error;
    String attributeError;
    EXPECT(!JSModuleRecord::analyze(loader, name("m"_s), module("import 'a' with { type: '' }"_s), error, attributeError) && !error.isValid() && !attributeError.isEmpty());
    EXPECT(!JSModuleRecord::analyze(loader, name("m"_s), module("import ("_s), error, attributeError) && error.isValid());

    auto source = module("import { x } from 'a' with { k: 'v', l: 'w' }; export const y = [x, import.meta.z], o = Object; await 1;"_s);
    auto* record = JSModuleRecord::analyze(loader, name("m"_s), source, error, attributeError);
    auto& attributes = record->declaredAttributes(record->requestedModuleKey(0));
    EXPECT(record->hasTLA() && attributes.size() == 2 && attributes[1].value == "w"_s);

    Identifier exports[] = { name("x"_s) };
    auto* synthetic = SyntheticModuleRecord::createWithUndefinedExports(global, loader, name("a"_s), exports);
    record->setImportedModule(record->requestedModuleKey(0), synthetic);
    record->setStatus(CyclicModuleRecord::Status::Unlinked);
    record->link(caller, nullptr);
    EXPECT(synthetic->getModuleNamespace(global, false)->get(global, exports[0]).isUndefined());
    synthetic->getModuleNamespace(global, false)->overrideExportValue(global, exports[0], jsNumber(3));
    record->importMeta(caller)->putDirect(vm, name("z"_s), jsNumber(4));

    auto* promise = record->evaluate(caller);
    EXPECT(record->status() == CyclicModuleRecord::Status::EvaluatingAsync && !record->pendingAsyncDependencies());
    vm.drainMicrotasks();
    EXPECT(promise->status() == JSPromise::Status::Fulfilled);
    auto* namespaceObject = record->getModuleNamespace(caller);
    EXPECT(realm.text(namespaceObject->get(caller, name("y"_s))) == "3,4"_s && namespaceObject->get(caller, name("o"_s)) == global->objectConstructor());

    auto specifier = name("a"_s);
    auto* known = JSModuleRecord::create(global, loader, name("m"_s), source);
    known->reserveCapacity(1, 1, 2);
    known->appendRequestedModule(specifier, nullptr, AbstractModuleRecord::ModulePhase::Evaluation);
    known->addImportEntry(AbstractModuleRecord::ImportEntryType::Single, AbstractModuleRecord::ModulePhase::Evaluation, { specifier.impl(), ScriptFetchParameters::JavaScript }, exports[0], exports[0]);
    known->addLocalExport(name("o"_s), name("o"_s));
    EXPECT(known->describeEntries() != record->describeEntries());
    known->addLocalExport(name("y"_s), name("y"_s));
    EXPECT(known->describeEntries() == record->describeEntries());

    auto* unlinked = JSModuleRecord::analyze(loader, name("u"_s), module("export {}"_s), error, attributeError);
    unlinked->setStatus(CyclicModuleRecord::Status::Unlinked);
    auto* rejected = unlinked->evaluate(caller);
    EXPECT(rejected->status() == JSPromise::Status::Rejected && realm.text(rejected->result()) == "SyntaxError: Module 'u' is not linked."_s);
}

TEST(ScopeAroundCode)
{
    Realm realm(&methods);
    auto& vm = realm.vm;
    auto* global = realm.global;
    Identifier names[] = { Identifier::fromString(vm, "outer"_s), vm.propertyNames->moduleLoaderPrivateName };
    auto* scopeTemplate = ScopeTemplate::create(vm, names);
    auto* first = JSLexicalEnvironment::create(global, scopeTemplate);
    auto* second = JSLexicalEnvironment::create(global, scopeTemplate);
    EXPECT(first->variable(names[0]).isUndefined() && !first->variable(vm.propertyNames->name) && first->next() == global && !global->next());
    first->setVariable(vm, names[0], jsNumber(1));
    second->setVariable(vm, names[0], jsNumber(2));

    auto* function = downcast<JSFunction>(evaluateInScope(global, script("(function () { return outer; })"_s), first));
    EXPECT(function->scope() == first && canCloseOver(function->jsExecutable(), second) && !canCloseOver(function->jsExecutable(), global));
    EXPECT(call(global, function, getCallData(function), jsUndefined(), {}) == jsNumber(1));
    function = JSFunction::create(vm, global, function->jsExecutable(), second);
    EXPECT(call(global, function, getCallData(function), jsUndefined(), {}) == jsNumber(2));

    function = downcast<JSFunction>(evaluateToFunctionInScope(global, script("var seen = (typeof outer).length; (function named() { return outer + seen + named.name.length; })"_s), second));
    EXPECT(call(global, function, getCallData(function), jsUndefined(), {}) == jsNumber(16));

    auto* loader = JSModuleLoader::create(global, vm, first);
    first->setVariable(vm, names[1], loader);
    EXPECT(loader->moduleScope() == first && !loader->asyncContext());
    auto* promise = downcast<JSPromise>(evaluateInScope(global, script("(() => import('outer'))()"_s), first));
    vm.drainMicrotasks();
    EXPECT(asObject(promise->result())->get(global, vm.propertyNames->defaultKeyword) == jsNumber(1));
    EXPECT(loader->moduleCount() == 1 && !global->moduleLoader()->moduleCount() && loader->shareableExecutable(global, names[0]));
}

TEST(CompiledScript)
{
    Realm realm;
    auto& vm = realm.vm;
    auto* global = realm.global;
    auto* other = realm.createGlobalObject();

    ParserError error;
    auto source = script("var n = (n || 0) + 1; n"_s);
    RefPtr code = UnlinkedProgramCodeBlock::compile(global, source, error);
    NakedPtr<Exception> exception;
    EXPECT(evaluate(global, source, code.get(), global, exception) == jsNumber(1) && evaluate(global, source, code.get(), global, exception) == jsNumber(2));
    EXPECT(code->isUsableIn(other) && evaluate(other, source, code.get(), other, exception) == jsNumber(1));
    EXPECT(evaluate(other, source, nullptr, other, exception) == jsNumber(2) && !exception);

    auto* scope = JSWithScope::create(vm, other, other, asObject(realm.run("({ extension: 9 })"_s)));
    code = UnlinkedProgramCodeBlock::compile(other, script("(function () { return extension + n; }); function later() {}"_s), error, scope);
    auto* function = code->createFirstFunction(other, scope);
    EXPECT(call(global, function, getCallData(function), jsUndefined(), {}) == jsNumber(11));
    EXPECT(!code->createFirstFunction(other, other) && realm.text(realm.run("typeof extension"_s)) == "undefined"_s);

    EXPECT(!error.isValid() && !UnlinkedProgramCodeBlock::compile(global, script("var"_s), error) && error.isValid());
}
