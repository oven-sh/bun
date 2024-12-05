register_repository(
  NAME
    mimalloc
  REPOSITORY
    oven-sh/mimalloc
  COMMIT
    82b2c2277a4d570187c07b376557dc5bde81d848
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
  set(MIMALLOC_LIBRARY mimalloc-debug)
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
