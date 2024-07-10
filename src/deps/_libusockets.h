#pragma once

#ifndef LIBUWS_CAPI_HEADER
#define LIBUWS_CAPI_HEADER

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef STRING_POINTER
#define STRING_POINTER
typedef struct StringPointer {
  uint32_t off;
  uint32_t len;
} StringPointer;
#endif

#ifdef __cplusplus
extern "C" {
#endif

enum uws_compress_options_t : int32_t {
  /* These are not actual compression options */
  _COMPRESSOR_MASK = 0x00FF,
  _DECOMPRESSOR_MASK = 0x0F00,
  /* Disabled, shared, shared are "special" values */
  DISABLED = 0,
  SHARED_COMPRESSOR = 1,
  SHARED_DECOMPRESSOR = 1 << 8,
  /* Highest 4 bits describe decompressor */
  DEDICATED_DECOMPRESSOR_32KB = 15 << 8,
  DEDICATED_DECOMPRESSOR_16KB = 14 << 8,
  DEDICATED_DECOMPRESSOR_8KB = 13 << 8,
  DEDICATED_DECOMPRESSOR_4KB = 12 << 8,
  DEDICATED_DECOMPRESSOR_2KB = 11 << 8,
  DEDICATED_DECOMPRESSOR_1KB = 10 << 8,
  DEDICATED_DECOMPRESSOR_512B = 9 << 8,
  /* Same as 32kb */
  DEDICATED_DECOMPRESSOR = 15 << 8,

  /* Lowest 8 bit describe compressor */
  DEDICATED_COMPRESSOR_3KB = 9 << 4 | 1,
  DEDICATED_COMPRESSOR_4KB = 9 << 4 | 2,
  DEDICATED_COMPRESSOR_8KB = 10 << 4 | 3,
  DEDICATED_COMPRESSOR_16KB = 11 << 4 | 4,
  DEDICATED_COMPRESSOR_32KB = 12 << 4 | 5,
  DEDICATED_COMPRESSOR_64KB = 13 << 4 | 6,
  DEDICATED_COMPRESSOR_128KB = 14 << 4 | 7,
  DEDICATED_COMPRESSOR_256KB = 15 << 4 | 8,
  /* Same as 256kb */
  DEDICATED_COMPRESSOR = 15 << 4 | 8
};

enum uws_opcode_t : int32_t {
  CONTINUATION = 0,
  TEXT = 1,
  BINARY = 2,
  CLOSE = 8,
  PING = 9,
  PONG = 10
};

enum uws_sendstatus_t : uint32_t { BACKPRESSURE, SUCCESS, DROPPED };

typedef struct {

  int port;
  const char *host;
  int options;
} uws_app_listen_config_t;

struct uws_app_s;
struct uws_req_s;
struct uws_res_s;
struct uws_websocket_s;
struct uws_header_iterator_s;
typedef struct uws_app_s uws_app_t;
typedef struct uws_req_s uws_req_t;
typedef struct uws_res_s uws_res_t;
typedef struct uws_socket_context_s uws_socket_context_t;
typedef struct uws_websocket_s uws_websocket_t;

typedef void (*uws_websocket_handler)(uws_websocket_t *ws);
typedef void (*uws_websocket_message_handler)(uws_websocket_t *ws,
                                              const char *message,
                                              size_t length,
                                              uws_opcode_t opcode);
typedef void (*uws_websocket_ping_pong_handler)(uws_websocket_t *ws,
                                                const char *message,
                                                size_t length);
typedef void (*uws_websocket_close_handler)(uws_websocket_t *ws, int code,
                                            const char *message, size_t length);
typedef void (*uws_websocket_upgrade_handler)(void *, uws_res_t *response,
                                              uws_req_t *request,
                                              uws_socket_context_t *context,
                                              size_t id);

typedef struct {
  uws_compress_options_t compression;
  /* Maximum message size we can receive */
  unsigned int maxPayloadLength;
  /* 2 minutes timeout is good */
  unsigned short idleTimeout;
  /* 64kb backpressure is probably good */
  unsigned int maxBackpressure;
  bool closeOnBackpressureLimit;
  /* This one depends on kernel timeouts and is a bad default */
  bool resetIdleTimeoutOnSend;
  /* A good default, esp. for newcomers */
  bool sendPingsAutomatically;
  /* Maximum socket lifetime in seconds before forced closure (defaults to
   * disabled) */
  unsigned short maxLifetime;

  uws_websocket_upgrade_handler upgrade;
  uws_websocket_handler open;
  uws_websocket_message_handler message;
  uws_websocket_handler drain;
  uws_websocket_ping_pong_handler ping;
  uws_websocket_ping_pong_handler pong;
  uws_websocket_close_handler close;
} uws_socket_behavior_t;

typedef void (*uws_listen_handler)(struct us_listen_socket_t *listen_socket,
                                   void *user_data);
typedef void (*uws_listen_domain_handler)(
    struct us_listen_socket_t *listen_socket, const char *domain, int options,
    void *user_data);

typedef void (*uws_method_handler)(uws_res_t *response, uws_req_t *request,
                                   void *user_data);
typedef void (*uws_filter_handler)(uws_res_t *response, int, void *user_data);
typedef void (*uws_missing_server_handler)(const char *hostname,
                                           void *user_data);
typedef void (*uws_get_headers_server_handler)(const char *header_name,
                                               size_t header_name_size,
                                               const char *header_value,
                                               size_t header_value_size,
                                               void *user_data);

// Basic HTTP
uws_app_t *uws_create_app(int ssl,
                          struct us_bun_socket_context_options_t options);

void uws_app_destroy(int ssl, uws_app_t *app);
void uws_app_get(int ssl, uws_app_t *app, const char *pattern,
                 uws_method_handler handler, void *user_data);
void uws_app_post(int ssl, uws_app_t *app, const char *pattern,
                  uws_method_handler handler, void *user_data);
void uws_app_options(int ssl, uws_app_t *app, const char *pattern,
                     uws_method_handler handler, void *user_data);
void uws_app_delete(int ssl, uws_app_t *app, const char *pattern,
                    uws_method_handler handler, void *user_data);
void uws_app_patch(int ssl, uws_app_t *app, const char *pattern,
                   uws_method_handler handler, void *user_data);
void uws_app_put(int ssl, uws_app_t *app, const char *pattern,
                 uws_method_handler handler, void *user_data);
void uws_app_head(int ssl, uws_app_t *app, const char *pattern,
                  uws_method_handler handler, void *user_data);
void uws_app_connect(int ssl, uws_app_t *app, const char *pattern,
                     uws_method_handler handler, void *user_data);
void uws_app_trace(int ssl, uws_app_t *app, const char *pattern,
                   uws_method_handler handler, void *user_data);
void uws_app_any(int ssl, uws_app_t *app, const char *pattern,
                 uws_method_handler handler, void *user_data);

void uws_app_run(int ssl, uws_app_t *);

void uws_app_listen(int ssl, uws_app_t *app, int port,
                    uws_listen_handler handler, void *user_data);
void uws_app_listen_with_config(int ssl, uws_app_t *app, const char *host,
                                uint16_t port, int32_t options,
                                uws_listen_handler handler, void *user_data);
void uws_app_listen_domain(int ssl, uws_app_t *app, const char *domain,
                           size_t pathlen, uws_listen_domain_handler handler,
                           void *user_data);

void uws_app_listen_domain_with_options(int ssl, uws_app_t *app,
                                        const char *domain, size_t pathlen,
                                        int options,
                                        uws_listen_domain_handler handler,
                                        void *user_data);
void uws_app_domain(int ssl, uws_app_t *app, const char *server_name);

bool uws_constructor_failed(int ssl, uws_app_t *app);

unsigned int uws_num_subscribers(int ssl, uws_app_t *app, const char *topic,
                                 size_t topic_length);
bool uws_publish(int ssl, uws_app_t *app, const char *topic,
                 size_t topic_length, const char *message,
                 size_t message_length, uws_opcode_t opcode, bool compress);
void *uws_get_native_handle(int ssl, uws_app_t *app);
void uws_remove_server_name(int ssl, uws_app_t *app,
                            const char *hostname_pattern);
void uws_add_server_name(int ssl, uws_app_t *app, const char *hostname_pattern);
void uws_add_server_name_with_options(
    int ssl, uws_app_t *app, const char *hostname_pattern,
    struct us_bun_socket_context_options_t options);
void uws_missing_server_name(int ssl, uws_app_t *app,
                             uws_missing_server_handler handler,
                             void *user_data);
void uws_filter(int ssl, uws_app_t *app, uws_filter_handler handler,
                void *user_data);

// WebSocket
void uws_ws(int ssl, uws_app_t *app, void *upgradeCtx, const char *pattern,
            size_t pattern_length, size_t id,
            const uws_socket_behavior_t *behavior);
void *uws_ws_get_user_data(int ssl, uws_websocket_t *ws);
void uws_ws_close(int ssl, uws_websocket_t *ws);
uws_sendstatus_t uws_ws_send(int ssl, uws_websocket_t *ws, const char *message,
                             size_t length, uws_opcode_t opcode);
uws_sendstatus_t uws_ws_send_with_options(int ssl, uws_websocket_t *ws,
                                          const char *message, size_t length,
                                          uws_opcode_t opcode, bool compress,
                                          bool fin);
uws_sendstatus_t uws_ws_send_fragment(int ssl, uws_websocket_t *ws,
                                      const char *message, size_t length,
                                      bool compress);
uws_sendstatus_t uws_ws_send_first_fragment(int ssl, uws_websocket_t *ws,
                                            const char *message, size_t length,
                                            bool compress);
uws_sendstatus_t
uws_ws_send_first_fragment_with_opcode(int ssl, uws_websocket_t *ws,
                                       const char *message, size_t length,
                                       uws_opcode_t opcode, bool compress);
uws_sendstatus_t uws_ws_send_last_fragment(int ssl, uws_websocket_t *ws,
                                           const char *message, size_t length,
                                           bool compress);
void uws_ws_end(int ssl, uws_websocket_t *ws, int code, const char *message,
                size_t length);
void uws_ws_cork(int ssl, uws_websocket_t *ws, void (*handler)(void *user_data),
                 void *user_data);
bool uws_ws_subscribe(int ssl, uws_websocket_t *ws, const char *topic,
                      size_t length);
bool uws_ws_unsubscribe(int ssl, uws_websocket_t *ws, const char *topic,
                        size_t length);
bool uws_ws_is_subscribed(int ssl, uws_websocket_t *ws, const char *topic,
                          size_t length);
void uws_ws_iterate_topics(int ssl, uws_websocket_t *ws,
                           void (*callback)(const char *topic, size_t length,
                                            void *user_data),
                           void *user_data);
bool uws_ws_publish(int ssl, uws_websocket_t *ws, const char *topic,
                    size_t topic_length, const char *message,
                    size_t message_length);
bool uws_ws_publish_with_options(int ssl, uws_websocket_t *ws,
                                 const char *topic, size_t topic_length,
                                 const char *message, size_t message_length,
                                 uws_opcode_t opcode, bool compress);
unsigned int uws_ws_get_buffered_amount(int ssl, uws_websocket_t *ws);
size_t uws_ws_get_remote_address(int ssl, uws_websocket_t *ws,
                                 const char **dest);
size_t uws_ws_get_remote_address_as_text(int ssl, uws_websocket_t *ws,
                                         const char **dest);

// Response
void uws_res_end(int ssl, uws_res_t *res, const char *data, size_t length,
                 bool close_connection);
void uws_res_pause(int ssl, uws_res_t *res);
void uws_res_resume(int ssl, uws_res_t *res);
void uws_res_write_continwue(int ssl, uws_res_t *res);
void uws_res_write_status(int ssl, uws_res_t *res, const char *status,
                          size_t length);
void uws_res_write_header(int ssl, uws_res_t *res, const char *key,
                          size_t key_length, const char *value,
                          size_t value_length);

void uws_res_write_header_int(int ssl, uws_res_t *res, const char *key,
                              size_t key_length, uint64_t value);
void uws_res_end_without_body(int ssl, uws_res_t *res, bool close_connection);
void uws_res_end_stream(int ssl, uws_res_t *res, bool close_connection);
bool uws_res_write(int ssl, uws_res_t *res, const char *data, size_t length);
uint64_t uws_res_get_write_offset(int ssl, uws_res_t *res);
bool uws_res_has_responded(int ssl, uws_res_t *res);
void uws_res_on_writable(int ssl, uws_res_t *res,
                         bool (*handler)(uws_res_t *res, uint64_t,
                                         void *opcional_data),
                         void *user_data);
void uws_res_on_aborted(int ssl, uws_res_t *res,
                        void (*handler)(uws_res_t *res, void *opcional_data),
                        void *opcional_data);
void uws_res_on_data(int ssl, uws_res_t *res,
                     void (*handler)(uws_res_t *res, const char *chunk,
                                     size_t chunk_length, bool is_end,
                                     void *opcional_data),
                     void *opcional_data);
void uws_res_upgrade(int ssl, uws_res_t *res, void *data,
                     const char *sec_web_socket_key,
                     size_t sec_web_socket_key_length,
                     const char *sec_web_socket_protocol,
                     size_t sec_web_socket_protocol_length,
                     const char *sec_web_socket_extensions,
                     size_t sec_web_socket_extensions_length,
                     uws_socket_context_t *ws);

// Request
bool uws_req_is_ancient(uws_req_t *res);
bool uws_req_get_yield(uws_req_t *res);
void uws_req_set_yield(uws_req_t *res, bool yield);
size_t uws_req_get_url(uws_req_t *res, const char **dest);
size_t uws_req_get_method(uws_req_t *res, const char **dest);
size_t uws_req_get_header(uws_req_t *res, const char *lower_case_header,
                          size_t lower_case_header_length, const char **dest);
size_t uws_req_get_query(uws_req_t *res, const char *key, size_t key_length,
                         const char **dest);
size_t uws_req_get_parameter(uws_req_t *res, unsigned short index,
                             const char **dest);
void uws_req_for_each_header(uws_req_t *res,
                             uws_get_headers_server_handler handler,
                             void *user_data);

struct us_loop_t *uws_get_loop();
struct us_loop_t *uws_get_loop_with_native(void *existing_native_loop);

void uws_loop_addPostHandler(us_loop_t *loop, void *ctx_,
                             void (*cb)(void *ctx, us_loop_t *loop));
void uws_loop_removePostHandler(us_loop_t *loop, void *key);
void uws_loop_addPreHandler(us_loop_t *loop, void *key,
                            void (*cb)(void *ctx, us_loop_t *loop));
void uws_loop_removePreHandler(us_loop_t *loop, void *ctx_);
void uws_loop_defer(us_loop_t *loop, void *ctx, void (*cb)(void *ctx));

void uws_res_write_headers(int ssl, uws_res_t *res, const StringPointer *names,
                           const StringPointer *values, size_t count,
                           const char *buf);

void *uws_res_get_native_handle(int ssl, uws_res_t *res);
void uws_res_uncork(int ssl, uws_res_t *res);
void us_socket_mark_needs_more_not_ssl(uws_res_t *res);
int uws_res_state(int ssl, uws_res_t *res);
bool uws_res_try_end(int ssl, uws_res_t *res, const char *bytes, size_t len,
                     size_t total_len, bool close);

void uws_res_prepare_for_sendfile(int ssl, uws_res_t *res);
void uws_res_override_write_offset(int ssl, uws_res_t *res, uint64_t offset);

void uws_app_close(int ssl, uws_app_t *app);

#ifdef __cplusplus
}
#endif

#endif
