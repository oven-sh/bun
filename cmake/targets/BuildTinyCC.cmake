include(Macros)
include(GitClone)

add_custom_repository(
  NAME
    tinycc
  REPOSITORY
    oven-sh/tinycc
  COMMIT
    ab631362d839333660a265d3084d8ff060b96753
)

add_custom_library(
  TARGET
    tinycc
  LIBRARIES
    tcc
)
