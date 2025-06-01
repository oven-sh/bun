#include "config.h"
#include "JSCookieMap.h"

#include "Cookie.h"
#include "DOMClientIsoSubspaces.h"
#include "DOMIsoSubspaces.h"
#include "IDLTypes.h"
#include "JSCookie.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertDate.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertRecord.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMIterator.h"
#include "JSDOMOperation.h"
#include "JSDOMWrapperCache.h"
#include <JavaScriptCore/DateInstance.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>
#include <wtf/PointerPreparations.h>
#include <variant>
#include "HTTPParsers.h"
namespace WebCore {

using namespace JSC;

// Define the toWrapped template function for CookieMap
template<typename ExceptionThrower>
CookieMap* toWrapped(JSGlobalObject& lexicalGlobalObject, ExceptionThrower&& exceptionThrower, JSValue value)
{
    auto& vm = getVM(&lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* impl = JSCookieMap::toWrapped(vm, value);
    if (!impl) [[unlikely]]
        exceptionThrower(lexicalGlobalObject, scope);
    return impl;
}

static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_get);
static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_toSetCookieHeaders);
static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_has);
static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_set);
static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_delete);
static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_toJSON);
static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_entries);
static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_keys);
static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_values);
static JSC_DECLARE_HOST_FUNCTION(jsCookieMapPrototypeFunction_forEach);
static JSC_DECLARE_CUSTOM_GETTER(jsCookieMapPrototypeGetter_size);
static JSC_DECLARE_CUSTOM_GETTER(jsCookieMapConstructor);

class JSCookieMapPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSCookieMapPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSCookieMapPrototype* ptr = new (NotNull, JSC::allocateCell<JSCookieMapPrototype>(vm)) JSCookieMapPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCookieMapPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSCookieMapPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSCookieMapPrototype, JSCookieMapPrototype::Base);

using JSCookieMapDOMConstructor = JSDOMConstructor<JSCookieMap>;

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSCookieMapDOMConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = jsCast<JSCookieMapDOMConstructor*>(callFrame->jsCallee());

    // Check arguments
    JSValue initValue = callFrame->argument(0);

    std::variant<Vector<Vector<String>>, HashMap<String, String>, String> init;

    if (initValue.isUndefinedOrNull() || (initValue.isString() && initValue.getString(lexicalGlobalObject).isEmpty())) {
        init = String();
    } else if (initValue.isString()) {
        init = initValue.getString(lexicalGlobalObject);
    } else if (initValue.isObject()) {
        auto* object = initValue.getObject();

        if (isArray(lexicalGlobalObject, object)) {
            auto* array = jsCast<JSArray*>(object);
            Vector<Vector<String>> seqSeq;

            uint32_t length = array->length();
            for (uint32_t i = 0; i < length; ++i) {
                auto element = array->getIndex(lexicalGlobalObject, i);
                RETURN_IF_EXCEPTION(throwScope, {});

                if (!element.isObject() || !jsDynamicCast<JSArray*>(element)) {
                    throwTypeError(lexicalGlobalObject, throwScope, "Expected each element to be an array of two strings"_s);
                    return {};
                }

                auto* subArray = jsCast<JSArray*>(element);
                if (subArray->length() != 2) {
                    throwTypeError(lexicalGlobalObject, throwScope, "Expected arrays of exactly two strings"_s);
                    return {};
                }

                auto first = subArray->getIndex(lexicalGlobalObject, 0);
                RETURN_IF_EXCEPTION(throwScope, {});
                auto second = subArray->getIndex(lexicalGlobalObject, 1);
                RETURN_IF_EXCEPTION(throwScope, {});

                auto firstStr = first.toString(lexicalGlobalObject)->value(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(throwScope, {});
                auto secondStr = second.toString(lexicalGlobalObject)->value(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(throwScope, {});

                Vector<String> pair;
                pair.append(firstStr);
                pair.append(secondStr);
                seqSeq.append(WTFMove(pair));
            }
            init = WTFMove(seqSeq);
        } else {
            // Handle as record<USVString, USVString>
            HashMap<String, String> record;

            PropertyNameArray propertyNames(vm, PropertyNameMode::Strings, PrivateSymbolMode::Exclude);
            JSObject::getOwnPropertyNames(object, lexicalGlobalObject, propertyNames, DontEnumPropertiesMode::Include);
            RETURN_IF_EXCEPTION(throwScope, {});

            for (const auto& propertyName : propertyNames) {
                JSValue value = object->get(lexicalGlobalObject, propertyName);
                RETURN_IF_EXCEPTION(throwScope, {});

                auto valueStr = value.toString(lexicalGlobalObject)->value(lexicalGlobalObject);
                RETURN_IF_EXCEPTION(throwScope, {});

                record.set(propertyName.string(), valueStr);
            }
            init = WTFMove(record);
        }
    } else {
        throwTypeError(lexicalGlobalObject, throwScope, "Invalid initializer type"_s);
        return {};
    }

    auto result_exception = CookieMap::create(WTFMove(init));
    if (result_exception.hasException()) {
        WebCore::propagateException(lexicalGlobalObject, throwScope, result_exception.releaseException());
    }
    RETURN_IF_EXCEPTION(throwScope, {});
    auto result = result_exception.releaseReturnValue();

    RELEASE_AND_RETURN(throwScope, JSValue::encode(toJSNewlyCreated(lexicalGlobalObject, castedThis->globalObject(), WTFMove(result))));
}

JSC_ANNOTATE_HOST_FUNCTION(JSCookieMapDOMConstructorConstruct, JSCookieMapDOMConstructor::construct);

template<> const ClassInfo JSCookieMapDOMConstructor::s_info = { "CookieMap"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCookieMapDOMConstructor) };

template<> JSValue JSCookieMapDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return globalObject.objectPrototype();
}

template<> void JSCookieMapDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "CookieMap"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSCookieMap::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

static const HashTableValue JSCookieMapPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookieMapConstructor, 0 } },
    { "get"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_get, 1 } },
    { "toSetCookieHeaders"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_toSetCookieHeaders, 0 } },
    { "has"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_has, 1 } },
    { "set"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_set, 2 } },
    { "delete"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_delete, 1 } },
    { "entries"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_entries, 0 } },
    { "keys"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_keys, 0 } },
    { "values"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_values, 0 } },
    { "forEach"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_forEach, 1 } },
    { "toJSON"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsCookieMapPrototypeFunction_toJSON, 0 } },
    { "size"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontDelete), NoIntrinsic, { HashTableValue::GetterSetterType, jsCookieMapPrototypeGetter_size, 0 } },
};

const ClassInfo JSCookieMapPrototype::s_info = { "CookieMap"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCookieMapPrototype) };

void JSCookieMapPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSCookieMap::info(), JSCookieMapPrototypeTableValues, *this);
    putDirect(vm, vm.propertyNames->iteratorSymbol, getDirect(vm, PropertyName(Identifier::fromString(vm, "entries"_s))), static_cast<unsigned>(JSC::PropertyAttribute::DontEnum));
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSCookieMap::s_info = { "CookieMap"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSCookieMap) };

JSCookieMap::JSCookieMap(Structure* structure, JSDOMGlobalObject& globalObject, Ref<CookieMap>&& impl)
    : JSDOMWrapper<CookieMap>(structure, globalObject, WTFMove(impl))
{
}

void JSCookieMap::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSObject* JSCookieMap::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    auto* structure = JSCookieMapPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype());
    structure->setMayBePrototype(true);
    return JSCookieMapPrototype::create(vm, &globalObject, structure);
}

JSObject* JSCookieMap::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSCookieMap>(vm, globalObject);
}

JSValue JSCookieMap::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSCookieMapDOMConstructor, DOMConstructorID::CookieMap>(vm, *jsCast<const JSDOMGlobalObject*>(globalObject));
}

void JSCookieMap::destroy(JSC::JSCell* cell)
{
    JSCookieMap* thisObject = static_cast<JSCookieMap*>(cell);
    thisObject->JSCookieMap::~JSCookieMap();
}

JSC_DEFINE_CUSTOM_GETTER(jsCookieMapConstructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = jsDynamicCast<JSCookieMapPrototype*>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSCookieMap::getConstructor(JSC::getVM(lexicalGlobalObject), prototype->globalObject()));
}

JSC_DEFINE_CUSTOM_GETTER(jsCookieMapPrototypeGetter_size, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* thisObject = jsDynamicCast<JSCookieMap*>(JSValue::decode(thisValue));
    if (!thisObject) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(jsNumber(thisObject->wrapped().size()));
}

// Implementation of the get method
static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_getBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookieMap>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsNull());

    JSValue arg0 = callFrame->uncheckedArgument(0);

    // Handle single string argument (name)
    auto name = convert<IDLUSVString>(*lexicalGlobalObject, arg0);
    RETURN_IF_EXCEPTION(throwScope, {});

    std::optional<WTF::String> value = impl.get(name);
    if (!value.has_value())
        return JSValue::encode(jsNull());

    // Return as Cookie object
    return JSValue::encode(jsString(vm, value.value()));
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_get, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_getBody>(*lexicalGlobalObject, *callFrame, "get");
}

static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_toSetCookieHeadersBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookieMap>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    auto cookies = impl.getAllChanges();
    JSC::JSArray* resultArray = JSC::constructEmptyArray(lexicalGlobalObject, nullptr, cookies.size());
    RETURN_IF_EXCEPTION(throwScope, {});
    size_t i = 0;
    for (auto& item : cookies) {
        resultArray->putDirectIndex(lexicalGlobalObject, i, jsString(vm, item->toString(vm)));
        RETURN_IF_EXCEPTION(throwScope, {});
        i += 1;
    }

    return JSValue::encode(resultArray);
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_toSetCookieHeaders, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_toSetCookieHeadersBody>(*lexicalGlobalObject, *callFrame, "toSetCookieHeaders");
}

// Implementation of the has method
static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_hasBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookieMap>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsBoolean(false));

    auto name = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(jsBoolean(impl.has(name)));
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_has, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_hasBody>(*lexicalGlobalObject, *callFrame, "has");
}

// Implementation of the set method
static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_setBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookieMap>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsUndefined());

    JSValue arg0 = callFrame->uncheckedArgument(0);
    JSValue arg2 = callFrame->argument(2);

    CookieInit cookieInit = {};

    // Check if we're setting with a Cookie object directly
    if (arg0.isObject() && JSCookie::toWrapped(vm, arg0)) {
        auto* cookieImpl = JSCookie::toWrapped(vm, arg0);
        if (cookieImpl)
            impl.set(Ref<Cookie>(*cookieImpl));
        return JSValue::encode(jsUndefined());
    } else if (arg0.isObject()) {
        auto* obj = arg0.getObject();
        if (auto updatedCookieInit = CookieInit::fromJS(vm, lexicalGlobalObject, obj)) {
            cookieInit = *updatedCookieInit;
        }
        RETURN_IF_EXCEPTION(throwScope, {});
    } else {
        // Handle name/value pair
        if (callFrame->argumentCount() < 2)
            return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));

        cookieInit.name = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
        RETURN_IF_EXCEPTION(throwScope, {});

        cookieInit.value = convert<IDLUSVString>(*lexicalGlobalObject, callFrame->uncheckedArgument(1));
        RETURN_IF_EXCEPTION(throwScope, {});

        // Check for optional third parameter (options)
        if (callFrame->argumentCount() >= 3) {
            JSValue optionsArg = arg2;
            if (auto updatedCookieInit = CookieInit::fromJS(vm, lexicalGlobalObject, optionsArg, cookieInit.name, cookieInit.value)) {
                cookieInit = *updatedCookieInit;
            }
            RETURN_IF_EXCEPTION(throwScope, {});
        }
    }

    auto cookie_exception = Cookie::create(cookieInit);
    if (cookie_exception.hasException()) {
        WebCore::propagateException(lexicalGlobalObject, throwScope, cookie_exception.releaseException());
    }
    RETURN_IF_EXCEPTION(throwScope, {});
    auto cookie = cookie_exception.releaseReturnValue();

    impl.set(WTFMove(cookie));

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_set, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_setBody>(*lexicalGlobalObject, *callFrame, "set");
}

// Implementation of the delete method
static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_deleteBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookieMap>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    if (callFrame->argumentCount() < 1)
        return JSValue::encode(jsUndefined());

    JSValue arg0 = callFrame->uncheckedArgument(0);
    auto& names = builtinNames(vm);

    JSValue nameArg = jsUndefined();
    JSValue optionsArg = jsUndefined();
    if (arg0.isObject()) {
        optionsArg = arg0;
    } else {
        nameArg = arg0;
        if (callFrame->argumentCount() >= 2) {
            optionsArg = callFrame->uncheckedArgument(1);
            if (!optionsArg.isObject()) {
                return throwVMError(lexicalGlobalObject, throwScope, createTypeError(lexicalGlobalObject, "Options must be an object"_s));
            }
        }
    }

    CookieStoreDeleteOptions deleteOptions;
    deleteOptions.path = "/"_s;
    JSValue nameValue = nameArg;
    if (optionsArg.isObject()) {
        auto* options = optionsArg.getObject();

        // Extract name
        if (nameValue.isUndefined()) nameValue = options->getIfPropertyExists(lexicalGlobalObject, PropertyName(vm.propertyNames->name));

        // Extract optional domain
        if (auto domainValue = options->getIfPropertyExists(lexicalGlobalObject, names.domainPublicName())) {
            RETURN_IF_EXCEPTION(throwScope, {});

            if (!domainValue.isUndefined() && !domainValue.isNull()) {
                deleteOptions.domain = convert<IDLUSVString>(*lexicalGlobalObject, domainValue);
                RETURN_IF_EXCEPTION(throwScope, {});
            }
        }

        // Extract optional path
        if (auto pathValue = options->getIfPropertyExists(lexicalGlobalObject, names.pathPublicName())) {
            RETURN_IF_EXCEPTION(throwScope, {});

            if (!pathValue.isUndefined() && !pathValue.isNull()) {
                deleteOptions.path = convert<IDLUSVString>(*lexicalGlobalObject, pathValue);
                RETURN_IF_EXCEPTION(throwScope, {});
            }
        }
    }

    if (nameValue.isString()) {
        RETURN_IF_EXCEPTION(throwScope, {});

        if (!nameValue.isUndefined() && !nameValue.isNull()) {
            deleteOptions.name = convert<IDLUSVString>(*lexicalGlobalObject, nameValue);
        }

        RETURN_IF_EXCEPTION(throwScope, {});
    } else {
        return throwVMError(lexicalGlobalObject, throwScope, createTypeError(lexicalGlobalObject, "Cookie name is required"_s));
    }

    WebCore::propagateException(*lexicalGlobalObject, throwScope, impl.remove(deleteOptions));
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_delete, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_deleteBody>(*lexicalGlobalObject, *callFrame, "delete");
}

// Implementation of the toJSON method
static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_toJSONBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSCookieMap>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();

    // Delegate to the C++ toJSON method
    JSC::JSValue result = impl.toJSON(lexicalGlobalObject);
    RETURN_IF_EXCEPTION(throwScope, {});

    return JSValue::encode(result);
}

JSC::JSValue getInternalProperties(JSC::VM& vm, JSC::JSGlobalObject* lexicalGlobalObject, JSCookieMap* castedThis)
{
    return castedThis->wrapped().toJSON(lexicalGlobalObject);
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_toJSON, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_toJSONBody>(*lexicalGlobalObject, *callFrame, "toJSON");
}

// Iterator implementation for CookieMap
struct CookieMapIteratorTraits {
    static constexpr JSDOMIteratorType type = JSDOMIteratorType::Map;
    using KeyType = IDLUSVString;
    using ValueType = IDLUSVString;
};

using CookieMapIteratorBase = JSDOMIteratorBase<JSCookieMap, CookieMapIteratorTraits>;
class CookieMapIterator final : public CookieMapIteratorBase {
public:
    using Base = CookieMapIteratorBase;
    DECLARE_INFO;

    template<typename, SubspaceAccess mode> static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        if constexpr (mode == JSC::SubspaceAccess::Concurrently)
            return nullptr;
        return WebCore::subspaceForImpl<CookieMapIterator, UseCustomHeapCellType::No>(
            vm,
            [](auto& spaces) { return spaces.m_clientSubspaceForCookieMapIterator.get(); },
            [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCookieMapIterator = std::forward<decltype(space)>(space); },
            [](auto& spaces) { return spaces.m_subspaceForCookieMapIterator.get(); },
            [](auto& spaces, auto&& space) { spaces.m_subspaceForCookieMapIterator = std::forward<decltype(space)>(space); });
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

    static CookieMapIterator* create(JSC::VM& vm, JSC::Structure* structure, JSCookieMap& iteratedObject, IterationKind kind)
    {
        auto* instance = new (NotNull, JSC::allocateCell<CookieMapIterator>(vm)) CookieMapIterator(structure, iteratedObject, kind);
        instance->finishCreation(vm);
        return instance;
    }

private:
    CookieMapIterator(JSC::Structure* structure, JSCookieMap& iteratedObject, IterationKind kind)
        : Base(structure, iteratedObject, kind)
    {
    }
};

using CookieMapIteratorPrototype = JSDOMIteratorPrototype<JSCookieMap, CookieMapIteratorTraits>;
JSC_ANNOTATE_HOST_FUNCTION(CookieMapIteratorPrototypeNext, CookieMapIteratorPrototype::next);

template<>
const JSC::ClassInfo CookieMapIteratorBase::s_info = { "CookieMap Iterator"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(CookieMapIteratorBase) };
const JSC::ClassInfo CookieMapIterator::s_info = { "CookieMap Iterator"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(CookieMapIterator) };

template<>
const JSC::ClassInfo CookieMapIteratorPrototype::s_info = { "CookieMap Iterator"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(CookieMapIteratorPrototype) };

static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_entriesCaller(JSGlobalObject*, CallFrame*, JSCookieMap* thisObject)
{
    return JSValue::encode(iteratorCreate<CookieMapIterator>(*thisObject, IterationKind::Entries));
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_entries, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_entriesCaller>(*lexicalGlobalObject, *callFrame, "entries");
}

static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_keysCaller(JSGlobalObject*, CallFrame*, JSCookieMap* thisObject)
{
    return JSValue::encode(iteratorCreate<CookieMapIterator>(*thisObject, IterationKind::Keys));
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_keys, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_keysCaller>(*lexicalGlobalObject, *callFrame, "keys");
}

static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_valuesCaller(JSGlobalObject*, CallFrame*, JSCookieMap* thisObject)
{
    return JSValue::encode(iteratorCreate<CookieMapIterator>(*thisObject, IterationKind::Values));
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_values, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_valuesCaller>(*lexicalGlobalObject, *callFrame, "values");
}

static inline JSC::EncodedJSValue jsCookieMapPrototypeFunction_forEachCaller(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame, JSCookieMap* thisObject)
{
    return JSValue::encode(iteratorForEach<CookieMapIterator>(*lexicalGlobalObject, *callFrame, *thisObject));
}

JSC_DEFINE_HOST_FUNCTION(jsCookieMapPrototypeFunction_forEach, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    return IDLOperation<JSCookieMap>::call<jsCookieMapPrototypeFunction_forEachCaller>(*lexicalGlobalObject, *callFrame, "forEach");
}

GCClient::IsoSubspace* JSCookieMap::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSCookieMap, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForCookieMap.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForCookieMap = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForCookieMap.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForCookieMap = std::forward<decltype(space)>(space); });
}

void JSCookieMap::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<JSCookieMap*>(cell);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    Base::analyzeHeap(cell, analyzer);
}

bool JSCookieMapOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    UNUSED_PARAM(handle);
    UNUSED_PARAM(visitor);
    UNUSED_PARAM(reason);
    return false;
}

void JSCookieMapOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto* jsCookieMap = static_cast<JSCookieMap*>(handle.slot()->asCell());
    auto& world = *static_cast<DOMWrapperWorld*>(context);
    uncacheWrapper(world, &jsCookieMap->wrapped(), jsCookieMap);
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<CookieMap>&& impl)
{
    return createWrapper<CookieMap>(globalObject, WTFMove(impl));
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, CookieMap& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

CookieMap* JSCookieMap::toWrapped(JSC::VM& vm, JSC::JSValue value)
{
    if (auto* wrapper = jsDynamicCast<JSCookieMap*>(value))
        return &wrapper->wrapped();
    return nullptr;
}

size_t JSCookieMap::estimatedSize(JSC::JSCell* cell, JSC::VM& vm)
{
    auto* thisObject = jsCast<JSCookieMap*>(cell);
    auto& wrapped = thisObject->wrapped();
    return Base::estimatedSize(cell, vm) + wrapped.memoryCost();
}

} // namespace WebCore
