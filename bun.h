#include <stddef.h>
#include <stdint.h>

typedef int8_t bun_log_level_t;
static const bun_log_level_t BunLogLevelError = 0;
static const bun_log_level_t BunLogLevelWarn = 1;
static const bun_log_level_t BunLogLevelInfo = 2;
static const bun_log_level_t BunLogLevelDebug = 3;

typedef uint8_t bun_loader_t;
static const bun_loader_t BunLoaderJsx = 0;
static const bun_loader_t BunLoaderJs = 1;
static const bun_loader_t BunLoaderTs = 2;
static const bun_loader_t BunLoaderTsx = 3;
static const bun_loader_t BunLoaderCss = 4;
static const bun_loader_t BunLoaderFile = 5;
static const bun_loader_t BunLoaderJson = 6;
static const bun_loader_t BunLoaderToml = 7;
static const bun_loader_t BunLoaderWasm = 8;
static const bun_loader_t BunLoaderNapi = 9;
static const bun_loader_t BunLoaderBase64 = 10;
static const bun_loader_t BunLoaderDataurl = 11;
static const bun_loader_t BunLoaderText = 12;

typedef uint8_t bun_target_t;
static const bun_target_t BunTargetBrowser = 0;
static const bun_target_t BunTargetNode = 1;
static const bun_target_t BunTargetBun = 2;

typedef struct BunLogOptions {
  const unsigned char *message_ptr;
  size_t message_len;

  const unsigned char *path_ptr;
  size_t path_len;

  const unsigned char *source_line_text_ptr;
  size_t source_line_text_len;

  bun_log_level_t level;

  int line;
  int lineEnd;
  int column;
  int columnEnd;
} BunLogOptions;

typedef struct OnBeforeParseArguments {
  void *bun;
  const unsigned char *path_ptr;
  size_t path_len;
  const unsigned char *namespace_ptr;
  size_t namespace_len;

  bun_loader_t default_loader;
} OnBeforeParseArguments;

typedef struct OnBeforeParseResult {
  unsigned char *source_ptr;
  size_t source_len;
  bun_loader_t loader;

  int (*const fetchSourceCode)(const OnBeforeParseArguments *args,
                               struct OnBeforeParseResult *result);

  void *plugin_source_code_context;
  void (*free_plugin_source_code_context)(void *context);

  void (*const log)(const OnBeforeParseArguments *args, BunLogOptions *options);
} OnBeforeParseResult;
