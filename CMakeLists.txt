cmake_minimum_required(VERSION 3.22)
cmake_policy(SET CMP0091 NEW)
cmake_policy(SET CMP0067 NEW)

set(CMAKE_POLICY_DEFAULT_CMP0069 NEW)
set(Bun_VERSION "1.1.27")
set(WEBKIT_TAG 147ed53838e21525677492c27099567a6cd19c6b)

set(CWD ${CMAKE_SOURCE_DIR})
set(BUILD_PATH ${CMAKE_BINARY_DIR})
set(CACHE_PATH ${CWD}/.cache)

set(BUN_WORKDIR "${CMAKE_CURRENT_BINARY_DIR}")
message(STATUS "Configuring Bun ${Bun_VERSION} in ${BUN_WORKDIR}")

set(CMAKE_COLOR_DIAGNOSTICS ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_C_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD_REQUIRED ON)

# WebKit uses -std=gnu++20 on non-macOS non-Windows
# If we do not set this, it will crash at startup on the first memory allocation.
if(NOT WIN32 AND NOT APPLE)
    set(CMAKE_CXX_EXTENSIONS ON)
    set(CMAKE_POSITION_INDEPENDENT_CODE FALSE)
endif()

if(WIN32 AND NOT CMAKE_CL_SHOWINCLUDES_PREFIX)
    # workaround until cmake fix is shipped https://github.com/ninja-build/ninja/issues/2280
    # './build/.ninja_deps' may need to be deleted, the bug is "Note: including file: ..." is saved
    # as part of some file paths
    set(CMAKE_CL_SHOWINCLUDES_PREFIX "Note: including file:")
endif()

# Must be called before project() so CMake doesn't pick its own compiler
if(APPLE)
    include(cmake/SetupMacSDK.cmake)
endif()
include(cmake/SetupLLVM.cmake)
include(cmake/SetupCcache.cmake)

project(Bun VERSION "${Bun_VERSION}")

include(cmake/Options.cmake)

if(NOT BUN_CPP_ONLY AND NOT BUN_LINK_ONLY)
    include(cmake/SetupZig.cmake)
endif()

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(DEBUG ON)
    set(bun "bun-debug")

    # COMPILE_COMMANDS
    set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(DEBUG OFF)

    if(WIN32)
        # Debug symbols are in a separate file: bun.pdb
        set(bun "bun")
    else()
        if(USE_ZIG_OPTIMIZE STREQUAL "Debug")
            set(bun "bun-debug")
        else()
            set(bun "bun-profile")
        endif()
    endif()
endif()

if(NOT WIN32)
    set(SHELL "bash")
    set(SCRIPT_EXTENSION "sh")
else()
    set(SCRIPT_EXTENSION "ps1")

    # pwsh is the new powershell, powershell is the old one.
    find_program(SHELL NAMES pwsh powershell)
endif()

set(CI OFF)

if(DEFINED ENV{CI} OR DEFINED ENV{GITHUB_ACTIONS})
    set(CI ON)
endif()

if(WIN32 AND USE_LTO)
    set(CMAKE_LINKER_TYPE LLD)
    set(CMAKE_INTERPROCEDURAL_OPTIMIZATION OFF)
endif()

option(BUN_TIDY_ONLY "Only run clang-tidy" OFF)
option(BUN_TIDY_ONLY_EXTRA " Only run clang-tidy, with extra checks for local development" OFF)

if(USE_VALGRIND)
    if(ARCH STREQUAL "x86_64")
        # This is for picohttpparser
        # Valgrind cannot handle SSE4.2 instructions
        add_compile_definitions("__SSE4_2__=0")
    endif()
endif()

set(ERROR_LIMIT 100 CACHE STRING "Maximum number of errors to show when compiling C++ code")

set(ARCH x86_64)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64|arm")
    set(ARCH aarch64)
endif()

set(CONFIGURE_DEPENDS "CONFIGURE_DEPENDS")

if(NO_CONFIGURE_DEPENDS)
    set(CONFIGURE_DEPENDS "")
endif()

# --- CLI Paths ---
set(REQUIRED_IF_NOT_ONLY_CPP_OR_LINK "")

if(NOT BUN_CPP_ONLY AND NOT BUN_LINK_ONLY)
    set(REQUIRED_IF_NOT_ONLY_CPP_OR_LINK "REQUIRED")
endif()

set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "build.zig")

# Bun
find_program(BUN_EXECUTABLE bun ${REQUIRED_IF_NOT_ONLY_CPP_OR_LINK} DOC "Path to an already built release of Bun")
message(STATUS "Found Bun: ${BUN_EXECUTABLE}")

# --- WebKit ---
# WebKit is either prebuilt and distributed via NPM, or you can pass WEBKIT_DIR to use a local build.
# We cannot include their CMake build files (TODO: explain why, for now ask @paperdave why)
#
# On Unix, this will pull from NPM the single package that is needed and use that
if(WIN32)
    set(STATIC_LIB_EXT "lib")
    set(libJavaScriptCore "JavaScriptCore")
    set(libWTF "WTF")
else()
    set(STATIC_LIB_EXT "a")
    set(libJavaScriptCore "libJavaScriptCore")
    set(libWTF "libWTF")
endif()

if(ENABLE_ASSERTIONS)
    add_compile_definitions("BUN_DEBUG=1")
endif()

include(cmake/SetupWebKit.cmake)

if(WEBKIT_PREBUILT)
    set(WEBKIT_INCLUDE_DIR ${WEBKIT_DIR}/include)

    if(APPLE)
        set(ICU_INCLUDE_DIR "")
    else()
        set(ICU_INCLUDE_DIR ${WEBKIT_DIR}/include/wtf/unicode)
    endif()

    set(WEBKIT_LIB_DIR ${WEBKIT_DIR}/lib)
elseif(WEBKIT_DIR STREQUAL "omit")
    # message(STATUS "Not using WebKit. This is only valid if you are only trying to build Zig code")
else()
    # Expected to be WebKit/WebKitBuild/${CMAKE_BUILD_TYPE}
    if(EXISTS "${WEBKIT_DIR}/cmakeconfig.h")
        # You may need to run:
        # make jsc-compile-debug jsc-copy-headers
        include_directories(
            "${WEBKIT_DIR}/"
            "${WEBKIT_DIR}/JavaScriptCore/Headers/JavaScriptCore"
            "${WEBKIT_DIR}/JavaScriptCore/PrivateHeaders"
            "${WEBKIT_DIR}/bmalloc/Headers"
            "${WEBKIT_DIR}/WTF/Headers"
        )
        set(WEBKIT_LIB_DIR "${WEBKIT_DIR}/lib")

        if(ENABLE_ASSERTIONS)
            add_compile_definitions("BUN_DEBUG=1")
        endif()

        message(STATUS "Using WebKit from ${WEBKIT_DIR}")
    else()
        if(NOT EXISTS "${WEBKIT_DIR}/lib/${libWTF}.${STATIC_LIB_EXT}" OR NOT EXISTS "${WEBKIT_DIR}/lib/${libJavaScriptCore}.${STATIC_LIB_EXT}")
            if(WEBKIT_DIR MATCHES "src/bun.js/WebKit$")
                message(FATAL_ERROR "WebKit directory ${WEBKIT_DIR} does not contain all the required files for Bun. Did you forget to init submodules?")
            endif()

            message(FATAL_ERROR "WebKit directory ${WEBKIT_DIR} does not contain all the required files for Bun. Expected a path to the oven-sh/WebKit repository, or a path to a folder containing `include` and `lib`.")
        endif()

        set(WEBKIT_INCLUDE_DIR "${WEBKIT_DIR}/include")
        set(WEBKIT_LIB_DIR "${WEBKIT_DIR}/lib")

        message(STATUS "Using specified WebKit directory: ${WEBKIT_DIR}")
        message(STATUS "WebKit assertions: OFF")
    endif()
endif()

# --- CMake Macros ---

# Append the given dependencies to the source file
macro(WEBKIT_ADD_SOURCE_DEPENDENCIES _source _deps)
    set(_tmp)
    get_source_file_property(_tmp ${_source} OBJECT_DEPENDS)

    if(NOT _tmp)
        set(_tmp "")
    endif()

    foreach(f ${_deps})
        list(APPEND _tmp "${f}")
    endforeach()

    set_source_files_properties(${_source} PROPERTIES OBJECT_DEPENDS "${_tmp}")
    unset(_tmp)
endmacro()

# --- BUILD ---
set(BUN_SRC "${CMAKE_CURRENT_SOURCE_DIR}/src")
set(BUN_DEPS_DIR "${BUN_SRC}/deps")
set(BUN_CODEGEN_SRC "${BUN_SRC}/codegen")

if(NOT BUN_DEPS_OUT_DIR)
    set(BUN_DEPS_OUT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/build/bun-deps")
endif()

set(BUN_RAW_SOURCES, "")

file(GLOB BUN_CPP ${CONFIGURE_DEPENDS}
    "${BUN_SRC}/deps/*.cpp"
    "${BUN_SRC}/io/*.cpp"
    "${BUN_SRC}/bun.js/modules/*.cpp"
    "${BUN_SRC}/bun.js/bindings/*.cpp"
    "${BUN_SRC}/bun.js/bindings/webcore/*.cpp"
    "${BUN_SRC}/bun.js/bindings/sqlite/*.cpp"
    "${BUN_SRC}/bun.js/bindings/webcrypto/*.cpp"
    "${BUN_SRC}/bun.js/bindings/webcrypto/*/*.cpp"
    "${BUN_SRC}/bun.js/bindings/v8/*.cpp"
    "${BUN_SRC}/deps/picohttpparser/picohttpparser.c"
)
list(APPEND BUN_RAW_SOURCES ${BUN_CPP})

# -- uSockets --
set(USOCKETS_SRC "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src")
file(GLOB USOCKETS_FILES ${CONFIGURE_DEPENDS}
    "${USOCKETS_SRC}/*.c"
    "${USOCKETS_SRC}/eventing/*.c"
    "${USOCKETS_SRC}/internal/*.c"
    "${USOCKETS_SRC}/crypto/*.c"
    "${USOCKETS_SRC}/crypto/*.cpp"
)
list(APPEND BUN_RAW_SOURCES ${USOCKETS_FILES})

# --- Classes Generator ---
file(GLOB BUN_CLASSES_TS ${CONFIGURE_DEPENDS}
    "${BUN_SRC}/bun.js/*.classes.ts"
    "${BUN_SRC}/bun.js/api/*.classes.ts"
    "${BUN_SRC}/bun.js/test/*.classes.ts"
    "${BUN_SRC}/bun.js/webcore/*.classes.ts"
    "${BUN_SRC}/bun.js/node/*.classes.ts"
)
add_custom_command(
    OUTPUT "${BUN_WORKDIR}/codegen/ZigGeneratedClasses.h"
    "${BUN_WORKDIR}/codegen/ZigGeneratedClasses.cpp"
    "${BUN_WORKDIR}/codegen/ZigGeneratedClasses+lazyStructureHeader.h"
    "${BUN_WORKDIR}/codegen/ZigGeneratedClasses+DOMClientIsoSubspaces.h"
    "${BUN_WORKDIR}/codegen/ZigGeneratedClasses+DOMIsoSubspaces.h"
    "${BUN_WORKDIR}/codegen/ZigGeneratedClasses+lazyStructureImpl.h"
    "${BUN_WORKDIR}/codegen/ZigGeneratedClasses.zig"
    COMMAND ${BUN_EXECUTABLE} run "${BUN_CODEGEN_SRC}/generate-classes.ts" ${BUN_CLASSES_TS} "${BUN_WORKDIR}/codegen"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    MAIN_DEPENDENCY "${BUN_CODEGEN_SRC}/generate-classes.ts"
    DEPENDS ${BUN_CLASSES_TS}
    VERBATIM
    COMMENT "Generating *.classes.ts bindings"
)
list(APPEND BUN_RAW_SOURCES "${BUN_WORKDIR}/codegen/ZigGeneratedClasses.cpp")

if(NOT NO_CODEGEN)
    # --- ErrorCode Generator ---
    file(GLOB NODE_ERRORS_TS ${CONFIGURE_DEPENDS}
        "${BUN_SRC}/bun.js/bindings/ErrorCode.ts"
    )
    add_custom_command(
        OUTPUT "${BUN_WORKDIR}/codegen/ErrorCode+List.h" "${BUN_WORKDIR}/codegen/ErrorCode+Data.h" "${BUN_WORKDIR}/codegen/ErrorCode.zig"
        COMMAND ${BUN_EXECUTABLE} run "${BUN_CODEGEN_SRC}/generate-node-errors.ts" "${BUN_WORKDIR}/codegen"
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        MAIN_DEPENDENCY "${BUN_CODEGEN_SRC}/generate-node-errors.ts"
        DEPENDS ${NODE_ERRORS_TS}
        VERBATIM
        COMMENT "Generating ErrorCode.zig"
    )

    # This needs something to force it to be regenerated
    WEBKIT_ADD_SOURCE_DEPENDENCIES(
        "${BUN_SRC}/bun.js/bindings/ErrorCode.cpp"
        "${BUN_WORKDIR}/codegen/ErrorCode+List.h"
    )
    WEBKIT_ADD_SOURCE_DEPENDENCIES(
        "${BUN_SRC}/bun.js/bindings/ErrorCode.h"
        "${BUN_WORKDIR}/codegen/ErrorCode+Data.h"
    )
endif()

# --- JSSink Generator ---
add_custom_command(
    OUTPUT "${BUN_WORKDIR}/codegen/JSSink.cpp"
    "${BUN_WORKDIR}/codegen/JSSink.h"
    COMMAND ${BUN_EXECUTABLE} run "src/codegen/generate-jssink.ts" "${BUN_WORKDIR}/codegen"
    VERBATIM
    MAIN_DEPENDENCY "src/codegen/generate-jssink.ts"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Generating JSSink"
    USES_TERMINAL
)
list(APPEND BUN_RAW_SOURCES "${BUN_WORKDIR}/codegen/JSSink.cpp")

# --- .lut.h Generator ---
set(BUN_OBJECT_LUT_SOURCES
    bun.js/bindings/BunObject.cpp
    bun.js/bindings/ZigGlobalObject.lut.txt
    bun.js/bindings/JSBuffer.cpp
    bun.js/bindings/BunProcess.cpp
    bun.js/bindings/ProcessBindingConstants.cpp
    bun.js/bindings/ProcessBindingNatives.cpp
)
set(BUN_OBJECT_LUT_OUTPUTS "")
set(BUN_HASH_LUT_GENERATOR "${BUN_CODEGEN_SRC}/create-hash-table.ts")

if(NOT BUN_LINK_ONLY)
    macro(GENERATE_HASH_LUT _input _output _display_name)
        if(NOT NO_CODEGEN)
            add_custom_command(
                OUTPUT ${_output}
                MAIN_DEPENDENCY ${BUN_HASH_LUT_GENERATOR}
                DEPENDS ${_input}
                COMMAND ${BUN_EXECUTABLE} run ${BUN_HASH_LUT_GENERATOR} ${_input} ${_output}
                VERBATIM
                COMMENT "Generating ${_display_name}"
            )
        endif()

        list(APPEND BUN_OBJECT_LUT_OUTPUTS "${_output}")

        # list(APPEND Bun_HEADERS ${_output})
        WEBKIT_ADD_SOURCE_DEPENDENCIES(${_input} ${_output})
    endmacro()

    foreach(_file ${BUN_OBJECT_LUT_SOURCES})
        if(NOT EXISTS "${BUN_SRC}/${_file}")
            message(FATAL_ERROR "Could not find ${_file} needed for LUT generation")
        endif()

        get_filename_component(_name ${_file} NAME_WE)

        # workaround for ZigGlobalObject
        if(_name MATCHES "ZigGlobalObject")
            set(_name "ZigGlobalObject")
        endif()

        GENERATE_HASH_LUT(${BUN_SRC}/${_file} ${BUN_WORKDIR}/codegen/${_name}.lut.h ${_name}.lut.h)
    endforeach()

    WEBKIT_ADD_SOURCE_DEPENDENCIES(${BUN_SRC}/bun.js/bindings/ZigGlobalObject.cpp ${BUN_WORKDIR}/codegen/ZigGlobalObject.lut.h)
endif()

# --- bun install ---
if(NOT NO_CODEGEN)
    set(BUN_INSTALL_OUT
        ${CMAKE_CURRENT_SOURCE_DIR}/node_modules
        ${CMAKE_CURRENT_SOURCE_DIR}/bun.lockb
    )
    add_custom_command(
        OUTPUT ${BUN_INSTALL_OUT}
        DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/package.json
        COMMAND ${BUN_EXECUTABLE} install --frozen-lockfile
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        VERBATIM
        COMMENT "Running bun install"
    )
endif()

# --- bun-error ---
if(NOT NO_CODEGEN)
    set(BUN_ERROR_WORKDIR ${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-error)
    set(BUN_ERROR_OUT
        ${BUN_ERROR_WORKDIR}/dist/index.js
        ${BUN_ERROR_WORKDIR}/dist/bun-error.css
    )
    add_custom_command(
        OUTPUT ${BUN_ERROR_WORKDIR}/node_modules
        COMMAND ${BUN_EXECUTABLE} install --frozen-lockfile
        WORKING_DIRECTORY ${BUN_ERROR_WORKDIR}
        VERBATIM
        COMMENT "Installing bun-error"
    )
    add_custom_command(
        OUTPUT ${BUN_ERROR_OUT}
        DEPENDS ${BUN_ERROR_WORKDIR}/node_modules
        COMMAND ${BUN_EXECUTABLE} x esbuild
            index.tsx bun-error.css
            --outdir=dist
            --define:process.env.NODE_ENV=\"'production'\"
            --minify
            --bundle
            --platform=browser
            --format=esm
        WORKING_DIRECTORY ${BUN_ERROR_WORKDIR}
        VERBATIM
        COMMENT "Building bun-error"
    )
endif()

# --- fallback-decoder ---
if(NOT NO_CODEGEN)
    set(FALLBACK_DECODER_SRC ${CMAKE_CURRENT_SOURCE_DIR}/src/fallback.ts)
    set(FALLBACK_DECODER_OUT ${CMAKE_CURRENT_SOURCE_DIR}/src/fallback.out.js)
    add_custom_command(
        OUTPUT ${FALLBACK_DECODER_OUT}
        DEPENDS ${BUN_INSTALL_OUT} ${FALLBACK_DECODER_SRC}
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        COMMAND ${BUN_EXECUTABLE} x esbuild
            ${FALLBACK_DECODER_SRC}
            --outfile=${FALLBACK_DECODER_OUT}
            --target=esnext
            --bundle
            --format=iife
            --platform=browser
            --minify
        VERBATIM
        COMMENT "Building fallback.out.js"
    )
endif()

# --- runtime.js ---
if(NOT NO_CODEGEN)
    set(RUNTIME_JS_SRC ${CMAKE_CURRENT_SOURCE_DIR}/src/runtime.bun.js)
    set(RUNTIME_JS_OUT ${CMAKE_CURRENT_SOURCE_DIR}/src/runtime.out.js)
    add_custom_command(
        OUTPUT ${RUNTIME_JS_OUT}
        DEPENDS ${BUN_INSTALL_OUT} ${RUNTIME_JS_SRC}
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        COMMAND ${BUN_EXECUTABLE} x esbuild
            ${RUNTIME_JS_SRC}
            --outfile=${RUNTIME_JS_OUT}
            --define:process.env.NODE_ENV=\"'production'\"
            --target=esnext
            --bundle
            --format=esm
            --platform=node
            --minify
            --external:/bun:*
        VERBATIM
        COMMENT "Building runtime.out.js"
    )
endif()

# --- node-fallbacks ---
if(NOT NO_CODEGEN)
    set(NODE_FALLBACKS_SRC ${CMAKE_CURRENT_SOURCE_DIR}/src/node-fallbacks)
    set(NODE_FALLBACKS_OUT ${NODE_FALLBACKS_SRC}/out)

    add_custom_command(
        OUTPUT ${NODE_FALLBACKS_SRC}/node_modules
        DEPENDS ${BUN_INSTALL_OUT} ${NODE_FALLBACKS_SRC}
        WORKING_DIRECTORY ${NODE_FALLBACKS_SRC}
        COMMAND ${BUN_EXECUTABLE} install --frozen-lockfile
        VERBATIM
        COMMENT "Installing node-fallbacks"
    )

    file(GLOB NODE_FALLBACKS_FILES ${NODE_FALLBACKS_SRC}/*.js)

    add_custom_command(
        OUTPUT ${NODE_FALLBACKS_OUT}
        DEPENDS ${BUN_INSTALL_OUT} ${NODE_FALLBACKS_SRC}/node_modules ${NODE_FALLBACKS_SRC}
        WORKING_DIRECTORY ${NODE_FALLBACKS_SRC}
        COMMAND ${BUN_EXECUTABLE} x esbuild
            ${NODE_FALLBACKS_FILES}
            --outdir=out
            --format=esm
            --minify
            --bundle
            --platform=browser
        VERBATIM
        COMMENT "Building node-fallbacks.out.js"
    )
endif()

# --- Identifier Cache ---
if(NOT NO_CODEGEN)
    set(BUN_IDENTIFIER_CACHE_OUT
        "${BUN_SRC}/js_lexer/id_continue_bitset.blob"
        "${BUN_SRC}/js_lexer/id_continue_bitset.meta.blob"
        "${BUN_SRC}/js_lexer/id_start_bitset.blob"
        "${BUN_SRC}/js_lexer/id_start_bitset.meta.blob")
    add_custom_command(
        OUTPUT ${BUN_IDENTIFIER_CACHE_OUT}
        MAIN_DEPENDENCY "${BUN_SRC}/js_lexer/identifier_data.zig"
        DEPENDS "${BUN_SRC}/js_lexer/identifier_cache.zig"
        COMMAND ${CMAKE_ZIG_COMPILER} run
            "--zig-lib-dir" ${ZIG_LIB_DIR}
            "--cache-dir" ${ZIG_LOCAL_CACHE_DIR}
            "--global-cache-dir" ${ZIG_GLOBAL_CACHE_DIR}
            "${BUN_SRC}/js_lexer/identifier_data.zig"
        VERBATIM
        COMMENT "Building Identifier Cache"
    )
endif()

# --- Bundled TS/JS ---
# Note: It's not worth doing this in parallel at the CMake/Ninja level, because this bundling
# requires all the JS files to be known, but also Bun will use all cores during bundling anyways.
if(NOT NO_CODEGEN)
    file(GLOB BUN_TS_MODULES ${CONFIGURE_DEPENDS}
        "${BUN_SRC}/js/node/*.ts"
        "${BUN_SRC}/js/node/*.js"
        "${BUN_SRC}/js/bun/*.ts"
        "${BUN_SRC}/js/bun/*.js"
        "${BUN_SRC}/js/builtins/*.ts"
        "${BUN_SRC}/js/builtins/*.js"
        "${BUN_SRC}/js/thirdparty/*.js"
        "${BUN_SRC}/js/thirdparty/*.ts"
        "${BUN_SRC}/js/internal/*.js"
        "${BUN_SRC}/js/internal/*.ts"
        "${BUN_SRC}/js/internal/cluster/*.ts"
        "${BUN_SRC}/js/internal/util/*.js"
        "${BUN_SRC}/js/internal/fs/*.ts"
        "${BUN_SRC}/js/node/*.js"
        "${BUN_SRC}/js/node/*.ts"
        "${BUN_SRC}/js/thirdparty/*.js"
        "${BUN_SRC}/js/thirdparty/*.ts"
        "${BUN_SRC}/js/internal-for-testing.ts"
    )

    file(GLOB CODEGEN_FILES ${CONFIGURE_DEPENDS} "${BUN_CODEGEN_SRC}/*.ts")

    add_custom_command(
        OUTPUT
        "${BUN_WORKDIR}/codegen/WebCoreJSBuiltins.cpp"
        "${BUN_WORKDIR}/codegen/WebCoreJSBuiltins.h"
        "${BUN_WORKDIR}/codegen/InternalModuleRegistryConstants.h"
        "${BUN_WORKDIR}/codegen/InternalModuleRegistry+createInternalModuleById.h"
        "${BUN_WORKDIR}/codegen/InternalModuleRegistry+enum.h"
        "${BUN_WORKDIR}/codegen/InternalModuleRegistry+numberOfModules.h"
        "${BUN_WORKDIR}/codegen/NativeModuleImpl.h"
        "${BUN_WORKDIR}/codegen/ResolvedSourceTag.zig"
        "${BUN_WORKDIR}/codegen/SyntheticModuleType.h"
        "${BUN_WORKDIR}/codegen/GeneratedJS2Native.h"
        "${BUN_SRC}/bun.js/bindings/GeneratedJS2Native.zig"
        COMMAND ${BUN_EXECUTABLE} run "${BUN_SRC}/codegen/bundle-modules.ts" "--debug=${DEBUG}" "${BUN_WORKDIR}"
        DEPENDS ${BUN_TS_MODULES} ${CODEGEN_FILES}
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        COMMENT "Bundling JS"
    )
endif()

WEBKIT_ADD_SOURCE_DEPENDENCIES(
    "${BUN_SRC}/bun.js/bindings/InternalModuleRegistry.cpp"
    "${BUN_WORKDIR}/codegen/InternalModuleRegistryConstants.h"
)
list(APPEND BUN_RAW_SOURCES "${BUN_WORKDIR}/codegen/WebCoreJSBuiltins.cpp")

# --- Peechy API ---
# if(NOT NO_CODEGEN)
# add_custom_command(
# OUTPUT "${BUN_SRC}/api/schema.js"
# "${BUN_SRC}/api/schema.d.ts"
# "${BUN_SRC}/api/schema.zig"
# WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
# COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.bin/peechy"
# "--schema" "${BUN_SRC}/api/schema.peechy"
# "--esm" "${BUN_SRC}/api/schema.js"
# "--ts" "${BUN_SRC}/api/schema.d.ts"
# "--zig" "${BUN_SRC}/api/schema.zig"
# COMMAND "${CMAKE_ZIG_COMPILER}" "fmt" "src/api/schema.zig"
# COMMAND "${PRETTIER}" "--config=.prettierrc.cjs" "--write" "src/api/schema.js" "src/api/schema.d.ts"
# DEPENDS "${BUN_SRC}/api/schema.peechy"
# COMMENT "Building schema"
# )
# add_custom_command(
# OUTPUT "${BUN_SRC}/analytics/analytics_schema.zig"
# WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
# COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.bin/peechy"
# "--schema" "${BUN_SRC}/analytics/schema.peechy"
# "--zig" "${BUN_SRC}/analytics/analytics_schema.zig"
# COMMAND "${CMAKE_ZIG_COMPILER}" "fmt" "${BUN_SRC}/analytics/analytics_schema.zig"
# DEPENDS "${BUN_SRC}/api/schema.peechy"
# COMMENT "Building analytics_schema.zig"
# )
# endif()

# --- Zig Object ---
file(GLOB ZIG_FILES
    "${BUN_SRC}/*.zig"
    "${BUN_SRC}/*/*.zig"
    "${BUN_SRC}/*/*/*.zig"
    "${BUN_SRC}/*/*/*/*.zig"
    "${BUN_SRC}/*/*/*/*/*.zig"
)

if(NOT BUN_ZIG_OBJ_FORMAT)
    # To use LLVM bitcode from Zig, more work needs to be done. Currently, an install of
    # LLVM 18.1.7 does not compatible with what bitcode Zig 0.13 outputs (has LLVM 18.1.7)
    # Change to "bc" to experiment, "Invalid record" means it is not valid output.
    set(BUN_ZIG_OBJ_FORMAT "obj")
endif()

if(NOT BUN_ZIG_OBJ_DIR)
    set(BUN_ZIG_OBJ_DIR "${BUN_WORKDIR}/CMakeFiles")
endif()

get_filename_component(BUN_ZIG_OBJ_DIR "${BUN_ZIG_OBJ_DIR}" REALPATH BASE_DIR "${CMAKE_BINARY_DIR}")

if(WIN32)
    set(BUN_ZIG_OBJ "${BUN_ZIG_OBJ_DIR}/bun-zig.o")
else()
    set(BUN_ZIG_OBJ "${BUN_ZIG_OBJ_DIR}/bun-zig.o")
endif()

set(USES_TERMINAL_NOT_IN_CI "")

if(NOT CI)
    set(USES_TERMINAL_NOT_IN_CI "USES_TERMINAL")
endif()

if(NOT BUN_LINK_ONLY AND NOT BUN_CPP_ONLY)
    if(ENABLE_LOGS)
        set(ZIG_ENABLE_LOGS "true")
    else()
        set(ZIG_ENABLE_LOGS "false")
    endif()
    add_custom_command(
        OUTPUT "${BUN_ZIG_OBJ}"
        COMMAND
        ${CMAKE_ZIG_COMPILER} "build" "obj"
        "--zig-lib-dir" ${ZIG_LIB_DIR}
        "--cache-dir" ${ZIG_LOCAL_CACHE_DIR}
        "--global-cache-dir" ${ZIG_GLOBAL_CACHE_DIR}
        "--prefix" "${BUN_ZIG_OBJ_DIR}"
        "--verbose"
        "-Dgenerated-code=${BUN_WORKDIR}/codegen"
        "-freference-trace=10"
        "-Dversion=${Bun_VERSION}"
        "-Dcanary=${USE_CANARY_REVISION}"
        "-Doptimize=${USE_ZIG_OPTIMIZE}"
        "-Dcpu=${USE_ZIG_CPU}"
        "-Dtarget=${USE_ZIG_TARGET}"
        "-Denable_logs=${ZIG_ENABLE_LOGS}"
        "-Dreported_nodejs_version=${USE_NODEJS_VERSION}"
        "-Dobj_format=${BUN_ZIG_OBJ_FORMAT}"
        DEPENDS
        "${CMAKE_CURRENT_SOURCE_DIR}/build.zig"
        "${ZIG_FILES}"
        "${BUN_WORKDIR}/codegen/ZigGeneratedClasses.zig"
        "${BUN_WORKDIR}/codegen/ErrorCode.zig"
        "${BUN_WORKDIR}/codegen/ResolvedSourceTag.zig"
        "${BUN_IDENTIFIER_CACHE_OUT}"
        "${BUN_SRC}/api/schema.zig"
        "${BUN_SRC}/bun.js/bindings/GeneratedJS2Native.zig"
        ${BUN_ERROR_OUT}
        ${FALLBACK_DECODER_OUT}
        ${RUNTIME_JS_OUT}
        ${NODE_FALLBACKS_OUT}
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        COMMENT "Building zig code"
        VERBATIM

        # This is here to show Zig's progress indicator
        ${USES_TERMINAL_NOT_IN_CI}
    )
endif()

if(WIN32)
    list(APPEND BUN_RAW_SOURCES "${BUN_SRC}/bun.js/bindings/windows/musl-memmem.c")
    include_directories("${BUN_SRC}/bun.js/bindings/windows")
endif()

if(NOT BUN_CPP_ARCHIVE)
    # TODO: unified sources
    set(BUN_SOURCES ${BUN_RAW_SOURCES})
else()
    # used by ci
    set(BUN_SOURCES "")
    add_link_options("${BUN_CPP_ARCHIVE}")
endif()

# -- Windows resources (app icon) --
if(ENABLE_CANARY)
    set(Bun_VERSION_WITH_TAG "${Bun_VERSION}-canary.${USE_CANARY_REVISION}")
else()
    set(Bun_VERSION_WITH_TAG "${Bun_VERSION}")
endif()

if(WIN32)
    set(BUN_ICO_PATH "${BUN_SRC}/bun.ico")
    configure_file("${BUN_SRC}/windows-app-info.rc" "${BUN_WORKDIR}/CMakeFiles/windows-app-info.rc")
    list(APPEND BUN_SOURCES "${BUN_WORKDIR}/CMakeFiles/windows-app-info.rc")
endif()

# -- The Buntime™️ ---
if(BUN_TIDY_ONLY OR BUN_TIDY_ONLY_EXTRA)
    add_library(${bun} OBJECT "${BUN_SOURCES}")
elseif(NOT BUN_CPP_ONLY)
    add_executable(${bun} "${BUN_SOURCES}" "${BUN_ZIG_OBJ}")
else()
    add_executable(${bun} "${BUN_SOURCES}")
endif()

set_target_properties(${bun} PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS YES
    CXX_VISIBILITY_PRESET hidden
    C_STANDARD 17
    C_STANDARD_REQUIRED YES
    VISIBILITY_INLINES_HIDDEN YES
)

if(APPLE)
    add_compile_definitions("__DARWIN_NON_CANCELABLE=1")
endif()

add_compile_definitions(

    # TODO: are all of these variables strictly necessary?
    "_HAS_EXCEPTIONS=0"
    "LIBUS_USE_OPENSSL=1"
    "LIBUS_USE_BORINGSSL=1"
    "WITH_BORINGSSL=1"
    "STATICALLY_LINKED_WITH_JavaScriptCore=1"
    "STATICALLY_LINKED_WITH_BMALLOC=1"
    "BUILDING_WITH_CMAKE=1"
    "JSC_OBJC_API_ENABLED=0"
    "BUN_SINGLE_THREADED_PER_VM_ENTRY_SCOPE=1"
    "NAPI_EXPERIMENTAL=ON"
    "NOMINMAX"
    "IS_BUILD"
    "BUILDING_JSCONLY__"
    "BUN_DYNAMIC_JS_LOAD_PATH=\"${BUN_WORKDIR}/js\""
    "REPORTED_NODEJS_VERSION=\"${USE_NODEJS_VERSION}\""
    "REPORTED_NODEJS_ABI_VERSION=${USE_NODEJS_ABI_VERSION}"
)

if(ENABLE_ASSERTIONS)
    if(APPLE)
        add_compile_definitions("_LIBCXX_ENABLE_ASSERTIONS=1")
        add_compile_definitions("_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_DEBUG")
    elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
        add_compile_definitions("_GLIBCXX_ASSERTIONS=1")
    endif()

    add_compile_definitions("ASSERT_ENABLED=1")
else()
    if(APPLE)
        add_compile_definitions("_LIBCXX_ENABLE_ASSERTIONS=0")
        add_compile_definitions("_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_NONE")
    endif()

    add_compile_definitions("NDEBUG=1")
endif()

if(ICU_INCLUDE_DIR)
    include_directories(${ICU_INCLUDE_DIR})
endif()

include_directories(
    ${CMAKE_CURRENT_SOURCE_DIR}/packages/
    ${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets
    ${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src
    ${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings
    ${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/webcore
    ${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/webcrypto
    ${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/sqlite
    ${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/modules
    ${CMAKE_CURRENT_SOURCE_DIR}/src/js/builtins
    ${CMAKE_CURRENT_SOURCE_DIR}/src/napi
    ${CMAKE_CURRENT_SOURCE_DIR}/src/deps
    ${CMAKE_CURRENT_SOURCE_DIR}/src/deps/picohttpparser
    ${WEBKIT_INCLUDE_DIR}
    "${BUN_WORKDIR}/codegen"
)

# -- BUN_CPP_ONLY Target
if(NOT BUN_CPP_ARCHIVE)
    if(BUN_CPP_ONLY)
        if(NOT WIN32)
            string(REPLACE ";" ".o\n  " BUN_OBJECT_LIST "${BUN_SOURCES}.o")
            string(REPLACE "${BUN_WORKDIR}/" "CMakeFiles/${bun}.dir/" BUN_OBJECT_LIST "${BUN_OBJECT_LIST}")
            string(REPLACE "${CMAKE_CURRENT_SOURCE_DIR}/" "CMakeFiles/${bun}.dir/" BUN_OBJECT_LIST "${BUN_OBJECT_LIST}")
            write_file("${BUN_WORKDIR}/compile-cpp-only.sh"
                "#!/usr/bin/env bash\n"
                "# this file is generated in CMakeLists.txt\n"
                "set -ex\n"
                "OBJ_LIST=(\n  ${BUN_OBJECT_LIST}\n)\n"
                "ninja \${OBJ_LIST[@]} $@\n"
                "\"${CMAKE_AR}\" rcvs bun-cpp-objects.a \${OBJ_LIST[@]}\n"
                "echo '-> bun-cpp-objects.a'\n"
            )
        else()
            string(REPLACE ";" ".obj\",\n  \"" BUN_OBJECT_LIST "\"${BUN_SOURCES}.obj\"")
            string(REPLACE "rc.obj" "rc.res" BUN_OBJECT_LIST "${BUN_OBJECT_LIST}")
            string(REPLACE "${BUN_WORKDIR}/" "CMakeFiles/${bun}.dir/" BUN_OBJECT_LIST "${BUN_OBJECT_LIST}")
            string(REPLACE "${CMAKE_CURRENT_SOURCE_DIR}/" "CMakeFiles/${bun}.dir/" BUN_OBJECT_LIST "${BUN_OBJECT_LIST}")
            write_file("${BUN_WORKDIR}/compile-cpp-only.ps1"
                "# this file is generated in CMakeLists.txt\n"
                "$ErrorActionPreference = \"Stop\"\n"
                "$ObjectFiles=@(\n  ${BUN_OBJECT_LIST}\n)\n"
                "ninja @ObjectFiles @args\n"
                "& llvm-ar rcvs bun-cpp-objects.a @ObjectFiles\n"
                "Write-Host '-> bun-cpp-objects.a'\n"
            )
        endif()
    endif()
else()
    set_target_properties(${bun} PROPERTIES LINKER_LANGUAGE CXX)
endif()

# --- clang and linker flags ---
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    if(NOT WIN32)
        target_compile_options(${bun} PUBLIC -O0 -g -g3 -ggdb -gdwarf-4
            -Werror=return-type
            -Werror=return-stack-address
            -Werror=implicit-function-declaration
            -Werror=uninitialized
            -Werror=conditional-uninitialized
            -Werror=suspicious-memaccess
            -Werror=int-conversion
            -Werror=nonnull
            -Werror=move
            -Werror=sometimes-uninitialized
            -Werror=unused
            -Wno-unused-function
            -Wno-nullability-completeness
            -Werror
            -fsanitize=null
            -fsanitize-recover=all
            -fsanitize=bounds
            -fsanitize=return
            -fsanitize=nullability-arg
            -fsanitize=nullability-assign
            -fsanitize=nullability-return
            -fsanitize=returns-nonnull-attribute
            -fsanitize=unreachable
        )
        target_link_libraries(${bun} PRIVATE -fsanitize=null)
    else()
        target_compile_options(${bun} PUBLIC /Od /Z7)
    endif()

    add_compile_definitions("BUN_DEBUG=1")
elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(LTO_FLAG "")

    if(NOT WIN32)
        if(USE_LTO)
            list(APPEND LTO_FLAG "-flto=full" "-emit-llvm" "-fwhole-program-vtables" "-fforce-emit-vtables")
        endif()

        # Leave -Werror=unused off in release builds so we avoid errors from being used in ASSERT
        target_compile_options(${bun} PUBLIC -O3 ${LTO_FLAG} -g1
            -Werror=return-type
            -Werror=return-stack-address
            -Werror=implicit-function-declaration
            -Werror=uninitialized
            -Werror=conditional-uninitialized
            -Werror=suspicious-memaccess
            -Werror=int-conversion
            -Werror=nonnull
            -Werror=move
            -Werror=sometimes-uninitialized
            -Wno-nullability-completeness
            -Werror
        )
    else()
        set(LTO_LINK_FLAG "")

        if(USE_LTO)
            target_compile_options(${bun} PUBLIC -Xclang -emit-llvm-bc)

            list(APPEND LTO_FLAG "-flto=full")
            list(APPEND LTO_LINK_FLAG "-flto=full")
            list(APPEND LTO_LINK_FLAG "/LTCG")
            list(APPEND LTO_LINK_FLAG "/OPT:REF")
            list(APPEND LTO_LINK_FLAG "/OPT:NOICF")
        endif()

        target_compile_options(${bun} PUBLIC
            /O2
            ${LTO_FLAG}
            /Gy
            /Gw
            /GF
            /GA
        )
        target_link_options(${bun} PUBLIC
            ${LTO_LINK_FLAG}
            /DEBUG:FULL

            /delayload:ole32.dll
            /delayload:WINMM.dll
            /delayload:dbghelp.dll
            /delayload:VCRUNTIME140_1.dll

            # libuv loads these two immediately, but for some reason it seems to still be slightly faster to delayload them
            /delayload:WS2_32.dll
            /delayload:WSOCK32.dll
            /delayload:ADVAPI32.dll
            /delayload:IPHLPAPI.dll
        )
    endif()
endif()

if(NOT CI AND NOT WIN32)
    target_compile_options(${bun} PRIVATE -fdiagnostics-color=always)
endif()

if(NOT USE_CPU STREQUAL "native")
    # passing -march=native to clang will break older systems
    # by default on x64, USE_CPU is set to "haswell" or "nehalem" depending on baseline
    # on arm, this argument will not be passed.
    target_compile_options(${bun} PUBLIC "-march=${USE_CPU}")
else()
    if(APPLE AND ARCH STREQUAL "aarch64")
        # On arm macOS, we can set it to a minimum of the M1 cpu set. this might be the default already.
        target_compile_options(${bun} PUBLIC "-mcpu=apple-m1")
    endif()

    if(NOT WIN32 AND NOT APPLE AND ARCH STREQUAL "aarch64")
        # on arm64 linux, we set a minimum of armv8
        target_compile_options(${bun} PUBLIC -march=armv8-a+crc -mtune=ampere1)
    endif()
endif()

target_compile_options(${bun} PUBLIC -ferror-limit=${ERROR_LIMIT})

if(WIN32)
    add_compile_definitions(
        "WIN32"
        "_WINDOWS"
        "WIN32_LEAN_AND_MEAN=1"
        "_CRT_SECURE_NO_WARNINGS"
        "BORINGSSL_NO_CXX=1" # lol
    )

    # set_property(TARGET ${bun} PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
    set_property(TARGET ${bun} PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")

    target_compile_options(${bun} PUBLIC "/EHsc" "/GR-" -Xclang -fno-c++-static-destructors)

    target_link_options(${bun} PUBLIC "/STACK:0x1200000,0x100000" "/DEF:${BUN_SRC}/symbols.def" "/errorlimit:0")
else()
    target_compile_options(${bun} PUBLIC
        -mtune=${USE_CPU}
        -fconstexpr-steps=2542484
        -fconstexpr-depth=54
        -fno-exceptions
        -fno-asynchronous-unwind-tables
        -fno-unwind-tables
        -fno-c++-static-destructors
        -fvisibility=hidden
        -fvisibility-inlines-hidden
        -fno-rtti
        -fno-omit-frame-pointer
        -mno-omit-leaf-frame-pointer
        -fno-pic
        -fno-pie
        -faddrsig
        -ffile-prefix-map="${CMAKE_CURRENT_SOURCE_DIR}"=.
        -ffile-prefix-map="${BUN_DEPS_DIR}"=src/deps
        -ffile-prefix-map="${BUN_DEPS_OUT_DIR}"=src/deps
    )
endif()

if(APPLE)
    target_link_options(${bun} PUBLIC "-dead_strip")
    target_link_options(${bun} PUBLIC "-dead_strip_dylibs")
    target_link_options(${bun} PUBLIC "-Wl,-stack_size,0x1200000")
    target_link_options(${bun} PUBLIC "-exported_symbols_list" "${BUN_SRC}/symbols.txt")
    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${BUN_SRC}/symbols.txt")
    target_link_options(${bun} PUBLIC "-fno-keep-static-consts")
    target_link_libraries(${bun} PRIVATE "resolv")
endif()

if(UNIX AND NOT APPLE)
    target_link_options(${bun} PUBLIC
        -fuse-ld=lld-${LLVM_VERSION_MAJOR}
        -fno-pic
        -static-libstdc++
        -static-libgcc
        "-Wl,-no-pie"
        "-Wl,-icf=safe"
        "-Wl,--as-needed"
        "-Wl,--gc-sections"
        "-Wl,-z,stack-size=12800000"
        "-Wl,--wrap=fcntl"
        "-Wl,--wrap=fcntl64"
        "-Wl,--wrap=stat64"
        "-Wl,--wrap=pow"
        "-Wl,--wrap=exp"
        "-Wl,--wrap=expf"
        "-Wl,--wrap=log"
        "-Wl,--wrap=log2"
        "-Wl,--wrap=lstat"
        "-Wl,--wrap=stat64"
        "-Wl,--wrap=stat"
        "-Wl,--wrap=fstat"
        "-Wl,--wrap=fstatat"
        "-Wl,--wrap=lstat64"
        "-Wl,--wrap=fstat64"
        "-Wl,--wrap=fstatat64"
        "-Wl,--wrap=mknod"
        "-Wl,--wrap=mknodat"
        "-Wl,--wrap=statx"
        "-Wl,--wrap=fmod"
        "-Wl,--compress-debug-sections=zlib"
        "-Bsymbolics-functions"
        "-rdynamic"
        "-Wl,--dynamic-list=${BUN_SRC}/symbols.dyn"
        "-Wl,--version-script=${BUN_SRC}/linker.lds"
        -Wl,-z,lazy
        -Wl,-z,norelro
    )

    target_link_libraries(${bun} PRIVATE "c")
    target_link_libraries(${bun} PRIVATE "pthread")
    target_link_libraries(${bun} PRIVATE "dl")

    if(NOT USE_STATIC_LIBATOMIC)
        target_link_libraries(${bun} PUBLIC "libatomic.so")
    else()
        target_link_libraries(${bun} PRIVATE "libatomic.a")
    endif()

    if(USE_SYSTEM_ICU)
        target_link_libraries(${bun} PRIVATE "libicudata.a")
        target_link_libraries(${bun} PRIVATE "libicui18n.a")
        target_link_libraries(${bun} PRIVATE "libicuuc.a")
    else()
        target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libicudata.a")
        target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libicui18n.a")
        target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libicuuc.a")
    endif()

    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${BUN_SRC}/linker.lds")
    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${BUN_SRC}/symbols.dyn")
endif()

# --- ICU ---
if(APPLE)
    target_link_libraries(${bun} PRIVATE "icucore")
endif()

# --- Stripped Binary "bun"
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND NOT WIN32 AND NOT ASSERT_ENABLED)
    # if(CI AND APPLE)
    if(APPLE)
        add_custom_command(
            TARGET ${bun}
            POST_BUILD
            COMMAND ${CMAKE_DSYMUTIL} -o ${BUN_WORKDIR}/${bun}.dSYM ${BUN_WORKDIR}/${bun}
            COMMENT "Generating .dSYM"
        )
    endif()

    add_custom_command(
        TARGET ${bun}
        POST_BUILD
        COMMAND ${CMAKE_STRIP} -s -x -S -o ${BUN_WORKDIR}/bun ${BUN_WORKDIR}/${bun}
        COMMENT "Stripping Symbols"
    )
endif()

# --- Dependencies ---
if(USE_CUSTOM_ZLIB)
    include_directories(${BUN_DEPS_DIR}/zlib)

    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/zlib.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libz.a")
    endif()
else()
    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/zlib_maybethisworks.lib")
    else()
        find_package(ZLIB REQUIRED)
        target_link_libraries(${bun} PRIVATE ZLIB::ZLIB)
    endif()
endif()

if(USE_CUSTOM_BORINGSSL)
    include_directories(${BUN_DEPS_DIR}/boringssl/include)

    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/crypto.lib")
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/ssl.lib")
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/decrepit.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libcrypto.a")
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libssl.a")
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libdecrepit.a")
    endif()
else()
    include(FindBoringSSL)
    FindBoringSSL(${bun})
endif()

if(USE_CUSTOM_LIBARCHIVE)
    include_directories(${BUN_DEPS_DIR}/libarchive/include)

    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/archive.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libarchive.a")
    endif()
else()
    find_package(LibArchive REQUIRED)
    target_link_libraries(${bun} PRIVATE LibArchive::LibArchive)
endif()

if(USE_CUSTOM_LIBDEFLATE)
    include_directories(${BUN_DEPS_DIR}/libdeflate)

    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/deflate.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libdeflate.a")
    endif()
else()
    find_package(LibDeflate REQUIRED)
    target_link_libraries(${bun} PRIVATE LibDeflate::LibDeflate)
endif()

if(USE_CUSTOM_MIMALLOC)
    include_directories(${BUN_DEPS_DIR}/mimalloc/include)

    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/mimalloc.lib")
    elseif(APPLE)
        if(ENABLE_ASSERTIONS OR CMAKE_BUILD_TYPE STREQUAL "Debug")
            message(STATUS "Using debug mimalloc")
            target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libmimalloc-debug.o")
        else()
            # Note: https://github.com/microsoft/mimalloc/issues/512
            # It may have been a bug in our code at the time.
            target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libmimalloc.o")
        endif()
    else()
        if(ENABLE_ASSERTIONS OR CMAKE_BUILD_TYPE STREQUAL "Debug")
            message(STATUS "Using debug mimalloc")
            target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libmimalloc-debug.a")
        else()
            target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libmimalloc.o")
        endif()
    endif()
else()
    find_package(mimalloc REQUIRED)
    target_link_libraries(${bun} PRIVATE mimalloc)
endif()

if(USE_CUSTOM_ZSTD)
    include_directories(${BUN_DEPS_DIR}/zstd/include)

    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/zstd.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libzstd.a")
    endif()
else()
    find_package(zstd CONFIG REQUIRED)
    target_link_libraries(${bun} PRIVATE zstd::libzstd)
endif()

if(USE_CUSTOM_CARES)
    include_directories(${BUN_DEPS_DIR}/c-ares/include)

    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/cares.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libcares.a")
    endif()
else()
    find_package(c-ares CONFIG REQUIRED)
    target_link_libraries(${bun} PRIVATE c-ares::cares)
endif()

if(USE_CUSTOM_TINYCC)
    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/tcc.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libtcc.a")
    endif()
else()
    find_package(tinycc REQUIRED)
    target_link_libraries(${bun} PRIVATE tinycc::tinycc)
endif()

if(USE_CUSTOM_LOLHTML)
    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/lolhtml.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/liblolhtml.a")
    endif()
else()
    find_package(lolhtml REQUIRED)
    target_link_libraries(${bun} PRIVATE lolhtml::lolhtml)
endif()

if(WIN32)
    if(USE_CUSTOM_LIBUV)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libuv.lib")
        include_directories(${bun} PRIVATE "${BUN_DEPS_DIR}/libuv/include")
    else()
        find_package(libuv CONFIG REQUIRED)
        target_link_libraries(${bun} PRIVATE $<IF:$<TARGET_EXISTS:libuv::uv_a>,libuv::uv_a,libuv::uv>)
    endif()
endif()

if(USE_STATIC_SQLITE)
    add_library(sqlite3 STATIC src/bun.js/bindings/sqlite/sqlite3.c)
    target_include_directories(sqlite3 PUBLIC src/bun.js/bindings/sqlite)
    target_compile_definitions(sqlite3 PRIVATE
        "SQLITE_ENABLE_COLUMN_METADATA="
        "SQLITE_MAX_VARIABLE_NUMBER=250000"
        "SQLITE_ENABLE_RTREE=1"
        "SQLITE_ENABLE_FTS3=1"
        "SQLITE_ENABLE_FTS3_PARENTHESIS=1"
        "SQLITE_ENABLE_FTS5=1"
        "SQLITE_ENABLE_JSON1=1"
        "SQLITE_ENABLE_MATH_FUNCTIONS=1"
    )

    if(WIN32)
        target_compile_options(sqlite3 PRIVATE /MT /U_DLL)
    endif()

    target_link_libraries(${bun} PRIVATE sqlite3)
    message(STATUS "Using static sqlite3")
    target_compile_definitions(${bun} PRIVATE "LAZY_LOAD_SQLITE=0")
else()
    message(STATUS "Using dynamicly linked sqlite3")
    target_compile_definitions(${bun} PRIVATE "LAZY_LOAD_SQLITE=1")
endif()

# -- Brotli --
set(BROTLI_SRC "${CMAKE_CURRENT_SOURCE_DIR}/src/deps/brotli")
file(GLOB BROTLI_FILES ${CONFIGURE_DEPENDS}
    "${BROTLI_SRC}/common/*.c"
    "${BROTLI_SRC}/enc/*.c"
    "${BROTLI_SRC}/dec/*.c"
)
add_library(brotli STATIC ${BROTLI_FILES})
target_include_directories(brotli PRIVATE "${BROTLI_SRC}/include")
target_compile_definitions(brotli PRIVATE "BROTLI_STATIC")

if(WIN32)
    target_compile_options(brotli PRIVATE /MT /U_DLL)
endif()

target_link_libraries(${bun} PRIVATE brotli)
include_directories("${BUN_DEPS_DIR}/brotli/include")

if(USE_CUSTOM_LSHPACK)
    include_directories(${BUN_DEPS_DIR}/ls-hpack)

    if(WIN32)
        include_directories(${BUN_DEPS_DIR}/ls-hpack/compat/queue)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/lshpack.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/liblshpack.a")
    endif()
else()
    find_package(lshpack REQUIRED)
    target_link_libraries(${bun} PRIVATE lshpack)
endif()

if(NOT WIN32)
    target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libWTF.a")
    target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libJavaScriptCore.a")

    if(NOT APPLE OR EXISTS "${WEBKIT_LIB_DIR}/libbmalloc.a")
        target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libbmalloc.a")
    endif()
else()
    target_link_libraries(${bun} PRIVATE
        "${WEBKIT_LIB_DIR}/WTF.lib"
        "${WEBKIT_LIB_DIR}/JavaScriptCore.lib"
        "${WEBKIT_LIB_DIR}/sicudt.lib"
        "${WEBKIT_LIB_DIR}/sicuin.lib"
        "${WEBKIT_LIB_DIR}/sicuuc.lib"
        winmm
        bcrypt
        ntdll
        userenv
        dbghelp
        wsock32 # ws2_32 required by TransmitFile aka sendfile on windows
        delayimp.lib
    )
endif()

if(BUN_LINK_ONLY)
    message(STATUS "NOTE: BUN_LINK_ONLY is ON, this build config will only link the Bun executable")
endif()

if(BUN_CPP_ONLY)
    message(STATUS "NOTE: BUN_CPP_ONLY is ON, this build will only work with 'compile-cpp-only.${SCRIPT_EXTENSION}'")
endif()

if(NO_CODEGEN)
    message(STATUS "NOTE: NO_CODEGEN is ON, this build expects ./codegen to exist")
endif()

if(BUN_TIDY_ONLY)
    find_program(CLANG_TIDY_EXE NAMES "clang-tidy")

    # webkit ones are disabled disabled because it's noisy, e.g. for JavaScriptCore/Lookup.h
    set(CLANG_TIDY_COMMAND "${CLANG_TIDY_EXE}" "-checks=-*,clang-analyzer-*,-clang-analyzer-webkit.UncountedLambdaCapturesChecker,-clang-analyzer-optin.core.EnumCastOutOfRange,-clang-analyzer-webkit.RefCntblBaseVirtualDtor" "--fix" "--fix-errors" "--format-style=webkit" "--warnings-as-errors=*")
    set_target_properties(${bun} PROPERTIES CXX_CLANG_TIDY "${CLANG_TIDY_COMMAND}")
endif()

if(BUN_TIDY_ONLY_EXTRA)
    find_program(CLANG_TIDY_EXE NAMES "clang-tidy")
    set(CLANG_TIDY_COMMAND "${CLANG_TIDY_EXE}" "-checks=-*,clang-analyzer-*,performance-*,-clang-analyzer-webkit.UncountedLambdaCapturesChecker,-clang-analyzer-optin.core.EnumCastOutOfRange,-clang-analyzer-webkit.RefCntblBaseVirtualDtor" "--fix" "--fix-errors" "--format-style=webkit" "--warnings-as-errors=*")
    set_target_properties(${bun} PROPERTIES CXX_CLANG_TIDY "${CLANG_TIDY_COMMAND}")
endif()