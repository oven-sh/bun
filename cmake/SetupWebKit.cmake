include(cmake/Utils.cmake)

parse_option(WEBKIT_VERSION STRING "The version of WebKit to use" "21fc366db3de8f30dbb7f5997b9b9f5cf422ff1e")
parse_option(WEBKIT_PREBUILT BOOL "If a pre-built version of WebKit should be used" ON)

if(WEBKIT_PREBUILT)
  # set(DEFAULT_WEBKIT_DIR ${CACHE_PATH}/webkit)
  set(DEFAULT_WEBKIT_DIR ${BUILD_PATH}/bun-webkit)
else()
  set(DEFAULT_WEBKIT_DIR ${CWD}/src/bun.js/WebKit)
endif()

if(NOT WEBKIT_PREBUILT)
  message(FATAL_ERROR "Not supported yet in CMake")
endif()

parse_option(WEBKIT_DIR FILEPATH "The path to the WebKit directory" ${DEFAULT_WEBKIT_DIR})

if(WEBKIT_DIR STREQUAL "omit")
  message(STATUS "Not using WebKit. This is only valid if you are only trying to build Zig code")
  return()
endif()

if(EXISTS ${WEBKIT_DIR}/package.json)
  file(READ ${WEBKIT_DIR}/package.json WEBKIT_PACKAGE_JSON)

  if(WEBKIT_PACKAGE_JSON MATCHES ${WEBKIT_VERSION})
    message(STATUS "Using cached WebKit: ${WEBKIT_CACHED_VERSION}")
    return()
  endif()
endif()

if(WIN32)
  set(WEBKIT_PLATFORM "windows")
elseif(APPLE)
  set(WEBKIT_PLATFORM "macos")
elseif(UNIX)
  set(WEBKIT_PLATFORM "linux")
else()
  message(FATAL_ERROR "Unsupported operating system: ${CMAKE_SYSTEM_NAME}")
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
  set(WEBKIT_ARCH "arm64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64")
  set(WEBKIT_ARCH "amd64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_SYSTEM_PROCESSOR}")
endif()

if(ENABLE_ASSERTIONS)
  set(WEBKIT_PLATFORM_SUFFIX "-debug")
  add_compile_definitions("BUN_DEBUG=1")
elseif(USE_LTO)
  set(WEBKIT_PLATFORM_SUFFIX "-lto")
else()
  set(WEBKIT_PLATFORM_SUFFIX "")
endif()

set(WEBKIT_NAME bun-webkit-${WEBKIT_PLATFORM}-${WEBKIT_ARCH}${WEBKIT_PLATFORM_SUFFIX})
set(WEBKIT_FILENAME ${WEBKIT_NAME}.tar.gz)
set(WEBKIT_DOWNLOAD_URL https://github.com/oven-sh/WebKit/releases/download/autobuild-${WEBKIT_VERSION}/${WEBKIT_FILENAME})

message(STATUS "Downloading ${WEBKIT_DOWNLOAD_URL}")
file(DOWNLOAD ${WEBKIT_DOWNLOAD_URL} ${CACHE_PATH}/${WEBKIT_FILENAME})

message(STATUS "Extracting ${WEBKIT_FILENAME}")
execute_process(
  COMMAND ${CMAKE_COMMAND} -E tar xzf ${WEBKIT_FILENAME}
  WORKING_DIRECTORY ${CACHE_PATH}
)

file(REMOVE ${CACHE_PATH}/${WEBKIT_FILENAME})
file(REMOVE_RECURSE ${WEBKIT_DIR})
file(RENAME ${CACHE_PATH}/bun-webkit ${WEBKIT_DIR})

if(APPLE)
  file(REMOVE_RECURSE ${WEBKIT_DIR}/include/unicode)
endif()
