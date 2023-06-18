#include "root.h"
#include "headers.h"

#include "ImportMetaObject.h"
#include "ZigGlobalObject.h"
#include "ActiveDOMObject.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "IDLTypes.h"
// #include "JSBlob.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperation.h"
#include "JSDOMWrapperCache.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include "JavaScriptCore/FunctionPrototype.h"
#include "JavaScriptCore/HeapAnalyzer.h"

#include "JavaScriptCore/JSDestructibleObjectHeapCellType.h"
#include "JavaScriptCore/SlotVisitorMacros.h"
#include "JavaScriptCore/SubspaceInlines.h"
#include "wtf/GetPtr.h"
#include "wtf/PointerPreparations.h"
#include "wtf/URL.h"
#include "JavaScriptCore/BuiltinNames.h"

#include "JSBufferEncodingType.h"
#include "JavaScriptCore/JSBase.h"

#include "JSDOMURL.h"
#include "JavaScriptCore/JSNativeStdFunction.h"
#include "JavaScriptCore/GetterSetter.h"

namespace Zig {
using namespace JSC;
using namespace WebCore;

static EncodedJSValue functionRequireResolve(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, const WTF::String& fromStr)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);

    switch (callFrame->argumentCount()) {
    case 0: {
        // not "requires" because "require" could be confusing
        JSC::throwTypeError(globalObject, scope, "require.resolve needs 1 argument (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);

        auto doIt = [&](const WTF::String& fromStr) -> JSC::EncodedJSValue {
            BunString from = Bun::toString(fromStr);
            auto result = Bun__resolveSyncWithSource(globalObject, JSC::JSValue::encode(moduleName), &from, false);

            if (!JSC::JSValue::decode(result).isString()) {
                JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
                return JSC::JSValue::encode(JSValue {});
            }

            scope.release();
            return result;
        };

        if (moduleName.isUndefinedOrNull()) {
            JSC::throwTypeError(globalObject, scope, "require.resolve expects a string"_s);
            scope.release();
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        if (callFrame->argumentCount() > 1) {
            JSC::JSValue fromValue = callFrame->argument(1);

            if (fromValue.isAnyInt() && fromValue.toInt32(globalObject) == -999) {
                // -999 is a special value that means callerSourceOrigin()
                return doIt(callFrame->callerSourceOrigin(vm).string());
            }

            // require.resolve also supports a paths array
            // we only support a single path
            else if (!fromValue.isUndefinedOrNull() && fromValue.isObject()) {
                if (JSValue pathsValue = fromValue.getObject()->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "paths"_s))) {
                    if (JSC::JSArray* array = JSC::jsDynamicCast<JSC::JSArray*>(pathsValue)) {
                        if (array->length() > 0) {
                            fromValue = array->getIndex(globalObject, 0);
                        }
                    }
                }
            }

            if (fromValue.isString()) {
                WTF::String str = fromValue.toWTFString(globalObject);
                RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
                return doIt(str);
            }
        }

        return doIt(fromStr);
    }
    }
}

Zig::ImportMetaObject* Zig::ImportMetaObject::create(JSC::JSGlobalObject* globalObject, JSValue key)
{
    if (WebCore::DOMURL* domURL = WebCoreCast<WebCore::JSDOMURL, WebCore__DOMURL>(JSValue::encode(key))) {
        return create(globalObject, JSC::jsString(globalObject->vm(), domURL->href().fileSystemPath()));
    }

    auto* keyString = key.toStringOrNull(globalObject);
    if (UNLIKELY(!keyString)) {
        return nullptr;
    }

    if (keyString->value(globalObject).startsWith("file://"_s)) {
        return create(globalObject, JSC::jsString(globalObject->vm(), WTF::URL(keyString->value(globalObject)).fileSystemPath()));
    }

    return create(globalObject, keyString);
}

JSC_DECLARE_HOST_FUNCTION(jsFunctionRequireResolve);
JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireResolve, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    return functionRequireResolve(globalObject, callFrame, callFrame->thisValue().toWTFString(globalObject));
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

JSC_DEFINE_HOST_FUNCTION(requireResolvePathsFunction, (JSGlobalObject * globalObject, CallFrame* callframe))
{
    return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr, 0));
}

static const HashTableValue RequireResolveFunctionPrototypeValues[] = {
    { "paths"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, requireResolvePathsFunction, 1 } },
};

class RequireResolveFunctionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static RequireResolveFunctionPrototype* create(
        JSC::JSGlobalObject* globalObject)
    {
        auto& vm = globalObject->vm();

        auto* structure = RequireResolveFunctionPrototype::createStructure(vm, globalObject, globalObject->functionPrototype());
        RequireResolveFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireResolveFunctionPrototype>(vm)) RequireResolveFunctionPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    DECLARE_INFO;

    RequireResolveFunctionPrototype(
        JSC::VM& vm,
        JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.functionSpace();
    }
};

static const HashTableValue RequireFunctionPrototypeValues[] = {
    { "cache"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { HashTableValue::GetterSetterType, Zig::jsRequireCacheGetter, Zig::jsRequireCacheSetter } },
};

class ResolveFunction final : public JSC::InternalFunction {

public:
    using Base = JSC::InternalFunction;
    static ResolveFunction* create(JSGlobalObject* globalObject)
    {
        JSObject* resolvePrototype = RequireResolveFunctionPrototype::create(globalObject);
        Structure* structure = Structure::create(
            globalObject->vm(),
            globalObject,
            resolvePrototype,
            JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags),
            ResolveFunction::info());
        auto* resolveFunction = new (NotNull, JSC::allocateCell<ResolveFunction>(globalObject->vm())) ResolveFunction(globalObject->vm(), structure);
        resolveFunction->finishCreation(globalObject->vm(), 2, "resolve"_s, PropertyAdditionMode::WithStructureTransition);
        return resolveFunction;
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    ResolveFunction(
        JSC::VM& vm,
        JSC::Structure* structure)
        : InternalFunction(vm, structure, jsFunctionRequireResolve, nullptr)
    {
    }
};

class RequireFunctionPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static RequireFunctionPrototype* create(
        JSC::JSGlobalObject* globalObject)
    {
        auto& vm = globalObject->vm();

        auto* structure = RequireFunctionPrototype::createStructure(vm, globalObject, globalObject->functionPrototype());
        RequireFunctionPrototype* prototype = new (NotNull, JSC::allocateCell<RequireFunctionPrototype>(vm)) RequireFunctionPrototype(vm, structure);
        prototype->finishCreation(vm);

        auto* resolveFunction = ResolveFunction::create(globalObject);

        prototype->putDirect(vm, clientData(vm)->builtinNames().resolvePublicName(), resolveFunction, JSC::PropertyAttribute::Function | 0);

        return prototype;
    }

    RequireFunctionPrototype(
        JSC::VM& vm,
        JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.functionSpace();
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
        ASSERT(inherits(vm, info()));

        reifyStaticProperties(vm, info(), RequireFunctionPrototypeValues, *this);
        this->putDirect(vm, JSC::Identifier::fromString(vm, "main"_s), jsUndefined(), 0);
        this->putDirect(vm, JSC::Identifier::fromString(vm, "extensions"_s), constructEmptyObject(globalObject()), 0);
    }
};

class RequireFunction final : public JSC::InternalFunction {

public:
    using Base = JSC::InternalFunction;
    static RequireFunction* create(JSGlobalObject* globalObject, Structure* structure)
    {
        auto* fn = new (NotNull, JSC::allocateCell<RequireFunction>(globalObject->vm())) RequireFunction(globalObject->vm(), structure);
        fn->finishCreation(globalObject->vm(), 1, "require"_s, PropertyAdditionMode::WithStructureTransition);
    }

    DECLARE_INFO;

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    RequireFunction(
        JSC::VM& vm,
        JSC::Structure* structure)
        : InternalFunction(vm, structure, jsFunctionRequireResolve, nullptr)
    {
    }
};

Structure* Zig::ImportMetaObject::createRequireFunctionStructure(VM& vm, JSGlobalObject* globalObject)
{
    RequireFunctionPrototype* prototype = RequireFunctionPrototype::create(globalObject);
    auto* structure = Structure::create(vm, globalObject, prototype, TypeInfo(InternalFunctionType, StructureFlags), RequireFunction::info(), NonArray, 3);

    JSC::PropertyOffset offset;
    auto clientData = WebCore::clientData(vm);
    structure = structure->addPropertyTransition(
        vm,
        structure,
        WebCore::clientData(vm)->builtinNames().pathPublicName(),
        PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | 0,
        offset);

    return structure;
}

JSObject* Zig::ImportMetaObject::createRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString)
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    Structure* structure = globalObject->importMetaRequireStructure();
    JSFunction* requireFunction = JSFunction::create(vm, importMetaObjectRequireCodeGenerator(vm), lexicalGlobalObject->globalScope(), structure);

    requireFunction->putDirect(vm, clientData(vm)->builtinNames().pathPublicName(), jsString(vm, pathString), PropertyAttribute::ReadOnly | PropertyAttribute::DontEnum | 0);
    return requireFunction;
}

const JSC::ClassInfo RequireResolveFunctionPrototype::s_info = { "resolve"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireResolveFunctionPrototype) };
const JSC::ClassInfo ResolveFunction::s_info = { "resolve"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(ResolveFunction) };
const JSC::ClassInfo RequireFunctionPrototype::s_info = { "require"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(RequireFunctionPrototype) };

extern "C" EncodedJSValue functionImportMeta__resolveSync(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

    switch (callFrame->argumentCount()) {
    case 0: {

        // not "requires" because "require" could be confusing
        JSC::throwTypeError(globalObject, scope, "import.meta.resolveSync needs 1 argument (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);

        if (moduleName.isUndefinedOrNull()) {
            JSC::throwTypeError(globalObject, scope, "import.meta.resolveSync expects a string"_s);
            scope.release();
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        JSC__JSValue from;
        bool isESM = true;

        if (callFrame->argumentCount() > 1) {
            JSC::JSValue fromValue = callFrame->argument(1);

            if (callFrame->argumentCount() > 2) {
                JSC::JSValue isESMValue = callFrame->argument(2);
                if (isESMValue.isBoolean()) {
                    isESM = isESMValue.toBoolean(globalObject);
                    RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
                }
            }

            if (fromValue.isInt32() && fromValue.asInt32() == -999) {
                // -999 is a special value that means callerSourceOrigin()
                from = JSValue::encode(jsString(vm, callFrame->callerSourceOrigin(vm).string()));
            } else if (!fromValue.isUndefinedOrNull() && fromValue.isObject()) {
                // require.resolve also supports a paths array
                // we only support a single path
                if (JSC::JSArray* array = JSC::jsDynamicCast<JSC::JSArray*>(fromValue.getObject()->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "paths"_s)))) {
                    if (array->length() > 0) {
                        fromValue = array->getIndex(globalObject, 0);
                    }
                }

            } else if (fromValue.isBoolean()) {
                isESM = fromValue.toBoolean(globalObject);
                RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
            }
            from = JSC::JSValue::encode(fromValue);

        } else {
            JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(callFrame->thisValue());
            if (UNLIKELY(!thisObject)) {
                auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
                JSC::throwTypeError(globalObject, scope, "import.meta.resolveSync must be bound to an import.meta object"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }

            auto clientData = WebCore::clientData(vm);

            from = JSC::JSValue::encode(thisObject->get(globalObject, clientData->builtinNames().pathPublicName()));
        }

        auto result = Bun__resolveSync(globalObject, JSC::JSValue::encode(moduleName), from, isESM);

        if (!JSC::JSValue::decode(result).isString()) {
            JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        scope.release();
        return result;
    }
    }
}

JSC_DECLARE_HOST_FUNCTION(functionImportMeta__resolve);

JSC_DEFINE_HOST_FUNCTION(functionImportMeta__resolve,
    (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSC::VM& vm = globalObject->vm();

    switch (callFrame->argumentCount()) {
    case 0: {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        // not "requires" because "require" could be confusing
        JSC::throwTypeError(globalObject, scope, "import.meta.resolve needs 1 argument (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);

        if (moduleName.isUndefinedOrNull()) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "import.meta.resolve expects a string"_s);
            scope.release();
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        JSC__JSValue from;

        if (callFrame->argumentCount() > 1) {
            from = JSC::JSValue::encode(callFrame->argument(1));
        } else {
            JSC::JSObject* thisObject = JSC::jsDynamicCast<JSC::JSObject*>(callFrame->thisValue());
            if (UNLIKELY(!thisObject)) {
                auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
                JSC::throwTypeError(globalObject, scope, "import.meta.resolve must be bound to an import.meta object"_s);
                return JSC::JSValue::encode(JSC::JSValue {});
            }

            auto clientData = WebCore::clientData(vm);

            from = JSC::JSValue::encode(thisObject->get(globalObject, clientData->builtinNames().pathPublicName()));
        }

        return Bun__resolve(globalObject, JSC::JSValue::encode(moduleName), from, true);
    }
    }
}

class ImportMetaObjectPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;

    static ImportMetaObjectPrototype* create(JSC::VM& vm, JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        ImportMetaObjectPrototype* ptr = new (NotNull, JSC::allocateCell<ImportMetaObjectPrototype>(vm)) ImportMetaObjectPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm, globalObject);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    ImportMetaObjectPrototype(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&, JSC::JSGlobalObject*);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(ImportMetaObjectPrototype, ImportMetaObjectPrototype::Base);

JSObject* ImportMetaObject::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return ImportMetaObjectPrototype::create(vm, &globalObject, ImportMetaObjectPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype()));
}

void ImportMetaObjectPrototype::finishCreation(VM& vm, JSGlobalObject* globalObject_)
{
    Base::finishCreation(vm);
    auto* globalObject = reinterpret_cast<Zig::GlobalObject*>(globalObject_);
    auto clientData = WebCore::clientData(vm);

    auto& builtinNames = clientData->builtinNames();

    this->putDirect(vm, builtinNames.filePublicName(), jsEmptyString(vm), 0);
    this->putDirect(vm, builtinNames.dirPublicName(), jsEmptyString(vm), 0);
    this->putDirect(vm, builtinNames.pathPublicName(), jsEmptyString(vm), 0);
    this->putDirect(vm, builtinNames.urlPublicName(), jsEmptyString(vm), 0);

    this->putDirect(
        vm,
        builtinNames.mainPublicName(),
        GetterSetter::create(vm, globalObject, JSFunction::create(vm, importMetaObjectMainCodeGenerator(vm), globalObject), nullptr),
        JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::Accessor | JSC::PropertyAttribute::Builtin | 0);

    this->putDirect(vm, Identifier::fromString(vm, "primordials"_s), jsUndefined(), JSC::PropertyAttribute::DontEnum | 0);

    String requireString = "[[require]]"_s;
    this->putDirect(vm, builtinNames.requirePublicName(), Zig::ImportMetaObject::createRequireFunction(vm, globalObject, requireString), PropertyAttribute::Builtin | PropertyAttribute::Function | 0);

    this->putDirectNativeFunction(vm, globalObject, builtinNames.resolvePublicName(), 1,
        functionImportMeta__resolve,
        ImplementationVisibility::Public,
        NoIntrinsic,
        JSC::PropertyAttribute::Function | 0);
    this->putDirectNativeFunction(
        vm, globalObject, builtinNames.resolveSyncPublicName(),
        1,
        functionImportMeta__resolveSync,
        ImplementationVisibility::Public,
        NoIntrinsic,
        JSC::PropertyAttribute::Function | 0);

    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

void ImportMetaObject::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

void ImportMetaObject::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<ImportMetaObject*>(cell);
    // if (void* wrapped = thisObject->wrapped()) {
    // if (thisObject->scriptExecutionContext())
    //     analyzer.setLabelForCell(cell, "url " + thisObject->scriptExecutionContext()->url().string());
    // }
    Base::analyzeHeap(cell, analyzer);
}

const JSC::ClassInfo ImportMetaObjectPrototype::s_info = { "ImportMeta"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(ImportMetaObjectPrototype) };

const JSC::ClassInfo ImportMetaObject::s_info = { "ImportMeta"_s, &Base::s_info, nullptr, nullptr,
    CREATE_METHOD_TABLE(ImportMetaObject) };
}
