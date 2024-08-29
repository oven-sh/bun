include(BuildLibrary)
include(GitClone)

add_custom_repository(
  NAME
    libuv
  REPOSITORY
    libuv/libuv
  COMMIT
    da527d8d2a908b824def74382761566371439003
)

if(WIN32)
  set(LIBUV_LIBRARY libuv)
else()
  set(LIBUV_LIBRARY uv)
endif()

if(WIN32)
  set(LIBUV_CMAKE_C_FLAGS "/DWIN32 /D_WINDOWS -Wno-int-conversion")
endif()

add_custom_library(
  TARGET
    libuv
  LIBRARIES
    ${LIBUV_LIBRARY}
  INCLUDES
    include
  CMAKE_TARGETS
    uv_a
  CMAKE_ARGS
    -DLIBUV_BUILD_SHARED=OFF
    -DLIBUV_BUILD_TESTS=OFF
    -DLIBUV_BUILD_BENCH=OFF
  CMAKE_C_FLAGS
    ${LIBUV_CMAKE_C_FLAGS}
)
