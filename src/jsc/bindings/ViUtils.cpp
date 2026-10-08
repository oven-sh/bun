#include "root.h"

#include "BunProcess.h"
#include "JSMockFunction.h"
#include "ZigGlobalObject.h"
#include "headers.h"
#include <JavaScriptCore/IdentifierInlines.h>
#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/JSMapIterator.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/JSSetInlines.h>
#include <JavaScriptCore/JSSetIterator.h>
#include <JavaScriptCore/ObjectConstructor.h>

namespace Bun {

using namespace JSC;

static JSMap* ensureOriginals(VM& vm, Zig::GlobalObject* globalObject, WriteBarrier<Unknown>& slot)
{
    if (JSValue originals = slot.get())
        return uncheckedDowncast<JSMap>(originals);
    auto* originals = JSMap::create(vm, globalObject->mapStructure());
    slot.set(vm, globalObject, originals);
    return originals;
}

using RestoreOriginal = void (*)(JSGlobalObject*, JSObject* target, JSValue key, JSValue original);

static void restoreOriginals(Zig::GlobalObject* globalObject, WriteBarrier<Unknown>& slot, JSObject* target, RestoreOriginal restore)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* originals = uncheckedDowncast<JSMap>(slot.get());
    slot.clear();
    auto* iterator = JSMapIterator::create(vm, globalObject->mapIteratorStructure(), originals, IterationKind::Entries);
    while (true) {
        auto [key, original] = iterator->nextWithAdvance(vm);
        if (!key)
            return;
        restore(globalObject, target, key, original);
        RETURN_IF_EXCEPTION(scope, );
    }
}

static void restoreGlobal(JSGlobalObject* globalObject, JSObject* target, JSValue key, JSValue original)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto name = key.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    if (original.isUndefined()) {
        scope.release();
        JSCell::deleteProperty(target, globalObject, name);
        return;
    }
    PropertyDescriptor descriptor;
    toPropertyDescriptor(globalObject, original, descriptor);
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    target->methodTable()->defineOwnProperty(target, globalObject, name, descriptor, true);
}

static void unstubAllGlobals(Zig::GlobalObject* globalObject)
{
    auto& stubbedGlobals = globalObject->mockModule.stubbedGlobals;
    if (stubbedGlobals)
        restoreOriginals(globalObject, stubbedGlobals, globalObject->globalThis(), restoreGlobal);
}

JSC_DEFINE_HOST_FUNCTION(jsViStubGlobal, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto name = callFrame->argument(0).toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue value = callFrame->argument(1);

    JSObject* target = globalObject->globalThis();
    JSMap* originals = ensureOriginals(vm, globalObject, globalObject->mockModule.stubbedGlobals);
    JSValue key = identifierToJSValue(vm, name);
    bool isRemembered = originals->has(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isRemembered) {
        JSValue original = jsUndefined();
        PropertyDescriptor descriptor;
        bool exists = target->getOwnPropertyDescriptor(globalObject, name, descriptor);
        RETURN_IF_EXCEPTION(scope, {});
        if (exists) {
            JSObject* object = constructObjectFromPropertyDescriptor(globalObject, descriptor);
            RETURN_IF_EXCEPTION(scope, {});
            object->setPrototypeDirect(vm, jsNull());
            original = object;
        }
        originals->set(globalObject, key, original);
        RETURN_IF_EXCEPTION(scope, {});
    }

    target->methodTable()->defineOwnProperty(target, globalObject, name, PropertyDescriptor(value, 0), true);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(callFrame->thisValue());
}

JSC_DEFINE_HOST_FUNCTION(jsViUnstubAllGlobals, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(getVM(lexicalGlobalObject));
    unstubAllGlobals(defaultGlobalObject(lexicalGlobalObject));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(callFrame->thisValue());
}

// What `process.env` is now: tests replace it with a copy.
static JSObject* processEnv(Zig::GlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue env = globalObject->processObject()->get(globalObject, Identifier::fromString(vm, "env"_s));
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (JSObject* object = env.getObject())
        return object;
    return globalObject->processEnvObject();
}

static void setEnv(JSGlobalObject* globalObject, JSObject* env, JSValue key, JSValue valueOrUndefined)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto name = key.toPropertyKey(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    scope.release();
    if (valueOrUndefined.isUndefined()) {
        JSCell::deleteProperty(env, globalObject, name);
        return;
    }
    PutPropertySlot slot(env, true);
    env->methodTable()->put(env, globalObject, name, valueOrUndefined, slot);
}

static void unstubAllEnvs(Zig::GlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));

    auto& stubbedEnvs = globalObject->mockModule.stubbedEnvs;
    if (!stubbedEnvs)
        return;
    JSObject* env = processEnv(globalObject);
    RETURN_IF_EXCEPTION(scope, );
    RELEASE_AND_RETURN(scope, restoreOriginals(globalObject, stubbedEnvs, env, setEnv));
}

JSC_DEFINE_HOST_FUNCTION(jsViStubEnv, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    String name = callFrame->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSValue value = callFrame->argument(1);
    if (!value.isUndefined()) {
        if (name == "DEV"_s || name == "PROD"_s || name == "SSR"_s) {
            value = value.toBoolean(globalObject) ? jsString(vm, String("1"_s)) : jsEmptyString(vm);
        } else {
            value = value.toString(globalObject);
            RETURN_IF_EXCEPTION(scope, {});
        }
    }

    JSObject* env = processEnv(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    JSMap* originals = ensureOriginals(vm, globalObject, globalObject->mockModule.stubbedEnvs);
    JSValue nameString = jsString(vm, name);
#if OS(WINDOWS)
    JSValue key = jsString(vm, name.convertToUppercaseWithoutLocale());
#else
    JSValue key = nameString;
#endif
    bool isRemembered = originals->has(globalObject, key);
    RETURN_IF_EXCEPTION(scope, {});
    if (!isRemembered) {
        JSValue original = jsUndefined();
        auto propertyName = Identifier::fromString(vm, name);
        PropertySlot slot(env, PropertySlot::InternalMethodType::GetOwnProperty);
        bool exists = env->methodTable()->getOwnPropertySlot(env, globalObject, propertyName, slot);
        RETURN_IF_EXCEPTION(scope, {});
        if (exists) {
            original = slot.getValue(globalObject, propertyName);
            RETURN_IF_EXCEPTION(scope, {});
        }
        originals->set(globalObject, key, original);
        RETURN_IF_EXCEPTION(scope, {});
    }

    setEnv(globalObject, env, nameString, value);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(callFrame->thisValue());
}

JSC_DEFINE_HOST_FUNCTION(jsViUnstubAllEnvs, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(getVM(lexicalGlobalObject));
    unstubAllEnvs(defaultGlobalObject(lexicalGlobalObject));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(callFrame->thisValue());
}

// Forgets the imports that have settled, and returns one that has not.
static JSPromise* pendingDynamicImport(Zig::GlobalObject* globalObject)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSValue dynamicImports = globalObject->mockModule.dynamicImports.get();
    if (!dynamicImports)
        return nullptr;
    auto* imports = uncheckedDowncast<JSSet>(dynamicImports);
    auto* iterator = JSSetIterator::create(vm, globalObject->setIteratorStructure(), imports, IterationKind::Keys);
    JSPromise* pending = nullptr;
    while (JSValue import = iterator->nextWithAdvance(vm)) {
        auto* promise = uncheckedDowncast<JSPromise>(import);
        if (promise->status() != JSPromise::Status::Pending) {
            imports->remove(globalObject, import);
            RETURN_IF_EXCEPTION(scope, nullptr);
        } else if (!pending)
            pending = promise;
    }
    return pending;
}

void didStartDynamicImport(Zig::GlobalObject* globalObject, JSPromise* import)
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto& dynamicImports = globalObject->mockModule.dynamicImports;
    if (!dynamicImports)
        dynamicImports.set(vm, globalObject, JSSet::create(vm, globalObject->setStructure()));
    auto* imports = uncheckedDowncast<JSSet>(dynamicImports.get());
    // Sweeping only at powers of two keeps the cost of a sweep proportional to what was added since the last one.
    if (uint32_t size = imports->size(); size >= 16 && hasOneBitSet(size)) {
        pendingDynamicImport(globalObject);
        RETURN_IF_EXCEPTION(scope, );
    }
    RELEASE_AND_RETURN(scope, imports->add(globalObject, import));
}

JSC_DECLARE_HOST_FUNCTION(jsViFulfillUnlessImporting);

// After a real `setTimeout(0)`, so that what script scheduled before it has run.
static void fulfillOnceImportsSettle(JSGlobalObject* globalObject, JSPromise* promise)
{
    auto* fulfillUnlessImporting = JSFunction::create(getVM(globalObject), globalObject, 1, String(), jsViFulfillUnlessImporting, ImplementationVisibility::Private);
    Bun__Timer__setTimeout(globalObject, JSValue::encode(fulfillUnlessImporting), JSValue::encode(promise), JSValue::encode(jsNumber(0)));
}

JSC_DEFINE_HOST_FUNCTION(jsViDynamicImportDidSettle, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto scope = DECLARE_THROW_SCOPE(getVM(globalObject));
    fulfillOnceImportsSettle(globalObject, uncheckedDowncast<JSPromise>(callFrame->argument(1)));
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsViFulfillUnlessImporting, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* promise = uncheckedDowncast<JSPromise>(callFrame->argument(0));
    JSPromise* pending = pendingDynamicImport(defaultGlobalObject(globalObject));
    RETURN_IF_EXCEPTION(scope, {});
    if (pending) {
        auto* didSettle = JSFunction::create(vm, globalObject, 2, String(), jsViDynamicImportDidSettle, ImplementationVisibility::Private);
        pending->performPromiseThenWithContext(vm, globalObject, didSettle, didSettle, jsUndefined(), promise);
    } else
        promise->fulfill(vm, jsUndefined());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsViDynamicImportSettled, (JSGlobalObject * globalObject, CallFrame*))
{
    auto& vm = getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    auto* promise = JSPromise::create(vm, globalObject->promiseStructure());
    fulfillOnceImportsSettle(globalObject, promise);
    RETURN_IF_EXCEPTION(scope, {});
    return JSValue::encode(promise);
}

} // namespace Bun

extern "C" void ViUtils__putFunctions(Zig::GlobalObject* globalObject, JSC::EncodedJSValue encodedVi)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSObject* vi = JSC::JSValue::decode(encodedVi).getObject();
    auto put = [&](ASCIILiteral name, unsigned length, JSC::NativeFunction function) {
        vi->putDirectNativeFunction(vm, globalObject, JSC::Identifier::fromString(vm, name), length, function, JSC::ImplementationVisibility::Public, JSC::NoIntrinsic, 0);
    };
    put("stubEnv"_s, 2, Bun::jsViStubEnv);
    put("unstubAllEnvs"_s, 0, Bun::jsViUnstubAllEnvs);
    put("stubGlobal"_s, 2, Bun::jsViStubGlobal);
    put("unstubAllGlobals"_s, 0, Bun::jsViUnstubAllGlobals);
    put("dynamicImportSettled"_s, 0, Bun::jsViDynamicImportSettled);
}

extern "C" void ViUtils__unstubAllEnvs(Zig::GlobalObject* globalObject)
{
    Bun::unstubAllEnvs(globalObject);
}

extern "C" void ViUtils__unstubAllGlobals(Zig::GlobalObject* globalObject)
{
    Bun::unstubAllGlobals(globalObject);
}

extern "C" void ViUtils__forgetDynamicImports(Zig::GlobalObject* globalObject)
{
    globalObject->mockModule.dynamicImports.clear();
}
