#include "root.h"
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

namespace Zig {
using namespace JSC;
using namespace WebCore;

static EncodedJSValue functionRequireResolve(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame, JSC::EncodedJSValue from)
{
    JSC::VM& vm = globalObject->vm();

    switch (callFrame->argumentCount()) {
    case 0: {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        // not "requires" because "require" could be confusing
        JSC::throwTypeError(globalObject, scope, "require.resolve needs 1 argument (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);

        if (moduleName.isUndefinedOrNull()) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "require.resolve expects a string"_s);
            scope.release();
            return JSC::JSValue::encode(JSC::JSValue {});
        }

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
            }
        }

        auto result = Bun__resolveSync(globalObject, JSC::JSValue::encode(moduleName), from);
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

        if (!JSC::JSValue::decode(result).isString()) {
            JSC::throwException(globalObject, scope, JSC::JSValue::decode(result));
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        scope.release();
        return result;
    }
    }
}

JSC_DEFINE_CUSTOM_SETTER(functionRequireResolveLazySetter,
    (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue,
        JSC::EncodedJSValue value, JSC::PropertyName))
{
    Zig::GlobalObject* global = static_cast<Zig::GlobalObject*>(JSC::jsCast<JSC::JSObject*>(JSC::JSValue::decode(thisValue)));
    JSC::VM& vm = globalObject->vm();
    JSC::JSFunction* require = JSC::jsCast<JSC::JSFunction*>(JSC::JSValue::decode(thisValue));
    auto clientData = WebCore::clientData(vm);
    return require->putDirect(vm, PropertyName(clientData->builtinNames().resolvePrivateName()), JSValue::decode(value), 0);
}

JSC_DEFINE_CUSTOM_GETTER(functionRequireResolveLazyGetter,
    (JSC::JSGlobalObject * _globalObject, JSC::EncodedJSValue thisValue,
        JSC::PropertyName))
{
    Zig::GlobalObject* globalObject = reinterpret_cast<Zig::GlobalObject*>(_globalObject);

    JSC::VM& vm = globalObject->vm();
    auto clientData = WebCore::clientData(vm);
    auto& builtinNames = clientData->builtinNames();

    JSC::JSFunction* require = JSC::jsCast<JSC::JSFunction*>(JSC::JSValue::decode(thisValue));

    if (JSC::JSValue resolveFunctionValue = require->getIfPropertyExists(globalObject, PropertyName(builtinNames.resolvePrivateName()))) {
        return JSValue::encode(resolveFunctionValue);
    }

    JSValue pathStringValue = require->get(globalObject, PropertyName(builtinNames.pathPrivateName()));
    JSC::Strong<JSC::JSString> pathString = JSC::Strong<JSC::JSString>(vm, pathStringValue.toStringOrNull(globalObject));

    JSC::JSFunction* resolverFunction
        = JSC::JSNativeStdFunction::create(
            globalObject->vm(), globalObject, 1, "resolve"_s, [pathString_ = WTFMove(pathString)](JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame) -> const JSC::EncodedJSValue {
                return functionRequireResolve(globalObject, callFrame, JSValue::encode(pathString_.get()));
            });
    require->putDirect(vm, builtinNames.resolvePrivateName(), resolverFunction, 0);
    return JSValue::encode(JSValue(resolverFunction));
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

JSObject* Zig::ImportMetaObject::createRequireFunction(VM& vm, JSGlobalObject* globalObject, WTF::String& pathString)
{
    JSFunction* requireFunction = JSFunction::create(vm, importMetaObjectRequireCodeGenerator(vm), globalObject);
    auto clientData = WebCore::clientData(vm);
    requireFunction->putDirectCustomAccessor(vm, clientData->builtinNames().resolvePublicName(), JSC::CustomGetterSetter::create(vm, functionRequireResolveLazyGetter, functionRequireResolveLazySetter), 0);
    requireFunction->putDirect(vm, clientData->builtinNames().pathPrivateName(), jsOwnedString(vm, pathString), JSC::PropertyAttribute::DontEnum | 0);
    return requireFunction;
}

extern "C" EncodedJSValue functionImportMeta__resolveSync(JSC::JSGlobalObject* globalObject, JSC::CallFrame* callFrame)
{
    JSC::VM& vm = globalObject->vm();

    switch (callFrame->argumentCount()) {
    case 0: {
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
        // not "requires" because "require" could be confusing
        JSC::throwTypeError(globalObject, scope, "import.meta.resolveSync needs 1 argument (a string)"_s);
        scope.release();
        return JSC::JSValue::encode(JSC::JSValue {});
    }
    default: {
        JSC::JSValue moduleName = callFrame->argument(0);

        if (moduleName.isUndefinedOrNull()) {
            auto scope = DECLARE_THROW_SCOPE(globalObject->vm());
            JSC::throwTypeError(globalObject, scope, "import.meta.resolveSync expects a string"_s);
            scope.release();
            return JSC::JSValue::encode(JSC::JSValue {});
        }

        JSC__JSValue from;

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

        auto result = Bun__resolveSync(globalObject, JSC::JSValue::encode(moduleName), from);
        auto scope = DECLARE_THROW_SCOPE(globalObject->vm());

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

        return Bun__resolve(globalObject, JSC::JSValue::encode(moduleName), from);
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
    this->putDirect(vm, builtinNames.mainPublicName(), jsBoolean(false), 0);
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
