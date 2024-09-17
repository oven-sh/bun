register_repository(
  NAME
    zlib
  REPOSITORY
    cloudflare/zlib
  COMMIT
    886098f3f339617b4243b286f5ed364b9989e245
)

if(WIN32)
  if(DEBUG)
    set(ZLIB_LIBRARY "zlibd")
  else()
    set(ZLIB_LIBRARY "zlib")
  endif()
else()
  set(ZLIB_LIBRARY "z")
endif()

register_cmake_command(
  TARGET
    zlib
  TARGETS
    zlib
  ARGS
    -DBUILD_SHARED_LIBS=OFF
    -DBUILD_EXAMPLES=OFF
  LIBRARIES
    ${ZLIB_LIBRARY}
)

# https://gitlab.kitware.com/cmake/cmake/-/issues/25755
if(APPLE)
  register_compiler_flags(
    TARGET zlib
    DESCRIPTION "Fix zlib on macOS"
    -fno-define-target-os-macros
  )
endif()
