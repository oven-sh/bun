register_repository(
  NAME
    lshpack
  REPOSITORY
    litespeedtech/ls-hpack
  COMMIT
    3d0f1fc1d6e66a642e7a98c55deb38aa986eb4b0
)

if(WIN32)
  set(LSHPACK_INCLUDES . compat/queue)
else()
  set(LSHPACK_INCLUDES .)
endif()

register_cmake_command(
  TARGET
    lshpack
  LIBRARIES
    ls-hpack
  ARGS
    -DSHARED=OFF
    -DLSHPACK_XXH=ON
    # There are linking errors when built with non-Release
    # Undefined symbols for architecture arm64:
    # "___asan_handle_no_return", referenced from:
    #     _lshpack_enc_get_static_nameval in libls-hpack.a(lshpack.c.o)
    #     _lshpack_enc_get_static_name in libls-hpack.a(lshpack.c.o)
    #     _update_hash in libls-hpack.a(lshpack.c.o)
    -DCMAKE_BUILD_TYPE=Release
  INCLUDES
    ${LSHPACK_INCLUDES}
)
