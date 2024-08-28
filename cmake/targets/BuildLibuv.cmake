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

add_custom_library(
  TARGET
    libuv
  LIBRARIES
    uv
  INCLUDES
    include
  CMAKE_C_FLAGS
    "/DWIN32 /D_WINDOWS -Wno-int-conversion"
)
