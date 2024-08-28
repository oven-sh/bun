include(BuildLibrary)
include(GitClone)

add_custom_repository(
  NAME
    cares
  REPOSITORY
    c-ares/c-ares
  COMMIT
    d1722e6e8acaf10eb73fa995798a9cd421d9f85e
)

add_custom_library(
  TARGET
    cares
  PREFIX
    lib
  LIBRARIES
    cares
  INCLUDES
    include
  CMAKE_TARGETS
    c-ares
  CMAKE_ARGS
    -DCARES_STATIC=ON
    -DCARES_STATIC_PIC=ON # FORCE_PIC was set to 1, but CARES_STATIC_PIC was set to OFF??
    -DCARES_SHARED=OFF
    -DCARES_BUILD_TOOLS=OFF # this was set to ON?
)
