# https://clang.llvm.org/extra/clang-tidy/

# Filter out specific files that cause clang-tidy segfaults
set(CLANG_TIDY_SOURCES)
foreach(source ${BUN_C_SOURCES} ${BUN_CXX_SOURCES})
  # Exclude files that cause segfaults in clang-tidy
  # - src/bake/: Complex WebKit integration causing clang-tidy segfaults
  # - src/bun.js/bindings: WebKit C++ bindings with complex memory management APIs
  # - src/bun.js/modules: Generated WebKit binding modules with complex template code
  # - vendor/: Third-party code not under our control
  # - WebKit: Direct WebKit headers and implementations
  if(NOT source MATCHES "(src/bake/|src/bun\\.js/(bindings|modules)|vendor/)" AND
     NOT source MATCHES "WebKit")
    list(APPEND CLANG_TIDY_SOURCES ${source})
  endif()
endforeach()

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

if(GIT_CHANGED_SOURCES)
  set(CLANG_TIDY_CHANGED_SOURCES)
  foreach(source ${CLANG_TIDY_SOURCES})
    list(FIND GIT_CHANGED_SOURCES ${source} index)
    if(NOT ${index} EQUAL -1)
      list(APPEND CLANG_TIDY_CHANGED_SOURCES ${source})
    endif()
  endforeach()
endif()

if(CLANG_TIDY_CHANGED_SOURCES)
  set(CLANG_TIDY_DIFF_COMMAND ${CLANG_TIDY_PROGRAM}
    ${CLANG_TIDY_CHANGED_SOURCES}
    --fix
    --fix-errors
    --fix-notes
  )
else()
  set(CLANG_TIDY_DIFF_COMMAND ${CMAKE_COMMAND} -E echo "No changed files for clang-tidy")
endif()

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
