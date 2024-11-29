register_repository(
  NAME
    cares
  REPOSITORY
    c-ares/c-ares
  COMMIT
    c29e75d54c3743783d51a609980495cf553b4bca
)

register_cmake_command(
  TARGET
    cares
  TARGETS
    c-ares
  ARGS
    -DCARES_STATIC=ON
    -DCARES_STATIC_PIC=ON # FORCE_PIC was set to 1, but CARES_STATIC_PIC was set to OFF??
    -DCMAKE_POSITION_INDEPENDENT_CODE=ON
    -DCARES_SHARED=OFF
    -DCARES_BUILD_TOOLS=OFF # this was set to ON?
    -DCMAKE_INSTALL_LIBDIR=lib
  LIB_PATH
    lib
  LIBRARIES
    cares
  INCLUDES
    include
)
