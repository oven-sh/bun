register_repository(
  NAME
    lolhtml
  REPOSITORY
    cloudflare/lol-html
  COMMIT
    67f1d4ffd6b74db7e053fb129dcce620193c180d
)

set(LOLHTML_CWD ${VENDOR_PATH}/lolhtml/c-api)
set(LOLHTML_BUILD_PATH ${BUILD_PATH}/lolhtml)

if(DEBUG)
  set(LOLHTML_BUILD_TYPE debug)
else()
  set(LOLHTML_BUILD_TYPE release)
endif()

set(LOLHTML_LIBRARY ${LOLHTML_BUILD_PATH}/${RUST_TARGET}/${LOLHTML_BUILD_TYPE}/${CMAKE_STATIC_LIBRARY_PREFIX}lolhtml${CMAKE_STATIC_LIBRARY_SUFFIX})

set(LOLHTML_BUILD_ARGS
  --target-dir ${BUILD_PATH}/lolhtml
  --target ${RUST_TARGET}
)

if(RELEASE)
  list(APPEND LOLHTML_BUILD_ARGS --release)
endif()

# Windows requires unwind tables, apparently.
if(NOT WIN32)
  set(RUST_FLAGS "-Cpanic=abort -Cdebuginfo=0 -Cforce-unwind-tables=no -Copt-level=s")
endif()

if(TARGET clone-rust)
  set(LOLHTML_TARGETS clone-rust)
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
  TARGETS
    ${LOLHTML_TARGETS}
  ARTIFACTS
    ${LOLHTML_LIBRARY}
  ENVIRONMENT
    CARGO_TERM_COLOR=always
    CARGO_TERM_VERBOSE=true
    CARGO_TERM_DIAGNOSTIC=true
    CARGO_HOME=${CARGO_HOME}
    RUSTUP_HOME=${RUSTUP_HOME}
    CC=${CMAKE_C_COMPILER}
    CFLAGS=${CMAKE_C_FLAGS}
    CXX=${CMAKE_CXX_COMPILER}
    CXXFLAGS=${CMAKE_CXX_FLAGS}
    AR=${CMAKE_AR}
    RUSTFLAGS=${RUST_FLAGS}
)

target_link_libraries(${bun} PRIVATE ${LOLHTML_LIBRARY})
if(BUN_LINK_ONLY)
  target_sources(${bun} PRIVATE ${LOLHTML_LIBRARY})
endif()
