register_repository(
  NAME
    lolhtml
  REPOSITORY
    cloudflare/lol-html
  COMMIT
    e9e16dca48dd4a8ffbc77642bc4be60407585f11
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

# On Windows, ensure MSVC link.exe is used instead of Git's link.exe
set(LOLHTML_ENV
  CARGO_TERM_COLOR=always
  CARGO_TERM_VERBOSE=true
  CARGO_TERM_DIAGNOSTIC=true
  CARGO_ENCODED_RUSTFLAGS=${RUSTFLAGS}
  CARGO_HOME=${CARGO_HOME}
  RUSTUP_HOME=${RUSTUP_HOME}
)

if(WIN32)
  # On Windows, tell Rust to use MSVC link.exe directly via the target-specific linker env var.
  # This avoids Git's /usr/bin/link being found first in PATH.
  # Find the MSVC link.exe from Visual Studio installation
  file(GLOB MSVC_VERSIONS "C:/Program Files/Microsoft Visual Studio/2022/*/VC/Tools/MSVC/*")
  if(MSVC_VERSIONS)
    list(GET MSVC_VERSIONS -1 MSVC_LATEST)  # Get the latest version
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "ARM64|aarch64")
      set(MSVC_LINK_PATH "${MSVC_LATEST}/bin/HostARM64/arm64/link.exe")
      set(CARGO_LINKER_VAR "CARGO_TARGET_AARCH64_PC_WINDOWS_MSVC_LINKER")
    else()
      set(MSVC_LINK_PATH "${MSVC_LATEST}/bin/Hostx64/x64/link.exe")
      set(CARGO_LINKER_VAR "CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER")
    endif()
    if(EXISTS "${MSVC_LINK_PATH}")
      list(APPEND LOLHTML_ENV "${CARGO_LINKER_VAR}=${MSVC_LINK_PATH}")
      message(STATUS "lolhtml: Using MSVC link.exe: ${MSVC_LINK_PATH}")
    endif()
  endif()
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
    ${LOLHTML_ENV}
)

target_link_libraries(${bun} PRIVATE ${LOLHTML_LIBRARY})
if(BUN_LINK_ONLY)
  target_sources(${bun} PRIVATE ${LOLHTML_LIBRARY})
endif()
