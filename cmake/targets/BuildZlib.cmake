register_repository(
  NAME
    zlib
  REPOSITORY
    zlib-ng/zlib-ng
  COMMIT
    cbb6ec1d74e8061efdf7251f8c2dae778bed14fd
)

# https://gitlab.kitware.com/cmake/cmake/-/issues/25755
if(APPLE)
  set(ZLIB_CMAKE_C_FLAGS "-fno-define-target-os-macros")
  set(ZLIB_CMAKE_CXX_FLAGS "-fno-define-target-os-macros")
endif()

if(WIN32)
  if(DEBUG)
    set(ZLIB_LIBRARY "zlibd")
  else()
    set(ZLIB_LIBRARY "zlib")
  endif()
else()
  set(ZLIB_LIBRARY "z")
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
    -DZLIB_COMPAT=ON
  LIBRARIES
    ${ZLIB_LIBRARY}
  INCLUDES
    .
)
