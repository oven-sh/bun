register_repository(
  NAME
    lsquic
  REPOSITORY
    litespeedtech/lsquic
  COMMIT
    70486141724f85e97b08f510673e29f399bbae8f
)

set(Lsquic_CMAKE_C_FLAGS "")

if (ENABLE_ASAN)
  STRING(APPEND Lsquic_CMAKE_C_FLAGS "-fsanitize=address")
endif()

register_cmake_command(
  TARGET
    lsquic
  LIBRARIES
    lsquic
  LIB_PATH
    src/liblsquic
  ARGS
    -DSHARED=OFF
    -DLSQUIC_SHARED_LIB=0
    -DBORINGSSL_DIR=${VENDOR_PATH}/boringssl
    -DBORINGSSL_LIB=${BUILD_PATH}/boringssl
    -DZLIB_INCLUDE_DIR=${VENDOR_PATH}/zlib
    -DZLIB_LIB=${BUILD_PATH}/zlib/libz.a
    -DCMAKE_BUILD_TYPE=Release
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON
    -DCMAKE_C_FLAGS="${Lsquic_CMAKE_C_FLAGS}"
    -DLSQUIC_BIN=OFF
    -DLSQUIC_TESTS=OFF
    -DLSQUIC_WEBTRANSPORT=OFF
  INCLUDES
    include
    src/liblsquic
  DEPENDS
    BoringSSL
    Zlib
)