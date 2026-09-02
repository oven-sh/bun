#include "BakeGlobalObject.h"
#include "BakeSourceProvider.h"
#include "JSNextTickQueue.h"
#include "JavaScriptCore/GlobalObjectMethodTable.h"
#include "JavaScriptCore/JSPromise.h"
#include "headers-handwritten.h"
#include "JavaScriptCore/JSModuleLoader.h"
#include "JavaScriptCore/Completion.h"
#include "JavaScriptCore/JSSourceCode.h"

extern "C" BunString BakeProdResolve(JSC::JSGlobalObject*, const BunString* a, const BunString* b);
extern "C" BunString BakeToWindowsPath(const BunString* a);

namespace Bake {
using namespace JSC;

JSC::JSPromise*
bakeModuleLoaderImportModule(JSC::JSGlobalObject* global,
    JSC::JSModuleLoader* moduleLoader, JSC::JSString* moduleNameValue,
    RefPtr<JSC::ScriptFetchParameters> parameters,
    const JSC::SourceOrigin& sourceOrigin,
    bool deferred)
{
    UNUSED_PARAM(deferred);
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);

    WTF::String keyString = moduleNameValue->getString(global);
    RETURN_IF_EXCEPTION(scope, nullptr);
    if (keyString.startsWith("bake:/"_s)) {
        RELEASE_AND_RETURN(scope, JSC::importModule(global, JSC::Identifier::fromString(vm, keyString), JSC::Identifier(), WTF::move(parameters), nullptr));
    }

    if (!sourceOrigin.isNull() && sourceOrigin.string().startsWith("bake:/"_s)) {
        WTF::String refererString = sourceOrigin.string();

        BunString refererBunString = Bun::toString(refererString);
        BunString keyBunString = Bun::toString(keyString);
        BunString result = BakeProdResolve(global, &refererBunString, &keyBunString);
        RETURN_IF_EXCEPTION(scope, nullptr);

        RELEASE_AND_RETURN(scope, JSC::importModule(global, JSC::Identifier::fromString(vm, result.transferToWTFString()), JSC::Identifier(), WTF::move(parameters), nullptr));
    }

    // TODO: make static cast instead of jscast
    RELEASE_AND_RETURN(scope, uncheckedDowncast<Zig::GlobalObject>(global)->moduleLoaderImportModule(global, moduleLoader, moduleNameValue, WTF::move(parameters), sourceOrigin, false));
}

JSC::Identifier bakeModuleLoaderResolve(JSC::JSGlobalObject* jsGlobal,
    JSC::JSModuleLoader* loader, JSC::JSValue key,
    JSC::JSValue referrer, RefPtr<JSC::ScriptFetcher> origin, bool useImportMap)
{
    Bake::GlobalObject* global = uncheckedDowncast<Bake::GlobalObject>(jsGlobal);
    auto& vm = JSC::getVM(global);
    auto scope = DECLARE_THROW_SCOPE(vm);

    if (auto string = dynamicDowncast<JSC::JSString>(referrer)) {
        WTF::String refererString = string->getString(global);
        RETURN_IF_EXCEPTION(scope, {});

        WTF::String keyString = key.toWTFString(global);
        RETURN_IF_EXCEPTION(scope, {});

        if (refererString.startsWith("bake:/"_s) || (refererString == "."_s && keyString.startsWith("bake:/"_s))) {
            BunString refererBunString = Bun::toString(refererString);
            BunString keyBunString = Bun::toString(keyString);
            BunString result = BakeProdResolve(global, &refererBunString, &keyBunString);
            RETURN_IF_EXCEPTION(scope, {});

            return JSC::Identifier::fromString(vm, result.transferToWTFString());
        }
    }

    if (auto string = dynamicDowncast<JSC::JSString>(key)) {
        auto keyView = string->getString(global);
        RETURN_IF_EXCEPTION(scope, {});

        if (keyView.startsWith("bake:/"_s)) {
            WTF::String keyWithoutScheme = keyView.substringSharingImpl("bake:"_s.length());
            BunString bakePrefixBunString = { BunStringTag::StaticEncodedSlice, { .encoded = { reinterpret_cast<const unsigned char*>("bake:/"), 6 } } };
            BunString keyBunString = Bun::toString(keyWithoutScheme);
            BunString result = BakeProdResolve(global, &bakePrefixBunString, &keyBunString);
            RETURN_IF_EXCEPTION(scope, {});

            return JSC::Identifier::fromString(vm, result.transferToWTFString());
        }
    }

    RELEASE_AND_RETURN(scope, Zig::GlobalObject::moduleLoaderResolve(jsGlobal, loader, key, referrer, WTF::move(origin), useImportMap));
}

static JSC::JSPromise* rejectedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    promise->rejectAsHandled(vm, value);
    return promise;
}

static JSC::JSPromise* resolvedInternalPromise(JSC::JSGlobalObject* globalObject, JSC::JSValue value)
{
    auto& vm = JSC::getVM(globalObject);
    JSC::JSPromise* promise = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    promise->fulfill(vm, value);
    return promise;
}

extern "C" BunString BakeProdLoad(void* perThreadData, const BunString* a);

extern "C" bool BakeGlobalObject__isBakeGlobalObject(JSC::JSGlobalObject* global)
{
    return global->JSCell::inherits(Bake::GlobalObject::info());
}

extern "C" void* BakeGlobalObject__getPerThreadData(JSC::JSGlobalObject* global)
{
    Bake::GlobalObject* bake = uncheckedDowncast<Bake::GlobalObject>(global);
    return bake->m_perThreadData;
}

JSC::JSPromise* bakeModuleLoaderFetch(JSC::JSGlobalObject* globalObject,
    JSC::JSModuleLoader* loader, JSC::JSValue key, const WTF::String& referrer,
    RefPtr<JSC::ScriptFetchParameters> parameters, RefPtr<JSC::ScriptFetcher> script)
{
    Bake::GlobalObject* global = uncheckedDowncast<Bake::GlobalObject>(globalObject);
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto moduleKey = key.toWTFString(globalObject);
    if (scope.exception()) [[unlikely]]
        return rejectedInternalPromise(globalObject, scope.exception()->value());

    if (moduleKey.startsWith("bake:/"_s)) {
        if (global->m_perThreadData) [[likely]] {
            BunString moduleKeyBunString = Bun::toString(moduleKey);
            BunString source = BakeProdLoad(global->m_perThreadData, &moduleKeyBunString);
            if (!source.isDead()) {
                JSC::SourceOrigin origin = JSC::SourceOrigin(WTF::URL(moduleKey));
                JSC::SourceCode sourceCode = JSC::SourceCode(Bake::SourceProvider::create(
                    globalObject,
                    source.transferToWTFString(),
                    origin,
                    WTF::move(moduleKey),
                    WTF::TextPosition(),
                    JSC::SourceProviderSourceType::Module));
                return resolvedInternalPromise(globalObject, JSC::JSSourceCode::create(vm, WTF::move(sourceCode)));
            }

            // We unconditionally prefix the key with "bake:" inside
            // BakeProdResolve.
            //
            // But if someone does: `await import(resolve(import.meta.dir, "nav.ts"))`
            // we don't actually want to load it from the Bake production module
            // map and instead make it go through the normal codepath.
            auto bakePrefixRemoved = moduleKey.substringSharingImpl("bake:"_s.length());

#ifdef _WIN32
            // We normalize paths to contain forward slashes in bake so we don't
            // have to worry about platform paths. Now we have to worry about
            // it, because `moduleLoaderFetch(...)` may read the path from disk
            // and so we need to give a Windows path to it.
            BunString bakePrefixRemovedBunString = Bun::toString(bakePrefixRemoved);
            bakePrefixRemoved = BakeToWindowsPath(&bakePrefixRemovedBunString).transferToWTFString();
#endif
            JSString* bakePrefixRemovedString = jsNontrivialString(vm, bakePrefixRemoved);
            JSValue bakePrefixRemovedJsvalue = bakePrefixRemovedString;
            RELEASE_AND_RETURN(scope, Zig::GlobalObject::moduleLoaderFetch(globalObject, loader, bakePrefixRemovedJsvalue, referrer, WTF::move(parameters), WTF::move(script)));
        }
        return rejectedInternalPromise(globalObject, createTypeError(globalObject, "BakeGlobalObject does not have per-thread data configured"_s));
    }

    RELEASE_AND_RETURN(scope, Zig::GlobalObject::moduleLoaderFetch(globalObject, loader, key, referrer, WTF::move(parameters), WTF::move(script)));
}

GlobalObject* GlobalObject::create(JSC::VM& vm, JSC::Structure* structure,
    const JSC::GlobalObjectMethodTable* methodTable)
{
    Bake::GlobalObject* ptr = new (NotNull, JSC::allocateCell<Bake::GlobalObject>(vm))
        Bake::GlobalObject(vm, structure, methodTable);
    ptr->finishCreation(vm);
    return ptr;
}

void GlobalObject::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSC::Structure* GlobalObject::createStructure(JSC::VM& vm)
{
    auto* structure = JSC::Structure::create(vm, nullptr, jsNull(), JSC::TypeInfo(JSC::GlobalObjectType, StructureFlags & ~IsImmutablePrototypeExoticObject), info());
    structure->setTransitionWatchpointIsLikelyToBeFired(true);
    return structure;
}

struct BunVirtualMachine;
extern "C" BunVirtualMachine* Bun__getVM();

const JSC::GlobalObjectMethodTable& GlobalObject::globalObjectMethodTable()
{
    const auto& parent = Zig::GlobalObject::globalObjectMethodTable();
#define INHERIT_HOOK_METHOD(name) \
    parent.name

    static const JSC::GlobalObjectMethodTable table = {
        INHERIT_HOOK_METHOD(supportsRichSourceInfo),
        INHERIT_HOOK_METHOD(shouldInterruptScript),
        INHERIT_HOOK_METHOD(javaScriptRuntimeFlags),
        INHERIT_HOOK_METHOD(shouldInterruptScriptBeforeTimeout),
        bakeModuleLoaderImportModule,
        bakeModuleLoaderResolve,
        bakeModuleLoaderFetch,
        INHERIT_HOOK_METHOD(moduleLoaderCreateImportMetaProperties),
        INHERIT_HOOK_METHOD(moduleLoaderEvaluate),
        INHERIT_HOOK_METHOD(promiseRejectionTracker),
        INHERIT_HOOK_METHOD(reportUncaughtExceptionAtEventLoop),
        INHERIT_HOOK_METHOD(currentScriptExecutionOwner),
        INHERIT_HOOK_METHOD(scriptExecutionStatus),
        INHERIT_HOOK_METHOD(reportViolationForUnsafeEval),
        INHERIT_HOOK_METHOD(defaultLanguage),
        INHERIT_HOOK_METHOD(compileStreaming),
        INHERIT_HOOK_METHOD(instantiateStreaming),
        INHERIT_HOOK_METHOD(deriveShadowRealmGlobalObject),
        INHERIT_HOOK_METHOD(codeForEval),
        INHERIT_HOOK_METHOD(canCompileStrings),
        INHERIT_HOOK_METHOD(trustedScriptStructure),
    };
#undef INHERIT_HOOK_METHOD
    return table;
}

// A lot of this function is taken from 'Zig__GlobalObject__create'
// TODO: remove this entire method
extern "C" GlobalObject* BakeCreateProdGlobal(void* console)
{
    RefPtr<JSC::VM> vmPtr = JSC::VM::tryCreate(JSC::HeapType::Large);
    if (!vmPtr) [[unlikely]] {
        BUN_PANIC("Failed to allocate JavaScriptCore Virtual Machine. Did your computer run out of memory? Or maybe you compiled Bun with a mismatching libc++ version or compiler?");
    }
    // We need to unsafely ref this so it stays alive, later in
    // `Zig__GlobalObject__destructOnExit` will call
    // `vm.derefSuppressingSaferCPPChecking()` to free it.
    vmPtr->refSuppressingSaferCPPChecking();
    JSC::VM& vm = *vmPtr;

    vm.heap.acquireAccess();
    JSC::JSLockHolder locker(vm);
    BunVirtualMachine* bunVM = Bun__getVM();
    WebCore::JSVMClientData::create(&vm, bunVM, /* worker */ nullptr);

    JSC::Structure* structure = Bake::GlobalObject::createStructure(vm);
    Bake::GlobalObject* global = Bake::GlobalObject::create(
        vm, structure, &Bake::GlobalObject::globalObjectMethodTable());
    if (!global)
        BUN_PANIC("Failed to create BakeGlobalObject");

    global->m_bunVM = bunVM;

    JSC::gcProtect(global);

    global->setConsole(console);
    global->isThreadLocalDefaultGlobalObject = true;

    vm.heap.disableStopIfNecessaryTimer();

    return global;
}

extern "C" void BakeGlobalObject__attachPerThreadData(GlobalObject* global, void* perThreadData)
{
    global->m_perThreadData = perThreadData;
}

const JSC::ClassInfo Bake::GlobalObject::s_info = { "GlobalObject"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(Bake::GlobalObject) };

}; // namespace Bake
