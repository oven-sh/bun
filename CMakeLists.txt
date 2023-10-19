cmake_minimum_required(VERSION 3.22)
cmake_policy(SET CMP0091 NEW)
set(CMAKE_COLOR_DIAGNOSTICS ON)

set(BUN_WORKDIR "${CMAKE_CURRENT_BINARY_DIR}")
message(STATUS "Building in ${BUN_WORKDIR}")

# --- Build Type ---
# This is done at the start simply so this is the first message printed
if(NOT CMAKE_BUILD_TYPE)
    message(WARNING "No CMAKE_BUILD_TYPE value specified, defaulting to Debug.\nSet a build type with -DCMAKE_BUILD_TYPE=<Debug|Release>")
    set(CMAKE_BUILD_TYPE "Debug" CACHE STRING "Choose the type of build (Debug, Release)" FORCE)
else()
    if(NOT CMAKE_BUILD_TYPE MATCHES "^(Debug|Release)$")
        message(FATAL_ERROR
            "Invalid CMAKE_BUILD_TYPE value specified: ${CMAKE_BUILD_TYPE}\n"
            "CMAKE_BUILD_TYPE must be Debug or Release.")
    endif()
    message(STATUS "The CMake build type is: ${CMAKE_BUILD_TYPE}")
endif()
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(DEBUG ON)
    set(ZIG_OPTIMIZE "Debug")
    set(bun "bun-debug")
elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(DEBUG OFF)
    set(ZIG_OPTIMIZE "ReleaseFast")
    set(bun "bun-profile")
endif()

# --- LLVM ---
# This has to be done before `project` in order to override the default compiler
if(UNIX)
    set(LLVM_VERSION 17)

    find_path(
        LLVM_PREFIX
        NAMES bin/clang++-${LLVM_VERSION} bin/clang-${LLVM_VERSION} bin/clang++ bin/clang
        PATHS ENV PATH /usr /usr/local /opt/homebrew/opt/llvm@${LLVM_VERSION} /opt/homebrew
        DOC "Path to LLVM binary directory"
    )
    if(LLVM_PREFIX MATCHES "/$")
        string(REGEX REPLACE "/$" "" LLVM_PREFIX "${LLVM_PREFIX}")
    endif()

    if (NOT EXISTS "${LLVM_PREFIX}/bin/clang")
        message(FATAL_ERROR "Could not find LLVM ${LLVM_VERSION} installed on your system.")
    endif()

    set(CMAKE_CXX_COMPILER "${LLVM_PREFIX}/bin/clang++" CACHE STRING "CMAKE_CXX_COMPILER" FORCE)
    set(CMAKE_C_COMPILER "${LLVM_PREFIX}/bin/clang" CACHE STRING "CMAKE_C_COMPILER" FORCE)
    set(CMAKE_CXX_COMPILER_ID "Clang" CACHE STRING "CMAKE_CXX_COMPILER_ID" FORCE)
    set(STRIP "${LLVM_PREFIX}/bin/llvm-strip")
    set(DSYMUTIL "${LLVM_PREFIX}/bin/dsymutil")

    message(STATUS "Found LLVM ${LLVM_VERSION}: ${LLVM_PREFIX}")
else()
    set(STRIP "strip")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_C_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD_REQUIRED ON)
project(Bun VERSION "1.0.7")

set(DEFAULT_ON_UNLESS_WINDOWS ON)
set(REQUIRED_IF_NOT_WINDOWS "REQUIRED")
if(WIN32)
    set(DEFAULT_ON_UNLESS_WINDOWS OFF)
    set(REQUIRED_IF_NOT_WINDOWS OFF)
endif()
set(DEFAULT_ON_UNLESS_APPLE ON)
if(APPLE)
    set(DEFAULT_ON_UNLESS_APPLE OFF)
endif()

set(CI OFF)
if(DEFINED ENV{CI} OR DEFINED ENV{GITHUB_ACTIONS})
    set(CI ON)
endif()

# -- Build Flags --
option(USE_STATIC_SQLITE "Statically link SQLite?" ${DEFAULT_ON_UNLESS_APPLE})
option(USE_CUSTOM_ZLIB "Use Bun's recommended version of zlib" ${DEFAULT_ON_UNLESS_WINDOWS})
option(USE_CUSTOM_BORINGSSL "Use Bun's recommended version of BoringSSL" ON)
option(USE_CUSTOM_LIBARCHIVE "Use Bun's recommended version of libarchive" ON)
option(USE_CUSTOM_MIMALLOC "Use Bun's recommended version of Mimalloc" ON)
option(USE_CUSTOM_ZSTD "Use Bun's recommended version of zstd" ON)
option(USE_CUSTOM_CARES "Use Bun's recommended version of c-ares" ${DEFAULT_ON_UNLESS_WINDOWS})
option(USE_CUSTOM_BASE64 "Use Bun's recommended version of libbase64" ON)
option(USE_CUSTOM_LOLHTML "Use Bun's recommended version of lolhtml" ON)
option(USE_CUSTOM_TINYCC "Use Bun's recommended version of tinycc" ON)
option(USE_CUSTOM_LIBUV "Use Bun's recommended version of libuv (Windows only)" OFF)
option(USE_BASELINE_BUILD "Build Bun for baseline (older) CPUs" OFF)

set(ERROR_LIMIT 100 CACHE STRING "Maximum number of errors to show when compiling C++ code")

set(ARCH x86_64)
if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64|arm")
    set(ARCH arm64)
endif()

if(NOT CPU_TARGET)
    set(CPU_TARGET "native" CACHE STRING "CPU target for the compiler" FORCE)
    if (ARCH STREQUAL "x86_64")
        if (NOT MSVC)
            if (USE_BASELINE_BUILD)
                set(CPU_TARGET "nehalem")
            else()
                set(CPU_TARGET "haswell")
            endif()
        endif()
    endif()
endif()
message(STATUS "Building for CPU Target: ${CPU_TARGET}")

if(USE_CONFIGURE_DEPENDS)
    set(CONFIGURE_DEPENDS "CONFIGURE_DEPENDS")
else()
    set(CONFIGURE_DEPENDS "")
endif()

# --- CLI Paths ---

# Zig Compiler
function(validate_zig validator_result_var item)
    set(${validator_result_var} FALSE PARENT_SCOPE)
    # We will allow any valid zig compiler, as long as it contains some text from `zig zen`
    # Ideally we would do a version or feature check, but that would be quite slow
    execute_process(COMMAND ${item} zen OUTPUT_VARIABLE ZIG_ZEN_OUTPUT)
    if(ZIG_ZEN_OUTPUT MATCHES "Together we serve the users")
        set(${validator_result_var} TRUE PARENT_SCOPE)
    else()
        set(${validator_result_var} FALSE PARENT_SCOPE)
    endif()
endfunction()
find_program(ZIG_COMPILER zig REQUIRED DOC "Path to the Zig compiler" VALIDATOR validate_zig)
message(STATUS "Found Zig Compiler: ${ZIG_COMPILER}")

# Bun
if(NOT WIN32)
    find_program(BUN_EXECUTABLE bun REQUIRED DOC "Path to an already built release of Bun")
    message(STATUS "Found Bun: ${BUN_EXECUTABLE}")
else()
    set(BUN_EXECUTABLE "echo")
endif()

# Prettier
find_program(PRETTIER prettier DOC "Path to prettier" PATHS ./node_modules/.bin ENV PATH)

# Esbuild (TODO: switch these to "bun build")
find_program(ESBUILD esbuild DOC "Path to esbuild" PATHS ./node_modules/.bin ENV PATH)

# CCache
find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM)
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    message(STATUS "Using ccache: ${CCACHE_PROGRAM}")
endif()

# --- Dependencies ---

if(NOT WIN32)
    message(STATUS "not window")
    # WebKit
    if(NOT WEBKIT_DIR)
        # TODO: allow this to point to the actual webkit cmake file to allow easier rebuilds
        find_path(
            WEBKIT_DIR
            NAMES lib/libJavaScriptCore.a
            PATHS
            ${CMAKE_CURRENT_SOURCE_DIR}/bun-webkit
            DOC "Path to WebKit build directory"
        )
        # ensure libWTF.a, libJavaScriptCore.a, and libbmalloc.a exist
        if(NOT WEBKIT_DIR)
            message(FATAL_ERROR "Could not find WebKit build directory. Please set WEBKIT_DIR to the directory containing lib/libJavaScriptCore.a. Did you forget to run `bun install` beforehand.")
        endif()
        if (NOT EXISTS "${WEBKIT_DIR}/lib/libWTF.a" OR NOT EXISTS "${WEBKIT_DIR}/lib/libJavaScriptCore.a" OR NOT EXISTS "${WEBKIT_DIR}/lib/libbmalloc.a")
            message(FATAL_ERROR "WebKit directory ${WEBKIT_DIR} does not contain all the required files for Bun.")
        endif()
    endif()
    message(STATUS "Found WebKit: ${WEBKIT_DIR}")

    # C++ Assertions
    # It is very important that the value of ASSERT_ENABLED is the same for both Bun and WebKit,
    # If this is not the case, everything will crash as the sizes and offsets of things will be different
    if(NOT DEFINED ASSERT_ENABLED)
        if(WEBKIT_DIR MATCHES "/bun-webkit$|WebKitBuild/Release$")
            set(ASSERT_ENABLED "0")
        elseif(WEBKIT_DIR MATCHES "/WebKitBuild/Debug$")
            set(ASSERT_ENABLED "1")
        else()
            message(WARNING "Could not guess default value for ASSERT_ENABLED.")
            set(ASSERT_ENABLED "0")
        endif()
    endif()
    if(ASSERT_ENABLED)
        message(STATUS "C++ Assertions: ON")
    else()
        message(STATUS "C++ Assertions: OFF")
    endif()
else()
    # TODO: Real checking
    set(WEBKIT_DIR "C:\\Users\\windo\\Code\\WebKit\\bun-webkit-x64")
    set(ASSERT_ENABLED "0")
    message(STATUS "Hardcoded WebKit: ${WEBKIT_DIR}")
endif()

set(WEBKIT_INCLUDE_DIR "${WEBKIT_DIR}/include")

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

file(GLOB BUN_CPP ${CONFIGURE_DEPENDS}
    "${BUN_SRC}/deps/*.cpp"
    "${BUN_SRC}/io/*.cpp"
    "${BUN_SRC}/bun.js/modules/*.cpp"
    "${BUN_SRC}/bun.js/bindings/*.cpp"
    "${BUN_SRC}/bun.js/bindings/webcore/*.cpp"
    "${BUN_SRC}/bun.js/bindings/sqlite/*.cpp"
    "${BUN_SRC}/bun.js/bindings/webcrypto/*.cpp"
    "${BUN_SRC}/bun.js/bindings/webcrypto/*/*.cpp"
    "${BUN_SRC}/deps/picohttpparser/picohttpparser.c"
)

set(USOCKETS_SRC "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src")
file(GLOB USOCKETS_FILES ${CONFIGURE_DEPENDS}
    "${USOCKETS_SRC}/*.c"
    "${USOCKETS_SRC}/eventing/*.c"
    "${USOCKETS_SRC}/internal/*.c"
    "${USOCKETS_SRC}/crypto/*.c"
    "${USOCKETS_SRC}/crypto/*.cpp"
)

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
    COMMAND ${BUN_EXECUTABLE} "${BUN_CODEGEN_SRC}/generate-classes.ts" ${BUN_CLASSES_TS} "${BUN_WORKDIR}/codegen"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    MAIN_DEPENDENCY "${BUN_CODEGEN_SRC}/generate-classes.ts"
    DEPENDS ${BUN_CLASSES_TS}
    VERBATIM
    COMMENT "Generating *.classes.ts bindings"
)

# --- JSSink Generator ---
add_custom_command(
    OUTPUT "${BUN_WORKDIR}/codegen/JSSink.cpp"
           "${BUN_WORKDIR}/codegen/JSSink.h"
    COMMAND ${BUN_EXECUTABLE} "src/codegen/generate-jssink.ts" "${BUN_WORKDIR}/codegen"
    VERBATIM 
    MAIN_DEPENDENCY "src/codegen/generate-jssink.ts"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Generating JSSink"
)

# --- .lut.h Generator ---
set(BUN_OBJECT_LUT_SOURCES
    bun.js/bindings/BunObject.cpp
    bun.js/bindings/ZigGlobalObject.lut.txt
    bun.js/bindings/JSBuffer.cpp
    bun.js/bindings/Process.cpp
    bun.js/bindings/ProcessBindingConstants.cpp
    bun.js/bindings/ProcessBindingNatives.cpp
)
set(BUN_HASH_LUT_GENERATOR "${BUN_CODEGEN_SRC}/create-hash-table.ts")
macro(GENERATE_HASH_LUT _input _output _display_name)
    add_custom_command(
        OUTPUT ${_output}
        MAIN_DEPENDENCY ${BUN_HASH_LUT_GENERATOR}
        DEPENDS ${_input}
        COMMAND ${BUN_EXECUTABLE} ${BUN_HASH_LUT_GENERATOR} ${_input} ${_output}
        VERBATIM
        COMMENT "Generating ${_display_name}"
    )
    # list(APPEND JavaScriptCore_HEADERS ${_output})
    WEBKIT_ADD_SOURCE_DEPENDENCIES(${_input} ${_output})
endmacro()
foreach(_file ${BUN_OBJECT_LUT_SOURCES})
    get_filename_component(_name ${_file} NAME_WE)

    # workaround for ZigGlobalObject
    if(_name MATCHES "ZigGlobalObject")
        set(_name "ZigGlobalObject")
    endif()

    GENERATE_HASH_LUT(${BUN_SRC}/${_file} ${BUN_WORKDIR}/codegen/${_name}.lut.h ${_name}.lut.h)
endforeach()

WEBKIT_ADD_SOURCE_DEPENDENCIES(${BUN_SRC}/bun.js/bindings/ZigGlobalObject.cpp ${BUN_WORKDIR}/codegen/ZigGlobalObject.lut.h)

# --- Identifier Cache ---
set(BUN_IDENTIFIER_CACHE_OUT
    "${BUN_SRC}/js_lexer/id_continue_bitset.blob" 
    "${BUN_SRC}/js_lexer/id_continue_bitset.meta.blob" 
    "${BUN_SRC}/js_lexer/id_start_bitset.blob"
    "${BUN_SRC}/js_lexer/id_start_bitset.meta.blob")
add_custom_command(
    OUTPUT ${BUN_IDENTIFIER_CACHE_OUT}
    MAIN_DEPENDENCY "${BUN_SRC}/js_lexer/identifier_data.zig"
    DEPENDS "${BUN_SRC}/js_lexer/identifier_cache.zig"
    COMMAND ${ZIG_COMPILER} run "${BUN_SRC}/js_lexer/identifier_data.zig"
    VERBATIM
    COMMENT "Building Identifier Cache"
)

# --- Bundled TS/JS ---
# Note: It's not worth doing this in parallel at the CMake/Ninja level, because this bundling
# requires all the JS files to be known, but also Bun will use all cores during bundling anyways.
file(GLOB BUN_TS_MODULES ${CONFIGURE_DEPENDS}
    "${BUN_SRC}/js/node/*.ts"
    "${BUN_SRC}/js/node/*.js"
    "${BUN_SRC}/js/bun/*.js"
    "${BUN_SRC}/js/bun/*.ts"
    "${BUN_SRC}/js/thirdparty/*.js"
    "${BUN_SRC}/js/thirdparty/*.ts"
    "${BUN_SRC}/js/internal/*.js"
    "${BUN_SRC}/js/internal/*.ts"
)
file(GLOB BUN_TS_FUNCTIONS ${CONFIGURE_DEPENDS} "${BUN_SRC}/js/builtins/*.ts")

add_custom_command(
    OUTPUT 
           "${BUN_WORKDIR}/codegen/InternalModuleRegistryConstants.h"
           "${BUN_WORKDIR}/codegen/InternalModuleRegistry+createInternalModuleById.h"
           "${BUN_WORKDIR}/codegen/InternalModuleRegistry+enum.h"
           "${BUN_WORKDIR}/codegen/InternalModuleRegistry+numberOfModules.h"
           "${BUN_WORKDIR}/codegen/NativeModuleImpl.h"
           "${BUN_WORKDIR}/codegen/ResolvedSourceTag.zig"
           "${BUN_WORKDIR}/codegen/SyntheticModuleType.h"
    COMMAND ${BUN_EXECUTABLE} "${BUN_SRC}/codegen/bundle-modules.ts" "${BUN_WORKDIR}"
    DEPENDS ${BUN_TS_MODULES}
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Bundling JS modules"
)
WEBKIT_ADD_SOURCE_DEPENDENCIES(
    "${BUN_SRC}/bun.js/bindings/InternalModuleRegistry.cpp"
    "${BUN_WORKDIR}/codegen/InternalModuleRegistryConstants.h"
)

add_custom_command(
    OUTPUT "${BUN_WORKDIR}/codegen/WebCoreJSBuiltins.cpp"
           "${BUN_WORKDIR}/codegen/WebCoreJSBuiltins.h"
    COMMAND ${BUN_EXECUTABLE} "${BUN_SRC}/codegen/bundle-functions.ts" "${BUN_WORKDIR}"
    DEPENDS ${BUN_TS_FUNCTIONS}
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Bundling JS builtin functions"
)

# --- Peechy API ---
add_custom_command(
    OUTPUT "${BUN_SRC}/api/schema.js"
           "${BUN_SRC}/api/schema.d.ts"
           "${BUN_SRC}/api/schema.zig"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.bin/peechy"
        "--schema" "${BUN_SRC}/api/schema.peechy"
        "--esm" "${BUN_SRC}/api/schema.js"
        "--ts" "${BUN_SRC}/api/schema.d.ts"
        "--zig" "${BUN_SRC}/api/schema.zig"
    COMMAND "${ZIG_COMPILER}" "fmt" "src/api/schema.zig"
    COMMAND "${PRETTIER}" "--config=.prettierrc.cjs" "--write" "src/api/schema.js" "src/api/schema.d.ts"
    DEPENDS "${BUN_SRC}/api/schema.peechy"
    COMMENT "Building schema"
)
add_custom_command(
    OUTPUT "${BUN_SRC}/analytics/analytics_schema.zig"
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMAND "${CMAKE_CURRENT_SOURCE_DIR}/node_modules/.bin/peechy"
        "--schema" "${BUN_SRC}/analytics/schema.peechy"
        "--zig" "${BUN_SRC}/analytics/analytics_schema.zig"
    COMMAND "${ZIG_COMPILER}" "fmt" "${BUN_SRC}/analytics/analytics_schema.zig"
    DEPENDS "${BUN_SRC}/api/schema.peechy"
    COMMENT "Building analytics_schema.zig"
)

# --- Zig Object ---
file(GLOB ZIG_FILES
    "${BUN_SRC}/*.zig"
    "${BUN_SRC}/**/*.zig"
    "${BUN_SRC}/**/**/*.zig"
    "${BUN_SRC}/**/**/**/*.zig"
)

if(DEBUG)
    set(BUN_ZIG_OBJ "${BUN_WORKDIR}/CMakeFiles/bun-debug.o")
else()
    set(BUN_ZIG_OBJ "${BUN_WORKDIR}/CMakeFiles/bun.o")
endif()

add_custom_command(
    OUTPUT "${BUN_ZIG_OBJ}"
    COMMAND "${ZIG_COMPILER}" "build" "obj"
        "-Doptimize=${ZIG_OPTIMIZE}"
        "-Doutput-dir=${BUN_WORKDIR}/CMakeFiles"
        "-Dcpu=${CPU_TARGET}"
        "-Dgenerated-code=${BUN_WORKDIR}/codegen"
        "-freference-trace=12"
    DEPENDS
        "${CMAKE_CURRENT_SOURCE_DIR}/build.zig"
        "${ZIG_FILES}"
        "${BUN_WORKDIR}/codegen/ZigGeneratedClasses.zig"
        "${BUN_WORKDIR}/codegen/ResolvedSourceTag.zig"
        "${BUN_IDENTIFIER_CACHE_OUT}"
        "${BUN_SRC}/api/schema.zig"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Building zig code"
    VERBATIM
    # This is here to show Zig's progress indicator
    USES_TERMINAL
)

# -- The Buntime™️ ---
add_executable(
    ${bun}
    
    ${BUN_CPP}
    ${USOCKETS_FILES}
    ${BUN_ZIG_OBJ}
    "${BUN_WORKDIR}/codegen/JSSink.cpp"
    "${BUN_WORKDIR}/codegen/ZigGeneratedClasses.cpp"
    "${BUN_WORKDIR}/codegen/WebCoreJSBuiltins.cpp"
    "${BUN_ZIG_OBJ}"
)
set_target_properties(${bun} PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS YES
    CXX_VISIBILITY_PRESET hidden
    C_STANDARD 17
    C_STANDARD_REQUIRED YES
    VISIBILITY_INLINES_HIDDEN YES
)

# Set /subsystem:console on bun for windows
if(WIN32)
    set_target_properties(${bun} PROPERTIES LINK_FLAGS " /SUBSYSTEM:CONSOLE ")
endif()

add_compile_definitions(
    # TODO: are all of these variables strictly necessary?
    "_HAS_EXCEPTIONS=0"
    "LIBUS_USE_OPENSSL=1"
    "UWS_HTTPRESPONSE_NO_WRITEMARK=1"
    "LIBUS_USE_BORINGSSL=1"
    "WITH_BORINGSSL=1"
    "STATICALLY_LINKED_WITH_JavaScriptCore=1"
    "STATICALLY_LINKED_WITH_WTF=1"
    "STATICALLY_LINKED_WITH_BMALLOC=1"
    "BUILDING_WITH_CMAKE=1"
    "JSC_OBJC_API_ENABLED=0"
    "BUN_SINGLE_THREADED_PER_VM_ENTRY_SCOPE=1"
    "NAPI_EXPERIMENTAL=ON"
    "NOMINMAX"
    "IS_BUILD"
    "BUILDING_JSCONLY__"
    "ASSERT_ENABLED=$<IF:$<CONFIG:ASSERT_ENABLED>,1,0>"
    "BUN_DYNAMIC_JS_LOAD_PATH=\"${BUN_WORKDIR}/js\""
)
if(NOT ASSERT_ENABLED)
    add_compile_definitions("NDEBUG")
endif()

message(STATUS "${WEBKIT_INCLUDE_DIR}")

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
    ${WEBKIT_DIR}/WTF/Headers
    ${WEBKIT_DIR}/ICU/Headers
    ${WEBKIT_DIR}/bmalloc/Headers
    ${WEBKIT_DIR}/
    ${WEBKIT_DIR}/JavaScriptCore/PrivateHeaders
    ${WEBKIT_DIR}/bmalloc/PrivateHeaders
    ${WEBKIT_DIR}/WTF/PrivateHeaders
    "${BUN_WORKDIR}/codegen"
)

# --- clang and linker flags ---
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    if(NOT MSVC)
        target_compile_options(${bun} PUBLIC -g3 -Og)
    endif()
    add_compile_definitions("BUN_DEBUG=1")
    
elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
    #if (MSVC)
        #target_compile_options(${bun} PUBLIC /O2)
    ##else()
      #  target_compile_options(${bun} PUBLIC -O3)
   # endif()
endif()

if(NOT MSVC)
    if(NOT CI)
        target_compile_options(${bun} PRIVATE -fdiagnostics-color=always)
    endif()

    target_compile_options(${bun} PUBLIC
        -march=${CPU_TARGET}
        -mtune=${CPU_TARGET}
        -fconstexpr-steps=1271242
        -fconstexpr-depth=27
        -fno-exceptions
        -fvisibility=hidden
        -fvisibility-inlines-hidden
        -fno-rtti
        -ferror-limit=${ERROR_LIMIT}
        -fPIC
        # -fno-omit-frame-pointer
        # -fno-semantic-interposition
    )
else() # MSVC
    string(APPEND SUPPRESS_WARNING_NUMBERS
        # JSC deletes operator delete to prevent accidental use
        "/wd4291 "
        # we use #pragma mark in some places
        "/wd4068"
    )
    string(APPEND CMAKE_CXX_FLAGS " /EHsc /GR-")
    string(APPEND CMAKE_C_FLAGS " /EHsc /GR- /MP ${SUPPRESS_WARNING_NUMBERS} /experimental:c11atomics /std:c17")
    string(APPEND CMAKE_CXX_FLAGS " /Zc:__cplusplus /Zc:inline /bigobj /MP ${SUPPRESS_WARNING_NUMBERS}")
endif()

if(APPLE)
    if(ARCH STREQUAL "x86_64")
        set(CMAKE_OSX_DEPLOYMENT_TARGET "10.14")
    else()
        set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0")
    endif()
    
    target_link_options(${bun} PUBLIC "-dead_strip")
    target_link_options(${bun} PUBLIC "-dead_strip_dylibs")
    target_link_options(${bun} PUBLIC "-exported_symbols_list" "${BUN_SRC}/symbols.txt")
    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${BUN_SRC}/symbols.txt")

    target_link_options(${bun} PUBLIC "-fno-keep-static-consts")
    target_link_libraries(${bun} PRIVATE "resolv")
endif()

if(UNIX AND NOT APPLE)
    target_compile_options(${bun} PUBLIC
        -std=c++2a
    )
    target_link_options(${bun} PUBLIC
        "-static-libstdc++"
        "-static-libgcc"
        "-fuse-ld=lld"
        "-Wl,-z,now"
        "-Wl,--as-needed"
        "-Wl,--gc-sections"
        "-Wl,-z,stack-size=12800000"
        "-Wl,--wrap=fcntl"
        "-Wl,--wrap=fcntl64"
        "-Wl,--wrap=stat64"
        "-Wl,--wrap=pow"
        "-Wl,--wrap=exp"
        "-Wl,--wrap=log"
        "-Wl,--wrap=log2"
        "-Wl,--wrap=lstat"
        "-Wl,--wrap=stat"
        "-Wl,--wrap=fstat"
        "-Wl,--wrap=fstatat"
        "-Wl,--wrap=lstat64"
        "-Wl,--wrap=stat64"
        "-Wl,--wrap=fstat64"
        "-Wl,--wrap=fstatat64"
        "-Wl,--wrap=mknod"
        "-Wl,--wrap=mknodat"
        "-Wl,--wrap=statx "
        "-Wl,--compress-debug-sections=zlib"
        "-Bsymbolics-functions"
        "-rdynamic"
        "-Wl,--dynamic-list=${BUN_SRC}/symbols.dyn"
        "-Wl,--version-script=${BUN_SRC}/linker.lds"
    )
    target_link_libraries(${bun} PRIVATE "c")
    target_link_libraries(${bun} PRIVATE "libatomic.a")

    target_link_libraries(${bun} PRIVATE "${WEBKIT_DIR}/lib/libicudata.a")
    target_link_libraries(${bun} PRIVATE "${WEBKIT_DIR}/lib/libicui18n.a")
    target_link_libraries(${bun} PRIVATE "${WEBKIT_DIR}/lib/libicuuc.a")

    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${BUN_SRC}/linker.lds")
    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${BUN_SRC}/symbols.dyn")
endif()

if(WIN32)
    add_compile_definitions(
        "WIN32"
        "_WINDOWS"
        "_CRT_SECURE_NO_WARNINGS"
        "WIN32_LEAN_AND_MEAN=1"
    )
    
    set_property(TARGET ${bun} PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")
endif()

if(APPLE)
    # TODO: a much better check can be done to find this path
    find_path(
        ICU4C_DIR NAMES lib/libicudata.a
        PATHS ENV PATH /usr/local/opt/icu4c /opt/homebrew/opt/icu4c
    )
    find_path(
        ICONV_DIR NAMES lib/libiconv.a
        PATHS ENV PATH /usr/local/opt/libiconv /opt/homebrew/opt/libiconv
    )

    target_link_libraries(${bun} PRIVATE "icucore")
    target_link_libraries(${bun} PRIVATE "${ICONV_DIR}/lib/libiconv.a")
    target_link_libraries(${bun} PRIVATE "${ICU4C_DIR}/lib/libicudata.a")
    target_link_libraries(${bun} PRIVATE "${ICU4C_DIR}/lib/libicui18n.a")
    target_link_libraries(${bun} PRIVATE "${ICU4C_DIR}/lib/libicuuc.a")
    include_directories(${ICU4C_DIR}/include)
endif()

# --- Stripped Binary "bun"
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND NOT WIN32)
    add_custom_command(
        TARGET ${bun}
        POST_BUILD
        COMMAND ${DSYMUTIL} -o ${BUN_WORKDIR}/bun.dSYM ${BUN_WORKDIR}/${bun}
        COMMENT "Stripping Symbols"
    )
    add_custom_command(
        TARGET ${bun}
        POST_BUILD
        COMMAND ${STRIP} -s -x -S -o ${BUN_WORKDIR}/bun ${BUN_WORKDIR}/${bun}
        COMMENT "Stripping Symbols"
    )
endif()

# --- Dependencies ---

if(USE_CUSTOM_ZLIB AND (NOT WIN32))
    target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libz.a")
    include_directories(${BUN_DEPS_DIR}/zlib/include)
else()
    find_package(ZLIB REQUIRED)
    target_link_libraries(${bun} PRIVATE ZLIB::ZLIB)
endif()

if(USE_CUSTOM_BORINGSSL)
    include_directories(src/deps/boringssl/include)
    if (WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/crypto.lib")
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/ssl.lib")
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/decrepit.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libcrypto.a")
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libssl.a")
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libdecrepit.a")
    endif()
else()
    include(FindBoringSSL)
    FindBoringSSL(${bun})
endif()

if(USE_CUSTOM_LIBARCHIVE)
    include_directories(src/deps/libarchive/include)
    if (WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/archive.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libarchive.a")
    endif()
else()
    find_package(LibArchive REQUIRED)
    target_link_libraries(${bun} PRIVATE LibArchive::LibArchive)
endif()

if(USE_CUSTOM_MIMALLOC)
    include_directories(src/deps/mimalloc/include)
    if (WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/mimalloc-static.lib")
    elseif(APPLE)
        # https://github.com/microsoft/mimalloc/issues/512
        # Linking mimalloc via object file on macOS x64 can cause heap corruption
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libmimalloc.a")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libmimalloc.o")
    endif()
else()
    find_package(mimalloc REQUIRED)
    target_link_libraries(${bun} PRIVATE mimalloc)
endif()

if(USE_CUSTOM_ZSTD)
    include_directories(src/deps/zstd/include)
    if (WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/zstd.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libzstd.a")
    endif()
else()
    find_package(zstd CONFIG REQUIRED)
    target_link_libraries(${bun} PRIVATE zstd::libzstd)
endif()

if(USE_CUSTOM_CARES)
    include_directories(src/deps/c-ares/include)
    if (WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/cares.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libcares.a")
    endif()
else()
    find_package(c-ares CONFIG REQUIRED)
    target_link_libraries(${bun} PRIVATE c-ares::cares)
endif()

if(USE_CUSTOM_BASE64)
    include_directories(src/deps/base64/include)
    if (WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/base64.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libbase64.a")
    endif()
else()
    find_package(base64 REQUIRED)
    target_link_libraries(${bun} PRIVATE base64::base64)
endif()

if(NOT WIN32)
    if (USE_CUSTOM_TINYCC)
        if (WIN32)
            target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/tcc.lib")
        else()
            target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/libtcc.a")
        endif()
    else()
        find_package(tinycc REQUIRED)
        target_link_libraries(${bun} PRIVATE tinycc::tinycc)
    endif()
endif()

if(USE_CUSTOM_LOLHTML)
    if (WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/lolhtml.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/liblolhtml.a")
    endif()
else()
    find_package(lolhtml REQUIRED)
    target_link_libraries(${bun} PRIVATE lolhtml::lolhtml)
endif()

if(WIN32)
    if (USE_CUSTOM_LIBUV)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_DIR}/uv.lib")
    else()
        find_package(libuv CONFIG REQUIRED )
        target_link_libraries(${bun} PRIVATE $<IF:$<TARGET_EXISTS:libuv::uv_a>,libuv::uv_a,libuv::uv>)
    endif()
    message(STATUS "Found libuv: ${libuv_LIBRARIES}")
endif()

if(USE_STATIC_SQLITE)
    add_library(sqlite3 STATIC src/bun.js/bindings/sqlite/sqlite3.c)
    target_include_directories(sqlite3 PUBLIC src/bun.js/bindings/sqlite)
    target_link_libraries(${bun} PRIVATE sqlite3)
    message(STATUS "Using static sqlite3")
    target_compile_definitions(${bun} PRIVATE "LAZY_LOAD_SQLITE=0")
else()
    message(STATUS "Using dynamicly linked sqlite3")
    target_compile_definitions(${bun} PRIVATE "LAZY_LOAD_SQLITE=1")
endif()

if(NOT MSVC)
    target_link_libraries(${bun} PRIVATE "${WEBKIT_DIR}/lib/libWTF.a")
    target_link_libraries(${bun} PRIVATE "${WEBKIT_DIR}/lib/libJavaScriptCore.a")
    target_link_libraries(${bun} PRIVATE "${WEBKIT_DIR}/lib/libbmalloc.a")
else()

    target_link_libraries(${bun} PRIVATE "${WEBKIT_DIR}/lib/WTF.lib")
    target_link_libraries(${bun} PRIVATE "${WEBKIT_DIR}/lib/JavaScriptCore.lib")

    if (WIN32)
        string (APPEND CMAKE_CXX_FLAGS 
            " /external:anglebrackets /Gs- /Zi"
        )
        string (APPEND CMAKE_FLAGS 
            " /external:anglebrackets /Gs- /Zi"
        )
        set_target_properties(${bun} PROPERTIES LINK_FLAGS " /SUBSYSTEM:CONSOLE /STACK:4194304,2097152")
    endif()
    
    if (DEFINED ENV{VCPKG_ROOT})
        include_directories($ENV{VCPKG_ROOT}/installed/x64-windows/include)
    endif()

    # include_directories(C:/Users/windo/Build/WebKit/WebKitBuild/WTF/DerivedSources)
    # include_directories(C:/Users/windo/Build/WebKit/WebKitBuild/WTF/Headers)
    file(COPY C:/Users/windo/Code/WebKit/WebKitBuild/cmakeconfig.h DESTINATION ${BUN_SRC}/bun.js/bindings)

    include_directories(C:/Users/windo/Code/WebKit/WebKitLibraries/win/include)
    link_directories(C:/Users/windo/Code/WebKit/WebKitLibraries/win/lib64)
    target_link_directories(${bun} PUBLIC ${ICU_LIBRARY})
    
    
    target_link_libraries(${bun} PUBLIC icuuc icudt icutu icuio icuin icutest)
    target_link_libraries(${bun} PUBLIC winmm ws2_32 bcrypt ntdll kernel32 shell32 shlwapi advapi32 vcruntime ucrt legacy_stdio_definitions)
endif()