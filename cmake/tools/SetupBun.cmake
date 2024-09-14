find_command(
  VARIABLE
    BUN_EXECUTABLE
  COMMAND
    bun
  PATHS
    $ENV{HOME}/.bun/bin
  VERSION
    >=1.1.26
)

# If this is not set, some advanced features are not checked.
# https://github.com/oven-sh/bun/blob/cd7f6a1589db7f1e39dc4e3f4a17234afbe7826c/src/bun.js/javascript.zig#L1069-L1072
setenv(BUN_GARBAGE_COLLECTOR_LEVEL 1)
setenv(BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING 1)
setenv(BUN_DEBUG_QUIET_LOGS 1)

# FIXME: https://github.com/oven-sh/bun/issues/11250
if(NOT WIN32)
  setenv(BUN_INSTALL_CACHE_DIR ${CACHE_PATH}/bun)
endif()
