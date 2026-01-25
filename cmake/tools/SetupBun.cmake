find_command(
  VARIABLE
    BUN_EXECUTABLE
  COMMAND
    bun
  PATHS
    $ENV{HOME}/.bun/bin
  VERSION
    >=1.1.26
)

if (NOT CI)
  # If node.js is not installed, it is extremely easy to make this path point to
  # a tempdir such as /private/tmp/bun-node-ce532901c/bun, which may cause this
  # CMake configuration break after tempdir is cleaned up (ex. after reboot).
  get_filename_component(BUN_EXECUTABLE ${BUN_EXECUTABLE} REALPATH)
  set(BUN_EXECUTABLE ${BUN_EXECUTABLE} CACHE FILEPATH "Bun executable" FORCE)
endif()

# On Windows ARM64, we need to add --smol flag to avoid crashes when running
# x64 bun under WoW64 emulation
if(WIN32 AND ARCH STREQUAL "aarch64")
  set(BUN_FLAGS "--smol" CACHE STRING "Extra flags for bun executable")
else()
  set(BUN_FLAGS "" CACHE STRING "Extra flags for bun executable")
endif()

# If this is not set, some advanced features are not checked.
# https://github.com/oven-sh/bun/blob/cd7f6a1589db7f1e39dc4e3f4a17234afbe7826c/src/bun.js/javascript.zig#L1069-L1072
setenv(BUN_GARBAGE_COLLECTOR_LEVEL 1)
setenv(BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING 1)
setenv(BUN_DEBUG_QUIET_LOGS 1)

# FIXME: https://github.com/oven-sh/bun/issues/11250
if(NOT WIN32)
  setenv(BUN_INSTALL_CACHE_DIR ${CACHE_PATH}/bun)
endif()
