register_repository(
  NAME
    mimalloc
  REPOSITORY
    oven-sh/mimalloc
  COMMIT
    989115cefb6915baa13788cb8252d83aac5330ad
)

set(MIMALLOC_CMAKE_ARGS
  -DMI_BUILD_STATIC=ON
  -DMI_BUILD_OBJECT=ON
  -DMI_BUILD_SHARED=OFF
  -DMI_BUILD_TESTS=OFF
  -DMI_USE_CXX=ON
  -DMI_SKIP_COLLECT_ON_EXIT=ON

  # ```
  # ❯ mimalloc_allow_large_os_pages=0 BUN_PORT=3004 mem bun http-hello.js
  # Started development server: http://localhost:3004
  #
  # Peak memory usage: 52 MB
  #
  # ❯ mimalloc_allow_large_os_pages=1 BUN_PORT=3004 mem bun http-hello.js
  # Started development server: http://localhost:3004
  #
  # Peak memory usage: 74 MB
  # ```
  #
  # ```
  # ❯ mimalloc_allow_large_os_pages=1 mem bun --eval 1
  #
  # Peak memory usage: 52 MB
  #
  # ❯ mimalloc_allow_large_os_pages=0 mem bun --eval 1
  #
  # Peak memory usage: 30 MB
  # ```
  -DMI_NO_THP=1
)

if (ABI STREQUAL "musl")
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_LIBC_MUSL=ON)
endif()

if(ENABLE_ASAN)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_TRACK_ASAN=ON)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OVERRIDE=OFF)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_ZONE=OFF)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_INTERPOSE=OFF)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_DEBUG_UBSAN=ON)
elseif(APPLE OR LINUX)
  if(APPLE)
    list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OVERRIDE=OFF)
    list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_ZONE=OFF)
    list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_INTERPOSE=OFF)
  else()
    list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OVERRIDE=ON)
    list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_ZONE=OFF)
    list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_INTERPOSE=OFF)
  endif()
endif()

if(DEBUG)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_DEBUG_FULL=ON)
endif()

if(ENABLE_VALGRIND)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_VALGRIND=ON)
endif()

# Enable SIMD optimizations when not building for baseline (older CPUs)
if(NOT ENABLE_BASELINE)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OPT_ARCH=ON)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OPT_SIMD=ON)
endif()

if(WIN32)
  if(DEBUG)
    set(MIMALLOC_LIBRARY mimalloc-debug)
  else()
    set(MIMALLOC_LIBRARY mimalloc)
  endif()
elseif(DEBUG)
  if (ENABLE_ASAN)
    set(MIMALLOC_LIBRARY mimalloc-asan-debug)
  else()
    set(MIMALLOC_LIBRARY mimalloc-debug)
  endif()
else()
  set(MIMALLOC_LIBRARY mimalloc)
endif()

# Workaround for linker issue on macOS and Linux x64
# https://github.com/microsoft/mimalloc/issues/512
if(APPLE OR (LINUX AND NOT DEBUG))
  set(MIMALLOC_LIBRARY CMakeFiles/mimalloc-obj.dir/src/static.c.o)
endif()


register_cmake_command(
  TARGET
    mimalloc
  TARGETS
    mimalloc-static
    mimalloc-obj
  ARGS
    ${MIMALLOC_CMAKE_ARGS}
  LIBRARIES
    ${MIMALLOC_LIBRARY}
  INCLUDES
    include
)
