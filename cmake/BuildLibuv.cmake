include(cmake/BuildLibrary.cmake)
include(cmake/GitClone.cmake)

add_custom_library(
  TARGET
    libuv
  LIBRARIES
    libuv
  INCLUDES
    c/include
  CMAKE_ARGS
    -DCMAKE_C_FLAGS=\"/DWIN32 /D_WINDOWS -Wno-int-conversion\"
)

add_custom_clone(
  REPOSITORY
    libuv/libuv
  COMMIT
    da527d8d2a908b824def74382761566371439003
)
