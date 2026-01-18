register_repository(
  NAME
    tinycc
  REPOSITORY
    oven-sh/tinycc
  COMMIT
    12882eee073cfe5c7621bcfadf679e1372d4537b
)

register_cmake_command(
  TARGET
    tinycc
  LIBRARIES
    tcc
)
