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

if(CMAKE_CROSSCOMPILING)
  if(ARCH STREQUAL "x64")
    set(RUST_ARCH x86_64)
  elseif(ARCH STREQUAL "arm64")
    set(RUST_ARCH aarch64)
  else()
    unsupported(ARCH)
  endif()

  if(APPLE)
    set(RUST_TARGET ${RUST_ARCH}-apple-darwin)
  elseif(LINUX)
    set(RUST_TARGET ${RUST_ARCH}-unknown-linux-gnu)
  elseif(WIN32)
    set(RUST_TARGET ${RUST_ARCH}-pc-windows-msvc)
  else()
    unsupported(CMAKE_SYSTEM_NAME)
  endif()

  list(APPEND LOLHTML_BUILD_ARGS --target=${RUST_TARGET})
endif()

# Windows requires unwind tables, apparently.
if(NOT WIN32)
  set(RUST_FLAGS "-Cpanic=abort -Cdebuginfo=0 -Cforce-unwind-tables=no -Copt-level=s")
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

# Notes for OSXCross, which doesn't work yet:
# CFLAGS += --sysroot=${CMAKE_OSX_SYSROOT}
# CXXFLAGS += --sysroot=${CMAKE_OSX_SYSROOT}
# LDFLAGS += -F${CMAKE_OSX_SYSROOT}/System/Library/Frameworks
# RUSTFLAGS += -C linker=${CMAKE_LINKER} -C link-arg=-F${CMAKE_OSX_SYSROOT}/System/Library/Frameworks -C link-arg=-L${CMAKE_OSX_SYSROOT}/usr/lib
