include(cmake/BuildLibrary.cmake)
include(cmake/GitClone.cmake)

add_custom_library(
  TARGET
    brotli
  LIBRARIES
    brotlicommon
    brotlidec
    brotlienc
  INCLUDES
    c/include
  CMAKE_ARGS
    -DBUILD_SHARED_LIBS=OFF
    -DBROTLI_BUILD_TOOLS=OFF
    -DBROTLI_EMSCRIPTEN=OFF
    -DBROTLI_DISABLE_TESTS=ON
)

parse_option(USE_CUSTOM_BROTLI BOOL "Use custom brotli build" OFF)

if(NOT USE_CUSTOM_BROTLI)
  add_custom_clone(brotli
    REPOSITORY
      google/brotli
    TAG
      v1.1.0
  )
endif()
