include(BuildLibrary)
include(GitClone)

add_custom_library(
  TARGET
    tinycc
  LIBRARIES
    tcc
  CMAKE_ARGS
    -DTCC_BUILD_STATIC=ON
)

add_custom_clone(
  NAME
    tinycc
  REPOSITORY
    oven-sh/tinycc
  COMMIT
    ab631362d839333660a265d3084d8ff060b96753
)

