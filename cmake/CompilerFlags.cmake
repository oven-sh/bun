include(Macros)

# clang: https://clang.llvm.org/docs/CommandGuide/clang.html
# clang-cl: https://clang.llvm.org/docs/UsersManual.html#id11

if(WIN32)
  if(DEBUG)
    add_compile_options(/MTd) # Use static debug run-time
  else()
    add_compile_options(/MT) # Use static run-time
  endif()
endif()

# if(WIN32)
#   if(DEBUG)
#     set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreadedDebug")
#   else()
#     set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
#   endif()
# endif()

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

if(NOT WIN32)
  add_compile_options(-fdiagnostics-color=always)
endif()

# if(NOT CI AND NOT WIN32)
#   target_compile_options(${bun} PRIVATE -fdiagnostics-color=always)
# endif()

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
  add_compile_options(-march=${CPU})
else()
  message(FATAL_ERROR "No CPU specified, please set -DCPU=<string>")
endif()

# if(NOT CPU STREQUAL "native")
#   # passing -march=native to clang will break older systems
#   # by default on x64, CPU is set to "haswell" or "nehalem" depending on baseline
#   # on arm, this argument will not be passed.
#   target_compile_options(${bun} PUBLIC "-march=${CPU}")
# else()
#   if(APPLE AND ARCH STREQUAL "aarch64")
#     # On arm macOS, we can set it to a minimum of the M1 cpu set. this might be the default already.
#     target_compile_options(${bun} PUBLIC "-mcpu=apple-m1")
#   endif()

#   if(NOT WIN32 AND NOT APPLE AND ARCH STREQUAL "aarch64")
#     # on arm64 linux, we set a minimum of armv8
#     target_compile_options(${bun} PUBLIC -march=armv8-a+crc -mtune=ampere1)
#   endif()
# endif()

add_compile_options(-ferror-limit=${ERROR_LIMIT})

# target_compile_options(${bun} PUBLIC -ferror-limit=${ERROR_LIMIT})



# --- To be removed ---

# set(CMAKE_CXX_STANDARD 20)
# set(CMAKE_C_STANDARD 17)
# set(CMAKE_CXX_STANDARD_REQUIRED ON)
# set(CMAKE_C_STANDARD_REQUIRED ON)

# if(WIN32 AND ENABLE_LTO)
#   set(CMAKE_LINKER_TYPE LLD)
#   set(CMAKE_INTERPROCEDURAL_OPTIMIZATION OFF)
# endif()
