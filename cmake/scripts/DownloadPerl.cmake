get_filename_component(SCRIPT_NAME ${CMAKE_CURRENT_LIST_FILE} NAME)
message(STATUS "Running script: ${SCRIPT_NAME}")

if(NOT PERL_PATH OR NOT PERL_URL OR NOT PERL_SHA256)
  message(FATAL_ERROR "PERL_PATH, PERL_URL, and PERL_SHA256 are required")
endif()

if(EXISTS "${PERL_PATH}/perl/bin/perl.exe")
  message(STATUS "Perl found: ${PERL_PATH}/perl/bin/perl.exe")
  return()
endif()

set(DOWNLOAD_URL "${PERL_URL}")
set(DOWNLOAD_PATH "${PERL_PATH}")
set(DOWNLOAD_SHA256 "${PERL_SHA256}")
include(${CMAKE_CURRENT_LIST_DIR}/DownloadUrl.cmake)

if(EXISTS "${PERL_PATH}/perl/bin/perl.exe")
  message(STATUS "Perl found: ${PERL_PATH}/perl/bin/perl.exe")
  return()
endif()

file(GLOB_RECURSE PERL_CANDIDATES LIST_DIRECTORIES false "${PERL_PATH}/perl.exe")
list(LENGTH PERL_CANDIDATES PERL_CANDIDATE_COUNT)

if(PERL_CANDIDATE_COUNT GREATER 0)
  list(GET PERL_CANDIDATES 0 PERL_CANDIDATE)
  message(FATAL_ERROR "Downloaded Perl, but expected ${PERL_PATH}/perl/bin/perl.exe (found ${PERL_CANDIDATE})")
endif()

message(FATAL_ERROR "Downloaded Perl, but perl.exe was not found under ${PERL_PATH}")
