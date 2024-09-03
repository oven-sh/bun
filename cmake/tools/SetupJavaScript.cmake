include(Macros)

find_program(
  BUN_EXECUTABLE
  NAMES bun
  PATHS ENV PATH $ENV{HOME}/.bun/bin 
  REQUIRED
)

setx(BUN_EXECUTABLE ${BUN_EXECUTABLE})

if(CMAKE_HOST_WIN32)
  setx(ESBUILD_EXECUTABLE ${CWD}/node_modules/esbuild/bin/esbuild.cmd)
else()
  setx(ESBUILD_EXECUTABLE ${CWD}/node_modules/esbuild/bin/esbuild)
endif()

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
