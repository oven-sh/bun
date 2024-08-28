include(BuildLibrary)
include(GitClone)

add_custom_library(
  TARGET
    libdeflate
  LIBRARIES
    deflate
  INCLUDES
    .
  CMAKE_TARGETS
    libdeflate_static
  CMAKE_ARGS
    -DLIBDEFLATE_BUILD_STATIC_LIB=ON
    -DLIBDEFLATE_BUILD_SHARED_LIB=OFF
    -DLIBDEFLATE_BUILD_GZIP=OFF
)

add_custom_clone(
  REPOSITORY
    ebiggers/libdeflate
  COMMIT
    dc76454a39e7e83b68c3704b6e3784654f8d5ac5
)
