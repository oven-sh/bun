if(NOT CMAKE_SYSTEM_NAME OR NOT CMAKE_SYSTEM_PROCESSOR)
  message(FATAL_ERROR "CMake included this file before project() was called")
endif()

optionx(BUN_LINK_ONLY BOOL "If only the linking step should be built" DEFAULT OFF)
optionx(BUN_CPP_ONLY BOOL "If only the C++ part of Bun should be built" DEFAULT OFF)

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

if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64|arm")
  setx(ARCH "aarch64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64|AMD64")
  setx(ARCH "x64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_SYSTEM_PROCESSOR}")
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

optionx(ENABLE_LOGS BOOL "If debug logs should be enabled" DEFAULT ${DEBUG})
optionx(ENABLE_ASSERTIONS BOOL "If debug assertions should be enabled" DEFAULT ${DEBUG})

optionx(ENABLE_CANARY BOOL "If canary features should be enabled" DEFAULT ON)

if(ENABLE_CANARY)
  set(DEFAULT_CANARY_REVISION "1")
else()
  set(DEFAULT_CANARY_REVISION "0")
endif()

optionx(CANARY_REVISION STRING "The canary revision of the build" DEFAULT ${DEFAULT_CANARY_REVISION})

if(RELEASE AND LINUX AND CI)
  set(DEFAULT_LTO ON)
else()
  set(DEFAULT_LTO OFF)
endif()

optionx(ENABLE_LTO BOOL "If LTO (link-time optimization) should be used" DEFAULT ${DEFAULT_LTO})

if(LINUX)
  optionx(ENABLE_VALGRIND BOOL "If Valgrind support should be enabled" DEFAULT OFF)
endif()

optionx(ENABLE_PRETTIER BOOL "If prettier should be ran" DEFAULT OFF)

if(USE_VALGRIND AND NOT USE_BASELINE)
  message(WARNING "If valgrind is enabled, baseline must also be enabled")
  setx(USE_BASELINE ON)
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
optionx(NODEJS_VERSION STRING "The version of Node.js to report" DEFAULT "22.6.0")

# Used in process.versions.modules and compared while loading V8 modules
optionx(NODEJS_ABI_VERSION STRING "The ABI version of Node.js to report" DEFAULT "127")

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

list(APPEND CMAKE_ARGS -DCMAKE_EXPORT_COMPILE_COMMANDS=ON)
