include(Macros)

register_repository(
  NAME
    brotli
  REPOSITORY
    google/brotli
  TAG
    v1.1.0
)

register_cmake_command(
  TARGET
    brotli
  LIBRARIES
    brotlicommon
    brotlidec
    brotlienc
  ARGS
    -DBUILD_SHARED_LIBS=OFF
    -DBROTLI_BUILD_TOOLS=OFF
    -DBROTLI_EMSCRIPTEN=OFF
    -DBROTLI_DISABLE_TESTS=ON
  INCLUDES
    c/include
)
