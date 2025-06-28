if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
  set(DEFAULT_ZIG_ARCH "aarch64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64|AMD64")
  set(DEFAULT_ZIG_ARCH "x86_64")
else()
  unsupported(CMAKE_SYSTEM_PROCESSOR)
endif()

if(APPLE)
  set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-macos-none)
elseif(WIN32)
  set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-windows-msvc)
elseif(LINUX)
  if(ABI STREQUAL "musl")
    set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-linux-musl)
  else()
    set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-linux-gnu)
  endif()
else()
  unsupported(CMAKE_SYSTEM_NAME)
endif()

set(ZIG_COMMIT "0a0120fa92cd7f6ab244865688b351df634f0707")
optionx(ZIG_TARGET STRING "The zig target to use" DEFAULT ${DEFAULT_ZIG_TARGET})

if(CMAKE_BUILD_TYPE STREQUAL "Release")
  if(ENABLE_ASAN)
    set(DEFAULT_ZIG_OPTIMIZE "ReleaseSafe")
  else()
    set(DEFAULT_ZIG_OPTIMIZE "ReleaseFast")
  endif()
elseif(CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseSafe")
elseif(CMAKE_BUILD_TYPE STREQUAL "MinSizeRel")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseSmall")
elseif(CMAKE_BUILD_TYPE STREQUAL "Debug")
  set(DEFAULT_ZIG_OPTIMIZE "Debug")
else()
  unsupported(CMAKE_BUILD_TYPE)
endif()

# Since Bun 1.1, Windows has been built using ReleaseSafe.
# This is because it caught more crashes, but we can reconsider this in the future
if(WIN32 AND DEFAULT_ZIG_OPTIMIZE STREQUAL "ReleaseFast")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseSafe")
endif()

optionx(ZIG_OPTIMIZE "ReleaseFast|ReleaseSafe|ReleaseSmall|Debug" "The Zig optimize level to use" DEFAULT ${DEFAULT_ZIG_OPTIMIZE})

# To use LLVM bitcode from Zig, more work needs to be done. Currently, an install of
# LLVM 18.1.7 does not compatible with what bitcode Zig 0.13 outputs (has LLVM 18.1.7)
# Change to "bc" to experiment, "Invalid record" means it is not valid output.
optionx(ZIG_OBJECT_FORMAT "obj|bc" "Output file format for Zig object files" DEFAULT obj)

optionx(ZIG_LOCAL_CACHE_DIR FILEPATH "The path to local the zig cache directory" DEFAULT ${CACHE_PATH}/zig/local)
optionx(ZIG_GLOBAL_CACHE_DIR FILEPATH "The path to the global zig cache directory" DEFAULT ${CACHE_PATH}/zig/global)

if(CI)
  set(ZIG_COMPILER_SAFE_DEFAULT ON)
else()
  set(ZIG_COMPILER_SAFE_DEFAULT OFF)
endif()

optionx(ZIG_COMPILER_SAFE BOOL "Download a ReleaseSafe build of the Zig compiler." DEFAULT ${ZIG_COMPILER_SAFE_DEFAULT})

setenv(ZIG_LOCAL_CACHE_DIR ${ZIG_LOCAL_CACHE_DIR})
setenv(ZIG_GLOBAL_CACHE_DIR ${ZIG_GLOBAL_CACHE_DIR})

setx(ZIG_PATH ${VENDOR_PATH}/zig)

if(WIN32)
  setx(ZIG_EXECUTABLE ${ZIG_PATH}/zig.exe)
else()
  setx(ZIG_EXECUTABLE ${ZIG_PATH}/zig)
endif()

set(CMAKE_ZIG_FLAGS
  --cache-dir ${ZIG_LOCAL_CACHE_DIR}
  --global-cache-dir ${ZIG_GLOBAL_CACHE_DIR}
  --zig-lib-dir ${ZIG_PATH}/lib
)

register_command(
  TARGET
    clone-zig
  COMMENT
    "Downloading zig"
  COMMAND
    ${CMAKE_COMMAND}
      -DZIG_PATH=${ZIG_PATH}
      -DZIG_COMMIT=${ZIG_COMMIT}
      -DENABLE_ASAN=${ENABLE_ASAN}
      -DZIG_COMPILER_SAFE=${ZIG_COMPILER_SAFE}
      -P ${CWD}/cmake/scripts/DownloadZig.cmake
  SOURCES
    ${CWD}/cmake/scripts/DownloadZig.cmake
  OUTPUTS
    ${ZIG_EXECUTABLE}
)
