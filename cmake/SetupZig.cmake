include(Utils)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
  set(DEFAULT_ZIG_ARCH "aarch64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64")
  set(DEFAULT_ZIG_ARCH "x86_64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_SYSTEM_PROCESSOR}")
endif()

if(APPLE)
  set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-macos-none)
elseif(WIN32)
  set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-windows-msvc)
elseif(LINUX)
  set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-linux-gnu)
else()
  message(FATAL_ERROR "Unsupported operating system: ${CMAKE_SYSTEM_NAME}")
endif()

optionx(ZIG_TARGET STRING "The zig target to use" DEFAULT ${DEFAULT_ZIG_TARGET})

if(CMAKE_BUILD_TYPE STREQUAL "Release")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseFast")
elseif(CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseSafe")
elseif(CMAKE_BUILD_TYPE STREQUAL "MinSizeRel")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseSmall")
elseif(CMAKE_BUILD_TYPE STREQUAL "Debug")
  set(DEFAULT_ZIG_OPTIMIZE "Debug")
endif()

# Since Bun 1.1, Windows has been built using ReleaseSafe.
# This is because it caught more crashes, but we can reconsider this in the future
if(WIN32 AND DEFAULT_ZIG_OPTIMIZE STREQUAL "ReleaseFast")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseSafe")
endif()

optionx(ZIG_OPTIMIZE "ReleaseFast|ReleaseSafe|MinSizeRel|Debug" "The Zig optimize level to use" DEFAULT ${DEFAULT_ZIG_OPTIMIZE})

optionx(ZIG_VERSION STRING "The version of zig to use" DEFAULT "0.13.0")
optionx(ZIG_LOCAL_CACHE_DIR FILEPATH "The path to local the zig cache directory" DEFAULT ${CACHE_PATH}/zig/local)
optionx(ZIG_GLOBAL_CACHE_DIR FILEPATH "The path to the global zig cache directory" DEFAULT ${CACHE_PATH}/zig/global)
optionx(ZIG_LIB_DIR FILEPATH "The path to the Zig library directory" DEFAULT ${CWD}/src/deps/zig/lib)
optionx(ZIG_BIN_CACHE_DIR FILEPATH "The path to the zig binary cache directory" DEFAULT ${CACHE_PATH}/zig/bin)

set(CMAKE_ZIG_FLAGS
  --cache-dir ${ZIG_LOCAL_CACHE_DIR}
  --global-cache-dir ${ZIG_GLOBAL_CACHE_DIR}
  --zig-lib-dir ${ZIG_LIB_DIR}
)

if(CMAKE_VERBOSE_MAKEFILE)
  list(APPEND CMAKE_ZIG_FLAGS --verbose)
endif()

function(check_zig_version found executable)
  set(${found} FALSE PARENT_SCOPE)

  execute_process(
    COMMAND ${executable} version
    OUTPUT_VARIABLE output
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
  )

  if(output STREQUAL ${ZIG_VERSION})
    set(${found} TRUE PARENT_SCOPE)
  endif()
endfunction()

find_program(
  CMAKE_ZIG_COMPILER
  NAMES zig zig.exe
  PATHS ENV PATH ${ZIG_BIN_CACHE_DIR}
  VALIDATOR check_zig_version
)

if(CMAKE_ZIG_COMPILER)
  setx(CMAKE_ZIG_COMPILER ${CMAKE_ZIG_COMPILER})
  return()
endif()

if(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
  set(ZIG_HOST_ARCH "aarch64")
elseif(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64")
  set(ZIG_HOST_ARCH "x86_64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_HOST_SYSTEM_PROCESSOR}")
endif()

if(CMAKE_HOST_APPLE)
  set(ZIG_HOST_OS "macos")
elseif(CMAKE_HOST_WIN32)
  set(ZIG_HOST_OS "windows")
elseif(CMAKE_HOST_UNIX)
  set(ZIG_HOST_OS "linux")
else()
  message(FATAL_ERROR "Unsupported operating system: ${CMAKE_HOST_SYSTEM_NAME}")
endif()

set(ZIG_NAME zig-${ZIG_HOST_OS}-${ZIG_HOST_ARCH}-${ZIG_VERSION})
set(ZIG_FILENAME ${ZIG_NAME}.tar.xz)
set(ZIG_DOWNLOAD_URL https://ziglang.org/download/${ZIG_VERSION}/${ZIG_FILENAME})

message(STATUS "Downloading ${ZIG_DOWNLOAD_URL}")
file(DOWNLOAD ${ZIG_DOWNLOAD_URL} ${ZIG_BIN_CACHE_DIR}/${ZIG_FILENAME})

message(STATUS "Extracting ${ZIG_FILENAME}")
execute_process(
  COMMAND ${CMAKE_COMMAND} -E tar xf ${ZIG_FILENAME}
  WORKING_DIRECTORY ${ZIG_BIN_CACHE_DIR}
)

file(REMOVE ${ZIG_BIN_CACHE_DIR}/${ZIG_FILENAME})
file(COPY ${ZIG_BIN_CACHE_DIR}/${ZIG_NAME}/zig DESTINATION ${ZIG_BIN_CACHE_DIR})
file(REMOVE_RECURSE ${ZIG_BIN_CACHE_DIR}/${ZIG_NAME})
file(CHMOD ${ZIG_BIN_CACHE_DIR}/zig PERMISSIONS OWNER_EXECUTE)
file(CREATE_LINK ${ZIG_BIN_CACHE_DIR}/zig ${ZIG_BIN_CACHE_DIR}/zig.exe SYMBOLIC)
setx(CMAKE_ZIG_COMPILER ${ZIG_BIN_CACHE_DIR}/zig)
