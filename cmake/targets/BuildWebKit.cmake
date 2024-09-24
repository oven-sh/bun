optionx(WEBKIT_LOCAL BOOL "If a local version of WebKit should be used instead of downloading" DEFAULT OFF)
optionx(WEBKIT_VERSION STRING "The version of WebKit to use" DEFAULT "4a2db3254a9535949a5d5380eb58cf0f77c8e15a")

if(WEBKIT_LOCAL)
  set(DEFAULT_WEBKIT_PATH ${VENDOR_PATH}/WebKit/WebKitBuild/${CMAKE_BUILD_TYPE})
else()
  set(DEFAULT_WEBKIT_PATH ${VENDOR_PATH}/webkit)
endif()

optionx(WEBKIT_PATH FILEPATH "The path to the WebKit directory" DEFAULT ${DEFAULT_WEBKIT_PATH})

set(WEBKIT_INCLUDE_PATH ${WEBKIT_PATH}/include)
set(WEBKIT_LIB_PATH ${WEBKIT_PATH}/lib)

register_vendor_target(webkit)

register_libraries(
  TARGET ${webkit}
  PATH ${WEBKIT_PATH}/lib
  JavaScriptCore
  WTF
  bmalloc ${LINUX}
)

if(WIN32)
  register_libraries(
    TARGET ${webkit}
    PATH ${WEBKIT_PATH}/lib
    sicudt  ${RELEASE}
    sicudtd ${DEBUG}
    sicuin  ${RELEASE}
    sicuind ${DEBUG}
    sicuuc  ${RELEASE}
    sicuucd ${DEBUG}
  )
endif()

if(WEBKIT_LOCAL)
  # Must be built seperately, in the future this can be integrated into the build process
  register_target(build-webkit)
else()
  if(WIN32)
    set(WEBKIT_OS "windows")
  elseif(APPLE)
    set(WEBKIT_OS "macos")
  elseif(LINUX)
    set(WEBKIT_OS "linux")
  else()
    unsupported(CMAKE_SYSTEM_NAME)
  endif()

  if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|ARM64|aarch64|AARCH64")
    set(WEBKIT_ARCH "arm64")
  elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|AMD64|x86_64|X86_64|x64|X64")
    set(WEBKIT_ARCH "amd64")
  else()
    unsupported(CMAKE_SYSTEM_PROCESSOR)
  endif()

  if(DEBUG)
    set(WEBKIT_SUFFIX "-debug")
  elseif(ENABLE_LTO AND NOT WIN32)
    set(WEBKIT_SUFFIX "-lto")
  else()
    set(WEBKIT_SUFFIX "")
  endif()

  set(WEBKIT_NAME bun-webkit-${WEBKIT_OS}-${WEBKIT_ARCH}${WEBKIT_SUFFIX})
  set(WEBKIT_DOWNLOAD_URL https://github.com/oven-sh/WebKit/releases/download/autobuild-${WEBKIT_VERSION}/${WEBKIT_NAME}.tar.gz)

  get_libraries(${webkit} WEBKIT_LIBRARIES)
  register_command(
    TARGET
      clone-${webkit}
    COMMENT
      "Downloading ${WEBKIT_NAME}"
    COMMAND
      ${CMAKE_COMMAND}
        -DDOWNLOAD_PATH=${WEBKIT_PATH}
        -DDOWNLOAD_URL=${WEBKIT_DOWNLOAD_URL}
        -P ${CWD}/cmake/scripts/DownloadUrl.cmake
    OUTPUTS
      ${WEBKIT_PATH}/package.json
      ${WEBKIT_LIBRARIES}
  )

  register_outputs(TARGET clone-${webkit} ${WEBKIT_PATH})
endif()
