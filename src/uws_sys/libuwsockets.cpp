// clang-format off
#include "_libusockets.h"
#include "libusockets.h"
#include <bun-uws/src/App.h>
#include <bun-uws/src/AsyncSocket.h>
#include <bun-usockets/src/internal/internal.h>
#include <string_view>
#include <type_traits>

extern "C" const char* ares_inet_ntop(int af, const char *src, char *dst, size_t size);

#define uws_res_r uws_res_t* nonnull_arg
static inline std::string_view stringViewFromC(const char* message, size_t length) {
  if(length) {
    return std::string_view(message, length);
  }

  return std::string_view();

}
using TLSWebSocket = uWS::WebSocket<true, true, void *>;
using TCPWebSocket = uWS::WebSocket<false, true, void *>;

// 4-way dispatch on (ssl, node_http) into the matching HttpResponse<SSL,
// NODE_HTTP> instantiation. NODE_HTTP compiles the node:http compat state
// (nodeCompat) in/out of HttpResponseData; the wrong instantiation reads a
// different ext-data layout, so every uws_res_* wrapper must dispatch on both
// flags. Generic-lambda body sees `auto* uwsRes` typed correctly.
template<typename F>
static inline auto uws_res_dispatch(int ssl, int node_http, uws_res_t* res, F&& f) {
    if (ssl) {
        if (node_http) return f((uWS::HttpResponse<true, true>*)res);
        return f((uWS::HttpResponse<true, false>*)res);
    }
    if (node_http) return f((uWS::HttpResponse<false, true>*)res);
    return f((uWS::HttpResponse<false, false>*)res);
}

// Same 4-way dispatch for TemplatedApp<SSL, NODE_HTTP>.
template<typename F>
static inline auto uws_app_dispatch(int ssl, int node_http, uws_app_t* app, F&& f) {
    if (ssl) {
        if (node_http) return f((uWS::NodeHttpSSLApp*)app);
        return f((uWS::SSLApp*)app);
    }
    if (node_http) return f((uWS::NodeHttpApp*)app);
    return f((uWS::App*)app);
}

// node:http-only functions are only ever invoked against a NODE_HTTP=true
// app/response (their C++ impl is `if constexpr (NODE_HTTP)`), so they
// hardcode the second template arg and dispatch on ssl only.
template<typename F>
static inline auto uws_res_dispatch_node(int ssl, uws_res_t* res, F&& f) {
    if (ssl) return f((uWS::HttpResponse<true, true>*)res);
    return f((uWS::HttpResponse<false, true>*)res);
}

template<typename F>
static inline auto uws_app_dispatch_node(int ssl, uws_app_t* app, F&& f) {
    if (ssl) return f((uWS::NodeHttpSSLApp*)app);
    return f((uWS::NodeHttpApp*)app);
}

extern "C"
{

// Every function in this block is a thin C-ABI wrapper around a uWS template
// method, called from Rust. Force ThinLTO to import + inline the wrapper into
// every caller so the FFI boundary never costs an extra call frame; the
// underlying uWS method call is then visible to the caller's optimizer. The
// out-of-line definitions are still emitted for non-LTO builds.
#pragma clang attribute push(__attribute__((always_inline)), apply_to = function)

  void uws_loop_date_header_timer_update(us_loop_t *loop) {
    uWS::LoopData *loopData = uWS::Loop::data(loop);
    loopData->updateDate();
  }

  uws_app_t *uws_create_app(int ssl, struct us_bun_socket_context_options_t options)
  {
    uWS::SocketContextOptions socket_context_options;
    memcpy(&socket_context_options, &options,
           sizeof(uWS::SocketContextOptions));
    if (ssl)
    {
      return (uws_app_t *)uWS::SSLApp::create(socket_context_options);
    }

    return (uws_app_t *)uWS::App::create(socket_context_options);
  }

  // node:http compat instantiation (TemplatedApp<SSL, /*NODE_HTTP=*/true>).
  // Separate symbol so the Rust side selects at create time; the template
  // arg gates per-socket node-compat state.
  uws_app_t *uws_create_app_node_http(int ssl, struct us_bun_socket_context_options_t options)
  {
    uWS::SocketContextOptions socket_context_options;
    memcpy(&socket_context_options, &options,
           sizeof(uWS::SocketContextOptions));
    if (ssl)
    {
      return (uws_app_t *)uWS::NodeHttpSSLApp::create(socket_context_options);
    }

    return (uws_app_t *)uWS::NodeHttpApp::create(socket_context_options);
  }

  void uws_app_clear_routes(int ssl, int node_http, uws_app_t *app)
  {
    uws_app_dispatch(ssl, node_http, app, [](auto* uwsApp) { uwsApp->clearRoutes(); });
  }

  void uws_app_get(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->get(pattern, nullptr);
        return;
      }
      uwsApp->get(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }

  void uws_app_post(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->post(pattern, nullptr);
        return;
      }
      uwsApp->post(pattern, [handler, user_data](auto *res, auto *req)
                   { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }

  void uws_app_options(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->options(pattern, nullptr);
        return;
      }
      uwsApp->options(pattern, [handler, user_data](auto *res, auto *req)
                      { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }

  extern "C" void uws_res_clear_corked_socket(us_loop_t *loop) {
    uWS::LoopData *loopData = uWS::Loop::data(loop);
    /* Drain any leftover corks. Two slots max. */
    for (int i = 0; i < 2; i++) {
        bool ssl;
        void *corkedSocket = loopData->getAnyCorkedSocket(&ssl);
        if (!corkedSocket) break;
        if (ssl) {
            ((uWS::AsyncSocket<true> *) corkedSocket)->uncork();
        } else {
            ((uWS::AsyncSocket<false> *) corkedSocket)->uncork();
        }
    }
}

  void uws_app_delete(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->del(pattern, nullptr);
        return;
      }
      uwsApp->del(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }

  void uws_app_patch(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->patch(pattern, nullptr);
        return;
      }
      uwsApp->patch(pattern, [handler, user_data](auto *res, auto *req)
                    { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }

  void uws_app_put(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->put(pattern, nullptr);
        return;
      }
      uwsApp->put(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }

  void uws_app_head(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->head(pattern, nullptr);
        return;
      }
      uwsApp->head(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }
  void uws_app_connect(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->connect(pattern, nullptr);
        return;
      }
      uwsApp->connect(pattern, [handler, user_data](auto *res, auto *req)
                      { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }

  void uws_app_trace(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->trace(pattern, nullptr);
        return;
      }
      uwsApp->trace(pattern, [handler, user_data](auto *res, auto *req)
                    { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }

  size_t uws_res_get_buffered_amount(int ssl, int node_http, uws_res_t *res) nonnull_fn_decl;

  size_t uws_res_get_buffered_amount(int ssl, int node_http, uws_res_t *res)
  {
      return uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) -> size_t {
        return uwsRes->getBufferedAmount();
      });
  }

  void uws_app_any(int ssl, int node_http, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      if (handler == nullptr)
      {
        uwsApp->any(pattern, nullptr);
        return;
      }
      uwsApp->any(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    });
  }

  void uws_app_run(int ssl, int node_http, uws_app_t *app)
  {
    uws_app_dispatch(ssl, node_http, app, [](auto* uwsApp) { uwsApp->run(); });
  }

  void uws_app_close(int ssl, int node_http, uws_app_t *app)
  {
    uws_app_dispatch(ssl, node_http, app, [](auto* uwsApp) { uwsApp->close(); });
  }

  void uws_app_close_idle(int ssl, int node_http, uws_app_t *app)
  {
    uws_app_dispatch(ssl, node_http, app, [](auto* uwsApp) { uwsApp->closeIdle(); });
  }

  // node:http-only: onClientError is compiled out of HttpContextData<SSL, false>.
  void uws_app_set_on_clienterror(int ssl, uws_app_t *app, void (*handler)(void *user_data, int is_ssl, struct us_socket_t *rawSocket, uint8_t errorCode, char *rawPacket, int rawPacketLength), void *user_data)
  {
    uws_app_dispatch_node(ssl, app, [&](auto* uwsApp) {
      if (handler == nullptr) {
        uwsApp->setOnClientError(nullptr);
        return;
      }
      uwsApp->setOnClientError([handler, user_data](int is_ssl, struct us_socket_t *rawSocket, uint8_t errorCode, char *rawPacket, int rawPacketLength) {
        handler(user_data, is_ssl, rawSocket, errorCode, rawPacket, rawPacketLength);
      });
    });
  }

  void uws_app_listen(int ssl, int node_http, uws_app_t *app, int port,
                      uws_listen_handler handler, void *user_data)
  {
    uws_app_listen_config_t config;
    config.port = port;
    config.host = nullptr;
    config.options = 0;

    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      uwsApp->listen(port, [handler,
                            user_data](struct us_listen_socket_t *listen_socket)
                     { handler((struct us_listen_socket_t *)listen_socket, user_data); });
    });
  }

  void uws_app_listen_with_config(int ssl, int node_http, uws_app_t *app, const char *host,
                                  uint16_t port, int32_t options,
                                  uws_listen_handler handler, void *user_data)
  {
    std::string hostname = host && host[0] ? std::string(host, strlen(host)) : "";
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      uwsApp->listen(
          hostname, port, options,
          [handler, user_data](struct us_listen_socket_t *listen_socket)
          {
            handler((struct us_listen_socket_t *)listen_socket, user_data);
          });
    });
  }

  /* callback, path to unix domain socket */
  void uws_app_listen_domain(int ssl, int node_http, uws_app_t *app, const char *domain, size_t pathlen, uws_listen_domain_handler handler, void *user_data)
  {
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      uwsApp->listen(0,[handler, domain, user_data](struct us_listen_socket_t *listen_socket)
                     { handler((struct us_listen_socket_t *)listen_socket, domain, 0, user_data); },
                     {domain, pathlen});
    });
  }

  /* callback, path to unix domain socket */
  void uws_app_listen_domain_with_options(int ssl, int node_http, uws_app_t *app, const char *domain, size_t pathlen, int options, uws_listen_domain_handler handler, void *user_data)
  {
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      uwsApp->listen(
          options, [handler, domain, options, user_data](struct us_listen_socket_t *listen_socket)
          { handler((struct us_listen_socket_t *)listen_socket, domain, options, user_data); },
          {domain, pathlen});
    });
  }

  void uws_app_domain(int ssl, int node_http, uws_app_t *app, const char *server_name)
  {
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) { uwsApp->domain(server_name); });
  }
  void uws_app_set_max_http_header_size(int ssl, int node_http, uws_app_t *app, uint64_t max_header_size) {
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) { uwsApp->setMaxHTTPHeaderSize(max_header_size); });
  }
  void uws_app_set_flags(int ssl, int node_http, uws_app_t *app, bool require_host_header, bool use_strict_method_validation, bool use_insecure_http_parser, bool http_allow_half_open) {
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      uwsApp->setFlags(require_host_header, use_strict_method_validation, use_insecure_http_parser, http_allow_half_open);
    });
  }

  void uws_app_destroy(int ssl, uws_app_t *app)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      delete uwsApp;
    }
    else
    {

      uWS::App *uwsApp = (uWS::App *)app;
      delete uwsApp;
    }
  }

  void uws_app_destroy_node_http(int ssl, uws_app_t *app)
  {
    if (ssl)
    {
      delete (uWS::NodeHttpSSLApp *)app;
    }
    else
    {
      delete (uWS::NodeHttpApp *)app;
    }
  }

  bool uws_constructor_failed(int ssl, int node_http, uws_app_t *app)
  {
    return uws_app_dispatch(ssl, node_http, app, [](auto* uwsApp) -> bool {
      if (!uwsApp)
        return true;
      return uwsApp->constructorFailed();
    });
  }

  unsigned int uws_num_subscribers(int ssl, int node_http, uws_app_t *app, const char *topic, size_t topic_length)
  {
    return uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) -> unsigned int {
      return uwsApp->numSubscribers(stringViewFromC(topic, topic_length));
    });
  }
  uws_sendstatus_t uws_publish(int ssl, int node_http, uws_app_t *app, const char *topic,
                               size_t topic_length, const char *message,
                               size_t message_length, uws_opcode_t opcode, bool compress)
  {
    return uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) -> uws_sendstatus_t {
      return (uws_sendstatus_t)uwsApp->publish(stringViewFromC(topic, topic_length),
                                               stringViewFromC(message, message_length),
                                               (uWS::OpCode)(unsigned char)opcode, compress);
    });
  }
  void *uws_get_native_handle(int ssl, int node_http, uws_app_t *app)
  {
    return uws_app_dispatch(ssl, node_http, app, [](auto* uwsApp) -> void* { return uwsApp->getNativeHandle(); });
  }
  void uws_remove_server_name(int ssl, int node_http, uws_app_t *app,
                              const char *hostname_pattern)
  {
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) { uwsApp->removeServerName(hostname_pattern); });
  }
  void uws_add_server_name(int ssl, int node_http, uws_app_t *app,
                           const char *hostname_pattern)
  {
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) { uwsApp->addServerName(hostname_pattern); });
  }
  int uws_add_server_name_with_options(
      int ssl, int node_http, uws_app_t *app, const char *hostname_pattern,
      struct us_bun_socket_context_options_t options)
  {
    uWS::SocketContextOptions sco;
    memcpy(&sco, &options, sizeof(uWS::SocketContextOptions));
    bool success = false;

    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      uwsApp->addServerName(hostname_pattern, sco, &success);
    });
    return !success;
  }

  void uws_missing_server_name(int ssl, int node_http, uws_app_t *app,
                               uws_missing_server_handler handler,
                               void *user_data)
  {
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      uwsApp->missingServerName(
          [handler, user_data](auto hostname)
          { handler(hostname, user_data); });
    });
  }
  void uws_filter(int ssl, int node_http, uws_app_t *app, uws_filter_handler handler,
                  void *user_data)
  {
    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      uwsApp->filter([handler, user_data](auto res, auto i)
                     { handler((uws_res_t *)res, i, user_data); });
    });
  }

  void uws_ws(int ssl, int node_http, uws_app_t *app, void *upgradeContext, const char *pattern,
              size_t pattern_length, size_t id,
              const uws_socket_behavior_t *behavior_)
  {
    uws_socket_behavior_t behavior = *behavior_;

    uws_app_dispatch(ssl, node_http, app, [&](auto* uwsApp) {
      using AppT = std::remove_pointer_t<decltype(uwsApp)>;
      auto generic_handler = typename AppT::template WebSocketBehavior<void *>{
          .compression = (uWS::CompressOptions)(uint64_t)behavior.compression,
          .maxPayloadLength = behavior.maxPayloadLength,
          .idleTimeout = behavior.idleTimeout,
          .maxBackpressure = behavior.maxBackpressure,
          .closeOnBackpressureLimit = behavior.closeOnBackpressureLimit,
          .resetIdleTimeoutOnSend = behavior.resetIdleTimeoutOnSend,
          .sendPingsAutomatically = behavior.sendPingsAutomatically,
          .maxLifetime = behavior.maxLifetime,
      };

      if (behavior.upgrade)
        generic_handler.upgrade = [behavior, upgradeContext,
                                   id](auto *res, auto *req, auto *context)
        {
          behavior.upgrade(upgradeContext, (uws_res_t *)res, (uws_req_t *)req,
                           (uws_socket_context_t *)context, id);
        };
      if (behavior.open)
        generic_handler.open = [behavior](auto *ws)
        {
          behavior.open((uws_websocket_t *)ws);
        };
      if (behavior.message)
        generic_handler.message = [behavior](auto *ws, auto message,
                                             auto opcode)
        {
          behavior.message((uws_websocket_t *)ws, message.data(),
                           message.length(), (uws_opcode_t)opcode);
        };
      if (behavior.drain)
        generic_handler.drain = [behavior](auto *ws)
        {
          behavior.drain((uws_websocket_t *)ws);
        };
      if (behavior.ping)
        generic_handler.ping = [behavior](auto *ws, auto message)
        {
          behavior.ping((uws_websocket_t *)ws, message.data(), message.length());
        };
      if (behavior.pong)
        generic_handler.pong = [behavior](auto *ws, auto message)
        {
          behavior.pong((uws_websocket_t *)ws, message.data(), message.length());
        };
      if (behavior.close)
        generic_handler.close = [behavior](auto *ws, int code, auto message)
        {
          behavior.close((uws_websocket_t *)ws, code, message.data(),
                         message.length());
        };

      uwsApp->template ws<void *>(std::string(pattern, pattern_length),
                         std::move(generic_handler));
    });
  }

  void *uws_ws_get_user_data(int ssl, uws_websocket_t *ws)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return *uws->getUserData();
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return *uws->getUserData();
  }

  void uws_ws_close(int ssl, uws_websocket_t *ws)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      uws->close();
    }
    else
    {
      TCPWebSocket *uws =
          (TCPWebSocket *)ws;
      uws->close();
    }
  }

  uws_sendstatus_t uws_ws_send(int ssl, uws_websocket_t *ws, const char *message,
                               size_t length, uws_opcode_t opcode)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return (uws_sendstatus_t)uws->send(stringViewFromC(message, length),
                                         (uWS::OpCode)(unsigned char)opcode);
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return (uws_sendstatus_t)uws->send(stringViewFromC(message, length),
                                       (uWS::OpCode)(unsigned char)opcode);
  }

  uws_sendstatus_t uws_ws_send_with_options(int ssl, uws_websocket_t *ws,
                                            const char *message, size_t length,
                                            uws_opcode_t opcode, bool compress,
                                            bool fin)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return (uws_sendstatus_t)uws->send(stringViewFromC(message, length),
                                         (uWS::OpCode)(unsigned char)opcode,
                                         compress, fin);
    }
    else
    {

      TCPWebSocket *uws =
          (TCPWebSocket *)ws;
      return (uws_sendstatus_t)uws->send(stringViewFromC(message, length),
                                         (uWS::OpCode)(unsigned char)opcode,
                                         compress, fin);
    }
  }

  uws_sendstatus_t uws_ws_send_fragment(int ssl, uws_websocket_t *ws,
                                        const char *message, size_t length,
                                        bool compress)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return (uws_sendstatus_t)uws->sendFragment(
          stringViewFromC(message, length), compress);
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return (uws_sendstatus_t)uws->sendFragment(stringViewFromC(message, length),
                                               compress);
  }
  uws_sendstatus_t uws_ws_send_first_fragment(int ssl, uws_websocket_t *ws,
                                              const char *message, size_t length,
                                              bool compress)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return (uws_sendstatus_t)uws->sendFirstFragment(
          stringViewFromC(message, length), uWS::OpCode::BINARY, compress);
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return (uws_sendstatus_t)uws->sendFirstFragment(
        stringViewFromC(message, length), uWS::OpCode::BINARY, compress);
  }
  uws_sendstatus_t
  uws_ws_send_first_fragment_with_opcode(int ssl, uws_websocket_t *ws,
                                         const char *message, size_t length,
                                         uws_opcode_t opcode, bool compress)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return (uws_sendstatus_t)uws->sendFirstFragment(
          stringViewFromC(message, length), (uWS::OpCode)(unsigned char)opcode,
          compress);
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return (uws_sendstatus_t)uws->sendFirstFragment(
        stringViewFromC(message, length), (uWS::OpCode)(unsigned char)opcode,
        compress);
  }
  uws_sendstatus_t uws_ws_send_last_fragment(int ssl, uws_websocket_t *ws,
                                             const char *message, size_t length,
                                             bool compress)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return (uws_sendstatus_t)uws->sendLastFragment(
          stringViewFromC(message, length), compress);
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return (uws_sendstatus_t)uws->sendLastFragment(
        stringViewFromC(message, length), compress);
  }

  void uws_ws_end(int ssl, uws_websocket_t *ws, int code, const char *message,
                  size_t length)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      uws->end(code, stringViewFromC(message, length));
    }
    else
    {
      TCPWebSocket *uws =
          (TCPWebSocket *)ws;
      uws->end(code, stringViewFromC(message, length));
    }
  }

  void uws_ws_cork(int ssl, uws_websocket_t *ws, void (*handler)(void *user_data),
                   void *user_data)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      uws->cork([handler, user_data]()
                { handler(user_data); });
    }
    else
    {
      TCPWebSocket *uws =
          (TCPWebSocket *)ws;

      uws->cork([handler, user_data]()
                { handler(user_data); });
    }
  }
  bool uws_ws_subscribe(int ssl, uws_websocket_t *ws, const char *topic,
                        size_t length)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return uws->subscribe(stringViewFromC(topic, length));
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return uws->subscribe(stringViewFromC(topic, length));
  }
  bool uws_ws_unsubscribe(int ssl, uws_websocket_t *ws, const char *topic,
                          size_t length)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return uws->unsubscribe(stringViewFromC(topic, length));
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return uws->unsubscribe(stringViewFromC(topic, length));
  }

  bool uws_ws_is_subscribed(int ssl, uws_websocket_t *ws, const char *topic,
                            size_t length)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return uws->isSubscribed(stringViewFromC(topic, length));
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return uws->isSubscribed(stringViewFromC(topic, length));
  }
  void uws_ws_iterate_topics(int ssl, uws_websocket_t *ws,
                             void (*callback)(const char *topic, size_t length,
                                              void *user_data),
                             void *user_data)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      uws->iterateTopics([callback, user_data](auto topic)
                         { callback(topic.data(), topic.length(), user_data); });
    }
    else
    {
      TCPWebSocket *uws =
          (TCPWebSocket *)ws;

      uws->iterateTopics([callback, user_data](auto topic)
                         { callback(topic.data(), topic.length(), user_data); });
    }
  }

  uws_sendstatus_t uws_ws_publish(int ssl, uws_websocket_t *ws, const char *topic,
                                  size_t topic_length, const char *message,
                                  size_t message_length)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return (uws_sendstatus_t)uws->publish(stringViewFromC(topic, topic_length),
                                            stringViewFromC(message, message_length));
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return (uws_sendstatus_t)uws->publish(stringViewFromC(topic, topic_length),
                                          stringViewFromC(message, message_length));
  }

  uws_sendstatus_t uws_ws_publish_with_options(int ssl, uws_websocket_t *ws,
                                               const char *topic, size_t topic_length,
                                               const char *message, size_t message_length,
                                               uws_opcode_t opcode, bool compress)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return (uws_sendstatus_t)uws->publish(stringViewFromC(topic, topic_length),
                                            stringViewFromC(message, message_length),
                                            (uWS::OpCode)(unsigned char)opcode, compress);
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return (uws_sendstatus_t)uws->publish(stringViewFromC(topic, topic_length),
                                          stringViewFromC(message, message_length),
                                          (uWS::OpCode)(unsigned char)opcode, compress);
  }

  size_t uws_ws_get_buffered_amount(int ssl, uws_websocket_t *ws)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return uws->getBufferedAmount();
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return uws->getBufferedAmount();
  }

  size_t uws_ws_get_remote_address(int ssl, uws_websocket_t *ws,
                                   const char **dest)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      std::string_view value = uws->getRemoteAddress();
      *dest = value.data();
      return value.length();
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;

    std::string_view value = uws->getRemoteAddress();
    *dest = value.data();
    return value.length();
  }

  size_t uws_ws_get_remote_address_as_text(int ssl, uws_websocket_t *ws,
                                           const char **dest)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;

      std::string_view value = uws->getRemoteAddressAsText();
      *dest = value.data();
      return value.length();
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;

    std::string_view value = uws->getRemoteAddressAsText();
    *dest = value.data();
    return value.length();
  }

  void uws_res_end(int ssl, int node_http, uws_res_r res, const char *data, size_t length,
                   bool close_connection)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      uwsRes->clearOnWritableAndAborted();
      uwsRes->end(stringViewFromC(data, length), close_connection);
    });
  }

  void uws_res_end_stream(int ssl, int node_http, uws_res_r res, bool close_connection)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      uwsRes->clearOnWritableAndAborted();
      uwsRes->sendTerminatingChunk(close_connection);
    });
  }

  void uws_res_pause(int ssl, int node_http, uws_res_r res)
  {
    uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) { uwsRes->pause(); });
  }

  void uws_res_resume(int ssl, int node_http, uws_res_r res)
  {
    uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) { uwsRes->resume(); });
  }

  void uws_res_write_continue(int ssl, int node_http, uws_res_r res)
  {
    uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) { uwsRes->writeContinue(); });
  }

  // node:http-only: writeRawInformational() is `if constexpr (NODE_HTTP)`.
  void uws_res_write_informational(int ssl, uws_res_r res, const char *data,
                                   size_t length)
  {
    uws_res_dispatch_node(ssl, res, [&](auto* uwsRes) {
      uwsRes->writeRawInformational(stringViewFromC(data, length));
    });
  }

  void uws_res_write_status(int ssl, int node_http, uws_res_r res, const char *status,
                            size_t length)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      uwsRes->writeStatus(stringViewFromC(status, length));
    });
  }

  void uws_res_mark_wrote_content_length_header(int ssl, int node_http, uws_res_r res) {
    uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) {
      using DataT = std::remove_pointer_t<decltype(uwsRes->getHttpResponseData())>;
      uwsRes->getHttpResponseData()->state |= DataT::HTTP_WROTE_CONTENT_LENGTH_HEADER;
    });
  }

  void uws_res_write_mark(int ssl, int node_http, uws_res_r res) {
    uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) { uwsRes->writeMark(); });
  }

  void uws_res_write_header(int ssl, int node_http, uws_res_r res, const char *key,
                            size_t key_length, const char *value,
                            size_t value_length)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      uwsRes->writeHeader(stringViewFromC(key, key_length),
                          stringViewFromC(value, value_length));
    });
  }
  void uws_res_write_header_int(int ssl, int node_http, uws_res_r res, const char *key,
                                size_t key_length, uint64_t value)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      uwsRes->writeHeader(stringViewFromC(key, key_length), value);
    });
  }
  void uws_res_end_sendfile(int ssl, int node_http, uws_res_r res, uint64_t offset, bool close_connection)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      using DataT = std::remove_pointer_t<decltype(uwsRes->getHttpResponseData())>;
      auto *data = uwsRes->getHttpResponseData();
      data->offset = offset;
      data->state |= DataT::HTTP_END_CALLED;
      data->markDone(uwsRes);
      uwsRes->resetTimeout();
    });
  }
  void uws_res_reset_timeout(int ssl, int node_http, uws_res_r res) {
    uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) { uwsRes->resetTimeout(); });
  }
  void uws_res_timeout(int ssl, int node_http, uws_res_r res, uint8_t seconds) {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) { uwsRes->setTimeout(seconds); });
  }

  void uws_res_end_without_body(int ssl, int node_http, uws_res_r res, bool close_connection)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      using ResT = std::remove_pointer_t<decltype(uwsRes)>;
      using DataT = std::remove_pointer_t<decltype(uwsRes->getHttpResponseData())>;
      auto *data = uwsRes->getHttpResponseData();
      if (close_connection)
      {
        if (!(data->state & DataT::HTTP_CONNECTION_CLOSE))
        {
          uwsRes->writeHeader("Connection", "close");
        }
        data->state |= DataT::HTTP_CONNECTION_CLOSE;
      }
      if (!(data->state & DataT::HTTP_END_CALLED))
      {
        // Some HTTP clients require the complete "<header>\r\n\r\n" to be sent.
        // If not, they may throw a ConnectionError.
        static_cast<typename ResT::Super*>(uwsRes)->write("\r\n", 2);
      }
      data->state |= DataT::HTTP_END_CALLED;
      data->markDone(uwsRes);
      uwsRes->resetTimeout();
    });
  }

  bool uws_res_write(int ssl, int node_http, uws_res_r res, const char *data, size_t *length) nonnull_fn_decl;

  bool uws_res_write(int ssl, int node_http, uws_res_r res, const char *data, size_t *length)
  {
    return uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) -> bool {
      using ResT = std::remove_pointer_t<decltype(uwsRes)>;
      auto* asyncSocket = static_cast<typename ResT::Super*>(uwsRes);
      if (*length < 16 * 1024 && *length > 0) {
        if (!asyncSocket->isCorked()) {
          asyncSocket->cork();
        }
      }
      return uwsRes->write(stringViewFromC(data, *length), length);
    });
  }
  uint64_t uws_res_get_write_offset(int ssl, int node_http, uws_res_r res) nonnull_fn_decl;
  uint64_t uws_res_get_write_offset(int ssl, int node_http, uws_res_r res)
  {
    return uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) -> uint64_t {
      return uwsRes->getWriteOffset();
    });
  }

  bool uws_res_has_responded(int ssl, int node_http, uws_res_r res) nonnull_fn_decl;
  bool uws_res_has_responded(int ssl, int node_http, uws_res_r res)
  {
    return uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) -> bool {
      return uwsRes->hasResponded();
    });
  }

  void uws_res_on_writable(int ssl, int node_http, uws_res_r res,
                           bool (*handler)(uws_res_r res, uint64_t,
                                           void *optional_data),
                           void *optional_data)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      using ResT = std::remove_pointer_t<decltype(uwsRes)>;
      auto onWritable = reinterpret_cast<bool (*)(ResT*, uint64_t, void*)>(handler);
      uwsRes->onWritable(optional_data, onWritable);
    });
  }

  void uws_res_clear_on_writable(int ssl, int node_http, uws_res_r res) {
    uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) { uwsRes->clearOnWritable(); });
  }

  void uws_res_on_aborted(int ssl, int node_http, uws_res_r res,
                          void (*handler)(uws_res_r res, void *optional_data),
                          void *optional_data)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      using ResT = std::remove_pointer_t<decltype(uwsRes)>;
      auto* onAborted = reinterpret_cast<void (*)(ResT*, void*)>(handler);
      if (handler)
      {
        uwsRes->onAborted(optional_data, onAborted);
      }
      else
      {
        uwsRes->clearOnAborted();
      }
    });
  }

  void uws_res_on_timeout(int ssl, int node_http, uws_res_r res,
                          void (*handler)(uws_res_r res, void *optional_data),
                          void *optional_data)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      using ResT = std::remove_pointer_t<decltype(uwsRes)>;
      auto* onTimeout = reinterpret_cast<void (*)(ResT*, void*)>(handler);
      if (handler)
      {
        uwsRes->onTimeout(optional_data, onTimeout);
      }
      else
      {
        uwsRes->clearOnTimeout();
      }
    });
  }

  void uws_res_on_data(int ssl, int node_http, uws_res_r res,
                       void (*handler)(uws_res_r res, const char *chunk,
                                       size_t chunk_length, bool is_end,
                                       void *optional_data),
                       void *optional_data)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      using ResT = std::remove_pointer_t<decltype(uwsRes)>;
      auto onData = reinterpret_cast<void (*)(ResT* response, const char* chunk, size_t chunk_length, bool, void*)>(handler);
      if (handler) {
        uwsRes->onData(optional_data, onData);
      } else {
        uwsRes->onData(optional_data, nullptr);
      }
    });
  }

  bool uws_req_is_ancient(uws_req_t *res)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
    return uwsReq->isAncient();
  }

  bool uws_req_get_yield(uws_req_t *res)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
    return uwsReq->getYield();
  }

  void uws_req_set_yield(uws_req_t *res, bool yield)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
    return uwsReq->setYield(yield);
  }

  size_t uws_req_get_url(uws_req_t *res, const char **dest)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
    std::string_view value = uwsReq->getFullUrl();
    *dest = value.data();
    return value.length();
  }

  size_t uws_req_get_method(uws_req_t *res, const char **dest)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
    std::string_view value = uwsReq->getMethod();
    *dest = value.data();
    return value.length();
  }

size_t uws_req_get_header(uws_req_t *res, const char *lower_case_header,
                            size_t lower_case_header_length, const char **dest) nonnull_fn_decl;

  size_t uws_req_get_header(uws_req_t *res, const char *lower_case_header,
                            size_t lower_case_header_length, const char **dest)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;

    std::string_view value = uwsReq->getHeader(
        stringViewFromC(lower_case_header, lower_case_header_length));
    *dest = value.data();
    return value.length();
  }

  void uws_req_for_each_header(uws_req_t *res, uws_get_headers_server_handler handler, void *user_data)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
    for (auto header : *uwsReq)
    {
      handler(header.first.data(), header.first.length(), header.second.data(), header.second.length(), user_data);
    }
  }

  size_t uws_req_get_query(uws_req_t *res, const char *key, size_t key_length,
                           const char **dest)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;

    std::string_view value = uwsReq->getQuery(stringViewFromC(key, key_length));
    *dest = value.data();
    return value.length();
  }

  size_t uws_req_get_parameter(uws_req_t *res, unsigned short index,
                               const char **dest)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
    std::string_view value = uwsReq->getParameter(index);
    *dest = value.data();
    return value.length();
  }

  us_socket_t *uws_res_upgrade(int ssl, int node_http, uws_res_r res, void *data,
                             const char *sec_web_socket_key,
                             size_t sec_web_socket_key_length,
                             const char *sec_web_socket_protocol,
                             size_t sec_web_socket_protocol_length,
                             const char *sec_web_socket_extensions,
                             size_t sec_web_socket_extensions_length,
                             uws_socket_context_t *ws)
  {
    if (ssl) {
        auto up = [&](auto* uwsRes) -> us_socket_t* {
            return uwsRes->template upgrade<void *>(
                data ? std::move(data) : nullptr,
                stringViewFromC(sec_web_socket_key, sec_web_socket_key_length),
                stringViewFromC(sec_web_socket_protocol, sec_web_socket_protocol_length),
                stringViewFromC(sec_web_socket_extensions,
                                 sec_web_socket_extensions_length),
                (uWS::WebSocketContext<true, true, void *> *)ws);
        };
        if (node_http) return up((uWS::HttpResponse<true, true>*)res);
        return up((uWS::HttpResponse<true, false>*)res);
    } else {
        auto up = [&](auto* uwsRes) -> us_socket_t* {
            return uwsRes->template upgrade<void *>(
                data ? std::move(data) : nullptr,
                stringViewFromC(sec_web_socket_key, sec_web_socket_key_length),
                stringViewFromC(sec_web_socket_protocol, sec_web_socket_protocol_length),
                stringViewFromC(sec_web_socket_extensions,
                                 sec_web_socket_extensions_length),
                (uWS::WebSocketContext<false, true, void *> *)ws);
        };
        if (node_http) return up((uWS::HttpResponse<false, true>*)res);
        return up((uWS::HttpResponse<false, false>*)res);
    }
  }

  struct us_loop_t *uws_get_loop()
  {
    return (struct us_loop_t *)uWS::Loop::get();
  }
  struct us_loop_t *uws_get_loop_with_native(void *existing_native_loop)
  {
      return (struct us_loop_t *)uWS::Loop::get(existing_native_loop);
  }

  void uws_loop_addPostHandler(us_loop_t *loop, void *ctx_,
                               void (*cb)(void *ctx, us_loop_t *loop))
  {
    uWS::Loop *uwsLoop = (uWS::Loop *)loop;
    uwsLoop->addPostHandler(ctx_, [ctx_, cb](uWS::Loop *uwsLoop_)
                            { cb(ctx_, (us_loop_t *)uwsLoop_); });
  }
  void uws_loop_removePostHandler(us_loop_t *loop, void *key)
  {
    uWS::Loop *uwsLoop = (uWS::Loop *)loop;
    uwsLoop->removePostHandler(key);
  }
  void uws_loop_addPreHandler(us_loop_t *loop, void *ctx_,
                              void (*cb)(void *ctx, us_loop_t *loop))
  {
    uWS::Loop *uwsLoop = (uWS::Loop *)loop;
    uwsLoop->addPreHandler(ctx_, [ctx_, cb](uWS::Loop *uwsLoop_)
                           { cb(ctx_, (us_loop_t *)uwsLoop_); });
  }
  void uws_loop_removePreHandler(us_loop_t *loop, void *ctx_)
  {
    uWS::Loop *uwsLoop = (uWS::Loop *)loop;
    uwsLoop->removePreHandler(ctx_);
  }
  void uws_loop_defer(us_loop_t *loop, void *ctx, void (*cb)(void *ctx))
  {
    uWS::Loop *uwsLoop = (uWS::Loop *)loop;
    uwsLoop->defer([ctx, cb]()
                   { cb(ctx); });
  }

  void uws_res_uncork(int ssl, int node_http, uws_res_r res)
  {
    uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) { uwsRes->uncork(); });
  }

  void us_socket_mark_needs_more_not_ssl(uws_res_r res)
  {
    us_socket_r s = (us_socket_t *)res;
    if(us_socket_is_closed(s)) return;
    s->flags.last_write_failed = 1;
    us_poll_change(&s->p, s->group->loop,
                   LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
  }

  void uws_res_override_write_offset(int ssl, int node_http, uws_res_r res, uint64_t offset)
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      uwsRes->setWriteOffset(offset); //TODO: when updated to master this will bechanged to overrideWriteOffset
    });
  }

__attribute__((callback (corker, ctx)))
  void uws_res_cork(int ssl, int node_http, uws_res_r res, void *ctx,
                    void (*corker)(void *ctx)) nonnull_fn_decl;

  void uws_res_cork(int ssl, int node_http, uws_res_r res, void *ctx,
                    void (*corker)(void *ctx))
  {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      uwsRes->cork([ctx, corker]()
                   { corker(ctx); });
    });
  }

  void uws_res_prepare_for_sendfile(int ssl, int node_http, uws_res_r res)
  {
    uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) {
      uwsRes->writeMark();
      auto pair = uwsRes->getSendBuffer(2);
      char *ptr = pair.first;
      ptr[0] = '\r';
      ptr[1] = '\n';
      uwsRes->uncork();
    });
  }

  bool uws_res_try_end(int ssl, int node_http, uws_res_r res, const char *bytes, size_t len,
                       size_t total_len, bool close)
  {
    return uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) -> bool {
      auto pair = uwsRes->tryEnd(stringViewFromC(bytes, len), total_len, close);
      if (pair.first) {
        uwsRes->clearOnWritableAndAborted();
      }

      return pair.first;
    });
  }

  int uws_res_state(int ssl, int node_http, uws_res_r res)
  {
    return uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) -> int {
      return uwsRes->getHttpResponseData()->state;
    });
  }

  void uws_res_flush_headers(int ssl, int node_http, uws_res_r res, bool flushImmediately) {
    uws_res_dispatch(ssl, node_http, res, [&](auto* uwsRes) {
      uwsRes->flushHeaders(flushImmediately);
    });
  }

  bool uws_res_is_corked(int ssl, int node_http, uws_res_r res) {
    return uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) -> bool {
      return uwsRes->isCorked();
    });
  }

  // node:http-only: socketData lives in nodeCompat.
  void *uws_res_get_socket_data(int ssl, uws_res_r res) {
    return uws_res_dispatch_node(ssl, res, [](auto* uwsRes) -> void* {
      return uwsRes->getSocketData();
    });
  }

  // node:http-only: isConnectRequest lives in nodeCompat.
  bool uws_res_is_connect_request(int ssl, uws_res_r res)
  {
    return uws_res_dispatch_node(ssl, res, [](auto* uwsRes) -> bool {
      return uwsRes->isConnectRequest();
    });
  }
  void *uws_res_get_native_handle(int ssl, int node_http, uws_res_r res)
  {
    return uws_res_dispatch(ssl, node_http, res, [](auto* uwsRes) -> void* {
      return uwsRes->getNativeHandle();
    });
  }

  size_t uws_ws_memory_cost(int ssl, uws_websocket_t *ws) {
    if (ssl) {
      return ((TLSWebSocket*)ws)->memoryCost();
    } else {
      return ((TCPWebSocket*)ws)->memoryCost();
    }
  }

  void us_socket_sendfile_needs_more(us_socket_r s) {
    if(us_socket_is_closed(s)) return;
    s->flags.last_write_failed = 1;
    us_poll_change(&s->p, s->group->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
  }

  LIBUS_SOCKET_DESCRIPTOR us_socket_get_fd(us_socket_r s) {
    return us_poll_fd(&s->p);
  }

  // Gets the remote address and port
  // Returns 0 if failure / unix socket
  uint64_t uws_res_get_remote_address_info(uws_res_r res, const char **dest, int *port, bool *is_ipv6)
  {
    // This function is manual inlining + modification of
    //      us_socket_remote_address
    //      AsyncSocket::getRemoteAddress
    //      AsyncSocket::addressAsText
    // To get { ip, port, is_ipv6 } for Bun.serve().requestIP()
    static thread_local char b[64];
    auto length = us_get_remote_address_info(b, (us_socket_t *)res, dest, port, (int*)is_ipv6);

    if (length == 0) return 0;
    if (length == 4) {
      ares_inet_ntop(AF_INET, b, &b[4], 64 - 4);
      *dest = &b[4];
      *is_ipv6 = false;
      return strlen(*dest);
    } else {
      ares_inet_ntop(AF_INET6, b, &b[16], 64 - 16);
      *dest = &b[16];
      *is_ipv6 = true;
      return strlen(*dest);
    }
  }

  uint64_t uws_res_get_local_address_info(uws_res_r res, const char **dest, int *port, bool *is_ipv6)
  {
    static thread_local char b[64];
    auto length = us_get_local_address_info(b, (us_socket_t *)res, dest, port, (int*)is_ipv6);

    if (length == 0) return 0;
    if (length == 4) {
      ares_inet_ntop(AF_INET, b, &b[4], 64 - 4);
      *dest = &b[4];
      *is_ipv6 = false;
      return strlen(*dest);
    } else {
      ares_inet_ntop(AF_INET6, b, &b[16], 64 - 16);
      *dest = &b[16];
      *is_ipv6 = true;
      return strlen(*dest);
    }
  }

  // we need to manually call this at thread exit
  extern "C" void bun_clear_loop_at_thread_exit() {
      uWS::Loop::clearLoopAtThreadExit();
  }

#pragma clang attribute pop
} // extern "C"
