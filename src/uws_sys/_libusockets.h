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

typedef struct {

    int port;
    const char* host;
    int options;
} uws_app_listen_config_t;

struct uws_app_s;
struct uws_req_s;
struct uws_res_s;
typedef struct uws_app_s uws_app_t;
typedef struct uws_req_s uws_req_t;
typedef struct uws_res_s uws_res_t;

typedef void (*uws_websocket_upgrade_handler)(void*, uws_res_t* response,
    uws_req_t* request,
    const void* context,
    size_t id);

typedef void (*uws_method_handler)(uws_res_t* response, uws_req_t* request,
    void* user_data);
typedef void (*uws_filter_handler)(uws_res_t* response, int, void* user_data);

struct us_loop_t* uws_get_loop();

#ifdef __cplusplus
}
#endif

#endif
