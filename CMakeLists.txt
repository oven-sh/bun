cmake_minimum_required(VERSION 3.25)
cmake_policy(SET CMP0091 NEW)

if(UNIX)
    set(CLANG_VERSION 16)
    find_path(
        LLVM_TOOLS_BINARY_DIR
        NAMES clang++-${CLANG_VERSION} clang-${CLANG_VERSION} clang++ clang
        PATHS ENV PATH /usr/bin /usr/local/bin /opt/homebrew/opt/llvm@${CLANG_VERSION}/bin /opt/homebrew/bin
    )
    set(CMAKE_CXX_COMPILER "${LLVM_TOOLS_BINARY_DIR}/clang++")
    set(CMAKE_C_COMPILER "${LLVM_TOOLS_BINARY_DIR}/clang")
    set(CMAKE_CXX_COMPILER_ID "Clang")
endif()

project(Bun VERSION "1.0.7")

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
    set(target_name "bun-debug")
else()
    set(DEBUG OFF)
    set(target_name "bun")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_C_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD_REQUIRED ON)

# Zig Compiler
function(validate_zig validator_result_var item)
    set(${validator_result_var} FALSE PARENT_SCOPE)
    # We will allow any valid zig compiler, as long as it contains some text from `zig zen`
    execute_process(COMMAND ${item} zen OUTPUT_VARIABLE ZIG_ZEN_OUTPUT)
    if(ZIG_ZEN_OUTPUT MATCHES "Together we serve the users")
        set(${validator_result_var} TRUE PARENT_SCOPE)
    else()
        set(${validator_result_var} FALSE PARENT_SCOPE)
    endif()
endfunction()
find_program(ZIG_COMPILER zig REQUIRED DOC "Path to the Zig compiler" VALIDATOR validate_zig)
message(STATUS "Found Zig Compiler: ${ZIG_COMPILER}")

# Bun. This is a sort of chicken-and-egg problem where you need `bun` to build `bun`
# maybe in the future we can make it possible to use bun-polyfills in combination
# with Node to fufill this requirement.
find_program(BUN_EXECUTABLE bun REQUIRED DOC "Path to an already built release of Bun")

#
set(DEFAULT_ON_UNLESS_WINDOWS ON)
if (WIN32)
    set(DEFAULT_ON_UNLESS_WINDOWS OFF)
endif()

set(DEFAULT_USE_STATIC_SQLITE ON)
if(APPLE)
    set(DEFAULT_USE_STATIC_SQLITE OFF)
endif()

# User options
option(USE_STATIC_SQLITE "Statically link SQLite?" ${DEFAULT_USE_STATIC_SQLITE})
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
option(USE_BASELINE_BUILD "Build Bun for older CPUs" OFF)

set(ERROR_LIMIT 100 CACHE STRING "Maximum number of errors to show when compiling C++ code")

# CPU Target
if(NOT CPU_TARGET)
    set(CPU_TARGET "native")
    if (ARCH STREQUAL "x86_64")
        if (NOT MSVC)
            if (USE_BASELINE_BUILD)
                set(CPU_TARGET "nehalem")
            else ()
                set(CPU_TARGET "haswell")
            endif()
        endif()
    endif()
endif()
message(STATUS "Building for CPU Target: ${CPU_TARGET}")

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
    message(STATUS "C++ Assertions enabled")
else()
    message(STATUS "C++ Assertions disabled")
endif()

set(BUN_DEPS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/deps" CACHE STRING "Directory holding submodules" )
set(BUN_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/deps" CACHE STRING "Directory holding static libraries" )

add_compile_options(-D_HAS_EXCEPTIONS=0)

# CCACHE
find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM)
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    message(STATUS "Using ccache: ${CCACHE_PROGRAM}")
endif()

file(GLOB bun_SRC CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/src/deps/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/io/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/modules/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/WebCore/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/sqlite/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/webcrypto/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/webcrypto/*/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/js/out/*.cpp"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/deps/picohttpparser/picohttpparser.c"
)

file(GLOB uSockets_FILES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/*.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/eventing/*.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/internal/*.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/crypto/*.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/crypto/*.cpp"
)

# Class bindings generator
file(GLOB Bun_CLASSES_TS_FILES CONFIGURE_DEPENDS
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/*.classes.ts"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/api/*.classes.ts"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/test/*.classes.ts"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/webcore/*.classes.ts"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/node/*.classes.ts"
)
add_custom_command(
    OUTPUT "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/ZigGeneratedClasses.h"
           "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/ZigGeneratedClasses.cpp"
           "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/ZigGeneratedClasses+lazyStructureHeader.h"
           "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/ZigGeneratedClasses+DOMClientIsoSubspaces.h"
           "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/ZigGeneratedClasses+DOMIsoSubspaces.h"
           "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/ZigGeneratedClasses+lazyStructureImpl.h"
           "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/generated_classes.zig"
    COMMAND ${BUN_EXECUTABLE} "src/codegen/generate-classes.ts" ${Bun_CLASSES_TS_FILES}
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    MAIN_DEPENDENCY "${CMAKE_CURRENT_SOURCE_DIR}/src/codegen/generate-classes.ts"
    DEPENDS ${Bun_CLASSES_TS_FILES}
    VERBATIM
    COMMENT "Generating class bindings"    
)

# JSSink generator
add_custom_command(
    OUTPUT "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/JSSink.cpp"
           "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/JSSink.h"
    COMMAND ${BUN_EXECUTABLE} "src/codegen/generate-jssink.ts"
    VERBATIM 
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Generating JSSink"
)

# # Append the given dependencies to the source file
# macro(WEBKIT_ADD_SOURCE_DEPENDENCIES _source _deps)
#     set(_tmp)
#     get_source_file_property(_tmp ${_source} OBJECT_DEPENDS)
#     if (NOT _tmp)
#         set(_tmp "")
#     endif ()

#     foreach (f ${_deps})
#         list(APPEND _tmp "${f}")
#     endforeach ()

#     set_source_files_properties(${_source} PROPERTIES OBJECT_DEPENDS "${_tmp}")
#     unset(_tmp)
# endmacro()

# # LUT generator
# file(Bun_OBJECT_LUT_SOURCES
#     src/bun.js/bindings/BunObject.cpp
#     src/bun.js/bindings/ZigGlobalObject.lut.txt
#     src/bun.js/bindings/JSBuffer.cpp
#     src/bun.js/bindings/Process.cpp
#     src/bun.js/bindings/ProcessBindingConstants.cpp
#     src/bun.js/bindings/ProcessBindingNatives.cpp
# )
# set(HASH_LUT_GENERATOR ${CMAKE_CURRENT_SOURCE_DIR}/src/codegen/create_hash_table)

# macro(GENERATE_HASH_LUT _input _output)
#     add_custom_command(
#         OUTPUT ${_output}
#         MAIN_DEPENDENCY ${HASH_LUT_GENERATOR}
#         DEPENDS ${_input}
#         COMMAND ${PERL_EXECUTABLE} ${HASH_LUT_GENERATOR} ${_input} > ${_output}
#         VERBATIM)
#     list(APPEND JavaScriptCore_HEADERS ${_output})
#     WEBKIT_ADD_SOURCE_DEPENDENCIES(${_input} ${_output})
# endmacro()

# # GENERATOR 1-A: LUT creator
# foreach(_file ${JavaScriptCore_OBJECT_LUT_SOURCES})
#     get_filename_component(_name ${_file} NAME_WE)
#     GENERATE_HASH_LUT(${CMAKE_CURRENT_SOURCE_DIR}/${_file} ${JavaScriptCore_DERIVED_SOURCES_DIR}/${_name}.lut.h)
# endforeach()

add_compile_definitions(
    # TODO: are all of these variables strictly necessary?
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
    "NDEBUG=$<IF:$<CONFIG:ASSERT_ENABLED>,0,1>"
    "ASSERT_ENABLED=$<IF:$<CONFIG:ASSERT_ENABLED>,1,0>"
)

include_directories(
    packages/bun-uws
    packages
    packages/bun-usockets
    packages/bun-usockets/src
    src/bun.js/bindings
    src/bun.js/bindings/webcore
    src/bun.js/bindings/webcrypto
    src/bun.js/bindings/sqlite
    src/bun.js/modules
    src/js/out
    src/js/out/modules
    src/js/builtins
    src/napi
    src/deps
    src/deps/picohttpparser
    ${WEBKIT_DIR}/WTF/Headers
    ${WEBKIT_DIR}/ICU/Headers
    ${WEBKIT_DIR}/bmalloc/Headers
    ${WEBKIT_DIR}/
    ${WEBKIT_DIR}/include
    ${WEBKIT_DIR}/JavaScriptCore/PrivateHeaders
    ${WEBKIT_DIR}/bmalloc/PrivateHeaders
    ${WEBKIT_DIR}/WTF/PrivateHeaders
)

set(BUN_OBJECT_FILE zig-out/lib/bun.o)
if (CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(BUN_OBJECT_FILE zig-out/lib/bun-debug.o)
    if (NOT MSVC)
        string(APPEND CMAKE_CXX_FLAGS " -g3 -O1")
        string(APPEND CMAKE_C_FLAGS " -g3 -O1")
    else()
        string(APPEND CMAKE_CXX_FLAGS " /O1")
        string(APPEND CMAKE_C_FLAGS " /O1")
    endif()
    add_compile_definitions("BUN_DEBUG")
elseif (NOT MSVC)
    string(APPEND CMAKE_CXX_FLAGS " -O3 -femit-llvm" )
    string(APPEND CMAKE_C_FLAGS " -O3 -femit-llvm")
else ()
    string(APPEND CMAKE_CXX_FLAGS " /O2" )
    string(APPEND CMAKE_C_FLAGS " /O2")
endif()

set(EXTRA_SRC "")
if (WIN32)
    set(EXTRA_SRC "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/musl-memmem.c")
    add_compile_definitions(
        "WIN32"
        "_WINDOWS"
        "_CRT_SECURE_NO_WARNINGS"
        "WIN32_LEAN_AND_MEAN=1"
    )
endif()

# if clang
if (CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
    string(APPEND CMAKE_CXX_FLAGS " -fconstexpr-steps=1271242 -fconstexpr-depth=27")
    string(APPEND CMAKE_CXX_FLAGS
        " -fno-exceptions"
        " -fno-rtti"
        " -ferror-limit=100"
        " -fvisibility=hidden"
        " -fvisibility-inlines-hidden"
    )
    string(APPEND CMAKE_C_FLAGS
        " -ferror-limit=${ERROR_LIMIT}"
        " -fvisibility=hidden"
        " -fvisibility-inlines-hidden"
    )
elseif(MSVC)
    string(APPEND SUPPRESS_WARNING_NUMBERS
        # JSC deletes operator delete to prevent accidental use
        " /wd4291"
        # we use #pragma mark in some places
        " /wd4068"
    )
    string(APPEND CMAKE_CXX_FLAGS " /EHsc /GR-")
    string(APPEND CMAKE_C_FLAGS " /EHsc /GR- /MP  ${SUPPRESS_WARNING_NUMBERS} /experimental:c11atomics /std:c17")
    string(APPEND CMAKE_CXX_FLAGS " /Zc:__cplusplus /Zc:inline /bigobj /MP ${SUPPRESS_WARNING_NUMBERS}")
endif()

if (APPLE)
    string(APPEND CMAKE_LINKER_FLAGS " -fno-keep-static-consts -Wl,-dead_strip -Wl,-dead_strip_dylibs")
    string(APPEND CMAKE_CXX_FLAGS " -stdlib=libc++")
    string(APPEND CMAKE_CXX_FLAGS " -mmacosx-version-min=11")
    string(APPEND CMAKE_C_FLAGS " -mmacosx-version-min=11")
endif()

if (NOT MSVC)
    string(APPEND CMAKE_CXX_FLAGS " -march=${CPU_TARGET} -mtune=${CPU_TARGET}")
    string(APPEND CMAKE_C_FLAGS " -march=${CPU_TARGET} -mtune=${CPU_TARGET}")
endif()

set(IDENTIFIER_CACHE_FILES 
    "${CMAKE_CURRENT_SOURCE_DIR}/src/js_lexer/id_continue_bitset.blob" 
    "${CMAKE_CURRENT_SOURCE_DIR}/src/js_lexer/id_continue_bitset.meta.blob" 
    "${CMAKE_CURRENT_SOURCE_DIR}/src/js_lexer/id_start_bitset.blob"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/js_lexer/id_start_bitset.meta.blob")

file(GLOB ZIG_FILES CONFIGURE_DEPENDS 
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*.zig"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*/*.zig"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*/**/*.zig"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/*/*/*/*.zig"
)

add_custom_command(
    OUTPUT "${BUN_OBJECT_FILE}"
    COMMAND "${ZIG_COMPILER}" build obj -Doptimize=${CMAKE_BUILD_TYPE} -Doutput-dir=${CMAKE_CURRENT_SOURCE_DIR}/zig-out/lib -Dcpu=${CPU_TARGET}
    DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/build.zig ${ZIG_FILES}
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Building zig code"
    VERBATIM
)

add_executable(${target_name} ${bun_SRC} ${uSockets_FILES} ${BUN_OBJECT_FILE} ${EXTRA_SRC})

# Set /subsystem:console on bun for windows
if (WIN32)
    set_target_properties(${target_name} PROPERTIES LINK_FLAGS " /SUBSYSTEM:CONSOLE ")
endif()

# TODO: not good enough
# add_custom_command(
#     TARGET bun PRE_BUILD
#     COMMAND ${BUN_EXECUTABLE} "${CMAKE_CURRENT_SOURCE_DIR}/src/js/_codegen/index.ts"
#     DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/src/js/**/*.{js,ts}"
#     COMMENT "Bundling JS modules"
# )

set_target_properties(${target_name} PROPERTIES
    CXX_STANDARD 20
    CXX_STANDARD_REQUIRED YES
    CXX_EXTENSIONS YES
    CXX_VISIBILITY_PRESET hidden
    C_STANDARD 17
    C_STANDARD_REQUIRED YES
    VISIBILITY_INLINES_HIDDEN YES
)

set(CMAKE_COLOR_DIAGNOSTICS ON)

if (APPLE)
    # TODO: a much better check can be done to find this path
    find_path(
        ICU4C_DIR NAMES lib/libicudata.a
        PATHS ENV PATH /usr/local/opt/icu4c /opt/homebrew/opt/icu4c
    )
    find_path(
        ICONV_DIR NAMES lib/libiconv.a
        PATHS ENV PATH /usr/local/opt/libiconv /opt/homebrew/opt/libiconv
    )
    
    # resolv might not go here. i think it's c-ares related.
    target_link_libraries(${target_name} PRIVATE "resolv")

    target_link_libraries(${target_name} PRIVATE "icucore")
    target_link_libraries(${target_name} PRIVATE "${ICONV_DIR}/lib/libiconv.a")
    target_link_libraries(${target_name} PRIVATE "${ICU4C_DIR}/lib/libicudata.a")
    target_link_libraries(${target_name} PRIVATE "${ICU4C_DIR}/lib/libicui18n.a")
    target_link_libraries(${target_name} PRIVATE "${ICU4C_DIR}/lib/libicuuc.a")
    include_directories(${ICU4C_DIR}/include)
elseif (LINUX)
    string(APPEND CMAKE_CXX_FLAGS " -static-libstdc++ -static-libgcc -fno-omit-frame-pointer")
    string(APPEND CMAKE_C_FLAGS " -static-libgcc -fno-omit-frame-pointer")
    target_link_libraries(${target_name} PRIVATE "c")
    string(APPEND CMAKE_LINKER_FLAGS 
        " -Wl,--compress-debug-sections=zlib "
        " -l:libatomic.a "
        " -Wl,-Bsymbolics-functions "
        " -fno-semantic-interposition "
        " -Wl,-z,now"
        " -Wl,--as-needed"
        " -Wl,--gc-sections"
        " -Wl,-z,-stack-size=12800000"
        " -Wl,--wrap=fcntl"
        " -Wl,--wrap=fcntl64"
        " -Wl,--wrap=stat64"
        " -Wl,--wrap=pow"
        " -Wl,--wrap=exp"
        " -Wl,--wrap=log"
        " -Wl,--wrap=log2"
        " -Wl,--wrap=lstat"
        " -Wl,--wrap=stat"
        " -Wl,--wrap=fstat"
        " -Wl,--wrap=fstatat"
        " -Wl,--wrap=lstat64"
        " -Wl,--wrap=stat64"
        " -Wl,--wrap=fstat64"
        " -Wl,--wrap=fstatat64"
        " -Wl,--wrap=mknod"
        " -Wl,--wrap=mknodat"
        " -Wl,--wrap=statx "
    )
endif()

if (USE_CUSTOM_ZLIB AND (NOT WIN32))
    target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libz.a")
    include_directories(${BUN_DEPS_DIR}/zlib/include)
else ()
    find_package(ZLIB REQUIRED)
    target_link_libraries(${target_name} PRIVATE ZLIB::ZLIB)
endif ()

if (USE_CUSTOM_BORINGSSL)
    include_directories(src/deps/boringssl/include)
    if (WIN32)
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/crypto.lib")
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/ssl.lib")
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/decrepit.lib")
    else()
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libcrypto.a")
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libssl.a")
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libdecrepit.a")
    endif()
else ()
    include(FindBoringSSL)
    FindBoringSSL(${target_name})
endif()

if (USE_CUSTOM_LIBARCHIVE)
    include_directories(src/deps/libarchive/include)
    if (WIN32)
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/archive.lib")
    else()
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libarchive.a")
    endif()
else ()
    find_package(LibArchive REQUIRED)
    target_link_libraries(${target_name} PRIVATE LibArchive::LibArchive)
endif()

if (USE_CUSTOM_MIMALLOC)
    include_directories(src/deps/mimalloc/include)
    if (WIN32)
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/mimalloc-static.lib")
    else()
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libmimalloc.a")
    endif()
else ()
    find_package(mimalloc REQUIRED)
    target_link_libraries(${target_name} PRIVATE mimalloc)
endif()

if (USE_CUSTOM_ZSTD)
    include_directories(src/deps/zstd/include)
    if (WIN32)
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/zstd.lib")
    else()
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libzstd.a")
    endif()
else ()
    find_package(zstd CONFIG REQUIRED)
    target_link_libraries(${target_name} PRIVATE zstd::libzstd)
endif()

if (USE_CUSTOM_CARES)
    include_directories(src/deps/c-ares/include)
    if (WIN32)
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/cares.lib")
    else()
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libcares.a")
    endif()
else ()
    find_package(c-ares CONFIG REQUIRED)
    target_link_libraries(${target_name} PRIVATE c-ares::cares)
endif()


if (USE_CUSTOM_BASE64)
    include_directories(src/deps/base64/include)
    if (WIN32)
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/base64.lib")
    else()
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libbase64.a")
    endif()
else ()
    find_package(base64 REQUIRED)
    target_link_libraries(bun PRIVATE base64::base64)
endif()

if (NOT WIN32)
    if (USE_CUSTOM_TINYCC)
        if (WIN32)
            target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/tcc.lib")
        else()
            target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/libtcc.a")
        endif()
    else ()
        find_package(tinycc REQUIRED)
        target_link_libraries(${target_name} PRIVATE tinycc::tinycc)
    endif()
endif()

set_property(TARGET ${target_name} PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreadedDLL"
)

if (USE_CUSTOM_LOLHTML)
    if (WIN32)
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/lolhtml.lib")
    else()
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/liblolhtml.a")
    endif()
else ()
    find_package(lolhtml REQUIRED)
    target_link_libraries(${target_name} PRIVATE lolhtml::lolhtml)
endif()

if (WIN32)
    if (USE_CUSTOM_LIBUV)
        target_link_libraries(${target_name} PRIVATE "${BUN_LIB_DIR}/uv.lib")
    else ()
        find_package(libuv CONFIG REQUIRED )
        target_link_libraries(${target_name} PRIVATE $<IF:$<TARGET_EXISTS:libuv::uv_a>,libuv::uv_a,libuv::uv>)
    endif()

endif()

if (USE_STATIC_SQLITE)
    add_library(sqlite3 STATIC src/bun.js/bindings/sqlite/sqlite3.c)
    target_include_directories(sqlite3 PUBLIC src/bun.js/bindings/sqlite)
    target_link_libraries(bun PRIVATE sqlite3)
    target_compile_definitions(${target_name} PRIVATE "LAZY_LOAD_SQLITE=0")
else()
    target_compile_definitions(${target_name} PRIVATE "LAZY_LOAD_SQLITE=1")
endif()


if (NOT MSVC)
    string(APPEND CMAKE_CXX_FLAGS " -fPIC")
endif()


if (NOT MSVC)
    target_link_libraries(${target_name} PRIVATE "${WEBKIT_DIR}/lib/libWTF.a")
    target_link_libraries(${target_name} PRIVATE "${WEBKIT_DIR}/lib/libJavaScriptCore.a")
    target_link_libraries(${target_name} PRIVATE "${WEBKIT_DIR}/lib/libbmalloc.a")
else()

    target_link_libraries(${target_name} PRIVATE "${WEBKIT_DIR}/lib/WTF.lib")
    target_link_libraries(${target_name} PRIVATE "${WEBKIT_DIR}/lib/JavaScriptCore.lib")

    if (WIN32)
        string (APPEND CMAKE_CXX_FLAGS 
            " /external:anglebrackets /Gs- /Zi"
        )
        string (APPEND CMAKE_FLAGS 
            " /external:anglebrackets /Gs- /Zi"
        )
        set_target_properties(${target_name} PROPERTIES LINK_FLAGS " /SUBSYSTEM:CONSOLE /STACK:4194304,2097152")
    endif()
    
    if (DEFINED ENV{VCPKG_ROOT})
        include_directories($ENV{VCPKG_ROOT}/installed/x64-windows/include)
    endif()

    # include_directories(C:/Users/windo/Build/WebKit/WebKitBuild/WTF/DerivedSources)
    # include_directories(C:/Users/windo/Build/WebKit/WebKitBuild/WTF/Headers)
    file(COPY C:/Users/windo/Code/WebKit/WebKitBuild/cmakeconfig.h DESTINATION ${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings)  
    

    include_directories(C:/Users/windo/Code/WebKit/WebKitLibraries/win/include)
    link_directories(C:/Users/windo/Code/WebKit/WebKitLibraries/win/lib64)
    target_link_directories(${target_name} PUBLIC ${ICU_LIBRARY})
    
    
    target_link_libraries(${target_name} PUBLIC icuuc icudt icutu icuio icuin icutest)
    target_link_libraries(${target_name} PUBLIC winmm ws2_32 bcrypt ntdll kernel32 shell32 shlwapi advapi32 vcruntime ucrt legacy_stdio_definitions)
endif()