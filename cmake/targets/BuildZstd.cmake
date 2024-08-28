include(BuildLibrary)
include(GitClone)

add_custom_repository(
  NAME
    zstd
  REPOSITORY
    facebook/zstd
  COMMIT
    794ea1b0afca0f020f4e57b6732332231fb23c70
)

if(WIN32)
  set(ZSTD_LIBRARY zstd_static)
else()
  set(ZSTD_LIBRARY zstd)
endif()

add_custom_library(
  TARGET
    zstd
  PREFIX
    lib
  LIBRARIES
    ${ZSTD_LIBRARY}
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
