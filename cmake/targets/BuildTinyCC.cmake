register_repository(
  NAME
  tinycc
  REPOSITORY
  oven-sh/tinycc
  COMMIT
  75b71c95c7566a9b4c0c13a4eab770903d5f294a
)

register_cmake_command(
  TARGET
  tinycc
  LIBRARIES
  tcc
)
