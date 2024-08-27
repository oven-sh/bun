macro(add_custom_library)
  set(args TARGET PREFIX CMAKE_BUILD_TYPE CMAKE_PATH WORKING_DIRECTORY)
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

  parse_option(${LIB_ID}_SOURCE_PATH FILEPATH "Path to the ${LIB_NAME} source" ${CWD}/src/deps/${LIB_NAME})
  parse_option(${LIB_ID}_BUILD_PATH FILEPATH "Path to the ${LIB_NAME} build" ${BUILD_PATH}/${LIB_NAME})

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
    set(lib_path ${${LIB_ID}_LIB_PATH}/${CMAKE_STATIC_LIBRARY_PREFIX}${lib}${CMAKE_STATIC_LIBRARY_SUFFIX})
    list(APPEND ${LIB_ID}_LIBRARY_PATHS ${lib_path})
  endforeach()

  if(LIB_COMMAND)
    add_custom_command(
      COMMENT
        "Building ${LIB_NAME}"
      VERBATIM COMMAND
        ${LIB_COMMAND}
      WORKING_DIRECTORY
        ${${LIB_ID}_WORKING_DIRECTORY}
      OUTPUT
        ${${LIB_ID}_LIBRARY_PATHS}
      DEPENDS
        ${${LIB_ID}_SOURCE_PATH}
    )
  else()
    if(NOT LIB_CMAKE_BUILD_TYPE)
      set(LIB_CMAKE_BUILD_TYPE ${CMAKE_BUILD_TYPE})
    endif()

    set(${LIB_ID}_CMAKE_ARGS
      -DCMAKE_BUILD_TYPE=${LIB_CMAKE_BUILD_TYPE}
      ${CMAKE_ARGS}
      ${LIB_CMAKE_ARGS}
    )

    set(${LIB_ID}_CMAKE_PATH ${${LIB_ID}_SOURCE_PATH})
    if(LIB_CMAKE_PATH)
      set(${LIB_ID}_CMAKE_PATH ${${LIB_ID}_CMAKE_PATH}/${LIB_CMAKE_PATH})
    endif()

    add_custom_command(
      COMMENT
        "Configuring ${LIB_NAME}"
      VERBATIM COMMAND
        ${CMAKE_COMMAND}
          -S${${LIB_ID}_CMAKE_PATH}
          -B${${LIB_ID}_BUILD_PATH}
          ${${LIB_ID}_CMAKE_ARGS}
      WORKING_DIRECTORY
        ${${LIB_ID}_WORKING_DIRECTORY}
      OUTPUT
        ${${LIB_ID}_CMAKE_PATH}/CMakeCache.txt
      DEPENDS
        ${${LIB_ID}_SOURCE_PATH}
    )
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

    add_custom_command(
      COMMENT
        "Building ${LIB_NAME}"
      VERBATIM COMMAND
        ${CMAKE_COMMAND}
          ${${LIB_ID}_CMAKE_BUILD_ARGS}
      WORKING_DIRECTORY
        ${${LIB_ID}_WORKING_DIRECTORY}
      OUTPUT
        ${${LIB_ID}_LIBRARY_PATHS}
      DEPENDS
        ${${LIB_ID}_CMAKE_PATH}/CMakeCache.txt
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
      ${${LIB_ID}_SOURCE_PATH}
      ${${LIB_ID}_LIBRARY_PATHS}
  )
  
  include_directories(${${LIB_ID}_INCLUDE_PATHS})
  target_link_libraries(${bun} PRIVATE ${${LIB_ID}_LIBRARY_PATHS})
endmacro()
