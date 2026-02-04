set(CMAKE_SYSTEM_NAME Windows)
set(CMAKE_SYSTEM_PROCESSOR aarch64)

set(CMAKE_C_COMPILER_WORKS ON)
set(CMAKE_CXX_COMPILER_WORKS ON)
set(CMAKE_CROSSCOMPILING ON)

# The rest only applies when building on Windows (C++ and link steps).
# The Zig step runs on Linux and only needs CMAKE_SYSTEM_NAME/PROCESSOR above.
if(CMAKE_HOST_SYSTEM_NAME STREQUAL "Windows")

  # Ensure clang/clang-cl targets Windows ARM64 (otherwise ARM64-specific flags like
  # -march=armv8-a are rejected as x86-only).
  set(CMAKE_C_COMPILER_TARGET aarch64-pc-windows-msvc CACHE STRING "" FORCE)
  set(CMAKE_CXX_COMPILER_TARGET aarch64-pc-windows-msvc CACHE STRING "" FORCE)

  # ARM64 has lock-free atomics (highway's FindAtomics check can't run ARM64 test binary on x64)
  set(ATOMICS_LOCK_FREE_INSTRUCTIONS TRUE CACHE BOOL "" FORCE)
  set(HAVE_CXX_ATOMICS_WITHOUT_LIB TRUE CACHE BOOL "" FORCE)
  set(HAVE_CXX_ATOMICS64_WITHOUT_LIB TRUE CACHE BOOL "" FORCE)

  # Force ARM64 architecture ID - this is what CMake uses to determine /machine: flag
  set(MSVC_C_ARCHITECTURE_ID ARM64 CACHE INTERNAL "")
  set(MSVC_CXX_ARCHITECTURE_ID ARM64 CACHE INTERNAL "")

  # CMake 4.0+ policy CMP0197 controls how MSVC machine type flags are handled
  set(CMAKE_POLICY_DEFAULT_CMP0197 NEW CACHE INTERNAL "")

  # Clear any inherited static linker flags that might have wrong machine types
  set(CMAKE_STATIC_LINKER_FLAGS "" CACHE STRING "" FORCE)

  # Use wrapper script for llvm-lib that strips /machine:x64 flags
  # This works around CMake 4.1.0 bug where both ARM64 and x64 machine flags are added
  get_filename_component(_TOOLCHAIN_DIR "${CMAKE_CURRENT_LIST_DIR}" DIRECTORY)
  set(CMAKE_AR "${_TOOLCHAIN_DIR}/scripts/llvm-lib-wrapper.bat" CACHE FILEPATH "" FORCE)

endif()
