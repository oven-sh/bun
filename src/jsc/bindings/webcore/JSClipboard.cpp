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
#include "JSClipboard.h"

#include "ActiveDOMObject.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "JSClipboardItem.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructorNotConstructable.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertSequences.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperationReturningPromise.h"
#include "JSDOMWrapperCache.h"
#include "ScriptExecutionContext.h"
#include "WebCoreJSClientData.h"
#include "ZigGlobalObject.h"
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/SlotVisitorMacros.h>
#include <JavaScriptCore/SubspaceInlines.h>
#include <wtf/GetPtr.h>

namespace WebCore {
using namespace JSC;

// Attributes and functions

static JSC_DECLARE_CUSTOM_GETTER(jsClipboardConstructor);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardPrototypeFunction_readText);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardPrototypeFunction_writeText);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardPrototypeFunction_read);
static JSC_DECLARE_HOST_FUNCTION(jsClipboardPrototypeFunction_write);

class JSClipboardPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSClipboardPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSClipboardPrototype* ptr = new (NotNull, JSC::allocateCell<JSClipboardPrototype>(vm)) JSClipboardPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClipboardPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSClipboardPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSClipboardPrototype, JSClipboardPrototype::Base);

using JSClipboardDOMConstructor = JSDOMConstructorNotConstructable<JSClipboard>;

template<> const ClassInfo JSClipboardDOMConstructor::s_info = { "Clipboard"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardDOMConstructor) };

template<> JSValue JSClipboardDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return JSEventTarget::getConstructor(vm, &globalObject);
}

template<> void JSClipboardDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "Clipboard"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSClipboard::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
}

/* Hash table for prototype */

static const HashTableValue JSClipboardPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsClipboardConstructor, 0 } },
    { "readText"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardPrototypeFunction_readText, 0 } },
    { "writeText"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardPrototypeFunction_writeText, 1 } },
    { "read"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardPrototypeFunction_read, 0 } },
    { "write"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsClipboardPrototypeFunction_write, 1 } },
};

const ClassInfo JSClipboardPrototype::s_info = { "Clipboard"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboardPrototype) };

void JSClipboardPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSClipboard::info(), JSClipboardPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSClipboard::s_info = { "Clipboard"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSClipboard) };

JSClipboard::JSClipboard(Structure* structure, JSDOMGlobalObject& globalObject, Ref<Clipboard>&& impl)
    : JSEventTarget(structure, globalObject, WTF::move(impl))
{
}

void JSClipboard::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSObject* JSClipboard::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSClipboardPrototype::create(vm, &globalObject, JSClipboardPrototype::createStructure(vm, &globalObject, JSEventTarget::prototype(vm, globalObject)));
}

JSObject* JSClipboard::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSClipboard>(vm, globalObject);
}

JSValue JSClipboard::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSClipboardDOMConstructor, DOMConstructorID::Clipboard>(vm, *uncheckedDowncast<const JSDOMGlobalObject>(globalObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsClipboardConstructor, (JSGlobalObject * lexicalGlobalObject, JSC::EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* prototype = dynamicDowncast<JSClipboardPrototype>(JSValue::decode(thisValue));
    if (!prototype) [[unlikely]]
        return throwVMTypeError(lexicalGlobalObject, throwScope);
    return JSValue::encode(JSClipboard::getConstructor(JSC::getVM(lexicalGlobalObject), prototype->globalObject()));
}

static inline JSC::EncodedJSValue jsClipboardPrototypeFunction_readTextBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperationReturningPromise<JSClipboard>::ClassParameter castedThis, Ref<DeferredPromise>&& promise)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    UNUSED_PARAM(callFrame);
    auto& impl = castedThis->wrapped();
    impl.readText(WTF::move(promise));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardPrototypeFunction_readText, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperationReturningPromise<JSClipboard>::call<jsClipboardPrototypeFunction_readTextBody>(*lexicalGlobalObject, *callFrame, "readText"_s);
}

static inline JSC::EncodedJSValue jsClipboardPrototypeFunction_writeTextBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperationReturningPromise<JSClipboard>::ClassParameter castedThis, Ref<DeferredPromise>&& promise)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    auto& impl = castedThis->wrapped();
    if (callFrame->argumentCount() < 1) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto data = convert<IDLDOMString>(*lexicalGlobalObject, argument0.value());
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    impl.writeText(WTF::move(data), WTF::move(promise));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardPrototypeFunction_writeText, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperationReturningPromise<JSClipboard>::call<jsClipboardPrototypeFunction_writeTextBody>(*lexicalGlobalObject, *callFrame, "writeText"_s);
}

static inline JSC::EncodedJSValue jsClipboardPrototypeFunction_readBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperationReturningPromise<JSClipboard>::ClassParameter castedThis, Ref<DeferredPromise>&& promise)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    UNUSED_PARAM(callFrame);
    auto& impl = castedThis->wrapped();
    impl.read(WTF::move(promise));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardPrototypeFunction_read, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperationReturningPromise<JSClipboard>::call<jsClipboardPrototypeFunction_readBody>(*lexicalGlobalObject, *callFrame, "read"_s);
}

static inline JSC::EncodedJSValue jsClipboardPrototypeFunction_writeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperationReturningPromise<JSClipboard>::ClassParameter castedThis, Ref<DeferredPromise>&& promise)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    UNUSED_PARAM(throwScope);
    auto& impl = castedThis->wrapped();
    if (callFrame->argumentCount() < 1) [[unlikely]]
        return throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
    EnsureStillAliveScope argument0 = callFrame->uncheckedArgument(0);
    auto data = convert<IDLSequence<IDLInterface<ClipboardItem>>>(*lexicalGlobalObject, argument0.value(), [](JSC::JSGlobalObject& lexicalGlobalObject, JSC::ThrowScope& scope) { throwArgumentTypeError(lexicalGlobalObject, scope, 0, "data"_s, "Clipboard"_s, "write"_s, "ClipboardItem"_s); });
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    impl.write(WTF::move(data), WTF::move(promise));
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsClipboardPrototypeFunction_write, (JSGlobalObject * lexicalGlobalObject, CallFrame* callFrame))
{
    return IDLOperationReturningPromise<JSClipboard>::call<jsClipboardPrototypeFunction_writeBody>(*lexicalGlobalObject, *callFrame, "write"_s);
}

JSC::GCClient::IsoSubspace* JSClipboard::subspaceForImpl(JSC::VM& vm)
{
    return WebCore::subspaceForImpl<JSClipboard, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForClipboard.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForClipboard = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForClipboard.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForClipboard = std::forward<decltype(space)>(space); });
}

void JSClipboard::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = uncheckedDowncast<JSClipboard>(cell);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    if (thisObject->scriptExecutionContext())
        analyzer.setLabelForCell(cell, makeString("url "_s, thisObject->scriptExecutionContext()->url().string()));
    Base::analyzeHeap(cell, analyzer);
}

bool JSClipboardOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    auto* jsClipboard = uncheckedDowncast<JSClipboard>(handle.slot()->asCell());
    ScriptExecutionContext* owner = WTF::getPtr(jsClipboard->wrapped().scriptExecutionContext());
    if (!owner)
        return false;
    if (reason) [[unlikely]]
        *reason = "Reachable from ScriptExecutionContext"_s;
    return visitor.containsOpaqueRoot(&jsClipboard->wrapped());
}

void JSClipboardOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto* jsClipboard = static_cast<JSClipboard*>(handle.slot()->asCell());
    auto& world = *static_cast<DOMWrapperWorld*>(context);
    uncacheWrapper(world, &jsClipboard->wrapped(), jsClipboard);
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<Clipboard>&& impl)
{
    return createWrapper<Clipboard>(globalObject, WTF::move(impl));
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, Clipboard& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

} // namespace WebCore
