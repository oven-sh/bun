# IWYU = "Include What You Use"
# https://include-what-you-use.org/

setx(IWYU_SOURCE_PATH ${CACHE_PATH}/iwyu-${LLVM_VERSION})
setx(IWYU_BUILD_PATH ${IWYU_SOURCE_PATH}/build)
setx(IWYU_PROGRAM ${IWYU_BUILD_PATH}/bin/include-what-you-use)

register_repository(
  NAME
    iwyu
  REPOSITORY
    include-what-you-use/include-what-you-use
  BRANCH
    clang_${LLVM_VERSION}
  PATH
    ${IWYU_SOURCE_PATH}
)

register_command(
  TARGET
    build-iwyu
  COMMENT
    "Building iwyu"
  COMMAND
    ${CMAKE_COMMAND}
      -B${IWYU_BUILD_PATH}
      -G${CMAKE_GENERATOR}
      -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
      -DCMAKE_CXX_COMPILER_LAUNCHER=${CMAKE_CXX_COMPILER_LAUNCHER}
      -DIWYU_LLVM_ROOT_PATH=${LLVM_PREFIX}
    && ${CMAKE_COMMAND}
      --build ${IWYU_BUILD_PATH}
  CWD
    ${IWYU_SOURCE_PATH}
  TARGETS
    clone-iwyu
)

find_command(
  VARIABLE
    PYTHON_EXECUTABLE
  COMMAND
    python3
    python
  VERSION
    >=3.0.0
  REQUIRED
    OFF
)

register_command(
  TARGET
    iwyu
  COMMENT
    "Running iwyu"
  COMMAND
    ${CMAKE_COMMAND}
      -E env IWYU_BINARY=${IWYU_PROGRAM}
      ${PYTHON_EXECUTABLE}
      ${IWYU_SOURCE_PATH}/iwyu_tool.py
      -p ${BUILD_PATH}
  CWD
    ${BUILD_PATH}
  TARGETS
    build-iwyu
    ${bun}
)
