register_repository(
  NAME
    libdeflate
  REPOSITORY
    ebiggers/libdeflate
  COMMIT
    dc76454a39e7e83b68c3704b6e3784654f8d5ac5
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
