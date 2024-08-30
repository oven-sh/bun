# https://clang.llvm.org/extra/clang-tidy/

include(Macros)

find_llvm_program(CLANG_TIDY_PROGRAM "clang-tidy" OPTIONAL)

set(CLANG_TIDY_COMMAND ${BUN_CPP_SOURCES}
  -p ${BUILD_PATH}  
  --config-file=${CWD}/.clang-tidy
  --fix
  --fix-errors
  --fix-notes
)

if(CMAKE_COLOR_DIAGNOSTICS)
  list(APPEND CLANG_TIDY_COMMAND --use-color)
endif()

# Extra clang-tidy checks that are normally disabled due to noise.
# e.g. JavaScriptCore/Lookup.h
set(CLANG_TIDY_EXTRA_COMMAND ${CLANG_TIDY_PROGRAM}
  --checks=performance-*
)

add_custom_target(
  clang-tidy
  COMMENT
    "Running clang-tidy"
  VERBATIM COMMAND
    ${CLANG_TIDY_COMMAND} 
  WORKING_DIRECTORY
    ${BUILD_PATH}
  DEPENDS
    ${bun}
)

add_custom_target(
  clang-tidy-extra
  COMMENT
    "Running clang-tidy with extra checks"
  VERBATIM COMMAND
    ${CLANG_TIDY_EXTRA_COMMAND} 
  WORKING_DIRECTORY
    ${BUILD_PATH}
  DEPENDS
    ${bun}
)
