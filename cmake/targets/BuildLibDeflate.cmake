register_repository(
  NAME
    libdeflate
  REPOSITORY
    ebiggers/libdeflate
  COMMIT
    733848901289eca058804ca0737f8796875204c8
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
