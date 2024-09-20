register_vendor_target(cares)

register_repository(
  NAME
    ${cares}
  REPOSITORY
    c-ares/c-ares
  COMMIT
    d1722e6e8acaf10eb73fa995798a9cd421d9f85e
)

register_cmake_project(
  TARGET
    ${cares}
  CMAKE_TARGET
    c-ares
)

register_cmake_definitions(
  TARGET ${cares}
  CARES_STATIC=ON
  CARES_STATIC_PIC=ON
  CARES_SHARED=OFF
  CARES_BUILD_TOOLS=OFF
  CMAKE_POSITION_INDEPENDENT_CODE=ON
)

register_libraries(
  TARGET ${cares}
  PATH lib
  cares
)
