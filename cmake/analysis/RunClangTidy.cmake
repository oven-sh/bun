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

set(CLANG_TIDY_SOURCES ${BUN_C_SOURCES} ${BUN_CXX_SOURCES})

find_command(
  VARIABLE
    GIT_PROGRAM
  COMMAND
    git
  REQUIRED
    OFF
)

if(GIT_PROGRAM)
  execute_process(
    COMMAND
      ${GIT_PROGRAM}
        diff
        --name-only
        --diff-filter=AM
        main
    WORKING_DIRECTORY
      ${CWD}
    OUTPUT_STRIP_TRAILING_WHITESPACE
    OUTPUT_VARIABLE
      GIT_CHANGED_FILES
    ERROR_QUIET
  )
  string(REPLACE "\n" ";" GIT_CHANGED_FILES ${GIT_CHANGED_FILES})
  list(TRANSFORM GIT_CHANGED_FILES PREPEND ${CWD}/)

  set(CLANG_TIDY_CHANGED_SOURCES)
  foreach(source ${CLANG_TIDY_SOURCES})
    list(FIND GIT_CHANGED_FILES ${source} index)
    if(NOT ${index} EQUAL -1)
      list(APPEND CLANG_TIDY_CHANGED_SOURCES ${source})
    endif()
  endforeach()

  if(CLANG_TIDY_CHANGED_SOURCES)
    set(CLANG_TIDY_SOURCES ${CLANG_TIDY_CHANGED_SOURCES})
  else()
    set(CLANG_TIDY_COMMAND ${CMAKE_COMMAND} -E echo "No files changed for clang-tidy")
  endif()
endif()

if(NOT CLANG_TIDY_COMMAND)
  set(CLANG_TIDY_COMMAND ${CLANG_TIDY_PROGRAM}
    -p ${BUILD_PATH}  
    --config-file=${CWD}/.clang-tidy
    --fix
    --fix-errors
    --fix-notes
    --use-color
    ${CLANG_TIDY_SOURCES}
  )
endif()

register_command(
  TARGET
    clang-tidy
  COMMENT
    "Running clang-tidy"
  COMMAND
    ${CLANG_TIDY_COMMAND} 
  CWD
    ${BUILD_PATH}
)
