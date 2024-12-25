register_repository(
  NAME
    cares
  REPOSITORY
    c-ares/c-ares
  COMMIT
    4f4912bce7374f787b10576851b687935f018e17
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
