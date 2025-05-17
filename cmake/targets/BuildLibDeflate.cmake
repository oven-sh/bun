register_repository(
  NAME
    libdeflate
  REPOSITORY
    ebiggers/libdeflate
  COMMIT
    78051988f96dc8d8916310d8b24021f01bd9e102
)

register_cmake_command(
  TARGET
    libdeflate
  TARGETS
    libdeflate_static
  ARGS
    -DLIBDEFLATE_BUILD_STATIC_LIB=ON
    -DLIBDEFLATE_BUILD_SHARED_LIB=OFF
    -DLIBDEFLATE_BUILD_GZIP=OFF
  LIBRARIES
    deflatestatic WIN32
    deflate UNIX
  INCLUDES
    .
)
