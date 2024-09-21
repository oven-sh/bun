register_vendor_target(zlib)

register_repository(
  NAME
    ${zlib}
  REPOSITORY
    cloudflare/zlib
  COMMIT
    886098f3f339617b4243b286f5ed364b9989e245
)

register_libraries(
  TARGET ${zlib}
  z      ${UNIX}
  zlib   ${WIN32} AND ${RELEASE}
  zlibd  ${WIN32} AND ${DEBUG}
)

register_cmake_project(
  TARGET
    ${zlib}
  CMAKE_TARGET
    zlib
)

register_cmake_definitions(
  TARGET ${zlib}
  BUILD_SHARED_LIBS=OFF
  BUILD_EXAMPLES=OFF
)

# https://gitlab.kitware.com/cmake/cmake/-/issues/25755
if(APPLE)
  register_compiler_flags(
    -fno-define-target-os-macros
    TARGET ${zlib}
  )
endif()
