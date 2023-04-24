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
#include "JSBufferPrototypeBuiltins.h"
#include "JSBufferConstructorBuiltins.h"
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
            ZigString from = Zig::toZigString(fromStr);
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

            // require.resolve also supports a paths array
            // we only support a single path
            if (!fromValue.isUndefinedOrNull() && fromValue.isObject()) {
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

class JSRequireResolveFunctionPrototype final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSRequireResolveFunctionPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject)
    {
        auto* structure = createStructure(vm, globalObject, globalObject->functionPrototype());
        JSRequireResolveFunctionPrototype* function = new (NotNull, JSC::allocateCell<JSRequireResolveFunctionPrototype>(vm)) JSRequireResolveFunctionPrototype(vm, structure);
        function->finishCreation(vm);
        return function;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    DECLARE_INFO;

    static JSC::EncodedJSValue pathsFunction(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
    {
        return JSValue::encode(JSC::constructEmptyArray(globalObject, nullptr));
    }

private:
    JSRequireResolveFunctionPrototype(JSC::VM& vm, JSC::Structure* structure)
        : JSC::InternalFunction(vm, structure, jsFunctionRequireResolve, jsFunctionRequireResolve)

    {
    }

    void finishCreation(JSC::VM& vm)
    {
        this->putDirectNativeFunction(vm, globalObject(), Identifier::fromString(vm, "paths"_s), 0, pathsFunction, ImplementationVisibility::Public, NoIntrinsic, 0);
        Base::finishCreation(vm, 2, "resolve"_s, PropertyAdditionMode::WithoutStructureTransition);
    }
};

const JSC::ClassInfo JSRequireResolveFunctionPrototype::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSRequireResolveFunctionPrototype) };

class JSRequireResolveFunction final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;

    static JSRequireResolveFunction* create(JSC::VM& vm, JSC::Structure* structure, const WTF::String& from)
    {
        JSRequireResolveFunction* function = new (NotNull, JSC::allocateCell<JSRequireResolveFunction>(vm)) JSRequireResolveFunction(vm, structure, from);
        function->finishCreation(vm);
        return function;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    DECLARE_INFO;

    WTF::String from;

    template<typename, JSC::SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;

        return WebCore::subspaceForImpl<JSRequireResolveFunction, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForRequireResolveFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForRequireResolveFunction = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForRequireResolveFunction.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForRequireResolveFunction = std::forward<decltype(space)>(space); });
    }

private:
    JSRequireResolveFunction(JSC::VM& vm, JSC::Structure* structure, const WTF::String& from_)
        : JSC::InternalFunction(vm, structure, jsFunctionRequireResolve, jsFunctionRequireResolve)
        , from(from_)
    {
    }

    void finishCreation(JSC::VM& vm)
    {
        Base::finishCreation(vm);
    }
};

const JSC::ClassInfo JSRequireResolveFunction::s_info = { "Function"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSRequireResolveFunction) };

JSC_DEFINE_HOST_FUNCTION(jsFunctionRequireResolve, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    JSRequireResolveFunction* thisObject = JSC::jsCast<JSRequireResolveFunction*>(callFrame->jsCallee());
    return functionRequireResolve(globalObject, callFrame, thisObject->from);
}

JSValue Zig::ImportMetaObject::createResolveFunctionPrototype(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    return JSRequireResolveFunctionPrototype::create(vm, globalObject);
}

JSC::Structure* Zig::ImportMetaObject::createResolveFunctionStructure(JSC::VM& vm, Zig::GlobalObject* globalObject)
{
    JSValue prototype = globalObject->requireResolveFunctionPrototype();
    return JSRequireResolveFunction::createStructure(vm, globalObject, prototype);
}

JSObject* Zig::ImportMetaObject::createRequireFunction(VM& vm, JSGlobalObject* lexicalGlobalObject, const WTF::String& pathString)
{
    Zig::GlobalObject* globalObject = static_cast<Zig::GlobalObject*>(lexicalGlobalObject);
    JSFunction* requireFunction = JSFunction::create(vm, importMetaObjectRequireCodeGenerator(vm), globalObject);
    auto* resolveFunction = JSRequireResolveFunction::create(vm, globalObject->requireResolveFunctionStructure(), pathString);
    auto clientData = WebCore::clientData(vm);
    requireFunction->putDirect(vm, clientData->builtinNames().pathPublicName(), jsString(vm, pathString), PropertyAttribute::DontEnum | 0);
    requireFunction->putDirect(vm, clientData->builtinNames().resolvePublicName(), resolveFunction, PropertyAttribute::Function | PropertyAttribute::DontDelete | 0);
    return requireFunction;
}

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

            // require.resolve also supports a paths array
            // we only support a single path
            if (!fromValue.isUndefinedOrNull() && fromValue.isObject()) {
                if (JSC::JSArray* array = JSC::jsDynamicCast<JSC::JSArray*>(fromValue.getObject()->getIfPropertyExists(globalObject, JSC::Identifier::fromString(vm, "paths"_s)))) {
                    if (array->length() > 0) {
                        fromValue = array->getIndex(globalObject, 0);
                    }
                }

                if (callFrame->argumentCount() > 2) {
                    JSC::JSValue isESMValue = callFrame->argument(2);
                    if (isESMValue.isBoolean()) {
                        isESM = isESMValue.toBoolean(globalObject);
                        RETURN_IF_EXCEPTION(scope, JSC::JSValue::encode(JSC::JSValue {}));
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
