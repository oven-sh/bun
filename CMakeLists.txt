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
unset(EXE_BUN CACHE)
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




message(STATUS "#### : ${CMAKE_PROJECT_VERSION}")
