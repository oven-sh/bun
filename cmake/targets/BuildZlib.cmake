register_repository(
  NAME
    zlib
  REPOSITORY
    zlib-ng/zlib-ng
  COMMIT
    860e4cff7917d93f54f5d7f0bc1d0e8b1a3cb988
)

if(WIN32)
  if(DEBUG)
    set(ZLIB_LIBRARY "zlibd")
  else()
    set(ZLIB_LIBRARY "zlib")
  endif()
else()
  set(ZLIB_LIBRARY "z")
endif()

register_cmake_command(
  TARGET
    zlib
  TARGETS
    zlib
  ARGS
    -DBUILD_SHARED_LIBS=OFF
    -DWITH_GTEST=OFF
    -DZLIB_COMPAT=ON
    -DZLIB_ENABLE_TESTS=OFF
    -DZLIBNG_ENABLE_TESTS=OFF
  LIBRARIES
    ${ZLIB_LIBRARY}
  INCLUDES
    ${BUILD_PATH}/zlib
)
