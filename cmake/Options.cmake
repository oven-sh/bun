if(NOT CMAKE_SYSTEM_NAME OR NOT CMAKE_SYSTEM_PROCESSOR)
  message(FATAL_ERROR "CMake included this file before project() was called")
endif()

optionx(BUN_LINK_ONLY BOOL "If only the linking step should be built" DEFAULT OFF)
optionx(BUN_CPP_ONLY BOOL "If only the C++ part of Bun should be built" DEFAULT OFF)
optionx(SKIP_CODEGEN BOOL "Skip JavaScript codegen (for Windows ARM64 debug)" DEFAULT OFF)

optionx(BUILDKITE BOOL "If Buildkite is enabled" DEFAULT OFF)
optionx(GITHUB_ACTIONS BOOL "If GitHub Actions is enabled" DEFAULT OFF)

if(BUILDKITE)
  optionx(BUILDKITE_COMMIT STRING "The commit hash")
endif()

optionx(CMAKE_BUILD_TYPE "Debug|Release|RelWithDebInfo|MinSizeRel" "The build type to use" REQUIRED)

if(CMAKE_BUILD_TYPE MATCHES "Release|RelWithDebInfo|MinSizeRel")
  setx(RELEASE ON)
else()
  setx(RELEASE OFF)
endif()

if(CMAKE_BUILD_TYPE MATCHES "Debug")
  setx(DEBUG ON)
else()
  setx(DEBUG OFF)
endif()

optionx(BUN_TEST BOOL "Build Bun's unit test suite instead of the normal build" DEFAULT OFF)

if (BUN_TEST)
  setx(TEST ON)
else()
  setx(TEST OFF)
endif()


if(CMAKE_BUILD_TYPE MATCHES "MinSizeRel")
  setx(ENABLE_SMOL ON)
endif()

if(APPLE)
  setx(OS "darwin")
elseif(WIN32)
  setx(OS "windows")
elseif(LINUX)
  setx(OS "linux")
else()
  message(FATAL_ERROR "Unsupported operating system: ${CMAKE_SYSTEM_NAME}")
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64|ARM64")
  setx(ARCH "aarch64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64|AMD64")
  setx(ARCH "x64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_SYSTEM_PROCESSOR}")
endif()

# CMake 4.0+ policy CMP0197 controls how MSVC machine type flags are handled
# Setting to NEW prevents duplicate /machine: flags being added to linker commands
if(WIN32 AND ARCH STREQUAL "aarch64")
  set(CMAKE_POLICY_DEFAULT_CMP0197 NEW)
  set(CMAKE_MSVC_CMP0197 NEW)
  # Set linker flags for exe/shared linking
  set(CMAKE_EXE_LINKER_FLAGS "${CMAKE_EXE_LINKER_FLAGS} /machine:ARM64")
  set(CMAKE_SHARED_LINKER_FLAGS "${CMAKE_SHARED_LINKER_FLAGS} /machine:ARM64")
  set(CMAKE_MODULE_LINKER_FLAGS "${CMAKE_MODULE_LINKER_FLAGS} /machine:ARM64")
  set(CMAKE_STATIC_LINKER_FLAGS "${CMAKE_STATIC_LINKER_FLAGS} /machine:ARM64")
endif()

# Windows Code Signing Option
if(WIN32)
  optionx(ENABLE_WINDOWS_CODESIGNING BOOL "Enable Windows code signing with DigiCert KeyLocker" DEFAULT OFF)

  if(ENABLE_WINDOWS_CODESIGNING)
    message(STATUS "Windows code signing: ENABLED")

    # Check for required environment variables
    if(NOT DEFINED ENV{SM_API_KEY})
      message(WARNING "SM_API_KEY not set - code signing may fail")
    endif()
    if(NOT DEFINED ENV{SM_CLIENT_CERT_FILE})
      message(WARNING "SM_CLIENT_CERT_FILE not set - code signing may fail")
    endif()
  endif()
endif()

if(LINUX)
  if(EXISTS "/etc/alpine-release")
    set(DEFAULT_ABI "musl")
  else()
    set(DEFAULT_ABI "gnu")
  endif()

  optionx(ABI "musl|gnu" "The ABI to use (e.g. musl, gnu)" DEFAULT ${DEFAULT_ABI})
endif()

if(ARCH STREQUAL "x64")
  optionx(ENABLE_BASELINE BOOL "If baseline features should be used for older CPUs (e.g. disables AVX, AVX2)" DEFAULT OFF)
endif()

# Disabling logs by default for tests yields faster builds
if (DEBUG AND NOT TEST)
  set(DEFAULT_ENABLE_LOGS ON)
else()
  set(DEFAULT_ENABLE_LOGS OFF)
endif()

optionx(ENABLE_LOGS BOOL "If debug logs should be enabled" DEFAULT ${DEFAULT_ENABLE_LOGS})
optionx(ENABLE_ASSERTIONS BOOL "If debug assertions should be enabled" DEFAULT ${DEBUG})

optionx(ENABLE_CANARY BOOL "If canary features should be enabled" DEFAULT ON)

if(ENABLE_CANARY)
  set(DEFAULT_CANARY_REVISION "1")
else()
  set(DEFAULT_CANARY_REVISION "0")
endif()

optionx(CANARY_REVISION STRING "The canary revision of the build" DEFAULT ${DEFAULT_CANARY_REVISION})

if(LINUX)
  optionx(ENABLE_VALGRIND BOOL "If Valgrind support should be enabled" DEFAULT OFF)
endif()

if(DEBUG AND ((APPLE AND ARCH STREQUAL "aarch64") OR LINUX))
  set(DEFAULT_ASAN ON)
  set(DEFAULT_VALGRIND OFF)
else()
  set(DEFAULT_ASAN OFF)
  set(DEFAULT_VALGRIND OFF)
endif()

optionx(ENABLE_ASAN BOOL "If ASAN support should be enabled" DEFAULT ${DEFAULT_ASAN})
optionx(ENABLE_ZIG_ASAN BOOL "If Zig ASAN support should be enabled" DEFAULT ${ENABLE_ASAN})

if (NOT ENABLE_ASAN)
  set(ENABLE_ZIG_ASAN OFF)
endif()

optionx(ENABLE_FUZZILLI BOOL "If fuzzilli support should be enabled" DEFAULT OFF)

if(RELEASE AND LINUX AND CI AND NOT ENABLE_ASSERTIONS AND NOT ENABLE_ASAN)
  set(DEFAULT_LTO ON)
else()
  set(DEFAULT_LTO OFF)
endif()

optionx(ENABLE_LTO BOOL "If LTO (link-time optimization) should be used" DEFAULT ${DEFAULT_LTO})

if(ENABLE_ASAN AND ENABLE_LTO)
  message(WARNING "ASAN and LTO are not supported together, disabling LTO")
  setx(ENABLE_LTO OFF)
endif()

if(BUILDKITE_COMMIT)
  set(DEFAULT_REVISION ${BUILDKITE_COMMIT})
else()
  execute_process(
    COMMAND git rev-parse HEAD
    WORKING_DIRECTORY ${CWD}
    OUTPUT_VARIABLE DEFAULT_REVISION
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
  )
  if(NOT DEFAULT_REVISION AND NOT DEFINED ENV{GIT_SHA} AND NOT DEFINED ENV{GITHUB_SHA})
    set(DEFAULT_REVISION "unknown")
  endif()
endif()

optionx(REVISION STRING "The git revision of the build" DEFAULT ${DEFAULT_REVISION})

# Used in process.version, process.versions.node, napi, and elsewhere
setx(NODEJS_VERSION "24.3.0")

# Used in process.versions.modules and compared while loading V8 modules
setx(NODEJS_ABI_VERSION "137")

if(APPLE)
  set(DEFAULT_STATIC_SQLITE OFF)
else()
  set(DEFAULT_STATIC_SQLITE ON)
endif()

optionx(USE_STATIC_SQLITE BOOL "If SQLite should be statically linked" DEFAULT ${DEFAULT_STATIC_SQLITE})

set(DEFAULT_STATIC_LIBATOMIC ON)

if(CMAKE_HOST_LINUX AND NOT WIN32 AND NOT APPLE)
  execute_process(
    COMMAND grep -w "NAME" /etc/os-release
    OUTPUT_VARIABLE LINUX_DISTRO
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
  )
  if(LINUX_DISTRO MATCHES "NAME=\"(Arch|Manjaro|Artix) Linux( ARM)?\"|NAME=\"openSUSE Tumbleweed\"")
    set(DEFAULT_STATIC_LIBATOMIC OFF)
  endif()
endif()

optionx(USE_STATIC_LIBATOMIC BOOL "If libatomic should be statically linked" DEFAULT ${DEFAULT_STATIC_LIBATOMIC})

if(APPLE)
  set(DEFAULT_WEBKIT_ICU OFF)
else()
  set(DEFAULT_WEBKIT_ICU ON)
endif()

optionx(USE_WEBKIT_ICU BOOL "Use the ICU libraries from WebKit" DEFAULT ${DEFAULT_WEBKIT_ICU})

optionx(ERROR_LIMIT STRING "Maximum number of errors to show when compiling C++ code" DEFAULT "100")

# TinyCC is used for FFI JIT compilation
# Disable on Windows ARM64 where it's not yet supported
if(WIN32 AND ARCH STREQUAL "aarch64")
  set(DEFAULT_ENABLE_TINYCC OFF)
else()
  set(DEFAULT_ENABLE_TINYCC ON)
endif()

optionx(ENABLE_TINYCC BOOL "Enable TinyCC for FFI JIT compilation" DEFAULT ${DEFAULT_ENABLE_TINYCC})

# This is not an `option` because setting this variable to OFF is experimental
# and unsupported. This replaces the `use_mimalloc` variable previously in
# bun.zig, and enables C++ code to also be aware of the option.
set(USE_MIMALLOC_AS_DEFAULT_ALLOCATOR ON)

list(APPEND CMAKE_ARGS -DCMAKE_EXPORT_COMPILE_COMMANDS=ON)
