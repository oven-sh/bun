include(Macros)

optionx(WEBKIT_VERSION STRING "The version of WebKit to use" DEFAULT "21fc366db3de8f30dbb7f5997b9b9f5cf422ff1e")
optionx(WEBKIT_PREBUILT BOOL "If a pre-built version of WebKit should be used" DEFAULT ON)

if(WEBKIT_PREBUILT)
  set(DEFAULT_WEBKIT_PATH ${CACHE_PATH}/webkit)
else()
  set(DEFAULT_WEBKIT_PATH ${CWD}/src/bun.js/WebKit)
endif()

if(NOT WEBKIT_PREBUILT)
  message(FATAL_ERROR "Not supported yet in CMake")
endif()

optionx(WEBKIT_PATH FILEPATH "The path to the WebKit directory" DEFAULT ${DEFAULT_WEBKIT_PATH})

setx(WEBKIT_INCLUDE_PATH ${WEBKIT_PATH}/include)
setx(WEBKIT_LIB_PATH ${WEBKIT_PATH}/lib)

if(EXISTS ${WEBKIT_PATH}/package.json)
  file(READ ${WEBKIT_PATH}/package.json WEBKIT_PACKAGE_JSON)

  if(WEBKIT_PACKAGE_JSON MATCHES ${WEBKIT_VERSION})
    return()
  endif()
endif()

if(WIN32)
  set(WEBKIT_OS "windows")
elseif(APPLE)
  set(WEBKIT_OS "macos")
elseif(UNIX)
  set(WEBKIT_OS "linux")
else()
  message(FATAL_ERROR "Unsupported operating system: ${CMAKE_SYSTEM_NAME}")
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
  set(WEBKIT_ARCH "arm64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64|AMD64")
  set(WEBKIT_ARCH "amd64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_SYSTEM_PROCESSOR}")
endif()

if(DEBUG)
  set(WEBKIT_SUFFIX "-debug")
elseif(ENABLE_LTO AND NOT WIN32)
  set(WEBKIT_SUFFIX "-lto")
else()
  set(WEBKIT_SUFFIX "")
endif()

set(WEBKIT_NAME bun-webkit-${WEBKIT_OS}-${WEBKIT_ARCH}${WEBKIT_SUFFIX})
set(WEBKIT_FILENAME ${WEBKIT_NAME}.tar.gz)
setx(WEBKIT_DOWNLOAD_URL https://github.com/oven-sh/WebKit/releases/download/autobuild-${WEBKIT_VERSION}/${WEBKIT_FILENAME})

file(DOWNLOAD ${WEBKIT_DOWNLOAD_URL} ${CACHE_PATH}/${WEBKIT_FILENAME})
file(ARCHIVE_EXTRACT INPUT ${CACHE_PATH}/${WEBKIT_FILENAME} DESTINATION ${CACHE_PATH})
file(REMOVE ${CACHE_PATH}/${WEBKIT_FILENAME})
file(REMOVE_RECURSE ${WEBKIT_PATH})
file(RENAME ${CACHE_PATH}/bun-webkit ${WEBKIT_PATH})

if(APPLE)
  file(REMOVE_RECURSE ${WEBKIT_INCLUDE_PATH}/unicode)
endif()

# --- WebKit ---
# WebKit is either prebuilt and distributed via NPM, or you can pass WEBKIT_PATH to use a local build.
# We cannot include their CMake build files (TODO: explain why, for now ask @paperdave why)
#
# On Unix, this will pull from NPM the single package that is needed and use that
# if(WIN32)
#   set(STATIC_LIB_EXT "lib")
#   set(libJavaScriptCore "JavaScriptCore")
#   set(libWTF "WTF")
# else()
#   set(STATIC_LIB_EXT "a")
#   set(libJavaScriptCore "libJavaScriptCore")
#   set(libWTF "libWTF")
# endif()

# if(WEBKIT_PREBUILT)

# elseif(WEBKIT_PATH STREQUAL "omit")
    
# else()
#     # Expected to be WebKit/WebKitBuild/${CMAKE_BUILD_TYPE}
#     if(EXISTS "${WEBKIT_PATH}/cmakeconfig.h")
#         # You may need to run:
#         # make jsc-compile-debug jsc-copy-headers
#         include_directories(
#             "${WEBKIT_PATH}/"
#             "${WEBKIT_PATH}/JavaScriptCore/Headers/JavaScriptCore"
#             "${WEBKIT_PATH}/JavaScriptCore/PrivateHeaders"
#             "${WEBKIT_PATH}/bmalloc/Headers"
#             "${WEBKIT_PATH}/WTF/Headers"
#         )
#         set(WEBKIT_LIB_DIR "${WEBKIT_PATH}/lib")

#         if(ENABLE_ASSERTIONS)
#             add_compile_definitions("BUN_DEBUG=1")
#         endif()

#         message(STATUS "Using WebKit from ${WEBKIT_PATH}")
#     else()
#         if(NOT EXISTS "${WEBKIT_PATH}/lib/${libWTF}.${STATIC_LIB_EXT}" OR NOT EXISTS "${WEBKIT_PATH}/lib/${libJavaScriptCore}.${STATIC_LIB_EXT}")
#             if(WEBKIT_PATH MATCHES "src/bun.js/WebKit$")
#                 message(FATAL_ERROR "WebKit directory ${WEBKIT_PATH} does not contain all the required files for Bun. Did you forget to init submodules?")
#             endif()

#             message(FATAL_ERROR "WebKit directory ${WEBKIT_PATH} does not contain all the required files for Bun. Expected a path to the oven-sh/WebKit repository, or a path to a folder containing `include` and `lib`.")
#         endif()

#         set(WEBKIT_LIB_DIR "${WEBKIT_PATH}/lib")

#         message(STATUS "Using specified WebKit directory: ${WEBKIT_PATH}")
#         message(STATUS "WebKit assertions: OFF")
#     endif()
# endif()