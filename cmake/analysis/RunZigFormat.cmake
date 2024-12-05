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

if(GIT_CHANGED_SOURCES)
  set(ZIG_FORMAT_CHANGED_SOURCES)
  foreach(source ${ZIG_FORMAT_SOURCES})
    list(FIND GIT_CHANGED_SOURCES ${source} index)
    if(NOT ${index} EQUAL -1)
      list(APPEND ZIG_FORMAT_CHANGED_SOURCES ${source})
    endif()
  endforeach()
endif()

if(ZIG_FORMAT_CHANGED_SOURCES)
  set(ZIG_FORMAT_DIFF_COMMAND ${ZIG_EXECUTABLE}
    fmt
    ${ZIG_FORMAT_CHANGED_SOURCES}
  )
else()
  set(ZIG_FORMAT_DIFF_COMMAND ${CMAKE_COMMAND} -E echo "No changed files for zig-format")
endif()

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
