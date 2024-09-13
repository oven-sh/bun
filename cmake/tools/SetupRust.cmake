find_command(
  VARIABLE
    CARGO_EXECUTABLE
  COMMAND
    cargo
  PATHS
    $ENV{HOME}/.cargo/bin
  REQUIRED
    OFF
)

if(EXISTS ${CARGO_EXECUTABLE})
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
