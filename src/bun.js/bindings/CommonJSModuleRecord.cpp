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

#include "headers.h"
#include "root.h"
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
#include "CommonJSModuleRecord.h"
#include <JavaScriptCore/JSModuleNamespaceObject.h>
#include <JavaScriptCore/JSSourceCode.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/HeapAnalyzer.h>

extern "C" bool Bun__isBunMain(JSC::JSGlobalObject* global, const BunString*);
extern "C" JSC__JSValue Bun__Path__basename(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);
extern "C" JSC__JSValue Bun__Path__dirname(JSC__JSGlobalObject* arg0, bool arg1, JSC__JSValue* arg2, uint16_t arg3);

namespace Bun {
using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsFunctionRequirePrivate);

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

static bool evaluateCommonJSModuleOnce(JSC::VM& vm, Zig::GlobalObject* globalObject, JSCommonJSModule* moduleObject, JSString* dirname, JSValue filename, WTF::NakedPtr<Exception>& exception)
{
    JSSourceCode* code = moduleObject->sourceCode.get();

    // If an exception occurred somewhere else, we might have cleared the source code.
    if (UNLIKELY(code == nullptr)) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwException(globalObject, throwScope, createError(globalObject, "Failed to evaluate module"_s));
        exception = throwScope.exception();
        return false;
    }

    auto clientData = WebCore::clientData(vm);
    auto builtinNames = clientData->builtinNames();
    auto globalString = globalObject->commonStrings().resolveString(globalObject);

    JSFunction* resolveFunction = JSC::JSBoundFunction::create(vm,
        globalObject,
        globalObject->requireResolveFunctionUnbound(),
        moduleObject->id(),
        ArgList(), 1, globalString);
    JSFunction* requireFunction = JSC::JSBoundFunction::create(vm,
        globalObject,
        globalObject->requireFunctionUnbound(),
        moduleObject,
        ArgList(), 1, globalString);
    requireFunction->putDirect(vm, vm.propertyNames->resolve, resolveFunction, 0);

    moduleObject->putDirect(vm, builtinNames.requirePublicName(), requireFunction, 0);
    moduleObject->hasEvaluated = true;

    // This will return 0 if there was a syntax error or an allocation failure
    JSValue fnValue = JSC::evaluate(globalObject, code->sourceCode(), jsUndefined(), exception);

    if (UNLIKELY(exception.get() || fnValue.isEmpty())) {
        moduleObject->sourceCode.clear();
        return false;
    }

    JSFunction* fn = jsCast<JSC::JSFunction*>(fnValue);

    JSC::CallData callData = JSC::getCallData(fn);
    MarkedArgumentBuffer args;
    args.append(moduleObject->exportsObject()); // exports
    args.append(requireFunction); // require
    args.append(moduleObject); // module
    args.append(filename); // filename
    args.append(dirname); // dirname

    if (fn->jsExecutable()->parameterCount() > 5) {
        // it expects ImportMetaObject
        args.append(Zig::ImportMetaObject::create(globalObject, filename));
    }

    JSC::call(globalObject, fn, callData, moduleObject, args, exception);

    moduleObject->sourceCode.clear();

    return exception.get() == nullptr;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionEvaluateCommonJSModule, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(globalObject->vm());
    JSCommonJSModule* moduleObject = jsDynamicCast<JSCommonJSModule*>(callFrame->argument(0));
    if (!moduleObject) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(true)));
    }

    if (moduleObject->hasEvaluated || !moduleObject->sourceCode) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(true)));
    }

    WTF::NakedPtr<Exception> exception;

    evaluateCommonJSModuleOnce(
        globalObject->vm(),
        jsCast<Zig::GlobalObject*>(globalObject),
        moduleObject,
        moduleObject->m_dirname.get(),
        moduleObject->m_filename.get(),
        exception);

    if (exception.get()) {
        // On error, remove the module from the require map/
        // so that it can be re-evaluated on the next require.
        globalObject->requireMap()->remove(globalObject, moduleObject->id());

        throwException(globalObject, throwScope, exception.get());
        exception.clear();
        return JSValue::encode({});
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(true)));
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireResolvePaths, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr, 0));
}

JSC_DEFINE_CUSTOM_GETTER(requireCacheGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    Zig::GlobalObject* thisObject = jsCast<Zig::GlobalObject*>(globalObject);
    return JSValue::encode(thisObject->lazyRequireCacheObject());
}

JSC_DEFINE_CUSTOM_SETTER(requireCacheSetter,
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
    { "paths"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsFunctionRequireResolvePaths, 1 } },
};

static const HashTableValue RequireFunctionPrototypeValues[] = {
    { "cache"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, requireCacheGetter, requireCacheSetter } },
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
    auto& vm = globalObject->vm();
    auto* structure = RequireResolveFunctionPrototype::createStructure(vm, globalObject);
    RequireResolveFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireResolveFunctionPrototype>(vm)) RequireResolveFunctionPrototype(vm, structure);
    prototype->finishCreation(vm);
    return prototype;
}

RequireFunctionPrototype* RequireFunctionPrototype::create(
    JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
    auto* structure = RequireFunctionPrototype::createStructure(vm, globalObject);
    RequireFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireFunctionPrototype>(vm)) RequireFunctionPrototype(vm, structure);
    prototype->finishCreation(vm);

    return prototype;
}

void RequireFunctionPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    reifyStaticProperties(vm, info(), RequireFunctionPrototypeValues, *this);

    auto clientData = WebCore::clientData(vm);
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(this->globalObject());
    auto builtinNames = clientData->builtinNames();

    JSC::JSFunction* requireDotMainFunction = JSFunction::create(
        vm,
        moduleMainCodeGenerator(vm),
        globalObject->globalScope());

    this->putDirectAccessor(
        globalObject,
        JSC::Identifier::fromString(vm, "main"_s),
        JSC::GetterSetter::create(vm, globalObject, requireDotMainFunction, requireDotMainFunction),
        PropertyAttribute::Accessor | PropertyAttribute::ReadOnly | 0);

    this->putDirect(vm, builtinNames.resolvePublicName(), globalObject->requireResolveFunctionUnbound(), 0);

    auto extensions = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    extensions->putDirect(vm, JSC::Identifier::fromString(vm, ".js"_s), jsBoolean(true), 0);
    extensions->putDirect(vm, JSC::Identifier::fromString(vm, ".json"_s), jsBoolean(true), 0);
    extensions->putDirect(vm, JSC::Identifier::fromString(vm, ".node"_s), jsBoolean(true), 0);
    extensions->putDirect(vm, builtinNames.originalStructureIDPrivateName(), jsNumber(0), 0);
    extensions->putDirect(vm, builtinNames.originalStructureIDPrivateName(), jsNumber(extensions->structureID().bits()), 0);
    this->putDirect(vm, JSC::Identifier::fromString(vm, "extensions"_s), extensions, 0);
}

JSC_DEFINE_CUSTOM_GETTER(filenameGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_filename.get());
}

JSC_DEFINE_CUSTOM_SETTER(filenameSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_filename.set(globalObject->vm(), thisObject, JSValue::decode(value).toString(globalObject));
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(idGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_id.get());
}

JSC_DEFINE_CUSTOM_SETTER(idSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_id.set(globalObject->vm(), thisObject, JSValue::decode(value).toString(globalObject));
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(loadedGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }

    return JSValue::encode(jsBoolean(thisObject->hasEvaluated));
}

JSC_DEFINE_CUSTOM_SETTER(loadedSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->hasEvaluated = JSValue::decode(value).toBoolean(globalObject);

    return true;
}

JSC_DEFINE_CUSTOM_GETTER(parentGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    auto v = thisObject->m_parent.get();
    if (v)
        return JSValue::encode(thisObject->m_parent.get());

    // initialize parent by checking if it is the main module. we do this lazily because most people
    // dont need `module.parent` and creating commonjs module records is done a ton.
    auto idValue = thisObject->m_id.get();
    if (idValue) {
        auto id = idValue->value(globalObject);
        auto idStr = Bun::toString(id);
        if (Bun__isBunMain(globalObject, &idStr)) {
            thisObject->m_parent.set(globalObject->vm(), thisObject, jsNull());
            return JSValue::encode(jsNull());
        }
    }

    thisObject->m_parent.set(globalObject->vm(), thisObject, jsUndefined());
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_CUSTOM_SETTER(parentSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_parent.set(globalObject->vm(), thisObject, JSValue::decode(value));

    return true;
}

JSC_DEFINE_CUSTOM_GETTER(pathGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_id.get());
}

JSC_DEFINE_CUSTOM_SETTER(pathSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_id.set(globalObject->vm(), thisObject, JSValue::decode(value).toString(globalObject));
    return true;
}

extern "C" JSC::EncodedJSValue Resolver__propForRequireMainPaths(JSGlobalObject*);

JSC_DEFINE_CUSTOM_GETTER(pathsGetter, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }

    if (!thisObject->m_paths) {
        JSValue paths = JSValue::decode(Resolver__propForRequireMainPaths(globalObject));
        thisObject->m_paths.set(globalObject->vm(), thisObject, paths);
    }

    return JSValue::encode(thisObject->m_paths.get());
}

JSC_DEFINE_CUSTOM_SETTER(pathsSetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName propertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;

    thisObject->m_paths.set(globalObject->vm(), thisObject, JSValue::decode(value));
    return true;
}

static JSValue createChildren(VM& vm, JSObject* object)
{
    return constructEmptyArray(object->globalObject(), nullptr, 0);
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionCommonJSModuleRecord_compile, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto* moduleObject = jsDynamicCast<JSCommonJSModule*>(callFrame->thisValue());
    if (!moduleObject) {
        return JSValue::encode(jsUndefined());
    }

    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue sourceValue = callFrame->argument(0);
    auto sourceWTF = sourceValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSValue::encode({}));

    JSValue filenameValue = callFrame->argument(1);
    auto filenameWTF = filenameValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, JSValue::encode({}));

    auto filename = JSC::jsStringWithCache(vm, filenameWTF);
    WTF::Vector<JSC::EncodedJSValue, 1> dirnameArgs;
    dirnameArgs.reserveInitialCapacity(1);
    dirnameArgs.unsafeAppendWithoutCapacityCheck(JSValue::encode(filenameValue));
#if OS(WINDOWS)
    auto dirname = JSValue::decode(Bun__Path__dirname(globalObject, true, reinterpret_cast<JSC__JSValue*>(dirnameArgs.data()), 1)).toString(globalObject);
#else
    auto dirname = JSValue::decode(Bun__Path__dirname(globalObject, false, reinterpret_cast<JSC__JSValue*>(dirnameArgs.data()), 1)).toString(globalObject);
#endif

    String wrappedString = makeString(
        "(function(exports,require,module,__filename,__dirname){"_s,
        sourceWTF,
        "\n})"_s);

    SourceCode sourceCode = JSC::makeSource(
        WTFMove(wrappedString),
        SourceOrigin(URL::fileURLWithFileSystemPath(filenameWTF)),
        JSC::SourceTaintedOrigin::Untainted,
        filenameWTF,
        WTF::TextPosition(),
        JSC::SourceProviderSourceType::Program);
    JSSourceCode* jsSourceCode = JSSourceCode::create(vm, WTFMove(sourceCode));
    moduleObject->sourceCode.set(vm, moduleObject, jsSourceCode);

    WTF::NakedPtr<JSC::Exception> exception;
    evaluateCommonJSModuleOnce(
        vm,
        jsCast<Zig::GlobalObject*>(globalObject),
        moduleObject,
        dirname,
        filename,
        exception);

    if (exception) {
        throwException(globalObject, throwScope, exception.get());
        exception.clear();
        return JSValue::encode({});
    }

    return JSValue::encode(jsUndefined());
}

extern "C" JSC::EncodedJSValue jsFunctionResolveSyncPrivate(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSValue moduleName = callFrame->argument(0);
    JSValue from = callFrame->argument(1);
    bool isESM = callFrame->argument(2).asBoolean();

    if (moduleName.isUndefinedOrNull()) {
        JSC::throwTypeError(globalObject, throwScope, "expected module name as a string"_s);
        throwScope.release();
        return JSValue::encode(JSValue {});
    }

    RETURN_IF_EXCEPTION(throwScope, JSValue::encode(JSValue {}));

    if (globalObject->onLoadPlugins.hasVirtualModules()) {
        if (moduleName.isString()) {
            auto moduleStr = moduleName.toWTFString(globalObject);
            auto resolvedString = globalObject->onLoadPlugins.resolveVirtualModule(moduleStr, from.toWTFString(globalObject));
            if (resolvedString) {
                if (moduleStr == resolvedString.value())
                    return JSValue::encode(moduleName);
                return JSValue::encode(jsString(vm, resolvedString.value()));
            }
        }
    }

    if (!isESM) {
        auto overrideHandler = globalObject->m_nodeModuleOverriddenResolveFilename.get();
        if (UNLIKELY(overrideHandler)) {
            ASSERT(overrideHandler->isCallable());
            auto requireMap = globalObject->requireMap();
            auto* parentModuleObject = jsDynamicCast<Bun::JSCommonJSModule*>(requireMap->get(globalObject, from));

            JSValue parentID = jsUndefined();
            if (parentModuleObject) {
                parentID = parentModuleObject->id();
            } else {
                parentID = from;
            }

            auto parentIdStr = parentID.toWTFString(globalObject);
            auto bunStr = Bun::toString(parentIdStr);

            MarkedArgumentBuffer args;
            args.append(moduleName);
            args.append(parentModuleObject);
            args.append(jsBoolean(Bun__isBunMain(globalObject, &bunStr)));

            // `Module` will be cached because requesting it is the only way to access `Module._resolveFilename`.
            auto* ModuleModuleObject = jsCast<Bun::JSCommonJSModule*>(requireMap->get(globalObject, JSC::jsStringWithCache(vm, "module"_s)));
            auto ModuleExportsObject = ModuleModuleObject->exportsObject();

            return JSValue::encode(JSC::call(globalObject, overrideHandler, JSC::getCallData(overrideHandler), ModuleExportsObject, args));
        }
    }

    auto result = Bun__resolveSync(globalObject, JSValue::encode(moduleName), JSValue::encode(from), isESM);

    if (!JSValue::decode(result).isString()) {
        JSC::throwException(globalObject, throwScope, JSValue::decode(result));
        return JSValue::encode(JSValue {});
    }

    throwScope.release();
    return result;
}

static const struct HashTableValue JSCommonJSModulePrototypeTableValues[] = {
    { "_compile"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, jsFunctionCommonJSModuleRecord_compile, 2 } },
    { "children"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, createChildren } },
    { "filename"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, filenameGetter, filenameSetter } },
    { "id"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, idGetter, idSetter } },
    { "loaded"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, loadedGetter, loadedSetter } },
    { "parent"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, parentGetter, parentSetter } },
    { "path"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, pathGetter, pathSetter } },
    { "paths"_s, static_cast<unsigned>(PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, pathsGetter, pathsSetter } },
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
        JSValue prototype)
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
            jsFunctionRequirePrivate, ImplementationVisibility::Public, NoIntrinsic, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete);
    }
};

const JSC::ClassInfo JSCommonJSModulePrototype::s_info = { "ModulePrototype"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSModulePrototype) };

void JSCommonJSModule::finishCreation(JSC::VM& vm, JSC::JSString* id, JSValue filename, JSC::JSString* dirname, JSC::JSSourceCode* sourceCode)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_id.set(vm, this, id);
    m_filename.set(vm, this, filename);
    m_dirname.set(vm, this, dirname);
    if (sourceCode)
        this->sourceCode.set(vm, this, sourceCode);
}

JSC::Structure* JSCommonJSModule::createStructure(
    JSC::JSGlobalObject* globalObject)
{
    auto& vm = globalObject->vm();
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
    JSC::JSSourceCode* sourceCode)
{
    JSCommonJSModule* cell = new (NotNull, JSC::allocateCell<JSCommonJSModule>(vm)) JSCommonJSModule(vm, structure);
    cell->finishCreation(vm, id, filename, dirname, sourceCode);
    return cell;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionCreateCommonJSModule, (JSGlobalObject * globalObject, CallFrame* callFrame))
{
    auto& vm = globalObject->vm();
    RELEASE_ASSERT(callFrame->argumentCount() == 4);

    auto id = callFrame->uncheckedArgument(0).toString(globalObject);
    JSValue object = callFrame->uncheckedArgument(1);
    JSValue hasEvaluated = callFrame->uncheckedArgument(2);
    ASSERT(hasEvaluated.isBoolean());
    JSValue parent = callFrame->uncheckedArgument(3);

    return JSValue::encode(JSCommonJSModule::create(jsCast<Zig::GlobalObject*>(globalObject), id, object, hasEvaluated.isTrue(), parent));
}

JSCommonJSModule* JSCommonJSModule::create(
    Zig::GlobalObject* globalObject,
    JSC::JSString* id,
    JSValue exportsObject,
    bool hasEvaluated,
    JSValue parent)
{
    auto& vm = globalObject->vm();
    WTF::Vector<JSC::EncodedJSValue, 1> dirnameArgs;
    dirnameArgs.reserveInitialCapacity(1);
    dirnameArgs.unsafeAppendWithoutCapacityCheck(JSValue::encode(id));
#if OS(WINDOWS)
    auto dirname = JSValue::decode(Bun__Path__dirname(globalObject, true, reinterpret_cast<JSC__JSValue*>(dirnameArgs.data()), 1)).toString(globalObject);
#else
    auto dirname = JSValue::decode(Bun__Path__dirname(globalObject, false, reinterpret_cast<JSC__JSValue*>(dirnameArgs.data()), 1)).toString(globalObject);
#endif

    auto* out = JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        id, id, dirname, nullptr);

    out->putDirect(
        vm,
        WebCore::clientData(vm)->builtinNames().exportsPublicName(),
        exportsObject,
        0);
    out->hasEvaluated = hasEvaluated;
    out->m_parent.set(vm, out, parent);

    return out;
}

void JSCommonJSModule::destroy(JSC::JSCell* cell)
{
    static_cast<JSCommonJSModule*>(cell)->JSCommonJSModule::~JSCommonJSModule();
}

JSCommonJSModule::~JSCommonJSModule()
{
}

bool JSCommonJSModule::evaluate(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    const SyntheticSourceProvider::SyntheticSourceGenerator& generator)
{
    Vector<JSC::Identifier, 4> propertyNames;
    JSC::MarkedArgumentBuffer arguments;
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    generator(globalObject, JSC::Identifier::fromString(vm, key), propertyNames, arguments);
    RETURN_IF_EXCEPTION(throwScope, false);
    // This goes off of the assumption that you only call this `evaluate` using a generator that explicitly
    // assigns the `default` export first.
    JSValue defaultValue = arguments.at(0);
    this->putDirect(vm, WebCore::clientData(vm)->builtinNames().exportsPublicName(), defaultValue, 0);
    this->hasEvaluated = true;
    RELEASE_AND_RETURN(throwScope, true);
}

void populateESMExports(
    JSC::JSGlobalObject* globalObject,
    JSValue result,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues,
    bool ignoreESModuleAnnotation)
{
    auto& vm = globalObject->vm();
    Identifier esModuleMarker = builtinNames(vm).__esModulePublicName();

    // Bun's intepretation of the "__esModule" annotation:
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

    if (result.isObject()) {
        auto* exports = result.getObject();
        bool hasESModuleMarker = !ignoreESModuleAnnotation && exports->hasProperty(globalObject, esModuleMarker);

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
                    if (key->isSymbol() || entry.attributes() & PropertyAttribute::DontEnum || key == esModuleMarker)
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
                    if (UNLIKELY(property.isEmpty() || property.isNull() || property == esModuleMarker || property.isPrivateName() || property.isSymbol()))
                        continue;

                    // ignore constructor
                    if (property == vm.propertyNames->constructor)
                        continue;

                    JSC::PropertySlot slot(exports, PropertySlot::InternalMethodType::Get);
                    if (!exports->getPropertySlot(globalObject, property, slot))
                        continue;

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
                if (key->isSymbol() || entry.attributes() & PropertyAttribute::DontEnum || key == vm.propertyNames->defaultKeyword)
                    return true;

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
                if (UNLIKELY(property.isEmpty() || property.isNull() || property == vm.propertyNames->defaultKeyword || property.isPrivateName() || property.isSymbol()))
                    continue;

                // ignore constructor
                if (property == vm.propertyNames->constructor)
                    continue;

                JSC::PropertySlot slot(exports, PropertySlot::InternalMethodType::Get);
                if (!exports->getPropertySlot(globalObject, property, slot))
                    continue;

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
    JSC::Identifier moduleKey,
    Vector<JSC::Identifier, 4>& exportNames,
    JSC::MarkedArgumentBuffer& exportValues)
{
    auto result = this->exportsObject();
    populateESMExports(globalObject, result, exportNames, exportValues, this->ignoreESModuleAnnotation);
}

JSValue JSCommonJSModule::exportsObject()
{
    return this->get(globalObject(), JSC::PropertyName(clientData(vm())->builtinNames().exportsPublicName()));
}

JSValue JSCommonJSModule::id()
{
    return m_id.get();
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
    visitor.append(thisObject->m_id);
    visitor.append(thisObject->sourceCode);
    visitor.append(thisObject->m_filename);
    visitor.append(thisObject->m_dirname);
    visitor.append(thisObject->m_paths);
}

DEFINE_VISIT_CHILDREN(JSCommonJSModule);

void JSCommonJSModule::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<JSCommonJSModule*>(cell);

    if (auto* id = thisObject->m_id.get()) {
        if (!id->isRope()) {
            auto label = id->tryGetValue(false);
            analyzer.setLabelForCell(cell, label);
        }
    }
    Base::analyzeHeap(cell, analyzer);
}

const JSC::ClassInfo JSCommonJSModule::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSModule) };
const JSC::ClassInfo RequireResolveFunctionPrototype::s_info = { "resolve"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireResolveFunctionPrototype) };
const JSC::ClassInfo RequireFunctionPrototype::s_info = { "require"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireFunctionPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsFunctionRequirePrivate, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(callFrame->thisValue());
    if (!thisObject) {
        return throwVMTypeError(globalObject, throwScope);
    }

    RETURN_IF_EXCEPTION(throwScope, {});

    JSValue specifierValue = callFrame->argument(0);
    auto specifier = specifierValue.toWTFString(globalObject);
    auto* moduleObject = jsCast<JSCommonJSModule*>(callFrame->argument(1));

    auto requireUnbound = globalObject->requireFunctionUnbound();
    auto requireUnboundPrototype = requireUnbound->getPrototype(vm, globalObject);
    if (requireUnboundPrototype.isObject()) {
        JSObject* prototype = requireUnboundPrototype.getObject();
        auto extensionsValue = prototype->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "extensions"_s));
        if (extensionsValue.isObject()) {
            auto clientData = WebCore::clientData(vm);
            auto builtinNames = clientData->builtinNames();
            JSObject* extensionsObject = extensionsValue.getObject();
            bool structureChanged = extensionsObject->getDirect(vm, builtinNames.originalStructureIDPrivateName()) != jsNumber(extensionsObject->structureID().bits());
            if (UNLIKELY(structureChanged)) {
                WTF::Vector<JSC::EncodedJSValue, 1> basenameArgs;
                basenameArgs.reserveInitialCapacity(1);
                basenameArgs.unsafeAppendWithoutCapacityCheck(JSC::JSValue::encode(specifierValue));
#if OS(WINDOWS)
                auto basename = JSValue::decode(Bun__Path__basename(globalObject, true, reinterpret_cast<JSC__JSValue*>(basenameArgs.data()), 1)).toWTFString(globalObject);
#else
                auto basename = JSValue::decode(Bun__Path__basename(globalObject, false, reinterpret_cast<JSC__JSValue*>(basenameArgs.data()), 1)).toWTFString(globalObject);
#endif
                size_t index = 0;
                uint16_t startIndex = 0;
                JSFunction* extHandler = nullptr;
                // Find longest registered extension.
                while ((index = basename.find("."_s, startIndex)) != WTF::notFound) {
                    if (index == 0) {
                        // Skip dotfiles like .gitignore
                        continue;
                    }
                    auto extStr = basename.substring(index);
                    auto extValue = extensionsObject->get(globalObject, JSC::Identifier::fromString(vm, extStr));
                    if (UNLIKELY(extValue.isCallable())) {
                        extHandler = jsCast<JSFunction*>(extValue);
                        break;
                    }
                    startIndex = index + 1;
                }
                // Fallback to ".js".
                if (LIKELY(!extHandler)) {
                    auto extValue = extensionsObject->get(globalObject, JSC::Identifier::fromString(vm, ".js"_s));
                    if (UNLIKELY(extValue.isCallable())) {
                        extHandler = jsCast<JSFunction*>(extValue);
                    }
                }
                if (UNLIKELY(extHandler)) {
                    JSC::CallData callData = JSC::getCallData(extHandler);
                    MarkedArgumentBuffer args;
                    args.append(moduleObject); // module
                    args.append(specifierValue); // id
                    // Call Module._extensions[ext](module, id)
                    JSC::call(globalObject, extHandler, callData, extensionsObject, args);
                    return JSValue::encode(moduleObject->exportsObject());
                }
            }
        }
    }

    // Special-case for "process" to just return the process object directly.
    if (UNLIKELY(specifier == "process"_s || specifier == "node:process"_s)) {
        moduleObject->putDirect(vm, Bun::builtinNames(vm).exportsPublicName(), globalObject->processObject(), 0);
        return JSValue::encode(globalObject->processObject());
    }

    WTF::String referrer = thisObject->id().toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    BunString specifierStr = Bun::toString(specifier);
    BunString referrerStr = Bun::toString(referrer);
    BunString typeAttributeStr = { BunStringTag::Dead };
    String typeAttribute = String();

    // We need to be able to wire in the "type" import attribute from bundled code..
    // so we do it via CommonJS require().
    int32_t previousArgumentCount = callFrame->argument(2).asInt32();
    // If they called require(id), skip the check for the type attribute
    if (UNLIKELY(previousArgumentCount == 2)) {
        JSValue attrValue = callFrame->argument(3);
        if (attrValue.isObject()) {
            JSObject* attrObject = attrValue.getObject();
            // This getter is expensive and rare.
            if (auto typeValue = attrObject->getIfPropertyExists(globalObject, vm.propertyNames->type)) {
                if (typeValue.isString()) {
                    typeAttribute = typeValue.toWTFString(globalObject);
                    RETURN_IF_EXCEPTION(throwScope, {});
                    typeAttributeStr = Bun::toString(typeAttribute);
                }
            }
            RETURN_IF_EXCEPTION(throwScope, {});
        }
    }

    JSValue fetchResult = Bun::fetchCommonJSModule(
        globalObject,
        moduleObject,
        specifierValue,
        &specifierStr,
        &referrerStr,
        LIKELY(typeAttribute.isEmpty())
            ? nullptr
            : &typeAttributeStr);

    RELEASE_AND_RETURN(throwScope, JSValue::encode(fetchResult));
}

void RequireResolveFunctionPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));

    reifyStaticProperties(vm, info(), RequireResolveFunctionPrototypeValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

bool JSCommonJSModule::evaluate(
    Zig::GlobalObject* globalObject,
    const WTF::String& key,
    ResolvedSource source,
    bool isBuiltIn)
{
    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program, isBuiltIn);
    this->ignoreESModuleAnnotation = source.tag == ResolvedSourceTagPackageJSONTypeModule;
    JSC::SourceCode rawInputSource(
        WTFMove(sourceProvider));

    if (this->hasEvaluated) {
        return true;
    }

    auto& vm = globalObject->vm();
    this->sourceCode.set(vm, this, JSC::JSSourceCode::create(vm, WTFMove(rawInputSource)));

    WTF::NakedPtr<JSC::Exception> exception;

    evaluateCommonJSModuleOnce(vm, globalObject, this, this->m_dirname.get(), this->m_filename.get(), exception);

    if (exception.get()) {
        // On error, remove the module from the require map/
        // so that it can be re-evaluated on the next require.
        globalObject->requireMap()->remove(globalObject, this->id());

        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwException(globalObject, throwScope, exception.get());
        exception.clear();

        return false;
    }

    return true;
}

std::optional<JSC::SourceCode> createCommonJSModule(
    Zig::GlobalObject* globalObject,
    ResolvedSource source,
    bool isBuiltIn)
{
    JSCommonJSModule* moduleObject = nullptr;
    auto sourceURL = source.source_url.toWTFString();
    auto sourceURLValue = Bun::toJS(globalObject, source.source_url);
    auto specifierValue = Bun::toJS(globalObject, source.specifier);
    auto entry = globalObject->requireMap()->get(globalObject, specifierValue);

    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program, isBuiltIn);
    bool ignoreESModuleAnnotation = source.tag == ResolvedSourceTagPackageJSONTypeModule;
    SourceOrigin sourceOrigin = sourceProvider->sourceOrigin();

    if (entry) {
        moduleObject = jsDynamicCast<JSCommonJSModule*>(entry);
    }

    if (!moduleObject) {
        auto& vm = globalObject->vm();
        auto* id = JSC::jsStringWithCache(vm, sourceURL);
        WTF::Vector<JSC::EncodedJSValue, 1> dirnameArgs;
        dirnameArgs.reserveInitialCapacity(1);
        dirnameArgs.unsafeAppendWithoutCapacityCheck(JSValue::encode(specifierValue));
#if OS(WINDOWS)
        auto dirname = JSValue::decode(Bun__Path__dirname(globalObject, true, reinterpret_cast<JSC__JSValue*>(dirnameArgs.data()), 1)).toString(globalObject);
#else
        auto dirname = JSValue::decode(Bun__Path__dirname(globalObject, false, reinterpret_cast<JSC__JSValue*>(dirnameArgs.data()), 1)).toString(globalObject);
#endif
        moduleObject = JSCommonJSModule::create(
            vm,
            globalObject->CommonJSModuleObjectStructure(),
            id, id, dirname, JSC::JSSourceCode::create(vm, SourceCode(WTFMove(sourceProvider))));

        moduleObject->putDirect(vm,
            WebCore::clientData(vm)->builtinNames().exportsPublicName(),
            JSC::constructEmptyObject(globalObject, globalObject->objectPrototype()), 0);

        globalObject->requireMap()->set(globalObject, id, moduleObject);
    }

    moduleObject->ignoreESModuleAnnotation = ignoreESModuleAnnotation;

    return JSC::SourceCode(
        JSC::SyntheticSourceProvider::create(
            [](JSC::JSGlobalObject* lexicalGlobalObject,
                JSC::Identifier moduleKey,
                Vector<JSC::Identifier, 4>& exportNames,
                JSC::MarkedArgumentBuffer& exportValues) -> void {
                auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
                auto& vm = globalObject->vm();

                JSValue keyValue = identifierToJSValue(vm, moduleKey);
                JSValue entry = globalObject->requireMap()->get(globalObject, keyValue);

                if (entry) {
                    if (auto* moduleObject = jsDynamicCast<JSCommonJSModule*>(entry)) {
                        if (!moduleObject->hasEvaluated) {
                            WTF::NakedPtr<JSC::Exception> exception;
                            if (!evaluateCommonJSModuleOnce(
                                    vm,
                                    globalObject,
                                    moduleObject,
                                    moduleObject->m_dirname.get(),
                                    moduleObject->m_filename.get(), exception)) {

                                // On error, remove the module from the require map
                                // so that it can be re-evaluated on the next require.
                                globalObject->requireMap()->remove(globalObject, moduleObject->id());

                                auto throwScope = DECLARE_THROW_SCOPE(vm);
                                throwException(globalObject, throwScope, exception.get());
                                exception.clear();
                                return;
                            }
                        }

                        moduleObject->toSyntheticSource(globalObject, moduleKey, exportNames, exportValues);
                    }
                }
            },
            sourceOrigin,
            sourceURL));
}

JSObject* JSCommonJSModule::createBoundRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, JSC::JSString* filename)
{
    ASSERT(!filename->tryGetValue().startsWith("file://"_s));

    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    WTF::Vector<JSC::EncodedJSValue, 1> dirnameArgs;
    dirnameArgs.reserveInitialCapacity(1);
    dirnameArgs.unsafeAppendWithoutCapacityCheck(JSValue::encode(filename));
#if OS(WINDOWS)
    auto dirname = JSValue::decode(Bun__Path__dirname(globalObject, true, reinterpret_cast<JSC__JSValue*>(dirnameArgs.data()), 1)).toString(globalObject);
#else
    auto dirname = JSValue::decode(Bun__Path__dirname(globalObject, false, reinterpret_cast<JSC__JSValue*>(dirnameArgs.data()), 1)).toString(globalObject);
#endif
    auto moduleObject = Bun::JSCommonJSModule::create(
        vm,
        globalObject->CommonJSModuleObjectStructure(),
        filename, filename, dirname, nullptr);

    JSFunction* requireFunction = JSC::JSBoundFunction::create(vm,
        globalObject,
        globalObject->requireFunctionUnbound(),
        moduleObject,
        ArgList(), 1, globalObject->commonStrings().requireString(globalObject));

    JSFunction* resolveFunction = JSC::JSBoundFunction::create(vm,
        globalObject,
        globalObject->requireResolveFunctionUnbound(),
        moduleObject,
        ArgList(), 1, globalObject->commonStrings().resolveString(globalObject));

    requireFunction->putDirect(vm, vm.propertyNames->resolve, resolveFunction, 0);

    return requireFunction;
}

} // namespace Bun
