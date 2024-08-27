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
    if(DEFINED ${variable} AND NOT ${variable} STREQUAL $ENV{${variable}})
      message(FATAL_ERROR "Invalid ${${variable}_SOURCE}: ${${variable}_PREVIEW}=\"${${variable}}\" conflicts with environment variable ${variable}=\"$ENV{${variable}}\"")
    endif()

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

macro(build_dependency)
  set(args NAME REPOSITORY TAG LIB)
  set(multi_args LIBRARIES INCLUDES CMAKE_ARGS)
  cmake_parse_arguments(ARG "" "${args}" "${multi_args}" ${ARGN})

  if(NOT DEFINED ARG_NAME)
    message(FATAL_ERROR "build_dependency: NAME is required")
  endif()

  set(DEP_LABEL ${ARG_NAME})
  string(TOUPPER ${DEP_LABEL} DEP_NAME)

  parse_option(USE_CUSTOM_${DEP_NAME} BOOL "Use custom ${DEP_LABEL} build" OFF)

  if(USE_CUSTOM_${DEP_NAME})
    set(DEFAULT_${DEP_NAME}_SOURCE_PATH ${CWD}/src/deps/${DEP_LABEL})
    if(NOT EXISTS ${DEFAULT_${DEP_NAME}_SOURCE_PATH})
      message(FATAL_ERROR "build_dependency: USE_CUSTOM_${DEP_NAME} is set but ${DEFAULT_${DEP_NAME}_SOURCE_PATH} does not exist")
    endif()
  else()
    set(DEFAULT_${DEP_NAME}_SOURCE_PATH ${CWD}/src/deps/${DEP_LABEL})
  endif()

  parse_option(${DEP_NAME}_SOURCE_PATH FILEPATH "Path to the ${DEP_LABEL} source" ${DEFAULT_${DEP_NAME}_SOURCE_PATH})
  parse_option(${DEP_NAME}_BUILD_PATH FILEPATH "Path to the ${DEP_LABEL} build" ${BUILD_PATH}/${DEP_LABEL})

  set(${DEP_NAME}_CMAKE_ARGS ${CMAKE_ARGS} ${ARG_CMAKE_ARGS})
  set(${DEP_NAME}_PROJECT_ARGS ${DEP_LABEL}-external
    PREFIX ${DEP_LABEL}
    SOURCE_DIR ${${DEP_NAME}_SOURCE_PATH}
    BINARY_DIR ${${DEP_NAME}_BUILD_PATH}
    CMAKE_ARGS ${${DEP_NAME}_CMAKE_ARGS}
    INSTALL_COMMAND "echo" # No installs
  )

  if(ARG_REPOSITORY AND ARG_TAG)
    list(APPEND ${DEP_NAME}_PROJECT_ARGS
      GIT_REPOSITORY ${ARG_REPOSITORY}
      GIT_TAG ${ARG_TAG}
    )
  else()
    message(FATAL_ERROR "build_dependency: REPOSITORY and TAG are required")
  endif()

  ExternalProject_Add(${${DEP_NAME}_PROJECT_ARGS})

  set(${DEP_NAME}_INCLUDE_PATHS)
  foreach(include ${ARG_INCLUDES})
    set(include_path ${${DEP_NAME}_SOURCE_PATH}/${include})
    if(NOT EXISTS ${include_path})
      message(FATAL_ERROR "build_dependency: INCLUDES contains \"${include}\" but \"${include_path}\" does not exist")
    endif()
    list(APPEND ${DEP_NAME}_INCLUDE_PATHS ${include_path})
  endforeach()
  
  if(ARG_LIB)
    set(${DEP_NAME}_LIB_PATH ${${DEP_NAME}_BUILD_PATH}/${ARG_LIB})
  else()
    set(${DEP_NAME}_LIB_PATH ${${DEP_NAME}_BUILD_PATH})
  endif()

  set(${DEP_NAME}_LIBRARY_PATHS)
  foreach(lib ${ARG_LIBRARIES})
    set(lib_path ${${DEP_NAME}_LIB_PATH}/${CMAKE_STATIC_LIBRARY_PREFIX}${lib}${CMAKE_STATIC_LIBRARY_SUFFIX})
    list(APPEND ${DEP_NAME}_LIBRARY_PATHS ${lib_path})
  endforeach()

  add_library(${DEP_LABEL}-lib INTERFACE)
  add_dependencies(${DEP_LABEL}-lib ${DEP_LABEL}-external)
  add_custom_target(${DEP_LABEL} DEPENDS ${DEP_LABEL}-lib)

  target_include_directories(${DEP_LABEL}-lib INTERFACE ${${DEP_NAME}_INCLUDE_PATHS})
  include_directories(${${DEP_NAME}_INCLUDE_PATHS})

  target_link_libraries(${DEP_LABEL}-lib INTERFACE ${${DEP_NAME}_LIBRARY_PATHS})
  target_link_libraries(${bun} PRIVATE ${DEP_LABEL}-lib)
endmacro()
