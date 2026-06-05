# bun-electron native targets:
#  - bun_electron_shim:   shared library loaded by Bun via bun:ffi
#  - bun-electron-helper: CEF subprocess executable
#
# Configure with -DCEF_ROOT=/path/to/cef_binary_<version>_<platform>.
# scripts/build.ts drives this and assembles the final dist/ layout.

cmake_minimum_required(VERSION 3.21)

project(bun_electron LANGUAGES C CXX)

set_property(GLOBAL PROPERTY USE_FOLDERS ON)
set(CMAKE_CONFIGURATION_TYPES Debug Release)

if(NOT DEFINED CEF_ROOT AND DEFINED ENV{CEF_ROOT})
  set(CEF_ROOT "$ENV{CEF_ROOT}")
endif()
if(NOT DEFINED CEF_ROOT)
  message(FATAL_ERROR "CEF_ROOT must point at the extracted CEF binary distribution")
endif()

set(CMAKE_MODULE_PATH ${CMAKE_MODULE_PATH} "${CEF_ROOT}/cmake")

# Loads cef_variables.cmake / cef_macros.cmake and validates the dist.
find_package(CEF REQUIRED)

# libcef_dll_wrapper (static C++ wrapper over the C API).
add_subdirectory(${CEF_LIBCEF_DLL_WRAPPER_PATH} libcef_dll_wrapper)

if(NOT OS_MAC)
  # On macOS the framework is loaded at runtime via cef_load_library(); the
  # wrapper supplies runtime-resolved stubs, so only Linux/Windows link the
  # libcef library directly.
  ADD_LOGICAL_TARGET("libcef_lib" "${CEF_LIB_DEBUG}" "${CEF_LIB_RELEASE}")
endif()

#
# Shim shared library.
#

set(SHIM_SRCS shim.cpp shim.h)
if(OS_MAC)
  list(APPEND SHIM_SRCS shim_mac.mm)
endif()
add_library(bun_electron_shim SHARED ${SHIM_SRCS})
SET_LIBRARY_TARGET_PROPERTIES(bun_electron_shim)
add_dependencies(bun_electron_shim libcef_dll_wrapper)
target_include_directories(bun_electron_shim PRIVATE "${CEF_ROOT}")

if(OS_MAC)
  target_link_libraries(bun_electron_shim libcef_dll_wrapper ${CEF_STANDARD_LIBS})
else()
  target_link_libraries(bun_electron_shim libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS})
endif()

if(OS_LINUX)
  # The shim is dlopen'd by bun from dist/; libcef.so sits in the same dir.
  set_target_properties(bun_electron_shim PROPERTIES
    BUILD_RPATH "$ORIGIN"
    INSTALL_RPATH "$ORIGIN")
endif()

if(OS_MAC)
  set_target_properties(bun_electron_shim PROPERTIES
    SUFFIX ".dylib"
    BUILD_RPATH "@loader_path")
endif()

#
# Helper executable.
#

set(HELPER_SRCS helper_main.cpp renderer_bootstrap.h)
if(OS_WINDOWS)
  add_executable(bun-electron-helper WIN32 ${HELPER_SRCS})
else()
  add_executable(bun-electron-helper ${HELPER_SRCS})
endif()
SET_EXECUTABLE_TARGET_PROPERTIES(bun-electron-helper)
add_dependencies(bun-electron-helper libcef_dll_wrapper)
target_include_directories(bun-electron-helper PRIVATE "${CEF_ROOT}")

if(OS_MAC)
  target_link_libraries(bun-electron-helper libcef_dll_wrapper ${CEF_STANDARD_LIBS})
else()
  target_link_libraries(bun-electron-helper libcef_lib libcef_dll_wrapper ${CEF_STANDARD_LIBS})
endif()

if(OS_LINUX)
  set_target_properties(bun-electron-helper PROPERTIES
    BUILD_RPATH "$ORIGIN"
    INSTALL_RPATH "$ORIGIN")
endif()

PRINT_CEF_CONFIG()
