include(cmake/Utils.cmake)

parse_option(CMAKE_BUILD_TYPE "Debug|Release|RelWithDebInfo|MinSizeRel" "The build type to use" REQUIRED)

set_if(DEFAULT_IF_RELEASE "Release|RelWithDebInfo|MinSizeRel" CMAKE_BUILD_TYPE)
set_if(DEFAULT_IF_DEBUG "Debug|RelWithDebInfo" CMAKE_BUILD_TYPE)

# Runtime options

parse_option(ENABLE_LOGS BOOL "If debug logs should be enabled" ${DEFAULT_IF_DEBUG})
parse_option(ENABLE_ASSERTIONS BOOL "If debug assertions should be enabled" ${DEFAULT_IF_DEBUG})
parse_option(ENABLE_CANARY BOOL "If canary features should be enabled" ${DEFAULT_IF_DEBUG})

# Build options

parse_option(USE_LTO BOOL "If LTO (link-time optimization) should be used" ${DEFAULT_IF_RELEASE})
parse_option(USE_BASELINE BOOL "If baseline features should be used for older CPUs (e.g. disables AVX, AVX2)" OFF)
parse_option(USE_VALGRIND BOOL "If Valgrind support should be enabled" OFF)

if(APPLE AND USE_LTO)
  set(USE_LTO OFF)
  message(WARNING "Link-Time Optimization is not supported on macOS because it requires -fuse-ld=lld and lld causes many segfaults on macOS (likely related to stack size)")
endif()

if(USE_VALGRIND AND NOT USE_BASELINE)
  set(USE_BASELINE ON)
  message(WARNING "If valgrind is enabled, baseline must also be enabled")
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64|arm")
  set(DEFAULT_USE_ARCH "aarch64")
else()
  set(DEFAULT_USE_ARCH "x64")
endif()

parse_option(USE_ARCH "x64|aarch64" "The architecture to use for the compiler" ${DEFAULT_USE_ARCH})

if(USE_ARCH STREQUAL "aarch64")
  set(DEFAULT_USE_CPU "native")
elseif(USE_BASELINE)
  set(DEFAULT_USE_CPU "nehalem")
else()
  set(DEFAULT_USE_CPU "haswell")
endif()

parse_option(USE_CPU STRING "The CPU to use for the compiler" ${DEFAULT_USE_CPU})

if(USE_CPU STREQUAL "native")
  if(APPLE)
    set(USE_ZIG_CPU "apple_m1")
  else()
    set(USE_ZIG_CPU "ampere1")
  endif()
else()
  set(USE_ZIG_CPU ${USE_CPU})
endif()

if(USE_ARCH STREQUAL "aarch64")
  set(USE_ZIG_ARCH "aarch64")
else()
  set(USE_ZIG_ARCH "x86_64")
endif()

if(APPLE)
  set(USE_ZIG_TARGET ${USE_ZIG_ARCH}-macos-none)
elseif(WIN32)
  set(USE_ZIG_TARGET ${USE_ZIG_ARCH}-windows-msvc)
else()
  set(USE_ZIG_TARGET ${USE_ZIG_ARCH}-linux-gnu)
endif()

# Since Bun 1.1, Windows has been built using ReleaseSafe, and macOS & Linux have been using ReleaseFast
# This is because it caught more crashes, but we could reconsider this in the future
if(CMAKE_BUILD_TYPE STREQUAL "Release")
  set(DEFAULT_USE_ZIG_OPTIMIZE "ReleaseFast")
elseif(CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
  set(DEFAULT_USE_ZIG_OPTIMIZE "ReleaseSafe")
elseif(CMAKE_BUILD_TYPE STREQUAL "MinSizeRel")
  set(DEFAULT_USE_ZIG_OPTIMIZE "ReleaseSmall")
elseif(CMAKE_BUILD_TYPE STREQUAL "Debug")
  set(DEFAULT_USE_ZIG_OPTIMIZE "Debug")
endif()

parse_option(USE_ZIG_OPTIMIZE "ReleaseFast|ReleaseSafe|MinSizeRel|Debug" "The Zig optimize level to use" ${DEFAULT_USE_ZIG_OPTIMIZE})

# Runtime versions

parse_option(USE_VERSION STRING "The version to use" ${Bun_VERSION})

execute_process(
  COMMAND git rev-parse HEAD
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  OUTPUT_VARIABLE USE_DEFAULT_REVISION
  OUTPUT_STRIP_TRAILING_WHITESPACE
)

if(NOT USE_DEFAULT_REVISION)
  set(USE_DEFAULT_REVISION "unknown")
endif()

parse_option(USE_REVISION STRING "The git revision of the build" ${USE_DEFAULT_REVISION})

if(ENABLE_CANARY)
  set(DEFAULT_USE_CANARY_REVISION "1")
else()
  set(DEFAULT_USE_CANARY_REVISION "0")
endif()

parse_option(USE_CANARY_REVISION STRING "The canary revision of the build" ${DEFAULT_USE_CANARY_REVISION})

# Used in process.version, process.versions.node, napi, and elsewhere
parse_option(USE_NODEJS_VERSION STRING "The version of Node.js to report" "22.6.0")

# Used in process.versions.modules and compared while loading V8 modules
parse_option(USE_NODEJS_ABI_VERSION STRING "The ABI version of Node.js to report" "127")

# Dependency options

set(DEFAULT_USE_STATIC_SQLITE ON)
if(APPLE)
  set(DEFAULT_USE_STATIC_SQLITE OFF)
endif()

parse_option(USE_STATIC_SQLITE BOOL "If SQLite should be statically linked" ${DEFAULT_USE_STATIC_SQLITE})

set(DEFAULT_USE_STATIC_LIBATOMIC ON)

if(NOT WIN32 AND NOT APPLE)
  execute_process(
    COMMAND grep -w "NAME" /etc/os-release
    OUTPUT_VARIABLE LINUX_DISTRO
    OUTPUT_STRIP_TRAILING_WHITESPACE
  )

  if(${LINUX_DISTRO} MATCHES "NAME=\"(Arch|Manjaro|Artix) Linux\"|NAME=\"openSUSE Tumbleweed\"")
    set(DEFAULT_USE_STATIC_LIBATOMIC OFF)
  endif()
endif()

parse_option(USE_STATIC_LIBATOMIC BOOL "If libatomic should be statically linked" ${DEFAULT_USE_STATIC_LIBATOMIC})

parse_option(USE_CUSTOM_ZLIB BOOL "Use Bun's recommended version of zlib" ON)
parse_option(USE_CUSTOM_LIBDEFLATE BOOL "Use Bun's recommended version of libdeflate" ON)
parse_option(USE_CUSTOM_BORINGSSL BOOL "Use Bun's recommended version of BoringSSL" ON)
parse_option(USE_CUSTOM_LIBARCHIVE BOOL "Use Bun's recommended version of libarchive" ON)
parse_option(USE_CUSTOM_MIMALLOC BOOL "Use Bun's recommended version of Mimalloc" ON)
parse_option(USE_CUSTOM_ZSTD BOOL "Use Bun's recommended version of zstd" ON)
parse_option(USE_CUSTOM_CARES BOOL "Use Bun's recommended version of c-ares" ON)
parse_option(USE_CUSTOM_LOLHTML BOOL "Use Bun's recommended version of lolhtml" ON)
parse_option(USE_CUSTOM_TINYCC BOOL "Use Bun's recommended version of tinycc" ON)
parse_option(USE_CUSTOM_LIBUV BOOL "Use Bun's recommended version of libuv (Windows only)" ON)
parse_option(USE_CUSTOM_LSHPACK BOOL "Use Bun's recommended version of ls-hpack" ON)
parse_option(USE_SYSTEM_ICU BOOL "Use the system-provided libicu. May fix startup crashes when building WebKit yourself." OFF)
