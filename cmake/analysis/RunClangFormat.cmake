find_command(
  VARIABLE
    CLANG_FORMAT_PROGRAM
  COMMAND
    clang-format
  REQUIRED
    OFF
)

register_command(
  TARGET
    clang-format-check
  COMMENT
    "Checking clang-format"
  COMMAND
    ${CLANG_FORMAT_PROGRAM}
      -Werror
      --dry-run
      --verbose
      ${BUN_CPP_SOURCES}
  ALWAYS_RUN
)

register_command(
  TARGET
    clang-format
  COMMENT
    "Running clang-format"
  COMMAND
    ${CLANG_FORMAT_PROGRAM}
      -i # edits files in-place
      --verbose
      ${BUN_CPP_SOURCES}
  ALWAYS_RUN
)
