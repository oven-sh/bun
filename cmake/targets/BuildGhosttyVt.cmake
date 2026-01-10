# Build libghostty-vt - Terminal VT emulator library from Ghostty
# This clones the ghostty repository so Bun's build.zig can import it as a Zig module.
#
# libghostty-vt provides:
# - Terminal escape sequence parsing
# - Terminal state management (screen, cursor, scrollback)
# - Input event encoding (Kitty keyboard protocol)
# - OSC/DCS/CSI sequence handling
#
# Usage in Zig: @import("ghostty") gives access to the lib_vt.zig API

register_repository(
  NAME
    ghostty
  REPOSITORY
    ghostty-org/ghostty
  TAG
    v1.1.3
)

# The ghostty source is cloned to ${VENDOR_PATH}/ghostty
# Bun's build.zig will reference it directly as a Zig module
