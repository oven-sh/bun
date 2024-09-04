include(Macros)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
  set(DEFAULT_ZIG_ARCH "aarch64")
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64|AMD64")
  set(DEFAULT_ZIG_ARCH "x86_64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_SYSTEM_PROCESSOR}")
endif()

if(APPLE)
  set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-macos-none)
elseif(WIN32)
  set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-windows-msvc)
elseif(LINUX)
  set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-linux-gnu)
else()
  message(FATAL_ERROR "Unsupported operating system: ${CMAKE_SYSTEM_NAME}")
endif()

optionx(ZIG_TARGET STRING "The zig target to use" DEFAULT ${DEFAULT_ZIG_TARGET})

if(CMAKE_BUILD_TYPE STREQUAL "Release")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseFast")
elseif(CMAKE_BUILD_TYPE STREQUAL "RelWithDebInfo")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseSafe")
elseif(CMAKE_BUILD_TYPE STREQUAL "MinSizeRel")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseSmall")
elseif(CMAKE_BUILD_TYPE STREQUAL "Debug")
  set(DEFAULT_ZIG_OPTIMIZE "Debug")
endif()

# Since Bun 1.1, Windows has been built using ReleaseSafe.
# This is because it caught more crashes, but we can reconsider this in the future
if(WIN32 AND DEFAULT_ZIG_OPTIMIZE STREQUAL "ReleaseFast")
  set(DEFAULT_ZIG_OPTIMIZE "ReleaseSafe")
endif()

optionx(ZIG_OPTIMIZE "ReleaseFast|ReleaseSafe|MinSizeRel|Debug" "The Zig optimize level to use" DEFAULT ${DEFAULT_ZIG_OPTIMIZE})

# To use LLVM bitcode from Zig, more work needs to be done. Currently, an install of
# LLVM 18.1.7 does not compatible with what bitcode Zig 0.13 outputs (has LLVM 18.1.7)
# Change to "bc" to experiment, "Invalid record" means it is not valid output.
optionx(ZIG_OBJECT_FORMAT "obj|bc" "Output file format for Zig object files" DEFAULT obj)

optionx(ZIG_VERSION STRING "The version of zig to use" DEFAULT "0.13.0")
optionx(ZIG_LOCAL_CACHE_DIR FILEPATH "The path to local the zig cache directory" DEFAULT ${CACHE_PATH}/zig/local)
optionx(ZIG_GLOBAL_CACHE_DIR FILEPATH "The path to the global zig cache directory" DEFAULT ${CACHE_PATH}/zig/global)
optionx(ZIG_BIN_CACHE_DIR FILEPATH "The path to the zig binary cache directory" DEFAULT ${CACHE_PATH}/zig/bin)
optionx(ZIG_REPOSITORY_PATH FILEPATH "The path to the Zig repository" DEFAULT ${CWD}/src/deps/zig)

register_repository(
  NAME
    zig
  REPOSITORY
    oven-sh/zig
  COMMIT
    131a009ba2eb127a3447d05b9e12f710429aa5ee
  PATH
    ${ZIG_REPOSITORY_PATH}
)

set(CMAKE_ZIG_FLAGS
  --cache-dir ${ZIG_LOCAL_CACHE_DIR}
  --global-cache-dir ${ZIG_GLOBAL_CACHE_DIR}
  --zig-lib-dir ${ZIG_REPOSITORY_PATH}/lib
)

find_command(
  VARIABLE
    CMAKE_ZIG_COMPILER
  COMMAND
    zig
    zig.exe
  PATHS
    ${ZIG_BIN_CACHE_DIR}
  VERSION
    ${ZIG_VERSION}
  REQUIRED
    OFF
)

if(EXISTS ${CMAKE_ZIG_COMPILER})
  return()
endif()

if(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
  set(ZIG_HOST_ARCH "aarch64")
elseif(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64|AMD64")
  set(ZIG_HOST_ARCH "x86_64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_HOST_SYSTEM_PROCESSOR}")
endif()

if(CMAKE_HOST_APPLE)
  set(ZIG_HOST_OS "macos")
elseif(CMAKE_HOST_WIN32)
  set(ZIG_HOST_OS "windows")
elseif(CMAKE_HOST_UNIX)
  set(ZIG_HOST_OS "linux")
else()
  message(FATAL_ERROR "Unsupported operating system: ${CMAKE_HOST_SYSTEM_NAME}")
endif()

set(ZIG_NAME zig-${ZIG_HOST_OS}-${ZIG_HOST_ARCH}-${ZIG_VERSION})

if(CMAKE_HOST_WIN32)
  set(ZIG_EXE "zig.exe")
  set(ZIG_FILENAME ${ZIG_NAME}.zip)
else()
  set(ZIG_EXE "zig")
  set(ZIG_FILENAME ${ZIG_NAME}.tar.xz)
endif()

setx(ZIG_DOWNLOAD_URL https://ziglang.org/download/${ZIG_VERSION}/${ZIG_FILENAME})

file(DOWNLOAD ${ZIG_DOWNLOAD_URL} ${ZIG_BIN_CACHE_DIR}/${ZIG_FILENAME})
file(ARCHIVE_EXTRACT INPUT ${ZIG_BIN_CACHE_DIR}/${ZIG_FILENAME} DESTINATION ${ZIG_BIN_CACHE_DIR})
file(REMOVE ${ZIG_BIN_CACHE_DIR}/${ZIG_FILENAME})
file(COPY ${ZIG_BIN_CACHE_DIR}/${ZIG_NAME}/${ZIG_EXE} DESTINATION ${ZIG_BIN_CACHE_DIR})
file(REMOVE_RECURSE ${ZIG_BIN_CACHE_DIR}/${ZIG_NAME})
file(CHMOD ${ZIG_BIN_CACHE_DIR}/${ZIG_EXE} PERMISSIONS OWNER_EXECUTE)
setx(CMAKE_ZIG_COMPILER ${ZIG_BIN_CACHE_DIR}/${ZIG_EXE})

if(NOT WIN32)
  file(CREATE_LINK ${ZIG_BIN_CACHE_DIR}/${ZIG_EXE} ${ZIG_BIN_CACHE_DIR}/zig.exe SYMBOLIC)
endif()
