if(CMAKE_HOST_WIN32)
  setx(PRETTIER_EXECUTABLE ${CWD}/node_modules/.bin/prettier.exe)
else()
  setx(PRETTIER_EXECUTABLE ${CWD}/node_modules/.bin/prettier)
endif()

set(PRETTIER_PATHS
  ${CWD}/src
  ${CWD}/packages/bun-error
  ${CWD}/packages/bun-types
  ${CWD}/packages/bun-inspector-protocol
  ${CWD}/packages/bun-inspector-frontend
  ${CWD}/packages/bun-debug-adapter-protocol
  ${CWD}/packages/bun-vscode
  ${CWD}/test
  ${CWD}/bench
  ${CWD}/.vscode
  ${CWD}/.buildkite
  ${CWD}/.github
)

set(PRETTIER_EXTENSIONS
  *.jsonc?
  *.ya?ml
  *.jsx?
  *.tsx?
  *.mjs
  *.cjs
  *.mts
  *.cts
)

set(PRETTIER_GLOBS)
foreach(path ${PRETTIER_PATHS})
  foreach(extension ${PRETTIER_EXTENSIONS})
    list(APPEND PRETTIER_GLOBS ${path}/${extension})
  endforeach()
endforeach()

file(GLOB_RECURSE PRETTIER_SOURCES ${PRETTIER_GLOBS})

register_command(
  COMMAND
    ${BUN_EXECUTABLE}
      install
      --frozen-lockfile
  SOURCES
    ${CWD}/package.json
  OUTPUTS
    ${PRETTIER_EXECUTABLE}
)

set(PRETTIER_COMMAND ${PRETTIER_EXECUTABLE}
  --config=${CWD}/.prettierrc
  --cache
)

register_command(
  TARGET
    prettier
  COMMENT
    "Running prettier"
  COMMAND
    ${PRETTIER_COMMAND}
      --write
      ${PRETTIER_SOURCES}
  ALWAYS_RUN
)

register_command(
  TARGET
    prettier-extra
  COMMENT
    "Running prettier with extra plugins"
  COMMAND
    ${PRETTIER_COMMAND}
      --write
      --plugin=prettier-plugin-organize-imports
      ${PRETTIER_SOURCES}
  ALWAYS_RUN
)

register_command(
  TARGET
    prettier-check
  COMMENT
    "Checking prettier"
  COMMAND
    ${PRETTIER_COMMAND}
      --check
      ${PRETTIER_SOURCES}
  ALWAYS_RUN
)

register_command(
  TARGET
    prettier-diff
  COMMENT
    "Running prettier on changed files"
  COMMAND
    ${PRETTIER_DIFF_COMMAND}
  ALWAYS_RUN
)
