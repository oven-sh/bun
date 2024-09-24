register_vendor_target(lolhtml)

register_repository(
  NAME
    ${lolhtml}
  REPOSITORY
    cloudflare/lol-html
  COMMIT
    8d4c273ded322193d017042d1f48df2766b0f88b
)

if(DEBUG)
  set(${lolhtml}_BUILD_TYPE debug)
else()
  set(${lolhtml}_BUILD_TYPE release)
endif()

register_libraries(
  TARGET ${lolhtml}
  PATH ${${lolhtml}_BUILD_TYPE}
  VARIABLE ${lolhtml}_LIBRARY
  lolhtml
)

set(${lolhtml}_BUILD_COMMAND
  ${CARGO_EXECUTABLE}
    build
    --target-dir ${${lolhtml}_BUILD_PATH}
)

if(RELEASE)
  list(APPEND ${lolhtml}_BUILD_COMMAND --release)
endif()

register_command(
  TARGET
    build-${lolhtml}
  CWD
    ${${lolhtml}_CWD}/c-api
  COMMAND
    ${${lolhtml}_BUILD_COMMAND}
  ARTIFACTS
    ${${lolhtml}_LIBRARY}
)

if(TARGET clone-${lolhtml})
  add_dependencies(build-${lolhtml} clone-${lolhtml})
endif()

add_dependencies(${lolhtml} build-${lolhtml})
