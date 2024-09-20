register_vendor_target(brotli)

register_repository(
  NAME
    ${brotli}
  REPOSITORY
    google/brotli
  COMMIT
    ed738e842d2fbdf2d6459e39267a633c4a9b2f5d
)

register_cmake_project(
  TARGET
    ${brotli}
  CMAKE_TARGET
    brotlicommon
    brotlidec
    brotlienc
)

register_cmake_definitions(
  TARGET ${brotli}
  BUILD_SHARED_LIBS=OFF
  BROTLI_BUILD_TOOLS=OFF
  BROTLI_EMSCRIPTEN=OFF
  BROTLI_DISABLE_TESTS=ON
)

register_libraries(
  TARGET ${brotli}
  brotlicommon
  brotlidec
  brotlienc
)

# Tests fail with "BrotliDecompressionError" when LTO is enabled
# only on Linux x64 (non-baseline). It's a mystery.
if(LINUX AND CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|X86_64|x64|X64|amd64|AMD64" AND NOT ENABLE_BASELINE)
  register_compiler_flags(
    TARGET ${brotli}
    -fno-lto
  )
endif()
