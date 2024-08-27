macro(add_custom_library)
  set(args TARGET PREFIX)
  set(multi_args LIBRARIES INCLUDES CMAKE_TARGETS CMAKE_ARGS CMAKE_BUILD_TYPE)
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

  if(NOT LIB_CMAKE_BUILD_TYPE)
    set(LIB_CMAKE_BUILD_TYPE ${CMAKE_BUILD_TYPE})
  endif()

  set(${LIB_ID}_CMAKE_ARGS
    -DCMAKE_BUILD_TYPE=${LIB_CMAKE_BUILD_TYPE}
    ${CMAKE_ARGS}
    ${LIB_CMAKE_ARGS}
  )

  add_custom_command(
    COMMENT
      "Configuring ${LIB_NAME}"
    VERBATIM COMMAND
      ${CMAKE_COMMAND}
        -S${${LIB_ID}_SOURCE_PATH}
        -B${${LIB_ID}_BUILD_PATH}
        ${${LIB_ID}_CMAKE_ARGS}
    WORKING_DIRECTORY
      ${CWD}
    OUTPUT
      ${${LIB_ID}_BUILD_PATH}/CMakeCache.txt
    DEPENDS
      ${${LIB_ID}_SOURCE_PATH}
  )

  set(${LIB_ID}_LIB_PATH ${${LIB_ID}_BUILD_PATH})
  if(LIB_PREFIX)
    set(${LIB_ID}_LIB_PATH ${${LIB_ID}_LIB_PATH}/${LIB_PREFIX})
  endif()

  set(${LIB_ID}_LIBRARY_PATHS)  
  foreach(lib ${LIB_LIBRARIES})
    set(lib_path ${${LIB_ID}_LIB_PATH}/${CMAKE_STATIC_LIBRARY_PREFIX}${lib}${CMAKE_STATIC_LIBRARY_SUFFIX})
    list(APPEND ${LIB_ID}_LIBRARY_PATHS ${lib_path})
  endforeach()

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
      ${CWD}
    OUTPUT
      ${${LIB_ID}_LIBRARY_PATHS}
    DEPENDS
      ${${LIB_ID}_BUILD_PATH}/CMakeCache.txt
  )
  
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
      ${${LIB_ID}_BUILD_PATH}/CMakeCache.txt
      ${${LIB_ID}_LIBRARY_PATHS}
  )
  
  include_directories(${${LIB_ID}_INCLUDE_PATHS})
  target_link_libraries(${bun} PRIVATE ${${LIB_ID}_LIBRARY_PATHS})
endmacro()
