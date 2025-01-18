register_repository(
  NAME
    lolhtml
  REPOSITORY
    cloudflare/lol-html
  COMMIT
    4f8becea13a0021c8b71abd2dcc5899384973b66
)

set(LOLHTML_CWD ${VENDOR_PATH}/lolhtml/c-api)
set(LOLHTML_BUILD_PATH ${BUILD_PATH}/lolhtml)

if(DEBUG)
  set(LOLHTML_BUILD_TYPE debug)
else()
  set(LOLHTML_BUILD_TYPE release)
endif()

set(LOLHTML_LIBRARY ${LOLHTML_BUILD_PATH}/${LOLHTML_BUILD_TYPE}/${CMAKE_STATIC_LIBRARY_PREFIX}lolhtml${CMAKE_STATIC_LIBRARY_SUFFIX})

set(LOLHTML_BUILD_ARGS
  --target-dir ${BUILD_PATH}/lolhtml
)

if(RELEASE)
  list(APPEND LOLHTML_BUILD_ARGS --release)
endif()

# Windows requires unwind tables, apparently.
if (NOT WIN32)
  # The encoded escape sequences are intentional. They're how you delimit multiple arguments in a single environment variable.
  # Also add rust optimization flag for smaller binary size, but not huge speed penalty.
  set(RUSTFLAGS "-Cpanic=abort-Cdebuginfo=0-Cforce-unwind-tables=no-Copt-level=s")
endif()

register_command(
  TARGET
    lolhtml
  CWD
    ${LOLHTML_CWD}
  COMMAND
    ${CARGO_EXECUTABLE}
      build
      ${LOLHTML_BUILD_ARGS}
  ARTIFACTS
    ${LOLHTML_LIBRARY}
  ENVIRONMENT
    CARGO_TERM_COLOR=always
    CARGO_TERM_VERBOSE=true
    CARGO_TERM_DIAGNOSTIC=true
    CARGO_ENCODED_RUSTFLAGS=${RUSTFLAGS}
    CARGO_HOME=${CARGO_HOME}
    RUSTUP_HOME=${RUSTUP_HOME}
)

target_link_libraries(${bun} PRIVATE ${LOLHTML_LIBRARY})
if(BUN_LINK_ONLY)
  target_sources(${bun} PRIVATE ${LOLHTML_LIBRARY})
endif()
