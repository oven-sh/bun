register_repository(
  NAME
    libuv
  REPOSITORY
    oven-sh/libuv
  COMMIT
    537d74411e9a5587bc5c6dd9ca04a77976ecb120
)

if(WIN32)
  set(LIBUV_CMAKE_C_FLAGS "/DWIN32 /D_WINDOWS -Wno-int-conversion")
endif()

register_cmake_command(
  TARGET
    libuv
  TARGETS
    uv_a
  ARGS
    -DLIBUV_BUILD_SHARED=OFF
    -DLIBUV_BUILD_TESTS=OFF
    -DLIBUV_BUILD_BENCH=OFF
    -DCMAKE_C_FLAGS=${LIBUV_CMAKE_C_FLAGS}
  LIBRARIES
    libuv WIN32
    uv UNIX
  INCLUDES
    include
)
