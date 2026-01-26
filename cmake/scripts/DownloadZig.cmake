get_filename_component(SCRIPT_NAME ${CMAKE_CURRENT_LIST_FILE} NAME)
message(STATUS "Running script: ${SCRIPT_NAME}")

if(NOT ZIG_PATH OR NOT ZIG_COMMIT)
  message(FATAL_ERROR "ZIG_PATH and ZIG_COMMIT required")
endif()

if(CMAKE_HOST_APPLE)
  set(ZIG_OS_ABI "macos-none")
elseif(CMAKE_HOST_WIN32)
  set(ZIG_OS_ABI "windows-gnu")
elseif(CMAKE_HOST_UNIX)
  set(ZIG_OS_ABI "linux-musl")
else()
  message(FATAL_ERROR "Unsupported operating system: ${CMAKE_HOST_SYSTEM_NAME}")
endif()

# In script mode, using -P, this variable is not set
if(NOT DEFINED CMAKE_HOST_SYSTEM_PROCESSOR)
  cmake_host_system_information(RESULT CMAKE_HOST_SYSTEM_PROCESSOR QUERY OS_PLATFORM)
endif()

if(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "arm64|ARM64|aarch64|AARCH64")
  # Windows ARM64 can run x86_64 via emulation, and no native ARM64 Zig build exists yet
  if(CMAKE_HOST_WIN32)
    set(ZIG_ARCH "x86_64")
  else()
    set(ZIG_ARCH "aarch64")
  endif()
elseif(CMAKE_HOST_SYSTEM_PROCESSOR MATCHES "amd64|AMD64|x86_64|X86_64|x64|X64")
  set(ZIG_ARCH "x86_64")
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_HOST_SYSTEM_PROCESSOR}")
endif()

set(ZIG_NAME bootstrap-${ZIG_ARCH}-${ZIG_OS_ABI})
if(ZIG_COMPILER_SAFE)
  set(ZIG_NAME ${ZIG_NAME}-ReleaseSafe)
endif()
set(ZIG_FILENAME ${ZIG_NAME}.zip)

if(CMAKE_HOST_WIN32)
  set(ZIG_EXE "zig.exe")
else()
  set(ZIG_EXE "zig")
endif()

set(ZIG_DOWNLOAD_URL https://github.com/oven-sh/zig/releases/download/autobuild-${ZIG_COMMIT}/${ZIG_FILENAME})

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
  message(FATAL_ERROR "Executable not found: \"${ZIG_PATH}/${ZIG_EXE}\"")
endif()

# Tools like VSCode need a stable path to the zig executable, on both Unix and Windows
# To workaround this, we create a `zig.exe` & `zls.exe` symlink on Unix.
if(NOT WIN32)
  file(CREATE_LINK ${ZIG_PATH}/${ZIG_EXE} ${ZIG_PATH}/zig.exe SYMBOLIC)
  file(CREATE_LINK ${ZIG_PATH}/zls ${ZIG_PATH}/zls.exe SYMBOLIC)
endif()
