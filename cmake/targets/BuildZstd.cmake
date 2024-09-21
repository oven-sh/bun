register_vendor_target(zstd)

register_repository(
  NAME
    ${zstd}
  REPOSITORY
    facebook/zstd
  COMMIT
    794ea1b0afca0f020f4e57b6732332231fb23c70
)

register_libraries(
  TARGET ${zstd}
  PATH lib
  zstd_static ${WIN32}
  zstd ${UNIX}
)

register_cmake_project(
  TARGET
    ${zstd}
  CMAKE_TARGET
    libzstd_static
  CMAKE_PATH
    build/cmake
)

register_cmake_definitions(
  TARGET ${zstd}
  ZSTD_BUILD_STATIC=ON
  ZSTD_BUILD_PROGRAMS=OFF
  ZSTD_BUILD_TESTS=OFF
  ZSTD_BUILD_CONTRIB=OFF
)
