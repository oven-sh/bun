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

# register_command
#   COMMAND      string[] - The command to run
#   COMMENT      string   - The comment to display in the log
#   CWD          string   - The working directory to run the command in
#   ENVIRONMENT  string[] - The environment variables to set (e.g. "DEBUG=1")
#   TARGETS      string[] - The targets that this command depends on
#   SOURCES      string[] - The files that this command depends on
#   OUTPUTS      string[] - The files that this command produces
#   ARTIFACTS    string[] - The files that this command produces, and uploads as an artifact in CI
#   BYPRODUCTS   string[] - The files that this command produces, but are not used as inputs (e.g. "node_modules")
#   ALWAYS_RUN   bool     - If true, the command will always run
#   TARGET       string   - The target to register the command with
#   TARGET_PHASE string   - The target phase to register the command with (e.g. PRE_BUILD, PRE_LINK, POST_BUILD)
#   GROUP        string   - The group to register the command with (e.g. similar to JOB_POOL)
function(register_command)
  set(options ALWAYS_RUN)
  set(args COMMENT CWD TARGET TARGET_PHASE GROUP)
  set(multiArgs COMMAND ENVIRONMENT TARGETS SOURCES OUTPUTS BYPRODUCTS ARTIFACTS)
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

  if(NOT CMD_EFFECTIVE_DEPENDS)
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
      file(RELATIVE_PATH filename ${CMD_CWD} ${artifact})
      list(APPEND CMD_COMMANDS COMMAND buildkite-agent artifact upload ${filename})
    endif()
  endforeach()

  foreach(output ${CMD_EFFECTIVE_OUTPUTS})
    # list(APPEND CMD_COMMANDS COMMAND ${CMAKE_COMMAND} -E sha256sum ${output})
  endforeach()

  if(CMD_ALWAYS_RUN)
    list(APPEND CMD_EFFECTIVE_OUTPUTS ${CMD_CWD}/.1)
  endif()

  if(CMD_TARGET_PHASE)
    message(STATUS "register_command: target: ${CMD_TARGET} phase: ${CMD_TARGET_PHASE} commands: ${CMD_COMMANDS}")
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
      BYPRODUCTS ${CMD_BYPRODUCTS}
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
      BYPRODUCTS ${CMD_EFFECTIVE_BYPRODUCTS}
      JOB_POOL ${CMD_GROUP}
    )
  endif()

  add_custom_command(
    VERBATIM ${CMD_COMMANDS}
    WORKING_DIRECTORY ${CMD_CWD}
    COMMENT ${CMD_COMMENT}
    DEPENDS ${CMD_EFFECTIVE_DEPENDS}
    OUTPUT ${CMD_EFFECTIVE_OUTPUTS}
    BYPRODUCTS ${CMD_BYPRODUCTS}
    JOB_POOL ${CMD_GROUP}
  )
endfunction()

# parse_package_json
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

# register_bun_install
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
    BYPRODUCTS
      ${NPM_CWD}/bun.lockb
  )

  set(${NPM_NODE_MODULES_VARIABLE} ${NPM_NODE_MODULES} PARENT_SCOPE)
endfunction()

function(add_target)
  set(options NODE_MODULES USES_TERMINAL)
  set(args NAME COMMENT WORKING_DIRECTORY)
  set(multiArgs ALIASES COMMAND DEPENDS SOURCES OUTPUTS ARTIFACTS)
  cmake_parse_arguments(ARG "${options}" "${args}" "${multiArgs}" ${ARGN})

  message(STATUS "add_target: ${ARG_NAME}")
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

  if(ARG_USES_TERMINAL)
    set(ARG_USES_TERMINAL "USES_TERMINAL")
  else()
    set(ARG_USES_TERMINAL "")
  endif()

  add_custom_command(
    VERBATIM COMMAND
      ${ARG_COMMAND}
    WORKING_DIRECTORY
      ${ARG_WORKING_DIRECTORY}
    OUTPUT
      ${ARG_OUTPUTS}
      ${ARG_ARTIFACTS}
    DEPENDS
      ${ARG_SOURCES}
      ${ARG_DEPENDS}
    ${ARG_USES_TERMINAL}
  )

  add_custom_target(${ARG_NAME}
    COMMENT
      ${ARG_COMMENT}
    DEPENDS
      ${ARG_OUTPUTS}
      ${ARG_ARTIFACTS}
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

  message(STATUS "add_target: ${ARG_NAME} with aliases: ${ARG_ALIASES}")
  foreach(alias ${ARG_ALIASES})
    if(NOT TARGET ${alias})
      add_custom_target(${alias} DEPENDS ${ARG_NAME})
    else()
      add_dependencies(${alias} ${ARG_NAME})
    endif()
  endforeach()
endfunction()

function(upload_artifact)
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

  get_filename_component(ARTIFACT_FILENAME ${ARTIFACT_NAME} NAME)
  string(REGEX REPLACE "\\." "-" ARTIFACT_FILENAME ${ARTIFACT_FILENAME})
  add_target(
    NAME
      upload-${ARTIFACT_FILENAME}
    COMMENT
      "Uploading ${ARTIFACT_NAME}"
    COMMAND
      ${ARTIFACT_UPLOAD_COMMAND}
    WORKING_DIRECTORY
      ${ARTIFACT_WORKING_DIRECTORY}
    OUTPUTS
      ${ARTIFACT_WORKING_DIRECTORY}/.fixme/${ARTIFACT_FILENAME}
  )
endfunction()

function(add_custom_library)
  set(args TARGET PREFIX CMAKE_BUILD_TYPE CMAKE_POSITION_INDEPENDENT_CODE CMAKE_C_FLAGS CMAKE_CXX_FLAGS CMAKE_LINKER_FLAGS CMAKE_PATH WORKING_DIRECTORY SOURCE_PATH BUILD_PATH)
  set(multi_args LIBRARIES INCLUDES CMAKE_TARGETS CMAKE_ARGS COMMAND)
  cmake_parse_arguments(LIB "" "${args}" "${multi_args}" ${ARGN})

  if(NOT LIB_TARGET)
    message(FATAL_ERROR "add_custom_library: TARGET is required")
  endif()

  if(NOT LIB_LIBRARIES)
    message(FATAL_ERROR "add_custom_library: LIBRARIES is required")
  endif()

  set(LIB_NAME ${LIB_TARGET})
  string(TOUPPER ${LIB_NAME} LIB_ID)

  if(LIB_SOURCE_PATH)
    set(${LIB_ID}_SOURCE_PATH ${CWD}/${LIB_SOURCE_PATH})
  else()
    set(${LIB_ID}_SOURCE_PATH ${CWD}/src/deps/${LIB_NAME})
  endif()

  if(LIB_BUILD_PATH)
    set(${LIB_ID}_BUILD_PATH ${BUILD_PATH}/${LIB_BUILD_PATH})
  else()
    set(${LIB_ID}_BUILD_PATH ${BUILD_PATH}/${LIB_NAME})
  endif()

  set(${LIB_ID}_WORKING_DIRECTORY ${${LIB_ID}_SOURCE_PATH})
  if(LIB_WORKING_DIRECTORY)
    set(${LIB_ID}_WORKING_DIRECTORY ${${LIB_ID}_WORKING_DIRECTORY}/${LIB_WORKING_DIRECTORY})
  endif()

  set(${LIB_ID}_LIB_PATH ${${LIB_ID}_BUILD_PATH})
  if(LIB_PREFIX)
    set(${LIB_ID}_LIB_PATH ${${LIB_ID}_LIB_PATH}/${LIB_PREFIX})
  endif()

  set(${LIB_ID}_LIBRARY_PATHS)  
  foreach(lib ${LIB_LIBRARIES})
    if(lib MATCHES "\\.")
      set(lib_path ${${LIB_ID}_LIB_PATH}/${lib})
    else()
      set(lib_path ${${LIB_ID}_LIB_PATH}/${CMAKE_STATIC_LIBRARY_PREFIX}${lib}${CMAKE_STATIC_LIBRARY_SUFFIX})
    endif()
    list(APPEND ${LIB_ID}_LIBRARY_PATHS ${lib_path})  
  endforeach()

  if(LIB_COMMAND)
    add_target(
      NAME
        build-${LIB_NAME}
      COMMENT
        "Building ${LIB_NAME}"
      COMMAND
        ${LIB_COMMAND}
      WORKING_DIRECTORY
        ${${LIB_ID}_WORKING_DIRECTORY}
      ARTIFACTS
        ${${LIB_ID}_LIBRARY_PATHS}
    )

    if(TARGET clone-${LIB_NAME})
      add_dependencies(build-${LIB_NAME} clone-${LIB_NAME})
    endif()
  else()
    if(NOT LIB_CMAKE_BUILD_TYPE)
      set(LIB_CMAKE_BUILD_TYPE ${CMAKE_BUILD_TYPE})
    endif()
    
    if(LIB_CMAKE_POSITION_INDEPENDENT_CODE AND NOT WIN32)
      set(LIB_CMAKE_C_FLAGS "${LIB_CMAKE_C_FLAGS} -fPIC")
      set(LIB_CMAKE_CXX_FLAGS "${LIB_CMAKE_CXX_FLAGS} -fPIC")
    elseif(APPLE)
      set(LIB_CMAKE_C_FLAGS "${LIB_CMAKE_C_FLAGS} -fno-pic -fno-pie")
      set(LIB_CMAKE_CXX_FLAGS "${LIB_CMAKE_CXX_FLAGS} -fno-pic -fno-pie")
    endif()

    set(${LIB_ID}_CMAKE_ARGS
      -G${CMAKE_GENERATOR}
      -DCMAKE_BUILD_TYPE=${LIB_CMAKE_BUILD_TYPE}
      "-DCMAKE_C_FLAGS=${CMAKE_C_FLAGS} ${LIB_CMAKE_C_FLAGS}"
      "-DCMAKE_CXX_FLAGS=${CMAKE_CXX_FLAGS} ${LIB_CMAKE_CXX_FLAGS}"
      "-DCMAKE_LINKER_FLAGS=${CMAKE_LINKER_FLAGS} ${LIB_CMAKE_LINKER_FLAGS}"
      ${CMAKE_ARGS}
      ${LIB_CMAKE_ARGS}
    )

    set(${LIB_ID}_CMAKE_PATH ${${LIB_ID}_SOURCE_PATH})
    if(LIB_CMAKE_PATH)
      set(${LIB_ID}_CMAKE_PATH ${${LIB_ID}_CMAKE_PATH}/${LIB_CMAKE_PATH})
    endif()

    add_target(
      NAME
        configure-${LIB_NAME}
      COMMENT
        "Configuring ${LIB_NAME}"
      COMMAND
        ${CMAKE_COMMAND}
          -S${${LIB_ID}_CMAKE_PATH}
          -B${${LIB_ID}_BUILD_PATH}
          ${${LIB_ID}_CMAKE_ARGS}
      WORKING_DIRECTORY
        ${${LIB_ID}_WORKING_DIRECTORY}
      OUTPUTS
        ${${LIB_ID}_WORKING_DIRECTORY}/CMakeCache.txt
    )

    if(TARGET clone-${LIB_NAME})
      add_dependencies(configure-${LIB_NAME} clone-${LIB_NAME})
    endif()
  endif()

  if(NOT LIB_COMMAND)
    if(NOT LIB_CMAKE_TARGETS)
      set(LIB_CMAKE_TARGETS ${LIB_LIBRARIES})
    endif()

    set(${LIB_ID}_CMAKE_BUILD_ARGS
      --build ${${LIB_ID}_BUILD_PATH}
      --config ${CMAKE_BUILD_TYPE}
    )
    foreach(target ${LIB_CMAKE_TARGETS})
      list(APPEND ${LIB_ID}_CMAKE_BUILD_ARGS --target ${target})
    endforeach()

    add_target(
      NAME
        build-${LIB_NAME}
      COMMENT
        "Compiling ${LIB_NAME}"
      COMMAND
        ${CMAKE_COMMAND}
          ${${LIB_ID}_CMAKE_BUILD_ARGS}
      WORKING_DIRECTORY
        ${${LIB_ID}_WORKING_DIRECTORY}
      ARTIFACTS
        ${${LIB_ID}_LIBRARY_PATHS}
      DEPENDS
        configure-${LIB_NAME}
    )
  endif()
  
  set(${LIB_ID}_INCLUDE_PATHS)
  foreach(include ${LIB_INCLUDES})
    if(include STREQUAL ".")
      list(APPEND ${LIB_ID}_INCLUDE_PATHS ${${LIB_ID}_SOURCE_PATH})
    else()
      list(APPEND ${LIB_ID}_INCLUDE_PATHS ${${LIB_ID}_SOURCE_PATH}/${include})
    endif()
  endforeach()

  add_custom_target(
    ${LIB_NAME}
    COMMENT
      "Building ${LIB_NAME}"
    DEPENDS
      build-${LIB_NAME}
  )

  if(BUILDKITE)
    foreach(lib ${${LIB_ID}_LIBRARY_PATHS})
      file(RELATIVE_PATH filename ${BUILD_PATH} ${lib})
      add_custom_command(
        TARGET
          build-${LIB_NAME} POST_BUILD
        VERBATIM COMMAND
          buildkite-agent artifact upload "${filename}"
        WORKING_DIRECTORY
          ${BUILD_PATH}
      )
    endforeach()
  endif()
  
  include_directories(${${LIB_ID}_INCLUDE_PATHS})
  target_include_directories(${bun} PRIVATE ${${LIB_ID}_INCLUDE_PATHS})

  if(TARGET clone-${LIB_NAME})
    add_dependencies(${bun} clone-${LIB_NAME})
  endif()
  add_dependencies(${bun} ${LIB_NAME})

  target_link_libraries(${bun} PRIVATE ${${LIB_ID}_LIBRARY_PATHS})
endfunction()
