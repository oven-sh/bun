set(ZIG_FORMAT_SOURCES ${BUN_ZIG_SOURCES})

register_command(
  TARGET
    zig-format-check
  COMMENT
    "Checking zig fmt"
  COMMAND
    ${ZIG_EXECUTABLE}
      fmt
      --check
      ${ZIG_FORMAT_SOURCES}
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
      ${ZIG_FORMAT_SOURCES}
  ALWAYS_RUN
)
