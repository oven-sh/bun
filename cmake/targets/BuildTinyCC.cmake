include(Macros)

register_repository(
  NAME
    tinycc
  REPOSITORY
    oven-sh/tinycc
  COMMIT
    ab631362d839333660a265d3084d8ff060b96753
)

register_cmake_command(
  TARGET
    tinycc
  LIBRARIES
    tcc
)
