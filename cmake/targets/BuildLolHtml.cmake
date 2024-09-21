register_vendor_target(lolhtml)

register_repository(
  NAME
    ${lolhtml}
  REPOSITORY
    cloudflare/lol-html
  COMMIT
    8d4c273ded322193d017042d1f48df2766b0f88b
)

set(LOLHTML_CWD ${VENDOR_PATH}/${lolhtml}/c-api)
set(LOLHTML_BUILD_PATH ${BUILD_PATH}/vendor/${lolhtml})

if(DEBUG)
  set(LOLHTML_BUILD_TYPE debug)
else()
  set(LOLHTML_BUILD_TYPE release)
endif()

set(LOLHTML_BUILD_ARGS --target-dir ${LOLHTML_BUILD_PATH})

if(RELEASE)
  list(APPEND LOLHTML_BUILD_ARGS --release)
endif()

register_libraries(
  TARGET ${lolhtml}
  PATH ${LOLHTML_BUILD_TYPE}
  lolhtml
)

register_command(
  TARGET
    build-${lolhtml}
  CWD
    ${LOLHTML_CWD}
  COMMAND
    ${CARGO_EXECUTABLE}
      build
      ${LOLHTML_BUILD_ARGS}
  OUTPUTS
    ${LOLHTML_BUILD_PATH}/${LOLHTML_BUILD_TYPE}/${CMAKE_STATIC_LIBRARY_PREFIX}lolhtml${CMAKE_STATIC_LIBRARY_SUFFIX}
)

if(TARGET clone-${lolhtml})
  add_dependencies(build-${lolhtml} clone-${lolhtml})
endif()

add_dependencies(${lolhtml} build-${lolhtml})
