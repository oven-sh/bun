include(Macros)

find_program(
  BUN_EXECUTABLE
  NAMES bun
  PATHS ENV PATH $ENV{HOME}/.bun/bin 
  REQUIRED
)

setx(BUN_EXECUTABLE ${BUN_EXECUTABLE})

setx(ESBUILD_EXECUTABLE ${CWD}/node_modules/esbuild/bin/esbuild)

if(CMAKE_COLOR_DIAGNOSTICS)
  set(ESBUILD_ARGS --color)
endif()

register_command(
  COMMAND
    ${BUN_EXECUTABLE}
      install
      --frozen-lockfile
  SOURCES
    ${CWD}/package.json
  OUTPUTS
    ${ESBUILD_EXECUTABLE}
  BYPRODUCTS
    ${CWD}/bun.lockb
)
