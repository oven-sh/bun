include(BuildLibrary)

add_custom_library(
  TARGET
    sqlite
  LIBRARIES
    sqlite3
  INCLUDES
    .
  SOURCE_PATH
    src/bun.js/bindings/sqlite
)
