register_repository(
  NAME
    lshpack
  REPOSITORY
    litespeedtech/ls-hpack
  COMMIT
    8905c024b6d052f083a3d11d0a169b3c2735c8a1
)

if(WIN32)
  set(LSHPACK_INCLUDES . compat/queue)
else()
  set(LSHPACK_INCLUDES .)
endif()

# Suppress all warnings from vendored lshpack on Windows (clang-cl)
if(WIN32)
  set(LSHPACK_CMAKE_ARGS "-DCMAKE_C_FLAGS=-w")
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
    ${LSHPACK_CMAKE_ARGS}
  INCLUDES
    ${LSHPACK_INCLUDES}
)
