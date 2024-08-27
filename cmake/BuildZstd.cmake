include(cmake/BuildLibrary.cmake)
include(cmake/GitClone.cmake)

add_custom_library(
  TARGET
    zstd
  PREFIX
    lib
  LIBRARIES
    zstd
  CMAKE_PATH
    build/cmake
  CMAKE_TARGETS
    libzstd_static
  CMAKE_ARGS
    -DZSTD_BUILD_STATIC=ON
    -DZSTD_BUILD_PROGRAMS=OFF
    -DZSTD_BUILD_TESTS=OFF
    -DZSTD_BUILD_CONTRIB=OFF
)

add_custom_clone(
  REPOSITORY
    facebook/zstd
  COMMIT
    794ea1b0afca0f020f4e57b6732332231fb23c70
)
