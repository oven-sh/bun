# https://clang.llvm.org/docs/ClangFormat.html

file(GLOB BUN_H_SOURCES LIST_DIRECTORIES false ${CONFIGURE_DEPENDS}
  ${CWD}/src/bun.js/bindings/*.h
  ${CWD}/src/bun.js/modules/*.h
)

set(CLANG_FORMAT_SOURCES ${BUN_C_SOURCES} ${BUN_CXX_SOURCES} ${BUN_H_SOURCES})

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

register_command(
  TARGET
    clang-format-diff
  COMMENT
    "Running clang-format on changed files"
  COMMAND
    ${CLANG_FORMAT_DIFF_COMMAND}
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)
