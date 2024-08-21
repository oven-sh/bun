find_program(
  CCACHE_PROGRAM
  NAMES ccache
)

if(CCACHE_PROGRAM)
  set(CMAKE_CXX_COMPILER_LAUNCHER ${CCACHE_PROGRAM})
  set(CMAKE_C_COMPILER_LAUNCHER ${CCACHE_PROGRAM})
  message(STATUS "Set CCACHE_PROGRAM: ${CCACHE_PROGRAM}")
elseif(ENV{CI} STREQUAL "true")
  message(FATAL_ERROR "Did not find ccache, which is required for CI builds")
endif()
