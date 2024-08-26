include(cmake/Utils.cmake)
include(cmake/GitClone.cmake)
include(cmake/BuildLibrary.cmake)

add_custom_library(
  TARGET
    boringssl
  LIBRARIES
    crypto
    ssl
    decrepit
  INCLUDES
    include
)

parse_option(USE_CUSTOM_BORINGSSL BOOL "Use custom brotli build" OFF)

if(NOT USE_CUSTOM_BORINGSSL)
  add_custom_clone(boringssl
    REPOSITORY
      oven-sh/boringssl
    COMMIT
      29a2cd359458c9384694b75456026e4b57e3e567
  )
endif()
