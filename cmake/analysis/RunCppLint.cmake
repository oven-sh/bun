include(Macros)

find_program(CPPLINT_PROGRAM "cpplint")

add_custom_target(
  cpplint
  COMMENT
    "Running cpplint"
  VERBATIM COMMAND
    ${CPPLINT_PROGRAM}
    ${BUN_CPP_SOURCES}
  WORKING_DIRECTORY
    ${BUILD_PATH}
  DEPENDS
    ${bun}
)
