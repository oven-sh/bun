# NOTE: Changes to this file trigger QEMU JIT stress tests in CI.
# See scripts/verify-jit-stress-qemu.sh for details.

option(WEBKIT_VERSION "The version of WebKit to use")
option(WEBKIT_LOCAL "If a local version of WebKit should be used instead of downloading")
option(WEBKIT_BUILD_TYPE "The build type for local WebKit (defaults to CMAKE_BUILD_TYPE)")

if(NOT WEBKIT_VERSION)
  set(WEBKIT_VERSION 8af7958ff0e2a4787569edf64641a1ae7cfe074a)
endif()

# Use preview build URL for Windows ARM64 until the fix is merged to main
set(WEBKIT_PREVIEW_PR 140)

string(SUBSTRING ${WEBKIT_VERSION} 0 16 WEBKIT_VERSION_PREFIX)
string(SUBSTRING ${WEBKIT_VERSION} 0 8 WEBKIT_VERSION_SHORT)

if(WEBKIT_LOCAL)
  if(NOT WEBKIT_BUILD_TYPE)
    set(WEBKIT_BUILD_TYPE ${CMAKE_BUILD_TYPE})
  endif()
  set(DEFAULT_WEBKIT_PATH ${VENDOR_PATH}/WebKit/WebKitBuild/${WEBKIT_BUILD_TYPE})
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
  set(WEBKIT_SOURCE_DIR ${VENDOR_PATH}/WebKit)

  if(WIN32)
    # --- Build ICU from source (Windows only) ---
    # On macOS, ICU is found automatically (Homebrew icu4c for headers, system for libs).
    # On Linux, ICU is found automatically from system packages (e.g. libicu-dev).
    # On Windows, there is no system ICU, so we build it from source.
    set(ICU_LOCAL_ROOT ${VENDOR_PATH}/WebKit/WebKitBuild/icu)
    if(NOT EXISTS ${ICU_LOCAL_ROOT}/lib/sicudt.lib)
      message(STATUS "Building ICU from source...")
      if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|ARM64|aarch64|AARCH64")
        set(ICU_PLATFORM "ARM64")
      else()
        set(ICU_PLATFORM "x64")
      endif()
      execute_process(
        COMMAND powershell -ExecutionPolicy Bypass -File
          ${WEBKIT_SOURCE_DIR}/build-icu.ps1
          -Platform ${ICU_PLATFORM}
          -BuildType ${WEBKIT_BUILD_TYPE}
          -OutputDir ${ICU_LOCAL_ROOT}
        RESULT_VARIABLE ICU_BUILD_RESULT
      )
      if(NOT ICU_BUILD_RESULT EQUAL 0)
        message(FATAL_ERROR "Failed to build ICU (exit code: ${ICU_BUILD_RESULT}).")
      endif()
    endif()

    # Copy ICU libs to WEBKIT_LIB_PATH with the names BuildBun.cmake expects.
    # Prebuilt WebKit uses 's' prefix (static) and 'd' suffix (debug).
    file(MAKE_DIRECTORY ${WEBKIT_LIB_PATH})
    if(WEBKIT_BUILD_TYPE STREQUAL "Debug")
      set(ICU_SUFFIX "d")
    else()
      set(ICU_SUFFIX "")
    endif()
    file(COPY_FILE ${ICU_LOCAL_ROOT}/lib/sicudt.lib ${WEBKIT_LIB_PATH}/sicudt${ICU_SUFFIX}.lib ONLY_IF_DIFFERENT)
    file(COPY_FILE ${ICU_LOCAL_ROOT}/lib/icuin.lib ${WEBKIT_LIB_PATH}/sicuin${ICU_SUFFIX}.lib ONLY_IF_DIFFERENT)
    file(COPY_FILE ${ICU_LOCAL_ROOT}/lib/icuuc.lib ${WEBKIT_LIB_PATH}/sicuuc${ICU_SUFFIX}.lib ONLY_IF_DIFFERENT)
  endif()

  # --- Configure JSC ---
  message(STATUS "Configuring JSC from local WebKit source at ${WEBKIT_SOURCE_DIR}...")

  set(JSC_CMAKE_ARGS
    -S ${WEBKIT_SOURCE_DIR}
    -B ${WEBKIT_PATH}
    -G ${CMAKE_GENERATOR}
    -DPORT=JSCOnly
    -DENABLE_STATIC_JSC=ON
    -DUSE_THIN_ARCHIVES=OFF
    -DENABLE_FTL_JIT=ON
    -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
    -DUSE_BUN_JSC_ADDITIONS=ON
    -DUSE_BUN_EVENT_LOOP=ON
    -DENABLE_BUN_SKIP_FAILING_ASSERTIONS=ON
    -DALLOW_LINE_AND_COLUMN_NUMBER_IN_BUILTINS=ON
    -DCMAKE_BUILD_TYPE=${WEBKIT_BUILD_TYPE}
    -DCMAKE_C_COMPILER=${CMAKE_C_COMPILER}
    -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
    -DENABLE_REMOTE_INSPECTOR=ON
  )

  if(WIN32)
    # ICU paths and Windows-specific compiler/linker settings
    list(APPEND JSC_CMAKE_ARGS
      -DICU_ROOT=${ICU_LOCAL_ROOT}
      -DICU_LIBRARY=${ICU_LOCAL_ROOT}/lib
      -DICU_INCLUDE_DIR=${ICU_LOCAL_ROOT}/include
      -DCMAKE_LINKER=lld-link
    )
    # Static CRT and U_STATIC_IMPLEMENTATION
    if(WEBKIT_BUILD_TYPE STREQUAL "Debug")
      set(JSC_MSVC_RUNTIME "MultiThreadedDebug")
    else()
      set(JSC_MSVC_RUNTIME "MultiThreaded")
    endif()
    list(APPEND JSC_CMAKE_ARGS
      -DCMAKE_MSVC_RUNTIME_LIBRARY=${JSC_MSVC_RUNTIME}
      "-DCMAKE_C_FLAGS=/DU_STATIC_IMPLEMENTATION"
      "-DCMAKE_CXX_FLAGS=/DU_STATIC_IMPLEMENTATION /clang:-fno-c++-static-destructors"
    )
  endif()

  if(ENABLE_ASAN)
    list(APPEND JSC_CMAKE_ARGS -DENABLE_SANITIZERS=address)
  endif()

  # Pass through ccache if available
  if(CMAKE_C_COMPILER_LAUNCHER)
    list(APPEND JSC_CMAKE_ARGS -DCMAKE_C_COMPILER_LAUNCHER=${CMAKE_C_COMPILER_LAUNCHER})
  endif()
  if(CMAKE_CXX_COMPILER_LAUNCHER)
    list(APPEND JSC_CMAKE_ARGS -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER})
  endif()

  execute_process(
    COMMAND ${CMAKE_COMMAND} ${JSC_CMAKE_ARGS}
    RESULT_VARIABLE JSC_CONFIGURE_RESULT
  )
  if(NOT JSC_CONFIGURE_RESULT EQUAL 0)
    message(FATAL_ERROR "Failed to configure JSC (exit code: ${JSC_CONFIGURE_RESULT}). "
      "Check the output above for errors.")
  endif()

  if(WIN32)
    set(JSC_BYPRODUCTS
      ${WEBKIT_LIB_PATH}/JavaScriptCore.lib
      ${WEBKIT_LIB_PATH}/WTF.lib
      ${WEBKIT_LIB_PATH}/bmalloc.lib
    )
  else()
    set(JSC_BYPRODUCTS
      ${WEBKIT_LIB_PATH}/libJavaScriptCore.a
      ${WEBKIT_LIB_PATH}/libWTF.a
      ${WEBKIT_LIB_PATH}/libbmalloc.a
    )
  endif()

  if(WIN32)
    add_custom_target(jsc ALL
      COMMAND ${CMAKE_COMMAND} --build ${WEBKIT_PATH} --config ${WEBKIT_BUILD_TYPE} --target jsc
      BYPRODUCTS ${JSC_BYPRODUCTS}
      COMMENT "Building JSC (${WEBKIT_PATH})"
    )
  else()
    add_custom_target(jsc ALL
      COMMAND ${CMAKE_COMMAND} --build ${WEBKIT_PATH} --config ${WEBKIT_BUILD_TYPE} --target jsc
      BYPRODUCTS ${JSC_BYPRODUCTS}
      COMMENT "Building JSC (${WEBKIT_PATH})"
      USES_TERMINAL
    )
  endif()

  include_directories(
    ${WEBKIT_PATH}
    ${WEBKIT_PATH}/JavaScriptCore/Headers
    ${WEBKIT_PATH}/JavaScriptCore/Headers/JavaScriptCore
    ${WEBKIT_PATH}/JavaScriptCore/PrivateHeaders
    ${WEBKIT_PATH}/bmalloc/Headers
    ${WEBKIT_PATH}/WTF/Headers
    ${WEBKIT_PATH}/JavaScriptCore/PrivateHeaders/JavaScriptCore
  )

  # On Windows, add ICU headers from the local ICU build
  if(WIN32)
    include_directories(${ICU_LOCAL_ROOT}/include)
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

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|ARM64|aarch64|AARCH64")
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

if(WEBKIT_VERSION MATCHES "^autobuild-")
  set(WEBKIT_TAG ${WEBKIT_VERSION})
else()
  set(WEBKIT_TAG autobuild-${WEBKIT_VERSION})
endif()

setx(WEBKIT_DOWNLOAD_URL https://github.com/oven-sh/WebKit/releases/download/${WEBKIT_TAG}/${WEBKIT_FILENAME})

if(EXISTS ${WEBKIT_PATH}/package.json)
  file(READ ${WEBKIT_PATH}/package.json WEBKIT_PACKAGE_JSON)

  if(WEBKIT_PACKAGE_JSON MATCHES ${WEBKIT_VERSION})
    return()
  endif()
endif()

file(
  DOWNLOAD ${WEBKIT_DOWNLOAD_URL} ${CACHE_PATH}/${WEBKIT_FILENAME} SHOW_PROGRESS
  STATUS WEBKIT_DOWNLOAD_STATUS
)
if(NOT "${WEBKIT_DOWNLOAD_STATUS}" MATCHES "^0;")
  message(FATAL_ERROR "Failed to download WebKit: ${WEBKIT_DOWNLOAD_STATUS}")
endif()

file(ARCHIVE_EXTRACT INPUT ${CACHE_PATH}/${WEBKIT_FILENAME} DESTINATION ${CACHE_PATH} TOUCH)
file(REMOVE ${CACHE_PATH}/${WEBKIT_FILENAME})
file(REMOVE_RECURSE ${WEBKIT_PATH})
file(RENAME ${CACHE_PATH}/bun-webkit ${WEBKIT_PATH})

if(APPLE)
  file(REMOVE_RECURSE ${WEBKIT_INCLUDE_PATH}/unicode)
endif()
