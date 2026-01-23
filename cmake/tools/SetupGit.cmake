find_command(
  VARIABLE
    GIT_PROGRAM
  COMMAND
    git
  REQUIRED
    ${CI}
)

if(NOT GIT_PROGRAM)
  return()
endif()
