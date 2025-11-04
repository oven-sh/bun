// clang-format off
#include "root.h"

#include "JavaScriptCore/JSGlobalObject.h"
#include "JavaScriptCore/JSArray.h"
#include "JavaScriptCore/ObjectConstructor.h"
#include "wtf/text/WTFString.h"
#include <bun-uws/src/App.h>
#include <span>
#include <string_view>

typedef void uws_websocket_t;

using TLSWebSocket = uWS::WebSocket<true, true, void *>;
using TCPWebSocket = uWS::WebSocket<false, true, void *>;

// Template helpers (must be outside extern "C")
template<bool isSSL>
static JSC::EncodedJSValue uws_ws_get_topics_as_js_array_impl(uws_websocket_t *ws, void* globalObject) {
  JSC::JSGlobalObject* global = reinterpret_cast<JSC::JSGlobalObject*>(globalObject);
  JSC::VM& vm = global->vm();

  using WebSocketType = typename std::conditional<isSSL, TLSWebSocket, TCPWebSocket>::type;
  WebSocketType *uws = reinterpret_cast<WebSocketType*>(ws);

  JSC::MarkedArgumentBuffer args;
  {
    // Scope ensures the iterator lock is released before constructArray
    uws->iterateTopics([&](std::string_view topic) {
      auto str = WTF::String::fromUTF8ReplacingInvalidSequences(std::span {
        reinterpret_cast<const unsigned char*>(topic.data()),
        topic.length()
      });
      args.append(JSC::jsString(vm, str));
    });
  }

  return JSC::JSValue::encode(JSC::constructArray(global, static_cast<JSC::ArrayAllocationProfile*>(nullptr), args));
}

extern "C" JSC::EncodedJSValue uws_ws_get_topics_as_js_array(int ssl, uws_websocket_t *ws, void* globalObject) {
  if (ssl) {
    return uws_ws_get_topics_as_js_array_impl<true>(ws, globalObject);
  } else {
    return uws_ws_get_topics_as_js_array_impl<false>(ws, globalObject);
  }
}
