register_cmake_command(
  TARGET
    zstd
  TARGETS
    libzstd_static
  ARGS
    -Sbuild/cmake
    -DZSTD_BUILD_STATIC=ON
    -DZSTD_BUILD_PROGRAMS=OFF
    -DZSTD_BUILD_TESTS=OFF
    -DZSTD_BUILD_CONTRIB=OFF
  LIB_PATH
    lib
  LIBRARIES
    zstd_static WIN32
    zstd UNIX
  INCLUDES
    lib
)
