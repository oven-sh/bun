include(cmake/Utils.cmake)

parse_option(ZIG_VERSION STRING "The version of zig to use" "0.13.0")
parse_option(ZIG_LOCAL_CACHE_DIR FILEPATH "The path to local the zig cache directory" ${CACHE_PATH}/zig/local)
parse_option(ZIG_GLOBAL_CACHE_DIR FILEPATH "The path to the global zig cache directory" ${CACHE_PATH}/zig/global)
parse_option(ZIG_LIB_DIR FILEPATH "The path to the Zig library directory" ${CWD}/src/deps/zig/lib)
parse_option(ZIG_BIN_CACHE_DIR FILEPATH "The path to the zig binary cache directory" ${CACHE_PATH}/zig/bin)

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
  message(STATUS "Using Zig compiler: ${CMAKE_ZIG_COMPILER}")
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

set(CMAKE_ZIG_COMPILER ${ZIG_BIN_CACHE_DIR}/zig)
message(STATUS "Downloaded Zig compiler: ${CMAKE_ZIG_COMPILER}")
