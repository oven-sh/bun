register_command(
  TARGET
    zig-format-check
  COMMENT
    "Checking zig fmt"
  COMMAND
    ${CMAKE_ZIG_COMPILER}
      fmt
      --check
      ${BUN_ZIG_SOURCES}
  ALWAYS_RUN
)

register_command(
  TARGET
    zig-format
  COMMENT
    "Running zig fmt"
  COMMAND
    ${CMAKE_ZIG_COMPILER}
      fmt
      ${BUN_ZIG_SOURCES}
  ALWAYS_RUN
)
