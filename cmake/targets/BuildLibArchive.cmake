register_repository(
  NAME
    libarchive
  REPOSITORY
    libarchive/libarchive
  COMMIT
    9525f90ca4bd14c7b335e2f8c84a4607b0af6bdf
)

register_cmake_command(
  TARGET
    libarchive
  TARGETS
    archive_static
  ARGS
    -DCMAKE_POSITION_INDEPENDENT_CODE:BOOL=ON
    -DBUILD_SHARED_LIBS:BOOL=OFF
    -DENABLE_INSTALL:BOOL=OFF
    -DENABLE_TEST:BOOL=OFF
    -DENABLE_WERROR:BOOL=OFF
    -DENABLE_BZip2:BOOL=OFF
    -DENABLE_CAT:BOOL=OFF
    -DENABLE_CPIO:BOOL=OFF
    -DENABLE_UNZIP:BOOL=OFF
    -DENABLE_EXPAT:BOOL=OFF
    -DENABLE_ICONV:BOOL=OFF
    -DENABLE_LIBB2:BOOL=OFF
    -DENABLE_LibGCC:BOOL=OFF
    -DENABLE_LIBXML2:BOOL=OFF
    -DENABLE_WIN32_XMLLITE:BOOL=OFF
    -DENABLE_LZ4:BOOL=OFF
    -DENABLE_LZMA:BOOL=OFF
    -DENABLE_LZO:BOOL=OFF
    -DENABLE_MBEDTLS:BOOL=OFF
    -DENABLE_NETTLE:BOOL=OFF
    -DENABLE_OPENSSL:BOOL=OFF
    -DENABLE_PCRE2POSIX:BOOL=OFF
    -DENABLE_PCREPOSIX:BOOL=OFF
    -DENABLE_ZSTD:BOOL=OFF
    # libarchive depends on zlib headers, otherwise it will
    # spawn a processes to compress instead of using the library.
    -DENABLE_ZLIB:BOOL=OFF
    -DHAVE_ZLIB_H:BOOL=ON
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
