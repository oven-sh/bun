include(cmake/BuildLibrary.cmake)
include(cmake/GitClone.cmake)

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

add_custom_clone(
  REPOSITORY
    oven-sh/boringssl
  COMMIT
    29a2cd359458c9384694b75456026e4b57e3e567
)
