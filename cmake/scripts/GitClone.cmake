include(cmake/Globals.cmake)

if(NOT GIT_PATH OR NOT GIT_REPOSITORY OR NOT GIT_REF)
  message(FATAL_ERROR "git_clone: GIT_PATH, GIT_REPOSITORY, and GIT_REF are required")
endif()

setx(GIT_PATH ${GIT_PATH})
setx(GIT_REPOSITORY ${GIT_REPOSITORY})
setx(GIT_REF ${GIT_REF})

string(REGEX MATCH "([^/]+)$" GIT_ORIGINAL_NAME ${GIT_REPOSITORY})

if(NOT GIT_NAME)
  setx(GIT_NAME ${GIT_ORIGINAL_NAME})
endif()

set(GIT_REF_PATH ${GIT_PATH}/.ref)

if(EXISTS ${GIT_REF_PATH})
  file(READ ${GIT_REF_PATH} GIT_CACHED_REF)
  if(GIT_CACHED_REF STREQUAL GIT_REF)
    return()
  endif()
endif()

setx(GIT_DOWNLOAD_PATH ${GIT_PATH}.tar.gz)
setx(GIT_DOWNLOAD_URL https://github.com/${GIT_REPOSITORY}/archive/${GIT_REF}.tar.gz)

foreach(i RANGE 10)
  set(GIT_DOWNLOAD_TMP_PATH ${GIT_PATH}.tmp.${i})
  file(DOWNLOAD
    ${GIT_DOWNLOAD_URL}
    ${GIT_DOWNLOAD_TMP_PATH}
    TIMEOUT 120
    STATUS GIT_DOWNLOAD_STATUS
    SHOW_PROGRESS
  )
  if(GIT_DOWNLOAD_STATUS MATCHES "^0" AND EXISTS GIT_DOWNLOAD_TMP_PATH)
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
file(ARCHIVE_EXTRACT INPUT ${GIT_DOWNLOAD_PATH} DESTINATION ${GIT_PARENT_PATH}/tmp-${GIT_ORIGINAL_NAME} TOUCH)
file(GLOB GIT_TMP_PATH LIST_DIRECTORIES ON ${GIT_PARENT_PATH}/tmp-${GIT_ORIGINAL_NAME}/${GIT_ORIGINAL_NAME}-*)
file(RENAME ${GIT_TMP_PATH} ${GIT_PATH})
file(REMOVE_RECURSE ${GIT_PARENT_PATH}/tmp-${GIT_ORIGINAL_NAME})
file(REMOVE ${GIT_DOWNLOAD_PATH})

file(GLOB_RECURSE GIT_PATCH_PATHS ${CMAKE_SOURCE_DIR}/patches/${GIT_NAME}/*)
foreach(GIT_PATCH_PATH ${GIT_PATCH_PATHS})
  if(GIT_PATCH_PATH MATCHES "\\.patch$")
    execute_process(
      COMMAND git apply --ignore-whitespace --ignore-space-change --no-index --verbose ${GIT_PATCH_PATH}
      WORKING_DIRECTORY ${GIT_PATH}
      RESULT_VARIABLE GIT_PATCH_RESULT
    )
    if(NOT GIT_PATCH_RESULT EQUAL 0)
      message(FATAL_ERROR "git_clone: failed to apply patch: ${GIT_PATCH_PATH}")
    endif()
  else()
    file(COPY ${GIT_PATCH_PATH} DESTINATION ${GIT_PATH})
  endif()
endforeach()

file(WRITE ${GIT_REF_PATH} ${GIT_REF})
