cmake_minimum_required(VERSION 3.22)
cmake_policy(SET CMP0091 NEW)
cmake_policy(SET CMP0067 NEW)

set(CMAKE_POLICY_DEFAULT_CMP0069 NEW)
set(Bun_VERSION "1.1.27")
set(WEBKIT_TAG 147ed53838e21525677492c27099567a6cd19c6b)

set(CI OFF)
if(ENV{CI} MATCHES "^(1|true)$")
  set(CI ON)
endif()

set(CWD ${CMAKE_SOURCE_DIR})
set(BUILD_PATH ${CMAKE_BINARY_DIR})
set(CACHE_PATH ${CWD}/.cache)

set(BUN_WORKDIR "${CMAKE_CURRENT_BINARY_DIR}")
message(STATUS "Configuring Bun ${Bun_VERSION} in ${BUN_WORKDIR}")

set(CMAKE_ARGS "")
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

include(cmake/SetupGenerator.cmake)
include(cmake/Options.cmake)

find_program(BUN_EXECUTABLE bun ${REQUIRED_IF_NOT_ONLY_CPP_OR_LINK} DOC "Path to an already built release of Bun")
message(STATUS "Found Bun: ${BUN_EXECUTABLE}")

if(NOT BUN_CPP_ONLY AND NOT BUN_LINK_ONLY)
    include(cmake/SetupZig.cmake)
endif()

if(NOT BUN_LINK_ONLY)
    include(cmake/BuildBunCodegen.cmake)
endif()

if(CI)
    include(cmake/SetupCI.cmake)
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

# --- BUILD ---
set(BUN_SRC "${CMAKE_CURRENT_SOURCE_DIR}/src")
set(BUN_DEPS_DIR "${BUN_SRC}/deps")
set(BUN_CODEGEN_SRC "${BUN_SRC}/codegen")

if(NOT BUN_DEPS_OUT_DIR)
    set(BUN_DEPS_OUT_DIR "${CMAKE_CURRENT_SOURCE_DIR}/build/bun-deps")
endif()

# --- Zig Object ---
if(NOT BUN_CPP_ONLY AND NOT BUN_LINK_ONLY)
  include(cmake/BuildBunZig.cmake)
endif()

include(cmake/BuildBun.cmake)

if(WIN32)
    include_directories("${BUN_SRC}/bun.js/bindings/windows")
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
if(BUN_CPP_ARCHIVE)
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
    # TODO: look at -fconstexpr-steps=2542484 -fconstexpr-depth=54
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
if(CMAKE_BUILD_TYPE STREQUAL "Release" AND NOT WIN32 AND NOT ASSERT_ENABLED AND NOT BUN_CPP_ONLY)
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

include(cmake/BuildBrotli.cmake)
include(cmake/BuildBoringSSL.cmake)
include(cmake/BuildCares.cmake)
include(cmake/BuildLibArchive.cmake)
include(cmake/BuildLibDeflate.cmake)
include(cmake/BuildLshpack.cmake)

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