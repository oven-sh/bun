optionx(WEBKIT_LOCAL BOOL "If a local version of WebKit should be used instead of downloading" DEFAULT OFF)
optionx(WEBKIT_VERSION STRING "The version of WebKit to use" DEFAULT "4a2db3254a9535949a5d5380eb58cf0f77c8e15a")

if(WEBKIT_LOCAL)
  set(DEFAULT_WEBKIT_PATH ${VENDOR_PATH}/WebKit/WebKitBuild/${CMAKE_BUILD_TYPE})
else()
  set(DEFAULT_WEBKIT_PATH ${VENDOR_PATH}/WebKitPreBuilt/${WEBKIT_VERSION})
endif()

optionx(WEBKIT_PATH FILEPATH "The path to the WebKit directory" DEFAULT ${DEFAULT_WEBKIT_PATH})

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
    )
  endif()

  # After this point, only prebuilt WebKit is supported
  return()
endif()

if(EXISTS ${WEBKIT_PATH}/package.json)
  file(READ ${WEBKIT_PATH}/package.json WEBKIT_PACKAGE_JSON)

  if(WEBKIT_PACKAGE_JSON MATCHES WEBKIT_VERSION)
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

execute_process(
  COMMAND
    ${CMAKE_COMMAND}
      -DDOWNLOAD_URL=${WEBKIT_DOWNLOAD_URL}
      -DDOWNLOAD_PATH=${WEBKIT_PATH}
      -P ${CWD}/cmake/scripts/DownloadUrl.cmake
  ERROR_STRIP_TRAILING_WHITESPACE
  ERROR_VARIABLE
    WEBKIT_DOWNLOAD_ERROR
)

if(WEBKIT_DOWNLOAD_ERROR)
  message(FATAL_ERROR "Download failed: ${WEBKIT_DOWNLOAD_ERROR}")
endif()

if(APPLE)
  file(REMOVE_RECURSE ${WEBKIT_INCLUDE_PATH}/unicode)
endif()
