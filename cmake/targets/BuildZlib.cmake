include(Macros)

register_repository(
  NAME
    zlib
  REPOSITORY
    cloudflare/zlib
  COMMIT
    886098f3f339617b4243b286f5ed364b9989e245
)

# https://gitlab.kitware.com/cmake/cmake/-/issues/25755
if(APPLE)
  set(ZLIB_CMAKE_C_FLAGS "-fno-define-target-os-macros")
  set(ZLIB_CMAKE_CXX_FLAGS "-fno-define-target-os-macros")
endif()

register_cmake_command(
  TARGET
    zlib
  TARGETS
    zlib
  ARGS
    -DBUILD_SHARED_LIBS=OFF
    -DBUILD_EXAMPLES=OFF
    "-DCMAKE_C_FLAGS=${ZLIB_CMAKE_C_FLAGS}"
    "-DCMAKE_CXX_FLAGS=${ZLIB_CMAKE_CXX_FLAGS}"
  LIBRARIES
    zlib WIN32
    z UNIX
  INCLUDES
    .
)
