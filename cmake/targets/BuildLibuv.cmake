register_vendor_target(libuv)

register_repository(
  NAME
    ${libuv}
  REPOSITORY
    libuv/libuv
  COMMIT
    da527d8d2a908b824def74382761566371439003
)

register_libraries(
  TARGET ${libuv}
  uv_a ${WIN32}
  uv ${UNIX}
)

register_cmake_project(
  TARGET
    ${libuv}
  CMAKE_TARGET
    uv_a
)

register_cmake_definitions(
  TARGET ${libuv}
  LIBUV_BUILD_SHARED=OFF
  LIBUV_BUILD_TESTS=OFF
  LIBUV_BUILD_BENCH=OFF
)

if(WIN32)
  register_compiler_flags(
    TARGET ${libuv}
    /DWIN32
    /D_WINDOWS
    -Wno-int-conversion
  )
endif()
