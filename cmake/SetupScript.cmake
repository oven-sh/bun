# Include this when you want the CMake file to be a standalone script.

include(CMakeParseArguments)

math(EXPR ARGC "${CMAKE_ARGC} - 1")
foreach(i RANGE 1 ${ARGC})
  set(ARGV${i} ${CMAKE_ARGV${i}})

  if(ARGV${i} MATCHES "^-D(.*)=(.*)$")
    set(${CMAKE_MATCH_1} ${CMAKE_MATCH_2})
    message(STATUS "Set ${CMAKE_MATCH_1}: ${${CMAKE_MATCH_1}}")
  endif()
endforeach()
