# IWYU = "Include What You Use"
# https://include-what-you-use.org/

include(Macros)
include(GitClone)

setx(IWYU_SOURCE_PATH ${CACHE_PATH}/iwyu-${LLVM_VERSION_MAJOR})
setx(IWYU_BUILD_PATH ${IWYU_SOURCE_PATH}/build)
setx(IWYU_PROGRAM ${IWYU_BUILD_PATH}/bin/include-what-you-use)

add_custom_repository(
  NAME
    iwyu
  REPOSITORY
    include-what-you-use/include-what-you-use
  BRANCH
    clang_${LLVM_VERSION_MAJOR}
  PATH
    ${IWYU_SOURCE_PATH}
)

add_custom_target(
  build-iwyu
  COMMENT
    "Building iwyu"
  VERBATIM COMMAND
    ${CMAKE_COMMAND}
      -B${IWYU_BUILD_PATH}
      -G${CMAKE_GENERATOR}
      -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
      -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
      -DIWYU_LLVM_ROOT_PATH=${LLVM_PREFIX}
  VERBATIM COMMAND
    ${CMAKE_COMMAND}
      --build ${IWYU_BUILD_PATH}
  WORKING_DIRECTORY
    ${IWYU_SOURCE_PATH}
  DEPENDS
    clone-iwyu
)

find_package(Python3 COMPONENTS Interpreter)

add_custom_target(
  iwyu
  COMMENT
    "Running iwyu"
  VERBATIM COMMAND
    ${CMAKE_COMMAND}
      -E env IWYU_BINARY=${IWYU_PROGRAM}
      ${PYTHON_EXECUTABLE}
      ${IWYU_SOURCE_PATH}/iwyu_tool.py
      -p ${BUILD_PATH}
  WORKING_DIRECTORY
    ${BUILD_PATH}
  DEPENDS
    build-iwyu
    ${bun}
)
