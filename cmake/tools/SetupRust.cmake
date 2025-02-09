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

find_command(
  VARIABLE
    CARGO_EXECUTABLE
  COMMAND
    cargo
  PATHS
    ${CARGO_HOME}/bin
  REQUIRED
    OFF
)

if(EXISTS ${CARGO_EXECUTABLE})
  if(CARGO_EXECUTABLE MATCHES "^${CARGO_HOME}")
    setx(CARGO_HOME ${CARGO_HOME})
    setx(RUSTUP_HOME ${RUSTUP_HOME})
  endif()

  return()
endif()

if(CMAKE_HOST_WIN32)
  set(CARGO_INSTALL_COMMAND "choco install rust")
else()
  set(CARGO_INSTALL_COMMAND "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh")
endif()

message(FATAL_ERROR "Command not found: cargo\n"
  "Do you have Rust installed? To fix this, try running:\n"
  "   ${CARGO_INSTALL_COMMAND}\n"
)
