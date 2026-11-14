// A native plugin for onBeforeParse. `shout` writes LOUD! over every "quiet" in the text of a file, `count` also counts the files it
// has seen in the number that `external` points at, and `refuse` logs an error.
#include <node_api.h>
#include <stdlib.h>
#include <string.h>

#include "bundler_plugin.h"

#ifdef _WIN32
#define EXPORTED __declspec(dllexport)
#else
#define EXPORTED __attribute__((visibility("default")))
#endif

EXPORTED const char *BUN_PLUGIN_NAME = "shout";

EXPORTED void shout(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  if (result->fetchSourceCode(args, result) != 0) return;
  size_t length = result->source_len;
  uint8_t *text = malloc(length + 1);
  memcpy(text, result->source_ptr, length);
  for (size_t at = 0; at + 5 <= length; at++)
    if (memcmp(text + at, "quiet", 5) == 0) memcpy(text + at, "LOUD!", 5);
  result->source_ptr = text;
  result->source_len = length;
  result->plugin_source_code_context = text;
  result->free_plugin_source_code_context = free;
}

EXPORTED void count(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  if (args->external) __atomic_add_fetch((int32_t *)args->external, 1, __ATOMIC_SEQ_CST);
  shout(args, result);
}

EXPORTED void refuse(const OnBeforeParseArguments *args, OnBeforeParseResult *result) {
  static const char message[] = "the native plugin refuses this file";
  BunLogOptions options = {0};
  options.__struct_size = sizeof(options);
  options.message_ptr = (const uint8_t *)message;
  options.message_len = sizeof(message) - 1;
  options.path_ptr = args->path_ptr;
  options.path_len = args->path_len;
  options.level = BUN_LOG_LEVEL_ERROR;
  result->log(args, &options);
}

static void release(napi_env env, void *data, void *hint) { free(data); }

static napi_value create_counter(napi_env env, napi_callback_info info) {
  napi_value external;
  napi_create_external(env, calloc(1, sizeof(int32_t)), release, NULL, &external);
  return external;
}

static napi_value read_counter(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argument, number;
  void *counter;
  napi_get_cb_info(env, info, &argc, &argument, NULL, NULL);
  napi_get_value_external(env, argument, &counter);
  napi_create_int32(env, __atomic_load_n((int32_t *)counter, __ATOMIC_SEQ_CST), &number);
  return number;
}

NAPI_MODULE_INIT() {
  napi_value function;
  napi_create_function(env, "createCounter", NAPI_AUTO_LENGTH, create_counter, NULL, &function);
  napi_set_named_property(env, exports, "createCounter", function);
  napi_create_function(env, "readCounter", NAPI_AUTO_LENGTH, read_counter, NULL, &function);
  napi_set_named_property(env, exports, "readCounter", function);
  return exports;
}
