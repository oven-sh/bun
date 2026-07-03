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
#include "JSClipboardEvent.h"

#include "ActiveDOMObject.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertStrings.h"
#include "JSEventInit.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMWrapperCache.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSDestructibleObjectHeapCellType.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>
#include <wtf/PointerPreparations.h>
#include <wtf/URL.h>

namespace WebCore {
using namespace JSC;

// Attributes

static JSC_DECLARE_CUSTOM_GETTER(jsClipboardEventConstructor);
static JSC_DECLARE_CUSTOM_GETTER(jsClipboardEvent_clipboardData);

class JSClipboardEventPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSClipboardEventPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSClipboardEventPrototype* ptr = new (NotNull, JSC::allocateCell<JSClipboardEventPrototype>(vm)) JSClipboardEventPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClipboardEventPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSClipboardEventPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClipboardEventPrototype, JSClipboardEventPrototype::Base);

using JSClipboardEventDOMConstructor = JSDOMConstructor<JSClipboardEvent>;

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSClipboardEventDOMConstructor::construct(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = uncheckedDowncast<JSClipboardEventDOMConstructor>(callFrame->jsCallee());
    ASSERT(castedThis);
    if (callFrame->argumentCount() < 1) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto type = convert<IDLAtomStringAdaptor<IDLDOMString>>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, {});
    // Bun has no DataTransfer, so a `clipboardData` init member is accepted
    // (and ignored) like any unknown dictionary member; only the EventInit
    // members are converted. The attribute itself is always null.
    EnsureStillAliveScope argument1 = callFrame->argument(1);
    auto eventInitDict = convert<IDLDictionary<EventInit>>(*lexicalGlobalObject, argument1.value());
    RETURN_IF_EXCEPTION(throwScope, {});
    auto object = ClipboardEvent::create(WTF::move(type), WTF::move(eventInitDict));
    if constexpr (IsExceptionOr<decltype(object)>)
        RETURN_IF_EXCEPTION(throwScope, {});
    static_assert(TypeOrExceptionOrUnderlyingType<decltype(object)>::isRef);
    auto jsValue = toJSNewlyCreated<IDLInterface<ClipboardEvent>>(*lexicalGlobalObject, *castedThis->globalObject(), throwScope, WTF::move(object));
    if constexpr (IsExceptionOr<decltype(object)>)
        RETURN_IF_EXCEPTION(throwScope, {});
    setSubclassStructureIfNeeded<ClipboardEvent>(lexicalGlobalObject, callFrame, asObject(jsValue));
    RETURN_IF_EXCEPTION(throwScope, {});
    return JSValue::encode(jsValue);
}
JSC_ANNOTATE_HOST_FUNCTION(JSClipboardEventDOMConstructorConstruct, JSClipboardEventDOMConstructor::construct);

template<> const ClassInfo JSClipboardEventDOMConstructor::s_info = { "ClipboardEvent"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardEventDOMConstructor) };

template<> JSValue JSClipboardEventDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return JSEvent::getConstructor(vm, &globalObject);
}

template<> void JSClipboardEventDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(1), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "ClipboardEvent"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSClipboardEvent::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

/* Hash table for prototype */

static const HashTableValue JSClipboardEventPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsClipboardEventConstructor, 0 } },
    { "clipboardData"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsClipboardEvent_clipboardData, 0 } },
};

const ClassInfo JSClipboardEventPrototype::s_info = { "ClipboardEvent"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardEventPrototype) };

void JSClipboardEventPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSClipboardEvent::info(), JSClipboardEventPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSClipboardEvent::s_info = { "ClipboardEvent"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardEvent) };

JSClipboardEvent::JSClipboardEvent(Structure* structure, JSDOMGlobalObject& globalObject, Ref<ClipboardEvent>&& impl)
    : JSEvent(structure, globalObject, WTF::move(impl))
{
}

void JSClipboardEvent::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSObject* JSClipboardEvent::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSClipboardEventPrototype::create(vm, &globalObject, JSClipboardEventPrototype::createStructure(vm, &globalObject, JSEvent::prototype(vm, globalObject)));
}

JSObject* JSClipboardEvent::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSClipboardEvent>(vm, globalObject);
}

JSValue JSClipboardEvent::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSClipboardEventDOMConstructor, DOMConstructorID::ClipboardEvent>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsClipboardEventConstructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSClipboardEventPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSClipboardEvent::getConstructor(JSC::getVM(lexicalGlobalObject), prototype->globalObject()));
}

static inline JSValue jsClipboardEvent_clipboardDataGetter(JSGlobalObject& lexicalGlobalObject, JSClipboardEvent& thisObject)
{
    UNUSED_PARAM(lexicalGlobalObject);
    UNUSED_PARAM(thisObject);
    // Bun has no DataTransfer; the spec'd attribute is always null.
    return JSC::jsNull();
}

JSC_DEFINE_CUSTOM_GETTER(jsClipboardEvent_clipboardData, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName attributeName))
{
    return IDLAttribute<JSClipboardEvent>::get<jsClipboardEvent_clipboardDataGetter, CastedThisErrorBehavior::Assert>(*lexicalGlobalObject, thisValue, attributeName);
}

JSC::GCClient::IsoSubspace* JSClipboardEvent::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSClipboardEvent, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForClipboardEvent.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForClipboardEvent = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForClipboardEvent.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForClipboardEvent = std::forward<decltype(space)>(space); });
}

void JSClipboardEvent::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSClipboardEvent>(cell);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    if (thisObject->scriptExecutionContext())
        analyzer.setLabelForCell(cell, makeString("url "_s, thisObject->scriptExecutionContext()->url().string()));
    Base::analyzeHeap(cell, analyzer);
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<ClipboardEvent>&& impl)
{
    return createWrapper<ClipboardEvent>(globalObject, WTF::move(impl));
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, ClipboardEvent& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

}
