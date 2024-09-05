include(Macros)

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

setenv(BUN_INSTALL_CACHE_DIR ${CACHE_PATH}/bun)

# If this is not set, some advanced features are not checked.
# https://github.com/oven-sh/bun/blob/cd7f6a1589db7f1e39dc4e3f4a17234afbe7826c/src/bun.js/javascript.zig#L1069-L1072
setenv(BUN_GARBAGE_COLLECTOR_LEVEL 1)
setenv(BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING 1)
setenv(BUN_DEBUG_QUIET_LOGS 1)

if(CMAKE_HOST_WIN32)
  setx(ESBUILD_EXECUTABLE ${CWD}/node_modules/.bin/esbuild.exe)
else()
  setx(ESBUILD_EXECUTABLE ${CWD}/node_modules/.bin/esbuild)
endif()

if(CMAKE_COLOR_DIAGNOSTICS)
  set(ESBUILD_ARGS --color)
endif()

register_command(
  COMMAND
    ${BUN_EXECUTABLE}
      install
      --frozen-lockfile
  SOURCES
    ${CWD}/package.json
  OUTPUTS
    ${ESBUILD_EXECUTABLE}
)
