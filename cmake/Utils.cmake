include(CMakeParseArguments)
include(ExternalProject)

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

# Set a variable, and print it to the console.
macro(setx)
  set(${ARGV})
  message(STATUS "Set ${ARGV0}: ${${ARGV0}}")
endmacro()

# setif(variable value), if value is truthy, set the variable to be ON, otherwise OFF.
macro(setif)
  if("${ARGV1}" MATCHES "^(ON|on|YES|yes|TRUE|true|1)$")
    set(${ARGV0} ON)
  else()
    set(${ARGV0} OFF)
  endif()
endmacro()

macro(setnif)
  if("${ARGV1}" MATCHES "^(OFF|off|NO|no|FALSE|false|0)$")
    set(${ARGV0} OFF)
  else()
    set(${ARGV0} ON)
  endif()
endmacro()

# optionx(variable type description [DEFAULT default] [PREVIEW value] [REGEX value] [REQUIRED])
macro(optionx variable type description)
  set(options REQUIRED)
  set(oneValueArgs DEFAULT PREVIEW REGEX)
  set(multiValueArgs)
  cmake_parse_arguments(${variable} "${options}" "${oneValueArgs}" "${multiValueArgs}" ${ARGN})

  if(NOT ${type} MATCHES "^(BOOL|STRING|FILEPATH|PATH|INTERNAL)$")
    set(${variable}_REGEX ${type})
    set(${variable}_TYPE STRING)
  else()
    set(${variable}_TYPE ${type})
  endif()

  set(${variable} ${${variable}_DEFAULT} CACHE ${${variable}_TYPE} ${description})
  set(${variable}_SOURCE "argument")
  set(${variable}_PREVIEW -D${variable})

  if(DEFINED ENV{${variable}})
    # if(DEFINED ${variable} AND NOT ${variable} STREQUAL $ENV{${variable}})
    #   message(FATAL_ERROR "Invalid ${${variable}_SOURCE}: ${${variable}_PREVIEW}=\"${${variable}}\" conflicts with environment variable ${variable}=\"$ENV{${variable}}\"")
    # endif()

    set(${variable} $ENV{${variable}} CACHE ${${variable}_TYPE} ${description} FORCE)
    set(${variable}_SOURCE "environment variable")
    set(${variable}_PREVIEW ${variable})
  endif()

  if("${${variable}}" STREQUAL "" AND ${${variable}_REQUIRED})
    message(FATAL_ERROR "Required ${${variable}_SOURCE} is missing: please set, ${${variable}_PREVIEW}=<${${variable}_REGEX}>")
  endif()

  if(${type} STREQUAL "BOOL")
    if("${${variable}}" MATCHES "^(TRUE|true|ON|on|YES|yes|1)$")
      set(${variable} ON)
    elseif("${${variable}}" MATCHES "^(FALSE|false|OFF|off|NO|no|0)$")
      set(${variable} OFF)
    else()
      message(FATAL_ERROR "Invalid ${${variable}_SOURCE}: ${${variable}_PREVIEW}=\"${${variable}}\", please use ${${variable}_PREVIEW}=<ON|OFF>")
    endif()
  endif()

  if(DEFINED ${variable}_REGEX AND NOT "^(${${variable}_REGEX})$" MATCHES "${${variable}}")
    message(FATAL_ERROR "Invalid ${${variable}_SOURCE}: ${${variable}_PREVIEW}=\"${${variable}}\", please use ${${variable}_PREVIEW}=<${${variable}_REGEX}>")
  endif()

  message(STATUS "Set ${variable}: ${${variable}}")
endmacro()

macro(parse_option label type description)
  set(default "${ARGN}")

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
      message(FATAL_ERROR "Invalid ${${label}_SOURCE}: ${${label}_PREVIEW}=\"${${label}}\" conflicts with environment variable ${label}=\"$ENV{${label}}\"")
    endif()

    set(${label} $ENV{${label}} CACHE ${${label}_TYPE} "${description}" FORCE)
    set(${label}_SOURCE "environment variable")
    set(${label}_PREVIEW "${label}")
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
  if(${value} MATCHES "^(${regex})$")
    set(${label} TRUE)
  else()
    set(${label} FALSE)
  endif()
endmacro()

function(file_size file_path variable)
  file(SIZE ${file_path} file_size)
  
  set(units "B" "KB" "MB" "GB" "TB")
  set(unit_index 0)
  
  while(filesize GREATER 1024 AND unit_index LESS 4)
    math(EXPR file_size "${file_size} / 1024")
    math(EXPR unit_index "${unit_index} + 1")
  endwhile()
  
  list(GET units ${unit_index} unit)
  set(${variable} "${file_size} ${unit}" PARENT_SCOPE)
endfunction()

macro(find_llvm_program variable program_name)
  set(args OPTIONAL)
  cmake_parse_arguments(ARG "${args}" "" "" ${ARGN})

  set(${variable}_NAMES
    ${program_name}
    ${program_name}-${LLVM_VERSION_MAJOR}
    ${program_name}-${LLVM_VERSION}
  )

  find_program(
    ${variable}
    NAMES ${${variable}_NAMES}
    PATHS ENV PATH ${LLVM_PATH}
    VALIDATOR check_llvm_version
  )

  if(NOT ${variable})
    if(ARG_OPTIONAL)
      return()
    endif()
    if(CMAKE_HOST_APPLE)
      set(LLVM_INSTALL_COMMAND "brew install llvm@${LLVM_VERSION_MAJOR} --force")
    elseif(CMAKE_HOST_WIN32)
      set(LLVM_INSTALL_COMMAND "choco install llvm@${LLVM_VERSION}")
    else()
      set(LLVM_INSTALL_COMMAND "curl -fsSL https://apt.llvm.org/llvm.sh | bash -s ${LLVM_VERSION}")
    endif()
    message(FATAL_ERROR "Command not found: ${program_name}\n"
      "Do you have LLVM ${LLVM_VERSION} installed? To fix this, try running:\n"
      "   ${LLVM_INSTALL_COMMAND}\n")
  endif()

  list(APPEND CMAKE_ARGS "-D${variable}=${${variable}}")
  message(STATUS "Set ${variable}: ${${variable}}")
endmacro()
