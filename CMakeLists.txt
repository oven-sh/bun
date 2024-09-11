cmake_minimum_required(VERSION 3.24)
message(STATUS "Configuring Bun")
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

list(APPEND CMAKE_MODULE_PATH
  ${CMAKE_SOURCE_DIR}/cmake
  ${CMAKE_SOURCE_DIR}/cmake/targets
  ${CMAKE_SOURCE_DIR}/cmake/tools
  ${CMAKE_SOURCE_DIR}/cmake/analysis
  ${CMAKE_SOURCE_DIR}/cmake/scripts
)

include(Policies)
include(Macros)

# --- Globals ---

setx(CWD ${CMAKE_SOURCE_DIR})
setx(BUILD_PATH ${CMAKE_BINARY_DIR})
optionx(CACHE_PATH STRING "The path to the cache directory" DEFAULT ${BUILD_PATH}/cache)
optionx(CACHE_STRATEGY "read-write|read-only|write-only|none" "The strategy to use for caching" DEFAULT "read-write")
optionx(TMP_PATH STRING "The path to the temporary directory" DEFAULT ${BUILD_PATH}/tmp)
optionx(FRESH BOOL "Set when --fresh is used" DEFAULT OFF)

# --- Compilers ---

if(CMAKE_HOST_APPLE)
  include(SetupMacSDK)
endif()
include(SetupLLVM)
include(SetupCcache)

# --- Project ---

parse_package_json(VERSION_VARIABLE DEFAULT_VERSION)
optionx(VERSION STRING "The version of Bun" DEFAULT ${DEFAULT_VERSION})
project(Bun VERSION ${VERSION})
include(Options)

# --- Tools ---

include(SetupBuildkite)
include(SetupBun)
include(SetupEsbuild)
include(SetupZig)

# --- Targets ---

include(BuildBun)

# --- Flags ---

include(CompilerFlags)
