option(WEBKIT_VERSION "The version of WebKit to use")
option(WEBKIT_LOCAL "If a local version of WebKit should be used instead of downloading")

if(NOT WEBKIT_VERSION)
  set(WEBKIT_VERSION b98e20b11e6ab044f73218bdd05ab064587b9ead)
endif()

string(SUBSTRING ${WEBKIT_VERSION} 0 16 WEBKIT_VERSION_PREFIX)

if(WEBKIT_LOCAL)
  set(DEFAULT_WEBKIT_PATH ${VENDOR_PATH}/WebKit/WebKitBuild/${CMAKE_BUILD_TYPE})
else()
  set(DEFAULT_WEBKIT_PATH ${CACHE_PATH}/webkit-${WEBKIT_VERSION_PREFIX})
endif()

option(WEBKIT_PATH "The path to the WebKit directory")

if(NOT WEBKIT_PATH)
  set(WEBKIT_PATH ${DEFAULT_WEBKIT_PATH})
endif()

set(WEBKIT_INCLUDE_PATH ${WEBKIT_PATH}/include)
set(WEBKIT_LIB_PATH ${WEBKIT_PATH}/lib)

if(WEBKIT_LOCAL)
  if(EXISTS ${WEBKIT_PATH}/cmakeconfig.h)
    # You may need to run:
    # make jsc-compile-debug jsc-copy-headers
    include_directories(
      ${WEBKIT_PATH}
      ${WEBKIT_PATH}/JavaScriptCore/Headers/JavaScriptCore
      ${WEBKIT_PATH}/JavaScriptCore/PrivateHeaders
      ${WEBKIT_PATH}/bmalloc/Headers
      ${WEBKIT_PATH}/WTF/Headers
      ${WEBKIT_PATH}/JavaScriptCore/DerivedSources/inspector
      ${WEBKIT_PATH}/JavaScriptCore/PrivateHeaders/JavaScriptCore
    )
  endif()

  # After this point, only prebuilt WebKit is supported
  return()
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

if(LINUX AND ABI STREQUAL "musl")
  set(WEBKIT_SUFFIX "-musl")
endif()

if(DEBUG)
  set(WEBKIT_SUFFIX "${WEBKIT_SUFFIX}-debug")
elseif(ENABLE_LTO)
  set(WEBKIT_SUFFIX "${WEBKIT_SUFFIX}-lto")
else()
  set(WEBKIT_SUFFIX "${WEBKIT_SUFFIX}")
endif()

if(ENABLE_ASAN)
  # We cannot mix and match ASan Bun + non-ASan WebKit, or vice versa, because some WebKit classes
  # change their layout according to whether ASan is used, for example:
  # https://github.com/oven-sh/WebKit/blob/eda8b0fb4fb1aa23db9c2b00933df8b58bcdd289/Source/WTF/wtf/Vector.h#L682
  set(WEBKIT_SUFFIX "${WEBKIT_SUFFIX}-asan")
endif()

setx(WEBKIT_NAME bun-webkit-${WEBKIT_OS}-${WEBKIT_ARCH}${WEBKIT_SUFFIX})
set(WEBKIT_FILENAME ${WEBKIT_NAME}.tar.gz)
setx(WEBKIT_DOWNLOAD_URL https://github.com/oven-sh/WebKit/releases/download/autobuild-${WEBKIT_VERSION}/${WEBKIT_FILENAME})

if(EXISTS ${WEBKIT_PATH}/package.json)
  file(READ ${WEBKIT_PATH}/package.json WEBKIT_PACKAGE_JSON)

  if(WEBKIT_PACKAGE_JSON MATCHES ${WEBKIT_VERSION})
    return()
  endif()
endif()

file(DOWNLOAD ${WEBKIT_DOWNLOAD_URL} ${CACHE_PATH}/${WEBKIT_FILENAME} SHOW_PROGRESS)
file(ARCHIVE_EXTRACT INPUT ${CACHE_PATH}/${WEBKIT_FILENAME} DESTINATION ${CACHE_PATH} TOUCH)
file(REMOVE ${CACHE_PATH}/${WEBKIT_FILENAME})
file(REMOVE_RECURSE ${WEBKIT_PATH})
file(RENAME ${CACHE_PATH}/bun-webkit ${WEBKIT_PATH})

if(APPLE)
  file(REMOVE_RECURSE ${WEBKIT_INCLUDE_PATH}/unicode)
endif()
