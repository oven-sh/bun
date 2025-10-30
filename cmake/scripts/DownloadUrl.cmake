get_filename_component(SCRIPT_NAME ${CMAKE_CURRENT_LIST_FILE} NAME)
message(STATUS "Running script: ${SCRIPT_NAME}")

if(NOT DOWNLOAD_URL OR NOT DOWNLOAD_PATH)
  message(FATAL_ERROR "DOWNLOAD_URL and DOWNLOAD_PATH are required")
endif()

if(CMAKE_SYSTEM_NAME STREQUAL "Windows")
  set(TMP_PATH $ENV{TEMP})
else()
  set(TMP_PATH $ENV{TMPDIR})
endif()

if(NOT TMP_PATH)
  set(TMP_PATH ${CMAKE_BINARY_DIR}/tmp)
endif()

string(REGEX REPLACE "/+$" "" TMP_PATH ${TMP_PATH})
string(REGEX REPLACE "[^a-zA-Z0-9]" "-" DOWNLOAD_ID ${DOWNLOAD_URL})
string(RANDOM LENGTH 8 RANDOM_ID)

set(DOWNLOAD_TMP_PATH ${TMP_PATH}/${DOWNLOAD_ID}-${RANDOM_ID})
set(DOWNLOAD_TMP_FILE ${DOWNLOAD_TMP_PATH}/tmp)

file(REMOVE_RECURSE ${DOWNLOAD_TMP_PATH})
file(MAKE_DIRECTORY ${DOWNLOAD_TMP_PATH})

if(DOWNLOAD_ACCEPT_HEADER)
  set(DOWNLOAD_ACCEPT_HEADER "Accept: ${DOWNLOAD_ACCEPT_HEADER}")
else()
  set(DOWNLOAD_ACCEPT_HEADER "Accept: */*")
endif()

foreach(i RANGE 10)
  set(DOWNLOAD_TMP_FILE_${i} ${DOWNLOAD_TMP_FILE}.${i})

  if(i EQUAL 0)
    message(STATUS "Downloading ${DOWNLOAD_URL}...")
  else()
    message(STATUS "Downloading ${DOWNLOAD_URL}... (retry ${i})")
  endif()

  # Use curl instead of file(DOWNLOAD) for better reliability
  execute_process(
    COMMAND curl
      -L
      --fail
      --connect-timeout 60
      --max-time 180
      -H "User-Agent: cmake/${CMAKE_VERSION}"
      -H "${DOWNLOAD_ACCEPT_HEADER}"
      -o ${DOWNLOAD_TMP_FILE_${i}}
      ${DOWNLOAD_URL}
    RESULT_VARIABLE DOWNLOAD_STATUS_CODE
    ERROR_VARIABLE DOWNLOAD_STATUS_TEXT
    ERROR_STRIP_TRAILING_WHITESPACE
  )

  if(DOWNLOAD_STATUS_CODE EQUAL 0)
    if(NOT EXISTS ${DOWNLOAD_TMP_FILE_${i}})
      message(WARNING "Download failed: result is ok, but file does not exist: ${DOWNLOAD_TMP_FILE_${i}}")
      continue()
    endif()

    file(RENAME ${DOWNLOAD_TMP_FILE_${i}} ${DOWNLOAD_TMP_FILE})
    break()
  endif()

  file(REMOVE ${DOWNLOAD_TMP_FILE_${i}})
  message(WARNING "Download failed: ${DOWNLOAD_STATUS_CODE} ${DOWNLOAD_STATUS_TEXT}")
endforeach()

if(NOT EXISTS ${DOWNLOAD_TMP_FILE})
  file(REMOVE_RECURSE ${DOWNLOAD_TMP_PATH})
  message(FATAL_ERROR "Download failed after too many attempts: ${DOWNLOAD_URL}")
endif()

get_filename_component(DOWNLOAD_FILENAME ${DOWNLOAD_URL} NAME)
if(DOWNLOAD_FILENAME MATCHES "\\.(zip|tar|gz|xz)$")
  message(STATUS "Extracting ${DOWNLOAD_FILENAME}...")

  set(DOWNLOAD_TMP_EXTRACT ${DOWNLOAD_TMP_PATH}/extract)
  file(MAKE_DIRECTORY ${DOWNLOAD_TMP_EXTRACT})

  # Use tar/unzip instead of file(ARCHIVE_EXTRACT) for better reliability
  if(DOWNLOAD_FILENAME MATCHES "\\.zip$")
    execute_process(
      COMMAND unzip -q ${DOWNLOAD_TMP_FILE} -d ${DOWNLOAD_TMP_EXTRACT}
      RESULT_VARIABLE EXTRACT_RESULT
      ERROR_VARIABLE EXTRACT_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )
  elseif(DOWNLOAD_FILENAME MATCHES "\\.(tar\\.gz|tgz)$")
    execute_process(
      COMMAND tar -xzf ${DOWNLOAD_TMP_FILE} -C ${DOWNLOAD_TMP_EXTRACT}
      RESULT_VARIABLE EXTRACT_RESULT
      ERROR_VARIABLE EXTRACT_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )
  elseif(DOWNLOAD_FILENAME MATCHES "\\.(tar\\.xz|txz)$")
    execute_process(
      COMMAND tar -xJf ${DOWNLOAD_TMP_FILE} -C ${DOWNLOAD_TMP_EXTRACT}
      RESULT_VARIABLE EXTRACT_RESULT
      ERROR_VARIABLE EXTRACT_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )
  elseif(DOWNLOAD_FILENAME MATCHES "\\.tar$")
    execute_process(
      COMMAND tar -xf ${DOWNLOAD_TMP_FILE} -C ${DOWNLOAD_TMP_EXTRACT}
      RESULT_VARIABLE EXTRACT_RESULT
      ERROR_VARIABLE EXTRACT_ERROR
      ERROR_STRIP_TRAILING_WHITESPACE
    )
  else()
    message(FATAL_ERROR "Unsupported archive format: ${DOWNLOAD_FILENAME}")
  endif()

  if(NOT EXTRACT_RESULT EQUAL 0)
    file(REMOVE_RECURSE ${DOWNLOAD_TMP_PATH})
    message(FATAL_ERROR "Extract failed: ${EXTRACT_ERROR}")
  endif()

  file(REMOVE ${DOWNLOAD_TMP_FILE})

  if(DOWNLOAD_FILTERS)
    list(TRANSFORM DOWNLOAD_FILTERS PREPEND ${DOWNLOAD_TMP_EXTRACT}/ OUTPUT_VARIABLE DOWNLOAD_GLOBS)
  else()
    set(DOWNLOAD_GLOBS ${DOWNLOAD_TMP_EXTRACT}/*)
  endif()

  file(GLOB DOWNLOAD_TMP_EXTRACT_PATHS LIST_DIRECTORIES ON ${DOWNLOAD_GLOBS})
  list(LENGTH DOWNLOAD_TMP_EXTRACT_PATHS DOWNLOAD_COUNT)

  if(DOWNLOAD_COUNT EQUAL 0)
    file(REMOVE_RECURSE ${DOWNLOAD_TMP_PATH})

    if(DOWNLOAD_FILTERS)
      message(FATAL_ERROR "Extract failed: No files found matching ${DOWNLOAD_FILTERS}")
    else()
      message(FATAL_ERROR "Extract failed: No files found")
    endif()
  endif()

  if(DOWNLOAD_FILTERS)
    set(DOWNLOAD_TMP_FILE ${DOWNLOAD_TMP_EXTRACT_PATHS})
  elseif(DOWNLOAD_COUNT EQUAL 1)
    list(GET DOWNLOAD_TMP_EXTRACT_PATHS 0 DOWNLOAD_TMP_FILE)
    get_filename_component(DOWNLOAD_FILENAME ${DOWNLOAD_TMP_FILE} NAME)
    message(STATUS "Hoisting ${DOWNLOAD_FILENAME}...")
  else()
    set(DOWNLOAD_TMP_FILE ${DOWNLOAD_TMP_EXTRACT})
  endif()
endif()

if(DOWNLOAD_FILTERS)
  foreach(file ${DOWNLOAD_TMP_FILE})
    file(RENAME ${file} ${DOWNLOAD_PATH})
  endforeach()
else()
  file(REMOVE_RECURSE ${DOWNLOAD_PATH})
  get_filename_component(DOWNLOAD_PARENT_PATH ${DOWNLOAD_PATH} DIRECTORY)
  file(MAKE_DIRECTORY ${DOWNLOAD_PARENT_PATH})
  file(RENAME ${DOWNLOAD_TMP_FILE} ${DOWNLOAD_PATH})
endif()

file(REMOVE_RECURSE ${DOWNLOAD_TMP_PATH})
message(STATUS "Saved ${DOWNLOAD_PATH}")
