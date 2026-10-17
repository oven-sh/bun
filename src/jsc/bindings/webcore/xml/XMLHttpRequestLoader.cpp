#include "config.h"
#include "XMLHttpRequestLoader.h"

#include "AbortSignal.h"
#include "ContextDestructionObserverInlines.h"
#include "DOMFormData.h"
#include "Document.h"
#include "FetchHeaders.h"
#include "HTTPParsers.h"
#include "JSAbortSignal.h"
#include "JSDOMGlobalObject.h"
#include "JSDOMPromise.h"
#include "JSFetchHeaders.h"
#include "JSReadRequest.h"
#include "JSReadableStream.h"
#include "JSReadableStreamDefaultReader.h"
#include "JSStreamsRuntime.h"
#include "ScriptExecutionContext.h"
#include "WebStreamsInternals.h"
#include "XMLHttpRequest.h"
#include <JavaScriptCore/JSArrayBuffer.h>
#include <JavaScriptCore/JSArrayBufferView.h>
#include <JavaScriptCore/JSCInlines.h>
#include <JavaScriptCore/JSPromise.h>
#include <JavaScriptCore/ObjectConstructor.h>
#include <JavaScriptCore/TopExceptionScope.h>
#include <wtf/text/StringToIntegerConversion.h>

// `fetch` and the getters of `Response.prototype` and `Blob.prototype` themselves, which script cannot replace.
BUN_DECLARE_HOST_FUNCTION(Bun__fetch);
extern "C" SYSV_ABI void* Response__fromJS(JSC::EncodedJSValue);
extern "C" SYSV_ABI JSC::EncodedJSValue ResponsePrototype__getStatus(void* response, JSC::JSGlobalObject*);
extern "C" SYSV_ABI JSC::EncodedJSValue ResponsePrototype__getStatusText(void* response, JSC::JSGlobalObject*);
extern "C" SYSV_ABI JSC::EncodedJSValue ResponsePrototype__getURL(void* response, JSC::JSGlobalObject*);
extern "C" SYSV_ABI JSC::EncodedJSValue ResponsePrototype__getHeaders(void* response, JSC::JSGlobalObject*);
extern "C" SYSV_ABI JSC::EncodedJSValue ResponsePrototype__getBody(void* response, JSC::JSGlobalObject*);
extern "C" SYSV_ABI JSC::EncodedJSValue BlobPrototype__getType(void* blob, JSC::JSGlobalObject*);

// The wrapper takes over the caller's reference to the blob.
extern "C" SYSV_ABI JSC::EncodedJSValue Blob__create(JSC::JSGlobalObject*, void* blob);
extern "C" void* Blob__fromBytesWithType(JSC::JSGlobalObject*, const uint8_t* bytes, size_t length, const char* type);
extern "C" void* Blob__fromDOMFormData(JSC::JSGlobalObject*, WebCore::DOMFormData*);
extern "C" uint64_t Bun__Blob__getSizeForBindings(void* blob);

namespace WebCore {

using namespace JSC;

static BlobRefPtr adoptBlob(void* blob)
{
    return adoptRef<BlobImpl, RawPtrTraits<BlobImpl>, BlobImplRefDerefTraits>(static_cast<BlobImpl*>(blob));
}

BlobRefPtr XMLHttpRequestLoader::createBlob(ScriptExecutionContext& context, std::span<const uint8_t> bytes, const String& type)
{
    return adoptBlob(Blob__fromBytesWithType(context.globalObject(), bytes.data(), bytes.size(), byteCast<char>(type.utf8().data())));
}

BlobRefPtr XMLHttpRequestLoader::createMultiPartBlob(ScriptExecutionContext& context, DOMFormData& formData)
{
    auto* globalObject = context.globalObject();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    auto blob = adoptBlob(Blob__fromDOMFormData(globalObject, &formData));
    if (!scope.exception())
        return blob;
    (void)scope.tryClearException();
    return nullptr;
}

String XMLHttpRequestLoader::blobType(ScriptExecutionContext& context, BlobImpl& blob)
{
    auto* globalObject = context.globalObject();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject->vm());
    auto type = JSValue::decode(BlobPrototype__getType(&blob, globalObject));
    auto string = scope.exception() ? String() : type.getString(globalObject);
    (void)scope.tryClearException();
    return string;
}

unsigned long long XMLHttpRequestLoader::blobLength(BlobImpl& blob)
{
    // All bits are set for a file whose size cannot be told.
    auto length = Bun__Blob__getSizeForBindings(&blob);
    return length == std::numeric_limits<uint64_t>::max() ? 0 : length;
}

XMLHttpRequestLoader::Response::Response(URL&& url, int statusCode, String&& statusText, HTTPHeaderMap&& headers)
    : m_url(WTF::move(url))
    , m_httpStatusCode(statusCode)
    , m_httpStatusText(WTF::move(statusText))
    , m_httpHeaderFields(WTF::move(headers))
    , m_textEncodingName(extractCharsetFromMediaType(m_httpHeaderFields.get(HTTPHeaderName::ContentType)).toString())
{
    // https://fetch.spec.whatwg.org/#forbidden-response-header-name
    m_httpHeaderFields.getSetCookieHeaders().clear();
    m_httpHeaderFields.remove(HTTPHeaderName::SetCookie2);

    // fetch() has undone the content encoding, and the length is that of the encoded bytes.
    if (m_httpHeaderFields.contains(HTTPHeaderName::ContentEncoding))
        return;
    if (auto length = parseInteger<long long>(m_httpHeaderFields.get(HTTPHeaderName::ContentLength)))
        m_expectedContentLength = *length;
}

RefPtr<XMLHttpRequestLoader> XMLHttpRequestLoader::create(XMLHttpRequest& client, Request&& request)
{
    Ref loader = adoptRef(*new XMLHttpRequestLoader(client));
    if (loader->start(WTF::move(request)))
        return loader;
    loader->releaseClient();
    client.didFail();
    return nullptr;
}

XMLHttpRequestLoader::XMLHttpRequestLoader(XMLHttpRequest& client)
    : m_client(client)
{
}

XMLHttpRequestLoader::~XMLHttpRequestLoader()
{
    ASSERT(!m_contextWithEventLoopRef);
}

bool XMLHttpRequestLoader::start(Request&& request)
{
    RefPtr context = m_client->scriptExecutionContext();
    if (!context || context->isStopped())
        return false;
    RefPtr window = m_client->document() ? m_client->document()->window() : nullptr;
    if (m_client->document() && (!window || window->closed()))
        return false;

    auto* globalObject = uncheckedDowncast<JSDOMGlobalObject>(context->globalObject());
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    m_signal = AbortSignal::create(context.get());
    if (request.body)
        m_bodyLength = blobLength(*request.body);

    // It has no prototype, so that what a script adds to Object.prototype is not taken for an option.
    auto* init = constructEmptyObject(vm, globalObject->nullPrototypeObjectStructure());
    auto put = [&](ASCIILiteral name, JSValue value) {
        if (!scope.exception())
            init->putDirect(vm, Identifier::fromString(vm, name), value);
    };
    put("method"_s, jsString(vm, request.method));
    put("headers"_s, toJSNewlyCreated(globalObject, globalObject, FetchHeaders::create(FetchHeaders::Guard::None, WTF::move(request.headers))));
    if (request.body)
        put("body"_s, JSValue::decode(Blob__create(globalObject, request.body.leakRef())));
    put("signal"_s, toJS(globalObject, globalObject, *m_signal));
    // Only XMLHttpRequest's own timer ends a request.
    put("timeout"_s, jsBoolean(false));
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return false;
    }

    MarkedArgumentBuffer arguments;
    arguments.append(jsString(vm, request.url.string()));
    arguments.append(init);
    auto* fetch = JSFunction::create(vm, globalObject, 2, "fetch"_s, Bun__fetch, ImplementationVisibility::Private);
    auto* promise = dynamicDowncast<JSPromise>(call(globalObject, fetch, jsUndefined(), arguments, "fetch is not a function"_s));
    if (scope.exception() || !promise) [[unlikely]] {
        (void)scope.tryClearException();
        return false;
    }

    context->refEventLoop();
    m_contextWithEventLoopRef = context;
    if (window) {
        m_pendingTask.emplace(window.get());
        window->loadingRequests().add(*m_client);
    }

    whenSettled(*globalObject, *promise, &XMLHttpRequestLoader::didSettleFetch);
    return true;
}

// Events are fired from tasks, and a promise's reaction is a microtask.
void XMLHttpRequestLoader::whenSettled(JSDOMGlobalObject& globalObject, JSPromise& promise, void (XMLHttpRequestLoader::*function)(JSDOMGlobalObject&, JSPromise&))
{
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(globalObject.vm());
    DOMPromise::whenPromiseIsSettled(&globalObject, &promise, [protectedThis = Ref { *this }, promise = DOMPromise::create(globalObject, promise), function]() mutable {
        RefPtr client = protectedThis->m_client.get();
        if (!client)
            return;
        auto task = [protectedThis = WTF::move(protectedThis), promise = WTF::move(promise), function] {
            if (auto* globalObject = promise->globalObject(); globalObject && protectedThis->m_client)
                (protectedThis.get().*function)(*globalObject, *promise->promise());
        };
        if (RefPtr document = client->document())
            document->queueTask(TaskSource::Networking, WTF::move(task));
        else if (RefPtr context = client->scriptExecutionContext()) {
            context->postTask([task = WTF::move(task)](ScriptExecutionContext&) {
                task();
            });
        }
    });
    (void)scope.tryClearException();
}

void XMLHttpRequestLoader::didSettleFetch(JSDOMGlobalObject& globalObject, JSPromise& promise)
{
    auto& vm = globalObject.vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    void* response = promise.status() == JSPromise::Status::Fulfilled ? Response__fromJS(JSValue::encode(promise.result())) : nullptr;
    if (!response)
        return fail();

    auto get = [&](auto getter) {
        auto value = scope.exception() ? JSValue() : JSValue::decode(getter(response, &globalObject));
        return scope.exception() ? JSValue() : value;
    };
    auto getString = [&](auto getter) {
        auto value = get(getter);
        auto string = value ? value.getString(&globalObject) : String();
        return scope.exception() ? String() : string;
    };
    JSValue status = get(ResponsePrototype__getStatus);
    String statusText = getString(ResponsePrototype__getStatusText);
    URL url { getString(ResponsePrototype__getURL) };
    HTTPHeaderMap headers;
    if (auto* wrapper = dynamicDowncast<JSFetchHeaders>(get(ResponsePrototype__getHeaders)))
        headers = wrapper->wrapped().internalHeaders();
    if (auto* stream = dynamicDowncast<JSReadableStream>(get(ResponsePrototype__getBody))) {
        stream->materializeIfNeeded(&globalObject);
        auto* reader = scope.exception() ? nullptr : Bun::WebStreams::acquireReadableStreamDefaultReader(&globalObject, stream);
        if (!scope.exception())
            m_reader.set(vm, reader);
    }
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return fail();
    }

    // A listener may call abort() or open(), and both cancel this loader.
    Ref protectedThis { *this };
    RefPtr client = m_client.get();
    // fetch() does not say how much of the body it has sent. With the response here, it has sent all of it.
    if (m_bodyLength)
        client->didSendData(*m_bodyLength, *m_bodyLength);
    if (!m_client)
        return;
    client->didReceiveResponse({ WTF::move(url), static_cast<int>(status.asNumber()), WTF::move(statusText), WTF::move(headers) });
    // Without data this only changes the state to HEADERS_RECEIVED, which upstream puts off until there is data.
    client->didReceiveData({ });
    if (!m_client)
        return;

    if (m_reader)
        read(globalObject);
    else
        finish();
}

void XMLHttpRequestLoader::read(JSDOMGlobalObject& globalObject)
{
    auto& vm = globalObject.vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);

    // What `reader.read()` does.
    auto* promise = JSPromise::create(vm, globalObject.promiseStructure());
    auto* request = JSReadRequest::create(vm, JSStreamsRuntime::from(&globalObject)->readRequestStructure(&globalObject), Bun::WebStreams::ReadRequestKind::Promise, promise);
    Bun::WebStreams::readableStreamDefaultReaderRead(&globalObject, uncheckedDowncast<JSReadableStreamDefaultReader>(m_reader.get()), request);
    if (scope.exception()) [[unlikely]] {
        (void)scope.tryClearException();
        return fail();
    }
    whenSettled(globalObject, *promise, &XMLHttpRequestLoader::didSettleRead);
}

void XMLHttpRequestLoader::didSettleRead(JSDOMGlobalObject& globalObject, JSPromise& promise)
{
    auto& vm = globalObject.vm();
    auto* result = promise.status() == JSPromise::Status::Fulfilled ? promise.result().getObject() : nullptr;
    if (!result)
        return fail();
    if (result->getDirect(vm, vm.propertyNames->done).isTrue())
        return finish();

    Ref protectedThis { *this };
    JSValue chunk = result->getDirect(vm, vm.propertyNames->value);
    EnsureStillAliveScope keepChunk { chunk };
    if (auto* view = dynamicDowncast<JSArrayBufferView>(chunk))
        protect(m_client)->didReceiveData(view->span());
    else if (auto* buffer = dynamicDowncast<JSArrayBuffer>(chunk))
        protect(m_client)->didReceiveData(buffer->impl()->span());
    if (m_client)
        read(globalObject);
}

void XMLHttpRequestLoader::finish()
{
    if (RefPtr client = releaseClient())
        client->didFinishLoading();
}

void XMLHttpRequestLoader::fail()
{
    if (RefPtr client = releaseClient())
        client->didFail();
}

// From here on the loader holds on to nothing.
RefPtr<XMLHttpRequest> XMLHttpRequestLoader::releaseClient()
{
    RefPtr client = std::exchange(m_client, nullptr).get();
    if (auto* window = client && client->document() ? client->document()->window() : nullptr)
        window->loadingRequests().remove(*client);
    if (RefPtr context = std::exchange(m_contextWithEventLoopRef, nullptr))
        context->unrefEventLoop();
    m_pendingTask.reset();
    m_signal = nullptr;
    m_reader.clear();
    return client;
}

void XMLHttpRequestLoader::cancel()
{
    Ref protectedThis { *this };
    RefPtr signal = m_signal;
    RefPtr context = m_contextWithEventLoopRef;
    auto* reader = uncheckedDowncast<JSReadableStreamDefaultReader>(m_reader.get());
    EnsureStillAliveScope keepReader { reader };
    releaseClient();

    auto* globalObject = context ? context->globalObject() : nullptr;
    if (!globalObject)
        return;
    auto& vm = globalObject->vm();
    auto scope = DECLARE_TOP_EXCEPTION_SCOPE(vm);
    signal->signalAbort(globalObject, CommonAbortReason::UserAbort);
    // The signal means nothing to the stream of a `blob:`, `data:` or `file:` URL.
    if (reader && !scope.exception()) {
        if (auto* promise = Bun::WebStreams::readableStreamReaderGenericCancel(globalObject, reader, jsUndefined()))
            promise->markAsHandled();
    }
    (void)scope.tryClearException();
}

} // namespace WebCore
