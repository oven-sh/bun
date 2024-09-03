cmake_minimum_required(VERSION 3.22)
message(STATUS "Configuring Bun")

list(APPEND CMAKE_MODULE_PATH
  ${CMAKE_SOURCE_DIR}/cmake
  ${CMAKE_SOURCE_DIR}/cmake/targets
  ${CMAKE_SOURCE_DIR}/cmake/tools
  ${CMAKE_SOURCE_DIR}/cmake/analysis
  ${CMAKE_SOURCE_DIR}/cmake/scripts
)

include(Policies)
include(Macros)

# Aliases for common CMake variables.
# These must be set before include(), since they are widely used.
setx(CWD ${CMAKE_SOURCE_DIR})
setx(BUILD_PATH ${CMAKE_BINARY_DIR})
optionx(CACHE_PATH STRING "The path to the cache directory" DEFAULT ${BUILD_PATH}/cache)
optionx(TMP_PATH STRING "The path to the temporary directory" DEFAULT ${BUILD_PATH}/tmp)

# Modules that set CMake variables, such as CMAKE_C_COMPILER must be run before project().
# Otherwise, CMake can select the wrong compiler or flags.
if(APPLE)
  include(SetupMacSDK)
endif()
include(SetupLLVM)
include(SetupCcache)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_C_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# WebKit uses -std=gnu++20 on non-macOS non-Windows.
# If we do not set this, it will crash at startup on the first memory allocation.
if(NOT WIN32 AND NOT APPLE)
  set(CMAKE_CXX_EXTENSIONS ON)
  set(CMAKE_POSITION_INDEPENDENT_CODE FALSE)
endif()

# Workaround for CMake and clang-cl bug.
# https://github.com/ninja-build/ninja/issues/2280
if(WIN32 AND NOT CMAKE_CL_SHOWINCLUDES_PREFIX)
  set(CMAKE_CL_SHOWINCLUDES_PREFIX "Note: including file:")
endif()

project(Bun VERSION 0.0.0)

include(BuildOptions)
include(SetupBuildkite)

if(WIN32)
  if(DEBUG)
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreadedDebug")
  else()
    set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
  endif()
endif()

find_program(BUN_EXECUTABLE bun ${REQUIRED_IF_NOT_ONLY_CPP_OR_LINK} DOC "Path to an already built release of Bun")
message(STATUS "Found Bun: ${BUN_EXECUTABLE}")

if(NOT BUN_CPP_ONLY AND NOT BUN_LINK_ONLY)
  include(SetupZig)
endif()

if(CI)
  include(SetupCI)
endif()

if(WIN32 AND ENABLE_LTO)
  set(CMAKE_LINKER_TYPE LLD)
  set(CMAKE_INTERPROCEDURAL_OPTIMIZATION OFF)
endif()

if(ENABLE_VALGRIND)
  if(ARCH STREQUAL "x64")
    # This is for picohttpparser
    # Valgrind cannot handle SSE4.2 instructions
    add_compile_definitions("__SSE4_2__=0")
  endif()
endif()

set(ERROR_LIMIT 100 CACHE STRING "Maximum number of errors to show when compiling C++ code")

if(NOT CONFIGURE_DEPENDS)
  set(CONFIGURE_DEPENDS "")
else()
  set(CONFIGURE_DEPENDS "CONFIGURE_DEPENDS")
endif()

set(REQUIRED_IF_NOT_ONLY_CPP_OR_LINK "")

if(NOT BUN_CPP_ONLY AND NOT BUN_LINK_ONLY)
    set(REQUIRED_IF_NOT_ONLY_CPP_OR_LINK "REQUIRED")
endif()

set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "build.zig")

# --- WebKit ---
# WebKit is either prebuilt and distributed via NPM, or you can pass WEBKIT_PATH to use a local build.
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

if(DEBUG)
  add_compile_definitions("BUN_DEBUG=1")
endif()

include(SetupWebKit)

if(WEBKIT_PREBUILT)
    set(WEBKIT_INCLUDE_DIR ${WEBKIT_PATH}/include)

    if(APPLE)
        set(ICU_INCLUDE_DIR "")
    else()
        set(ICU_INCLUDE_DIR ${WEBKIT_PATH}/include/wtf/unicode)
    endif()

    set(WEBKIT_LIB_DIR ${WEBKIT_PATH}/lib)
elseif(WEBKIT_PATH STREQUAL "omit")
    # message(STATUS "Not using WebKit. This is only valid if you are only trying to build Zig code")
else()
    # Expected to be WebKit/WebKitBuild/${CMAKE_BUILD_TYPE}
    if(EXISTS "${WEBKIT_PATH}/cmakeconfig.h")
        # You may need to run:
        # make jsc-compile-debug jsc-copy-headers
        include_directories(
            "${WEBKIT_PATH}/"
            "${WEBKIT_PATH}/JavaScriptCore/Headers/JavaScriptCore"
            "${WEBKIT_PATH}/JavaScriptCore/PrivateHeaders"
            "${WEBKIT_PATH}/bmalloc/Headers"
            "${WEBKIT_PATH}/WTF/Headers"
        )
        set(WEBKIT_LIB_DIR "${WEBKIT_PATH}/lib")

        if(ENABLE_ASSERTIONS)
            add_compile_definitions("BUN_DEBUG=1")
        endif()

        message(STATUS "Using WebKit from ${WEBKIT_PATH}")
    else()
        if(NOT EXISTS "${WEBKIT_PATH}/lib/${libWTF}.${STATIC_LIB_EXT}" OR NOT EXISTS "${WEBKIT_PATH}/lib/${libJavaScriptCore}.${STATIC_LIB_EXT}")
            if(WEBKIT_PATH MATCHES "src/bun.js/WebKit$")
                message(FATAL_ERROR "WebKit directory ${WEBKIT_PATH} does not contain all the required files for Bun. Did you forget to init submodules?")
            endif()

            message(FATAL_ERROR "WebKit directory ${WEBKIT_PATH} does not contain all the required files for Bun. Expected a path to the oven-sh/WebKit repository, or a path to a folder containing `include` and `lib`.")
        endif()

        set(WEBKIT_INCLUDE_DIR "${WEBKIT_PATH}/include")
        set(WEBKIT_LIB_DIR "${WEBKIT_PATH}/lib")

        message(STATUS "Using specified WebKit directory: ${WEBKIT_PATH}")
        message(STATUS "WebKit assertions: OFF")
    endif()
endif()

include(BuildBun)

if(WIN32)
  include_directories("${CWD}/src/bun.js/bindings/windows")
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
    "BUN_DYNAMIC_JS_LOAD_PATH=\"${BUILD_PATH}/js\""
    "REPORTED_NODEJS_VERSION=\"${NODEJS_VERSION}\""
    "REPORTED_NODEJS_ABI_VERSION=${NODEJS_ABI_VERSION}"
)

if(ENABLE_ASSERTIONS)
    if(APPLE)
        # add_compile_definitions("_LIBCXX_ENABLE_ASSERTIONS=1")
        # add_compile_definitions("_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_DEBUG")
    elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux")
        add_compile_definitions("_GLIBCXX_ASSERTIONS=1")
    endif()

    add_compile_definitions("ASSERT_ENABLED=1")
else()
    if(APPLE)
        # add_compile_definitions("_LIBCXX_ENABLE_ASSERTIONS=0")
        # add_compile_definitions("_LIBCPP_HARDENING_MODE=_LIBCPP_HARDENING_MODE_NONE")
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
  ${BUILD_PATH}/codegen
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
        if(ENABLE_LTO)
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

        if(ENABLE_LTO)
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

if(NOT CPU STREQUAL "native")
  # passing -march=native to clang will break older systems
  # by default on x64, CPU is set to "haswell" or "nehalem" depending on baseline
  # on arm, this argument will not be passed.
  target_compile_options(${bun} PUBLIC "-march=${CPU}")
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

    target_compile_options(${bun} PUBLIC "/EHsc" "/GR-" "-Xclang" "-fno-c++-static-destructors")

    target_link_options(${bun} PUBLIC "/STACK:0x1200000,0x100000" "/DEF:${CWD}/src/symbols.def" "/errorlimit:0")
else()
    target_compile_options(${bun} PUBLIC
        -mtune=${CPU}
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
        -ffile-prefix-map=${CWD}=.
        -ffile-prefix-map=${BUILD_PATH}=build
        -ffile-prefix-map=${CACHE_PATH}=cache
    )
endif()

if(APPLE)
    target_link_options(${bun} PUBLIC "-dead_strip")
    target_link_options(${bun} PUBLIC "-dead_strip_dylibs")
    target_link_options(${bun} PUBLIC "-Wl,-stack_size,0x1200000")
    target_link_options(${bun} PUBLIC "-exported_symbols_list" "${CWD}/src/symbols.txt")
    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${CWD}/src/symbols.txt")
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
        "-Wl,--dynamic-list=${CWD}/src/symbols.dyn"
        "-Wl,--version-script=${CWD}/src/linker.lds"
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

    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${CWD}/src/linker.lds")
    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${CWD}/src/symbols.dyn")
endif()

# --- ICU ---
if(APPLE)
  target_link_libraries(${bun} PRIVATE "icucore")
endif()

if(NOT WIN32)
  target_link_libraries(${bun} PRIVATE ${WEBKIT_LIB_DIR}/libWTF.a)
  target_link_libraries(${bun} PRIVATE ${WEBKIT_LIB_DIR}/libJavaScriptCore.a)

  if(NOT APPLE OR EXISTS ${WEBKIT_LIB_DIR}/libbmalloc.a)
    target_link_libraries(${bun} PRIVATE ${WEBKIT_LIB_DIR}/libbmalloc.a)
  endif()
else()
  target_link_libraries(${bun} PRIVATE
    ${WEBKIT_LIB_DIR}/WTF.lib
    ${WEBKIT_LIB_DIR}/JavaScriptCore.lib
    ${WEBKIT_LIB_DIR}/sicudt.lib
    ${WEBKIT_LIB_DIR}/sicuin.lib
    ${WEBKIT_LIB_DIR}/sicuuc.lib
    winmm
    bcrypt
    ntdll
    userenv
    dbghelp
    wsock32 # ws2_32 required by TransmitFile aka sendfile on windows
    delayimp.lib
  )
endif()
