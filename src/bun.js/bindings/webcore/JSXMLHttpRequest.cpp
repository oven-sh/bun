/*
 * Copyright (C) 2008 Apple Inc. All rights reserved.
 * Copyright (C) 2012 Google Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 *
 * 1.  Redistributions of source code must retain the above copyright
 *     notice, this list of conditions and the following disclaimer.
 * 2.  Redistributions in binary form must reproduce the above copyright
 *     notice, this list of conditions and the following disclaimer in the
 *     documentation and/or other materials provided with the distribution.
 * 3.  Neither the name of Apple Inc. ("Apple") nor the names of
 *     its contributors may be used to endorse or promote products derived
 *     from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE AND ITS CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
 * WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
 * DISCLAIMED. IN NO EVENT SHALL APPLE OR ITS CONTRIBUTORS BE LIABLE FOR ANY
 * DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
 * LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
 * ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#include "config.h"
#include "JSXMLHttpRequest.h"

#include "ActiveDOMObject.h"
#include "EventNames.h"
#include "ExtendedDOMClientIsoSubspaces.h"
#include "ExtendedDOMIsoSubspaces.h"
#include "IDLTypes.h"
#include "JSDOMAttribute.h"
#include "JSDOMBinding.h"
#include "JSDOMConstructor.h"
#include "JSDOMConvertBase.h"
#include "JSDOMConvertBufferSource.h"
#include "JSDOMConvertInterface.h"
#include "JSDOMConvertNullable.h"
#include "JSDOMConvertNumbers.h"
#include "JSDOMConvertStrings.h"
#include "JSDOMConvertBoolean.h"
#include "JSDOMExceptionHandling.h"
#include "JSDOMGlobalObjectInlines.h"
#include "JSDOMOperation.h"
#include "JSDOMWrapperCache.h"
#include "JSEventListener.h"
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
// Forward declarations instead of includes for now
// These will be properly included once the classes are generated
namespace WebCore {
    class JSBlob;
    class JSDOMFormData; 
    class JSURLSearchParams;
}
#include "JSXMLHttpRequestUpload.h"

namespace WebCore {
using namespace JSC;

// Functions
static JSC_DECLARE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_open);
static JSC_DECLARE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_setRequestHeader);
static JSC_DECLARE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_send);
static JSC_DECLARE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_abort);
static JSC_DECLARE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_getResponseHeader);
static JSC_DECLARE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_getAllResponseHeaders);
static JSC_DECLARE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_overrideMimeType);

// Function body declarations
static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_openBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis);
static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_setRequestHeaderBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis);
static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_sendBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis);
static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_abortBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis);
static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_getResponseHeaderBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis);
static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_getAllResponseHeadersBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis);
static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_overrideMimeTypeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis);

// Attributes
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequestConstructor);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_readyState);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_status);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_statusText);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_responseText);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_responseURL);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_response);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_responseType);
static JSC_DECLARE_CUSTOM_SETTER(setJSXMLHttpRequest_responseType);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_timeout);
static JSC_DECLARE_CUSTOM_SETTER(setJSXMLHttpRequest_timeout);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_withCredentials);
static JSC_DECLARE_CUSTOM_SETTER(setJSXMLHttpRequest_withCredentials);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_upload);
static JSC_DECLARE_CUSTOM_GETTER(jsXMLHttpRequest_onreadystatechange);
static JSC_DECLARE_CUSTOM_SETTER(setJSXMLHttpRequest_onreadystatechange);

class JSXMLHttpRequestPrototype final : public JSC::JSNonFinalObject {
public:
    using Base = JSC::JSNonFinalObject;
    static JSXMLHttpRequestPrototype* create(JSC::VM& vm, JSDOMGlobalObject* globalObject, JSC::Structure* structure)
    {
        JSXMLHttpRequestPrototype* ptr = new (NotNull, JSC::allocateCell<JSXMLHttpRequestPrototype>(vm)) JSXMLHttpRequestPrototype(vm, globalObject, structure);
        ptr->finishCreation(vm);
        return ptr;
    }

    DECLARE_INFO;
    template<typename CellType, JSC::SubspaceAccess>
    static JSC::GCClient::IsoSubspace* subspaceFor(JSC::VM& vm)
    {
        STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSXMLHttpRequestPrototype, Base);
        return &vm.plainObjectSpace();
    }
    static JSC::Structure* createStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype)
    {
        return JSC::Structure::create(vm, globalObject, prototype, JSC::TypeInfo(JSC::ObjectType, StructureFlags), info());
    }

private:
    JSXMLHttpRequestPrototype(JSC::VM& vm, JSC::JSGlobalObject*, JSC::Structure* structure)
        : JSC::JSNonFinalObject(vm, structure)
    {
    }

    void finishCreation(JSC::VM&);
};
STATIC_ASSERT_ISO_SUBSPACE_SHARABLE(JSXMLHttpRequestPrototype, JSXMLHttpRequestPrototype::Base);

using JSXMLHttpRequestDOMConstructor = JSDOMConstructor<JSXMLHttpRequest>;

template<> const ClassInfo JSXMLHttpRequestDOMConstructor::s_info = { "XMLHttpRequest"_s, nullptr, nullptr, nullptr, CREATE_METHOD_TABLE(JSXMLHttpRequestDOMConstructor) };

/* Hash table for constructor */
static const HashTableValue JSXMLHttpRequestConstructorTableValues[] = {
    { "UNSENT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 0 } },
    { "OPENED"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 1 } },
    { "HEADERS_RECEIVED"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 2 } },
    { "LOADING"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 3 } },
    { "DONE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 4 } },
};

static_assert(XMLHttpRequest::UNSENT == 0, "UNSENT in XMLHttpRequest does not match value from IDL");
static_assert(XMLHttpRequest::OPENED == 1, "OPENED in XMLHttpRequest does not match value from IDL");
static_assert(XMLHttpRequest::HEADERS_RECEIVED == 2, "HEADERS_RECEIVED in XMLHttpRequest does not match value from IDL");
static_assert(XMLHttpRequest::LOADING == 3, "LOADING in XMLHttpRequest does not match value from IDL");
static_assert(XMLHttpRequest::DONE == 4, "DONE in XMLHttpRequest does not match value from IDL");

static inline JSC::EncodedJSValue constructJSXMLHttpRequest(JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = jsCast<JSXMLHttpRequestDOMConstructor*>(callFrame->jsCallee());
    auto* context = castedThis->scriptExecutionContext();
    if (!context)
        return throwConstructorScriptExecutionContextUnavailableError(*lexicalGlobalObject, throwScope, "XMLHttpRequest");
    auto object = XMLHttpRequest::create(*context);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    auto jsValue = toJSNewlyCreated<IDLInterface<XMLHttpRequest>>(*lexicalGlobalObject, *castedThis->globalObject(), throwScope, WTFMove(object));
    RETURN_IF_EXCEPTION(throwScope, { });
    setSubclassStructureIfNeeded<XMLHttpRequest>(lexicalGlobalObject, callFrame, asObject(jsValue));
    return JSValue::encode(jsValue);
}

/* Hash table for prototype */
static const HashTableValue JSXMLHttpRequestPrototypeTableValues[] = {
    { "constructor"_s, static_cast<unsigned>(JSC::PropertyAttribute::DontEnum), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequestConstructor, 0 } },
    { "readyState"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_readyState, 0 } },
    { "status"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_status, 0 } },
    { "statusText"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_statusText, 0 } },
    { "responseText"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_responseText, 0 } },
    { "responseURL"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_responseURL, 0 } },
    { "response"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_response, 0 } },
    { "responseType"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_responseType, setJSXMLHttpRequest_responseType } },
    { "timeout"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_timeout, setJSXMLHttpRequest_timeout } },
    { "withCredentials"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_withCredentials, setJSXMLHttpRequest_withCredentials } },
    { "upload"_s, static_cast<unsigned>(JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_upload, 0 } },
    { "onreadystatechange"_s, static_cast<unsigned>(JSC::PropertyAttribute::CustomAccessor | JSC::PropertyAttribute::DOMAttribute), NoIntrinsic, { HashTableValue::GetterSetterType, jsXMLHttpRequest_onreadystatechange, setJSXMLHttpRequest_onreadystatechange } },
    { "open"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsXMLHttpRequestPrototypeFunction_open, 2 } },
    { "setRequestHeader"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsXMLHttpRequestPrototypeFunction_setRequestHeader, 2 } },
    { "send"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsXMLHttpRequestPrototypeFunction_send, 0 } },
    { "abort"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsXMLHttpRequestPrototypeFunction_abort, 0 } },
    { "getResponseHeader"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsXMLHttpRequestPrototypeFunction_getResponseHeader, 1 } },
    { "getAllResponseHeaders"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsXMLHttpRequestPrototypeFunction_getAllResponseHeaders, 0 } },
    { "overrideMimeType"_s, static_cast<unsigned>(JSC::PropertyAttribute::Function), NoIntrinsic, { HashTableValue::NativeFunctionType, jsXMLHttpRequestPrototypeFunction_overrideMimeType, 1 } },
    // Constants
    { "UNSENT"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 0 } },
    { "OPENED"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 1 } },
    { "HEADERS_RECEIVED"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 2 } },
    { "LOADING"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 3 } },
    { "DONE"_s, JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::ConstantInteger, NoIntrinsic, { HashTableValue::ConstantType, 4 } },
};

const ClassInfo JSXMLHttpRequestPrototype::s_info = { "XMLHttpRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSXMLHttpRequestPrototype) };

void JSXMLHttpRequestPrototype::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    reifyStaticProperties(vm, JSXMLHttpRequest::info(), JSXMLHttpRequestPrototypeTableValues, *this);
    JSC_TO_STRING_TAG_WITHOUT_TRANSITION();
}

const ClassInfo JSXMLHttpRequest::s_info = { "XMLHttpRequest"_s, &Base::s_info, nullptr, nullptr, CREATE_METHOD_TABLE(JSXMLHttpRequest) };

JSXMLHttpRequest::JSXMLHttpRequest(Structure* structure, JSDOMGlobalObject& globalObject, Ref<XMLHttpRequest>&& impl)
    : JSEventTarget(structure, globalObject, WTFMove(impl))
{
}

void JSXMLHttpRequest::finishCreation(VM& vm)
{
    Base::finishCreation(vm);
    ASSERT(inherits(info()));
}

JSObject* JSXMLHttpRequest::createPrototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return JSXMLHttpRequestPrototype::create(vm, &globalObject, JSXMLHttpRequestPrototype::createStructure(vm, &globalObject, JSEventTarget::prototype(vm, globalObject)));
}

JSObject* JSXMLHttpRequest::prototype(VM& vm, JSDOMGlobalObject& globalObject)
{
    return getDOMPrototype<JSXMLHttpRequest>(vm, globalObject);
}

JSValue JSXMLHttpRequest::getConstructor(VM& vm, const JSGlobalObject* globalObject)
{
    return getDOMConstructor<JSXMLHttpRequestDOMConstructor, DOMConstructorID::XMLHttpRequest>(vm, *jsCast<const JSDOMGlobalObject*>(globalObject));
}

void JSXMLHttpRequest::analyzeHeap(JSCell* cell, HeapAnalyzer& analyzer)
{
    auto* thisObject = jsCast<JSXMLHttpRequest*>(cell);
    analyzer.setWrappedObjectForCell(cell, &thisObject->wrapped());
    Base::analyzeHeap(cell, analyzer);
}

// Attribute getters
JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequestConstructor, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    return JSValue::encode(JSXMLHttpRequest::getConstructor(JSC::getVM(lexicalGlobalObject), lexicalGlobalObject));
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_readyState, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    auto& impl = thisObject->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsNumber(static_cast<int>(impl.readyState()))));
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_status, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    auto& impl = thisObject->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsNumber(impl.status())));
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_statusText, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    auto& impl = thisObject->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsStringWithCache(vm, impl.statusText())));
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_responseText, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    auto& impl = thisObject->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsStringWithCache(vm, impl.responseText())));
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_responseURL, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    auto& impl = thisObject->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsStringWithCache(vm, impl.responseURL())));
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_response, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    auto& impl = thisObject->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(impl.response(&*lexicalGlobalObject)));
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_responseType, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    auto& impl = thisObject->wrapped();
    
    // Convert ResponseType enum to string
    String responseTypeString;
    switch (impl.responseType()) {
        case XMLHttpRequest::ResponseType::Empty:
            responseTypeString = ""_s;
            break;
        case XMLHttpRequest::ResponseType::ArrayBuffer:
            responseTypeString = "arraybuffer"_s;
            break;
        case XMLHttpRequest::ResponseType::Blob:
            responseTypeString = "blob"_s;
            break;
        case XMLHttpRequest::ResponseType::Document:
            responseTypeString = "document"_s;
            break;
        case XMLHttpRequest::ResponseType::JSON:
            responseTypeString = "json"_s;
            break;
        case XMLHttpRequest::ResponseType::Text:
            responseTypeString = "text"_s;
            break;
    }
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsStringWithCache(vm, responseTypeString)));
}

JSC_DEFINE_CUSTOM_SETTER(setJSXMLHttpRequest_responseType, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;
    auto& impl = thisObject->wrapped();
    
    auto responseTypeString = convert<IDLDOMString>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    
    XMLHttpRequest::ResponseType responseType;
    if (responseTypeString.isEmpty())
        responseType = XMLHttpRequest::ResponseType::Empty;
    else if (responseTypeString == "arraybuffer"_s)
        responseType = XMLHttpRequest::ResponseType::ArrayBuffer;
    else if (responseTypeString == "blob"_s)
        responseType = XMLHttpRequest::ResponseType::Blob;
    else if (responseTypeString == "document"_s)
        responseType = XMLHttpRequest::ResponseType::Document;
    else if (responseTypeString == "json"_s)
        responseType = XMLHttpRequest::ResponseType::JSON;
    else if (responseTypeString == "text"_s)
        responseType = XMLHttpRequest::ResponseType::Text;
    else
        return false; // Invalid value, ignore
    
    auto result = impl.setResponseType(responseType);
    if (result.hasException()) {
        propagateException(*lexicalGlobalObject, throwScope, result.releaseException());
        return false;
    }
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_timeout, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    auto& impl = thisObject->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsNumber(impl.timeout())));
}

JSC_DEFINE_CUSTOM_SETTER(setJSXMLHttpRequest_timeout, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;
    auto& impl = thisObject->wrapped();
    
    auto timeout = convert<IDLUnsignedLong>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    
    auto result = impl.setTimeout(timeout);
    if (result.hasException()) {
        propagateException(*lexicalGlobalObject, throwScope, result.releaseException());
        return false;
    }
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_withCredentials, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    auto& impl = thisObject->wrapped();
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsBoolean(impl.withCredentials())));
}

JSC_DEFINE_CUSTOM_SETTER(setJSXMLHttpRequest_withCredentials, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;
    auto& impl = thisObject->wrapped();
    
    auto withCredentials = convert<IDLBoolean>(*lexicalGlobalObject, JSValue::decode(encodedValue));
    RETURN_IF_EXCEPTION(throwScope, false);
    
    auto result = impl.setWithCredentials(withCredentials);
    if (result.hasException()) {
        propagateException(*lexicalGlobalObject, throwScope, result.releaseException());
        return false;
    }
    return true;
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_upload, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    // TODO: Return proper JSXMLHttpRequestUpload object
    RELEASE_AND_RETURN(throwScope, JSValue::encode(jsNull()));
}

JSC_DEFINE_CUSTOM_GETTER(jsXMLHttpRequest_onreadystatechange, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, PropertyName))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return JSValue::encode(jsUndefined());
    return JSValue::encode(eventHandlerAttribute(thisObject->wrapped(), eventNames().readystatechangeEvent, worldForDOMObject(*thisObject)));
}

JSC_DEFINE_CUSTOM_SETTER(setJSXMLHttpRequest_onreadystatechange, (JSGlobalObject* lexicalGlobalObject, EncodedJSValue thisValue, EncodedJSValue encodedValue, PropertyName))
{
    auto* thisObject = jsDynamicCast<JSXMLHttpRequest*>(JSValue::decode(thisValue));
    if (!thisObject)
        return false;
    
    setEventHandlerAttribute<JSEventListener>(thisObject->wrapped(), eventNames().readystatechangeEvent, JSValue::decode(encodedValue), *thisObject);
    return true;
}

// Function implementations
JSC_DEFINE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_open, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = IDLOperation<JSXMLHttpRequest>::cast(*lexicalGlobalObject, *callFrame);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    return jsXMLHttpRequestPrototypeFunction_openBody(lexicalGlobalObject, callFrame, castedThis);
}

static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_openBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();
    
    if (callFrame->argumentCount() < 2) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }
    
    auto method = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    
    auto url = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(1));
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    
    if (callFrame->argumentCount() == 2) {
        auto result = impl.open(method, url);
        if (result.hasException()) {
            propagateException(*lexicalGlobalObject, throwScope, result.releaseException());
            return JSValue::encode(jsUndefined());
        }
    } else {
        auto async = convert<IDLBoolean>(*lexicalGlobalObject, callFrame->argument(2));
        RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
        
        auto user = callFrame->argumentCount() > 3 ? convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(3)) : String();
        RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
        
        auto password = callFrame->argumentCount() > 4 ? convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(4)) : String();
        RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
        
        auto result = impl.open(method, url, async, user, password);
        if (result.hasException()) {
            propagateException(*lexicalGlobalObject, throwScope, result.releaseException());
            return JSValue::encode(jsUndefined());
        }
    }
    
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_setRequestHeader, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = IDLOperation<JSXMLHttpRequest>::cast(*lexicalGlobalObject, *callFrame);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    return jsXMLHttpRequestPrototypeFunction_setRequestHeaderBody(lexicalGlobalObject, callFrame, castedThis);
}

static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_setRequestHeaderBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();
    
    if (callFrame->argumentCount() < 2) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }
    
    auto header = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    
    auto value = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(1));
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    
    auto result = impl.setRequestHeader(header, value);
    if (result.hasException()) {
        propagateException(*lexicalGlobalObject, throwScope, result.releaseException());
        return JSValue::encode(jsUndefined());
    }
    
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_send, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = IDLOperation<JSXMLHttpRequest>::cast(*lexicalGlobalObject, *callFrame);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    return jsXMLHttpRequestPrototypeFunction_sendBody(lexicalGlobalObject, callFrame, castedThis);
}

static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_sendBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();
    
    ExceptionOr<void> result;
    
    if (callFrame->argumentCount() == 0) {
        result = impl.send();
    } else {
        auto bodyValue = callFrame->uncheckedArgument(0);
        
        // Try different body types
        if (bodyValue.isString()) {
            auto body = convert<IDLDOMString>(*lexicalGlobalObject, bodyValue);
            RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
            result = impl.send(body);
        } else if (auto* arrayBuffer = jsDynamicCast<JSArrayBuffer*>(bodyValue)) {
            result = impl.send(arrayBuffer->impl());
        } else if (auto* arrayBufferView = jsDynamicCast<JSArrayBufferView*>(bodyValue)) {
            result = impl.send(arrayBufferView->unsharedImpl());
        // TODO: Enable once JSBlob, JSDOMFormData, JSURLSearchParams are available
        // } else if (auto* blob = jsDynamicCast<JSBlob*>(bodyValue)) {
        //     result = impl.send(&blob->wrapped());
        // } else if (auto* formData = jsDynamicCast<JSDOMFormData*>(bodyValue)) {
        //     result = impl.send(&formData->wrapped());
        // } else if (auto* urlSearchParams = jsDynamicCast<JSURLSearchParams*>(bodyValue)) {
        //     result = impl.send(&urlSearchParams->wrapped());
        } else {
            // Default to empty send
            result = impl.send();
        }
    }
    
    if (result.hasException()) {
        propagateException(*lexicalGlobalObject, throwScope, result.releaseException());
        return JSValue::encode(jsUndefined());
    }
    
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_abort, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = IDLOperation<JSXMLHttpRequest>::cast(*lexicalGlobalObject, *callFrame);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    return jsXMLHttpRequestPrototypeFunction_abortBody(lexicalGlobalObject, callFrame, castedThis);
}

static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_abortBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();
    
    impl.abort();
    
    return JSValue::encode(jsUndefined());
}

JSC_DEFINE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_getResponseHeader, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = IDLOperation<JSXMLHttpRequest>::cast(*lexicalGlobalObject, *callFrame);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    return jsXMLHttpRequestPrototypeFunction_getResponseHeaderBody(lexicalGlobalObject, callFrame, castedThis);
}

static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_getResponseHeaderBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();
    
    if (callFrame->argumentCount() < 1) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }
    
    auto name = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    
    auto result = impl.getResponseHeader(name);
    
    return JSValue::encode(result.isNull() ? jsNull() : jsStringWithCache(vm, result));
}

JSC_DEFINE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_getAllResponseHeaders, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = IDLOperation<JSXMLHttpRequest>::cast(*lexicalGlobalObject, *callFrame);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    return jsXMLHttpRequestPrototypeFunction_getAllResponseHeadersBody(lexicalGlobalObject, callFrame, castedThis);
}

static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_getAllResponseHeadersBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();
    
    auto result = impl.getAllResponseHeaders();
    
    return JSValue::encode(jsStringWithCache(vm, result));
}

JSC_DEFINE_HOST_FUNCTION(jsXMLHttpRequestPrototypeFunction_overrideMimeType, (JSGlobalObject* lexicalGlobalObject, CallFrame* callFrame))
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto* castedThis = IDLOperation<JSXMLHttpRequest>::cast(*lexicalGlobalObject, *callFrame);
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    return jsXMLHttpRequestPrototypeFunction_overrideMimeTypeBody(lexicalGlobalObject, callFrame, castedThis);
}

static inline JSC::EncodedJSValue jsXMLHttpRequestPrototypeFunction_overrideMimeTypeBody(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame, typename IDLOperation<JSXMLHttpRequest>::ClassParameter castedThis)
{
    auto& vm = JSC::getVM(lexicalGlobalObject);
    auto throwScope = DECLARE_THROW_SCOPE(vm);
    auto& impl = castedThis->wrapped();
    
    if (callFrame->argumentCount() < 1) {
        throwVMError(lexicalGlobalObject, throwScope, createNotEnoughArgumentsError(lexicalGlobalObject));
        return JSValue::encode(jsUndefined());
    }
    
    auto mime = convert<IDLDOMString>(*lexicalGlobalObject, callFrame->uncheckedArgument(0));
    RETURN_IF_EXCEPTION(throwScope, encodedJSValue());
    
    auto result = impl.overrideMimeType(mime);
    if (result.hasException()) {
        propagateException(*lexicalGlobalObject, throwScope, result.releaseException());
        return JSValue::encode(jsUndefined());
    }
    
    return JSValue::encode(jsUndefined());
}

// Subspace implementation
JSC::GCClient::IsoSubspace* JSXMLHttpRequest::subspaceForImpl(VM& vm)
{
    return WebCore::subspaceForImpl<JSXMLHttpRequest, UseCustomHeapCellType::No>(
        vm,
        [](auto& spaces) { return spaces.m_clientSubspaceForXMLHttpRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_clientSubspaceForXMLHttpRequest = std::forward<decltype(space)>(space); },
        [](auto& spaces) { return spaces.m_subspaceForXMLHttpRequest.get(); },
        [](auto& spaces, auto&& space) { spaces.m_subspaceForXMLHttpRequest = std::forward<decltype(space)>(space); }
    );
}

size_t JSXMLHttpRequest::estimatedSize(JSCell* cell, VM& vm)
{
    auto* thisObject = jsCast<JSXMLHttpRequest*>(cell);
    return Base::estimatedSize(thisObject, vm) + thisObject->wrapped().memoryCost();
}

XMLHttpRequest* JSXMLHttpRequest::toWrapped(VM& vm, JSValue value)
{
    if (auto* wrapper = jsDynamicCast<JSXMLHttpRequest*>(value))
        return &wrapper->wrapped();
    return nullptr;
}

// Owner implementation
bool JSXMLHttpRequestOwner::isReachableFromOpaqueRoots(JSC::Handle<JSC::Unknown> handle, void*, AbstractSlotVisitor& visitor, ASCIILiteral* reason)
{
    auto* thisObject = jsCast<JSXMLHttpRequest*>(handle.slot()->asCell());
    if (thisObject->wrapped().hasPendingActivity()) {
        if (reason)
            *reason = "XMLHttpRequest has pending activity"_s;
        return true;
    }
    return false;
}

void JSXMLHttpRequestOwner::finalize(JSC::Handle<JSC::Unknown> handle, void* context)
{
    auto* thisObject = static_cast<JSXMLHttpRequest*>(handle.slot()->asCell());
    auto& world = *static_cast<DOMWrapperWorld*>(context);
    uncacheWrapper(world, &thisObject->wrapped(), thisObject);
}

JSC::JSValue toJS(JSC::JSGlobalObject* lexicalGlobalObject, JSDOMGlobalObject* globalObject, XMLHttpRequest& impl)
{
    return wrap(lexicalGlobalObject, globalObject, impl);
}

JSC::JSValue toJSNewlyCreated(JSC::JSGlobalObject*, JSDOMGlobalObject* globalObject, Ref<XMLHttpRequest>&& impl)
{
    return createWrapper<XMLHttpRequest>(globalObject, WTFMove(impl));
}

template<> JSC::EncodedJSValue JSC_HOST_CALL_ATTRIBUTES JSXMLHttpRequestDOMConstructor::construct(JSC::JSGlobalObject* lexicalGlobalObject, JSC::CallFrame* callFrame)
{
    return constructJSXMLHttpRequest(lexicalGlobalObject, callFrame);
}

template<> JSC::JSValue JSXMLHttpRequestDOMConstructor::prototypeForStructure(JSC::VM& vm, const JSDOMGlobalObject& globalObject)
{
    return JSEventTarget::getConstructor(vm, &globalObject);
}

template<> void JSXMLHttpRequestDOMConstructor::initializeProperties(VM& vm, JSDOMGlobalObject& globalObject)
{
    putDirect(vm, vm.propertyNames->length, jsNumber(0), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    JSString* nameString = jsNontrivialString(vm, "XMLHttpRequest"_s);
    m_originalName.set(vm, this, nameString);
    putDirect(vm, vm.propertyNames->name, nameString, JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum);
    putDirect(vm, vm.propertyNames->prototype, JSXMLHttpRequest::prototype(vm, globalObject), JSC::PropertyAttribute::ReadOnly | JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete);
    reifyStaticProperties(vm, JSXMLHttpRequest::info(), JSXMLHttpRequestConstructorTableValues, *this);
}

JSC::JSValue getXMLHttpRequestConstructor(Zig::GlobalObject* globalObject)
{
    return JSXMLHttpRequest::getConstructor(globalObject->vm(), globalObject);
}

} // namespace WebCore