include(Macros)
include(SetupRust)

register_repository(
  NAME
    lolhtml
  REPOSITORY
    cloudflare/lol-html
  COMMIT
    8d4c273ded322193d017042d1f48df2766b0f88b
)

set(LOLHTML_BUILD_ARGS
  --target-dir ${BUILD_PATH}/lolhtml
)

if(RELEASE)
  list(APPEND LOLHTML_BUILD_ARGS --release)
endif()

if(CMAKE_VERBOSE_MAKEFILE)
  list(APPEND LOLHTML_BUILD_ARGS --verbose)
endif()

if(DEBUG)
  set(LOLHTML_PREFIX debug)
else()
  set(LOLHTML_PREFIX release)
endif()

add_custom_library(
  TARGET
    lolhtml
  PREFIX
    ${LOLHTML_PREFIX}
  LIBRARIES
    lolhtml
  INCLUDES
    c-api/include
  WORKING_DIRECTORY
    c-api
  COMMAND
    ${CARGO_EXECUTABLE}
      build
      ${LOLHTML_BUILD_ARGS}
)
