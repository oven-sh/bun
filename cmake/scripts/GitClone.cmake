get_filename_component(SCRIPT_NAME ${CMAKE_CURRENT_LIST_FILE} NAME)
message(STATUS "Running script: ${SCRIPT_NAME}")

if(NOT GIT_PATH OR NOT GIT_REPOSITORY)
  message(FATAL_ERROR "GIT_PATH and GIT_REPOSITORY are required")
endif()

if(GIT_COMMIT)
  set(GIT_REF ${GIT_COMMIT})
elseif(GIT_TAG)
  set(GIT_REF refs/tags/${GIT_TAG})
elseif(GIT_BRANCH)
  set(GIT_REF refs/heads/${GIT_BRANCH})
else()
  message(FATAL_ERROR "GIT_COMMIT, GIT_TAG, or GIT_BRANCH are required")
endif()

string(REGEX MATCH "([^/]+)$" GIT_ORIGINAL_NAME ${GIT_REPOSITORY})
if(NOT GIT_NAME)
  set(GIT_NAME ${GIT_ORIGINAL_NAME})
endif()

set(GIT_DOWNLOAD_URL https://github.com/${GIT_REPOSITORY}/archive/${GIT_REF}.tar.gz)

message(STATUS "Cloning ${GIT_REPOSITORY} at ${GIT_REF}...")
execute_process(
  COMMAND
    ${CMAKE_COMMAND}
      -DDOWNLOAD_URL=${GIT_DOWNLOAD_URL}
      -DDOWNLOAD_PATH=${GIT_PATH}
      -DDOWNLOAD_FILTERS=${GIT_FILTERS}
      -P ${CMAKE_CURRENT_LIST_DIR}/DownloadUrl.cmake
  ERROR_STRIP_TRAILING_WHITESPACE
  ERROR_VARIABLE
    GIT_ERROR
  RESULT_VARIABLE
    GIT_RESULT
)

if(NOT GIT_RESULT EQUAL 0)
  message(FATAL_ERROR "Clone failed: ${GIT_ERROR}")
endif()

file(GLOB_RECURSE GIT_PATCH_PATHS ${CMAKE_SOURCE_DIR}/patches/${GIT_NAME}/*)
list(LENGTH GIT_PATCH_PATHS GIT_PATCH_COUNT)

if(GIT_PATCH_COUNT GREATER 0)
  find_program(GIT_PROGRAM git REQUIRED)

  foreach(GIT_PATCH ${GIT_PATCH_PATHS})
    get_filename_component(GIT_PATCH_NAME ${GIT_PATCH} NAME)

    if(GIT_PATCH_NAME MATCHES "\\.patch$")
      message(STATUS "Applying patch ${GIT_PATCH_NAME}...")
      execute_process(
        COMMAND
          ${GIT_PROGRAM}
            apply
            --ignore-whitespace
            --ignore-space-change
            --no-index
            --verbose
            ${GIT_PATCH}
        WORKING_DIRECTORY
          ${GIT_PATH}
        ERROR_STRIP_TRAILING_WHITESPACE
        ERROR_VARIABLE
          GIT_PATCH_ERROR
        RESULT_VARIABLE
          GIT_PATCH_RESULT
      )

      if(NOT GIT_PATCH_RESULT EQUAL 0 AND NOT GIT_PATCH_ERROR MATCHES "cleanly")
        file(REMOVE_RECURSE ${GIT_PATH})
        message(FATAL_ERROR "Failed to apply patch: ${GIT_PATCH_ERROR}")
      endif()
    else()
      message(STATUS "Copying file ${GIT_PATCH_NAME}...")
      file(COPY ${GIT_PATCH} DESTINATION ${GIT_PATH})
    endif()
  endforeach()
endif()

file(WRITE ${GIT_PATH}/.ref ${GIT_REF})
message(STATUS "Cloned ${GIT_REPOSITORY}")
