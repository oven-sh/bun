find_command(
  VARIABLE
    CPPLINT_PROGRAM
  COMMAND
    cpplint
  REQUIRED
    OFF
)

register_command(
  TARGET
    cpplint
  COMMENT
    "Running cpplint"
  COMMAND
    ${CPPLINT_PROGRAM}
    ${BUN_CPP_SOURCES}
  CWD
    ${BUILD_PATH}
  TARGETS
    ${bun}
)
