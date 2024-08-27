include(cmake/BuildLibrary.cmake)
include(cmake/GitClone.cmake)

add_custom_library(
  TARGET
    brotli
  LIBRARIES
    brotlicommon
    brotlidec
    brotlienc
  INCLUDES
    c/include
  CMAKE_ARGS
    -DBUILD_SHARED_LIBS=OFF
    -DBROTLI_BUILD_TOOLS=OFF
    -DBROTLI_EMSCRIPTEN=OFF
    -DBROTLI_DISABLE_TESTS=ON
)

add_custom_clone(
  REPOSITORY
    google/brotli
  TAG
    v1.1.0
)
