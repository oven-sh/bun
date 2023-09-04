cmake_minimum_required(VERSION 3.25)
cmake_policy(SET CMP0091 NEW)

project(bun)

set(DEFAULT_USE_STATIC_SQLITE ON)

if(APPLE)
    set(DEFAULT_USE_STATIC_SQLITE OFF)
endif()

set(DEFAULT_ZIG_EXECUTABLE "zig")
if (DEFINED ENV{ZIG})
    set(DEFAULT_ZIG_EXECUTABLE $ENV{ZIG})
endif()

set(DEFAULT_BUN_EXECUTABLE "bun")
if (DEFINED ENV{BUN})
    set(DEFAULT_BUN_EXECUTABLE $ENV{BUN})
endif()

set(DEFAULT_CPU_TARGET "native")

add_compile_definitions("JSC_OBJC_API_ENABLED=0")

if (ARCH STREQUAL "x86_64")
    if (NOT MSVC)
        if (USE_BASELINE_BUILD)
            set(DEFAULT_CPU_TARGET "nehalem")
        else ()
            set(DEFAULT_CPU_TARGET "haswell")
        endif()
    endif()
endif()

# Check for environment variable
if (DEFINED ENV{CPU_TARGET})
    set(DEFAULT_CPU_TARGET $ENV{CPU_TARGET})
endif()


set(DEFAULT_CUSTOM_UNLESS_WINDOWS ON)

if (WIN32)
    set(DEFAULT_CUSTOM_UNLESS_WINDOWS OFF)
endif()

option(USE_STATIC_SQLITE "Statically link SQLite?" DEFAULT_USE_STATIC_SQLITE)
option(USE_CUSTOM_ZLIB "Use Bun's recommended version of zlib" DEFAULT_CUSTOM_UNLESS_WINDOWS)
option(USE_CUSTOM_BORINGSSL "Use Bun's recommended version of BoringSSL" ON)
option(USE_CUSTOM_LIBARCHIVE "Use Bun's recommended version of libarchive" ON)
option(USE_CUSTOM_MIMALLOC "Use Bun's recommended version of Mimalloc" ON)
option(USE_CUSTOM_ZSTD "Use Bun's recommended version of zstd`" ON)
option(USE_CUSTOM_CARES "Use Bun's recommended version of c-ares" DEFAULT_CUSTOM_UNLESS_WINDOWS)
option(USE_CUSTOM_BASE64 "Use Bun's recommended version of libbase64" ON)
option(USE_CUSTOM_LOLHTML "Use Bun's recommended version of lolhtml" ON)
option(USE_CUSTOM_TINYCC "Use Bun's recommended version of tinycc" ON)
option(USE_CUSTOM_LIBUV "Use Bun's recommended version of libuv (Windows only)" OFF)
option(USE_BASELINE_BUILD "Build Bun for older CPUs" OFF)

set(ZIG_EXECUTABLE "${DEFAULT_ZIG_EXECUTABLE}" CACHE STRING "Path to zig executable")
set(BUN_EXECUTABLE "${DEFAULT_BUN_EXECUTABLE}" CACHE STRING "Path to bun executable")

set(WEBKIT_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/bun-webkit/lib" CACHE STRING "WebKit lib folder")
set(WEBKIT_INCLUDE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/bun-webkit/include" CACHE STRING "WebKit include folder")
set(BUN_DEPS_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/deps" CACHE STRING "Directory holding submodules" )
set(BUN_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/src/deps" CACHE STRING "Directory holding static libraries" )

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_C_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD_REQUIRED ON)

set(HOMEBREW_PREFIX /usr/local)
set(ARCH x86_64)
set(LINUX OFF)

if(UNIX AND NOT APPLE)
    set(LINUX ON)
endif()


add_compile_definitions("BUILDING_JSCONLY__")



add_definitions(-D_HAS_EXCEPTIONS=0)

find_program(CCACHE_PROGRAM ccache)
if(CCACHE_PROGRAM)
    set(CMAKE_CXX_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    set(CMAKE_C_COMPILER_LAUNCHER "${CCACHE_PROGRAM}")
    message(STATUS "Using ccache")
endif()

file(GLOB bun_SRC 
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

file(GLOB uSockets_FILES
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/*.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/eventing/*.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/internal/*.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/crypto/*.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/packages/bun-usockets/src/crypto/*.cpp"
)

add_compile_definitions(
    "LIBUS_USE_OPENSSL=1"
    "UWS_HTTPRESPONSE_NO_WRITEMARK=1"
    "LIBUS_USE_BORINGSSL=1"
    "WITH_BORINGSSL=1"
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
)


add_compile_definitions(
    "STATICALLY_LINKED_WITH_JavaScriptCore=1"
    "STATICALLY_LINKED_WITH_WTF=1"
    "STATICALLY_LINKED_WITH_BMALLOC=1"
    "BUILDING_WITH_CMAKE=1"
    "BUN_SINGLE_THREADED_PER_VM_ENTRY_SCOPE=1"
    "NAPI_EXPERIMENTAL=ON"
    "NDEBUG=1"
    "NOMINMAX"
    "IS_BUILD"
    "BUILDING_JSCONLY__"
    "ASSERT_ENABLED=0"
)

# If arm64
if (CMAKE_SYSTEM_PROCESSOR MATCHES "aarch64" OR CMAKE_SYSTEM_PROCESSOR MATCHES "arm64" OR CMAKE_SYSTEM_PROCESSOR MATCHES "arm")
    set(ARCH arm64)
endif()

if (ARCH STREQUAL "arm64" AND APPLE)
    set(HOMEBREW_PREFIX /opt/homebrew)
endif()

set(BUN_OBJECT_FILE zig-out/lib/bun.o)
if (CMAKE_BUILD_TYPE STREQUAL "Debug")
    set(BUN_OBJECT_FILE zig-out/lib/bun-debug.o)
    if (NOT MSVC)
        string(APPEND CMAKE_CXX_FLAGS " -g3 -O1")
        string(APPEND CMAKE_C_FLAGS " -g3 -O1")
    else()
        string(APPEND CMAKE_CXX_FLAGS " /O1 ")
        string(APPEND CMAKE_C_FLAGS " /O1  ")
    endif()
    add_compile_definitions("BUN_DEBUG")
elseif (NOT MSVC)
    string(APPEND CMAKE_CXX_FLAGS " -O3 -femit-llvm " )
    string(APPEND CMAKE_C_FLAGS " -O3 -femit-llvm ")
else ()
    string(APPEND CMAKE_CXX_FLAGS " /O2 " )
    string(APPEND CMAKE_C_FLAGS " /O2 ")
endif()
set(EXTRA_SRC "")
if (WIN32)
    set(EXTRA_SRC "${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings/musl-memmem.c")
    add_compile_definitions("WIN32")
    add_compile_definitions("_WINDOWS")
    add_compile_definitions("_CRT_SECURE_NO_WARNINGS")
    add_compile_definitions("WIN32_LEAN_AND_MEAN=1")
endif()

# if clang
if (CMAKE_CXX_COMPILER_ID STREQUAL "Clang")
    string(APPEND CMAKE_CXX_FLAGS "  -fconstexpr-steps=1271242 -fconstexpr-depth=27 ")
    string(APPEND CMAKE_CXX_FLAGS
        "-fno-exceptions "
        "-fno-rtti "
        "-ferror-limit=100 "
        "-fvisibility=hidden "
        "-fvisibility-inlines-hidden "
    )
    string(APPEND CMAKE_C_FLAGS
        "-ferror-limit=100 "
        "-fvisibility=hidden "
        "-fvisibility-inlines-hidden "
    )
elseif(MSVC)
    string(APPEND SUPPRESS_WARNING_NUMBERS
        # JSC deletes operator delete to prevent accidental use
        "/wd4291 "
        # we use #pragma mark in some places
        "/wd4068 "
    )
    string(APPEND CMAKE_CXX_FLAGS " /EHsc /GR-  ")
    string(APPEND CMAKE_C_FLAGS " /EHsc /GR- /MP  ${SUPPRESS_WARNING_NUMBERS} /experimental:c11atomics /std:c17 ")
    string(APPEND CMAKE_CXX_FLAGS " /Zc:__cplusplus /Zc:inline /bigobj /MP ${SUPPRESS_WARNING_NUMBERS} ")
endif()


if (APPLE)
    string(APPEND CMAKE_LINKER_FLAGS " -fno-keep-static-consts -Wl,-dead_strip -Wl,-dead_strip_dylibs ")
    string(APPEND CMAKE_CXX_FLAGS " -stdlib=libc++")
    string(APPEND CMAKE_CXX_FLAGS " -mmacosx-version-min=11")
    string(APPEND CMAKE_C_FLAGS " -mmacosx-version-min=11")
endif()

SET(CPU_TARGET "${DEFAULT_CPU_TARGET}" CACHE STRING "CPU target")

if (NOT MSVC)
    string(APPEND CMAKE_CXX_FLAGS " -march=${CPU_TARGET} -mtune=${CPU_TARGET} ")
    string(APPEND CMAKE_C_FLAGS " -march=${CPU_TARGET} -mtune=${CPU_TARGET} ")
else()
    # string(APPEND CMAKE_CXX_FLAGS " /arch:x64 ")
    # string(APPEND CMAKE_C_FLAGS " /arch:x64 ")
endif()

file(GLOB ZIG_FILES 
    "src/*.zig"
    "src/*/*.zig"
    "src/*/*/*.zig"
    "src/*/*/*/*.zig"
    "src/*/*/*/*/*.zig")

set(IDENTIFIER_CACHE_FILES 
    "${CMAKE_CURRENT_SOURCE_DIR}/src/js_lexer/id_continue_bitset.blob" 
    "${CMAKE_CURRENT_SOURCE_DIR}/src/js_lexer/id_continue_bitset.meta.blob" 
    "${CMAKE_CURRENT_SOURCE_DIR}/src/js_lexer/id_start_bitset.blob"
    "${CMAKE_CURRENT_SOURCE_DIR}/src/js_lexer/id_start_bitset.meta.blob")


add_custom_command(
    OUTPUT ${BUN_OBJECT_FILE}
    COMMAND "${ZIG_EXECUTABLE}" build obj -Doptimize=${CMAKE_BUILD_TYPE} -Doutput-dir=${CMAKE_CURRENT_SOURCE_DIR}/zig-out/lib -Dcpu=${CPU_TARGET}
    DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/build.zig ${ZIG_FILES}
    WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
    COMMENT "Building zig code"
    VERBATIM
)


# add_custom_command(
#     TARGET bun
#     COMMAND bun ./codegen/index.ts
#     DEPENDS src/js/modules/**/*.{js,ts}
#     COMMENT "Running bun codegen"
# )




add_executable(bun WIN32 ${bun_SRC} ${uSockets_FILES} ${BUN_OBJECT_FILE} ${EXTRA_SRC})
# Set /subsystem:console on bun for windows

if (WIN32)
    set_target_properties(bun PROPERTIES LINK_FLAGS " /SUBSYSTEM:CONSOLE ")
endif()


set_target_properties(bun PROPERTIES
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
    target_link_libraries(bun PRIVATE "${HOMEBREW_PREFIX}/opt/libiconv/lib/libiconv.a")
    target_link_libraries(bun PRIVATE "resolv")
    target_link_libraries(bun PRIVATE "stdc++")
    target_link_libraries(bun PRIVATE "${HOMEBREW_PREFIX}/opt/icu4c/lib/libicudata.a")
    target_link_libraries(bun PRIVATE "${HOMEBREW_PREFIX}/opt/icu4c/lib/libicui18n.a")
    target_link_libraries(bun PRIVATE "${HOMEBREW_PREFIX}/opt/icu4c/lib/libicuuc.a")
    target_link_libraries(bun PRIVATE "icucore")
elseif (LINUX)
    string(APPEND CMAKE_CXX_FLAGS " -static-libstdc++ -static-libgcc -fno-omit-frame-pointer")
    string(APPEND CMAKE_C_FLAGS " -static-libgcc -fno-omit-frame-pointer")
    target_link_libraries(bun PRIVATE "c")
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
    target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libz.a")
    include_directories(${BUN_DEPS_DIR}/zlib/include)
else ()
    find_package(ZLIB REQUIRED)
    target_link_libraries(bun PRIVATE ZLIB::ZLIB)
endif ()

if (USE_CUSTOM_BORINGSSL)
    include_directories(src/deps/boringssl/include)
    if (WIN32)
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/crypto.lib")
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/ssl.lib")
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/decrepit.lib")
    else()
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libcrypto.a")
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libssl.a")
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libdecrepit.a")
    endif()
else ()
    include(FindBoringSSL)
    FindBoringSSL(bun)
endif()

if (USE_CUSTOM_LIBARCHIVE)
    include_directories(src/deps/libarchive/include)
    if (WIN32)
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/archive.lib")
    else()
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libarchive.a")
    endif()
else ()
    find_package(LibArchive REQUIRED)
    target_link_libraries(bun PRIVATE LibArchive::LibArchive)
endif()

if (USE_CUSTOM_MIMALLOC)
    include_directories(src/deps/mimalloc/include)
    if (WIN32)
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/mimalloc-static.lib")
    else()
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libmimalloc.a")
    endif()
else ()
    find_package(mimalloc REQUIRED)
    target_link_libraries(bun PRIVATE mimalloc)
endif()

if (USE_CUSTOM_ZSTD)
    include_directories(src/deps/zstd/include)
    if (WIN32)
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/zstd.lib")
    else()
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libzstd.a")
    endif()
else ()
    find_package(zstd CONFIG REQUIRED)
    target_link_libraries(bun PRIVATE zstd::libzstd)
endif()

if (USE_CUSTOM_CARES)
    include_directories(src/deps/zstd/include)
    if (WIN32)
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/cares.lib")
    else()
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libcares.a")
    endif()
else ()
    find_package(c-ares CONFIG REQUIRED)
    target_link_libraries(bun PRIVATE c-ares::cares)
endif()


if (USE_CUSTOM_BASE64)
    include_directories(src/deps/base64/include)
    if (WIN32)
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/base64.lib")
    else()
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libbase64.a")
    endif()
else ()
    find_package(base64 REQUIRED)
    target_link_libraries(bun PRIVATE base64::base64)
endif()

if (NOT WIN32)
    if (USE_CUSTOM_TINYCC)
        if (WIN32)
            target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/tcc.lib")
        else()
            target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/libtcc.a")
        endif()
    else ()
        find_package(tinycc REQUIRED)
        target_link_libraries(bun PRIVATE tinycc::tinycc)
    endif()
endif()

set_property(TARGET bun PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreadedDLL"
)

if (USE_CUSTOM_LOLHTML)
    if (WIN32)
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/lolhtml.lib")
    else()
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/liblolhtml.a")
    endif()
else ()
    find_package(lolhtml REQUIRED)
    target_link_libraries(bun PRIVATE lolhtml::lolhtml)
endif()

if (WIN32)
    if (USE_CUSTOM_LIBUV)
        target_link_libraries(bun PRIVATE "${BUN_LIB_DIR}/uv.lib")
    else ()
        find_package(libuv CONFIG REQUIRED )
        target_link_libraries(bun PRIVATE $<IF:$<TARGET_EXISTS:libuv::uv_a>,libuv::uv_a,libuv::uv>)
    endif()

endif()

if (USE_STATIC_SQLITE)
    add_library(sqlite3 STATIC src/bun.js/bindings/sqlite/sqlite3.c)
    target_include_directories(sqlite3 PUBLIC src/bun.js/bindings/sqlite)
    target_link_libraries(bun PRIVATE sqlite3)
    target_compile_definitions(bun PRIVATE "LAZY_LOAD_SQLITE=0")
else()
    target_compile_definitions(bun PRIVATE "LAZY_LOAD_SQLITE=1")
endif()


if (NOT MSVC)
    string(APPEND CMAKE_CXX_FLAGS " -fPIC ")
endif()


if (NOT MSVC)
    target_link_libraries(bun PRIVATE "${WEBKIT_LIB_DIR}/libWTF.a")
    target_link_libraries(bun PRIVATE "${WEBKIT_LIB_DIR}/libJavaScriptCore.a")
    target_link_libraries(bun PRIVATE "${WEBKIT_LIB_DIR}/libbmalloc.a")
else()

    target_link_libraries(bun PRIVATE "${WEBKIT_LIB_DIR}/WTF.lib")
    target_link_libraries(bun PRIVATE "${WEBKIT_LIB_DIR}/JavaScriptCore.lib")

    if (WIN32)
        string (APPEND CMAKE_CXX_FLAGS 
            " /external:anglebrackets /Gs- /Zi "
        )

        string (APPEND CMAKE_FLAGS 
            " /external:anglebrackets /Gs- /Zi "
        )
        set_target_properties(bun PROPERTIES LINK_FLAGS " /SUBSYSTEM:CONSOLE /STACK:4194304,2097152 ")
    endif()
    
    if (DEFINED ENV{VCPKG_ROOT})
        include_directories($ENV{VCPKG_ROOT}/installed/x64-windows/include)
    endif()

    # include_directories(C:/Users/windo/Build/WebKit/WebKitBuild/WTF/DerivedSources)
    # include_directories(C:/Users/windo/Build/WebKit/WebKitBuild/WTF/Headers)
    file(COPY C:/Users/windo/Code/WebKit/WebKitBuild/cmakeconfig.h DESTINATION ${CMAKE_CURRENT_SOURCE_DIR}/src/bun.js/bindings)  
    

    include_directories(C:/Users/windo/Code/WebKit/WebKitLibraries/win/include)
    link_directories(C:/Users/windo/Code/WebKit/WebKitLibraries/win/lib64)
    target_link_directories(bun PUBLIC ${ICU_LIBRARY})
    
    
    target_link_libraries(bun PUBLIC icuuc icudt icutu icuio icuin icutest)
    target_link_libraries(bun PUBLIC winmm ws2_32 bcrypt ntdll kernel32 shell32 shlwapi advapi32 vcruntime ucrt legacy_stdio_definitions)
endif()



