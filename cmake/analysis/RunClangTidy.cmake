# https://clang.llvm.org/extra/clang-tidy/

set(CLANG_TIDY_SOURCES ${BUN_C_SOURCES} ${BUN_CXX_SOURCES})
list(REMOVE_ITEM CLANG_TIDY_SOURCES ${CWD}/src/bun.js/bindings/node/http/llhttp/llhttp.c)
list(REMOVE_ITEM CLANG_TIDY_SOURCES ${CWD}/src/bun.js/bindings/node/http/llhttp/http.c)
list(REMOVE_ITEM CLANG_TIDY_SOURCES ${CWD}/src/bun.js/bindings/node/http/llhttp/api.c)
list(REMOVE_ITEM CLANG_TIDY_SOURCES ${CWD}/src/bun.js/bindings/decodeURIComponentSIMD.cpp)
list(REMOVE_ITEM CLANG_TIDY_SOURCES ${CWD}/src/bun.js/bindings/NoOpForTesting.cpp)
list(REMOVE_ITEM CLANG_TIDY_SOURCES ${CWD}/src/bun.js/bindings/ProcessBindingNatives.cpp)
list(REMOVE_ITEM CLANG_TIDY_SOURCES ${CWD}/src/bun.js/bindings/stripANSI.cpp)
list(REMOVE_ITEM CLANG_TIDY_SOURCES ${CWD}/src/bun.js/bindings/Uint8Array.cpp)

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
