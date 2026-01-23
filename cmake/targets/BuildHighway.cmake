register_repository(
  NAME
    highway
  REPOSITORY
    google/highway
  COMMIT
    ac0d5d297b13ab1b89f48484fc7911082d76a93f
)

set(HIGHWAY_CMAKE_ARGS
  # Build a static library
  -DBUILD_SHARED_LIBS=OFF
  # Enable position-independent code for linking into the main executable
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON
  # Disable unnecessary components
  -DHWY_ENABLE_TESTS=OFF
  -DHWY_ENABLE_EXAMPLES=OFF
  -DHWY_ENABLE_CONTRIB=OFF
  # Disable building of the install target
  -DHWY_ENABLE_INSTALL=OFF
)

# On Windows ARM64 with clang-cl, the __ARM_NEON macro isn't defined by default
# but NEON intrinsics are supported. Define it so Highway can detect NEON support.
if(WIN32 AND CMAKE_SYSTEM_PROCESSOR MATCHES "ARM64|aarch64|AARCH64")
  list(APPEND HIGHWAY_CMAKE_ARGS
    -DCMAKE_C_FLAGS=-D__ARM_NEON=1
    -DCMAKE_CXX_FLAGS=-D__ARM_NEON=1
  )
endif()

register_cmake_command(
  TARGET
    highway
  LIBRARIES
    hwy
  ARGS
    ${HIGHWAY_CMAKE_ARGS}
  INCLUDES
    .
    hwy
)