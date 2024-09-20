register_repository(
  NAME
    tinycc
  REPOSITORY
    oven-sh/tinycc
  COMMIT
    29985a3b59898861442fa3b43f663fc1af2591d7
)

register_cmake_command(
  TARGET
    tinycc
  LIBRARIES
    tcc
)
