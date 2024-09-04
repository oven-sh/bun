include(Macros)

set(BUN_TARGETS)
set(BUN_DEPENDENCIES
  BoringSSL
  Brotli
  Cares
  LibArchive
  LibDeflate
  LolHtml
  Lshpack
  Mimalloc
  TinyCC
  Zlib
  Zstd
)

if(WIN32)
  list(APPEND BUN_DEPENDENCIES Libuv)
endif()

if(USE_STATIC_SQLITE)
  list(APPEND BUN_DEPENDENCIES SQLite)
endif()

foreach(dependency ${BUN_DEPENDENCIES})
  include(Build${dependency})
  string(TOLOWER ${dependency} target)
  list(APPEND BUN_TARGETS ${target})
endforeach()

register_command(
  TARGET
    dependencies
  COMMENT
    "Building dependencies"
  COMMAND
    ${CMAKE_COMMAND} -E true
  TARGETS
    ${BUN_TARGETS}
  ALWAYS_RUN
)