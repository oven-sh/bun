register_repository(
  NAME
    zstd
  REPOSITORY
    facebook/zstd
  COMMIT
    794ea1b0afca0f020f4e57b6732332231fb23c70
)

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
)
