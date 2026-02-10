register_repository(
  NAME
    boringssl
  REPOSITORY
    oven-sh/boringssl
  COMMIT
    4f4f5ef8ebc6e23cbf393428f0ab1b526773f7ac
)

set(BORINGSSL_CMAKE_ARGS -DBUILD_SHARED_LIBS=OFF)

# Disable ASM on Windows ARM64 to avoid mixing non-ARM object files into ARM64 libs
if(WIN32 AND CMAKE_SYSTEM_PROCESSOR MATCHES "ARM64|aarch64|AARCH64")
  list(APPEND BORINGSSL_CMAKE_ARGS -DOPENSSL_NO_ASM=1)
endif()

register_cmake_command(
  TARGET
    boringssl
  LIBRARIES
    crypto
    ssl
    decrepit
  ARGS
    ${BORINGSSL_CMAKE_ARGS}
  INCLUDES
    include
)
