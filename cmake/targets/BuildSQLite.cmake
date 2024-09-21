register_vendor_target(sqlite)

register_libraries(
  TARGET ${sqlite}
  sqlite3
)

register_cmake_project(
  TARGET
    ${sqlite}
  CWD
    ${CWD}/src/bun.js/bindings/sqlite
)
