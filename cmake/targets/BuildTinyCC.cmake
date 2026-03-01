register_repository(
  NAME
    tinycc
  REPOSITORY
    oven-sh/tinycc
  COMMIT
    12882eee073cfe5c7621bcfadf679e1372d4537b
)

# Suppress all warnings from vendored tinycc on Windows (clang-cl)
if(WIN32)
  set(TINYCC_CMAKE_ARGS "-DCMAKE_C_FLAGS=-w")
endif()

register_cmake_command(
  TARGET
    tinycc
  ARGS
    ${TINYCC_CMAKE_ARGS}
  LIBRARIES
    tcc
)
