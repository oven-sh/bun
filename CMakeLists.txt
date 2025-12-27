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

if (CMAKE_HOST_WIN32)
  # Workaround for TLS certificate verification issue on Windows when downloading from GitHub
  # Remove this once we've bumped the CI machines build image
  set(CMAKE_TLS_VERIFY 0)
endif()

# --- Compilers ---

if(CMAKE_HOST_APPLE)
  include(SetupMacSDK)
endif()
include(SetupLLVM)

# --- Project ---

parse_package_json(VERSION_VARIABLE DEFAULT_VERSION)
optionx(VERSION STRING "The version of Bun" DEFAULT ${DEFAULT_VERSION})
project(Bun VERSION ${VERSION})

# Bun uses C++23, which is compatible with BoringSSL's C++17 requirement
set(CMAKE_CXX_STANDARD 23)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(Options)
include(CompilerFlags)

# --- Tools ---

include(SetupGit)
include(SetupBuildkite)
include(SetupBun)
include(SetupEsbuild)
include(SetupZig)
include(SetupRust)

include(SetupCcache)

# Generate dependency versions header
include(GenerateDependencyVersions)

# --- Targets ---

include(BuildBun)

# --- Analysis ---

if(ENABLE_ANALYSIS)
  include(RunClangFormat)
  include(RunClangTidy)
  include(RunZigFormat)
  include(RunPrettier)
endif()
