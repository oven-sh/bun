if(NOT WIN32)
  message(FATAL_ERROR "libuv is only supported on Windows")
endif()

register_repository(
  NAME
    libuv
  REPOSITORY
    libuv/libuv
  COMMIT
    da527d8d2a908b824def74382761566371439003
)

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
)

register_compiler_flags(
  TARGET libuv
  /DWIN32
  /D_WINDOWS
  -Wno-int-conversion
)
