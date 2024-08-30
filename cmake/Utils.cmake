include(CMakeParseArguments)

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

macro(add_target)
  set(options NODE_MODULES)
  set(args NAME COMMENT WORKING_DIRECTORY)
  set(multiArgs ALIASES COMMAND DEPENDS SOURCES OUTPUTS ARTIFACTS)
  cmake_parse_arguments(ARG "${options}" "${args}" "${multiArgs}" ${ARGN})

  if(NOT ARG_NAME)
    message(FATAL_ERROR "add_target: NAME is required")
  endif()

  if(NOT ARG_COMMAND)
    message(FATAL_ERROR "add_target: COMMAND is required")
  endif()

  if(NOT ARG_COMMENT)
    set(ARG_COMMENT "Running ${ARG_NAME}")
  endif()

  if(NOT ARG_WORKING_DIRECTORY)
    set(ARG_WORKING_DIRECTORY ${CWD})
  endif()

  if(ARG_NODE_MODULES)
    get_filename_component(ARG_INSTALL_NAME ${ARG_WORKING_DIRECTORY} NAME_WE)
    list(APPEND ARG_DEPENDS bun-install-${ARG_INSTALL_NAME})
  endif()

  add_custom_command(
    VERBATIM COMMAND
      ${ARG_COMMAND}
    WORKING_DIRECTORY
      ${ARG_WORKING_DIRECTORY}
    OUTPUT
      ${ARG_OUTPUTS}
    DEPENDS
      ${ARG_SOURCES}
      ${ARG_DEPENDS}
  )

  add_custom_target(${ARG_NAME}
    COMMENT
      ${ARG_COMMENT}
    DEPENDS
      ${ARG_DEPENDS}
    SOURCES
      ${ARG_SOURCES}
  )

  foreach(artifact ${ARG_ARTIFACTS})
    upload_artifact(
      NAME
        ${artifact}
    )
  endforeach()

  foreach(alias ${ARG_ALIASES})
    if(NOT TARGET ${alias})
      add_custom_target(${alias} DEPENDS ${ARG_NAME})
    else()
      add_dependencies(${alias} ${ARG_NAME})
    endif()
  endforeach()
endmacro()

macro(add_bun_install)
  set(args WORKING_DIRECTORY)
  cmake_parse_arguments(ARG "" "${args}" "" ${ARGN})

  if(NOT ARG_WORKING_DIRECTORY)
    message(FATAL_ERROR "add_bun_install: WORKING_DIRECTORY is required")
  endif()

  if(ARG_WORKING_DIRECTORY STREQUAL ${CWD})
    set(ARG_COMMENT "bun install")
  else()
    set(ARG_COMMENT "bun install --cwd ${ARG_WORKING_DIRECTORY}")
  endif()

  get_filename_component(ARG_NAME ${ARG_WORKING_DIRECTORY} NAME_WE)
  add_target(
    NAME
      bun-install-${ARG_NAME}
    ALIASES
      bun-install
    COMMAND
      ${BUN_EXECUTABLE}
        install
        --frozen-lockfile
    WORKING_DIRECTORY
      ${ARG_WORKING_DIRECTORY}
    SOURCES
      ${CWD}/package.json
    OUTPUTS
      ${CWD}/bun.lockb
      ${CWD}/node_modules
  )
endmacro()

macro(upload_artifact)
  set(args NAME WORKING_DIRECTORY)
  cmake_parse_arguments(ARTIFACT "" "${args}" "" ${ARGN})

  if(NOT ARTIFACT_NAME)
    message(FATAL_ERROR "upload_artifact: NAME is required")
  endif()

  if(NOT ARTIFACT_WORKING_DIRECTORY)
    set(ARTIFACT_WORKING_DIRECTORY ${BUILD_PATH})
  endif()

  if(ARTIFACT_NAME MATCHES "^${ARTIFACT_WORKING_DIRECTORY}")
    file(RELATIVE_PATH ARTIFACT_NAME ${ARTIFACT_WORKING_DIRECTORY} ${ARTIFACT_NAME})
  endif()

  if(BUILDKITE)
    set(ARTIFACT_UPLOAD_COMMAND
      buildkite-agent
        artifact
        upload
        ${ARTIFACT_NAME}
    )
  else()
    set(ARTIFACT_UPLOAD_COMMAND
      ${CMAKE_COMMAND}
        -E copy
        ${ARTIFACT_NAME}
        ${BUILD_PATH}/artifacts/${ARTIFACT_NAME}
    )
  endif()

  get_filename_component(ARTIFACT_FILENAME ${ARTIFACT_NAME} NAME_WE)
  add_target(
    NAME
      upload-${ARTIFACT_FILENAME}
    COMMENT
      "Uploading ${ARTIFACT_NAME}"
    COMMAND
      ${ARTIFACT_UPLOAD_COMMAND}
    WORKING_DIRECTORY
      ${ARTIFACT_WORKING_DIRECTORY}
  )
endmacro()