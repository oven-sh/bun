register_repository(
  NAME
    mimalloc
  REPOSITORY
    oven-sh/mimalloc
  COMMIT
    1beadf9651a7bfdec6b5367c380ecc3fe1c40d1a
)

set(MIMALLOC_CMAKE_ARGS
  -DMI_BUILD_STATIC=ON
  -DMI_BUILD_OBJECT=ON
  -DMI_BUILD_SHARED=OFF
  -DMI_BUILD_TESTS=OFF
  -DMI_USE_CXX=ON
  -DMI_OVERRIDE=OFF
  -DMI_OSX_ZONE=OFF
  -DMI_OSX_INTERPOSE=OFF
  -DMI_SKIP_COLLECT_ON_EXIT=ON
)

if(ENABLE_ASAN)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_TRACK_ASAN=ON)
endif()

if(DEBUG)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_DEBUG_FULL=ON)
endif()

if(ENABLE_VALGRIND)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_VALGRIND=ON)
endif()

if(WIN32)
  if(DEBUG)
    set(MIMALLOC_LIBRARY mimalloc-static-debug)
  else()
    set(MIMALLOC_LIBRARY mimalloc-static)
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
