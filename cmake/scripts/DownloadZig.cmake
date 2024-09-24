get_filename_component(SCRIPT_NAME ${CMAKE_CURRENT_LIST_FILE} NAME)
message(STATUS "Running script: ${SCRIPT_NAME}")

if(NOT ZIG_PATH)
  message(FATAL_ERROR "ZIG_PATH is required")
endif()

if(ZIG_REPOSITORY)
  if(NOT ZIG_COMMIT)
    message(FATAL_ERROR "ZIG_COMMIT is required when ZIG_REPOSITORY is set")
  endif()
elseif(NOT ZIG_COMMIT)
  set(ZIG_REPOSITORY "oven-sh/zig")
  set(ZIG_COMMIT "131a009ba2eb127a3447d05b9e12f710429aa5ee")
endif()

if(NOT ZIG_VERSION)
  set(ZIG_VERSION "0.13.0")
endif()

if(CMAKE_HOST_APPLE)
  set(ZIG_OS "macos")
elseif(CMAKE_HOST_WIN32)
  set(ZIG_OS "windows")
elseif(CMAKE_HOST_UNIX)
  set(ZIG_OS "linux")
else()
  message(FATAL_ERROR "Unsupported operating system: ${CMAKE_HOST_SYSTEM_NAME}")
endif()

# In script mode, using -P, this variable is not set
if(NOT DEFINED CMAKE_HOST_SYSTEM_PROCESSOR)
  cmake_host_system_information(RESULT CMAKE_HOST_SYSTEM_PROCESSOR QUERY OS_PLATFORM)
endif()

if(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "arm64|ARM64|aarch64|AARCH64")
  set(ZIG_ARCH "aarch64")
elseif(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "amd64|AMD64|x86_64|X86_64|x64|X64")
  set(ZIG_ARCH "x86_64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_HOST_SYSTEM_PROCESSOR}")
endif()

set(ZIG_NAME zig-${ZIG_OS}-${ZIG_ARCH}-${ZIG_VERSION})

if(CMAKE_HOST_WIN32)
  set(ZIG_EXE "zig.exe")
  set(ZIG_FILENAME ${ZIG_NAME}.zip)
else()
  set(ZIG_EXE "zig")
  set(ZIG_FILENAME ${ZIG_NAME}.tar.xz)
endif()

message(STATUS "Downloading ${ZIG_EXE} ${ZIG_VERSION} on ${ZIG_OS} ${ZIG_ARCH}...")
set(ZIG_DOWNLOAD_URL https://ziglang.org/download/${ZIG_VERSION}/${ZIG_FILENAME})

execute_process(
  COMMAND
    ${CMAKE_COMMAND}
      -DDOWNLOAD_URL=${ZIG_DOWNLOAD_URL}
      -DDOWNLOAD_PATH=${ZIG_PATH}
      -P ${CMAKE_CURRENT_LIST_DIR}/DownloadUrl.cmake
  ERROR_STRIP_TRAILING_WHITESPACE
  ERROR_VARIABLE
    ZIG_DOWNLOAD_ERROR
  RESULT_VARIABLE
    ZIG_DOWNLOAD_RESULT
)

if(NOT ZIG_DOWNLOAD_RESULT EQUAL 0)
  message(FATAL_ERROR "Download failed: ${ZIG_DOWNLOAD_ERROR}")
endif()

if(NOT EXISTS ${ZIG_PATH}/${ZIG_EXE})
  message(FATAL_ERROR "Download failed: executable not found: \"${ZIG_PATH}/${ZIG_EXE}\"")
endif()

# Tools like VSCode need a stable path to the zig executable, on both Unix and Windows
# To workaround this, we create a `bun.exe` symlink on Unix.
if(NOT WIN32)
  file(CREATE_LINK ${ZIG_PATH}/${ZIG_EXE} ${ZIG_PATH}/zig.exe SYMBOLIC)
endif()

if(ZIG_REPOSITORY AND ZIG_COMMIT)
  message(STATUS "Downloading zig library from ${ZIG_REPOSITORY} at ${ZIG_COMMIT}...")

  execute_process(
    COMMAND
      ${CMAKE_COMMAND}
        -DGIT_PATH=${ZIG_PATH}/tmp
        -DGIT_REPOSITORY=${ZIG_REPOSITORY}
        -DGIT_COMMIT=${ZIG_COMMIT}
        -P ${CMAKE_CURRENT_LIST_DIR}/GitClone.cmake
    ERROR_STRIP_TRAILING_WHITESPACE
    ERROR_VARIABLE
      ZIG_REPOSITORY_ERROR
    RESULT_VARIABLE
      ZIG_REPOSITORY_RESULT
  )

  if(NOT ZIG_REPOSITORY_RESULT EQUAL 0)
    message(FATAL_ERROR "Download failed: ${ZIG_REPOSITORY_ERROR}")
  endif()

  file(REMOVE_RECURSE ${ZIG_PATH}/lib)
  file(RENAME ${ZIG_PATH}/tmp/lib ${ZIG_PATH}/lib)
  file(REMOVE_RECURSE ${ZIG_PATH}/tmp)
  message(STATUS "Saved ${ZIG_PATH}/lib")
endif()

message(STATUS "Saved ${ZIG_EXE}")
