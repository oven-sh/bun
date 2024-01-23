cmake_minimum_required(VERSION 3.22)
cmake_policy(SET CMP0091 NEW)
cmake_policy(SET CMP0067 NEW)

set(Bun_VERSION "1.0.25")
set(WEBKIT_TAG 9c501b9aa712b7959f80dc99491e8758c151c20e)

set(BUN_WORKDIR "${CMAKE_CURRENT_BINARY_DIR}")
message(STATUS "Configuring Bun ${Bun_VERSION} in ${BUN_WORKDIR}")

# --- Build Type ---
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
    set(DEFAULT_ZIG_OPTIMIZE "Debug")
    set(bun "bun-debug")
elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(DEBUG OFF)
    set(DEFAULT_ZIG_OPTIMIZE "ReleaseFast")

    if(WIN32)
        # lld-link will strip it for you, so we can build directly to bun.exe
        set(bun "bun")

        # TODO(@paperdave): Remove this
        # it is enabled for the time being to make sure to catch more bugs in the experimental windows builds
        set(DEFAULT_ZIG_OPTIMIZE "ReleaseSafe")
    else()
        set(bun "bun-profile")
    endif()
endif()

# --- LLVM ---
# This detection is a little overkill, but it ensures that the set LLVM_VERSION matches under
# any case possible. Sorry for the complexity...
#
# Bun and WebKit must be compiled with the same compiler, so we do as much as we can to ensure that
# the compiler used for the prebuilt WebKit, LLVM 16, is the one that we detect in this process.
#
# It has to be done before project() is called, so that CMake doesnt pick a compiler for us, but even then
# we do some extra work afterwards to double-check, and we will rerun BUN_FIND_LLVM if the compiler did not match.
#
# If the user passes -DLLVM_PREFIX, most of this logic is skipped, but we still warn if invalid.
set(LLVM_VERSION 16)

macro(BUN_FIND_LLVM)
    find_program(
        _LLVM_CXX_PATH
        NAMES clang++-${LLVM_VERSION} clang++
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s clang++ binary. Please pass -DLLVM_PREFIX with the path to LLVM"
    )

    if(NOT _LLVM_CXX_PATH)
        message(FATAL_ERROR "Could not find LLVM ${LLVM_VERSION}, search paths: ${PLATFORM_LLVM_SEARCH_PATHS}")
    endif()

    set(CMAKE_CXX_COMPILER "${_LLVM_CXX_PATH}")
    find_program(
        _LLVM_C_PATH
        NAMES clang-${LLVM_VERSION} clang
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s clang binary. Please pass -DLLVM_PREFIX with the path to LLVM"
    )

    if(NOT _LLVM_C_PATH)
        message(FATAL_ERROR "Could not find LLVM ${LLVM_VERSION}, search paths: ${PLATFORM_LLVM_SEARCH_PATHS}")
    endif()

    set(CMAKE_C_COMPILER "${_LLVM_C_PATH}")

    find_program(
        STRIP
        NAMES llvm-strip
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s llvm-strip binary"
    )
    find_program(
        STRIP
        NAMES strip
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s llvm-strip binary"
    )
    find_program(
        DSYMUTIL
        NAMES dsymutil
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s dsymutil binary"
    )
    find_program(
        AR
        NAMES llvm-ar
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s llvm-ar binary"
    )
    find_program(
        AR
        NAMES ar
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s llvm-ar binary"
    )
    find_program(
        RANLIB
        NAMES llvm-ranlib
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s llvm-ar binary"
    )

    execute_process(COMMAND ${CMAKE_CXX_COMPILER} --version OUTPUT_VARIABLE _tmp)
    string(REGEX MATCH "version ([0-9]+)\\.([0-9]+)\\.([0-9]+)" CMAKE_CXX_COMPILER_VERSION "${_tmp}")
    set(CMAKE_CXX_COMPILER_VERSION "${CMAKE_MATCH_1}.${CMAKE_MATCH_2}.${CMAKE_MATCH_3}")
endmacro()

if(UNIX)
    if(LLVM_PREFIX)
        set(PLATFORM_LLVM_SEARCH_PATHS ${LLVM_PREFIX}/bin)
    else()
        set(PLATFORM_LLVM_SEARCH_PATHS /usr/lib/llvm-${LLVM_VERSION}/bin /usr/lib/llvm${LLVM_VERSION}/bin /usr/bin /usr/local/bin)

        if(APPLE)
            set(PLATFORM_LLVM_SEARCH_PATHS /opt/homebrew/opt/llvm@${LLVM_VERSION}/bin /opt/homebrew/bin ${PLATFORM_LLVM_SEARCH_PATHS})
        endif()
    endif()

    if(CMAKE_CXX_COMPILER)
        set(_LLVM_CXX_PATH "${CMAKE_CXX_COMPILER}")
    endif()

    if(CMAKE_C_COMPILER)
        set(_LLVM_C_PATH "${CMAKE_C_COMPILER}")
    endif()

    BUN_FIND_LLVM()
else()
    # Windows uses Clang-CL
    # TODO: good configuration in this regard. -G Ninja will pick clang-cl if possible, which should be fine for most users.
    if(NOT CMAKE_C_COMPILER)
        set(CMAKE_C_COMPILER "clang-cl")
    endif()

    if(NOT CMAKE_CXX_COMPILER)
        set(CMAKE_CXX_COMPILER "clang-cl")
    endif()

    find_program(
        STRIP
        NAMES llvm-strip
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s llvm-strip binary"
    )
    find_program(
        AR
        NAMES llvm-ar
        PATHS ENV PATH ${PLATFORM_LLVM_SEARCH_PATHS}
        DOC "Path to LLVM ${LLVM_VERSION}'s llvm-ar binary"
    )
endif()

set(CMAKE_COLOR_DIAGNOSTICS ON)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_C_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD_REQUIRED ON)

project(Bun VERSION "${Bun_VERSION}")

# if(MSVC)
# message(FATAL_ERROR "Bun does not support building with MSVC. Please use `cmake -G Ninja` with LLVM ${LLVM_VERSION} and Ninja.")
# endif()

# More effort to prevent using the wrong C++ compiler
if(UNIX)
    if((NOT CMAKE_CXX_COMPILER_ID STREQUAL "Clang") OR(NOT CMAKE_CXX_COMPILER_VERSION MATCHES "^${LLVM_VERSION}\."))
        # Attempt to auto-correct the compiler
        message(STATUS "Compiler mismatch, attempting to auto-correct")
        unset(_LLVM_CXX_PATH)
        BUN_FIND_LLVM()

        if((NOT CMAKE_CXX_COMPILER_ID STREQUAL "Clang") OR(NOT CMAKE_CXX_COMPILER_VERSION MATCHES "^${LLVM_VERSION}\."))
            message(WARNING "Expected LLVM ${LLVM_VERSION} as the C++ compiler, build may fail or break at runtime.")
        endif()
    endif()
endif()

message(STATUS "C++ Compiler: ${CMAKE_CXX_COMPILER_ID} ${CMAKE_CXX_COMPILER_VERSION} at ${CMAKE_CXX_COMPILER}")

# --- End LLVM ---
if(NOT WIN32)
    set(SHELL "bash")
    set(SCRIPT_EXTENSION "sh")
else()
    set(SCRIPT_EXTENSION "ps1")

    # pwsh is the new powershell, powershell is the old one.
    find_program(SHELL NAMES pwsh powershell)
endif()

set(DEFAULT_ON_UNLESS_APPLE ON)

if(APPLE)
    set(DEFAULT_ON_UNLESS_APPLE OFF)
endif()

set(CI OFF)

if(DEFINED ENV{CI} OR DEFINED ENV{GITHUB_ACTIONS})
    set(CI ON)
endif()

set(DEFAULT_USE_STATIC_LIBATOMIC ON)
set(DEFAULT_USE_DEBUG_JSC, OFF)

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(DEFAULT_USE_DEBUG_JSC ON)
endif()

if(WIN32)
    set(DEFAULT_USE_DEBUG_JSC OFF)
endif()

if(UNIX AND NOT APPLE)
    execute_process(COMMAND cat /etc/os-release COMMAND head -n1 OUTPUT_VARIABLE LINUX_DISTRO)

    if(${LINUX_DISTRO} MATCHES "NAME=\"(Arch|Manjaro) Linux\"\n")
        set(DEFAULT_USE_STATIC_LIBATOMIC OFF)
    endif()
endif()

# -- Build Flags --
option(USE_STATIC_SQLITE "Statically link SQLite?" ${DEFAULT_ON_UNLESS_APPLE})
option(USE_CUSTOM_ZLIB "Use Bun's recommended version of zlib" ON)
option(USE_CUSTOM_BORINGSSL "Use Bun's recommended version of BoringSSL" ON)
option(USE_CUSTOM_LIBARCHIVE "Use Bun's recommended version of libarchive" ON)
option(USE_CUSTOM_MIMALLOC "Use Bun's recommended version of Mimalloc" ON)
option(USE_CUSTOM_ZSTD "Use Bun's recommended version of zstd" ON)
option(USE_CUSTOM_CARES "Use Bun's recommended version of c-ares" ON)
option(USE_CUSTOM_BASE64 "Use Bun's recommended version of libbase64" ON)
option(USE_CUSTOM_LOLHTML "Use Bun's recommended version of lolhtml" ON)
option(USE_CUSTOM_TINYCC "Use Bun's recommended version of tinycc" ON)
option(USE_CUSTOM_LIBUV "Use Bun's recommended version of libuv (Windows only)" ON)
option(USE_CUSTOM_LSHPACK "Use Bun's recommended version of ls-hpack" ON)
option(USE_BASELINE_BUILD "Build Bun for baseline (older) CPUs" OFF)

option(USE_VALGRIND "Build Bun with Valgrind support (Linux only)" OFF)

option(ZIG_OPTIMIZE "Optimization level for Zig" ${DEFAULT_ZIG_OPTIMIZE})
option(USE_DEBUG_JSC "Enable assertions and use a debug build of JavaScriptCore" ${DEFAULT_USE_DEBUG_JSC})
option(USE_UNIFIED_SOURCES "Use unified sources to speed up the build" OFF)
option(USE_STATIC_LIBATOMIC "Statically link libatomic, requires the presence of libatomic.a" ${DEFAULT_USE_STATIC_LIBATOMIC})

if(USE_VALGRIND)
    # Disable SIMD
    set(USE_BASELINE_BUILD ON)

    if(ARCH STREQUAL "x86_64")
        # This is for picohttpparser
        # Valgrind cannot handle SSE4.2 instructions
        add_compile_definitions("__SSE4_2__=0")
    endif()
endif()

if(NOT CANARY)
    set(CANARY 0)
endif()

if(NOT ZIG_OPTIMIZE)
    set(ZIG_OPTIMIZE ${DEFAULT_ZIG_OPTIMIZE})
endif()

set(ERROR_LIMIT 100 CACHE STRING "Maximum number of errors to show when compiling C++ code")

set(ARCH x86_64)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64|arm64|arm")
    set(ARCH aarch64)
endif()

if(NOT CPU_TARGET)
    if(DEFINED ENV{CPU_TARGET})
        set(CPU_TARGET $ENV{CPU_TARGET})
    else()
        set(CPU_TARGET "native" CACHE STRING "CPU target for the compiler" FORCE)

        if(ARCH STREQUAL "x86_64")
            if(USE_BASELINE_BUILD)
                set(CPU_TARGET "nehalem")
            else()
                set(CPU_TARGET "haswell")
            endif()
        endif()
    endif()
endif()

message(STATUS "Building for CPU Target: ${CPU_TARGET}")

if(NOT ZIG_TARGET)
    set(ZIG_TARGET "native")

    if(WIN32)
        set(ZIG_TARGET "${ARCH}-windows-msvc")
    endif()
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

if(ZIG_COMPILER)
    if(ZIG_COMPILER STREQUAL "system")
        message(STATUS "Using system Zig compiler")
        unset(ZIG_COMPILER_)
    endif()

    find_program(ZIG_COMPILER_ zig ${REQUIRED_IF_NOT_ONLY_CPP_OR_LINK} DOC "Path to the Zig compiler" VALIDATOR validate_zig)
    set(ZIG_COMPILER "${ZIG_COMPILER_}")
    message(STATUS "Found Zig Compiler: ${ZIG_COMPILER}")
elseif(NOT BUN_CPP_ONLY AND NOT BUN_LINK_ONLY)
    execute_process(
        COMMAND "${SHELL}"
        "${CMAKE_CURRENT_SOURCE_DIR}/scripts/download-zig.${SCRIPT_EXTENSION}"
    )
    set(ZIG_COMPILER "${CMAKE_CURRENT_SOURCE_DIR}/.cache/zig/zig")

    if(WIN32)
        set(ZIG_COMPILER "${ZIG_COMPILER}.exe")
    endif()

    if(NOT EXISTS "${ZIG_COMPILER}")
        unset(ZIG_COMPILER)
        message(FATAL_ERROR "Auto-installation of Zig failed. Please pass -DZIG_COMPILER=system or a path to the Zig")
    endif()

    message(STATUS "Installed Zig Compiler: ${ZIG_COMPILER}")
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "build.zig")
endif()

# Bun
if(NOT WIN32)
    find_program(BUN_EXECUTABLE bun ${REQUIRED_IF_NOT_ONLY_CPP_OR_LINK} DOC "Path to an already built release of Bun")
    message(STATUS "Found Bun: ${BUN_EXECUTABLE}")
else()
    set(BUN_EXECUTABLE "echo")
endif()

# Prettier
find_program(PRETTIER prettier DOC "Path to prettier" PATHS ./node_modules/.bin ENV PATH)

# Esbuild (TODO: switch these to "bun build")
find_program(ESBUILD esbuild DOC "Path to esbuild" PATHS ./node_modules/.bin ENV PATH)

# Ruby (only needed for unified sources)
if(USE_UNIFIED_SOURCES)
    # ruby 'WebKit/Source/WTF/Scripts/generate-unified-source-bundles.rb' source_list.txt --source-tree-path . --derived-sources-path build/unified-sources
    find_program(RUBY ruby DOC "Path to ruby")
endif()

# CCache
find_program(CCACHE_PROGRAM sccache)
find_program(CCACHE_PROGRAM ccache)

if(CCACHE_PROGRAM)
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    message(STATUS "Using ccache: ${CCACHE_PROGRAM}")
endif()

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

if(NOT WEBKIT_DIR)
    set(BUN_WEBKIT_PACKAGE_NAME_SUFFIX "")
    set(ASSERT_ENABLED "0")

    if(USE_DEBUG_JSC)
        add_compile_definitions("BUN_DEBUG=1")
        set(BUN_WEBKIT_PACKAGE_NAME_SUFFIX "-debug")
        set(ASSERT_ENABLED "1")
    elseif(NOT DEBUG AND NOT WIN32)
        set(BUN_WEBKIT_PACKAGE_NAME_SUFFIX "-lto")
        set(ASSERT_ENABLED "0")
    endif()

    if(WIN32)
        set(BUN_WEBKIT_PACKAGE_PLATFORM "windows")
    elseif(APPLE)
        set(BUN_WEBKIT_PACKAGE_PLATFORM "macos")
    else()
        set(BUN_WEBKIT_PACKAGE_PLATFORM "linux")
    endif()

    if(ARCH STREQUAL "x86_64")
        set(BUN_WEBKIT_PACKAGE_ARCH "amd64")
    elseif(ARCH MATCHES "aarch64|arm64|arm")
        set(BUN_WEBKIT_PACKAGE_ARCH "arm64")
    endif()

    set(BUN_WEBKIT_PACKAGE_NAME "bun-webkit-${BUN_WEBKIT_PACKAGE_PLATFORM}-${BUN_WEBKIT_PACKAGE_ARCH}${BUN_WEBKIT_PACKAGE_NAME_SUFFIX}")

    message(STATUS "Using Pre-built WebKit: ${BUN_WEBKIT_PACKAGE_NAME}")
    execute_process(
        COMMAND "${SHELL}"
        "${CMAKE_CURRENT_SOURCE_DIR}/scripts/download-webkit.${SCRIPT_EXTENSION}"
        "${BUN_WORKDIR}/bun-webkit"
        "${WEBKIT_TAG}"
        "${BUN_WEBKIT_PACKAGE_NAME}"
        WORKING_DIRECTORY ${BUN_WORKDIR}
    )

    if(NOT EXISTS "${BUN_WORKDIR}/bun-webkit")
        message(FATAL_ERROR "Prebuilt WebKit package ${BUN_WEBKIT_PACKAGE_NAME} failed to install")
    endif()

    set(WEBKIT_INCLUDE_DIR "${BUN_WORKDIR}/bun-webkit/include")
    set(WEBKIT_LIB_DIR "${BUN_WORKDIR}/bun-webkit/lib")
elseif(WEBKIT_DIR STREQUAL "omit")
    message(STATUS "Not using WebKit. This is only valid if you are only trying to build Zig code")
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

        if(USE_DEBUG_JSC)
            add_compile_definitions("BUN_DEBUG=1")
            set(ASSERT_ENABLED "1")
        endif()
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

        set(ASSERT_ENABLED "0")
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
    set(BUN_DEPS_OUT_DIR "${BUN_DEPS_DIR}")
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
    "${BUN_SRC}/deps/picohttpparser/picohttpparser.c"
)
list(APPEND BUN_RAW_SOURCES ${BUN_CPP})

# -- Brotli --
set(BROTLI_SRC "${CMAKE_CURRENT_SOURCE_DIR}/src/deps/brotli")
file(GLOB BROTLI_FILES ${CONFIGURE_DEPENDS}
    "${BROTLI_SRC}/common/*.c"
    "${BROTLI_SRC}/enc/*.c"
    "${BROTLI_SRC}/dec/*.c"
)
list(APPEND BUN_RAW_SOURCES ${BROTLI_FILES})
include_directories("${BUN_DEPS_DIR}/brotli/include")

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
    COMMAND ${BUN_EXECUTABLE} "${BUN_CODEGEN_SRC}/generate-classes.ts" ${BUN_CLASSES_TS} "${BUN_WORKDIR}/codegen"
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    MAIN_DEPENDENCY "${BUN_CODEGEN_SRC}/generate-classes.ts"
    DEPENDS ${BUN_CLASSES_TS}
    VERBATIM
    COMMENT "Generating *.classes.ts bindings"
)
list(APPEND BUN_RAW_SOURCES "${BUN_WORKDIR}/codegen/ZigGeneratedClasses.cpp")

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
                COMMAND ${BUN_EXECUTABLE} ${BUN_HASH_LUT_GENERATOR} ${_input} ${_output}
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
        COMMAND ${ZIG_COMPILER} run "${BUN_SRC}/js_lexer/identifier_data.zig"
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
        "${BUN_SRC}/js/bun/*.js"
        "${BUN_SRC}/js/bun/*.ts"
        "${BUN_SRC}/js/thirdparty/*.js"
        "${BUN_SRC}/js/thirdparty/*.ts"
        "${BUN_SRC}/js/internal/*.js"
        "${BUN_SRC}/js/internal/*.ts"
    )
    file(GLOB BUN_TS_FUNCTIONS ${CONFIGURE_DEPENDS} "${BUN_SRC}/js/builtins/*.ts")

    file(GLOB CODEGEN_FILES ${CONFIGURE_DEPENDS} "${BUN_CODEGEN_SRC}/*.ts")

    add_custom_command(
        OUTPUT
        "${BUN_WORKDIR}/codegen/InternalModuleRegistryConstants.h"
        "${BUN_WORKDIR}/codegen/InternalModuleRegistry+createInternalModuleById.h"
        "${BUN_WORKDIR}/codegen/InternalModuleRegistry+enum.h"
        "${BUN_WORKDIR}/codegen/InternalModuleRegistry+numberOfModules.h"
        "${BUN_WORKDIR}/codegen/NativeModuleImpl.h"
        "${BUN_WORKDIR}/codegen/ResolvedSourceTag.zig"
        "${BUN_WORKDIR}/codegen/SyntheticModuleType.h"
        COMMAND ${BUN_EXECUTABLE} "${BUN_SRC}/codegen/bundle-modules.ts" "--debug=${DEBUG}" "${BUN_WORKDIR}"
        DEPENDS ${BUN_TS_MODULES} ${CODEGEN_FILES}
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        COMMENT "Bundling JS modules"
    )
endif()

WEBKIT_ADD_SOURCE_DEPENDENCIES(
    "${BUN_SRC}/bun.js/bindings/InternalModuleRegistry.cpp"
    "${BUN_WORKDIR}/codegen/InternalModuleRegistryConstants.h"
)

add_custom_command(
    OUTPUT "${BUN_WORKDIR}/codegen/WebCoreJSBuiltins.cpp"
    "${BUN_WORKDIR}/codegen/WebCoreJSBuiltins.h"
    COMMAND ${BUN_EXECUTABLE} "${BUN_SRC}/codegen/bundle-functions.ts" "--debug=${DEBUG}" "${BUN_WORKDIR}"
    DEPENDS ${BUN_TS_FUNCTIONS} ${CODEGEN_FILES}
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Bundling JS builtin functions"
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
# COMMAND "${ZIG_COMPILER}" "fmt" "src/api/schema.zig"
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
# COMMAND "${ZIG_COMPILER}" "fmt" "${BUN_SRC}/analytics/analytics_schema.zig"
# DEPENDS "${BUN_SRC}/api/schema.peechy"
# COMMENT "Building analytics_schema.zig"
# )
# endif()

# --- Runtime.js ---
if(NOT NO_CODEGEN)
    add_custom_command(
        OUTPUT "src/fallback.out.js"
        WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
        COMMAND "${ESBUILD}" "--target=esnext" "--bundle" "src/fallback.ts" "--format=iife" "--platform=browser" "--minify" "--outfile=src/fallback.out.js"
        DEPENDS "src/fallback.ts"
    )
endif()

# --- Zig Object ---
file(GLOB ZIG_FILES
    "${BUN_SRC}/*.zig"
    "${BUN_SRC}/*/*.zig"
    "${BUN_SRC}/*/*/*.zig"
    "${BUN_SRC}/*/*/*/*.zig"
    "${BUN_SRC}/*/*/*/*/*.zig"
)

if(NOT BUN_ZIG_OBJ)
    set(BUN_ZIG_OBJ "${BUN_WORKDIR}/CMakeFiles/bun-zig.o")
endif()

get_filename_component(BUN_ZIG_OBJ "${BUN_ZIG_OBJ}" REALPATH BASE_DIR "${CMAKE_BINARY_DIR}")

set(USES_TERMINAL_NOT_IN_CI "")

if(NOT CI)
    set(USES_TERMINAL_NOT_IN_CI "USES_TERMINAL")
endif()

if(NOT BUN_LINK_ONLY AND NOT BUN_CPP_ONLY)
    add_custom_command(
        OUTPUT "${BUN_ZIG_OBJ}"
        COMMAND
        "${ZIG_COMPILER}" "build" "obj"
        "-Doutput-file=${BUN_ZIG_OBJ}"
        "-Dgenerated-code=${BUN_WORKDIR}/codegen"
        "-Dversion=${Bun_VERSION}"
        "-Dcanary=${CANARY}"
        "-Doptimize=${ZIG_OPTIMIZE}"
        "-Dcpu=${CPU_TARGET}"
        "-Dtarget=${ZIG_TARGET}"
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
if(CANARY GREATER 0)
    set(Bun_VERSION_WITH_TAG "${Bun_VERSION}-canary.${CANARY}")
else()
    set(Bun_VERSION_WITH_TAG "${Bun_VERSION}")
endif()

if(WIN32)
    set(BUN_ICO_PATH "${BUN_SRC}/bun.ico")
    configure_file("${BUN_SRC}/windows-app-info.rc" "${BUN_WORKDIR}/CMakeFiles/windows-app-info.rc")
    list(APPEND BUN_SOURCES "${BUN_WORKDIR}/CMakeFiles/windows-app-info.rc")
endif()

# -- The Buntime™️ ---
if(NOT BUN_CPP_ONLY)
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
    "BUN_DYNAMIC_JS_LOAD_PATH=\"${BUN_WORKDIR}/js\""
)

if(NOT ASSERT_ENABLED)
    add_compile_definitions("NDEBUG=1")
else()
    add_compile_definitions("ASSERT_ENABLED=1")
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
                "\"${AR}\" rcvs bun-cpp-objects.a \${OBJ_LIST[@]}\n"
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
                "& \"${AR}\" rcvs bun-cpp-objects.a @ObjectFiles\n"
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
        target_compile_options(${bun} PUBLIC -g3 -O0 -gdwarf-4
            -Werror=return-type
            -Werror=return-stack-address
            -Werror=implicit-function-declaration
        )
    else()
        target_compile_options(${bun} PUBLIC /Od)
    endif()

    add_compile_definitions("BUN_DEBUG=1")
elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
    if(NOT WIN32)
        target_compile_options(${bun} PUBLIC -O3 -flto=full -emit-llvm -g1
            -Werror=return-type
            -Werror=return-stack-address
            -Werror=implicit-function-declaration
        )
    else()
        target_compile_options(${bun} PUBLIC /O2 -flto=full)
        target_link_options(${bun} PUBLIC /LTCG)
    endif()
endif()

if(NOT CI AND NOT WIN32)
    target_compile_options(${bun} PRIVATE -fdiagnostics-color=always)
endif()

if(NOT CPU_TARGET STREQUAL "native")
    # passing -march=native to clang will break older systems
    # by default on x64, CPU_TARGET is set to "haswell" or "nehalem" depending on baseline
    # on arm, this argument will not be passed.
    target_compile_options(${bun} PUBLIC "-march=${CPU_TARGET}")
else()
    if(APPLE AND ARCH STREQUAL "aarch64")
        # On arm macOS, we can set it to a minimum of the M1 cpu set. this might be the default already.
        target_compile_options(${bun} PUBLIC "-mcpu=apple-m1")
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

    # set_property(TARGET ${bun} PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreaded")
    set_property(TARGET ${bun} PROPERTY MSVC_RUNTIME_LIBRARY "MultiThreadedDLL")

    target_compile_options(${bun} PUBLIC "/EHsc" "/GR-")
    target_link_options(${bun} PUBLIC "/STACK:0x1200000,0x100000")
else()
    target_compile_options(${bun} PUBLIC
        -fPIC
        -mtune=${CPU_TARGET}
        -fconstexpr-steps=1271242
        -fconstexpr-depth=27
        -fno-exceptions
        -fvisibility=hidden
        -fvisibility-inlines-hidden
        -fno-rtti
        -fno-omit-frame-pointer
    )
    string(APPEND CMAKE_CXX_FLAGS " -std=c++2a")
endif()

if(APPLE)
    if(ARCH STREQUAL "x86_64")
        set(CMAKE_OSX_DEPLOYMENT_TARGET "10.14")
    else()
        set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0")
    endif()

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
        "-fuse-ld=lld"
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
        "-Wl,--wrap=statx"
        "-Wl,--compress-debug-sections=zlib"
        "-Bsymbolics-functions"
        "-rdynamic"
        "-Wl,--dynamic-list=${BUN_SRC}/symbols.dyn"
        "-Wl,--version-script=${BUN_SRC}/linker.lds"
    )

    target_link_libraries(${bun} PRIVATE "c")
    target_link_libraries(${bun} PRIVATE "pthread")
    target_link_libraries(${bun} PRIVATE "dl")

    if(NOT USE_STATIC_LIBATOMIC)
        target_link_libraries(${bun} PUBLIC "libatomic.so")
    else()
        target_link_libraries(${bun} PRIVATE "libatomic.a")
    endif()

    target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libicudata.a")
    target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libicui18n.a")
    target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libicuuc.a")

    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${BUN_SRC}/linker.lds")
    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${BUN_SRC}/symbols.dyn")
endif()

# --- ICU ---
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
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND NOT WIN32 AND NOT ASSERT_ENABLED)
    # add_custom_command(
    # TARGET ${bun}
    # POST_BUILD
    # COMMAND ${DSYMUTIL} -o ${BUN_WORKDIR}/bun.dSYM ${BUN_WORKDIR}/${bun}
    # COMMENT "Stripping Symbols"
    # )
    add_custom_command(
        TARGET ${bun}
        POST_BUILD
        COMMAND ${STRIP} -s -x -S -o ${BUN_WORKDIR}/bun ${BUN_WORKDIR}/${bun}
        COMMENT "Stripping Symbols"
    )
endif()

if(WIN32)
    # Kill all instances of bun before linking.
    add_custom_command(
        TARGET ${bun}
        PRE_BUILD
        COMMAND
        "powershell"
        "/C"
        "Stop-Process -Name '${bun}' -Force -ErrorAction SilentlyContinue; exit 0"
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

if(USE_CUSTOM_MIMALLOC)
    include_directories(${BUN_DEPS_DIR}/mimalloc/include)

    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/mimalloc.lib")
    elseif(APPLE)
        if(USE_DEBUG_JSC OR CMAKE_BUILD_TYPE STREQUAL "Debug")
            message(STATUS "Using debug mimalloc")
            target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libmimalloc-debug.a")
        else()
            # https://github.com/microsoft/mimalloc/issues/512
            # Linking mimalloc via object file on macOS x64 can cause heap corruption
            target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libmimalloc.a")
        endif()
    else()
        if(USE_DEBUG_JSC OR CMAKE_BUILD_TYPE STREQUAL "Debug")
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

if(USE_CUSTOM_BASE64)
    include_directories(${BUN_DEPS_DIR}/base64/include)

    if(WIN32)
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/base64.lib")
    else()
        target_link_libraries(${bun} PRIVATE "${BUN_DEPS_OUT_DIR}/libbase64.a")
    endif()
else()
    find_package(base64 REQUIRED)
    target_link_libraries(${bun} PRIVATE base64::base64)
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
    )
    target_link_libraries(${bun} PRIVATE sqlite3)
    message(STATUS "Using static sqlite3")
    target_compile_definitions(${bun} PRIVATE "LAZY_LOAD_SQLITE=0")
else()
    message(STATUS "Using dynamicly linked sqlite3")
    target_compile_definitions(${bun} PRIVATE "LAZY_LOAD_SQLITE=1")
endif()

if(USE_CUSTOM_LSHPACK)
    if(WIN32)
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
    target_link_libraries(${bun} PRIVATE "${WEBKIT_LIB_DIR}/libbmalloc.a")
else()
    target_link_options(${bun} PRIVATE "-static")
    target_link_libraries(${bun} PRIVATE
        "${WEBKIT_LIB_DIR}/WTF.lib"
        "${WEBKIT_LIB_DIR}/JavaScriptCore.lib"
        "${WEBKIT_LIB_DIR}/sicudt.lib"
        "${WEBKIT_LIB_DIR}/sicuin.lib"
        "${WEBKIT_LIB_DIR}/sicuuc.lib"
        winmm
        bcrypt
        ntdll
        ucrt
        userenv
        dbghelp
        wsock32 # ws2_32 required by TransmitFile aka sendfile on windows
    )
endif()

if(WIN32)
    # delayimp -delayload:shell32.dll -delayload:ole32.dll
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
