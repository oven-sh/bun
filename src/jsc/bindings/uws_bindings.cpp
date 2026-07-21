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

// Topic names are keyed as WTF-8 (see ServerWebSocket.rs), which encodes
// unpaired surrogates as 3-byte sequences. Decode losslessly so
// `ws.subscriptions` round-trips the original JS string.
static WTF::String topicBytesToString(std::string_view topic) {
  const unsigned char* p = reinterpret_cast<const unsigned char*>(topic.data());
  const size_t n = topic.length();
  bool allASCII = true;
  for (size_t i = 0; i < n; i++) {
    if (p[i] >= 0x80) { allASCII = false; break; }
  }
  if (allASCII) {
    return WTF::String(std::span { p, n });
  }
  WTF::Vector<char16_t> out;
  out.reserveInitialCapacity(n);
  size_t i = 0;
  while (i < n) {
    unsigned char b0 = p[i];
    if (b0 < 0x80) {
      out.append(static_cast<char16_t>(b0));
      i += 1;
    } else if ((b0 & 0xE0) == 0xC0 && i + 1 < n) {
      uint32_t cp = (static_cast<uint32_t>(b0 & 0x1F) << 6)
                  | static_cast<uint32_t>(p[i + 1] & 0x3F);
      out.append(static_cast<char16_t>(cp));
      i += 2;
    } else if ((b0 & 0xF0) == 0xE0 && i + 2 < n) {
      uint32_t cp = (static_cast<uint32_t>(b0 & 0x0F) << 12)
                  | (static_cast<uint32_t>(p[i + 1] & 0x3F) << 6)
                  | static_cast<uint32_t>(p[i + 2] & 0x3F);
      out.append(static_cast<char16_t>(cp));
      i += 3;
    } else if ((b0 & 0xF8) == 0xF0 && i + 3 < n) {
      uint32_t cp = (static_cast<uint32_t>(b0 & 0x07) << 18)
                  | (static_cast<uint32_t>(p[i + 1] & 0x3F) << 12)
                  | (static_cast<uint32_t>(p[i + 2] & 0x3F) << 6)
                  | static_cast<uint32_t>(p[i + 3] & 0x3F);
      cp -= 0x10000;
      out.append(static_cast<char16_t>(0xD800 | (cp >> 10)));
      out.append(static_cast<char16_t>(0xDC00 | (cp & 0x3FF)));
      i += 4;
    } else {
      out.append(static_cast<char16_t>(0xFFFD));
      i += 1;
    }
  }
  return WTF::String::adopt(std::move(out));
}

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
      args.append(JSC::jsString(vm, topicBytesToString(topic)));
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
