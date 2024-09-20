register_vendor_target(libarchive)

register_repository(
  NAME
    ${libarchive}
  REPOSITORY
    libarchive/libarchive
  COMMIT
    898dc8319355b7e985f68a9819f182aaed61b53a
)

register_cmake_project(
  TARGET
    ${libarchive}
  CMAKE_TARGET
    archive_static
)

register_cmake_definitions(
  TARGET ${libarchive}
  CMAKE_POSITION_INDEPENDENT_CODE=ON
  BUILD_SHARED_LIBS=OFF
  ENABLE_INSTALL=OFF
  ENABLE_TEST=OFF
  ENABLE_WERROR=OFF
  ENABLE_BZIP2=OFF
  ENABLE_CAT=OFF
  ENABLE_EXPAT=OFF
  ENABLE_ICONV=OFF
  ENABLE_LIBB2=OFF
  ENABLE_LibGCC=OFF
  ENABLE_LIBXML2=OFF
  ENABLE_LZ4=OFF
  ENABLE_LZMA=OFF
  ENABLE_LZO=OFF
  ENABLE_MBEDTLS=OFF
  ENABLE_NETTLE=OFF
  ENABLE_OPENSSL=OFF
  ENABLE_PCRE2POSIX=OFF
  ENABLE_PCREPOSIX=OFF
  ENABLE_ZSTD=OFF
  ENABLE_ZLIB=OFF
  HAVE_ZLIB_H=ON
)

register_libraries(
  TARGET ${libarchive}
  PATH libarchive
  archive
)

# libarchive depends on zlib headers, otherwise it will
# spawn a processes to compress instead of using the library.
register_includes(
  ${VENDOR_PATH}/zlib
  TARGET ${libarchive}
)

if(TARGET clone-zlib)
  add_dependencies(libarchive clone-zlib)
endif()
