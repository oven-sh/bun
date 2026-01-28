register_repository(
  NAME
    libuv
  REPOSITORY
    libuv/libuv
  COMMIT
    # Latest HEAD (includes recursion bug fix #4784)
    f3ce527ea940d926c40878ba5de219640c362811
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
