# https://cppcheck.sourceforge.io/

find_command(
  VARIABLE
    CPPCHECK_EXECUTABLE
  COMMAND
    cppcheck
  REQUIRED
    OFF
)

set(CPPCHECK_COMMAND ${CPPCHECK_EXECUTABLE}
  --cppcheck-build-dir=${BUILD_PATH}/cppcheck
  --project=${BUILD_PATH}/compile_commands.json
  --clang=${CMAKE_CXX_COMPILER}
  --std=c++${CMAKE_CXX_STANDARD}
  --report-progress
  --showtime=summary
)

register_command(
  TARGET
    cppcheck
  COMMENT
    "Running cppcheck"
  COMMAND
    ${CMAKE_COMMAND} -E make_directory cppcheck
    && ${CPPCHECK_COMMAND} 
  CWD
    ${BUILD_PATH}
  TARGETS
    ${bun}
)
