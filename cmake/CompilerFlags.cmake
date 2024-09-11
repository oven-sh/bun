include(Macros)

# clang: https://clang.llvm.org/docs/CommandGuide/clang.html
# clang-cl: https://clang.llvm.org/docs/UsersManual.html#id11

# --- MSVC runtime ---

if(WIN32)
  if(DEBUG)
    add_compile_options(/MTd) # Use static debug run-time
  else()
    add_compile_options(/MT) # Use static run-time
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
    # TODO: change to /0t (same as -O3) to match macOS and Linux?
    add_compile_options(/O2)
  else()
    add_compile_options(-O3)
  endif()
endif()

# --- Debug symbols ---

if(WIN32)
  add_compile_options(
    /Z7 # Produce a .pdb file
  )
else()
  add_compile_options(
    -ggdb     # Produce a format that is compatable with GDB
    -gdwarf-4 # Produce DWARF v4 debug info
  )
  if(DEBUG)
    add_compile_options(-g3)
  else()
    add_compile_options(-g1)
  endif()
endif()

# TODO: consider other debug options
# -fdebug-macro # Emit debug info for macros
# -fstandalone-debug # Emit debug info for non-system libraries
# -fno-eliminate-unused-debug-types # Don't eliminate unused debug symbols

# --- RTTI ---

if(WIN32)
  add_compile_options(/GR-)
else()
  add_compile_options(-fno-rtti)
endif()

# --- CPU target (-march, -mtune, -mcpu) ---

# Using -march=native can break older systems, instead use a specific CPU
if(CPU STREQUAL "native")
  if(ARCH STREQUAL "aarch64")
    if(APPLE)
      add_compile_options(-mcpu=apple-m1)
    else()
      add_compile_options(-march=armv8-a+crc -mtune=ampere1)
    endif()
  endif()
elseif(CPU)
  add_compile_options(-march=${CPU} -mtune=${CPU})
else()
  message(FATAL_ERROR "No CPU specified, please set -DCPU=<string>")
endif()

# --- Diagnostics ---

if(NOT WIN32)
  add_compile_options(-fdiagnostics-color=always)
endif()

add_compile_options(-ferror-limit=${ERROR_LIMIT})

# --- Remapping ---

if(NOT WIN32)
  add_compile_options(
    -ffile-prefix-map=${CWD}=.
    -ffile-prefix-map=${BUILD_PATH}=build
    -ffile-prefix-map=${CACHE_PATH}=cache
  )
endif()

# --- Features ---

# Valgrind cannot handle SSE4.2 instructions
# This is needed for picohttpparser
if(ENABLE_VALGRIND AND ARCH STREQUAL "x64")
  add_compile_definitions("__SSE4_2__=0")
endif()

# --- Other ---

# Workaround for CMake and clang-cl bug.
# https://github.com/ninja-build/ninja/issues/2280
if(WIN32 AND NOT CMAKE_CL_SHOWINCLUDES_PREFIX)
  set(CMAKE_CL_SHOWINCLUDES_PREFIX "Note: including file:")
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

# WebKit uses -std=gnu++20 on non-macOS non-Windows.
# If we do not set this, it will crash at startup on the first memory allocation.
if(NOT WIN32 AND NOT APPLE)
  set(CMAKE_CXX_EXTENSIONS ON)
  set(CMAKE_POSITION_INDEPENDENT_CODE OFF)
endif()

