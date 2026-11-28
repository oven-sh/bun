// clang-format off
#include "_libusockets.h"
#include "libusockets.h"
#include <bun-uws/src/App.h>
#include <bun-uws/src/AsyncSocket.h>
#include <bun-usockets/src/internal/internal.h>
#include <string_view>
#include <type_traits>

extern "C" size_t Bun__formatIpAddress(char (&buffer)[64], bool is_ipv6);

#define uws_res_r uws_res_t* nonnull_arg
static inline std::string_view stringViewFromC(const char* message, size_t length) {
  if(length) {
    return std::string_view(message, length);
  }

  return std::string_view();

}
/* For what is the same with and without TLS. */
static inline uWS::AsyncSocket<false> *asyncSocket(us_socket_t *s) {
  return (uWS::AsyncSocket<false> *)s;
}

/* Calls fn with std::true_type or std::false_type, for code that needs SSL as a template argument */
template <typename F>
__attribute__((always_inline)) static inline auto withSSL(int ssl, F &&fn)
{
  if (ssl)
  {
    return fn(std::true_type{});
  }
  return fn(std::false_type{});
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

  void uws_loop_flush_pending_writes(us_loop_t *loop) {
    ((uWS::Loop *) loop)->flushPendingWrites();
  }

  void uws_loop_add_tick_handler(const void *key, void (*handler)(const void *key)) {
    uWS::Loop::get()->addTickHandler(key, handler);
  }

  void uws_loop_remove_tick_handler(const void *key) {
    uWS::Loop::get()->removeTickHandler(key);
  }

  const void *uws_loop_shared_deflate() {
    auto &shared = uWS::Loop::data((us_loop_t *)uWS::Loop::get())->sharedDeflate;
    if (!shared) shared.reset(Bun__SharedDeflate__create());
    return shared.get();
  }

  uws_app_t *uws_create_app(struct ssl_ctx_st *ssl_ctx, const void *web_sockets)
  {
    return withSSL(ssl_ctx != nullptr, [&](auto isSSL) {
      auto *app = uWS::TemplatedApp<isSSL>::create(ssl_ctx);
      app->webSockets = web_sockets;
      return (uws_app_t *)app;
    });
  }

  const void *uws_app_web_sockets(int ssl, uws_app_t *app)
  {
    return withSSL(ssl, [&](auto isSSL) { return ((uWS::TemplatedApp<isSSL> *)app)->webSockets; });
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

  void uws_app_get(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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

  void uws_app_post(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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

  void uws_app_options(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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

  void uws_app_delete(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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

  void uws_app_patch(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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

  void uws_app_put(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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
  void uws_app_connect(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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

  void uws_app_trace(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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

  size_t uws_res_get_buffered_amount(int ssl, uws_res_t *res) nonnull_fn_decl;

  size_t uws_res_get_buffered_amount(int ssl, uws_res_t *res)
  {
      if (ssl) {
        uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
        return uwsRes->getBufferedAmount();
      } else {
        uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
        return uwsRes->getBufferedAmount();
      }
  }

  bool uws_res_has_fully_drained(int ssl, uws_res_r res)
  {
      if (ssl) {
        uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
        return uwsRes->hasFullyDrained();
      } else {
        uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
        return uwsRes->hasFullyDrained();
      }
  }

  void uws_app_any(int ssl, uws_app_t *app, const char *pattern_ptr, size_t pattern_len, uws_method_handler handler, void *user_data)
  {
    std::string_view pattern = std::string_view(pattern_ptr, pattern_len);
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

  void uws_app_close(int ssl, uws_app_t *app, int thread_ends)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->close(thread_ends);
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->close(thread_ends);
    }
  }

  size_t uws_app_close_idle(int ssl, uws_app_t *app, int close_when_idle)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      return uwsApp->closeIdle(close_when_idle != 0);
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      return uwsApp->closeIdle(close_when_idle != 0);
    }
  }

  void uws_app_set_on_clienterror(int ssl, uws_app_t *app, void (*handler)(void *user_data, int is_ssl, struct us_socket_t *rawSocket, uint8_t errorCode, char *rawPacket, int rawPacketLength), void *user_data)
  {
    if (ssl)
    {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      if (handler == nullptr) {
        uwsApp->setOnClientError(nullptr);
        return;
      }
      uwsApp->setOnClientError([handler, user_data](int is_ssl, struct us_socket_t *rawSocket, uint8_t errorCode, char *rawPacket, int rawPacketLength) {
        handler(user_data, is_ssl, rawSocket, errorCode, rawPacket, rawPacketLength);
      });
    }
    else
    {
      uWS::App *uwsApp = (uWS::App *)app;
      if (handler == nullptr) {
        uwsApp->setOnClientError(nullptr);
        return;
      }
      uwsApp->setOnClientError([handler, user_data](int is_ssl, struct us_socket_t *rawSocket, uint8_t errorCode, char *rawPacket, int rawPacketLength) {
        handler(user_data, is_ssl, rawSocket, errorCode, rawPacket, rawPacketLength);
      });
    }
  }

  struct us_listen_socket_t *uws_app_listen_with_config(int ssl, uws_app_t *app, const char *host,
                                                        uint16_t port, int32_t options,
                                                        int *error, int *dns_error)
  {
    if (host && !host[0])
    {
      host = nullptr;
    }
    if (ssl)
    {
      return ((uWS::SSLApp *)app)->listen(host, port, options, error, dns_error);
    }
    return ((uWS::App *)app)->listen(host, port, options, error, dns_error);
  }

  struct us_listen_socket_t *uws_app_listen_domain_with_options(int ssl, uws_app_t *app, const char *domain, size_t pathlen, int options, int *error)
  {
    if (ssl)
    {
      return ((uWS::SSLApp *)app)->listen_unix({domain, pathlen}, options, error);
    }
    return ((uWS::App *)app)->listen_unix({domain, pathlen}, options, error);
  }

  struct us_listen_socket_t *uws_app_listen_fd(int ssl, uws_app_t *app, LIBUS_SOCKET_DESCRIPTOR fd, int options, int *error)
  {
    if (ssl)
    {
      return ((uWS::SSLApp *)app)->listen_fd(fd, options, error);
    }
    return ((uWS::App *)app)->listen_fd(fd, options, error);
  }

  void uws_app_set_idle_timeout(int ssl, uws_app_t *app, uint8_t seconds) {
    if (ssl) {
      ((uWS::SSLApp *)app)->setIdleTimeout(seconds);
    } else {
      ((uWS::App *)app)->setIdleTimeout(seconds);
    }
  }
  void uws_app_set_max_http_header_size(int ssl, uws_app_t *app, uint64_t max_header_size) {
    if (ssl) {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->setMaxHTTPHeaderSize(max_header_size);
    } else {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->setMaxHTTPHeaderSize(max_header_size);
    }
  }
  void uws_app_set_max_request_body_size(int ssl, uws_app_t *app, uint64_t max_request_body_size) {
    if (ssl) {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->setMaxRequestBodySize(max_request_body_size);
    } else {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->setMaxRequestBodySize(max_request_body_size);
    }
  }
  void uws_app_set_max_headers_count(int ssl, uws_app_t *app, uint32_t max_headers_count) {
    if (ssl) {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->setMaxHeadersCount(max_headers_count);
    } else {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->setMaxHeadersCount(max_headers_count);
    }
  }
  void uws_app_set_flags(int ssl, uws_app_t *app, uint8_t lenient_http_flags, bool http_allow_half_open) {
    if (ssl) {
      uWS::SSLApp *uwsApp = (uWS::SSLApp *)app;
      uwsApp->setFlags(lenient_http_flags, http_allow_half_open);
    } else {
      uWS::App *uwsApp = (uWS::App *)app;
      uwsApp->setFlags(lenient_http_flags, http_allow_half_open);
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

  void uws_add_server_name(uws_app_t *app, const char *hostname_pattern, struct ssl_ctx_st *ssl_ctx, bool own_client_auth)
  {
    ((uWS::SSLApp *)app)->addServerName(hostname_pattern, ssl_ctx, own_client_auth);
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

  void uws_app_ws(int ssl, uws_app_t *app, const char *pattern, size_t pattern_length,
                  uws_websocket_upgrade_handler handler, void *user_data, const void *context, size_t id)
  {
    withSSL(ssl, [&](auto isSSL) {
      ((uWS::TemplatedApp<isSSL> *)app)->ws(stringViewFromC(pattern, pattern_length), [=](auto *res, auto *req)
                                            { handler(user_data, (uws_res_t *)res, (uws_req_t *)req, context, id); });
    });
  }

  void uws_socket_on_upgraded_close(us_socket_r s)
  {
    asyncSocket(s)->uncorkWithoutSending();
    auto *data = (uWS::UpgradedSocketData *)us_socket_ext(s);
    if (data->onSocketClosed)
      data->onSocketClosed(data->socketData, s);
  }

  us_socket_t *uws_socket_next(us_socket_r s) { return s->next; }
  bool uws_socket_is_paused(us_socket_r s) { return s->flags.is_paused; }
  void uws_socket_cork(us_socket_r s) { asyncSocket(s)->cork(); }
  bool uws_socket_uncork(us_socket_r s) { return asyncSocket(s)->uncork().second; }
  void uws_socket_uncork_without_sending(us_socket_r s) { asyncSocket(s)->uncorkWithoutSending(); }
  bool uws_socket_is_corked(us_socket_r s) { return asyncSocket(s)->isCorked(); }

  bool uws_socket_has_corked_bytes(us_socket_r s)
  {
    uWS::LoopData *loopData = asyncSocket(s)->getLoopData();
    int slot = loopData->findCorkSlot(s);
    return slot != uWS::LoopData::INVALID_CORK_SLOT && loopData->getCorkSlot(slot)->offset;
  }

  char *uws_socket_send_buffer(us_socket_r s, size_t length, uWS::SendBufferAttribute *attribute)
  {
    auto [buffer, needs] = asyncSocket(s)->getSendBuffer(length);
    *attribute = needs;
    return buffer;
  }

  bool uws_socket_write(us_socket_r s, const us_iovec_t *bytes)
  {
    return asyncSocket(s)->write((const char *)bytes->iov_base, bytes->iov_len).second;
  }

  void uws_socket_buffer(us_socket_r s, const us_iovec_t *bytes)
  {
    asyncSocket(s)->getAsyncSocketData()->buffer.append((const char *)bytes->iov_base, bytes->iov_len);
  }

  size_t uws_socket_buffered_amount(us_socket_r s) { return asyncSocket(s)->getBufferedAmount(); }
  size_t uws_socket_buffer_capacity(us_socket_r s) { return asyncSocket(s)->getAsyncSocketData()->buffer.totalLength(); }
  void uws_socket_clear_buffer(us_socket_r s) { asyncSocket(s)->getAsyncSocketData()->buffer.clear(); }

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
    /* No-op on a closed socket; see uws_res_on_aborted. */
    if (us_socket_is_closed((struct us_socket_t *)res))
    {
      return;
    }
    withSSL(ssl, [&](auto isSSL) {
      constexpr bool SSL = decltype(isSSL)::value;
      ((uWS::HttpResponse<SSL> *)res)->pauseReads(uWS::HttpResponseData<SSL>::READ_PAUSE_BODY);
    });
  }

  bool uws_res_is_paused(int ssl, uws_res_r res)
  {
    if (us_socket_is_closed((struct us_socket_t *)res))
    {
      return false;
    }
    return withSSL(ssl, [&](auto isSSL) {
      constexpr bool SSL = decltype(isSSL)::value;
      return (((uWS::HttpResponse<SSL> *)res)->getHttpResponseData()->readPauseReasons & (uWS::HttpResponseData<SSL>::READ_PAUSE_BODY | uWS::HttpResponseData<SSL>::READ_PAUSE_SOCKET)) != 0;
    });
  }

  void uws_res_resume(int ssl, uws_res_r res)
  {
    /* No-op on a closed socket; see uws_res_on_aborted. */
    if (us_socket_is_closed((struct us_socket_t *)res))
    {
      return;
    }
    withSSL(ssl, [&](auto isSSL) {
      constexpr bool SSL = decltype(isSSL)::value;
      ((uWS::HttpResponse<SSL> *)res)->resumeReads(uWS::HttpResponseData<SSL>::READ_PAUSE_BODY);
    });
  }

  void uws_res_write_informational(int ssl, uws_res_r res, const char *data,
                                   size_t length)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->writeRawInformational(stringViewFromC(data, length));
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->writeRawInformational(stringViewFromC(data, length));
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

  void uws_res_mark_fixed_length_file_body(int ssl, uws_res_r res) {
    if (ssl) {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->getHttpResponseData()->state |= uWS::HttpResponseData<true>::HTTP_FIXED_LENGTH_FILE_BODY;
    } else {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->getHttpResponseData()->state |= uWS::HttpResponseData<false>::HTTP_FIXED_LENGTH_FILE_BODY;
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
      if (close_connection)
      {
        data->state |= uWS::HttpResponseData<true>::HTTP_CONNECTION_CLOSE;
      }
      data->state |= uWS::HttpResponseData<true>::HTTP_END_CALLED;
      data->markDone(uwsRes);
      uwsRes->resetTimeout();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto *data = uwsRes->getHttpResponseData();
      data->offset = offset;
      if (close_connection)
      {
        data->state |= uWS::HttpResponseData<false>::HTTP_CONNECTION_CLOSE;
      }
      data->state |= uWS::HttpResponseData<false>::HTTP_END_CALLED;
      data->markDone(uwsRes);
      uwsRes->resetTimeout();
    }
  }
  /* Completion gate for response-end paths that bypass internalEnd (the
   * sendfile path): closes the socket when the connection is marked to close
   * (Connection: close, peer FIN, close-when-idle), the response is complete,
   * and every outgoing byte has been flushed. Corked responses are left to the
   * cork() wrapper's own post-uncork gate. */
  void uws_res_close_if_done_and_marked(int ssl, uws_res_r res)
  {
    /* A callback upstream of this gate may already have closed the socket;
     * onClose destructs the ext block, so bail before touching it. */
    if (us_socket_is_closed((struct us_socket_t *)res))
    {
      return;
    }
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      if (!uwsRes->AsyncSocket<true>::isCorked())
      {
        uwsRes->closeIfDoneAndMarked(uwsRes->getHttpResponseData());
      }
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      if (!uwsRes->AsyncSocket<false>::isCorked())
      {
        uwsRes->closeIfDoneAndMarked(uwsRes->getHttpResponseData());
      }
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

  /* No close gate: callers keep using the response, so a corked one relies on cork()'s gate and the others call uws_res_close_if_done_and_marked. */
  void uws_res_end_without_body(int ssl, uws_res_r res, bool close_connection)
  {
    withSSL(ssl, [&](auto isSSL) {
      using Response = uWS::HttpResponse<decltype(isSSL)::value>;
      ((Response *)res)->endWithoutBody(Response::NO_BODY, close_connection);
    });
  }

  bool uws_res_accept_request_body(int ssl, uws_res_r res)
  {
    return withSSL(ssl, [&](auto isSSL) {
      return ((uWS::HttpResponse<decltype(isSSL)::value> *)res)->acceptRequestBody();
    });
  }

  /* The response to a HEAD whose GET would stream its body. */
  void uws_res_end_head_of_stream(int ssl, uws_res_r res, bool close_connection)
  {
    withSSL(ssl, [&](auto isSSL) {
      using Response = uWS::HttpResponse<decltype(isSSL)::value>;
      ((Response *)res)->endWithoutBody(Response::UNKNOWN_LENGTH, close_connection);
    });
  }

  /* uws_res_end_without_body(res, true) without its writes, which would complete a head that node:http's destroy() gave up on. */
  void uws_res_abandon(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto *data = uwsRes->getHttpResponseData();
      data->state |= uWS::HttpResponseData<true>::HTTP_CONNECTION_CLOSE | uWS::HttpResponseData<true>::HTTP_END_CALLED;
      data->markDone(uwsRes);
      uwsRes->resetTimeout();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto *data = uwsRes->getHttpResponseData();
      data->state |= uWS::HttpResponseData<false>::HTTP_CONNECTION_CLOSE | uWS::HttpResponseData<false>::HTTP_END_CALLED;
      data->markDone(uwsRes);
      uwsRes->resetTimeout();
    }
  }

  bool uws_res_write(int ssl, uws_res_r res, const char *data, size_t *length) nonnull_fn_decl;

  bool uws_res_write(int ssl, uws_res_r res, const char *data, size_t *length)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      if (*length < 16 * 1024 && *length > 0) {
        if (!uwsRes->uWS::AsyncSocket<true>::isCorked()) {
          uwsRes->uWS::AsyncSocket<true>::cork();
        }
      }
      return uwsRes->write(stringViewFromC(data, *length), length);
    }
    uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
    if (*length < 16 * 1024 && *length > 0) {
        if (!uwsRes->uWS::AsyncSocket<false>::isCorked()) {
          uwsRes->uWS::AsyncSocket<false>::cork();
        }
      }
    return uwsRes->write(stringViewFromC(data, *length), length);
  }
  size_t uws_res_try_write_body(int ssl, uws_res_r res, const char *data, size_t length, bool is_first) nonnull_fn_decl;

  size_t uws_res_try_write_body(int ssl, uws_res_r res, const char *data, size_t length, bool is_first)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      return uwsRes->tryWriteBody(stringViewFromC(data, length), is_first);
    }
    uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
    return uwsRes->tryWriteBody(stringViewFromC(data, length), is_first);
  }

  void uws_res_spill_body(int ssl, uws_res_r res, const char *data, size_t length) nonnull_fn_decl;

  void uws_res_spill_body(int ssl, uws_res_r res, const char *data, size_t length)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->spillBodyTail(stringViewFromC(data, length));
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->spillBodyTail(stringViewFromC(data, length));
    }
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
                                           void *optional_data),
                           void *optional_data)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto onWritable = reinterpret_cast<bool (*)(uWS::HttpResponse<true>*, uint64_t, void*)>(handler);
      uwsRes->onWritable(optional_data, onWritable);
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto onWritable = reinterpret_cast<bool (*)(uWS::HttpResponse<false>*, uint64_t, void*)>(handler);
      uwsRes->onWritable(optional_data, onWritable);
    }
  }

  void uws_res_clear_on_writable(int ssl, uws_res_r res) {
    /* No-op on a closed socket; see uws_res_on_aborted. */
    if (us_socket_is_closed((struct us_socket_t *)res)) {
      return;
    }
    if (ssl) {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->clearOnWritable();
    } else {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->clearOnWritable();
    }
  }

  void uws_res_on_aborted(int ssl, uws_res_r res,
                          void (*handler)(uws_res_r res, void *optional_data),
                          void *optional_data)
  {
    /* HttpContext::onClose calls the handlers that are set, then destructs the
     * ext block; registering or clearing one on a closed socket is a
     * no-op. Completion bookkeeping runs after ends that may have closed the
     * socket via a shouldCloseConnection() gate, so this must not touch ext. */
    if (us_socket_is_closed((struct us_socket_t *)res))
    {
      return;
    }
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto* onAborted = reinterpret_cast<void (*)(uWS::HttpResponse<true>*, void*)>(handler);
      if (handler)
      {
        uwsRes->onAborted(optional_data, onAborted);
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
        uwsRes->onAborted(optional_data, onAborted);
      }
      else
      {
        uwsRes->clearOnAborted();
      }
    }
  }

  void uws_res_on_timeout(int ssl, uws_res_r res,
                          void (*handler)(uws_res_r res, void *optional_data),
                          void *optional_data)
  {
    /* No-op on a closed socket; see uws_res_on_aborted. */
    if (us_socket_is_closed((struct us_socket_t *)res))
    {
      return;
    }
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto* onTimeout = reinterpret_cast<void (*)(uWS::HttpResponse<true>*, void*)>(handler);
      if (handler)
      {
        uwsRes->onTimeout(optional_data, onTimeout);
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
        uwsRes->onTimeout(optional_data, onTimeout);
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
                                       void *optional_data),
                       void *optional_data)
  {
    /* No-op on a closed socket; see uws_res_on_aborted. */
    if (us_socket_is_closed((struct us_socket_t *)res))
    {
      return;
    }
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto onData = reinterpret_cast<void (*)(uWS::HttpResponse<true>* response, const char* chunk, size_t chunk_length, bool, void*)>(handler);
      if (handler) {
        uwsRes->onData(optional_data, onData);
      } else {
        uwsRes->onData(optional_data, nullptr);
      }
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto onData = reinterpret_cast<void (*)(uWS::HttpResponse<false>* response, const char* chunk, size_t chunk_length, bool, void*)>(handler);
      if (handler) {
        uwsRes->onData(optional_data, onData);
      } else {
        uwsRes->onData(optional_data, nullptr);
      }
    }
  }

  void uws_req_set_yield(uws_req_t *res, bool yield)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
    return uwsReq->setYield(yield);
  }

  const void *uws_req_get_parsed(uws_req_t *res)
  {
    return ((uWS::HttpRequest *)res)->parsed;
  }

  size_t uws_req_get_parameter(uws_req_t *res, unsigned short index,
                               const char **dest)
  {
    uWS::HttpRequest *uwsReq = (uWS::HttpRequest *)res;
    std::string_view value = uwsReq->getParameter(index);
    *dest = value.data();
    return value.length();
  }

  void *uws_res_get_parser(int ssl, uws_res_r res)
  {
    if (ssl ? uWS::HttpContext<true>::isClosedOrUpgraded((us_socket_t *)res) : uWS::HttpContext<false>::isClosedOrUpgraded((us_socket_t *)res))
      return nullptr;
    if (ssl)
      return static_cast<uWS::HttpParser *>(((uWS::HttpResponse<true> *)res)->getHttpResponseData());
    return static_cast<uWS::HttpParser *>(((uWS::HttpResponse<false> *)res)->getHttpResponseData());
  }

  void uws_res_destroy_for_upgrade(int ssl, uws_res_r res)
  {
    withSSL(ssl, [&](auto isSSL) { ((uWS::HttpResponse<isSSL> *)res)->destroyForUpgrade(); });
  }

  void uws_res_end_upgrade_headers(int ssl, uws_res_r res)
  {
    withSSL(ssl, [&](auto isSSL) { ((uWS::HttpResponse<isSSL> *)res)->terminateHeaders(uWS::HttpResponse<isSSL>::NO_BODY); });
  }

  const char *uws_res_parked_bytes(int ssl, uws_res_r res, size_t *length)
  {
    return withSSL(ssl, [&](auto isSSL) {
      auto *data = ((uWS::HttpResponse<isSSL> *)res)->getHttpResponseData();
      auto parked = data->parkedRequestBytes.span().subspan(data->parkedRequestBytesStart);
      *length = parked.size();
      return parked.data();
    });
  }

  struct us_loop_t *uws_get_loop()
  {
    return (struct us_loop_t *)uWS::Loop::get();
  }
#ifndef _WIN32
  struct us_loop_t *uws_try_get_loop()
  {
    return (struct us_loop_t *)uWS::Loop::tryGet();
  }
#endif
  struct us_loop_t *uws_get_loop_with_native(void *existing_native_loop)
  {
      return (struct us_loop_t *)uWS::Loop::get(existing_native_loop);
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

  void uws_res_send_corked(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->sendCorked();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->sendCorked();
    }
  }

  void uws_res_send_when_complete(int ssl, uws_res_r res)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->sendWhenComplete();
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->sendWhenComplete();
    }
  }

  void uws_res_clear_handlers_of(int ssl, uws_res_r res, void *user_data)
  {
    /* No-op on a closed socket; see uws_res_on_aborted. */
    if (us_socket_is_closed((struct us_socket_t *)res))
    {
      return;
    }
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->clearHandlersOf(user_data);
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->clearHandlersOf(user_data);
    }
  }

  bool uws_res_close_after_message_if_parsing(int ssl, uws_res_r res, bool drop_corked)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      return uwsRes->closeAfterMessageIfParsing(drop_corked);
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      return uwsRes->closeAfterMessageIfParsing(drop_corked);
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

  void uws_res_request_writable(uws_res_r res)
  {
    ((uWS::HttpResponse<false> *)res)->requestWritable();
  }

  void uws_res_prepare_for_sendfile(int ssl, uws_res_r res)
  {
    withSSL(ssl, [&](auto isSSL) {
      auto *uwsRes = (uWS::HttpResponse<decltype(isSSL)::value> *)res;
      /* The caller declared the file's length. If sendfile(2) is refused, the rest of the body goes through write(). */
      uwsRes->startBody();
      uwsRes->uncork();
    });
  }

  bool uws_res_try_end(int ssl, uws_res_r res, const char *bytes, size_t len,
                       size_t total_len, bool close)
  {
    if (ssl)
    {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      auto pair = uwsRes->tryEnd(stringViewFromC(bytes, len), total_len, close);
      /* A completed tryEnd may have closed the socket through a
       * shouldCloseConnection() gate, destructing the ext; markDone already
       * cleared the callbacks in that case. */
      if (pair.first && !us_socket_is_closed((struct us_socket_t *)res)) {
        uwsRes->clearOnWritableAndAborted();
      }

      return pair.first;
    }
    else
    {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      auto pair = uwsRes->tryEnd(stringViewFromC(bytes, len), total_len, close);
      /* See the SSL arm above. */
      if (pair.first && !us_socket_is_closed((struct us_socket_t *)res)) {
          uwsRes->clearOnWritableAndAborted();
      }

      return pair.first;
    }
  }

  /* Returns the whole flags word: it no longer fits in a byte (HttpResponseData
   * carries the framing and node:http bits above bit 7), and Rust's State
   * mirrors it as a u32. */
  uint32_t uws_res_state(int ssl, uws_res_r res)
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

  void uws_res_flush_headers(int ssl, uws_res_r res, bool flushImmediately) {
    if (ssl) {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      uwsRes->flushHeaders(flushImmediately);
    } else {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      uwsRes->flushHeaders(flushImmediately);
    }
  }

  bool uws_res_is_connect_request(int ssl, uws_res_r res)
  {
    if (ssl) {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      return uwsRes->isConnectRequest();
    } else {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      return uwsRes->isConnectRequest();
    }
  }

  bool uws_res_is_corked(int ssl, uws_res_r res) {
    if (ssl) {
      uWS::HttpResponse<true> *uwsRes = (uWS::HttpResponse<true> *)res;
      return uwsRes->isCorked();
    } else {
      uWS::HttpResponse<false> *uwsRes = (uWS::HttpResponse<false> *)res;
      return uwsRes->isCorked();
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

  LIBUS_SOCKET_DESCRIPTOR us_socket_get_fd(us_socket_r s) {
    return us_poll_fd(&s->p);
  }

  // Gets the remote address and port
  // Returns 0 if failure / unix socket
  uint64_t uws_res_get_remote_address_info(uws_res_r res, const char **dest, int *port, bool *is_ipv6)
  {
    // This function is manual inlining + modification of
    //      us_socket_remote_address
    // To get { ip, port, is_ipv6 } for Bun.serve().requestIP()
    static thread_local char b[64];
    auto length = us_get_remote_address_info(b, (us_socket_t *)res, port);

    if (length == 0) return 0;
    *dest = b;
    *is_ipv6 = length != 4;
    return Bun__formatIpAddress(b, *is_ipv6);
  }

  // A thread that ran a uws loop (a Worker) is exiting; free its loop. On Windows the loop sits on
  // the thread's libuv loop, which the caller closes after this returns.
  extern "C" void bun_free_loop_at_thread_exit() {
      uWS::Loop::freeLoopAtThreadExit();
  }

#pragma clang attribute pop
}
