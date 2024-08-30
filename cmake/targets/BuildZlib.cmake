include(Macros)
include(GitClone)

add_custom_repository(
  NAME
    zlib
  REPOSITORY
    cloudflare/zlib
  COMMIT
    886098f3f339617b4243b286f5ed364b9989e245
)

if(WIN32)
  set(ZLIB_LIBRARY zlib)
else()
  set(ZLIB_LIBRARY z)
endif()

# https://gitlab.kitware.com/cmake/cmake/-/issues/25755
if(APPLE)
  set(ZLIB_CMAKE_C_FLAGS "-fno-define-target-os-macros")
  set(ZLIB_CMAKE_CXX_FLAGS "-fno-define-target-os-macros")
endif()

add_custom_library(
  TARGET
    zlib
  LIBRARIES
    ${ZLIB_LIBRARY}
  INCLUDES
    .
  CMAKE_TARGETS
    zlib
  CMAKE_ARGS
    -DBUILD_SHARED_LIBS=OFF
    -DBUILD_EXAMPLES=OFF
  CMAKE_C_FLAGS
    ${ZLIB_CMAKE_C_FLAGS}
  CMAKE_CXX_FLAGS
    ${ZLIB_CMAKE_CXX_FLAGS}
)
