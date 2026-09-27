// Written by misctools/portable/loop/windows.ts. Do not edit.
//
// The functions of eventing/libuv.c that libuv calls: they have its calling convention.
#include "bun_windows_c.h"
static void BUN_WINDOWS_ABI poll_cb(uv_poll_t *p, int status, int events);
static void BUN_WINDOWS_ABI prepare_cb(uv_prepare_t *p);
static void BUN_WINDOWS_ABI check_cb(uv_check_t *p);
static void BUN_WINDOWS_ABI close_cb_free(uv_handle_t *h);
static void BUN_WINDOWS_ABI close_cb_free_poll(uv_handle_t *h);
static void BUN_WINDOWS_ABI timer_cb(uv_timer_t *t);
static void BUN_WINDOWS_ABI async_cb(uv_async_t *a);
