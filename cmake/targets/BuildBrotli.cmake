register_repository(
  NAME
    brotli
  REPOSITORY
    google/brotli
  TAG
    v1.1.0
)

# Tests fail with "BrotliDecompressionError" when LTO is enabled
# only on Linux x64 (non-baseline). It's a mystery.
if(LINUX AND CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|X86_64|x64|X64|amd64|AMD64" AND NOT ENABLE_BASELINE)
  set(BROTLI_CMAKE_ARGS "-DCMAKE_C_FLAGS=-fno-lto")
endif()

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
    ${BROTLI_CMAKE_ARGS}
  INCLUDES
    c/include
)
