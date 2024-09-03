include(Macros)

# clang: https://clang.llvm.org/docs/CommandGuide/clang.html
# clang-cl: https://clang.llvm.org/docs/UsersManual.html#id11

# Generates `compile_commands.json` file in the build directory,
# which is used by tools like clang-tidy and clangd.
setx(CMAKE_EXPORT_COMPILE_COMMANDS ON)

# ???
# setx(CMAKE_CXX_STANDARD 20)
# setx(CMAKE_C_STANDARD 17)
# setx(CMAKE_CXX_STANDARD_REQUIRED ON)
# setx(CMAKE_C_STANDARD_REQUIRED ON)

# Workaround for CMake and clang-cl bug.
# https://github.com/ninja-build/ninja/issues/2280
if(WIN32 AND NOT CMAKE_CL_SHOWINCLUDES_PREFIX)
  setx(CMAKE_CL_SHOWINCLUDES_PREFIX "Note: including file:")
endif()

# WebKit uses -std=gnu++20 on non-macOS non-Windows.
# If we do not set this, it will crash at startup on the first memory allocation.
if(NOT WIN32 AND NOT APPLE)
  setx(CMAKE_CXX_EXTENSIONS ON)
  setx(CMAKE_POSITION_INDEPENDENT_CODE OFF)
endif()

# ???
if(WIN32 AND ENABLE_LTO)
  setx(CMAKE_LINKER_TYPE LLD)
  setx(CMAKE_INTERPROCEDURAL_OPTIMIZATION OFF)
endif()

optionx(ERROR_LIMIT STRING "Maximum number of errors to show when compiling C++ code" DEFAULT "100")
add_compile_options(-ferror-limit=${ERROR_LIMIT})

if(CMAKE_COLOR_DIAGNOSTICS AND NOT WIN32)
  add_compile_options(-fdiagnostics-color=always)
endif()

# --- -march, -mcpu, -mtune ---

# Using -march=native can break older systems, instead use a specific CPU
if(CPU STREQUAL "native")
  if(NOT ARCH STREQUAL "aarch64")
    message(FATAL_ERROR "Architecture does not match CPU: ARCH=${ARCH}, CPU=${CPU}")
  endif()
  if(APPLE)
    add_compile_options(-mcpu=apple-m1)
  else()
    add_compile_options(-march=armv8-a+crc -mtune=ampere1)
  endif()
elseif(CPU)
  add_compile_options(-march=${CPU})
else()
  message(FATAL_ERROR "No CPU specified, please set -DCPU=<string>")
endif()

# --- Compiler definitions ---

# TODO: are all of these variables strictly necessary?
add_compile_definitions(
  _HAS_EXCEPTIONS=0
  LIBUS_USE_OPENSSL=1
  LIBUS_USE_BORINGSSL=1
  WITH_BORINGSSL=1
  STATICALLY_LINKED_WITH_JavaScriptCore=1
  STATICALLY_LINKED_WITH_BMALLOC=1
  BUILDING_WITH_CMAKE=1
  JSC_OBJC_API_ENABLED=0
  BUN_SINGLE_THREADED_PER_VM_ENTRY_SCOPE=1
  NAPI_EXPERIMENTAL=ON
  NOMINMAX
  IS_BUILD
  BUILDING_JSCONLY__
  BUN_DYNAMIC_JS_LOAD_PATH=\"${BUILD_PATH}/js\"
  REPORTED_NODEJS_VERSION=\"${NODEJS_VERSION}\"
  REPORTED_NODEJS_ABI_VERSION=${NODEJS_ABI_VERSION}
)

if(WIN32)
  add_compile_definitions(
    WIN32
    _WINDOWS
    WIN32_LEAN_AND_MEAN=1
    _CRT_SECURE_NO_WARNINGS
    BORINGSSL_NO_CXX=1 # lol
  )
endif()

if(APPLE)
  add_compile_definitions(__DARWIN_NON_CANCELABLE=1)
endif()

if(DEBUG)
  add_compile_definitions(BUN_DEBUG=1)
endif()

# Valgrind cannot handle SSE4.2 instructions, for picohttpparser
if(ENABLE_VALGRIND AND ARCH STREQUAL "x64")
  add_compile_definitions(__SSE4_2__=0)
endif()

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

# --- Linker options ---

# To support older glibc versions, we need to wrap some functions
if(LINUX)
  target_link_options(${bun} PUBLIC
    --wrap=fcntl
    --wrap=fcntl64
    --wrap=stat64
    --wrap=pow
    --wrap=exp
    --wrap=expf
    --wrap=log
    --wrap=log2
    --wrap=lstat
    --wrap=stat64
    --wrap=stat
    --wrap=fstat
    --wrap=fstatat
    --wrap=lstat64
    --wrap=fstat64
    --wrap=fstatat64
    --wrap=mknod
    --wrap=mknodat
    --wrap=statx
    --wrap=fmod
  )
endif()

# --- symbols.{txt,def,dyn} ---

if(APPLE)
  set(BUN_SYMBOLS_PATH ${CWD}/src/symbols.txt)
  target_link_options(${bun} PUBLIC -exported_symbols_list ${BUN_SYMBOLS_PATH})
elseif(WIN32)
  set(BUN_SYMBOLS_PATH ${CWD}/src/symbols.def)
  target_link_options(${bun} PUBLIC -DEF:${BUN_SYMBOLS_PATH})
else()
  set(BUN_SYMBOLS_PATH ${CWD}/src/symbols.dyn)
  target_link_options(${bun} PUBLIC --dynamic-list=${BUN_SYMBOLS_PATH})
endif()

set_target_properties(${bun} PROPERTIES LINK_DEPENDS ${BUN_SYMBOLS_PATH})

# --- linker.lds ---

# TODO: why is this only done on Linux?
if(LINUX)
  set(BUN_LDS_PATH ${CWD}/src/linker.lds)
  target_link_options(${bun} PUBLIC --version-script=${BUN_LDS_PATH})
  set_target_properties(${bun} PROPERTIES LINK_DEPENDS ${BUN_LDS_PATH})
endif()

# --- Warnings ---

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
    -Wno-nullability-completeness
    -Werror
  )
  # Leave -Werror=unused off in release builds so we avoid errors from being used in ASSERT
  if(DEBUG)
    target_compile_options(${bun} PUBLIC
      -Werror=unused
      -Wno-unused-function
    )
  endif()
endif()

# --- MSVC runtime library ---

if(WIN32)
  if(DEBUG)
    add_compile_options(/MTd) # Use static debug run-time
  else()
    add_compile_options(/MT) # Use static run-time
  endif()
endif()

# --- Link-time optimization (LTO) ---

if(ENABLE_LTO)
  if(WIN32)
    target_compile_options(${bun} PUBLIC
      -Xclang
      -emit-llvm-bc
      -flto=full
    )
  else()
    target_compile_options(${bun} PUBLIC
      -flto=full
      -emit-llvm
      -fwhole-program-vtables
      -fforce-emit-vtables
    )
  endif()
endif()

# --- Optimization level ---

if(DEBUG)
  if(WIN32)
    add_compile_options(/O0)
  else()
    add_compile_options(-O0)
  endif()
elseif(ENABLE_SMOL)
  if(WIN32)
    add_compile_options(/Os)
  else()
    add_compile_options(-Os)
  endif()
else()
  if(WIN32)
    # TODO: change to /03 to match macOS and Linux?
    add_compile_options(/O2)
  else()
    add_compile_options(-O3)
  endif()
endif()

# --- Debug symbols ---

if(DEBUG OR ENABLE_ASSERTIONS)
  if(WIN32)
    add_compile_options(
      /Z7 # Emit debug info
    )
  else()
    add_compile_options(
      -g # Emit debug information
      -fstandalone-debug # Emit debug info for non-system libraries
      -fdebug-macro # Emit debug info for macros
      -fno-eliminate-unused-debug-types # Don't eliminate unused debug types
      -glldb # Tune the debugger for lldb
      -gcolumn-info # Emit column numbers in debug info
    )
    if(APPLE)
      add_compile_options(
        -gdwarf-4 # Produce DWARF v4 debug info
      )
    endif()
  endif()
endif()

# --- Sanitizers ---

if(ENABLE_ASSERTIONS)
  if(WIN32)
    # TODO
  else()
    target_compile_options(${bun} PUBLIC
      -fsanitize=null
      -fsanitize=nullability-arg
      -fsanitize=nullability-assign
      -fsanitize=nullability-return
      -fsanitize-recover=all
      -fsanitize=bounds
      -fsanitize=return
      -fsanitize=returns-nonnull-attribute
      -fsanitize=unreachable
    )
  endif()
endif()

# --- Code coverage ---

if(DEBUG OR ENABLE_ASSERTIONS)
  if(WIN32)
    # TODO
  else()
    add_compile_options(
      -fprofile-instr-generate
      -fcoverage-mapping
    )
  endif()
endif()

if(CMAKE_BUILD_TYPE STREQUAL "Debug")

elseif(CMAKE_BUILD_TYPE STREQUAL "Release")
    set(LTO_FLAG "")

    if(NOT WIN32)
        if(ENABLE_LTO)
            list(APPEND LTO_FLAG "-flto=full" "-emit-llvm" "-fwhole-program-vtables" "-fforce-emit-vtables")
        endif()
        target_compile_options(${bun} PUBLIC -O3 ${LTO_FLAG} -g1)
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
        )
    endif()
endif()

if(WIN32 AND RELEASE)
  target_link_options(${bun} PUBLIC
    /delayload:ole32.dll
    /delayload:WINMM.dll
    /delayload:dbghelp.dll
    /delayload:VCRUNTIME140_1.dll
    # libuv loads these two immediately,
    # but for some reason it seems to still be slightly faster to delayload them
    /delayload:WS2_32.dll
    /delayload:WSOCK32.dll
    /delayload:ADVAPI32.dll
    /delayload:IPHLPAPI.dll
  )
endif()


if(APPLE)
  target_link_options(${bun} PUBLIC "-dead_strip")
  target_link_options(${bun} PUBLIC "-dead_strip_dylibs")
  target_link_options(${bun} PUBLIC "-Wl,-stack_size,0x1200000")
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
    "-Wl,--compress-debug-sections=zlib"
    "-Bsymbolics-functions"
    "-rdynamic"
    -Wl,-z,lazy
    -Wl,-z,norelro
  )

  target_link_libraries(${bun} PRIVATE "c")
  target_link_libraries(${bun} PRIVATE "pthread")
  target_link_libraries(${bun} PRIVATE "dl")
endif()
