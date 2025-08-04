register_repository(
  NAME
    mimalloc
  REPOSITORY
    oven-sh/mimalloc
  COMMIT
    178534eeb7c0b4e2f438b513640c6f4d7338416a
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

if(ENABLE_ASAN)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_TRACK_ASAN=ON)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OVERRIDE=OFF)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_ZONE=OFF)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_INTERPOSE=OFF)
elseif(APPLE OR LINUX)
  # Enable static override when ASAN is not enabled
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OVERRIDE=ON)
  if(APPLE)
    list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_ZONE=ON)
    list(APPEND MIMALLOC_CMAKE_ARGS -DMI_OSX_INTERPOSE=ON)
  else()
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

if(DEBUG)
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
