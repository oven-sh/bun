include(BuildLibrary)
include(GitClone)

add_custom_repository(
  NAME
    mimalloc
  REPOSITORY
    oven-sh/mimalloc
  COMMIT
    4c283af60cdae205df5a872530c77e2a6a307d43
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

if(ENABLE_ASSERTIONS)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_DEBUG_FULL=ON)
endif()

if(USE_VALGRIND)
  list(APPEND MIMALLOC_CMAKE_ARGS -DMI_VALGRIND=ON)
endif()

if(CMAKE_BUILD_TYPE STREQUAL "Debug")
  set(MIMALLOC_LIBRARY "mimalloc-debug")
else()
  set(MIMALLOC_LIBRARY "mimalloc")
endif()

add_custom_library(
  TARGET
    mimalloc
  LIBRARIES
    ${MIMALLOC_LIBRARY}
  INCLUDES
    include
  CMAKE_TARGETS
    mimalloc-static
  CMAKE_ARGS
    ${MIMALLOC_CMAKE_ARGS}
)