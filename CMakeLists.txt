cmake_minimum_required(VERSION 3.24)
message(STATUS "Configuring Bun")

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_POLICY_DEFAULT_CMP0069 NEW)
set(Bun_VERSION "1.1.28")
set(WEBKIT_TAG 147ed53838e21525677492c27099567a6cd19c6b)

if(NOT CONFIGURE_DEPENDS)
  set(CONFIGURE_DEPENDS "")
else()
  set(CONFIGURE_DEPENDS "CONFIGURE_DEPENDS")
endif()

list(APPEND CMAKE_MODULE_PATH
  ${CMAKE_SOURCE_DIR}/cmake
  ${CMAKE_SOURCE_DIR}/cmake/targets
  ${CMAKE_SOURCE_DIR}/cmake/tools
  ${CMAKE_SOURCE_DIR}/cmake/analysis
  ${CMAKE_SOURCE_DIR}/cmake/scripts
)

include(Policies)
include(Macros)

# Aliases for common CMake variables.
# These must be set before include(), since they are widely used.
setx(CWD ${CMAKE_SOURCE_DIR})
setx(BUILD_PATH ${CMAKE_BINARY_DIR})

optionx(CACHE_PATH STRING "The path to the cache directory" DEFAULT ${BUILD_PATH}/cache)
optionx(CACHE_STRATEGY "read-write|read-only|write-only|none" "The strategy to use for caching" DEFAULT "read-write")
optionx(TMP_PATH STRING "The path to the temporary directory" DEFAULT ${BUILD_PATH}/tmp)

# Modules that set CMake variables, such as CMAKE_C_COMPILER must be run before project().
# Otherwise, CMake can select the wrong compiler or flags.
if(CMAKE_HOST_APPLE)
  include(SetupMacSDK)
endif()
include(SetupLLVM)
include(SetupCcache)

parse_package_json(VERSION_VARIABLE DEFAULT_VERSION)
optionx(VERSION STRING "The version of Bun" DEFAULT ${DEFAULT_VERSION})
project(Bun VERSION ${VERSION})

include(Options)
include(CompilerFlags)
include(SetupBuildkite)
include(SetupBun)
include(SetupEsbuild)
include(SetupZig)
include(BuildBun)
