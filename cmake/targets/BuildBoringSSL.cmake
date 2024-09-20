register_vendor_target(boringssl)

register_repository(
  NAME
    ${boringssl}
  REPOSITORY
    oven-sh/boringssl
  COMMIT
    29a2cd359458c9384694b75456026e4b57e3e567
)

register_cmake_project(
  TARGET
    ${boringssl}
  CMAKE_TARGET
    crypto
    ssl
    decrepit
)

register_cmake_definitions(
  TARGET ${boringssl}
  BUILD_SHARED_LIBS=OFF
)

register_libraries(
  TARGET ${boringssl}
  crypto
  ssl
  decrepit
)
