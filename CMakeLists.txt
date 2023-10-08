cmake_minimum_required(VERSION 3.10)

project(bun VERSION 1.0.4 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)


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


set(BUN_BASE_VERSION "1.0")

set(TRIPLET ${CMAKE_SYSTEM_NAME}-${CMAKE_SYSTEM_PROCESSOR})
string(TOLOWER ${TRIPLET} TRIPLET)

set(PACKAGE_NAME "bun-${TRIPLET}")
set(PACKAGES_REALPATH "${CMAKE_CURRENT_SOURCE_DIR}/packages")
set(PACKAGE_DIR "${PACKAGES_REALPATH}/${PACKAGE_NAME}")
set(DEBUG_PACKAGE_DIR "${PACKAGES_REALPATH}/debug-${PACKAGE_NAME}")
set(RELEASE_BUN "${PACKAGE_DIR}/bun")
set(DEBUG_BIN "${DEBUG_PACKAGE_DIR}")
set(DEBUG_BUN "${DEBUG_BIN}/bun-debug")
file(READ "./src/build-id" BUILD_ID)
set(PACKAGE_JSON_VERSION "${BUN_BASE_VERSION}.${BUILD_ID}")
set(BUN_BUILD_TAG "bun-v${PACKAGE_JSON_VERSION}")
set(BUN_RELEASE_BIN "${PACKAGE_DIR}/bun")

find_program(PRETTIER "prettier")
if (NOT PRETTIER)
    set(PRETTIER "./node_modules/.bin/prettier" CACHE)
endif()
find_program(ESBUILD "esbuild")
if (NOT ESBUILD)
    set(ESBUILD "./node_modules/.bin/esbuild" CACHE)
endif()
find_program(DSYMUTIL "dsymutil")
if (NOT DSYMUTIL)
    find_program(DSYMUTIL "dsymutil-15")
endif()
set(WEBKIT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/WebKit")
set(WEBKIT_RELEASE_DIR "${WEBKIT_DIR}/WebKitBuild/Release")
set(WEBKIT_DEBUG_DIR "${WEBKIT_DIR}/WebKitBuild/Debug")
set(WEBKIT_RELEASE_LTO "${WEBKIT_RELEASE_DIR}/WebKitBuild/ReleaseLTO")

message(STATUS "#### : ${BUN_RELEASE_BIN}")

