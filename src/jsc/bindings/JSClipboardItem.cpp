#include "root.h"
#include "JSClipboardItem.h"

#include "BunClientData.h"
#include "ErrorCode.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "HTTPParsers.h"
#include "JSDOMExceptionHandling.h"
#include "ZigGeneratedClasses.h"
#include "ZigGlobalObject.h"
#include "webcore/JSClipboard.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/InternalFieldTuple.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/LazyClassStructureInlines.h>
#include <JavaScriptCore/LazyPropertyInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/text/MakeString.h>

namespace Bun {

using namespace JSC;
using namespace WebCore;

// WebIDL: every key of the items record must parse as `type "/" subtype`,
// each half an HTTP token (https://mimesniff.spec.whatwg.org/#mime-type).
static bool isValidClipboardMIMEType(const WTF::String& type)
{
    size_t slash = type.find('/');
    if (slash == WTF::notFound)
        return false;
    auto view = WTF::StringView(type);
    return WebCore::isValidHTTPToken(view.left(slash)) && WebCore::isValidHTTPToken(view.substring(slash + 1));
}

// ─── prototype ──────────────────────────────────────────────────────────────

static JSC_DECLARE_CUSTOM_GETTER(jsClipboardItemGetter_types);
static JSC_DECLARE_CUSTOM_GETTER(jsClipboardItemGetter_presentationStyle);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardItemProtoFuncGetType);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardItemConstructorFuncSupports);
static JSC_DECLARE_HOST_FUNCTION(clipboardItemConstructorCall);
static JSC_DECLARE_HOST_FUNCTION(clipboardItemConstructorConstruct);

class JSClipboardItemPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSClipboardItemPrototype* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSClipboardItemPrototype* prototype = new (NotNull, JSC::allocateCell<JSClipboardItemPrototype>(vm)) JSClipboardItemPrototype(vm, structure);
        prototype->finishCreation(vm);
        return prototype;
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClipboardItemPrototype, Base);
        return &vm.plainObjectSpace();
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        auto* structure = JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
        structure->setMayBePrototype(true);
        return structure;
    }

    DECLARE_INFO;

private:
    JSClipboardItemPrototype(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};

static const JSC::HashTableValue JSClipboardItemPrototypeTableValues[] = {
    { "types"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsClipboardItemGetter_types, nullptr } },
    { "presentationStyle"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor), NoIntrinsic, { JSC::HashTableValue::GetterSetterType, jsClipboardItemGetter_presentationStyle, nullptr } },
    { "getType"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsClipboardItemProtoFuncGetType, 1 } },
};

const JSC::ClassInfo JSClipboardItemPrototype::s_info = { "ClipboardItem"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardItemPrototype) };

void JSClipboardItemPrototype::finishCreation(JSC::VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSClipboardItem::info(), JSClipboardItemPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

// ─── constructor ────────────────────────────────────────────────────────────

class JSClipboardItemConstructor final : public JSC::InternalFunction {
public:
    using Base = JSC::InternalFunction;
    static constexpr unsigned StructureFlags = Base::StructureFlags;

    static JSClipboardItemConstructor* create(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::Structure* structure, JSC::JSObject* prototype)
    {
        JSClipboardItemConstructor* constructor = new (NotNull, JSC::allocateCell<JSClipboardItemConstructor>(vm)) JSClipboardItemConstructor(vm, structure);
        constructor->finishCreation(vm, globalObject, prototype);
        return constructor;
    }

    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::InternalFunctionType, StructureFlags), info());
    }

    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        return &vm.internalFunctionSpace();
    }

    DECLARE_INFO;

private:
    JSClipboardItemConstructor(JSC::VM& vm, JSC::Structure* structure)
        : Base(vm, structure, clipboardItemConstructorCall, clipboardItemConstructorConstruct)
    {
    }

    void finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype);
};

static const JSC::HashTableValue JSClipboardItemConstructorTableValues[] = {
    { "supports"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { JSC::HashTableValue::NativeFunctionType, jsClipboardItemConstructorFuncSupports, 1 } },
};

const JSC::ClassInfo JSClipboardItemConstructor::s_info = { "ClipboardItem"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardItemConstructor) };

void JSClipboardItemConstructor::finishCreation(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* prototype)
{
    Base::finishCreation(vm, 1, "ClipboardItem"_s, PropertyAdditionMode::WithStructureTransition);
    reifyStaticProperties(vm, JSClipboardItemConstructor::info(), JSClipboardItemConstructorTableValues, *this);
    putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

JSC_DEFINE_HOST_FUNCTION(clipboardItemConstructorCall, (JSC::JSGlobalObject * globalObject, JSC::CallFrame*))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    return Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, "Class constructor ClipboardItem cannot be invoked without 'new'"_s);
}

JSC_DEFINE_HOST_FUNCTION(clipboardItemConstructorConstruct, (JSC::JSGlobalObject * lexicalGlobalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    // WebIDL: `record<DOMString, ClipboardItemData>` requires an object.
    // (The generic `IDLRecord` converter cannot be reused here: it does not
    // instantiate for `IDLAny` values in this WebCore snapshot.)
    JSC::JSValue itemsArg = callFrame->argument(0);
    if (!itemsArg.isObject()) [[unlikely]]
        return JSC::JSValue::encode(throwTypeError(lexicalGlobalObject, scope, "ClipboardItem requires a record of MIME type to data"_s));
    auto* itemsObject = JSC::asObject(itemsArg);

    // Enumerate every own string key through the method table (so Proxy and
    // other exotic objects dispatch), then re-check enumerability per key.
    JSC::PropertyNameArrayBuilder names(vm, JSC::PropertyNameMode::Strings, JSC::PrivateSymbolMode::Exclude);
    itemsObject->methodTable()->getOwnPropertyNames(itemsObject, lexicalGlobalObject, names, JSC::DontEnumPropertiesMode::Include);
    RETURN_IF_EXCEPTION(scope, {});

    WTF::Vector<WTF::String> types;
    types.reserveInitialCapacity(names.size());
    JSC::MarkedArgumentBuffer values;
    for (size_t i = 0; i < names.size(); i++) {
        JSC::Identifier name = names[i];
        JSC::PropertyDescriptor descriptor;
        bool present = itemsObject->getOwnPropertyDescriptor(lexicalGlobalObject, name, descriptor);
        RETURN_IF_EXCEPTION(scope, {});
        if (!present || !descriptor.enumerable())
            continue;
        WTF::String type = name.string();
        if (!isValidClipboardMIMEType(type)) [[unlikely]]
            return JSC::JSValue::encode(throwTypeError(lexicalGlobalObject, scope, makeString("\""_s, type, "\" is not a valid MIME type"_s)));
        JSC::JSValue value = itemsObject->get(lexicalGlobalObject, name);
        RETURN_IF_EXCEPTION(scope, {});
        // Spec: `types` holds the serialization of the parsed MIME type, and
        // two keys with the same serialization are one representation twice.
        WTF::String normalized = type.convertToASCIILowercase();
        if (types.contains(normalized)) [[unlikely]]
            return JSC::JSValue::encode(throwTypeError(lexicalGlobalObject, scope, makeString("Duplicate MIME type \""_s, normalized, "\""_s)));
        types.append(WTF::move(normalized));
        values.append(value);
    }
    if (values.hasOverflowed()) [[unlikely]]
        return JSC::JSValue::encode(throwOutOfMemoryError(lexicalGlobalObject, scope));
    // Spec: an empty items record is a TypeError.
    if (types.isEmpty()) [[unlikely]]
        return JSC::JSValue::encode(throwTypeError(lexicalGlobalObject, scope, "ClipboardItem requires at least one MIME type"_s));

    // WebIDL: a dictionary argument must be undefined, null, or an object.
    WTF::String presentationStyle = "unspecified"_s;
    JSC::JSValue optionsArg = callFrame->argument(1);
    if (!optionsArg.isUndefinedOrNull()) {
        if (!optionsArg.isObject()) [[unlikely]]
            return JSC::JSValue::encode(throwTypeError(lexicalGlobalObject, scope, "ClipboardItem options must be an object"_s));
        JSC::JSValue styleValue = JSC::asObject(optionsArg)->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "presentationStyle"_s));
        RETURN_IF_EXCEPTION(scope, {});
        if (!styleValue.isUndefined()) {
            presentationStyle = styleValue.toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(scope, {});
            if (presentationStyle != "unspecified"_s && presentationStyle != "inline"_s && presentationStyle != "attachment"_s) [[unlikely]]
                return JSC::JSValue::encode(throwTypeError(lexicalGlobalObject, scope, makeString("\""_s, presentationStyle, "\" is not a valid value for presentationStyle"_s)));
        }
    }

    // `new.target`-aware structure so `class X extends ClipboardItem` works.
    JSC::Structure* structure = globalObject->m_JSClipboardItemClassStructure.get(globalObject);
    JSC::JSValue newTarget = callFrame->newTarget();
    if (globalObject->m_JSClipboardItemClassStructure.constructor(globalObject) != newTarget) [[unlikely]] {
        auto* functionGlobalObject = defaultGlobalObject(JSC::getFunctionRealm(lexicalGlobalObject, newTarget.getObject()));
        RETURN_IF_EXCEPTION(scope, {});
        structure = JSC::InternalFunction::createSubclassStructure(lexicalGlobalObject, newTarget.getObject(), functionGlobalObject->m_JSClipboardItemClassStructure.get(functionGlobalObject));
        RETURN_IF_EXCEPTION(scope, {});
    }

    auto* object = JSClipboardItem::create(vm, structure, WTF::move(types), values, WTF::move(presentationStyle));
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(object));
}

// ─── instance ───────────────────────────────────────────────────────────────

const JSC::ClassInfo JSClipboardItem::s_info = { "ClipboardItem"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardItem) };

JSClipboardItem::JSClipboardItem(JSC::VM& vm, JSC::Structure* structure)
    : Base(vm, structure)
{
}

JSClipboardItem::~JSClipboardItem() = default;

void JSClipboardItem::destroy(JSC::JSCell* cell)
{
    static_cast<JSClipboardItem*>(cell)->~JSClipboardItem();
}

JSClipboardItem* JSClipboardItem::create(JSC::VM& vm, JSC::Structure* structure, WTF::Vector<WTF::String>&& types, const JSC::MarkedArgumentBuffer& values, WTF::String&& presentationStyle)
{
    JSClipboardItem* item = new (NotNull, JSC::allocateCell<JSClipboardItem>(vm)) JSClipboardItem(vm, structure);
    item->finishCreation(vm, WTF::move(types), values, WTF::move(presentationStyle));
    return item;
}

void JSClipboardItem::finishCreation(JSC::VM& vm, WTF::Vector<WTF::String>&& types, const JSC::MarkedArgumentBuffer& values, WTF::String&& presentationStyle)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
    m_types = WTF::move(types);
    m_presentationStyle = WTF::move(presentationStyle);
    m_values = WTF::Vector<JSC::WriteBarrier<JSC::Unknown>>(m_types.size());
    for (size_t i = 0; i < m_types.size(); i++)
        m_values[i].set(vm, this, values.at(i));
    m_frozenTypes.initLater([](const JSC::LazyProperty<JSClipboardItem, JSC::JSObject>::Initializer& init) {
        auto& vm = init.vm;
        auto* item = init.owner;
        auto* globalObject = item->globalObject();
        auto scope = DECLARE_THROW_SCOPE(vm);
        // WebIDL FrozenArray<DOMString>: the same frozen JSArray every get.
        JSC::MarkedArgumentBuffer strings;
        for (const auto& type : item->m_types)
            strings.append(JSC::jsString(vm, type));
        JSC::JSArray* array = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), strings);
        // A fresh array of a few plain strings: only OOM can throw here.
        scope.assertNoException();
        JSC::objectConstructorFreeze(globalObject, array);
        scope.assertNoException();
        init.set(array);
    });
}

template<typename Visitor>
void JSClipboardItem::visitChildrenImpl(JSC::JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSClipboardItem>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    for (auto& value : thisObject->m_values)
        visitor.append(value);
    thisObject->m_frozenTypes.visit(visitor);
}
DEFINE_VISIT_CHILDREN(JSClipboardItem);

size_t JSClipboardItem::estimatedSize(JSC::JSCell* cell, JSC::VM& vm)
{
    auto* thisObject = uncheckedDowncast<JSClipboardItem>(cell);
    size_t bytes = 0;
    for (const auto& type : thisObject->m_types)
        bytes += type.sizeInBytes();
    bytes += thisObject->m_values.sizeInBytes();
    return Base::estimatedSize(cell, vm) + bytes;
}

template<typename, JSC::SubspaceAccess mode>
JSC::GCClient::IsoSubspace* JSClipboardItem::subspaceFor(JSC::VM& vm)
{
    if constexpr (mode == JSC::SubspaceAccess::Concurrently)
        return nullptr;
    return WebCore::subspaceForImpl<JSClipboardItem, WebCore::UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForClipboardItem.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForClipboardItem = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForClipboardItem.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForClipboardItem = std::forward<decltype(space)>(space); });
}

JSC::JSObject* JSClipboardItem::frozenTypes(JSC::JSGlobalObject*)
{
    return m_frozenTypes.getInitializedOnMainThread(this);
}

JSC::JSValue JSClipboardItem::getTypePromise(JSC::JSGlobalObject* globalObject, const WTF::String& type)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    size_t index = m_types.find(type);
    if (index == WTF::notFound) {
        JSC::JSValue error = WebCore::createDOMException(globalObject, WebCore::ExceptionCode::NotFoundError, makeString("The type \""_s, type, "\" was not found"_s));
        RETURN_IF_EXCEPTION(scope, {});
        RELEASE_AND_RETURN(scope, JSC::JSPromise::rejectedPromise(globalObject, error));
    }
    RELEASE_AND_RETURN(scope, getTypePromiseAtIndex(globalObject, static_cast<unsigned>(index)));
}

JSC::JSValue clipboardDataToBlob(JSC::JSGlobalObject* globalObject, JSC::JSValue value, const WTF::String& type)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    bool isBlob = !!dynamicDowncast<WebCore::JSBlob>(value);
    if (isBlob) {
        // A Blob already declaring the requested type (with or without a
        // charset parameter, which Blob appends to text types) passes.
        JSC::JSValue blobType = value.get(globalObject, vm.propertyNames->type);
        RETURN_IF_EXCEPTION(scope, {});
        auto blobTypeString = blobType.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        bool parameterized = blobTypeString.length() > type.length() && blobTypeString[type.length()] == ';';
        if (blobTypeString == type || (parameterized && blobTypeString.startsWith(type)))
            return value;
    }
    // WebIDL `(DOMString or Blob)`: a non-Blob value is ToString-coerced; only
    // a Symbol (or a throwing `toString`) fails the conversion.
    if (!isBlob && !value.isString()) {
        auto string = value.toWTFString(globalObject);
        RETURN_IF_EXCEPTION(scope, {});
        value = JSC::jsString(vm, WTF::move(string));
    }
    // new Blob([value], { type })
    auto* zigGlobal = defaultGlobalObject(globalObject);
    JSC::JSObject* blobConstructor = zigGlobal->JSBlobConstructor();
    JSC::MarkedArgumentBuffer partArgs;
    partArgs.append(value);
    JSC::JSArray* parts = JSC::constructArray(globalObject, static_cast<JSC::ArrayAllocationProfile*>(nullptr), partArgs);
    RETURN_IF_EXCEPTION(scope, {});
    JSC::JSObject* options = JSC::constructEmptyObject(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    options->putDirect(vm, vm.propertyNames->type, JSC::jsString(vm, type));
    JSC::MarkedArgumentBuffer constructArgs;
    constructArgs.append(parts);
    constructArgs.append(options);
    auto constructData = JSC::getConstructData(blobConstructor);
    JSC::JSObject* blob = JSC::construct(globalObject, blobConstructor, constructData, constructArgs);
    RETURN_IF_EXCEPTION(scope, {});
    return blob;
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardHandler_onGetTypeSettled, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* context = uncheckedDowncast<JSC::InternalFieldTuple>(callFrame->argument(1));
    auto* item = uncheckedDowncast<JSClipboardItem>(context->getInternalField(0));
    unsigned index = context->getInternalField(1).asUInt32();
    // Returning the Blob resolves, and throwing rejects, the promise `getType()` returned.
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(clipboardDataToBlob(globalObject, callFrame->argument(0), item->types()[index])));
}

JSC::JSValue JSClipboardItem::getTypePromiseAtIndex(JSC::JSGlobalObject* globalObject, unsigned index)
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    JSC::JSValue stored = m_values[index].get();

    // Only an object can be a promise (or a thenable `Promise.resolve` would adopt), so
    // anything else normalizes now and needs no reaction at all.
    if (!stored.isObject()) {
        JSC::JSValue blob = clipboardDataToBlob(globalObject, stored, m_types[index]);
        if (scope.exception()) [[unlikely]]
            RELEASE_AND_RETURN(scope, JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
        RELEASE_AND_RETURN(scope, JSC::JSPromise::resolvedPromise(globalObject, blob));
    }

    // Await the stored ClipboardItemData, then normalize what it settles to. `settled`'s
    // own rejection forwards to `result` because no onRejected handler is installed.
    auto* settled = JSC::JSPromise::resolvedPromise(globalObject, stored);
    RETURN_IF_EXCEPTION(scope, {});
    auto* result = JSC::JSPromise::create(vm, globalObject->promiseStructure());
    auto* context = JSC::InternalFieldTuple::create(vm, globalObject->internalFieldTupleStructure(), this, JSC::jsNumber(index));
    settled->performPromiseThenWithContext(vm, globalObject, defaultGlobalObject(globalObject)->m_clipboardOnGetTypeSettled.get(globalObject), JSC::jsUndefined(), result, context);
    RETURN_IF_EXCEPTION(scope, {});
    return result;
}

// ─── prototype members ──────────────────────────────────────────────────────

static JSClipboardItem* jsClipboardItemCast(JSC::JSGlobalObject* globalObject, JSC::ThrowScope& scope, JSC::JSValue thisValue, ASCIILiteral member)
{
    auto* item = dynamicDowncast<JSClipboardItem>(thisValue);
    if (!item) [[unlikely]]
        throwTypeError(globalObject, scope, makeString("ClipboardItem.prototype."_s, member, " called on an incompatible receiver"_s));
    return item;
}

JSC_DEFINE_CUSTOM_GETTER(jsClipboardItemGetter_types, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* item = jsClipboardItemCast(globalObject, scope, JSC::JSValue::decode(thisValue), "types"_s);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(item->frozenTypes(globalObject)));
}

JSC_DEFINE_CUSTOM_GETTER(jsClipboardItemGetter_presentationStyle, (JSC::JSGlobalObject * globalObject, JSC::EncodedJSValue thisValue, JSC::PropertyName))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* item = jsClipboardItemCast(globalObject, scope, JSC::JSValue::decode(thisValue), "presentationStyle"_s);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsString(vm, item->presentationStyle())));
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardItemProtoFuncGetType, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* item = jsClipboardItemCast(globalObject, scope, callFrame->thisValue(), "getType"_s);
    // A promise-returning operation rejects rather than throws.
    if (!item) [[unlikely]]
        return JSC::JSValue::encode(JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
    if (callFrame->argumentCount() < 1) [[unlikely]] {
        throwTypeError(globalObject, scope, "ClipboardItem.prototype.getType requires 1 argument"_s);
        return JSC::JSValue::encode(JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
    }
    auto type = callFrame->uncheckedArgument(0).toWTFString(globalObject);
    if (scope.exception()) [[unlikely]]
        return JSC::JSValue::encode(JSC::JSPromise::rejectedPromiseWithCaughtException(globalObject, scope));
    // `types` holds lowercased serializations; match the argument the same way.
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(item->getTypePromise(globalObject, type.convertToASCIILowercase())));
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardItemConstructorFuncSupports, (JSC::JSGlobalObject * globalObject, JSC::CallFrame* callFrame))
{
    auto& vm = JSC::getVM(globalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) [[unlikely]]
        return throwVMError(globalObject, scope, createNotEnoughArgumentsError(globalObject));
    // WebIDL DOMString conversion (Symbols throw); the per-platform truth is
    // shared with Clipboard.prototype.write's validation.
    auto type = callFrame->uncheckedArgument(0).toWTFString(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(JSC::jsBoolean(WebCore::clipboardSupportsType(type))));
}

// ─── class structure + entry points ─────────────────────────────────────────

void setupClipboardItemClassStructure(JSC::LazyClassStructure::Initializer& init)
{
    auto* prototypeStructure = JSClipboardItemPrototype::createStructure(init.vm, init.global, init.global->objectPrototype());
    auto* prototype = JSClipboardItemPrototype::create(init.vm, init.global, prototypeStructure);
    auto* constructorStructure = JSClipboardItemConstructor::createStructure(init.vm, init.global, init.global->functionPrototype());
    auto* constructor = JSClipboardItemConstructor::create(init.vm, init.global, constructorStructure, prototype);
    auto* structure = JSClipboardItem::createStructure(init.vm, init.global, prototype);
    init.setPrototype(prototype);
    init.setStructure(structure);
    init.setConstructor(constructor);
}

} // namespace Bun

// Called from the Rust `read()` job (on the JS thread) with two index-aligned
// arrays: the present MIME types and their Blobs.
extern "C" JSC::EncodedJSValue Bun__ClipboardItem__createFromEntries(JSC::JSGlobalObject* lexicalGlobalObject, JSC::EncodedJSValue typesArray, JSC::EncodedJSValue blobsArray)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto scope = DECLARE_THROW_SCOPE(vm);
    auto* globalObject = defaultGlobalObject(lexicalGlobalObject);

    auto* types = dynamicDowncast<JSC::JSArray>(JSC::JSValue::decode(typesArray));
    auto* blobs = dynamicDowncast<JSC::JSArray>(JSC::JSValue::decode(blobsArray));
    if (!types || !blobs) [[unlikely]]
        return JSC::JSValue::encode(JSC::jsUndefined());
    unsigned length = types->length();
    WTF::Vector<WTF::String> typeStrings;
    typeStrings.reserveInitialCapacity(length);
    JSC::MarkedArgumentBuffer values;
    for (unsigned i = 0; i < length; i++) {
        JSC::JSValue typeValue = types->getIndex(lexicalGlobalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        auto type = typeValue.toWTFString(lexicalGlobalObject);
        RETURN_IF_EXCEPTION(scope, {});
        JSC::JSValue blobValue = blobs->getIndex(lexicalGlobalObject, i);
        RETURN_IF_EXCEPTION(scope, {});
        typeStrings.append(WTF::move(type));
        values.append(blobValue);
    }
    if (values.hasOverflowed()) [[unlikely]]
        return JSC::JSValue::encode(throwOutOfMemoryError(lexicalGlobalObject, scope));
    auto* structure = globalObject->m_JSClipboardItemClassStructure.get(globalObject);
    RETURN_IF_EXCEPTION(scope, {});
    auto* item = Bun::JSClipboardItem::create(vm, structure, WTF::move(typeStrings), values, WTF::String("unspecified"_s));
    RELEASE_AND_RETURN(scope, JSC::JSValue::encode(item));
}
