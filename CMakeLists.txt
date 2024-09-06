cmake_minimum_required(VERSION 3.24)
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
optionx(CACHE_STRATEGY "read-write|read-only|write-only|none" "The strategy to use for caching" DEFAULT "read-write")
optionx(TMP_PATH STRING "The path to the temporary directory" DEFAULT ${BUILD_PATH}/tmp)

# Modules that set CMake variables, such as CMAKE_C_COMPILER must be run before project().
# Otherwise, CMake can select the wrong compiler or flags.
if(CMAKE_HOST_APPLE)
  include(SetupMacSDK)
endif()
include(SetupLLVM)
include(SetupCcache)

parse_package_json(VERSION_VARIABLE VERSION)
project(Bun VERSION ${VERSION})

include(Options)
include(SetupBuildkite)
include(SetupBun)
include(SetupEsbuild)
include(SetupZig)

set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# WebKit uses -std=gnu++20 on non-macOS non-Windows.
# If we do not set this, it will crash at startup on the first memory allocation.
if(NOT WIN32 AND NOT APPLE)
  set(CMAKE_CXX_EXTENSIONS ON)
  set(CMAKE_POSITION_INDEPENDENT_CODE FALSE)
endif()

if(ENABLE_VALGRIND)
  if(ARCH STREQUAL "x64")
    # This is for picohttpparser
    # Valgrind cannot handle SSE4.2 instructions
    add_compile_definitions("__SSE4_2__=0")
  endif()
endif()

if(NOT CONFIGURE_DEPENDS)
  set(CONFIGURE_DEPENDS "")
else()
  set(CONFIGURE_DEPENDS "CONFIGURE_DEPENDS")
endif()

include(BuildBun)
include(CompilerFlags)

# --- clang and linker flags ---
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    if(NOT WIN32)
        target_compile_options(${bun} PUBLIC
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
        target_compile_options(${bun} PUBLIC /Z7)
    endif()
elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(LTO_FLAG "")

    if(NOT WIN32)
        if(ENABLE_LTO)
            list(APPEND LTO_FLAG "-flto=full" "-emit-llvm" "-fwhole-program-vtables" "-fforce-emit-vtables")
        endif()

        # Leave -Werror=unused off in release builds so we avoid errors from being used in ASSERT
        target_compile_options(${bun} PUBLIC ${LTO_FLAG}
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

    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${CWD}/src/linker.lds")
    set_target_properties(${bun} PROPERTIES LINK_DEPENDS "${CWD}/src/symbols.dyn")
endif()

if(WIN32)
  target_link_libraries(${bun} PRIVATE
    winmm
    bcrypt
    ntdll
    userenv
    dbghelp
    wsock32 # ws2_32 required by TransmitFile aka sendfile on windows
    delayimp.lib
  )
endif()
