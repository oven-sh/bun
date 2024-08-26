macro(add_custom_library)
  set(args TARGET PREFIX)
  set(multi_args LIBRARIES INCLUDES CMAKE_ARGS)
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

  set(${LIB_ID}_CMAKE_ARGS ${CMAKE_ARGS} ${LIB_CMAKE_ARGS})
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
    add_custom_command(
      COMMENT
        "Building ${lib}"
      VERBATIM COMMAND
        ${CMAKE_COMMAND}
          --build ${${LIB_ID}_BUILD_PATH}
          --config ${CMAKE_BUILD_TYPE}
          --target ${lib}
      WORKING_DIRECTORY
        ${CWD}
      OUTPUT
        ${lib_path}
      DEPENDS
        ${${LIB_ID}_BUILD_PATH}/CMakeCache.txt
    )
    list(APPEND ${LIB_ID}_LIBRARY_PATHS ${lib_path})
  endforeach()
  
  set(${LIB_ID}_INCLUDE_PATHS)
  foreach(include ${LIB_INCLUDES})
    list(APPEND ${LIB_ID}_INCLUDE_PATHS ${${LIB_ID}_SOURCE_PATH}/${include})
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
