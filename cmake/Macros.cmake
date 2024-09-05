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

# setx()
# Description:
#   Sets a variable, similar to `set()`, but also prints the value.
# Arguments:
#   variable string - The variable to set
#   value    string - The value to set the variable to
macro(setx)
  set(${ARGV})
  message(STATUS "Set ${ARGV0}: ${${ARGV0}}")
endmacro()

# optionx()
# Description:
#   Defines an option, similar to `option()`, but allows for bool, string, and regex types.
# Arguments:
#   variable    string - The variable to set
#   type        string - The type of the variable
#   description string - The description of the variable
#   DEFAULT     string - The default value of the variable
#   PREVIEW     string - The preview value of the variable
#   REGEX       string - The regex to match the value
#   REQUIRED    bool   - Whether the variable is required
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

  if(NOT ${variable} AND ${${variable}_REQUIRED})
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

# check_command()
# Description:
#   Checks if a command is available, used by `find_command()` as a validator.
# Arguments:
#   FOUND bool   - The variable to set to true if the version is found
#   CMD   string - The executable to check the version of
function(check_command FOUND CMD)
  set(${FOUND} OFF PARENT_SCOPE)

  if(${CMD} MATCHES "zig")
    set(CHECK_COMMAND ${CMD} version)
  else()
    set(CHECK_COMMAND ${CMD} --version)
  endif()

  execute_process(
    COMMAND ${CHECK_COMMAND}
    RESULT_VARIABLE RESULT
    OUTPUT_VARIABLE OUTPUT
    OUTPUT_STRIP_TRAILING_WHITESPACE
  )

  if(NOT RESULT EQUAL 0)
    message(DEBUG "${CHECK_COMMAND}, exited with code ${RESULT}")
    return()
  endif()

  parse_semver(${OUTPUT} CMD)
  parse_semver(${CHECK_COMMAND_VERSION} CHECK)

  if(CHECK_COMMAND_VERSION MATCHES ">=")
    if(NOT CMD_VERSION VERSION_GREATER_EQUAL ${CHECK_VERSION})
      message(DEBUG "${CHECK_COMMAND}, actual: ${CMD_VERSION}, expected: ${CHECK_COMMAND_VERSION}")
      return()
    endif()
  elseif(CHECK_COMMAND_VERSION MATCHES ">")
    if(NOT CMD_VERSION VERSION_GREATER ${CHECK_VERSION})
      message(DEBUG "${CHECK_COMMAND}, actual: ${CMD_VERSION}, expected: ${CHECK_COMMAND_VERSION}")
      return()
    endif()
  else()
    if(NOT CMD_VERSION VERSION_EQUAL ${CHECK_VERSION})
      message(DEBUG "${CHECK_COMMAND}, actual: ${CMD_VERSION}, expected: =${CHECK_COMMAND_VERSION}")
      return()
    endif()
  endif()

  set(${FOUND} TRUE PARENT_SCOPE)
endfunction()

# find_command()
# Description:
#   Finds a command, similar to `find_program()`, but allows for version checking.
# Arguments:
#   VARIABLE  string   - The variable to set
#   COMMAND   string[] - The names of the command to find
#   PATHS     string[] - The paths to search for the command
#   REQUIRED  bool     - If false, the command is optional
#   VERSION   string   - The version of the command to find (e.g. "1.2.3" or ">1.2.3")
function(find_command)
  set(options)
  set(args VARIABLE VERSION MIN_VERSION REQUIRED)
  set(multiArgs COMMAND PATHS)
  cmake_parse_arguments(CMD "${options}" "${args}" "${multiArgs}" ${ARGN})

  if(NOT CMD_VARIABLE)
    message(FATAL_ERROR "find_command: VARIABLE is required")
  endif()

  if(NOT CMD_COMMAND)
    message(FATAL_ERROR "find_command: COMMAND is required")
  endif()

  if(CMD_VERSION)
    set(CHECK_COMMAND_VERSION ${CMD_VERSION}) # special global variable
    set(CMD_VALIDATOR VALIDATOR check_command)
  endif()

  find_program(
    ${CMD_VARIABLE}
    NAMES ${CMD_COMMAND}
    PATHS ${CMD_PATHS}
    ${CMD_VALIDATOR}
  )

  if(NOT CMD_REQUIRED STREQUAL "OFF" AND ${CMD_VARIABLE} MATCHES "NOTFOUND")
    if(CMD_VERSION)
      message(FATAL_ERROR "Command not found: \"${CMD_COMMAND}\" that matches version \"${CHECK_COMMAND_VERSION}\"")
    endif()
    message(FATAL_ERROR "Command not found: \"${CMD_COMMAND}\"")
  endif()

  setx(${CMD_VARIABLE} ${${CMD_VARIABLE}})
endfunction()

# register_command()
# Description:
#   Registers a command, similar to `add_custom_command()`, but has more validation and features.
# Arguments:
#   COMMAND      string[] - The command to run
#   COMMENT      string   - The comment to display in the log
#   CWD          string   - The working directory to run the command in
#   ENVIRONMENT  string[] - The environment variables to set (e.g. "DEBUG=1")
#   TARGETS      string[] - The targets that this command depends on
#   SOURCES      string[] - The files that this command depends on
#   OUTPUTS      string[] - The files that this command produces
#   ARTIFACTS    string[] - The files that this command produces, and uploads as an artifact in CI
#   ALWAYS_RUN   bool     - If true, the command will always run
#   TARGET       string   - The target to register the command with
#   TARGET_PHASE string   - The target phase to register the command with (e.g. PRE_BUILD, PRE_LINK, POST_BUILD)
#   GROUP        string   - The group to register the command with (e.g. similar to JOB_POOL)
function(register_command)
  set(options ALWAYS_RUN)
  set(args COMMENT CWD TARGET TARGET_PHASE GROUP)
  set(multiArgs COMMAND ENVIRONMENT TARGETS SOURCES OUTPUTS ARTIFACTS)
  cmake_parse_arguments(CMD "${options}" "${args}" "${multiArgs}" ${ARGN})

  if(NOT CMD_COMMAND)
    message(FATAL_ERROR "register_command: COMMAND is required")
  endif()

  if(NOT CMD_CWD)
    set(CMD_CWD ${CWD})
  endif()

  if(CMD_ENVIRONMENT)
    set(CMD_COMMAND ${CMAKE_COMMAND} -E env ${CMD_ENVIRONMENT} ${CMD_COMMAND})
  endif()
  
  if(NOT CMD_COMMENT)
    string(JOIN " " CMD_COMMENT ${CMD_COMMAND})
  endif()

  set(CMD_COMMANDS COMMAND ${CMD_COMMAND})
  set(CMD_EFFECTIVE_DEPENDS)

  list(GET CMD_COMMAND 0 CMD_EXECUTABLE)
  if(CMD_EXECUTABLE MATCHES "/|\\\\")
    list(APPEND CMD_EFFECTIVE_DEPENDS ${CMD_EXECUTABLE})
  endif()

  foreach(target ${CMD_TARGETS})
    if(target MATCHES "/|\\\\")
      message(FATAL_ERROR "register_command: TARGETS contains \"${target}\", if it's a path add it to SOURCES instead")
    endif()
    if(NOT TARGET ${target})
      message(FATAL_ERROR "register_command: TARGETS contains \"${target}\", but it's not a target")
    endif()
    list(APPEND CMD_EFFECTIVE_DEPENDS ${target})
  endforeach()

  foreach(source ${CMD_SOURCES})
    if(NOT source MATCHES "^(${CWD}|${BUILD_PATH})")
      message(FATAL_ERROR "register_command: SOURCES contains \"${source}\", if it's a path, make it absolute, otherwise add it to TARGETS instead")
    endif()
    list(APPEND CMD_EFFECTIVE_DEPENDS ${source})
  endforeach()

  if(NOT CMD_EFFECTIVE_DEPENDS AND NOT CMD_ALWAYS_RUN)
    message(FATAL_ERROR "register_command: TARGETS or SOURCES is required")
  endif()

  set(CMD_EFFECTIVE_OUTPUTS)

  foreach(output ${CMD_OUTPUTS})
    if(NOT output MATCHES "^(${CWD}|${BUILD_PATH})")
      message(FATAL_ERROR "register_command: OUTPUTS contains \"${output}\", if it's a path, make it absolute")
    endif()
    list(APPEND CMD_EFFECTIVE_OUTPUTS ${output})
  endforeach()

  foreach(artifact ${CMD_ARTIFACTS})
    if(NOT artifact MATCHES "^(${CWD}|${BUILD_PATH})")
      message(FATAL_ERROR "register_command: ARTIFACTS contains \"${artifact}\", if it's a path, make it absolute")
    endif()
    list(APPEND CMD_EFFECTIVE_OUTPUTS ${artifact})
    if(BUILDKITE)
      file(RELATIVE_PATH filename ${BUILD_PATH} ${artifact})
      list(APPEND CMD_COMMANDS COMMAND ${CMAKE_COMMAND} -E chdir ${BUILD_PATH} buildkite-agent artifact upload ${filename})
    endif()
  endforeach()

  foreach(output ${CMD_EFFECTIVE_OUTPUTS})
    get_source_file_property(generated ${output} GENERATED)
    if(generated)
      list(REMOVE_ITEM CMD_EFFECTIVE_OUTPUTS ${output})
      list(APPEND CMD_EFFECTIVE_OUTPUTS ${output}.always_run)
    endif()
  endforeach()

  if(CMD_ALWAYS_RUN)
    list(APPEND CMD_EFFECTIVE_OUTPUTS ${CMD_CWD}/.always_run)
  endif()

  if(CMD_TARGET_PHASE)
    if(NOT CMD_TARGET)
      message(FATAL_ERROR "register_command: TARGET is required when TARGET_PHASE is set")
    endif()
    if(NOT TARGET ${CMD_TARGET})
      message(FATAL_ERROR "register_command: TARGET is not a valid target: ${CMD_TARGET}")
    endif()
    add_custom_command(
      TARGET ${CMD_TARGET} ${CMD_TARGET_PHASE}
      COMMENT ${CMD_COMMENT}
      WORKING_DIRECTORY ${CMD_CWD}
      VERBATIM ${CMD_COMMANDS}
    )
    set_property(TARGET ${CMD_TARGET} PROPERTY OUTPUT ${CMD_EFFECTIVE_OUTPUTS} APPEND)
    set_property(TARGET ${CMD_TARGET} PROPERTY DEPENDS ${CMD_EFFECTIVE_DEPENDS} APPEND)
    return()
  endif()

  if(NOT CMD_EFFECTIVE_OUTPUTS)
    message(FATAL_ERROR "register_command: OUTPUTS or ARTIFACTS is required, or set ALWAYS_RUN")
  endif()

  if(CMD_TARGET)
    if(TARGET ${CMD_TARGET})
      message(FATAL_ERROR "register_command: TARGET is already registered: ${CMD_TARGET}")
    endif()
    add_custom_target(${CMD_TARGET}
      COMMENT ${CMD_COMMENT}
      DEPENDS ${CMD_EFFECTIVE_OUTPUTS}
      JOB_POOL ${CMD_GROUP}
    )
    if(TARGET clone-${CMD_TARGET})
      add_dependencies(${CMD_TARGET} clone-${CMD_TARGET})
    endif()
  endif()

  add_custom_command(
    VERBATIM ${CMD_COMMANDS}
    WORKING_DIRECTORY ${CMD_CWD}
    COMMENT ${CMD_COMMENT}
    DEPENDS ${CMD_EFFECTIVE_DEPENDS}
    OUTPUT ${CMD_EFFECTIVE_OUTPUTS}
    JOB_POOL ${CMD_GROUP}
  )
endfunction()

# parse_package_json()
# Description:
#   Parses a package.json file.
# Arguments:
#   CWD                   string - The directory to look for the package.json file
#   VERSION_VARIABLE      string - The variable to set to the package version
#   NODE_MODULES_VARIABLE string - The variable to set to list of node_modules sources
function(parse_package_json)
  set(args CWD VERSION_VARIABLE NODE_MODULES_VARIABLE)
  cmake_parse_arguments(NPM "" "${args}" "" ${ARGN})

  if(NOT NPM_CWD)
    set(NPM_CWD ${CWD})
  endif()

  set(NPM_PACKAGE_JSON_PATH ${NPM_CWD}/package.json)

  if(NOT EXISTS ${NPM_PACKAGE_JSON_PATH})
    message(FATAL_ERROR "parse_package_json: package.json not found: ${NPM_PACKAGE_JSON_PATH}")
  endif()

  file(READ ${NPM_PACKAGE_JSON_PATH} NPM_PACKAGE_JSON)
  if(NOT NPM_PACKAGE_JSON)
    message(FATAL_ERROR "parse_package_json: failed to read package.json: ${NPM_PACKAGE_JSON_PATH}")
  endif()

  if(NPM_VERSION_VARIABLE)
    string(JSON NPM_VERSION ERROR_VARIABLE error GET "${NPM_PACKAGE_JSON}" version)
    if(error)
      message(FATAL_ERROR "parse_package_json: failed to read 'version': ${error}")
    endif()
    set(${NPM_VERSION_VARIABLE} ${NPM_VERSION} PARENT_SCOPE)
  endif()

  if(NPM_NODE_MODULES_VARIABLE)
    set(NPM_NODE_MODULES)
    set(NPM_NODE_MODULES_PATH ${NPM_CWD}/node_modules)
    set(NPM_NODE_MODULES_PROPERTIES "devDependencies" "dependencies")
    
    foreach(property ${NPM_NODE_MODULES_PROPERTIES})
      string(JSON NPM_${property} ERROR_VARIABLE error GET "${NPM_PACKAGE_JSON}" "${property}")
      if(error MATCHES "not found")
        continue()
      endif()
      if(error)
        message(FATAL_ERROR "parse_package_json: failed to read '${property}': ${error}")
      endif()

      string(JSON NPM_${property}_LENGTH ERROR_VARIABLE error LENGTH "${NPM_${property}}")
      if(error)
        message(FATAL_ERROR "parse_package_json: failed to read '${property}' length: ${error}")
      endif()

      math(EXPR NPM_${property}_MAX_INDEX "${NPM_${property}_LENGTH} - 1")
      foreach(i RANGE 0 ${NPM_${property}_MAX_INDEX})
        string(JSON NPM_${property}_${i} ERROR_VARIABLE error MEMBER "${NPM_${property}}" ${i})
        if(error)
          message(FATAL_ERROR "parse_package_json: failed to index '${property}' at ${i}: ${error}")
        endif()
        list(APPEND NPM_NODE_MODULES ${NPM_NODE_MODULES_PATH}/${NPM_${property}_${i}}/package.json)
      endforeach()
    endforeach()

    set(${NPM_NODE_MODULES_VARIABLE} ${NPM_NODE_MODULES} PARENT_SCOPE)
  endif()
endfunction()

# register_bun_install()
# Description:
#   Registers a command to run `bun install` in a directory.
# Arguments:
#   CWD                   string - The directory to run `bun install`
#   NODE_MODULES_VARIABLE string - The variable to set to list of node_modules sources
function(register_bun_install)
  set(args CWD NODE_MODULES_VARIABLE)
  cmake_parse_arguments(NPM "" "${args}" "" ${ARGN})

  if(NOT NPM_CWD)
    set(NPM_CWD ${CWD})
  endif()

  if(NPM_CWD STREQUAL ${CWD})
    set(NPM_COMMENT "bun install")
  else()
    set(NPM_COMMENT "bun install --cwd ${NPM_CWD}")
  endif()

  parse_package_json(
    CWD
      ${NPM_CWD}
    NODE_MODULES_VARIABLE
      NPM_NODE_MODULES
  )

  if(NOT NPM_NODE_MODULES)
    message(FATAL_ERROR "register_bun_install: package.json does not have dependencies?")
  endif()

  register_command(
    COMMENT
      ${NPM_COMMENT}
    CWD
      ${NPM_CWD}
    COMMAND
      ${BUN_EXECUTABLE}
        install
        --frozen-lockfile
    SOURCES
      ${NPM_CWD}/package.json
    OUTPUTS
      ${NPM_NODE_MODULES}
  )

  set(${NPM_NODE_MODULES_VARIABLE} ${NPM_NODE_MODULES} PARENT_SCOPE)
endfunction()

# register_repository()
# Description:
#   Registers a git repository.
# Arguments:
#   NAME       string - The name of the repository
#   REPOSITORY string - The repository to clone
#   BRANCH     string - The branch to clone
#   TAG        string - The tag to clone
#   COMMIT     string - The commit to clone
#   PATH       string - The path to clone the repository to
#   OUTPUTS    string - The outputs of the repository
function(register_repository)
  set(args NAME REPOSITORY BRANCH TAG COMMIT PATH)
  set(multiArgs OUTPUTS)
  cmake_parse_arguments(GIT "" "${args}" "${multiArgs}" ${ARGN})

  if(NOT GIT_REPOSITORY)
    message(FATAL_ERROR "git_clone: REPOSITORY is required")
  endif()

  if(NOT GIT_BRANCH AND NOT GIT_TAG AND NOT GIT_COMMIT)
    message(FATAL_ERROR "git_clone: COMMIT, TAG, or BRANCH is required")
  endif()

  if(NOT GIT_PATH)
    set(GIT_PATH ${CWD}/src/deps/${GIT_NAME})
  endif()

  if(GIT_COMMIT)
    set(GIT_REF ${GIT_COMMIT})
  elseif(GIT_TAG)
    set(GIT_REF refs/tags/${GIT_TAG})
  else()
    set(GIT_REF refs/heads/${GIT_BRANCH})
  endif()

  set(GIT_EFFECTIVE_OUTPUTS)
  foreach(output ${GIT_OUTPUTS})
    list(APPEND GIT_EFFECTIVE_OUTPUTS ${GIT_PATH}/${output})
  endforeach()

  register_command(
    TARGET
      clone-${GIT_NAME}
    COMMENT
      "Cloning ${GIT_NAME}"
    COMMAND
      ${CMAKE_COMMAND}
        -P ${CWD}/cmake/scripts/GitClone.cmake
        -DGIT_PATH=${GIT_PATH}
        -DGIT_REPOSITORY=${GIT_REPOSITORY}
        -DGIT_REF=${GIT_REF}
        -DGIT_NAME=${GIT_NAME}
    OUTPUTS
      ${GIT_PATH}
      ${GIT_EFFECTIVE_OUTPUTS}
  )
endfunction()

# register_cmake_command()
# Description:
#   Registers a command that builds an external CMake project.
# Arguments:
#   TARGET                    string   - The target to register the command with
#   ARGS                      string[] - The arguments to pass to CMake (e.g. -DKEY=VALUE)
#   CWD                       string   - The directory where the CMake files are located
#   BUILD_PATH                string   - The path to build the project to
#   LIB_PATH                  string   - The path to the libraries
#   TARGETS                   string[] - The targets to build from CMake
#   LIBRARIES                 string[] - The libraries that are built
#   INCLUDES                  string[] - The include paths
function(register_cmake_command)
  set(args TARGET CWD BUILD_PATH LIB_PATH)
  set(multiArgs ARGS TARGETS LIBRARIES INCLUDES)
  # Use "MAKE" instead of "CMAKE" to prevent conflicts with CMake's own CMAKE_* variables
  cmake_parse_arguments(MAKE "" "${args}" "${multiArgs}" ${ARGN})

  if(NOT MAKE_TARGET)
    message(FATAL_ERROR "register_cmake_command: TARGET is required")
  endif()

  if(TARGET ${MAKE_TARGET})
    message(FATAL_ERROR "register_cmake_command: TARGET is already a target: ${MAKE_TARGET}")
  endif()

  if(NOT MAKE_CWD)
    set(MAKE_CWD ${CWD}/src/deps/${MAKE_TARGET})
  endif()

  if(NOT MAKE_BUILD_PATH)
    set(MAKE_BUILD_PATH ${BUILD_PATH}/${MAKE_TARGET})
  endif()

  if(MAKE_LIB_PATH)
    set(MAKE_LIB_PATH ${MAKE_BUILD_PATH}/${MAKE_LIB_PATH})
  else()
    set(MAKE_LIB_PATH ${MAKE_BUILD_PATH})
  endif()

  set(MAKE_EFFECTIVE_ARGS -B${MAKE_BUILD_PATH} ${CMAKE_ARGS})

  set(setFlags GENERATOR BUILD_TYPE)
  set(appendFlags C_FLAGS CXX_FLAGS LINKER_FLAGS)
  set(specialFlags POSITION_INDEPENDENT_CODE)
  set(flags ${setFlags} ${appendFlags} ${specialFlags})

  foreach(arg ${MAKE_ARGS})
    foreach(flag ${flags})
      if(arg MATCHES "-DCMAKE_${flag}=(.*)")
        if(DEFINED MAKE_${flag})
          message(FATAL_ERROR "register_cmake_command: CMAKE_${flag} was already set: \"${MAKE_${flag}}\"")
        endif()
        set(MAKE_${flag} ${CMAKE_MATCH_1})
        set(${arg}_USED ON)
      endif()
    endforeach()
    if(NOT ${arg}_USED)
      list(APPEND MAKE_EFFECTIVE_ARGS ${arg})
    endif()
  endforeach()

  foreach(flag ${setFlags})
    if(NOT DEFINED MAKE_${flag} AND DEFINED CMAKE_${flag})
      set(MAKE_${flag} ${CMAKE_${flag}})
    endif()
  endforeach()

  foreach(flag ${appendFlags})
    if(MAKE_${flag})
      set(MAKE_${flag} "${CMAKE_${flag}} ${MAKE_${flag}}")
    else()
      set(MAKE_${flag} ${CMAKE_${flag}})
    endif()
  endforeach()

  if(MAKE_POSITION_INDEPENDENT_CODE AND NOT WIN32)
    set(MAKE_C_FLAGS "${MAKE_C_FLAGS} -fPIC")
    set(MAKE_CXX_FLAGS "${MAKE_CXX_FLAGS} -fPIC")
  elseif(APPLE)
    set(MAKE_C_FLAGS "${MAKE_C_FLAGS} -fno-pic -fno-pie")
    set(MAKE_CXX_FLAGS "${MAKE_CXX_FLAGS} -fno-pic -fno-pie")
  endif()

  set(effectiveFlags ${setFlags} ${appendFlags})
  foreach(flag ${effectiveFlags})
    list(APPEND MAKE_EFFECTIVE_ARGS -DCMAKE_${flag}=${MAKE_${flag}})
  endforeach()

  register_command(
    COMMENT "Configuring ${MAKE_TARGET}"
    TARGET configure-${MAKE_TARGET}
    COMMAND ${CMAKE_COMMAND} ${MAKE_EFFECTIVE_ARGS}
    CWD ${MAKE_CWD}
    OUTPUTS ${MAKE_BUILD_PATH}/CMakeCache.txt
  )

  if(TARGET clone-${MAKE_TARGET})
    add_dependencies(configure-${MAKE_TARGET} clone-${MAKE_TARGET})
  endif()

  set(MAKE_BUILD_ARGS --build ${MAKE_BUILD_PATH} --config ${MAKE_BUILD_TYPE})

  set(MAKE_EFFECTIVE_LIBRARIES)
  set(MAKE_ARTIFACTS)
  foreach(lib ${MAKE_LIBRARIES})
    if(lib MATCHES "^(WIN32|UNIX|APPLE)$")
      if(${lib})
        continue()
      else()
        list(POP_BACK MAKE_ARTIFACTS)
      endif()
    else()
      list(APPEND MAKE_EFFECTIVE_LIBRARIES ${lib})
      if(lib MATCHES "\\.")
        list(APPEND MAKE_ARTIFACTS ${MAKE_LIB_PATH}/${lib})
      else()
        list(APPEND MAKE_ARTIFACTS ${MAKE_LIB_PATH}/${CMAKE_STATIC_LIBRARY_PREFIX}${lib}${CMAKE_STATIC_LIBRARY_SUFFIX})
      endif()
    endif()
  endforeach()

  if(NOT MAKE_TARGETS)
    set(MAKE_TARGETS ${MAKE_EFFECTIVE_LIBRARIES})
  endif()

  foreach(target ${MAKE_TARGETS})
    list(APPEND MAKE_BUILD_ARGS --target ${target})
  endforeach()

  set(MAKE_EFFECTIVE_INCLUDES)
  foreach(include ${MAKE_INCLUDES})
    if(include STREQUAL ".")
      list(APPEND MAKE_EFFECTIVE_INCLUDES ${MAKE_CWD})
    else()
      list(APPEND MAKE_EFFECTIVE_INCLUDES ${MAKE_CWD}/${include})
    endif()
  endforeach()

  register_command(
    COMMENT "Building ${MAKE_TARGET}"
    TARGET ${MAKE_TARGET}
    TARGETS configure-${MAKE_TARGET}
    COMMAND ${CMAKE_COMMAND} ${MAKE_BUILD_ARGS}
    CWD ${MAKE_CWD}
    ARTIFACTS ${MAKE_ARTIFACTS}
  )

  if(MAKE_EFFECTIVE_INCLUDES)
    target_include_directories(${bun} PRIVATE ${MAKE_EFFECTIVE_INCLUDES})
    if(TARGET clone-${MAKE_TARGET} AND NOT BUN_LINK_ONLY)
      add_dependencies(${bun} clone-${MAKE_TARGET})
    endif()
  endif()

  target_link_libraries(${bun} PRIVATE ${MAKE_ARTIFACTS})
  if(BUN_LINK_ONLY)
    target_sources(${bun} PRIVATE ${MAKE_ARTIFACTS})
  endif()
endfunction()

# function(register_directory)
#   set(args TARGET PATHS)
#   cmake_parse_arguments(REGISTER "" "${args}" "" ${ARGN})

#   if(NOT REGISTER_TARGET)
#     message(FATAL_ERROR "register_directory: TARGET is required")
#   endif()

#   if(NOT TARGET ${REGISTER_TARGET})
#     message(FATAL_ERROR "register_directory: TARGET is not a target: ${TARGET}")
#   endif()

#   if(NOT REGISTER_PATHS)
#     message(FATAL_ERROR "register_directory: PATHS is required")
#   endif()

#   get_property(ALL_TARGETS DIRECTORY ${CWD} PROPERTY BUILDSYSTEM_TARGETS)
#   foreach(target ${ALL_TARGETS})
#     get_target_property(TARGET_INCLUDES ${target} INCLUDE_DIRECTORIES)
#     get_target_property(TARGET_SOURCES ${target} SOURCES)
#     set(TARGET_FILES ${TARGET_SOURCES} ${TARGET_INCLUDES})

#     foreach(file ${TARGET_FILES})
#       if(file MATCHES ${REGISTER_PATH})
        
#       endif()
#     endforeach()
#   endforeach()
# endfunction()
