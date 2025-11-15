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

register_command(
  TARGET
    zig-format-diff
  COMMENT
    "Running zig fmt on changed files"
  COMMAND
    ${ZIG_FORMAT_DIFF_COMMAND}
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)
