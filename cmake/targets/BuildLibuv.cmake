register_repository(
  NAME
    libuv
  REPOSITORY
    libuv/libuv
  COMMIT
    da527d8d2a908b824def74382761566371439003
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
  LIBRARIES
    libuv WIN32
    uv UNIX
  INCLUDES
    include
  ADDITIONAL_CMAKE_C_FLAGS
    ${LIBUV_CMAKE_C_FLAGS}
)
