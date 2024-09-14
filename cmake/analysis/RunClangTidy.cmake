# https://clang.llvm.org/extra/clang-tidy/

find_command(
  VARIABLE
    CLANG_TIDY_PROGRAM
  COMMAND
    clang-tidy
  VERSION
    ${LLVM_VERSION}
  REQUIRED
    OFF
)

set(CLANG_TIDY_COMMAND ${CLANG_TIDY_PROGRAM}
  -p ${BUILD_PATH}  
  --config-file=${CWD}/.clang-tidy
  --fix
  --fix-errors
  --fix-notes
  ${BUN_C_SOURCES}
  ${BUN_CXX_SOURCES}
)

if(CMAKE_COLOR_DIAGNOSTICS)
  list(APPEND CLANG_TIDY_COMMAND --use-color)
endif()

# Extra clang-tidy checks that are normally disabled due to noise.
# e.g. JavaScriptCore/Lookup.h
set(CLANG_TIDY_EXTRA_COMMAND ${CLANG_TIDY_PROGRAM}
  --checks=performance-*
)

register_command(
  TARGET
    clang-tidy
  COMMENT
    "Running clang-tidy"
  COMMAND
    ${CLANG_TIDY_COMMAND} 
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)

register_command(
  TARGET
    clang-tidy-extra
  COMMENT
    "Running clang-tidy with extra checks"
  COMMAND
    ${CLANG_TIDY_EXTRA_COMMAND} 
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)
