include(Macros)

find_program(
  CCACHE_PROGRAM
  NAMES ccache
)

if(NOT CCACHE_PROGRAM)
  return()
endif()

set(CCACHE_ARGS CMAKE_C_COMPILER_LAUNCHER CMAKE_CXX_COMPILER_LAUNCHER)
foreach(arg ${CCACHE_ARGS})
  setx(${arg} ${CCACHE_PROGRAM})
  list(APPEND CMAKE_ARGS -D${arg}=${${arg}})
endforeach()
