optionx(ENABLE_RUST BOOL "If Rust should be used for compilation" DEFAULT ON)

if(NOT ENABLE_RUST)
  return()
endif()

if(ARCH STREQUAL "x64")
  set(DEFAULT_RUST_ARCH x86_64)
elseif(ARCH STREQUAL "aarch64")
  set(DEFAULT_RUST_ARCH aarch64)
else()
  unsupported(ARCH)
endif()

if(APPLE)
  set(DEFAULT_RUST_TARGET ${DEFAULT_RUST_ARCH}-apple-darwin)
elseif(LINUX)
  if(ABI STREQUAL "musl")
    set(DEFAULT_RUST_TARGET ${DEFAULT_RUST_ARCH}-unknown-linux-musl)
  else()
    set(DEFAULT_RUST_TARGET ${DEFAULT_RUST_ARCH}-unknown-linux-gnu)
  endif()
elseif(WIN32)
  set(DEFAULT_RUST_TARGET ${DEFAULT_RUST_ARCH}-pc-windows-msvc)
else()
  unsupported(CMAKE_SYSTEM_NAME)
endif()

optionx(RUST_TARGET STRING "The target architecture for Rust" DEFAULT ${DEFAULT_RUST_TARGET})

if(DEFINED ENV{CARGO_HOME})
  set(CARGO_HOME $ENV{CARGO_HOME})
elseif(CMAKE_HOST_WIN32)
  set(CARGO_HOME $ENV{USERPROFILE}/.cargo)
  if(NOT EXISTS ${CARGO_HOME})
    set(CARGO_HOME $ENV{PROGRAMFILES}/Rust/cargo)
  endif()
else()
  set(CARGO_HOME $ENV{HOME}/.cargo)
endif()

find_command(
  VARIABLE
    CARGO_EXECUTABLE
  COMMAND
    cargo
  PATHS
    ${CARGO_HOME}/bin
)

if(DEFINED ENV{RUSTUP_HOME})
  set(RUSTUP_HOME $ENV{RUSTUP_HOME})
elseif(CMAKE_HOST_WIN32)
  set(RUSTUP_HOME $ENV{USERPROFILE}/.rustup)
  if(NOT EXISTS ${RUSTUP_HOME})
    set(RUSTUP_HOME $ENV{PROGRAMFILES}/Rust/rustup)
  endif()
else()
  set(RUSTUP_HOME $ENV{HOME}/.rustup)
endif()

if(CMAKE_CROSSCOMPILING)
  find_command(
    VARIABLE
      RUSTUP_EXECUTABLE
    COMMAND
      rustup
    PATHS
      ${CARGO_HOME}/bin
  )

  register_command(
    TARGET
      clone-rust
    COMMENT
      "Downloading Rust toolchain: ${RUST_TARGET}"
    COMMAND
      ${RUSTUP_EXECUTABLE}
        target
        add
        ${RUST_TARGET}
    OUTPUTS
      ${CARGO_EXECUTABLE}
  )
endif()
