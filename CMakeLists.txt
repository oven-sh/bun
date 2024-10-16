cmake_minimum_required(VERSION 3.24)
message(STATUS "Configuring Bun")

list(APPEND CMAKE_MODULE_PATH
  ${CMAKE_SOURCE_DIR}/cmake
  ${CMAKE_SOURCE_DIR}/cmake/targets
  ${CMAKE_SOURCE_DIR}/cmake/tools
  ${CMAKE_SOURCE_DIR}/cmake/analysis
  ${CMAKE_SOURCE_DIR}/cmake/scripts
)

include(Policies)
include(Globals)

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
include(CompilerFlags)

# --- Tools ---

include(SetupGit)
include(SetupBuildkite)
include(SetupBun)
include(SetupEsbuild)
include(SetupZig)
include(SetupRust)

# --- Targets ---

include(BuildBun)

# --- Analysis ---

if(ENABLE_ANALYSIS)
  include(RunClangFormat)
  include(RunClangTidy)
  include(RunZigFormat)
  include(RunPrettier)
endif()
