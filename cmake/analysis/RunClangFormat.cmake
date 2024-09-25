find_command(
  VARIABLE
    CLANG_FORMAT_PROGRAM
  COMMAND
    clang-format
  REQUIRED
    OFF
)

set(CLANG_FORMAT_SOURCES ${BUN_C_SOURCES} ${BUN_CXX_SOURCES})

# TODO: bun-usockets
foreach(source ${CLANG_FORMAT_SOURCES})
  if(source MATCHES "bun-usockets")
    list(REMOVE_ITEM CLANG_FORMAT_SOURCES ${source})
  endif()
endforeach()

register_command(
  TARGET
    clang-format-check
  COMMENT
    "Running clang-format"
  COMMAND
    ${CLANG_FORMAT_PROGRAM}
      -Werror
      --dry-run
      --verbose
      ${CLANG_FORMAT_SOURCES}
  ALWAYS_RUN
)

register_command(
  TARGET
    clang-format
  COMMENT
    "Fixing clang-format"
  COMMAND
    ${CLANG_FORMAT_PROGRAM}
      -i # edits files in-place
      --verbose
      ${CLANG_FORMAT_SOURCES}
  ALWAYS_RUN
)
