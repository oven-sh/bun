/*
    This file is part of the WebKit open source project.

    This library is free software; you can redistribute it and/or
    modify it under the terms of the GNU Library General Public
    License as published by the Free Software Foundation; either
    version 2 of the License, or (at your option) any later version.

    This library is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
    Library General Public License for more details.

    You should have received a copy of the GNU Library General Public License
    along with this library; see the file COPYING.LIB.  If not, write to
    the Free Software Foundation, Inc., 51 Franklin Street, Fifth Floor,
    Boston, MA 02110-1301, USA.
*/

#include "config.h"
#include "JSClipboardItem.h"

#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "HTTPParsers.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertAny.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMConvertPromise.h"
#include "JSDOMConvertRecord.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperationReturningPromise.h"
#include "JSDOMPromise.h"
#include "JSDOMWrapperCache.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/FunctionPrototype.h>
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSArray.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/PropertyNameArray.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>
#include <wtf/text/MakeString.h>

namespace WebCore {
using namespace JSC;

// WebIDL: every key of the items record must parse as `type "/" subtype`,
// each half an HTTP token (https://mimesniff.spec.whatwg.org/#mime-type).
static bool isValidClipboardMIMEType(const String& type)
{
    size_t slash = type.find('/');
    if (slash == notFound)
        return false;
    auto view = StringView(type);
    return isValidHTTPToken(view.left(slash)) && isValidHTTPToken(view.substring(slash + 1));
}

static ASCIILiteral presentationStyleString(ClipboardItem::PresentationStyle style)
{
    switch (style) {
    case ClipboardItem::PresentationStyle::Unspecified:
        return "unspecified"_s;
    case ClipboardItem::PresentationStyle::Inline:
        return "inline"_s;
    case ClipboardItem::PresentationStyle::Attachment:
        return "attachment"_s;
    }
    ASSERT_NOT_REACHED();
    return "unspecified"_s;
}

// Attributes and functions

static JSC_DECLARE_CUSTOM_GETTER(jsClipboardItemConstructor);
static JSC_DECLARE_CUSTOM_GETTER(jsClipboardItem_types);
static JSC_DECLARE_CUSTOM_GETTER(jsClipboardItem_presentationStyle);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardItemPrototypeFunction_getType);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardItemConstructorFunction_supports);

class JSClipboardItemPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSClipboardItemPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSClipboardItemPrototype* ptr = new (NotNull, JSC::allocateCell<JSClipboardItemPrototype>(vm)) JSClipboardItemPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClipboardItemPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSClipboardItemPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClipboardItemPrototype, JSClipboardItemPrototype::Base);

using JSClipboardItemDOMConstructor = JSDOMConstructor<JSClipboardItem>;

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSClipboardItemDOMConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = uncheckedDowncast<JSClipboardItemDOMConstructor>(callFrame->jsCallee());
    ASSERT(castedThis);

    // WebIDL `record<DOMString, ClipboardItemData>` requires an object. The
    // converter's own failure message does not name the interface, so the
    // common mistake is reported here instead.
    JSValue itemsArg = callFrame->argument(0);
    if (!itemsArg.isObject()) [[unlikely]]
        return JSValue::encode(throwTypeError(lexicalGlobalObject, throwScope, "ClipboardItem requires a record of MIME type to data"_s));

    // The record conversion is the generator's: it walks own enumerable string
    // keys (so Proxy and other exotic objects dispatch correctly) and turns each
    // value into a refcounted, GC-guarded DOMPromise via Promise.resolve.
    auto record = convert<IDLRecord<IDLDOMString, IDLPromise<IDLAny>>>(*lexicalGlobalObject, itemsArg);
    RETURN_IF_EXCEPTION(throwScope, {});

    Vector<KeyValuePair<String, Ref<DOMPromise>>> items;
    items.reserveInitialCapacity(record.size());
    for (auto& entry : record) {
        if (!isValidClipboardMIMEType(entry.key)) [[unlikely]]
            return JSValue::encode(throwTypeError(lexicalGlobalObject, throwScope, makeString("\""_s, entry.key, "\" is not a valid MIME type"_s)));

        // Spec: `types` holds the serialization of the parsed MIME type, and
        // two keys with the same serialization are one representation twice.
        String normalized = entry.key.convertToASCIILowercase();
        bool duplicate = items.containsIf([&](auto& item) { return item.key == normalized; });
        if (duplicate) [[unlikely]]
            return JSValue::encode(throwTypeError(lexicalGlobalObject, throwScope, makeString("Duplicate MIME type \""_s, normalized, "\""_s)));

        if (!entry.value) [[unlikely]]
            return JSValue::encode(throwTypeError(lexicalGlobalObject, throwScope, "ClipboardItem representations must be values or promises"_s));
        items.append({ WTF::move(normalized), entry.value.releaseNonNull() });
    }

    // WebIDL: a dictionary argument must be undefined, null, or an object.
    ClipboardItem::Options options;
    JSValue optionsArg = callFrame->argument(1);
    if (!optionsArg.isUndefinedOrNull()) {
        if (!optionsArg.isObject()) [[unlikely]]
            return JSValue::encode(throwTypeError(lexicalGlobalObject, throwScope, "ClipboardItem options must be an object"_s));
        JSValue styleValue = asObject(optionsArg)->get(lexicalGlobalObject, JSC::Identifier::fromString(vm, "presentationStyle"_s));
        RETURN_IF_EXCEPTION(throwScope, {});
        if (!styleValue.isUndefined()) {
            String style = styleValue.toWTFString(lexicalGlobalObject);
            RETURN_IF_EXCEPTION(throwScope, {});
            if (style == "unspecified"_s)
                options.presentationStyle = ClipboardItem::PresentationStyle::Unspecified;
            else if (style == "inline"_s)
                options.presentationStyle = ClipboardItem::PresentationStyle::Inline;
            else if (style == "attachment"_s)
                options.presentationStyle = ClipboardItem::PresentationStyle::Attachment;
            else [[unlikely]]
                return JSValue::encode(throwTypeError(lexicalGlobalObject, throwScope, makeString("\""_s, style, "\" is not a valid value for presentationStyle"_s)));
        }
    }

    auto object = ClipboardItem::create(WTF::move(items), options);
    if constexpr (IsExceptionOr<decltype(object)>)
        RETURN_IF_EXCEPTION(throwScope, {});
    auto jsValue = toJSNewlyCreated<IDLInterface<ClipboardItem>>(*lexicalGlobalObject, *castedThis->globalObject(), throwScope, WTF::move(object));
    RETURN_IF_EXCEPTION(throwScope, {});
    setSubclassStructureIfNeeded<ClipboardItem>(lexicalGlobalObject, callFrame, asObject(jsValue));
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(jsValue);
}
JSC_ANNOTATE_HOST_FUNCTION(JSClipboardItemDOMConstructorConstruct, JSClipboardItemDOMConstructor::construct);

template<> const ClassInfo JSClipboardItemDOMConstructor::s_info = { "ClipboardItem"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardItemDOMConstructor) };

template<> JSValue JSClipboardItemDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    UNUSED_PARAM(vm);
    return globalObject.functionPrototype();
}

/* Hash table for constructor */

static const HashTableValue JSClipboardItemConstructorTableValues[] = {
    { "supports"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardItemConstructorFunction_supports, 1 } },
};

template<> void JSClipboardItemDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "ClipboardItem"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSClipboardItem::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    reifyStaticProperties(vm, JSClipboardItem::info(), JSClipboardItemConstructorTableValues, *this);
}

/* Hash table for prototype */

static const HashTableValue JSClipboardItemPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsClipboardItemConstructor, 0 } },
    { "types"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsClipboardItem_types, 0 } },
    { "presentationStyle"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsClipboardItem_presentationStyle, 0 } },
    { "getType"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardItemPrototypeFunction_getType, 1 } },
};

const ClassInfo JSClipboardItemPrototype::s_info = { "ClipboardItem"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardItemPrototype) };

void JSClipboardItemPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSClipboardItem::info(), JSClipboardItemPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSClipboardItem::s_info = { "ClipboardItem"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardItem) };

JSClipboardItem::JSClipboardItem(Structure* structure, JSDOMGlobalObject& globalObject, Ref<ClipboardItem>&& impl)
    : JSDOMWrapper<ClipboardItem>(structure, globalObject, WTF::move(impl))
{
}

JSObject* JSClipboardItem::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSClipboardItemPrototype::create(vm, &globalObject, JSClipboardItemPrototype::createStructure(vm, &globalObject, globalObject.objectPrototype()));
}

JSObject* JSClipboardItem::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSClipboardItem>(vm, globalObject);
}

JSValue JSClipboardItem::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSClipboardItemDOMConstructor, DOMConstructorID::ClipboardItem>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsClipboardItemConstructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSClipboardItemPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSClipboardItem::getConstructor(JSC::getVM(lexicalGlobalObject), prototype->globalObject()));
}

static inline JSValue jsClipboardItem_typesGetter(JSGlobalObject& lexicalGlobalObject, JSClipboardItem& thisObject)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);

    // FrozenArray [SameObject]: hand back the array built on the first get.
    if (JSValue cached = thisObject.cachedTypes())
        return cached;

    auto& impl = thisObject.wrapped();
    JSValue types = toJS<IDLSequence<IDLDOMString>>(lexicalGlobalObject, *thisObject.globalObject(), throwScope, impl.types());
    RETURN_IF_EXCEPTION(throwScope, {});
    if (auto* array = types.getObject()) {
        objectConstructorFreeze(&lexicalGlobalObject, array);
        RETURN_IF_EXCEPTION(throwScope, {});
    }
    thisObject.setCachedTypes(vm, types);
    return types;
}

JSC_DEFINE_CUSTOM_GETTER(jsClipboardItem_types, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<JSClipboardItem>::get<jsClipboardItem_typesGetter, CastedThisErrorBehavior::Assert>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSValue jsClipboardItem_presentationStyleGetter(JSGlobalObject& lexicalGlobalObject, JSClipboardItem& thisObject)
{
    auto& vm = JSC::getVM(&lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = thisObject.wrapped();
    RELEASE_AND_RETURN(throwScope, jsNontrivialString(vm, presentationStyleString(impl.presentationStyle())));
}

JSC_DEFINE_CUSTOM_GETTER(jsClipboardItem_presentationStyle, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<JSClipboardItem>::get<jsClipboardItem_presentationStyleGetter, CastedThisErrorBehavior::Assert>(*lexicalGlobalObject, thisValue, attributeName);
}

static inline JSC::EncodedJSValue jsClipboardItemPrototypeFunction_getTypeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperationReturningPromise<JSClipboardItem>::ClassParameter castedThis, Ref<DeferredPromise>&& promise)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    auto& impl = castedThis->wrapped();
    if (callFrame->argumentCount() < 1) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto type = convert<IDLDOMString>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    // MIME types are matched by their lowercased serialization.
    impl.getType(type.convertToASCIILowercase(), WTF::move(promise));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardItemPrototypeFunction_getType, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperationReturningPromise<JSClipboardItem>::call<jsClipboardItemPrototypeFunction_getTypeBody>(*lexicalGlobalObject, *callFrame, "getType"_s);
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardItemConstructorFunction_supports, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    if (callFrame->argumentCount() < 1) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto type = convert<IDLDOMString>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(ClipboardItem::supports(type))));
}

JSC::GCClient::IsoSubspace* JSClipboardItem::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSClipboardItem, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForClipboardItem.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForClipboardItem = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForClipboardItem.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForClipboardItem = std::forward<decltype(space)>(space); });
}

template<typename Visitor>
void JSClipboardItem::visitChildrenImpl(JSCell* cell, Visitor& visitor)
{
    auto* thisObject = uncheckedDowncast<JSClipboardItem>(cell);
    ASSERT_GC_OBJECT_INHERITS(thisObject, info());
    Base::visitChildren(thisObject, visitor);
    visitor.append(thisObject->m_cachedTypes);
}

DEFINE_VISIT_CHILDREN(JSClipboardItem);

void JSClipboardItem::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSClipboardItem>(cell);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    if (thisObject->scriptExecutionContext())
        analyzer.setLabelForCell(cell, makeString("url "_s, thisObject->scriptExecutionContext()->url().string()));
    Base::analyzeHeap(cell, analyzer);
}

bool JSClipboardItemOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    UNUSED_PARAM(handle);
    UNUSED_PARAM(visitor);
    UNUSED_PARAM(reason);
    return false;
}

void JSClipboardItemOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto* jsClipboardItem = static_cast<JSClipboardItem*>(handle.slot()->asCell());
    auto& world = *static_cast<DOMWrapperWorld*>(context);
    uncacheWrapper(world, &jsClipboardItem->wrapped(), jsClipboardItem);
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<ClipboardItem>&& impl)
{
    return createWrapper<ClipboardItem>(globalObject, WTF::move(impl));
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, ClipboardItem& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

ClipboardItem* JSClipboardItem::toWrapped(JSC::VM&, JSC::JSValue value)
{
    if (auto* wrapper = dynamicDowncast<JSClipboardItem>(value))
        return &wrapper->wrapped();
    return nullptr;
}

} // namespace WebCore
