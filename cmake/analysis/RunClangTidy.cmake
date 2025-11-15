# https://clang.llvm.org/extra/clang-tidy/

set(CLANG_TIDY_SOURCES ${BUN_C_SOURCES} ${BUN_CXX_SOURCES})

set(CLANG_TIDY_COMMAND ${CLANG_TIDY_PROGRAM}
  -p ${BUILD_PATH}
  --config-file=${CWD}/.clang-tidy
)

if(CMAKE_COLOR_DIAGNOSTICS)
  list(APPEND CLANG_TIDY_COMMAND --use-color)
endif()

register_command(
  TARGET
    clang-tidy
  COMMENT
    "Running clang-tidy"
  COMMAND
    ${CLANG_TIDY_COMMAND}
      ${CLANG_TIDY_SOURCES}
      --fix
      --fix-errors
      --fix-notes
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)

register_command(
  TARGET
    clang-tidy-check
  COMMENT
    "Checking clang-tidy"
  COMMAND
    ${CLANG_TIDY_COMMAND}
      ${CLANG_TIDY_SOURCES}
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)

register_command(
  TARGET
    clang-tidy-diff
  COMMENT
    "Running clang-tidy on changed files"
  COMMAND
    ${CLANG_TIDY_DIFF_COMMAND}
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)
