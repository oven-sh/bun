# https://cppcheck.sourceforge.io/

include(Macros)

find_program(CPPCHECK_PROGRAM "cppcheck")

set(CPPCHECK_COMMAND ${CPPCHECK_PROGRAM}
  --cppcheck-build-dir=${BUILD_PATH}/cppcheck
  --project=${BUILD_PATH}/compile_commands.json
  --clang=${CMAKE_CXX_COMPILER}
  --std=c++${CMAKE_CXX_STANDARD}
  --report-progress
  --showtime=summary
)

add_custom_target(
  cppcheck
  COMMENT
    "Running cppcheck"
  VERBATIM COMMAND
    ${CMAKE_COMMAND}
      -E make_directory cppcheck
  VERBATIM COMMAND
    ${CPPCHECK_COMMAND} 
  WORKING_DIRECTORY
    ${BUILD_PATH}
  DEPENDS
    ${bun}
)
