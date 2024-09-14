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
  set(DEFAULT_ZIG_TARGET ${DEFAULT_ZIG_ARCH}-linux-gnu)
else()
  unsupported(CMAKE_SYSTEM_NAME)
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

optionx(ZIG_VERSION STRING "The version of zig to use" DEFAULT "0.13.0")
optionx(ZIG_LOCAL_CACHE_DIR FILEPATH "The path to local the zig cache directory" DEFAULT ${CACHE_PATH}/zig/local)
optionx(ZIG_GLOBAL_CACHE_DIR FILEPATH "The path to the global zig cache directory" DEFAULT ${CACHE_PATH}/zig/global)

setx(ZIG_REPOSITORY_PATH ${VENDOR_PATH}/zig)
setx(ZIG_PATH ${CACHE_PATH}/zig/bin)

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

setenv(ZIG_LOCAL_CACHE_DIR ${ZIG_LOCAL_CACHE_DIR})
setenv(ZIG_GLOBAL_CACHE_DIR ${ZIG_GLOBAL_CACHE_DIR})

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
    ${ZIG_PATH}
  VERSION
    ${ZIG_VERSION}
  REQUIRED
    OFF
)

if(CMAKE_ZIG_COMPILER)
  return()
endif()

if(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "arm64|aarch64")
  set(ZIG_HOST_ARCH "aarch64")
elseif(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "amd64|x86_64|x64|AMD64")
  set(ZIG_HOST_ARCH "x86_64")
else()
  unsupported(CMAKE_HOST_SYSTEM_PROCESSOR)
endif()

if(CMAKE_HOST_APPLE)
  set(ZIG_HOST_OS "macos")
elseif(CMAKE_HOST_WIN32)
  set(ZIG_HOST_OS "windows")
elseif(CMAKE_HOST_UNIX)
  set(ZIG_HOST_OS "linux")
else()
  unsupported(CMAKE_HOST_SYSTEM_NAME)
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
file(DOWNLOAD ${ZIG_DOWNLOAD_URL} ${TMP_PATH}/${ZIG_FILENAME} SHOW_PROGRESS)
file(ARCHIVE_EXTRACT INPUT ${TMP_PATH}/${ZIG_FILENAME} DESTINATION ${TMP_PATH} TOUCH)
file(REMOVE ${TMP_PATH}/${ZIG_FILENAME})
file(COPY ${TMP_PATH}/${ZIG_NAME}/${ZIG_EXE} DESTINATION ${ZIG_PATH})
file(CHMOD ${ZIG_PATH}/${ZIG_EXE} PERMISSIONS OWNER_EXECUTE OWNER_READ OWNER_WRITE)
setx(CMAKE_ZIG_COMPILER ${ZIG_PATH}/${ZIG_EXE})

if(NOT WIN32)
  file(CREATE_LINK ${ZIG_PATH}/${ZIG_EXE} ${ZIG_PATH}/zig.exe SYMBOLIC)
endif()

# Some zig commands need the executable to be in the same directory as the zig repository
register_command(
  COMMENT
    "Creating symlink for zig"
  COMMAND
    ${CMAKE_COMMAND} -E copy ${ZIG_PATH}/${ZIG_EXE} ${ZIG_REPOSITORY_PATH}/${ZIG_EXE}
    && ${CMAKE_COMMAND} -E create_symlink ${ZIG_REPOSITORY_PATH}/${ZIG_EXE} ${ZIG_REPOSITORY_PATH}/zig.exe
  OUTPUTS
    ${ZIG_REPOSITORY_PATH}/${ZIG_EXE}
    ${ZIG_REPOSITORY_PATH}/zig.exe
  TARGETS
    clone-zig
)
