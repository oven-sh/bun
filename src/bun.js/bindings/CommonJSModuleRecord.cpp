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
#include "PathInlines.h"
#include "wtf/NakedPtr.h"
#include "wtf/URL.h"
#include "wtf/text/StringImpl.h"

extern "C" bool Bun__isBunMain(JSC::JSGlobalObject* global, const BunString*);

namespace Bun {
using namespace JSC;

JSC_DECLARE_HOST_FUNCTION(jsFunctionRequireCommonJS);

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

static bool evaluateCommonJSModuleOnce(JSC::VM& vm, Zig::GlobalObject* globalObject, JSCommonJSModule* moduleObject, JSString* dirname, JSValue filename, WTF::NakedPtr<Exception>& exception)
{
    SourceCode code = std::move(moduleObject->sourceCode);

    // If an exception occurred somewhere else, we might have cleared the source code.
    if (UNLIKELY(code.isNull())) {
        auto throwScope = DECLARE_THROW_SCOPE(vm);
        throwException(globalObject, throwScope, createError(globalObject, "Failed to evaluate module"_s));
        exception = throwScope.exception();
        return false;
    }

    JSFunction* resolveFunction = nullptr;
    JSFunction* requireFunction = nullptr;
    const auto initializeModuleObject = [&]() {
        resolveFunction = JSC::JSBoundFunction::create(vm,
            globalObject,
            globalObject->requireResolveFunctionUnbound(),
            moduleObject->id(),
            ArgList(), 1, globalObject->commonStrings().resolveString(globalObject));
        requireFunction = JSC::JSBoundFunction::create(vm,
            globalObject,
            globalObject->requireFunctionUnbound(),
            moduleObject,
            ArgList(), 1, globalObject->commonStrings().requireString(globalObject));
        requireFunction->putDirect(vm, vm.propertyNames->resolve, resolveFunction, 0);
        moduleObject->putDirect(vm, WebCore::clientData(vm)->builtinNames().requirePublicName(), requireFunction, 0);
        moduleObject->hasEvaluated = true;
    };

    if (UNLIKELY(Bun__VM__specifierIsEvalEntryPoint(globalObject->bunVM(), JSValue::encode(filename)))) {
        initializeModuleObject();

        // Using same approach as node, `arguments` in the entry point isn't defined
        // https://github.com/nodejs/node/blob/592c6907bfe1922f36240e9df076be1864c3d1bd/lib/internal/process/execution.js#L92
        globalObject->putDirect(vm, builtinNames(vm).exportsPublicName(), moduleObject->exportsObject(), 0);
        globalObject->putDirect(vm, builtinNames(vm).requirePublicName(), requireFunction, 0);
        globalObject->putDirect(vm, Identifier::fromLatin1(vm, "module"_s), moduleObject, 0);
        globalObject->putDirect(vm, Identifier::fromLatin1(vm, "__filename"_s), filename, 0);
        globalObject->putDirect(vm, Identifier::fromLatin1(vm, "__dirname"_s), dirname, 0);

        JSValue result = JSC::evaluate(globalObject, code, jsUndefined(), exception);

        if (UNLIKELY(exception.get() || result.isEmpty())) {
            return false;
        }

        Bun__VM__setEntryPointEvalResultCJS(globalObject->bunVM(), JSValue::encode(result));

        return true;
    }

    // This will return 0 if there was a syntax error or an allocation failure
    JSValue fnValue = JSC::evaluate(globalObject, code, jsUndefined(), exception);

    if (UNLIKELY(exception.get() || fnValue.isEmpty())) {
        return false;
    }

    JSObject* fn = fnValue.getObject();

    if (UNLIKELY(!fn)) {
        exception = Exception::create(vm, createTypeError(globalObject, "Expected CommonJS module to have a function wrapper. If you weren't messing around with Bun's internals, this is a bug in Bun"_s));
        return false;
    }

    JSC::CallData callData = JSC::getCallData(fn);

    if (UNLIKELY(callData.type == CallData::Type::None)) {
        exception = Exception::create(vm, createTypeError(globalObject, "Expected CommonJS module to have a function wrapper. If you weren't messing around with Bun's internals, this is a bug in Bun"_s));
        return false;
    }

    initializeModuleObject();

    MarkedArgumentBuffer args;
    args.append(moduleObject->exportsObject()); // exports
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
    JSC::profiledCall(globalObject, ProfilingReason::API, fn, callData, moduleObject, args, exception);

    return exception.get() == nullptr;
}

bool JSCommonJSModule::load(JSC::VM& vm, Zig::GlobalObject* globalObject, WTF::NakedPtr<JSC::Exception>& exception)
{
    if (this->hasEvaluated || this->sourceCode.isNull()) {
        return true;
    }

    evaluateCommonJSModuleOnce(
        globalObject->vm(),
        jsCast<Zig::GlobalObject*>(globalObject),
        this,
        this->m_dirname.get(),
        this->m_filename.get(),
        exception);

    if (exception.get()) {
        // On error, remove the module from the require map/
        // so that it can be re-evaluated on the next require.
        globalObject->requireMap()->remove(globalObject, this->id());

        return false;
    }

    return true;
}

JSC_DEFINE_HOST_FUNCTION(jsFunctionLoadModule, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto& vm = lexicalGlobalObject->vm();
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    JSCommonJSModule* moduleObject = jsDynamicCast<JSCommonJSModule*>(callframe->argument(0));
    if (!moduleObject) {
        RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(true)));
    }

    WTF::NakedPtr<Exception> exception;

    if (!moduleObject->load(vm, globalObject, exception)) {
        throwException(globalObject, throwScope, exception.get());
        exception.clear();
        return {};
    }

    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(true)));
}

JSC_DEFINE_HOST_FUNCTION(requireResolvePathsFunction, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr, 0));
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

static const HashTableValue RequireResolveFunctionPrototypeValues[] = {
    { "paths"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, requireResolvePathsFunction, 1 } },
};

static const HashTableValue RequireFunctionPrototypeValues[] = {
    { "cache"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, jsRequireCacheGetter, jsRequireCacheSetter } },
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
        moduleMainCodeGenerator(vm),
        globalObject->globalScope());

    this->putDirectAccessor(
        globalObject,
        JSC::Identifier::fromString(vm, "main"_s),
        JSC::GetterSetter::create(vm, globalObject, requireDotMainFunction, requireDotMainFunction),
        PropertyAttribute::Accessor | PropertyAttribute::ReadOnly | 0);

    auto extensions = constructEmptyObject(globalObject);
    extensions->putDirect(vm, JSC::Identifier::fromString(vm, ".js"_s), jsBoolean(true), 0);
    extensions->putDirect(vm, JSC::Identifier::fromString(vm, ".json"_s), jsBoolean(true), 0);
    extensions->putDirect(vm, JSC::Identifier::fromString(vm, ".node"_s), jsBoolean(true), 0);

    this->putDirect(vm, JSC::Identifier::fromString(vm, "extensions"_s), extensions, 0);
}

JSC_DEFINE_CUSTOM_GETTER(getterFilename, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_filename.get());
}
JSC_DEFINE_CUSTOM_GETTER(getterId, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_id.get());
}

JSC_DEFINE_CUSTOM_GETTER(getterPath, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }
    return JSValue::encode(thisObject->m_dirname.get());
}

JSC_DEFINE_CUSTOM_GETTER(getterParent, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
        return JSValue::encode(jsUndefined());
    }

    if (thisObject->m_overridenParent) {
        return JSValue::encode(thisObject->m_overridenParent.get());
    }

    if (thisObject->m_parent) {
        auto* parent = thisObject->m_parent.get();
        return JSValue::encode(parent);
    }

    // initialize parent by checking if it is the main module. we do this lazily because most people
    // dont need `module.parent` and creating commonjs module records is done a ton.
    auto idValue = thisObject->m_id.get();
    if (idValue) {
        auto id = idValue->value(globalObject);
        auto idStr = Bun::toString(id);
        if (Bun__isBunMain(globalObject, &idStr)) {
            thisObject->m_overridenParent.set(globalObject->vm(), thisObject, jsNull());
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

JSC_DEFINE_CUSTOM_GETTER(getterLoaded, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(JSValue::decode(thisValue));
    if (UNLIKELY(!thisObject)) {
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
        thisObject->m_overridenParent.clear();
    } else {
        thisObject->m_parent = {};
        thisObject->m_overridenParent.set(globalObject->vm(), thisObject, JSValue::decode(value));
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

static JSValue createChildren(VM& vm, JSObject* object)
{
    return constructEmptyArray(object->globalObject(), nullptr, 0);
}

JSC_DEFINE_HOST_FUNCTION(functionCommonJSModuleRecord_compile, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    auto* moduleObject = jsDynamicCast<JSCommonJSModule*>(callframe->thisValue());
    if (!moduleObject) {
        return JSValue::encode(jsUndefined());
    }

    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    String sourceString = callframe->argument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    JSValue filenameValue = callframe->argument(1);
    String filenameString = filenameValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    String wrappedString = makeString(
        "(function(exports,require,module,__filename,__dirname){"_s,
        sourceString,
        "\n})"_s);

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
        jsString(vm, filenameString),
        exception);

    if (exception) {
        throwException(globalObject, throwScope, exception.get());
        exception.clear();
        return {};
    }

    return JSValue::encode(jsUndefined());
}

static const struct HashTableValue JSCommonJSModulePrototypeTableValues[] = {
    { "_compile"_s, static_cast<unsigned>(PropertyAttribute::Function | PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::NativeFunctionType, functionCommonJSModuleRecord_compile, 2 } },
    { "children"_s, static_cast<unsigned>(PropertyAttribute::PropertyCallback), NoIntrinsic, { HashTableValue::LazyPropertyType, createChildren } },
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
    }
};

const JSC::ClassInfo JSCommonJSModulePrototype::s_info = { "ModulePrototype"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSModulePrototype) };

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
    auto& vm = globalObject->vm();
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
            out->m_overridenParent.set(vm, out, parent);
        }
    } else if (parent) {
        out->m_overridenParent.set(vm, out, parent);
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
    auto& vm = globalObject->vm();
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
    const Identifier& esModuleMarker = vm.propertyNames->__esModule;

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
                    if (UNLIKELY(property.isEmpty() || property.isNull() || property == esModuleMarker || property.isPrivateName() || property.isSymbol()))
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
                if (UNLIKELY(property.isEmpty() || property.isNull() || property == vm.propertyNames->defaultKeyword || property.isPrivateName() || property.isSymbol()))
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
    auto result = this->exportsObject();

    populateESMExports(globalObject, result, exportNames, exportValues, this->ignoreESModuleAnnotation);
}

void JSCommonJSModule::setExportsObject(JSC::JSValue exportsObject)
{
    this->putDirect(vm(), JSC::PropertyName(clientData(vm())->builtinNames().exportsPublicName()), exportsObject, 0);
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

    // Use appendHidden so it doesn't show up in the heap snapshot twice.
    visitor.appendHidden(thisObject->m_id);
    visitor.appendHidden(thisObject->m_filename);
    visitor.appendHidden(thisObject->m_dirname);
    visitor.appendHidden(thisObject->m_paths);
    visitor.appendHidden(thisObject->m_overridenParent);
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

    if (thisObject->m_overridenParent) {
        JSValue overridenParent = thisObject->m_overridenParent.get();
        if (overridenParent.isCell()) {
            const Identifier overridenParentIdentifier = Identifier::fromString(vm, "parent"_s);
            analyzer.analyzePropertyNameEdge(cell, overridenParent.asCell(), overridenParentIdentifier.impl());
        }
    }
}

const JSC::ClassInfo JSCommonJSModule::s_info = { "Module"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCommonJSModule) };
const JSC::ClassInfo RequireResolveFunctionPrototype::s_info = { "resolve"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireResolveFunctionPrototype) };
const JSC::ClassInfo RequireFunctionPrototype::s_info = { "require"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireFunctionPrototype) };

JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireCommonJS, (JSGlobalObject * lexicalGlobalObject, CallFrame* callframe))
{
    auto* globalObject = jsCast<Zig::GlobalObject*>(lexicalGlobalObject);
    auto& vm = globalObject->vm();
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    JSCommonJSModule* thisObject = jsDynamicCast<JSCommonJSModule*>(callframe->thisValue());
    if (!thisObject)
        return throwVMTypeError(globalObject, throwScope);

    JSValue specifierValue = callframe->argument(0);
    WTF::String specifier = specifierValue.toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    WTF::String referrer = thisObject->id().toWTFString(globalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    BunString specifierStr = Bun::toString(specifier);
    BunString referrerStr = Bun::toString(referrer);
    BunString typeAttributeStr = { BunStringTag::Dead };
    String typeAttribute = String();

    // We need to be able to wire in the "type" import attribute from bundled code..
    // so we do it via CommonJS require().
    int32_t previousArgumentCount = callframe->argument(2).asInt32();
    // If they called require(id), skip the check for the type attribute
    if (UNLIKELY(previousArgumentCount == 2)) {
        JSValue val = callframe->argument(3);
        if (val.isObject()) {
            JSObject* obj = val.getObject();
            // This getter is expensive and rare.
            if (auto typeValue = obj->getIfPropertyExists(globalObject, vm.propertyNames->type)) {
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
        jsCast<JSCommonJSModule*>(callframe->argument(1)),
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
    ResolvedSource& source,
    bool isBuiltIn)
{
    auto& vm = globalObject->vm();
    auto sourceProvider = Zig::SourceProvider::create(jsCast<Zig::GlobalObject*>(globalObject), source, JSC::SourceProviderSourceType::Program, isBuiltIn);
    this->ignoreESModuleAnnotation = source.tag == ResolvedSourceTagPackageJSONTypeModule;
    if (this->hasEvaluated)
        return true;

    this->sourceCode = JSC::SourceCode(WTFMove(sourceProvider));

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
    JSValue specifierValue,
    ResolvedSource& source,
    bool isBuiltIn)
{
    JSCommonJSModule* moduleObject = nullptr;
    WTF::String sourceURL = source.source_url.toWTFString();

    JSValue entry = globalObject->requireMap()->get(globalObject, specifierValue);
    bool ignoreESModuleAnnotation = source.tag == ResolvedSourceTagPackageJSONTypeModule;
    SourceOrigin sourceOrigin;

    if (entry) {
        moduleObject = jsDynamicCast<JSCommonJSModule*>(entry);
    }

    if (!moduleObject) {
        auto& vm = globalObject->vm();
        auto* requireMapKey = specifierValue.toString(globalObject);
        auto index = sourceURL.reverseFind(PLATFORM_SEP, sourceURL.length());
        JSString* dirname;
        JSString* filename = requireMapKey;
        if (index != WTF::notFound) {
            dirname = JSC::jsSubstring(globalObject, requireMapKey, 0, index);
        } else {
            dirname = jsEmptyString(vm);
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

        globalObject->requireMap()->set(globalObject, requireMapKey, moduleObject);
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

                                auto scope = DECLARE_THROW_SCOPE(vm);
                                throwException(globalObject, scope, exception.get());
                                exception.clear();
                                return;
                            }
                        }

                        moduleObject->toSyntheticSource(globalObject, moduleKey, exportNames, exportValues);
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

    JSString* filename = JSC::jsStringWithCache(vm, pathString);
    auto index = pathString.reverseFind(PLATFORM_SEP, pathString.length());
    JSString* dirname;
    if (index != WTF::notFound) {
        dirname = JSC::jsSubstring(globalObject, filename, 0, index);
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

    JSFunction* resolveFunction = JSC::JSBoundFunction::create(vm,
        globalObject,
        globalObject->requireResolveFunctionUnbound(),
        moduleObject,
        ArgList(), 1, globalObject->commonStrings().resolveString(globalObject));

    requireFunction->putDirect(vm, vm.propertyNames->resolve, resolveFunction, 0);

    return requireFunction;
}

} // namespace Bun
