#ifndef BUN_NATIVE_BUNDLER_PLUGIN_API_H
#define BUN_NATIVE_BUNDLER_PLUGIN_API_H

#include <stddef.h>
#include <stdint.h>

typedef enum {
  BUN_LOADER_JSX = 0,
  BUN_LOADER_JS = 1,
  BUN_LOADER_TS = 2,
  BUN_LOADER_TSX = 3,
  BUN_LOADER_CSS = 4,
  BUN_LOADER_FILE = 5,
  BUN_LOADER_JSON = 6,
  BUN_LOADER_TOML = 7,
  BUN_LOADER_WASM = 8,
  BUN_LOADER_NAPI = 9,
  BUN_LOADER_BASE64 = 10,
  BUN_LOADER_DATAURL = 11,
  BUN_LOADER_TEXT = 12,
} BunLoader;

const BunLoader BUN_LOADER_MAX = BUN_LOADER_TEXT;

typedef struct BunLogOptions {
  size_t __struct_size;
  const uint8_t *message_ptr;
  size_t message_len;
  const uint8_t *path_ptr;
  size_t path_len;
  const uint8_t *source_line_text_ptr;
  size_t source_line_text_len;
  int8_t level;
  int line;
  int lineEnd;
  int column;
  int columnEnd;
} BunLogOptions;

typedef struct {
  size_t __struct_size;
  void *bun;
  const uint8_t *path_ptr;
  size_t path_len;
  const uint8_t *namespace_ptr;
  size_t namespace_len;
  uint8_t default_loader;
  void *external;
} OnBeforeParseArguments;

typedef struct OnBeforeParseResult {
  size_t __struct_size;
  uint8_t *source_ptr;
  size_t source_len;
  uint8_t loader;
  int (*fetchSourceCode)(const OnBeforeParseArguments *args,
                         struct OnBeforeParseResult *result);
  void *plugin_source_code_context;
  void (*free_plugin_source_code_context)(void *ctx);
  void (*log)(const OnBeforeParseArguments *args, BunLogOptions *options);
} OnBeforeParseResult;

typedef enum {
  BUN_LOG_LEVEL_VERBOSE = 0,
  BUN_LOG_LEVEL_DEBUG = 1,
  BUN_LOG_LEVEL_INFO = 2,
  BUN_LOG_LEVEL_WARN = 3,
  BUN_LOG_LEVEL_ERROR = 4,
} BunLogLevel;

const BunLogLevel BUN_LOG_MAX = BUN_LOG_LEVEL_ERROR;

#endif // BUN_NATIVE_BUNDLER_PLUGIN_API_H
