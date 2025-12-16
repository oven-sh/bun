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

# utfcpp - header-only UTF-8 library for error handling in SIMD code
register_repository(
  NAME
    utfcpp
  REPOSITORY
    nemtrif/utfcpp
  TAG
    v4.0.5
)

# The ghostty source is cloned to ${VENDOR_PATH}/ghostty
# Bun's build.zig will reference it directly as a Zig module

# Build the SIMD acceleration library for ghostty
# This provides optimized UTF-8 decoding for terminal escape sequence parsing
set(GHOSTTY_SIMD_SRC ${VENDOR_PATH}/ghostty/src/simd/vt.cpp)

add_library(ghostty-simd STATIC ${GHOSTTY_SIMD_SRC})

target_include_directories(ghostty-simd PRIVATE
  # Bun's compatibility headers (simdutf.h wrapper)
  ${CWD}/src/deps/ghostty
  # Ghostty's own headers
  ${VENDOR_PATH}/ghostty/src
  # Highway SIMD library (from Bun's vendor)
  ${BUILD_PATH}/highway
  ${VENDOR_PATH}/highway
  # simdutf from webkit
  ${WEBKIT_INCLUDE_PATH}
  ${WEBKIT_INCLUDE_PATH}/wtf
  # utfcpp for UTF-8 error handling
  ${VENDOR_PATH}/utfcpp/source
)

target_compile_definitions(ghostty-simd PRIVATE
  # Highway configuration
  HWY_STATIC_DEFINE
)

# Enable exceptions for this file only - utfcpp's replace_invalid uses them
set_source_files_properties(${GHOSTTY_SIMD_SRC} PROPERTIES
  COMPILE_FLAGS "-fexceptions"
)

# Ensure dependencies are built first
add_dependencies(ghostty-simd clone-ghostty clone-utfcpp)
if(TARGET highway)
  add_dependencies(ghostty-simd highway)
endif()

# Link ghostty-simd into bun
target_link_libraries(${bun} PRIVATE ghostty-simd)

# Link highway library
target_link_libraries(${bun} PRIVATE ${BUILD_PATH}/highway/libhwy.a)
