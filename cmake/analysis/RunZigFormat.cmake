register_command(
  TARGET
    zig-format-check
  COMMENT
    "Checking zig fmt"
  COMMAND
    ${ZIG_EXECUTABLE}
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
    ${ZIG_EXECUTABLE}
      fmt
      ${BUN_ZIG_SOURCES}
  ALWAYS_RUN
)
