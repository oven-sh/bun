register_repository(
  NAME
    libarchive
  REPOSITORY
    libarchive/libarchive
  COMMIT
    7ce42547f682ea79f9382d580bd97355c0885a0f
)

register_cmake_command(
  TARGET
    libarchive
  TARGETS
    archive_static
  ARGS
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON
    -DBUILD_SHARED_LIBS=OFF
    -DENABLE_INSTALL=OFF
    -DENABLE_TEST=OFF
    -DENABLE_WERROR=OFF
    -DENABLE_BZip2=OFF
    -DENABLE_CAT=OFF
    -DENABLE_EXPAT=OFF
    -DENABLE_ICONV=OFF
    -DENABLE_LIBB2=OFF
    -DENABLE_LibGCC=OFF
    -DENABLE_LIBXML2=OFF
    -DENABLE_LZ4=OFF
    -DENABLE_LZMA=OFF
    -DENABLE_LZO=OFF
    -DENABLE_MBEDTLS=OFF
    -DENABLE_NETTLE=OFF
    -DENABLE_OPENSSL=OFF
    -DENABLE_PCRE2POSIX=OFF
    -DENABLE_PCREPOSIX=OFF
    -DENABLE_ZSTD=OFF
    # libarchive depends on zlib headers, otherwise it will
    # spawn a processes to compress instead of using the library.
    -DENABLE_ZLIB=OFF
    -DHAVE_ZLIB_H=ON
    -DCMAKE_C_FLAGS="-I${VENDOR_PATH}/zlib"
  LIB_PATH
    libarchive
  LIBRARIES
    archive
  INCLUDES
    include
)

# Must be loaded after zlib is defined
if(TARGET clone-zlib)
  add_dependencies(libarchive clone-zlib)
endif()
