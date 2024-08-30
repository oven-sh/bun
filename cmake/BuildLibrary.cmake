macro(add_custom_library)
  set(args TARGET PREFIX CMAKE_BUILD_TYPE CMAKE_POSITION_INDEPENDENT_CODE CMAKE_C_FLAGS CMAKE_CXX_FLAGS CMAKE_LINKER_FLAGS CMAKE_PATH WORKING_DIRECTORY SOURCE_PATH BUILD_PATH)
  set(multi_args LIBRARIES BYPRODUCTS INCLUDES CMAKE_TARGETS CMAKE_ARGS COMMAND)
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
    add_custom_target(
      build-${LIB_NAME}
      COMMENT
        "Building ${LIB_NAME}"
      VERBATIM COMMAND
        ${LIB_COMMAND}
      WORKING_DIRECTORY
        ${${LIB_ID}_WORKING_DIRECTORY}
      BYPRODUCTS
        ${${LIB_ID}_LIBRARY_PATHS}
        ${LIB_BYPRODUCTS}
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

    add_custom_target(
      configure-${LIB_NAME}
      COMMENT
        "Configuring ${LIB_NAME}"
      VERBATIM COMMAND
        ${CMAKE_COMMAND}
          -S${${LIB_ID}_CMAKE_PATH}
          -B${${LIB_ID}_BUILD_PATH}
          ${${LIB_ID}_CMAKE_ARGS}
      WORKING_DIRECTORY
        ${${LIB_ID}_WORKING_DIRECTORY}
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

    add_custom_target(
      build-${LIB_NAME}
      COMMENT
        "Compiling ${LIB_NAME}"
      VERBATIM COMMAND
        ${CMAKE_COMMAND}
          ${${LIB_ID}_CMAKE_BUILD_ARGS}
      WORKING_DIRECTORY
        ${${LIB_ID}_WORKING_DIRECTORY}
      BYPRODUCTS
        ${${LIB_ID}_LIBRARY_PATHS}
        ${LIB_BYPRODUCTS}
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
      file(RELATIVE_PATH filename ${${LIB_ID}_BUILD_PATH} ${lib})
      add_custom_command(
        TARGET
          build-${LIB_NAME} POST_BUILD
        VERBATIM COMMAND
          buildkite-agent artifact upload "${filename}"
        WORKING_DIRECTORY
          ${${LIB_ID}_BUILD_PATH}
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
endmacro()
