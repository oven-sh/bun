cmake_minimum_required(VERSION 3.10)

set(BUN_BASE_VERSION "1.0")
file(READ "./src/build-id" BUILD_ID)
set(PACKAGE_JSON_VERSION "${BUN_BASE_VERSION}.${BUILD_ID}")
project(bun VERSION ${PACKAGE_JSON_VERSION} LANGUAGES CXX)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

if (NOT CI)
    string(APPEND CMAKE_CXX_FLAGS "-MMD")
endIf()

execute_process(
    COMMAND brew --prefix
    OUTPUT_VARIABLE BREW_PREFIX_PATH
    OUTPUT_STRIP_TRAILING_WHITESPACE
)
# Determine OS name
execute_process(
    COMMAND uname -s
    COMMAND tr '[:upper:]' '[:lower:]'
    OUTPUT_VARIABLE OS_NAME
    OUTPUT_STRIP_TRAILING_WHITESPACE
)

# Determine architecture
execute_process(
    COMMAND uname -m
    OUTPUT_VARIABLE ARCH_NAME_RAW
    OUTPUT_STRIP_TRAILING_WHITESPACE
)

set(BUN_AUTO_UPDATER_REPO "Jarred-Sumner/bun-releases-for-updater")
set(CMAKE_CXX_COMPILER_LAUNCHER_FLAG "")

# On Linux ARM64, uname -m reports aarch64
if(ARCH_NAME_RAW STREQUAL "aarch64")
    set(ARCH_NAME_RAW "arm64")
endif()

if(NOT DEFINED CPU_TARGET)
    set(CPU_TARGET "native")
endif()

set(MARCH_NATIVE "-mtune=${CPU_TARGET}")
set(NATIVE_OR_OLD_MARCH "")
set(MMD_IF_LOCAL "")
set(DEFAULT_MIN_MACOS_VERSION "")
set(ARCH_NAME "")
set(DOCKER_BUILDARCH "")
set(AR "")

if(ARCH_NAME_RAW STREQUAL "arm64")
    set(ARCH_NAME "aarch64")
    set(DOCKER_BUILDARCH "arm64")
    set(BREW_PREFIX_PATH "/opt/homebrew")
    set(DEFAULT_MIN_MACOS_VERSION "11.0")
    set(MARCH_NATIVE "-mtune=${CPU_TARGET}")
else()
    set(ARCH_NAME "x64")
    set(DOCKER_BUILDARCH "amd64")
    set(BREW_PREFIX_PATH "/usr/local")
    set(DEFAULT_MIN_MACOS_VERSION "10.14")
    set(MARCH_NATIVE "-march=${CPU_TARGET} -mtune=${CPU_TARGET}")
    set(NATIVE_OR_OLD_MARCH "-march=nehalem")
endif()

if(NOT DEFINED MIN_MACOS_VERSION)
    set(MIN_MACOS_VERSION ${DEFAULT_MIN_MACOS_VERSION})
endif()

if(NOT DEFINED CI)
    set(CI "false")
endif()

# find node or bun
message(STATUS "Looking for bun or node")
find_program(EXE_BUN "bun")
message(STATUS "bun: ${EXE_BUN}")
if (EXE_BUN)
    message(STATUS "Found bun: ${EXE_BUN}")
    set(BUN_OR_NODE ${EXE_BUN})
else()
    find_program(EXE_NODE "node")
    if (EXE_NODE)
        message(STATUS "Found node: ${EXE_NODE}")
        set(BUN_OR_NODE ${EXE_NODE})
    else()
        message(FATAL_ERROR "No bun or node found")
    endif()
endif()
unset(EXE_NODE CACHE)


set(TRIPLET ${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR})
string(TOLOWER ${TRIPLET} TRIPLET)

set(PACKAGE_NAME "bun-${TRIPLET}")
set(PACKAGES_REALPATH "${CMAKE_CURRENT_SOURCE_DIR}/packages")
set(PACKAGE_DIR "${PACKAGES_REALPATH}/${PACKAGE_NAME}")
set(DEBUG_PACKAGE_DIR "${PACKAGES_REALPATH}/debug-${PACKAGE_NAME}")
set(RELEASE_BUN "${PACKAGE_DIR}/bun")
set(DEBUG_BIN "${DEBUG_PACKAGE_DIR}")
set(DEBUG_BUN "${DEBUG_BIN}/bun-debug")
set(BUN_BUILD_TAG "bun-v${PACKAGE_JSON_VERSION}")
set(BUN_RELEASE_BIN "${PACKAGE_DIR}/bun")

find_program(PRETTIER "prettier")
if (NOT PRETTIER)
    set(PRETTIER "./node_modules/.bin/prettier" CACHE STRING "Prettier executable")
endif()
find_program(ESBUILD "esbuild")
if (NOT ESBUILD)
    set(ESBUILD "./node_modules/.bin/esbuild" CACHE STRING "esbuild executable")
endif()
find_program(DSYMUTIL NAMES "dsymutil" "dsymutil-15")
set(WEBKIT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/WebKit")
set(WEBKIT_RELEASE_DIR "${WEBKIT_DIR}/WebKitBuild/Release")
set(WEBKIT_DEBUG_DIR "${WEBKIT_DIR}/WebKitBuild/Debug")
set(WEBKIT_RELEASE_LTO "${WEBKIT_RELEASE_DIR}/WebKitBuild/ReleaseLTO")

find_program(NPM_CLIENT NAMES "bun" "npm")
if(NOT NPM_CLIENT)
  message(WARNING "Neither 'bun' nor 'npm' was found on the system.")
endif()

find_program(ZIG "zig")
if (NOT ZIG)
    message(FATAL_ERROR "error: Missing zig. Please make sure zig is in PATH.")
endif()


# We must use the same compiler version for the JavaScriptCore bindings and JavaScriptCore
# If we don't do this, strange memory allocation failures occur.
# This is easier to happen than you'd expect.
# Using realpath here causes issues because clang uses clang++ as a symlink
# so if that's resolved, it won't build for C++
if (NOT WIN32)
    find_program(REAL_CC "clang-16")
    if (NOT REAL_CC)
        find_program(REAL_CC "clang")
    endif()
    find_program(REAL_CXX "clang++-16")
    if (NOT REAL_CXX)
        find_program(REAL_CXX "clang++")
    endif()

    set(CMAKE_C_COMPILER "${REAL_CC}")
    set(CMAKE_CXX_COMPILER "${REAL_CXX}")
    set(CMAKE_AR "${AR}")
    set(CMAKE_OSX_DEPLOYMENT_TARGET ${MIN_MACOS_VERSION})
    find_program(CMAKE_RANLIB NAMES llvm-16-ranlib llvm-ranlib)

    # else let cmake find msvc
endif()

# use ccache if available
find_program(CCACHE "ccache")
if(CCACHE)
    set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE}")
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE}")
endif()

if (APPLE)
    # Find LLVM
    # If LLVM_PREFIX is not set or points to a non-existing location
    if(NOT DEFINED LLVM_PREFIX OR NOT EXISTS ${LLVM_PREFIX})
        # Try to find llvm@16 using brew
        execute_process(COMMAND brew --prefix llvm@16
                        OUTPUT_VARIABLE TEMP_LLVM_PREFIX
                        OUTPUT_STRIP_TRAILING_WHITESPACE) # Removes newlines from the output

        # If the path exists
        if(EXISTS ${TEMP_LLVM_PREFIX})
            set(LLVM_PREFIX ${TEMP_LLVM_PREFIX})
        endif()
    endif()

    # If LLVM_PREFIX is still not set or points to a non-existing location
    if(NOT DEFINED LLVM_PREFIX OR NOT EXISTS ${LLVM_PREFIX})

        # Try to find the default llvm using brew
        execute_process(COMMAND brew --prefix llvm
                        OUTPUT_VARIABLE TEMP_LLVM_PREFIX
                        OUTPUT_STRIP_TRAILING_WHITESPACE)

        # If the path exists
        if(EXISTS ${TEMP_LLVM_PREFIX})
            set(LLVM_PREFIX ${TEMP_LLVM_PREFIX})
        endif()
    endif()

    # If LLVM_PREFIX is still not set or points to a non-existing location
    if(NOT DEFINED LLVM_PREFIX OR NOT EXISTS ${LLVM_PREFIX})
        message(FATAL_ERROR "Unable to find llvm. Please run 'brew install llvm@16' or set LLVM_PREFIX=/path/to/llvm")
    endif()


    # Use LLVM libraries and includes
    link_directories(${LLVM_PREFIX}/lib)
    include_directories(${LLVM_PREFIX}/include)

    # Set compilers
    set(CMAKE_C_COMPILER ${LLVM_PREFIX}/bin/clang)
    set(CMAKE_CXX_COMPILER ${LLVM_PREFIX}/bin/clang++)

    # Set codesign identity if not already set
    if(NOT DEFINED CODESIGN_IDENTITY)
        execute_process(
            COMMAND security find-identity -v -p codesigning
            COMMAND awk '/Apple Development/ { print $$2 }'
            OUTPUT_VARIABLE CODESIGN_IDENTITY
            OUTPUT_STRIP_TRAILING_WHITESPACE
        )
    endif()
endif()

# macOS sed is different
find_program(SED NAMES gsed sed)


# Determine directory of current CMakeLists.txt
get_filename_component(BUN_DIR ${CMAKE_CURRENT_LIST_FILE} DIRECTORY)

# Set the dependencies directories
if(NOT DEFINED BUN_DEPS_DIR)
  set(BUN_DEPS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/deps")
endif()

if(NOT DEFINED BUN_DEPS_OUT_DIR)
  set(BUN_DEPS_OUT_DIR ${BUN_DEPS_DIR})
endif()

# Determine CPU count
if(APPLE)
  execute_process(COMMAND sysctl -n hw.logicalcpu OUTPUT_VARIABLE CPU_COUNT OUTPUT_STRIP_TRAILING_WHITESPACE)
elseif(UNIX) # This branch covers Linux, among others
  execute_process(COMMAND nproc OUTPUT_VARIABLE CPU_COUNT OUTPUT_STRIP_TRAILING_WHITESPACE)
else()
  set(CPU_COUNT 2) # Default value
endif()

# Default CPUS to CPU_COUNT if not set
if(NOT DEFINED CPUS)
  set(CPUS ${CPU_COUNT})
endif()

# Default USER to environment variable USER
if(NOT DEFINED USER)
  set(USER $ENV{USER})
endif()

if(NOT DEFINED BUN_RELEASE_DIR)
  get_filename_component(BUN_RELEASE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../bun-release" ABSOLUTE)
endif()

set(OPENSSL_VERSION "OpenSSL_1_1_1l")

# TODO: use cmake's find_package
if (NOT DEFINED LIBICONV_PATH)
    set(LIBICONV_PATH "${BREW_PREFIX_PATH}/opt/libiconv/lib/libiconv.a")
endif()

# TODOL: not sure if this is needed
set(OPTIMIZATION_LEVEL "-O3 ${MARCH_NATIVE}")
set(DEBUG_OPTIMIZATION_LEVEL "-O1 ${MARCH_NATIVE} -gdwarf-4")
set(CFLAGS_WITHOUT_MARCH "${MACOS_MIN_FLAG} ${OPTIMIZATION_LEVEL} -fno-exceptions -fvisibility=hidden -fvisibility-inlines-hidden")
set(BUN_CFLAGS "${MACOS_MIN_FLAG} ${MARCH_NATIVE} ${OPTIMIZATION_LEVEL} -fno-exceptions -fvisibility=hidden -fvisibility-inlines-hidden")
set(BUN_TMP_DIR "/tmp/make-bun")
set(CFLAGS "${CFLAGS_WITHOUT_MARCH} ${MARCH_NATIVE}")

set(DEFAULT_USE_BMALLOC "1")

# Conditional setting of USE_BMALLOC
if(NOT DEFINED USE_BMALLOC)
    set(USE_BMALLOC ${DEFAULT_USE_BMALLOC})
endif()


# jsc start
# Set via postinstall
if(NOT EXISTS "${JSC_BASE_DIR}")
    file(GLOB BUN_WEBKIT_DIRS "bun-webkit")
    list(GET BUN_WEBKIT_DIRS 0 FIRST_BUN_WEBKIT_DIR)
    if(EXISTS "${FIRST_BUN_WEBKIT_DIR}")
        set(JSC_BASE_DIR "${FIRST_BUN_WEBKIT_DIR}")
    else()
        set(JSC_BASE_DIR "$ENV{HOME}/webkit-build")
    endif()
endif()

set(DEFAULT_JSC_LIB "${JSC_BASE_DIR}/lib")
set(DEFAULT_JSC_LIB_DEBUG "${DEFAULT_JSC_LIB}")

if(EXISTS "${WEBKIT_RELEASE_DIR_LTO}/lib")
    set(DEFAULT_JSC_LIB "${WEBKIT_RELEASE_DIR_LTO}/lib")
endif()

if(EXISTS "${WEBKIT_RELEASE_DIR}/lib")
    set(DEFAULT_JSC_LIB_DEBUG "${WEBKIT_RELEASE_DIR}/lib")
endif()

if(NOT DEFINED JSC_LIB)
    set(JSC_LIB ${DEFAULT_JSC_LIB})
endif()

if(NOT DEFINED JSC_LIB_DEBUG)
    set(JSC_LIB_DEBUG ${DEFAULT_JSC_LIB_DEBUG})
endif()

if(NOT DEFINED JSC_INCLUDE_DIR)
    set(JSC_INCLUDE_DIR "${JSC_BASE_DIR}/include")
endif()

if(NOT DEFINED ZLIB_INCLUDE_DIR)
    set(ZLIB_INCLUDE_DIR "${BUN_DEPS_DIR}/zlib")
endif()

if(NOT DEFINED ZLIB_LIB_DIR)
    set(ZLIB_LIB_DIR "${BUN_DEPS_DIR}/zlib")
endif()

set(JSC_FILES
    "${JSC_LIB}/libJavaScriptCore.a"
    "${JSC_LIB}/libWTF.a"
    "${JSC_LIB}/libbmalloc.a"
)
set(JSC_FILES_DEBUG
    "${JSC_LIB_DEBUG}/libJavaScriptCore.a"
    "${JSC_LIB_DEBUG}/libWTF.a"
    "${JSC_LIB_DEBUG}/libbmalloc.a"
)

if(NOT DEFINED ENABLE_MIMALLOC)
    set(ENABLE_MIMALLOC 1)
endif()

# https://github.com/microsoft/mimalloc/issues/512
# Linking mimalloc via object file on macOS x64 can cause heap corruption
set(_MIMALLOC_FILE "libmimalloc.o")
set(_MIMALLOC_INPUT_PATH "CMakeFiles/mimalloc-obj.dir/src/static.c.o")
set(_MIMALLOC_DEBUG_FILE "libmimalloc-debug.a")
set(_MIMALLOC_OBJECT_FILE 1)
set(_MIMALLOC_LINK "${BUN_DEPS_OUT_DIR}/${_MIMALLOC_FILE}")
set(DEFAULT_LINKER_FLAGS "")

set(JSC_BUILD_STEPS "")

if("${OS_NAME}" STREQUAL "linux")
    list(APPEND JSC_BUILD_STEPS "jsc-build-linux")
    set(_MIMALLOC_LINK "${BUN_DEPS_OUT_DIR}/${_MIMALLOC_FILE}")
    set(DEFAULT_LINKER_FLAGS "-pthread -ldl")
elseif("${OS_NAME}" STREQUAL "darwin")
    set(_MIMALLOC_OBJECT_FILE 0)
    list(APPEND JSC_BUILD_STEPS "jsc-build-mac" "jsc-copy-headers")
    set(_MIMALLOC_FILE "libmimalloc.a")
    set(_MIMALLOC_INPUT_PATH "libmimalloc.a")
    set(_MIMALLOC_LINK "-lmimalloc")
endif()

if(${ENABLE_MIMALLOC} EQUAL 1)
    set(MIMALLOC_FILE ${_MIMALLOC_FILE})
    set(MIMALLOC_INPUT_PATH ${_MIMALLOC_INPUT_PATH})
endif()

# jsc end

if("${OS_NAME}" STREQUAL "darwin")
    set(STRIP "/usr/bin/strip")
elseif("${OS_NAME}" STREQUAL "linux")
    find_program(LLVM_STRIP NAMES llvm-strip)
    find_program(LLVM_STRIP_16 NAMES llvm-strip-16)
    find_program(SYSTEM_STRIP NAMES strip)
    if(LLVM_STRIP)
        set(STRIP ${LLVM_STRIP})
    elseif(LLVM_STRIP_16)
        set(STRIP ${LLVM_STRIP_16})
    elseif(SYSTEM_STRIP)
        set(STRIP ${SYSTEM_STRIP})
    else()
        message(FATAL_ERROR "Missing strip")
    endif()
endif()

set(SRC_DIR "src/bun.js/bindings")
set(MODULES_DIR "src/bun.js/modules")
set(OBJ_DIR "src/bun.js/bindings-obj")
set(DEBUG_OBJ_DIR "src/bun.js/debug-bindings-obj")

# List of source files
file(GLOB SRC_FILES "${SRC_DIR}/*.cpp")
file(GLOB MODULES_FILES "${MODULES_DIR}/*.cpp")
file(GLOB SRC_WEBCORE_FILES "${SRC_DIR}/webcore/*.cpp")
file(GLOB SRC_SQLITE_FILES "${SRC_DIR}/sqlite/*.cpp")
file(GLOB SRC_NODE_OS_FILES "${SRC_DIR}/node_os/*.cpp")
file(GLOB SRC_IO_FILES "src/io/*.cpp")
file(GLOB SRC_BUILTINS_FILES "src/js/out/*.cpp")
file(GLOB SRC_WEBCRYPTO_FILES "${SRC_DIR}/webcrypto/*.cpp")

# Include directories
set(ALL_JSC_INCLUDE_DIRS
    ${WEBKIT_RELEASE_DIR}/WTF/Headers
    ${WEBKIT_RELEASE_DIR}/ICU/Headers
    ${WEBKIT_RELEASE_DIR}/bmalloc/Headers
    ${WEBKIT_RELEASE_DIR}
    ${WEBKIT_RELEASE_DIR}/include
    ${WEBKIT_RELEASE_DIR}/JavaScriptCore/PrivateHeaders
    ${WEBKIT_RELEASE_DIR}/bmalloc/PrivateHeaders
    ${WEBKIT_RELEASE_DIR}/WTF/PrivateHeaders
)

set(SHARED_INCLUDE_DIR
    ${CMAKE_SOURCE_DIR}/src/bun.js/bindings
    ${CMAKE_SOURCE_DIR}/src/js/builtins
    ${CMAKE_SOURCE_DIR}/src/js/out
    ${CMAKE_SOURCE_DIR}/src/bun.js/bindings
    ${CMAKE_SOURCE_DIR}/src/bun.js/bindings/webcore
    ${CMAKE_SOURCE_DIR}/src/bun.js/bindings/webcrypto
    ${CMAKE_SOURCE_DIR}/src/bun.js/bindings/sqlite
    ${CMAKE_SOURCE_DIR}/src/bun.js/bindings/node_os
    ${CMAKE_SOURCE_DIR}/src/bun.js/modules
    ${JSC_INCLUDE_DIR}
)

set(MAC_INCLUDE_DIRS
    ${ALL_JSC_INCLUDE_DIRS}
    ${SHARED_INCLUDE_DIR}
    ${WEBKIT_DIR}/Source
)

set(LINUX_INCLUDE_DIRS
    ${ALL_JSC_INCLUDE_DIRS}
    ${SHARED_INCLUDE_DIR}
    ${ZLIB_INCLUDE_DIR}
)

set(UWS_INCLUDE_DIR
    ${BUN_DIR}/packages/bun-usockets/src
    ${BUN_DIR}/packages
    ${BUN_DEPS_DIR}
)

set(INCLUDE_DIRS
    ${UWS_INCLUDE_DIR}
    ${BUN_DEPS_DIR}/mimalloc/include
    ${BUN_DEPS_DIR}/zstd/include
    src/napi
    ${BUN_DEPS_DIR}/boringssl/include
    ${BUN_DEPS_DIR}/c-ares/include
    ${MODULES_DIR}
)

# Depending on the target OS, you can add include directories
if(OS_NAME STREQUAL "darwin")
    include_directories(${MAC_INCLUDE_DIRS})
elseif(OS_NAME STREQUAL "linux")
    include_directories(${LINUX_INCLUDE_DIRS})
endif()

include_directories(${INCLUDE_DIRS})

# ... the rest of your CMake logic


add_custom_target(
    js
    COMMAND ${CMAKE_COMMAND} -E env NODE_ENV=production bun ${CMAKE_SOURCE_DIR}/src/js/_codegen/index.ts
    DEPENDS ${CMAKE_SOURCE_DIR}/src/js/_codegen/index.ts
)

add_custom_target(
    static-hash-table
    ${EXE_BUN} ${CMAKE_SOURCE_DIR}/src/js/_codegen/static-hash-tables.ts
    DEPENDS ${CMAKE_SOURCE_DIR}/src/js/_codegen/static-hash-tables.ts
)


file(GLOB_RECURSE SRCS ${SRC_DIR}/*.cpp)
file(GLOB_RECURSE SRCS2 src/bun.js/modules/*.cpp)
list(APPEND SRCS ${SRCS2})
file(GLOB_RECURSE SRCS2 src/io/*.cpp)
list(APPEND SRCS ${SRCS2})
file(GLOB_RECURSE SRCS2 src/js/out/*.cpp)
list(APPEND SRCS ${SRCS2})


add_custom_target(
    zig-obj
    COMMAND ${ZIG} build obj -freference-trace -Dcpu="${CPU_TARGET}"
)

add_executable(
    bun

    ${CMAKE_SOURCE_DIR}/packages/debug-bun-linux-x64/bun-debug.o
    ${SRCS}
)
add_dependencies(bun js static-hash-table zig-obj)



message(STATUS "#### : ${JSC_FILES_DEBUG}")
