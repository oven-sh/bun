/**
 * How this works
 *
 * CommonJS modules are transpiled by Bun's transpiler to the following:
 *
 * (function (exports, require, module) { ... code })(exports, require, module)
 *
 * Then, at runtime, we create a JSCommonJSModule object.
 *
 * On this special object, we override the setter for the "exports" property in
 * a non-observable way using a CustomGetterSetter.
 *
 * When the setter is called, we set the internal "exports" property to the
 * value passed in and we also update the requireMap with the new value.
 *
 * After the CommonJS module is executed, we:
 * - Store the exports value in the requireMap (again)
 * - Loop through the keys of the exports object and re-export as ES Module
 *   named exports
 *
 * If an exception occurs, we remove the entry from the requireMap.
 *
 * How cyclical dependencies are handled:
 *
 * Before executing the CommonJS module, we set the exports object in the
 * requireMap to an empty object. When the CommonJS module is required again, we
 * return the exports object from the requireMap. The values should be in sync
 * while the module is being executed, unless module.exports is re-assigned to a
 * different value. In that case, it will have a stale value.
 */

#include "BunString.h"
#include "headers.h"

#include "JavaScriptCore/CallData.h"
#include "JavaScriptCore/Synchronousness.h"
#include "JavaScriptCore/JSCast.h"
#include <JavaScriptCore/JSMapInlines.h>
#include "root.h"
#include "JavaScriptCore/SourceCode.h"
#include "headers-handwritten.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/JSString.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/OptionsList.h>
#include <JavaScriptCore/ParserError.h>
#include <JavaScriptCore/ScriptExecutable.h>
#include <JavaScriptCore/SourceOrigin.h>
#include <JavaScriptCore/StackFrame.h>
#include <JavaScriptCore/StackVisitor.h>
#include "BunClientData.h"
#include <JavaScriptCore/Identifier.h>
#include "ImportMetaObject.h"
#include "NodeModuleModule.h"
#include <JavaScriptCore/TypedArrayInlines.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/JSWeakMap.h>
#include <JavaScriptCore/JSWeakMapInlines.h>
#include <JavaScriptCore/JSWithScope.h>

#include <JavaScriptCore/DFGAbstractHeap.h>
#include <JavaScriptCore/Completion.h>
#include "ModuleLoader.h"
#include <JavaScriptCore/JSMap.h>

#include <JavaScriptCore/JSMapInlines.h>
#include <JavaScriptCore/GetterSetter.h>
#include "ZigSourceProvider.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include "JSCommonJSModule.h"
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include "PathInlines.h"
#include "wtf/NakedPtr.h"
#include "wtf/URL.h"
#include "wtf/text/StringImpl.h"
#include "JSCommonJSExtensions.h"

#include "ErrorCode.h"

extern "C" bool Bun__isBunMain(JSC::JSGlobalObject* global, const BunString*);

namespace Bun {
using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsFunctionRequireCommonJS);
JSC_DECLARE_HOST_FUNCTION(jsFunctionRequireNativeModule);

static bool canPerformFastEnumeration(Structure* s)
{
    if (s->typeInfo().overridesGetOwnPropertySlot())
        return false;
    if (s->typeInfo().overridesAnyFormOfGetOwnPropertyNames())
        return false;
    if (hasIndexedProperties(s->indexingType()))
        return false;
    if (s->hasAnyKindOfGetterSetterProperties())
        return false;
    if (s->isUncacheableDictionary())
        return false;
    if (s->hasUnderscoreProtoPropertyExcludingOriginalProto())
        return false;
    return true;
}

extern "C" bool Bun__VM__specifierIsEvalEntryPoint(void*, EncodedJSValue);
extern "C" void Bun__VM__setEntryPointEvalResultCJS(void*, EncodedJSValue);

static bool evaluateCommonJSModuleOnce(JSC::VM& vm, Zig::GlobalObject* globalObject, JSCommonJSModule* moduleObject, JSString* dirname, JSValue filename)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    SourceCode code = std::move(moduleObject->sourceCode);

    // If an exception occurred somewhere else, we might have cleared the source code.
    if (code.isNull()) [[unlikely]] {
        throwException(globalObject, scope, createError(globalObject, "Failed to evaluate module"_s));
        return false;
    }

    JSFunction* resolveFunction = nullptr;
    JSFunction* requireFunction = nullptr;
    const auto initializeModuleObject = [&]() {
        resolveFunction = JSC::JSBoundFunction::create(vm,
            globalObject,
            globalObject->requireResolveFunctionUnbound(),
            moduleObject->filename(),
            ArgList(), 1, globalObject->commonStrings().resolveString(globalObject));
        RETURN_IF_EXCEPTION(scope, );
        requireFunction = JSC::JSBoundFunction::create(vm,
            globalObject,
            globalObject->requireFunctionUnbound(),
            moduleObject,
            ArgList(), 1, globalObject->commonStrings().requireString(globalObject));
        RETURN_IF_EXCEPTION(scope, );
        requireFunction->putDirect(vm, vm.propertyNames->resolve, resolveFunction, 0);
        RETURN_IF_EXCEPTION(scope, );
        moduleObject->putDirect(vm, WebCore::clientData(vm)->builtinNames().requirePublicName(), requireFunction, 0);
        RETURN_IF_EXCEPTION(scope, );
        moduleObject->hasEvaluated = true;
    };

    if (Bun__VM__specifierIsEvalEntryPoint(globalObject->bunVM(), JSValue::encode(filename))) [[unlikely]] {
        initializeModuleObject();
        scope.assertNoExceptionExceptTermination();

        // Using same approach as node, `arguments` in the entry point isn't defined
        // https://github.com/nodejs/node/blob/592c6907bfe1922f36240e9df076be1864c3d1bd/lib/internal/process/execution.js#L92
        auto exports = moduleObject->exportsObject();
        RETURN_IF_EXCEPTION(scope, {});
        globalObject->putDirect(vm, builtinNames(vm).exportsPublicName(), exports, 0);
        globalObject->putDirect(vm, builtinNames(vm).requirePublicName(), requireFunction, 0);
        globalObject->putDirect(vm, Identifier::fromString(vm, "module"_s), moduleObject, 0);
        globalObject->putDirect(vm, Identifier::fromString(vm, "__filename"_s), filename, 0);
        globalObject->putDirect(vm, Identifier::fromString(vm, "__dirname"_s), dirname, 0);

        JSValue result = JSC::evaluate(globalObject, code, jsUndefined());
        RETURN_IF_EXCEPTION(scope, false);
        ASSERT(result);

        Bun__VM__setEntryPointEvalResultCJS(globalObject->bunVM(), JSValue::encode(result));

        RELEASE_AND_RETURN(scope, true);
    }

    JSValue fnValue = JSC::evaluate(globalObject, code, jsUndefined());
    RETURN_IF_EXCEPTION(scope, false);
    ASSERT(fnValue);

    JSObject* fn = fnValue.getObject();
    if (!fn) [[unlikely]] {
        scope.throwException(globalObject, createTypeError(globalObject, "Expected CommonJS module to have a function wrapper. If you weren't messing around with Bun's internals, this is a bug in Bun"_s));
        RELEASE_AND_RETURN(scope, false);
    }

    JSC::CallData callData = JSC::getCallData(fn);
    if (callData.type == CallData::Type::None) [[unlikely]] {
        scope.throwException(globalObject, createTypeError(globalObject, "Expected CommonJS module to have a function wrapper. If you weren't messing around with Bun's internals, this is a bug in Bun"_s));
        RELEASE_AND_RETURN(scope, false);
    }

    initializeModuleObject();
    RETURN_IF_EXCEPTION(scope, false);

    MarkedArgumentBuffer args;
    auto exports = moduleObject->exportsObject();
    RETURN_IF_EXCEPTION(scope, false);
    args.append(exports); // exports
    args.append(requireFunction); // require
    args.append(moduleObject); // module
    args.append(filename); // filename
    args.append(dirname); // dirname

    if (auto* jsFunction = jsDynamicCast<JSC::JSFunction*>(fn)) {
        if (jsFunction->jsExecutable()->parameterCount() > 5) {
            // it expects ImportMetaObject
            args.append(Zig::ImportMetaObject::create(globalObject, filename));
        }
    }

    // Clear the source code as early as possible.
    code = {};

    // Call the CommonJS module wrapper function.
    //
    //    fn(exports, require, module, __filename, __dirname) { /* code */ }(exports, require, module, __filename, __dirname)
    //
    JSC::profiledCall(globalObject, ProfilingReason::API, fn, callData, moduleObject, args);
    RETURN_IF_EXCEPTION(scope, false);
    return true;
}

bool JSCommonJSModule::load(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (this->hasEvaluated || this->sourceCode.isNull()) {
        return true;
    }

    evaluateCommonJSModuleOnce(
        globalObject->vm(),
        jsCast<Zig::GlobalObject*>(globalObject),
        this,
        this->m_dirname.get(),
        this->m_filename.get());

    if (auto exception = scope.exception()) {
        scope.clearException();

        // On error, remove the module from the require map/
        // so that it can be re-evaluated on the next require.
        bool wasRemoved = globalObject->requireMap()->remove(globalObject, this->filename());
        ASSERT(wasRemoved);

        scope.throwException(globalObject, exception);
        return false;
    }

    return true;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionEvaluateCommonJSModule, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    // These casts are jsDynamicCast because require.cache pollution + invalid
    // this calls can put arbitrary values here instead of JSCommonJSModule*
    ASSERT(callframe->argumentCount() == 2);
    JSCommonJSModule* moduleObject = jsDynamicCast<JSCommonJSModule*>(callframe->uncheckedArgument(0));
    JSCommonJSModule* referrer = jsDynamicCast<JSCommonJSModule*>(callframe->uncheckedArgument(1));
    if (!moduleObject) [[unlikely]] {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(jsUndefined()));
    }

    JSValue returnValue = jsNull();
    if (referrer) [[likely]] {
        if (referrer->m_childrenValue) [[unlikely]] {
            // It's too hard to append from native code:
            // referrer.children.indexOf(moduleObject) === -1 && referrer.children.push(moduleObject)
            returnValue = referrer->m_childrenValue.get();
        } else {
            referrer->m_children.append(WriteBarrier<Unknown>());
            referrer->m_children.last().set(vm, referrer, moduleObject);
        }
    }

    moduleObject->load(vm, globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    RELEASE_AND_RETURN(throwScope, JSValue::encode(returnValue));
}

JSC_DEFINE_HOST_FUNCTION(requireResolvePathsFunction, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSValue request = callframe->argument(0);

    if (!request.isString()) {
        Bun::ERR::INVALID_ARG_TYPE(scope, globalObject, "request"_s, "string"_s, request);
        scope.release();
        return {};
    }

    auto requestStr = request.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    {
        UTF8View utf8(requestStr);
        auto span = utf8.span();
        if (ModuleLoader__isBuiltin(span.data(), span.size())) {
            return JSC::JSValue::encode(JSC::jsNull());
        }
    }

    RETURN_IF_EXCEPTION(scope, {});

    // This function is not bound with the module object. This is because nearly
    // no one uses this and it is not worth creating an extra bound function for
    // every single module. Instead, we can unwrap the bound function that we
    // can see through the `this`.
    JSValue thisValue = callframe->thisValue();
    auto* requireResolveBound = jsDynamicCast<JSC::JSBoundFunction*>(thisValue);
    if (!requireResolveBound) [[unlikely]] {
        return JSValue::encode(constructEmptyArray(globalObject, nullptr, 0));
    }
    JSValue boundThis = requireResolveBound->boundThis();
    JSString* filename = jsDynamicCast<JSString*>(boundThis);
    if (!filename) [[unlikely]] {
        return JSValue::encode(constructEmptyArray(globalObject, nullptr, 0));
    }
    RETURN_IF_EXCEPTION(scope, {});
    Bun::PathResolveModule parent = { .paths = nullptr, .filename = filename, .pathsArrayLazy = true };
    return JSValue::encode(Bun::resolveLookupPaths(globalObject, requestStr, parent));
}

JSC_DEFINE_CUSTOM_GETTER(jsRequireCacheGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = jsCast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(thisObject->lazyRequireCacheObject());
}

JSC_DEFINE_CUSTOM_SETTER(jsRequireCacheSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSObject* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->putDirect(globalObject->vm(), propertyName, JSValue::decode(value), 0);
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsRequireExtensionsGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = jsCast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(thisObject->lazyRequireExtensionsObject());
}

JSC_DEFINE_CUSTOM_SETTER(jsRequireExtensionsSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSObject* thisObject = jsDynamicCast<JSObject*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->putDirect(globalObject->vm(), propertyName, JSValue::decode(value), 0);
    return true;
}

static const HashTableValue RequireResolveFunctionPrototypeValues[] = {
    { "paths"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, requireResolvePathsFunction, 1 } },
};

static const HashTableValue RequireFunctionPrototypeValues[] = {
    { "cache"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsRequireCacheGetter, jsRequireCacheSetter } },
    { "extensions"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsRequireExtensionsGetter, jsRequireExtensionsSetter } },
};

Structure* RequireFunctionPrototype::createStructure(
    JSC::VM& vm,
    JSC::JSGlobalObject* globalObject)
{
    auto* structure = Structure::create(vm, globalObject, globalObject->functionPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    structure->setMayBePrototype(true);
    return structure;
}

Structure* RequireResolveFunctionPrototype::createStructure(
    JSC::VM& vm,
    JSC::JSGlobalObject* globalObject)
{
    auto* structure = Structure::create(vm, globalObject, globalObject->functionPrototype(), TypeInfo(ObjectType, StructureFlags), info());
    structure->setMayBePrototype(true);
    return structure;
}

RequireResolveFunctionPrototype* RequireResolveFunctionPrototype::create(JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);

    auto* structure = RequireResolveFunctionPrototype::createStructure(vm, globalObject);
    RequireResolveFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireResolveFunctionPrototype>(vm)) RequireResolveFunctionPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

RequireFunctionPrototype* RequireFunctionPrototype::create(
    JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);

    auto* structure = RequireFunctionPrototype::createStructure(vm, globalObject);
    RequireFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireFunctionPrototype>(vm)) RequireFunctionPrototype(vm, structure);
    prototype->finishCreation(vm);

    prototype->putDirect(vm, vm.propertyNames->resolve, jsCast<Zig::GlobalObject*>(globalObject)->requireResolveFunctionUnbound(), 0);

    return prototype;
}

void RequireFunctionPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    auto* globalObject = this->globalObject();

    reifyStaticProperties(vm, info(), RequireFunctionPrototypeValues, *this);
    JSC::JSFunction* requireDotMainFunction = JSFunction::create(
        vm,
        globalObject,
        commonJSMainCodeGenerator(vm),
        globalObject->globalScope());

    this->putDirectAccessor(
        globalObject,
        JSC::Identifier::fromString(vm, "main"_s),
        JSC::GetterSetter::create(vm, globalObject, requireDotMainFunction, requireDotMainFunction),
        PropertyAttribute::Accessor | PropertyAttribute::ReadOnly | 0);
}

JSC_DEFINE_CUSTOM_GETTER(getterFilename, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_filename.get());
}
JSC_DEFINE_CUSTOM_GETTER(getterId, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_id.get());
}

JSC_DEFINE_CUSTOM_GETTER(getterPath, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_dirname.get());
}

JSC_DEFINE_CUSTOM_GETTER(getterParent, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }

    if (thisObject->m_overriddenParent) {
        return JSValue::encode(thisObject->m_overriddenParent.get());
    }

    if (thisObject->m_parent) {
        auto* parent = thisObject->m_parent.get();
        return JSValue::encode(parent);
    }

    // initialize parent by checking if it is the main module. we do this lazily because most people
    // dont need `module.parent` and creating commonjs module records is done a ton.
    auto idValue = thisObject->m_id.get();
    if (idValue) {
        auto id = idValue->view(globalObject);
        if (id == "."_s) {
            thisObject->m_overriddenParent.set(globalObject->vm(), thisObject, jsNull());
            return JSValue::encode(jsNull());
        }
    }

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(setterPath,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_dirname.set(globalObject->vm(), thisObject, JSValue::decode(value).toString(globalObject));
    return true;
}

extern "C" JSC::EncodedJSValue Resolver__propForRequireMainPaths(JSGlobalObject*);

JSC_DEFINE_CUSTOM_GETTER(getterPaths, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }

    if (!thisObject->m_paths) {
        JSValue filename = thisObject->filename();
        ASSERT(filename);
        auto filenameWtfStr = filename.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        BunString filenameStr = Bun::toString(filenameWtfStr);
        JSValue paths = JSValue::decode(Resolver__nodeModulePathsJSValue(filenameStr, globalObject, true));
        RETURN_IF_EXCEPTION(scope, {});
        thisObject->m_paths.set(globalObject->vm(), thisObject, paths);
        return JSValue::encode(paths);
    }

    return JSValue::encode(thisObject->m_paths.get());
}

JSC_DEFINE_CUSTOM_SETTER(setterChildren,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;
    thisObject->m_children.clear();
    thisObject->m_childrenValue.set(globalObject->vm(), thisObject, JSValue::decode(value));
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(getterChildren, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* mod = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!mod) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }

    if (!mod->m_childrenValue) {
        auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
        MarkedArgumentBuffer children;
        children.ensureCapacity(mod->m_children.size());

        // Deduplicate children while preserving insertion order.
        JSCommonJSModule* last = nullptr;
        int n = -1;
        for (WriteBarrier<Unknown> childBarrier : mod->m_children) {
            JSCommonJSModule* child = jsCast<JSCommonJSModule*>(childBarrier.get());
            // Check the last module since duplicate imports, if any, will
            // probably be adjacent. Then just do a linear scan.
            if (last == child) [[unlikely]]
                continue;
            int i = 0;
            while (i < n) {
                if (children.at(i).asCell() == child) [[unlikely]]
                    goto next;
                i += 1;
            }
            children.append(child);
            last = child;
            n += 1;
        next: {
        }
        }

        // Construct the array
        JSArray* array = JSC::constructArray(globalObject, static_cast<ArrayAllocationProfile*>(nullptr), children);
        RETURN_IF_EXCEPTION(throwScope, {});
        mod->m_childrenValue.set(globalObject->vm(), mod, array);

        mod->m_children.clear();

        return JSValue::encode(array);
    }

    return JSValue::encode(mod->m_childrenValue.get());
}

JSC_DEFINE_CUSTOM_GETTER(getterLoaded, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsBoolean(thisObject->hasEvaluated));
}

JSC_DEFINE_CUSTOM_SETTER(setterPaths,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_paths.set(globalObject->vm(), thisObject, JSValue::decode(value));
    return true;
}

JSC_DEFINE_CUSTOM_SETTER(setterFilename,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_filename.set(globalObject->vm(), thisObject, JSValue::decode(value).toString(globalObject));
    return true;
}

JSC_DEFINE_CUSTOM_SETTER(setterId,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_id.set(globalObject->vm(), thisObject, JSValue::decode(value).toString(globalObject));
    return true;
}
JSC_DEFINE_CUSTOM_SETTER(setterParent,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    JSValue decodedValue = JSValue::decode(value);

    if (auto* parent = jsDynamicCast<JSCommonJSModule*>(decodedValue)) {
        thisObject->m_parent = parent;
        thisObject->m_overriddenParent.clear();
    } else {
        thisObject->m_parent = {};
    }

    return true;
}
JSC_DEFINE_CUSTOM_SETTER(setterLoaded,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->hasEvaluated = JSValue::decode(value).toBoolean(globalObject);

    return true;
}

JSC_DEFINE_CUSTOM_GETTER(getterUnderscoreCompile, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]] {
        return JSValue::encode(jsUndefined());
    }
    if (thisObject->m_overriddenCompile) {
        return JSValue::encode(thisObject->m_overriddenCompile.get());
    }
    return JSValue::encode(defaultGlobalObject(globalObject)->modulePrototypeUnderscoreCompileFunction());
}

JSC_DEFINE_CUSTOM_SETTER(setterUnderscoreCompile,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;
    JSValue decodedValue = JSValue::decode(value);
    thisObject->m_overriddenCompile.set(globalObject->vm(), thisObject, decodedValue);
    return true;
}

JSC_DEFINE_HOST_FUNCTION(functionJSCommonJSModule_compile, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto* moduleObject = jsDynamicCast<JSCommonJSModule*>(callframe->thisValue());
    if (!moduleObject) {
        return JSValue::encode(jsUndefined());
    }

    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    String sourceString = callframe->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    JSValue filenameValue = callframe->argument(1);
    String filenameString = filenameValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    String wrappedString;
    auto* zigGlobalObject = jsCast<Zig::GlobalObject*>(globalObject);
    if (zigGlobalObject->hasOverriddenModuleWrapper) [[unlikely]] {
        wrappedString = makeString(
            zigGlobalObject->m_moduleWrapperStart,
            sourceString,
            zigGlobalObject->m_moduleWrapperEnd);
    } else {
        wrappedString = makeString(
            "(function(exports,require,module,__filename,__dirname){"_s,
            sourceString,
            "\n})"_s);
    }

    moduleObject->sourceCode = makeSource(
        WTFMove(wrappedString),
        SourceOrigin(URL::fileURLWithFileSystemPath(filenameString)),
        JSC::SourceTaintedOrigin::Untainted,
        filenameString,
        WTF::TextPosition(),
        JSC::SourceProviderSourceType::Program);

    EncodedJSValue encodedFilename = JSValue::encode(filenameValue);
#if OS(WINDOWS)
    JSValue dirnameValue = JSValue::decode(Bun__Path__dirname(globalObject, true, &encodedFilename, 1));
#else
    JSValue dirnameValue = JSValue::decode(Bun__Path__dirname(globalObject, false, &encodedFilename, 1));
#endif
    RETURN_IF_EXCEPTION(throwScope, {});

    String dirnameString = dirnameValue.toWTFString(globalObject);

    WTF::NakedPtr<JSC::Exception> exception;
    evaluateCommonJSModuleOnce(
        vm,
        jsCast<Zig::GlobalObject*>(globalObject),
        moduleObject,
        jsString(vm, dirnameString),
        jsString(vm, filenameString));
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(jsUndefined());
}

static const struct HashTableValue JSCommonJSModulePrototypeTableValues[] = {
    { "_compile"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, getterUnderscoreCompile, setterUnderscoreCompile } },
    { "children"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, getterChildren, setterChildren } },
    { "filename"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterFilename, setterFilename } },
    { "id"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterId, setterId } },
    { "loaded"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterLoaded, setterLoaded } },
    { "parent"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, getterParent, setterParent } },
    { "path"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterPath, setterPath } },
    { "paths"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, getterPaths, setterPaths } },
};

class JSCommonJSModulePrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSCommonJSModulePrototype* create(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::Structure* structure)
    {
        JSCommonJSModulePrototype* prototype = new (NotNull, JSC::allocateCell<JSCommonJSModulePrototype>(vm)) JSCommonJSModulePrototype(vm, structure);
        prototype->finishCreation(vm, globalObject);
        return prototype;
    }

    static JSC::Structure* createStructure(
        JSC::VM& vm,
        JSC::JSGlobalObject* globalObject,
        JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;

    JSCommonJSModulePrototype(
        JSC::VM& vm,
        JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCommonJSModulePrototype, Base);
        return &vm.plainObjectSpace();
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(info()));
        reifyStaticProperties(vm, info(), JSCommonJSModulePrototypeTableValues, *this);

        this->putDirectNativeFunction(
            vm,
            globalObject,
            clientData(vm)->builtinNames().requirePrivateName(),
            2,
            jsFunctionRequireCommonJS, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);
        this->putDirectNativeFunction(
            vm,
            globalObject,
            clientData(vm)->builtinNames().requireNativeModulePrivateName(),
            0,
            jsFunctionRequireNativeModule, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);
    }
};

const JSC::ClassInfo JSCommonJSModulePrototype::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSModulePrototype) };

void JSCommonJSModule::finishCreation(JSC::VM& vm, JSC::JSString* id, JSValue filename, JSC::JSString* dirname, const JSC::SourceCode& sourceCode)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_id.set(vm, this, id);
    m_filename.set(vm, this, filename);
    m_dirname.set(vm, this, dirname);
    this->sourceCode = sourceCode;
}

JSC::Structure* JSCommonJSModule::createStructure(
    JSC::JSGlobalObject* globalObject)
{
    auto& vm = JSC::getVM(globalObject);

    auto* prototype = JSCommonJSModulePrototype::create(vm, globalObject, JSCommonJSModulePrototype::createStructure(vm, globalObject, globalObject->objectPrototype()));

    // Do not set the number of inline properties on this structure
    // there may be an off-by-one error in the Structure which causes `require.id` to become the require
    return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info(), NonArray);
}

JSCommonJSModule* JSCommonJSModule::create(
    JSC::VM& vm,
    JSC::Structure* structure,
    JSC::JSString* id,
    JSValue filename,
    JSC::JSString* dirname,
    const JSC::SourceCode& sourceCode)
{
    JSCommonJSModule* cell = new (NotNull, JSC::allocateCell<JSCommonJSModule>(vm)) JSCommonJSModule(vm, structure);
    cell->finishCreation(vm, id, filename, dirname, sourceCode);
    return cell;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateCommonJSModule, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    RELEASE_ASSERT(callframe->argumentCount() == 4);

    auto id = callframe->uncheckedArgument(0).toString(globalObject);
    JSValue object = callframe->uncheckedArgument(1);
    JSValue hasEvaluated = callframe->uncheckedArgument(2);
    ASSERT(hasEvaluated.isBoolean());
    JSValue parent = callframe->uncheckedArgument(3);

    return JSValue::encode(JSCommonJSModule::create(jsCast<Zig::GlobalObject*>(globalObject), id, object, hasEvaluated.isTrue(), parent));
}

JSCommonJSModule* JSCommonJSModule::create(
    Zig::GlobalObject* globalObject,
    JSC::JSString* requireMapKey,
    JSValue exportsObject,
    bool hasEvaluated,
    JSValue parent)
{
    auto& vm = JSC::getVM(globalObject);
    auto key = requireMapKey->value(globalObject);
    auto index = key->reverseFind(PLATFORM_SEP, key->length());

    JSString* dirname;
    if (index != WTF::notFound) {
        dirname = JSC::jsSubstring(globalObject, requireMapKey, 0, index);
    } else {
        dirname = jsEmptyString(vm);
    }

    auto* out = JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        requireMapKey, requireMapKey, dirname, SourceCode());

    out->putDirect(
        vm,
        WebCore::clientData(vm)->builtinNames().exportsPublicName(),
        exportsObject,
        0);
    out->hasEvaluated = hasEvaluated;
    if (parent && parent.isCell()) {
        if (auto* parentModule = jsDynamicCast<JSCommonJSModule*>(parent)) {
            out->m_parent = JSC::Weak<JSCommonJSModule>(parentModule);
        } else {
            out->m_overriddenParent.set(vm, out, parent);
        }
    } else if (parent) {
        out->m_overriddenParent.set(vm, out, parent);
    }

    return out;
}

JSCommonJSModule* JSCommonJSModule::create(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    JSValue exportsObject,
    bool hasEvaluated,
    JSValue parent)
{
    auto& vm = JSC::getVM(globalObject);
    auto* requireMapKey = JSC::jsStringWithCache(vm, key);
    return JSCommonJSModule::create(globalObject, requireMapKey, exportsObject, hasEvaluated, parent);
}

size_t JSCommonJSModule::estimatedSize(JSC::JSCell* cell, JSC::VM& vm)
{
    auto* thisObject = jsCast<JSCommonJSModule*>(cell);
    size_t additionalSize = 0;
    if (!thisObject->sourceCode.isNull() && !thisObject->sourceCode.view().isEmpty()) {
        additionalSize += thisObject->sourceCode.view().length();
        if (!thisObject->sourceCode.view().is8Bit()) {
            additionalSize *= 2;
        }
    }
    return Base::estimatedSize(cell, vm) + additionalSize;
}

void JSCommonJSModule::destroy(JSC::JSCell* cell)
{
    static_cast<JSCommonJSModule*>(cell)->JSCommonJSModule::~JSCommonJSModule();
}

JSCommonJSModule::~JSCommonJSModule()
{
}

void populateESMExports(
    JSC::JSGlobalObject* globalObject,
    JSValue result,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues,
    bool ignoreESModuleAnnotation)
{
    auto& vm = JSC::getVM(globalObject);
    const Identifier& esModuleMarker = vm.propertyNames->__esModule;

    // Bun's interpretation of the "__esModule" annotation:
    //
    //   - If a "default" export does not exist OR the __esModule annotation is not present, then we
    //   set the default export to the exports object
    //
    //   - If a "default" export also exists, then we set the default export
    //   to the value of it (matching Babel behavior)
    //
    // https://stackoverflow.com/questions/50943704/whats-the-purpose-of-object-definepropertyexports-esmodule-value-0
    // https://github.com/nodejs/node/issues/40891
    // https://github.com/evanw/bundler-esm-cjs-tests
    // https://github.com/evanw/esbuild/issues/1591
    // https://github.com/oven-sh/bun/issues/3383
    //
    // Note that this interpretation is slightly different
    //
    //    -  We do not ignore when "type": "module" or when the file
    //       extension is ".mjs". Build tools determine that based on the
    //       caller's behavior, but in a JS runtime, there is only one ModuleNamespaceObject.
    //
    //       It would be possible to match the behavior at runtime, but
    //       it would need further engine changes which do not match the ES Module spec
    //
    //   -   We ignore the value of the annotation. We only look for the
    //       existence of the value being set. This is for performance reasons, but also
    //       this annotation is meant for tooling and the only usages of setting
    //       it to something that does NOT evaluate to "true" I could find were in
    //       unit tests of build tools. Happy to revisit this if users file an issue.
    bool needsToAssignDefault = true;

    if (auto* exports = result.getObject()) {
        bool hasESModuleMarker = false;
        if (!ignoreESModuleAnnotation) {
            auto catchScope = DECLARE_CATCH_SCOPE(vm);
            PropertySlot slot(exports, PropertySlot::InternalMethodType::VMInquiry, &vm);
            if (exports->getPropertySlot(globalObject, esModuleMarker, slot)) {
                JSValue value = slot.getValue(globalObject, esModuleMarker);
                if (!value.isUndefinedOrNull()) {
                    if (value.pureToBoolean() == TriState::True) {
                        hasESModuleMarker = true;
                    }
                }
            }
            if (catchScope.exception()) {
                catchScope.clearException();
            }
        }

        auto* structure = exports->structure();
        uint32_t size = structure->inlineSize() + structure->outOfLineSize();
        exportNames.reserveCapacity(size + 2);
        exportValues.ensureCapacity(size + 2);

        auto catchScope = DECLARE_CATCH_SCOPE(vm);

        if (catchScope.exception()) {
            catchScope.clearException();
        }

        if (hasESModuleMarker) {
            if (canPerformFastEnumeration(structure)) {
                exports->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                    auto key = entry.key();
                    if (key->isSymbol() || key == esModuleMarker)
                        return true;

                    needsToAssignDefault = needsToAssignDefault && key != vm.propertyNames->defaultKeyword;

                    JSValue value = exports->getDirect(entry.offset());

                    exportNames.append(Identifier::fromUid(vm, key));
                    exportValues.append(value);
                    return true;
                });
            } else {
                JSC::PropertyNameArray properties(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
                exports->methodTable()->getOwnPropertyNames(exports, globalObject, properties, DontEnumPropertiesMode::Exclude);
                if (catchScope.exception()) {
                    catchScope.clearExceptionExceptTermination();
                    return;
                }

                for (auto property : properties) {
                    if (property.isEmpty() || property.isNull() || property == esModuleMarker || property.isPrivateName() || property.isSymbol()) [[unlikely]]
                        continue;

                    // ignore constructor
                    if (property == vm.propertyNames->constructor)
                        continue;

                    JSC::PropertySlot slot(exports, PropertySlot::InternalMethodType::Get);
                    if (!exports->getPropertySlot(globalObject, property, slot))
                        continue;

                    // Allow DontEnum properties which are not getter/setters
                    // https://github.com/oven-sh/bun/issues/4432
                    if (slot.attributes() & PropertyAttribute::DontEnum) {
                        if (!(slot.isValue() || slot.isCustom())) {
                            continue;
                        }
                    }

                    exportNames.append(property);

                    JSValue getterResult = slot.getValue(globalObject, property);

                    // If it throws, we keep them in the exports list, but mark it as undefined
                    // This is consistent with what Node.js does.
                    if (catchScope.exception()) {
                        catchScope.clearException();
                        getterResult = jsUndefined();
                    }

                    exportValues.append(getterResult);

                    needsToAssignDefault = needsToAssignDefault && property != vm.propertyNames->defaultKeyword;
                }
            }

        } else if (canPerformFastEnumeration(structure)) {
            exports->structure()->forEachProperty(vm, [&](const PropertyTableEntry& entry) -> bool {
                auto key = entry.key();
                if (key->isSymbol() || key == vm.propertyNames->defaultKeyword)
                    return true;

                JSValue value = exports->getDirect(entry.offset());

                exportNames.append(Identifier::fromUid(vm, key));
                exportValues.append(value);
                return true;
            });
        } else {
            JSC::PropertyNameArray properties(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
            exports->methodTable()->getOwnPropertyNames(exports, globalObject, properties, DontEnumPropertiesMode::Include);
            if (catchScope.exception()) {
                catchScope.clearExceptionExceptTermination();
                return;
            }

            for (auto property : properties) {
                if (property.isEmpty() || property.isNull() || property == vm.propertyNames->defaultKeyword || property.isPrivateName() || property.isSymbol()) [[unlikely]]
                    continue;

                // ignore constructor
                if (property == vm.propertyNames->constructor)
                    continue;

                JSC::PropertySlot slot(exports, PropertySlot::InternalMethodType::Get);
                if (!exports->getPropertySlot(globalObject, property, slot))
                    continue;

                if (slot.attributes() & PropertyAttribute::DontEnum) {
                    // Allow DontEnum properties which are not getter/setters
                    // https://github.com/oven-sh/bun/issues/4432
                    if (!(slot.isValue() || slot.isCustom())) {
                        continue;
                    }
                }

                exportNames.append(property);

                JSValue getterResult = slot.getValue(globalObject, property);

                // If it throws, we keep them in the exports list, but mark it as undefined
                // This is consistent with what Node.js does.
                if (catchScope.exception()) {
                    catchScope.clearException();
                    getterResult = jsUndefined();
                }

                exportValues.append(getterResult);
            }
        }
    }

    if (needsToAssignDefault) {
        exportNames.append(vm.propertyNames->defaultKeyword);
        exportValues.append(result);
    }
}

void JSCommonJSModule::toSyntheticSource(JSC::JSGlobalObject* globalObject,
    const JSC::Identifier& moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto scope = DECLARE_THROW_SCOPE(JSC::getVM(globalObject));
    auto result = this->exportsObject();
    RETURN_IF_EXCEPTION(scope, );

    populateESMExports(globalObject, result, exportNames, exportValues, this->ignoreESModuleAnnotation);
}

void JSCommonJSModule::setExportsObject(JSC::JSValue exportsObject)
{
    this->putDirect(vm(), JSC::PropertyName(clientData(vm())->builtinNames().exportsPublicName()), exportsObject, 0);
}

Structure* createCommonJSModuleStructure(
    Zig::GlobalObject* globalObject)
{
    return JSCommonJSModule::createStructure(globalObject);
}

template<typename Visitor>
void JSCommonJSModule::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    JSCommonJSModule* thisObject = jsCast<JSCommonJSModule*>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);

    // Use appendHidden so it doesn't show up in the heap snapshot twice.
    visitor.appendHidden(thisObject->m_id);
    visitor.appendHidden(thisObject->m_filename);
    visitor.appendHidden(thisObject->m_dirname);
    visitor.appendHidden(thisObject->m_paths);
    visitor.appendHidden(thisObject->m_overriddenParent);
    visitor.appendHidden(thisObject->m_childrenValue);
    visitor.appendValues(thisObject->m_children.begin(), thisObject->m_children.size());
}

DEFINE_VISIT_CHILDREN(JSCommonJSModule);

void JSCommonJSModule::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<JSCommonJSModule*>(cell);

    analyzer.setLabelForCell(cell, "Module (CommonJS)"_s);

    Base::analyzeHeap(cell, analyzer);
    auto& vm = cell->vm();
    auto& builtinNames = Bun::builtinNames(vm);
    if (auto* id = thisObject->m_id.get()) {
        analyzer.analyzePropertyNameEdge(cell, id, vm.propertyNames->id.impl());
    }

    if (thisObject->m_filename) {
        JSValue filename = thisObject->m_filename.get();
        if (filename.isCell()) {
            analyzer.analyzePropertyNameEdge(cell, filename.asCell(), builtinNames.filenamePublicName().impl());
        }
    }

    if (thisObject->m_dirname) {
        JSValue dirname = thisObject->m_dirname.get();
        if (dirname.isCell()) {
            analyzer.analyzePropertyNameEdge(cell, dirname.asCell(), builtinNames.dirnamePublicName().impl());
        }
    }

    if (thisObject->m_paths) {
        JSValue paths = thisObject->m_paths.get();
        if (paths.isCell()) {
            analyzer.analyzePropertyNameEdge(cell, paths.asCell(), builtinNames.pathsPublicName().impl());
        }
    }

    if (thisObject->m_overriddenParent) {
        JSValue overriddenParent = thisObject->m_overriddenParent.get();
        if (overriddenParent.isCell()) {
            const Identifier overriddenParentIdentifier = Identifier::fromString(vm, "parent"_s);
            analyzer.analyzePropertyNameEdge(cell, overriddenParent.asCell(), overriddenParentIdentifier.impl());
        }
    }
}

const JSC::ClassInfo JSCommonJSModule::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSModule) };
const JSC::ClassInfo RequireResolveFunctionPrototype::s_info = { "resolve"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireResolveFunctionPrototype) };
const JSC::ClassInfo RequireFunctionPrototype::s_info = { "require"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireFunctionPrototype) };

ALWAYS_INLINE EncodedJSValue finishRequireWithError(Zig::GlobalObject* globalObject, JSC::ThrowScope& throwScope, JSC::JSValue specifierValue)
{
    JSC::JSValue exception = throwScope.exception();
    ASSERT(exception);
    throwScope.clearException();

    // On error, remove the module from the require map/
    // so that it can be re-evaluated on the next require.
    bool wasRemoved = globalObject->requireMap()->remove(globalObject, specifierValue);
    ASSERT(wasRemoved);

    throwScope.throwException(globalObject, exception);
    RELEASE_AND_RETURN(throwScope, {});
}
#define REQUIRE_CJS_RETURN_IF_EXCEPTION      \
    if (throwScope.exception()) [[unlikely]] \
    return finishRequireWithError(globalObject, throwScope, specifierValue)

// JSCommonJSModule.$require(resolvedId, newModule, userArgumentCount, userOptions)
JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireCommonJS, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    ASSERT(callframe->argumentCount() == 4);
    // If overriddenRequire is called with invalid this, execution could potentially reach here.
    JSCommonJSModule* referrerModule = jsDynamicCast<JSCommonJSModule*>(callframe->thisValue());
    if (!referrerModule)
        return throwVMTypeError(globalObject, throwScope);
    JSValue specifierValue = callframe->uncheckedArgument(0);
    // If Module._resolveFilename is overridden, this could cause this to be a non-string
    WTF::String specifier = specifierValue.toWTFString(globalObject);
    REQUIRE_CJS_RETURN_IF_EXCEPTION;
    // If this.filename is overridden, this could cause this to be a non-string
    WTF::String referrer = referrerModule->filename().toWTFString(globalObject);
    REQUIRE_CJS_RETURN_IF_EXCEPTION;

    // This is always a new JSCommonJSModule object; cast cannot fail.
    JSCommonJSModule* child = jsCast<JSCommonJSModule*>(callframe->uncheckedArgument(1));

    BunString referrerStr = Bun::toString(referrer);
    BunString typeAttributeStr = { BunStringTag::Dead };
    String typeAttribute = String();

    // We need to be able to wire in the "type" import attribute from bundled code..
    // So we do it via CommonJS require().
    // $argumentCount() always returns a Int32 JSValue
    int32_t userArgumentCount = callframe->argument(2).asInt32();
    // If they called require(id), skip the check for the type attribute
    if (userArgumentCount >= 2) [[unlikely]] {
        JSValue options = callframe->uncheckedArgument(3);
        if (options.isObject()) {
            JSObject* obj = options.getObject();
            // This getter is expensive and rare.
            if (auto typeValue = obj->getIfPropertyExists(globalObject, vm.propertyNames->type)) {
                if (typeValue.isString()) {
                    typeAttribute = typeValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(throwScope, {});
                    typeAttributeStr = Bun::toString(typeAttribute);
                }
            }
            REQUIRE_CJS_RETURN_IF_EXCEPTION;
        }
    }

    // Load the module
    JSValue fetchResult = Bun::fetchCommonJSModule(
        globalObject,
        child,
        specifierValue,
        specifier,
        &referrerStr,
        typeAttribute.isEmpty()
            ? nullptr
            : &typeAttributeStr);
    REQUIRE_CJS_RETURN_IF_EXCEPTION;
    RELEASE_AND_RETURN(throwScope, JSValue::encode(fetchResult));
}
#undef REQUIRE_CJS_RETURN_IF_EXCEPTION

JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireNativeModule, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = JSC::getVM(globalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(callframe->thisValue());
    if (!thisObject)
        return throwVMTypeError(globalObject, throwScope);

    JSValue specifierValue = callframe->argument(0);
    WTF::String specifier = specifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});
    ErrorableResolvedSource res;
    res.success = false;
    memset(&res.result, 0, sizeof res.result);
    BunString specifierStr = Bun::toString(specifier);
    auto result = fetchBuiltinModuleWithoutResolution(globalObject, &specifierStr, &res);
    RETURN_IF_EXCEPTION(throwScope, {});
    if (result) {
        if (res.success)
            return JSC::JSValue::encode(result);
    }
    throwScope.assertNoExceptionExceptTermination();
    return throwVMError(globalObject, throwScope, "Failed to fetch builtin module"_s);
}

void RequireResolveFunctionPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    reifyStaticProperties(vm, info(), RequireResolveFunctionPrototypeValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

void JSCommonJSModule::evaluate(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    ResolvedSource& source,
    bool isBuiltIn)
{
    auto& vm = JSC::getVM(globalObject);

    if (globalObject->hasOverriddenModuleWrapper) [[unlikely]] {
        auto string = source.source_code.toWTFString(BunString::ZeroCopy);
        auto trimStart = string.find('\n');
        if (trimStart != WTF::notFound) {
            if (source.needsDeref && !isBuiltIn) {
                source.needsDeref = false;
                source.source_code.deref();
            }
            auto wrapperStart = globalObject->m_moduleWrapperStart;
            auto wrapperEnd = globalObject->m_moduleWrapperEnd;
            source.source_code = Bun::toStringRef(makeString(
                wrapperStart,
                string.substring(trimStart, string.length() - trimStart - 4),
                wrapperEnd));
            source.needsDeref = true;
        }
    }

    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program, isBuiltIn);
    this->ignoreESModuleAnnotation = source.tag == ResolvedSourceTagPackageJSONTypeModule;
    if (this->hasEvaluated)
        return;

    this->sourceCode = JSC::SourceCode(WTFMove(sourceProvider));

    evaluateCommonJSModuleOnce(vm, globalObject, this, this->m_dirname.get(), this->m_filename.get());
}

void JSCommonJSModule::evaluateWithPotentiallyOverriddenCompile(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    JSValue keyJSString,
    ResolvedSource& source)
{
    if (JSValue compileFunction = this->m_overriddenCompile.get()) {
        auto& vm = globalObject->vm();
        auto scope = DECLARE_THROW_SCOPE(vm);
        if (!compileFunction) {
            throwTypeError(globalObject, scope, "overridden module._compile is not a function (called from overridden Module._extensions)"_s);
            return;
        }
        JSC::CallData callData = JSC::getCallData(compileFunction.asCell());
        if (callData.type == JSC::CallData::Type::None) {
            throwTypeError(globalObject, scope, "overridden module._compile is not a function (called from overridden Module._extensions)"_s);
            return;
        }
        WTF::String sourceString = source.source_code.toWTFString(BunString::ZeroCopy);
        RETURN_IF_EXCEPTION(scope, );
        if (source.needsDeref) {
            source.needsDeref = false;
            source.source_code.deref();
        }
        // Remove the wrapper from the source string, since the transpiler has added it.
        auto trimStart = sourceString.find('\n');
        WTF::String sourceStringWithoutWrapper;
        if (trimStart != WTF::notFound) {
            auto wrapperStart = globalObject->m_moduleWrapperStart;
            auto wrapperEnd = globalObject->m_moduleWrapperEnd;
            sourceStringWithoutWrapper = sourceString.substring(trimStart, sourceString.length() - trimStart - 4);
        } else {
            sourceStringWithoutWrapper = sourceString;
        }
        RETURN_IF_EXCEPTION(scope, );

        // _compile(source, filename)
        MarkedArgumentBuffer arguments;
        arguments.append(jsString(vm, sourceStringWithoutWrapper));
        arguments.append(keyJSString);
        JSC::profiledCall(globalObject, ProfilingReason::API, compileFunction, callData, this, arguments);
        RETURN_IF_EXCEPTION(scope, );
        return;
    }
    this->evaluate(globalObject, key, source, false);
}

std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    JSString* requireMapKey,
    ResolvedSource& source,
    bool isBuiltIn)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSCommonJSModule* moduleObject = nullptr;
    WTF::String sourceURL = source.source_url.toWTFString();

    JSValue entry = globalObject->requireMap()->get(globalObject, requireMapKey);
    RETURN_IF_EXCEPTION(scope, {});
    bool ignoreESModuleAnnotation = source.tag == ResolvedSourceTagPackageJSONTypeModule;
    SourceOrigin sourceOrigin;

    if (entry) {
        moduleObject = jsDynamicCast<JSCommonJSModule*>(entry);
    }

    if (!moduleObject) {
        size_t index = sourceURL.reverseFind(PLATFORM_SEP, sourceURL.length());
        JSString* dirname;
        JSString* filename = requireMapKey;
        if (index != WTF::notFound) {
            dirname = JSC::jsSubstring(globalObject, requireMapKey, 0, index);
            RETURN_IF_EXCEPTION(scope, {});
        } else {
            dirname = jsEmptyString(vm);
        }
        auto requireMap = globalObject->requireMap();
        if (requireMap->size() == 0) {
            requireMapKey = JSC::jsString(vm, WTF::String("."_s));
        }

        if (globalObject->hasOverriddenModuleWrapper) [[unlikely]] {
            auto concat = makeString(
                globalObject->m_moduleWrapperStart,
                source.source_code.toWTFString(BunString::ZeroCopy),
                globalObject->m_moduleWrapperEnd);
            source.source_code.deref();
            source.source_code = Bun::toStringRef(concat);
        }

        auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program, isBuiltIn);
        sourceOrigin = sourceProvider->sourceOrigin();
        moduleObject = JSCommonJSModule::create(
            vm,
            globalObject->CommonJSModuleObjectStructure(),
            requireMapKey, filename, dirname, WTFMove(JSC::SourceCode(WTFMove(sourceProvider))));

        moduleObject->putDirect(vm,
            WebCore::clientData(vm)->builtinNames().exportsPublicName(),
            JSC::constructEmptyObject(globalObject, globalObject->objectPrototype()), 0);

        requireMap->set(globalObject, filename, moduleObject);
        RETURN_IF_EXCEPTION(scope, {});
    } else {
        sourceOrigin = Zig::toSourceOrigin(sourceURL, isBuiltIn);
    }

    moduleObject->ignoreESModuleAnnotation = ignoreESModuleAnnotation;

    return JSC::SourceCode(
        JSC::SyntheticSourceProvider::create(
            [](JSC::JSGlobalObject* lexicalGlobalObject,
                const JSC::Identifier& moduleKey,
                Vector<JSC::Identifier, 4>& exportNames,
                JSC::MarkedArgumentBuffer& exportValues) -> void {
                auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
                auto& vm = JSC::getVM(globalObject);
                auto scope = DECLARE_THROW_SCOPE(vm);

                JSValue keyValue = identifierToJSValue(vm, moduleKey);
                JSValue entry = globalObject->requireMap()->get(globalObject, keyValue);
                RETURN_IF_EXCEPTION(scope, {});

                if (entry) {
                    if (auto* moduleObject = jsDynamicCast<JSCommonJSModule*>(entry)) {
                        if (!moduleObject->hasEvaluated) {
                            evaluateCommonJSModuleOnce(
                                vm,
                                globalObject,
                                moduleObject,
                                moduleObject->m_dirname.get(),
                                moduleObject->m_filename.get());
                            if (auto exception = scope.exception()) {
                                scope.clearException();

                                // On error, remove the module from the require map
                                // so that it can be re-evaluated on the next require.
                                globalObject->requireMap()->remove(globalObject, moduleObject->filename());
                                RETURN_IF_EXCEPTION(scope, {});

                                scope.throwException(globalObject, exception);
                                return;
                            }
                        }

                        moduleObject->toSyntheticSource(globalObject, moduleKey, exportNames, exportValues);
                        RETURN_IF_EXCEPTION(scope, {});
                    }
                } else {
                    // require map was cleared of the entry
                }
            },
            sourceOrigin,
            sourceURL));
}

JSObject* JSCommonJSModule::createBoundRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString)
{
    ASSERT(!pathString.startsWith("file://"_s));

    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);

    JSString* filename = JSC::jsStringWithCache(vm, pathString);
    auto index = pathString.reverseFind(PLATFORM_SEP, pathString.length());
    JSString* dirname;
    if (index != WTF::notFound) {
        dirname = JSC::jsSubstring(globalObject, filename, 0, index);
        RETURN_IF_EXCEPTION(scope, nullptr);
    } else {
        dirname = jsEmptyString(vm);
    }

    auto moduleObject = Bun::JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        filename, filename, dirname, SourceCode());

    JSFunction* requireFunction = JSC::JSBoundFunction::create(vm,
        globalObject,
        globalObject->requireFunctionUnbound(),
        moduleObject,
        ArgList(), 1, globalObject->commonStrings().requireString(globalObject));
    RETURN_IF_EXCEPTION(scope, nullptr);

    JSFunction* resolveFunction = JSC::JSBoundFunction::create(vm,
        globalObject,
        globalObject->requireResolveFunctionUnbound(),
        moduleObject->filename(),
        ArgList(), 1, globalObject->commonStrings().resolveString(globalObject));
    RETURN_IF_EXCEPTION(scope, nullptr);

    requireFunction->putDirect(vm, vm.propertyNames->resolve, resolveFunction, 0);

    return requireFunction;
}

} // namespace Bun
