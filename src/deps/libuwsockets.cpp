// clang-format off
#include "_libusockets.h"
#include "libusockets.h"
#include <bun-uws/src/App.h>
#include <bun-uws/src/AsyncSocket.h>
#include <bun-usockets/src/internal/internal.h>
#include <string_view>

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

extern "C"
{

  uws_app_t *uws_create_app(int ssl, struct us_bun_socket_context_options_t options)
  {
    if (ssl)
    {
      uWS::SocketContextOptions socket_context_options;
      memcpy(&socket_context_options, &options,
             sizeof(uWS::SocketContextOptions));
      return (uws_app_t *)uWS::SSLApp::create(socket_context_options);
    }

    return (uws_app_t *)new uWS::App();
  }

  void uws_app_clear_routes(int ssl, uws_app_t *app)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->clearRoutes();
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->clearRoutes();
    }
  }

  void uws_app_get(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->get(pattern, nullptr);
        return;
      }
      uwsApp->get(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->get(pattern, nullptr);
        return;
      }
      uwsApp->get(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }

  void uws_app_post(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
  {

    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->post(pattern, nullptr);
        return;
      }
      uwsApp->post(pattern, [handler, user_data](auto *res, auto *req)
                   { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->post(pattern, nullptr);
        return;
      }
      uwsApp->post(pattern, [handler, user_data](auto *res, auto *req)
                   { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }

  void uws_app_options(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->options(pattern, nullptr);
        return;
      }
      uwsApp->options(pattern, [handler, user_data](auto *res, auto *req)
                      { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->options(pattern, nullptr);
        return;
      }
      uwsApp->options(pattern, [handler, user_data](auto *res, auto *req)
                      { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }

  void uws_app_delete(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->del(pattern, nullptr);
        return;
      }
      uwsApp->del(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->del(pattern, nullptr);
        return;
      }
      uwsApp->del(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }

  void uws_app_patch(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->patch(pattern, nullptr);
        return;
      }
      uwsApp->patch(pattern, [handler, user_data](auto *res, auto *req)
                    { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->patch(pattern, nullptr);
        return;
      }
      uwsApp->patch(pattern, [handler, user_data](auto *res, auto *req)
                    { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }

  void uws_app_put(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->put(pattern, nullptr);
        return;
      }
      uwsApp->put(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->put(pattern, nullptr);
        return;
      }
      uwsApp->put(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }

  void uws_app_head(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string pattern = std::string(pattern_ptr, pattern_len);
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->head(pattern, nullptr);
        return;
      }
      uwsApp->head(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->head(pattern, nullptr);
        return;
      }
      uwsApp->head(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }
  void uws_app_connect(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->connect(pattern, nullptr);
        return;
      }
      uwsApp->connect(pattern, [handler, user_data](auto *res, auto *req)
                      { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->connect(pattern, nullptr);
        return;
      }
      uwsApp->connect(pattern, [handler, user_data](auto *res, auto *req)
                      { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }

  void uws_app_trace(int ssl, uws_app_t *app, const char *pattern, uws_method_handler handler, void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->trace(pattern, nullptr);
        return;
      }
      uwsApp->trace(pattern, [handler, user_data](auto *res, auto *req)
                    { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->trace(pattern, nullptr);
        return;
      }
      uwsApp->trace(pattern, [handler, user_data](auto *res, auto *req)
                    { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }

  void uws_app_any(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string pattern = std::string(pattern_ptr, pattern_len);
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr)
      {
        uwsApp->any(pattern, nullptr);
        return;
      }
      uwsApp->any(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr)
      {
        uwsApp->any(pattern, nullptr);
        return;
      }
      uwsApp->any(pattern, [handler, user_data](auto *res, auto *req)
                  { handler((uws_res_t *)res, (uws_req_t *)req, user_data); });
    }
  }

  void uws_app_run(int ssl, uws_app_t *app)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->run();
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->run();
    }
  }

  void uws_app_close(int ssl, uws_app_t *app)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->close();
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->close();
    }
  }

  void uws_app_listen(int ssl, uws_app_t *app, int port,
                      uws_listen_handler handler, void *user_data)
  {
    uws_app_listen_config_t config;
    config.port = port;
    config.host = nullptr;
    config.options = 0;

    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->listen(port, [handler, 
                            user_data](struct us_listen_socket_t *listen_socket)
                     { handler((struct us_listen_socket_t *)listen_socket, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;

      uwsApp->listen(port, [handler, 
                            user_data](struct us_listen_socket_t *listen_socket)
                     { handler((struct us_listen_socket_t *)listen_socket, user_data); });
    }
  }

  void uws_app_listen_with_config(int ssl, uws_app_t *app, const char *host,
                                  uint16_t port, int32_t options,
                                  uws_listen_handler handler, void *user_data)
  {
    std::string hostname = host && host[0] ? std::string(host, strlen(host)) : "";
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->listen(
          hostname, port, options,
          [handler, user_data](struct us_listen_socket_t *listen_socket)
          {
            handler((struct us_listen_socket_t *)listen_socket, user_data);
          });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->listen(
          hostname, port, options,
          [handler, user_data](struct us_listen_socket_t *listen_socket)
          {
            handler((struct us_listen_socket_t *)listen_socket, user_data);
          });
    }
  }

  /* callback, path to unix domain socket */
  void uws_app_listen_domain(int ssl, uws_app_t *app, const char *domain, size_t pathlen, uws_listen_domain_handler handler, void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->listen(0,[handler, domain, user_data](struct us_listen_socket_t *listen_socket)
                     { handler((struct us_listen_socket_t *)listen_socket, domain, 0, user_data); },
                     {domain, pathlen});
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->listen(0, [handler, domain, user_data](struct us_listen_socket_t *listen_socket)
                     { handler((struct us_listen_socket_t *)listen_socket, domain, 0, user_data); },
                     {domain, pathlen});
    }
  }

  /* callback, path to unix domain socket */
  void uws_app_listen_domain_with_options(int ssl, uws_app_t *app, const char *domain, size_t pathlen, int options, uws_listen_domain_handler handler, void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->listen(
          options, [handler, domain, options, user_data](struct us_listen_socket_t *listen_socket)
          { handler((struct us_listen_socket_t *)listen_socket, domain, options, user_data); },
          {domain, pathlen});
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->listen(
          options, [handler, domain, options, user_data](struct us_listen_socket_t *listen_socket)
          { handler((struct us_listen_socket_t *)listen_socket, domain, options, user_data); },
          {domain, pathlen});
    }
  }

  void uws_app_domain(int ssl, uws_app_t *app, const char *server_name)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->domain(server_name);
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->domain(server_name);
    }
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

  bool uws_constructor_failed(int ssl, uws_app_t *app)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (!uwsApp)
        return true;
      return uwsApp->constructorFailed();
    }
    uWS::App *uwsApp = (uWS::App *)app;
    if (!uwsApp)
      return true;
    return uwsApp->constructorFailed();
  }

  unsigned int uws_num_subscribers(int ssl, uws_app_t *app, const char *topic, size_t topic_length)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      return uwsApp->numSubscribers(stringViewFromC(topic, topic_length));
    }
    uWS::App *uwsApp = (uWS::App *)app;
    return uwsApp->numSubscribers(stringViewFromC(topic, topic_length));
  }
  bool uws_publish(int ssl, uws_app_t *app, const char *topic,
                   size_t topic_length, const char *message,
                   size_t message_length, uws_opcode_t opcode, bool compress)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      return uwsApp->publish(stringViewFromC(topic, topic_length),
                             stringViewFromC(message, message_length),
                             (uWS::OpCode)(unsigned char)opcode, compress);
    }
    uWS::App *uwsApp = (uWS::App *)app;
    return uwsApp->publish(stringViewFromC(topic, topic_length),
                           stringViewFromC(message, message_length),
                           (uWS::OpCode)(unsigned char)opcode, compress);
  }
  void *uws_get_native_handle(int ssl, uws_app_t *app)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      return uwsApp->getNativeHandle();
    }
    uWS::App *uwsApp = (uWS::App *)app;
    return uwsApp->getNativeHandle();
  }
  void uws_remove_server_name(int ssl, uws_app_t *app,
                              const char *hostname_pattern)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->removeServerName(hostname_pattern);
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->removeServerName(hostname_pattern);
    }
  }
  void uws_add_server_name(int ssl, uws_app_t *app,
                           const char *hostname_pattern)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->addServerName(hostname_pattern);
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->addServerName(hostname_pattern);
    }
  }
  int uws_add_server_name_with_options(
      int ssl, uws_app_t *app, const char *hostname_pattern,
      struct us_bun_socket_context_options_t options)
  {
    uWS::SocketContextOptions sco;
    memcpy(&sco, &options, sizeof(uWS::SocketContextOptions));
    bool success = false;

    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->addServerName(hostname_pattern, sco, &success);
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->addServerName(hostname_pattern, sco, &success);
    }
    return !success;
  }

  void uws_missing_server_name(int ssl, uws_app_t *app,
                               uws_missing_server_handler handler,
                               void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->missingServerName(
          [handler, user_data](auto hostname)
          { handler(hostname, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->missingServerName(
          [handler, user_data](auto hostname)
          { handler(hostname, user_data); });
    }
  }
  void uws_filter(int ssl, uws_app_t *app, uws_filter_handler handler,
                  void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->filter([handler, user_data](auto res, auto i)
                     { handler((uws_res_t *)res, i, user_data); });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;

      uwsApp->filter([handler, user_data](auto res, auto i)
                     { handler((uws_res_t *)res, i, user_data); });
    }
  }

  void uws_ws(int ssl, uws_app_t *app, void *upgradeContext, const char *pattern,
              size_t pattern_length, size_t id,
              const uws_socket_behavior_t *behavior_)
  {
    uws_socket_behavior_t behavior = *behavior_;

    if (ssl)
    {
      auto generic_handler = uWS::SSLApp::WebSocketBehavior<void *>{
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
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;

      uwsApp->ws<void *>(std::string(pattern, pattern_length),
                         std::move(generic_handler));
    }
    else
    {
      auto generic_handler = uWS::App::WebSocketBehavior<void *>{
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
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->ws<void *>(std::string(pattern, pattern_length),
                         std::move(generic_handler));
    }
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

  bool uws_ws_publish(int ssl, uws_websocket_t *ws, const char *topic,
                      size_t topic_length, const char *message,
                      size_t message_length)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return uws->publish(stringViewFromC(topic, topic_length),
                          stringViewFromC(message, message_length));
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return uws->publish(stringViewFromC(topic, topic_length),
                        stringViewFromC(message, message_length));
  }

  bool uws_ws_publish_with_options(int ssl, uws_websocket_t *ws,
                                   const char *topic, size_t topic_length,
                                   const char *message, size_t message_length,
                                   uws_opcode_t opcode, bool compress)
  {
    if (ssl)
    {
      TLSWebSocket *uws =
          (TLSWebSocket *)ws;
      return uws->publish(stringViewFromC(topic, topic_length),
                          stringViewFromC(message, message_length),
                          (uWS::OpCode)(unsigned char)opcode, compress);
    }
    TCPWebSocket *uws =
        (TCPWebSocket *)ws;
    return uws->publish(stringViewFromC(topic, topic_length),
                        stringViewFromC(message, message_length),
                        (uWS::OpCode)(unsigned char)opcode, compress);
  }

  unsigned int uws_ws_get_buffered_amount(int ssl, uws_websocket_t *ws)
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

  void uws_res_end(int ssl, uws_res_r res, const char *data, size_t length,
                   bool close_connection)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->clearOnWritableAndAborted();
      uwsRes->end(stringViewFromC(data, length), close_connection);
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->clearOnWritableAndAborted();
      uwsRes->end(stringViewFromC(data, length), close_connection);
    }
  }

  void uws_res_end_stream(int ssl, uws_res_r res, bool close_connection)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->clearOnWritableAndAborted();
      uwsRes->sendTerminatingChunk(close_connection);
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->clearOnWritableAndAborted();
      uwsRes->sendTerminatingChunk(close_connection);
    }
  }

  void uws_res_pause(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->pause();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->pause();
    }
  }

  void uws_res_resume(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->pause();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->pause();
    }
  }

  void uws_res_write_continue(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->writeContinue();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->writeContinue();
    }
  }

  void uws_res_write_status(int ssl, uws_res_r res, const char *status,
                            size_t length)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->writeStatus(stringViewFromC(status, length));
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->writeStatus(stringViewFromC(status, length));
    }
  }

  void uws_res_write_header(int ssl, uws_res_r res, const char *key,
                            size_t key_length, const char *value,
                            size_t value_length)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->writeHeader(stringViewFromC(key, key_length),
                          stringViewFromC(value, value_length));
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->writeHeader(stringViewFromC(key, key_length),
                          stringViewFromC(value, value_length));
    }
  }
  void uws_res_write_header_int(int ssl, uws_res_r res, const char *key,
                                size_t key_length, uint64_t value)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->writeHeader(stringViewFromC(key, key_length), value);
    }
    else
    {

      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->writeHeader(stringViewFromC(key, key_length), value);
    }
  }
  void uws_res_end_sendfile(int ssl, uws_res_r res, uint64_t offset, bool close_connection) 
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto *data = uwsRes->getHttpResponseData();
      data->offset = offset;
      data->state |= uWS::HttpResponseData<true>::HTTP_END_CALLED;
      data->markDone();
      uwsRes->resetTimeout();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto *data = uwsRes->getHttpResponseData();
      data->offset = offset;
      data->state |= uWS::HttpResponseData<true>::HTTP_END_CALLED;
      data->markDone();
      uwsRes->resetTimeout();
    }
  }
  void uws_res_reset_timeout(int ssl, uws_res_r res) {
    if (ssl) {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->resetTimeout();
    } else {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->resetTimeout();
    }
  }
  void uws_res_timeout(int ssl, uws_res_r res, uint8_t seconds) {
    if (ssl) {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->setTimeout(seconds);
    } else {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->setTimeout(seconds);
    }
  }

  void uws_res_end_without_body(int ssl, uws_res_r res, bool close_connection)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto *data = uwsRes->getHttpResponseData();
      if (close_connection)
      {
        if (!(data->state & uWS::HttpResponseData<true>::HTTP_CONNECTION_CLOSE))
        {
          uwsRes->writeHeader("Connection", "close");
        }
        data->state |= uWS::HttpResponseData<true>::HTTP_CONNECTION_CLOSE;
      }
      if (!(data->state & uWS::HttpResponseData<true>::HTTP_END_CALLED))
      {
        uwsRes->AsyncSocket<true>::write("\r\n", 2);
      }
      data->state |= uWS::HttpResponseData<true>::HTTP_END_CALLED;
      data->markDone();
      uwsRes->resetTimeout();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto *data = uwsRes->getHttpResponseData();
      if (close_connection)
      {
        if (!(data->state & uWS::HttpResponseData<false>::HTTP_CONNECTION_CLOSE))
        {
          uwsRes->writeHeader("Connection", "close");
        }
        data->state |= uWS::HttpResponseData<false>::HTTP_CONNECTION_CLOSE;
      }
      if (!(data->state & uWS::HttpResponseData<false>::HTTP_END_CALLED))
      {
        // Some HTTP clients require the complete "<header>\r\n\r\n" to be sent.
        // If not, they may throw a ConnectionError.
        uwsRes->AsyncSocket<false>::write("\r\n", 2);
      }
      data->state |= uWS::HttpResponseData<false>::HTTP_END_CALLED;
      data->markDone();
      uwsRes->resetTimeout();
    }
  }

  bool uws_res_write(int ssl, uws_res_r res, const char *data, size_t length) nonnull_fn_decl;
  
  bool uws_res_write(int ssl, uws_res_r res, const char *data, size_t length)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      return uwsRes->write(stringViewFromC(data, length));
    }
    uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
    return uwsRes->write(stringViewFromC(data, length));
  }
  uint64_t uws_res_get_write_offset(int ssl, uws_res_r res) nonnull_fn_decl;
  uint64_t uws_res_get_write_offset(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      return uwsRes->getWriteOffset();
    }
    uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
    return uwsRes->getWriteOffset();
  }

  bool uws_res_has_responded(int ssl, uws_res_r res) nonnull_fn_decl;
  bool uws_res_has_responded(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      return uwsRes->hasResponded();
    }
    uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
    return uwsRes->hasResponded();
  }

  void uws_res_on_writable(int ssl, uws_res_r res,
                           bool (*handler)(uws_res_r res, uint64_t,
                                           void *opcional_data),
                           void *opcional_data)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto onWritable = reinterpret_cast<bool (*)(uWS::HttpResponse<true>*, uint64_t, void*)>(handler);
      uwsRes->onWritable(opcional_data, onWritable);
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto onWritable = reinterpret_cast<bool (*)(uWS::HttpResponse<false>*, uint64_t, void*)>(handler);
      uwsRes->onWritable(opcional_data, onWritable);
    }
  }
  
  void uws_res_clear_on_writable(int ssl, uws_res_r res) {
    if (ssl) {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->clearOnWritable();
    } else {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->clearOnWritable();
    }
  }

  void uws_res_on_aborted(int ssl, uws_res_r res,
                          void (*handler)(uws_res_r res, void *opcional_data),
                          void *opcional_data)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto* onAborted = reinterpret_cast<void (*)(uWS::HttpResponse<true>*, void*)>(handler);
      if (handler)
      {
        uwsRes->onAborted(opcional_data, onAborted);
      }
      else
      {
        uwsRes->clearOnAborted();
      }
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto* onAborted = reinterpret_cast<void (*)(uWS::HttpResponse<false>*, void*)>(handler);
      if (handler)
      {
        uwsRes->onAborted(opcional_data, onAborted);
      }
      else
      {
        uwsRes->clearOnAborted();
      }
    }
  }

  void uws_res_on_timeout(int ssl, uws_res_r res,
                          void (*handler)(uws_res_r res, void *opcional_data),
                          void *opcional_data)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto* onTimeout = reinterpret_cast<void (*)(uWS::HttpResponse<true>*, void*)>(handler);
      if (handler)
      {
        uwsRes->onTimeout(opcional_data, onTimeout);
      }
      else
      {
        uwsRes->clearOnTimeout();
      }
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto* onTimeout = reinterpret_cast<void (*)(uWS::HttpResponse<false>*, void*)>(handler);
      if (handler)
      {
        uwsRes->onTimeout(opcional_data, onTimeout);
      }
      else
      {
        uwsRes->clearOnTimeout();
      }
    }
  }

  void uws_res_on_data(int ssl, uws_res_r res,
                       void (*handler)(uws_res_r res, const char *chunk,
                                       size_t chunk_length, bool is_end,
                                       void *opcional_data),
                       void *opcional_data)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto onData = reinterpret_cast<void (*)(uWS::HttpResponse<true>* response, const char* chunk, size_t chunk_length, bool, void*)>(handler);
      if (handler) {
        uwsRes->onData(opcional_data, onData);
      } else {
        uwsRes->onData(opcional_data, nullptr);
      }
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto onData = reinterpret_cast<void (*)(uWS::HttpResponse<false>* response, const char* chunk, size_t chunk_length, bool, void*)>(handler);
      if (handler) {
        uwsRes->onData(opcional_data, onData);
      } else {
        uwsRes->onData(opcional_data, nullptr);
      }
    }
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

  void uws_res_upgrade(int ssl, uws_res_r res, void *data,
                       const char *sec_web_socket_key,
                       size_t sec_web_socket_key_length,
                       const char *sec_web_socket_protocol,
                       size_t sec_web_socket_protocol_length,
                       const char *sec_web_socket_extensions,
                       size_t sec_web_socket_extensions_length,
                       uws_socket_context_t *ws)
  {
    if (ssl) {
    uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;

    uwsRes->template upgrade<void *>(
        data ? std::move(data) : NULL,
        stringViewFromC(sec_web_socket_key, sec_web_socket_key_length),
        stringViewFromC(sec_web_socket_protocol, sec_web_socket_protocol_length),
        stringViewFromC(sec_web_socket_extensions,
                         sec_web_socket_extensions_length),
        (struct us_socket_context_t *)ws);
    } else {
    uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;

    uwsRes->template upgrade<void *>(
        data ? std::move(data) : NULL,
        stringViewFromC(sec_web_socket_key, sec_web_socket_key_length),
        stringViewFromC(sec_web_socket_protocol, sec_web_socket_protocol_length),
        stringViewFromC(sec_web_socket_extensions,
                         sec_web_socket_extensions_length),
        (struct us_socket_context_t *)ws);
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

  void uws_res_write_headers(int ssl, uws_res_r res, const StringPointer *names,
                             const StringPointer *values, size_t count,
                             const char *buf) nonnull_fn_decl;
  void uws_res_write_headers(int ssl, uws_res_r res, const StringPointer *names,
                             const StringPointer *values, size_t count,
                             const char *buf) 
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      for (size_t i = 0; i < count; i++)
      {
        uwsRes->writeHeader(stringViewFromC(&buf[names[i].off], names[i].len),
                            stringViewFromC(&buf[values[i].off], values[i].len));
      }
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      for (size_t i = 0; i < count; i++)
      {
        uwsRes->writeHeader(stringViewFromC(&buf[names[i].off], names[i].len),
                            stringViewFromC(&buf[values[i].off], values[i].len));
      }
    }
  }

  void uws_res_uncork(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->uncork();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->uncork();
    }
  }

  void us_socket_mark_needs_more_not_ssl(uws_res_r res)
  {
    us_socket_r s = (us_socket_t *)res;
    s->context->loop->data.last_write_failed = 1;
    us_poll_change(&s->p, s->context->loop,
                   LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
  }

  void uws_res_override_write_offset(int ssl, uws_res_r res, uint64_t offset)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->setWriteOffset(offset); //TODO: when updated to master this will bechanged to overrideWriteOffset
    } else {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->setWriteOffset(offset); //TODO: when updated to master this will bechanged to overrideWriteOffset
    }
  }

__attribute__((callback (corker, ctx)))
  void uws_res_cork(int ssl, uws_res_r res, void *ctx,
                    void (*corker)(void *ctx)) nonnull_fn_decl;

  void uws_res_cork(int ssl, uws_res_r res, void *ctx,
                    void (*corker)(void *ctx))
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->cork([ctx, corker]()
                   { corker(ctx); });
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->cork([ctx, corker]()
                   { corker(ctx); });
    }
  }

  void uws_res_prepare_for_sendfile(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->writeMark();
      auto pair = uwsRes->getSendBuffer(2);
      char *ptr = pair.first;
      ptr[0] = '\r';
      ptr[1] = '\n';
      uwsRes->uncork();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->writeMark();
      auto pair = uwsRes->getSendBuffer(2);
      char *ptr = pair.first;
      ptr[0] = '\r';
      ptr[1] = '\n';
      uwsRes->uncork();
    }
  }

  bool uws_res_try_end(int ssl, uws_res_r res, const char *bytes, size_t len,
                       size_t total_len, bool close)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto pair = uwsRes->tryEnd(stringViewFromC(bytes, len), total_len, close);
      if (pair.first) {
        uwsRes->clearOnWritableAndAborted();
      }

      return pair.first;
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto pair = uwsRes->tryEnd(stringViewFromC(bytes, len), total_len, close);
      if (pair.first) {
          uwsRes->clearOnWritableAndAborted();
      }

      return pair.first;
    }
  }

  int uws_res_state(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      return uwsRes->getHttpResponseData()->state;
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      return uwsRes->getHttpResponseData()->state;
    }
  }

  void *uws_res_get_native_handle(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      return uwsRes->getNativeHandle();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      return uwsRes->getNativeHandle();
    }
  }

  size_t uws_ws_memory_cost(int ssl, uws_websocket_t *ws) {
    if (ssl) {
      return ((TLSWebSocket*)ws)->memoryCost();
    } else {
      return ((TCPWebSocket*)ws)->memoryCost();
    }
  }

  void us_socket_sendfile_needs_more(us_socket_r s) {
    s->context->loop->data.last_write_failed = 1;
    us_poll_change(&s->p, s->context->loop, LIBUS_SOCKET_READABLE | LIBUS_SOCKET_WRITABLE);
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

  // we need to manually call this at thread exit
  extern "C" void bun_clear_loop_at_thread_exit() {
      uWS::Loop::clearLoopAtThreadExit();
  }
}
