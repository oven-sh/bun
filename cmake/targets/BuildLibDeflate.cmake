register_vendor_target(libdeflate)

register_repository(
  NAME
    ${libdeflate}
  REPOSITORY
    ebiggers/libdeflate
  COMMIT
    dc76454a39e7e83b68c3704b6e3784654f8d5ac5
)

register_libraries(
  TARGET ${libdeflate}
  deflatestatic ${WIN32}
  deflate ${UNIX}
)

register_cmake_project(
  TARGET
    ${libdeflate}
  CMAKE_TARGET
    libdeflate_static
)

register_cmake_definitions(
  TARGET ${libdeflate}
  LIBDEFLATE_BUILD_STATIC_LIB=ON
  LIBDEFLATE_BUILD_SHARED_LIB=OFF
  LIBDEFLATE_BUILD_GZIP=OFF
)
