register_vendor_target(lshpack)

register_repository(
  NAME
    ${lshpack}
  REPOSITORY
    litespeedtech/ls-hpack
  COMMIT
    3d0f1fc1d6e66a642e7a98c55deb38aa986eb4b0
)

register_cmake_project(
  TARGET
    ${lshpack}
  CMAKE_TARGETS
    ls-hpack
)

register_cmake_definitions(
  TARGET ${lshpack}
  SHARED=OFF
  LSHPACK_XXH=ON
  BUILD_TESTING=OFF
)

# FIXME: There are linking errors when built with non-Release
# Undefined symbols for architecture arm64:
# "___asan_handle_no_return", referenced from:
#     _lshpack_enc_get_static_nameval in libls-hpack.a(lshpack.c.o)
#     _lshpack_enc_get_static_name in libls-hpack.a(lshpack.c.o)
#     _update_hash in libls-hpack.a(lshpack.c.o)
if(NOT CMAKE_BUILD_TYPE STREQUAL "Release")
  register_cmake_definitions(
    TARGET ${lshpack}
    CMAKE_BUILD_TYPE=Release
  )
endif()

register_libraries(
  TARGET ${lshpack}
  ls-hpack
)
