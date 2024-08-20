function(parse_semver value variable)
  string(REGEX MATCH "([0-9]+)\\.([0-9]+)\\.([0-9]+)" match "${value}")
  
  if(NOT match)
    message(FATAL_ERROR "Invalid semver: \"${value}\"")
  endif()
  
  set(${variable}_VERSION "${CMAKE_MATCH_1}.${CMAKE_MATCH_2}.${CMAKE_MATCH_3}" PARENT_SCOPE)
  set(${variable}_VERSION_MAJOR "${CMAKE_MATCH_1}" PARENT_SCOPE)
  set(${variable}_VERSION_MINOR "${CMAKE_MATCH_2}" PARENT_SCOPE)
  set(${variable}_VERSION_PATCH "${CMAKE_MATCH_3}" PARENT_SCOPE)
endfunction()

function(get_major_version version variable)
  string(REGEX MATCH "^([0-9]+)" major_version ${version})
  set(${variable} ${major_version} PARENT_SCOPE)
endfunction()

macro(parse_option label type description default)
  if(NOT ${type} MATCHES "^(BOOL|STRING|FILEPATH|PATH|INTERNAL)$")
    set(${label}_REGEX "${type}")
    set(${label}_TYPE STRING)
  else()
    set(${label}_TYPE ${type})
  endif()

  set(${label} ${default} CACHE ${${label}_TYPE} "${description}")
  set(${label}_SOURCE "argument")
  set(${label}_PREVIEW "-D${label}")

  if(DEFINED ENV{${label}})
    if(DEFINED ${label} AND NOT ${label} STREQUAL $ENV{${label}})
      message(WARNING "Invalid ${${label}_SOURCE}: ${${label}_PREVIEW}=\"${${label}}\" conflicts with environment variable ${label}=\"$ENV{${label}}\"")
    endif()

    # TODO: restore after everything is ported to CMake, also change to FATAL_ERROR
    # set(${label} $ENV{${label}} CACHE ${${label}_TYPE} "${description}" FORCE)
    # set(${label}_SOURCE "environment variable")
    # set(${label}_PREVIEW "${label}")
  endif()

  if("${${label}}" STREQUAL "" AND ${default} STREQUAL "REQUIRED")
    message(FATAL_ERROR "Required ${${label}_SOURCE} is missing: please set, ${${label}_PREVIEW}=<${${label}_REGEX}>")
  endif()

  if(${type} STREQUAL "BOOL")
    if(${${label}} MATCHES "^(TRUE|ON|YES|1)$")
      set(${label} ON)
    elseif(${${label}} MATCHES "^(FALSE|OFF|NO|0)$")
      set(${label} OFF)
    else()
      message(FATAL_ERROR "Invalid ${${label}_SOURCE}: ${${label}_PREVIEW}=\"${${label}}\", please use ${${label}_PREVIEW}=<ON|OFF>")
    endif()
  endif()

  if(DEFINED ${label}_REGEX AND NOT "^(${${label}_REGEX})$" MATCHES "${${label}}")
    message(FATAL_ERROR "Invalid ${${label}_SOURCE}: ${${label}_PREVIEW}=\"${${label}}\", please use ${${label}_PREVIEW}=<${${label}_REGEX}>")
  endif()

  message(STATUS "Set ${label}: ${${label}}")
endmacro()

macro(set_if label regex value)
  if(VALUE MATCHES "^(${regex})$")
    set(${label} TRUE)
  else()
    set(${label} FALSE)
  endif()
endmacro()

function(check_version found executable)
  set(${found} FALSE PARENT_SCOPE)

  execute_process(
    COMMAND ${executable} --version
    RESULT_VARIABLE result
    OUTPUT_VARIABLE output
    OUTPUT_STRIP_TRAILING_WHITESPACE
  )

  if(NOT result EQUAL 0)
    message(DEBUG "Checking ${executable} (expected \"${LLVM_VERSION}\", exited with \"${result}\")")
    return()
  endif()

  parse_semver("${output}" executable)
  if(NOT executable_VERSION STREQUAL LLVM_VERSION)
    message(DEBUG "Checking ${executable} (expected \"${LLVM_VERSION}\", received \"${executable_VERSION}\")")
    return()
  endif()

  set(${found} TRUE PARENT_SCOPE)
endfunction()
