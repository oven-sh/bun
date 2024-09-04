include(Macros)

register_cmake_command(
  TARGET
    sqlite
  CWD
    src/bun.js/bindings/sqlite
  LIBRARIES
    sqlite3
  INCLUDES
    .
)
