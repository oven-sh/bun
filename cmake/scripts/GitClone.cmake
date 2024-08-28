include(cmake/SetupScript.cmake)

macro(git_clone_args)
  if(NOT CMAKE_SCRIPT_MODE_FILE STREQUAL CMAKE_CURRENT_LIST_FILE)
    set(args NAME REPOSITORY BRANCH TAG COMMIT PATH)
    cmake_parse_arguments(GIT "" "${args}" "" ${ARGN})
  endif()

  if(NOT GIT_REPOSITORY)
    message(FATAL_ERROR "git_clone: REPOSITORY is required")
  endif()

  if(NOT GIT_BRANCH AND NOT GIT_TAG AND NOT GIT_COMMIT)
    message(FATAL_ERROR "git_clone: COMMIT, TAG, or BRANCH is required")
  endif()

  string(REGEX MATCH "([^/]+)$" GIT_ORIGINAL_NAME ${GIT_REPOSITORY})
  if(NOT GIT_NAME)
    set(GIT_NAME ${GIT_ORIGINAL_NAME})
  endif()

  if(NOT GIT_PATH)
    set(GIT_PATH ${CMAKE_SOURCE_DIR}/src/deps/${GIT_NAME})
  endif()

  set(GIT_REF_PATH ${GIT_PATH}/.ref)
  if(GIT_COMMIT)
    set(GIT_REF ${GIT_COMMIT})
  elseif(GIT_TAG)
    set(GIT_REF refs/tags/${GIT_TAG})
  else()
    set(GIT_REF refs/heads/${GIT_BRANCH})
  endif()

  set(GIT_DOWNLOAD_PATH ${GIT_PATH}.tar.gz)
  set(GIT_DOWNLOAD_URL https://github.com/${GIT_REPOSITORY}/archive/${GIT_REF}.tar.gz)
endmacro()

macro(git_clone)
  git_clone_args(${ARGN})

  if(EXISTS ${GIT_REF_PATH})
    file(READ ${GIT_REF_PATH} GIT_CACHED_REF)
    if(GIT_CACHED_REF STREQUAL GIT_REF)
      return()
    endif()
  endif()

  foreach(i RANGE 10)
    set(GIT_DOWNLOAD_TMP_PATH ${GIT_PATH}.tmp.${i})

    file(DOWNLOAD
      ${GIT_DOWNLOAD_URL}
      ${GIT_DOWNLOAD_TMP_PATH}
      SHOW_PROGRESS
      STATUS GIT_DOWNLOAD_STATUS
    )

    if(GIT_DOWNLOAD_STATUS MATCHES "^0")
      file(RENAME ${GIT_DOWNLOAD_TMP_PATH} ${GIT_DOWNLOAD_PATH})
      break()
    endif()

    message(WARNING "git_clone: ${GIT_DOWNLOAD_STATUS}: ${GIT_DOWNLOAD_URL}")

    file(REMOVE ${GIT_DOWNLOAD_TMP_PATH})
  endforeach()
  
  if(NOT EXISTS ${GIT_DOWNLOAD_PATH})
    message(FATAL_ERROR "git_clone: failed to download ${GIT_DOWNLOAD_URL}")
  endif()

  file(REMOVE_RECURSE ${GIT_PATH})
  get_filename_component(GIT_PARENT_PATH ${GIT_PATH} DIRECTORY)
  file(MAKE_DIRECTORY ${GIT_PARENT_PATH})
  file(ARCHIVE_EXTRACT INPUT ${GIT_DOWNLOAD_PATH} DESTINATION ${GIT_PARENT_PATH} TOUCH)
  file(GLOB GIT_TMP_PATH LIST_DIRECTORIES ON ${GIT_PARENT_PATH}/${GIT_ORIGINAL_NAME}-*)
  file(RENAME ${GIT_TMP_PATH} ${GIT_PATH})
  file(REMOVE ${GIT_DOWNLOAD_PATH})
  file(GLOB_RECURSE GIT_PATCH_PATHS ${CMAKE_SOURCE_DIR}/patches/${GIT_NAME}/*)
  foreach(GIT_PATCH_PATH ${GIT_PATCH_PATHS})
    file(COPY ${GIT_PATCH_PATH} DESTINATION ${GIT_PATH})
  endforeach()
  file(WRITE ${GIT_REF_PATH} ${GIT_REF})
endmacro()

if(CMAKE_SCRIPT_MODE_FILE STREQUAL CMAKE_CURRENT_LIST_FILE)
  git_clone()
  return()
endif()

macro(add_custom_repository)
  git_clone_args(${ARGN})
  
  add_custom_target(
    clone-${GIT_NAME}
    COMMENT
      "Cloning ${GIT_NAME}"
    VERBATIM COMMAND
      ${CMAKE_COMMAND}
        -P ${CMAKE_SOURCE_DIR}/cmake/scripts/GitClone.cmake
        -DGIT_NAME=${GIT_NAME}
        -DGIT_REPOSITORY=${GIT_REPOSITORY}
        -DGIT_COMMIT=${GIT_COMMIT}
        -DGIT_TAG=${GIT_TAG}
        -DGIT_BRANCH=${GIT_BRANCH}
        -DGIT_PATH=${GIT_PATH}
    WORKING_DIRECTORY
      ${CMAKE_SOURCE_DIR}
    BYPRODUCTS
      ${GIT_PATH}
  )
endmacro()
