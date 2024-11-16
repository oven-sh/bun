optionx(ENABLE_LLVM BOOL "If LLVM should be used for compilation" DEFAULT ON)

if(NOT ENABLE_LLVM)
  return()
endif()

if(CMAKE_HOST_WIN32 OR CMAKE_HOST_APPLE OR ABI STREQUAL "musl")
  set(DEFAULT_LLVM_VERSION "18.1.8")
else()
  set(DEFAULT_LLVM_VERSION "16.0.6")
endif()

optionx(LLVM_VERSION STRING "The version of LLVM to use" DEFAULT ${DEFAULT_LLVM_VERSION})

string(REGEX MATCH "([0-9]+)\\.([0-9]+)\\.([0-9]+)" USE_LLVM_VERSION ${LLVM_VERSION})
if(USE_LLVM_VERSION)
  set(LLVM_VERSION_MAJOR ${CMAKE_MATCH_1})
  set(LLVM_VERSION_MINOR ${CMAKE_MATCH_2})
  set(LLVM_VERSION_PATCH ${CMAKE_MATCH_3})
endif()

set(LLVM_PATHS)

if(APPLE)
  execute_process(
    COMMAND brew --prefix
    OUTPUT_VARIABLE HOMEBREW_PREFIX
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
  )

  if(NOT HOMEBREW_PREFIX)
    if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|ARM64|aarch64|AARCH64")
      set(HOMEBREW_PREFIX /opt/homebrew)
    else()
      set(HOMEBREW_PREFIX /usr/local)
    endif()
  endif()

  list(APPEND LLVM_PATHS ${HOMEBREW_PREFIX}/opt/llvm/bin)

  if(USE_LLVM_VERSION)
    list(APPEND LLVM_PATHS ${HOMEBREW_PREFIX}/opt/llvm@${LLVM_VERSION_MAJOR}/bin)
  endif()
endif()

if(UNIX)
  list(APPEND LLVM_PATHS /usr/lib/llvm/bin)

  if(USE_LLVM_VERSION)
    list(APPEND LLVM_PATHS
      /usr/lib/llvm-${LLVM_VERSION_MAJOR}.${LLVM_VERSION_MINOR}.${LLVM_VERSION_PATCH}/bin
      /usr/lib/llvm-${LLVM_VERSION_MAJOR}.${LLVM_VERSION_MINOR}/bin
      /usr/lib/llvm-${LLVM_VERSION_MAJOR}/bin
      /usr/lib/llvm${LLVM_VERSION_MAJOR}/bin
    )
  endif()
endif()

macro(find_llvm_command variable command)
  set(commands ${command})

  if(USE_LLVM_VERSION)
    list(APPEND commands
      ${command}-${LLVM_VERSION_MAJOR}.${LLVM_VERSION_MINOR}.${LLVM_VERSION_PATCH}
      ${command}-${LLVM_VERSION_MAJOR}.${LLVM_VERSION_MINOR}
      ${command}-${LLVM_VERSION_MAJOR}
    )
  endif()

  find_command(
    VARIABLE ${variable}
    VERSION_VARIABLE LLVM_VERSION
    COMMAND ${commands}
    PATHS ${LLVM_PATHS}
    VERSION ${LLVM_VERSION}
  )
  list(APPEND CMAKE_ARGS -D${variable}=${${variable}})
endmacro()

macro(find_llvm_command_no_version variable command)
  set(commands ${command})

  if(USE_LLVM_VERSION)
    list(APPEND commands
      ${command}-${LLVM_VERSION_MAJOR}.${LLVM_VERSION_MINOR}.${LLVM_VERSION_PATCH}
      ${command}-${LLVM_VERSION_MAJOR}.${LLVM_VERSION_MINOR}
      ${command}-${LLVM_VERSION_MAJOR}
    )
  endif()

  find_command(
    VARIABLE ${variable}
    VERSION_VARIABLE LLVM_VERSION
    COMMAND ${commands}
    PATHS ${LLVM_PATHS}
  )
  list(APPEND CMAKE_ARGS -D${variable}=${${variable}})
endmacro()

if(WIN32)
  find_llvm_command(CMAKE_C_COMPILER clang-cl)
  find_llvm_command(CMAKE_CXX_COMPILER clang-cl)
  find_llvm_command_no_version(CMAKE_LINKER lld-link)
  find_llvm_command_no_version(CMAKE_AR llvm-lib)
  find_llvm_command_no_version(CMAKE_STRIP llvm-strip)
else()
  find_llvm_command(CMAKE_C_COMPILER clang)
  find_llvm_command(CMAKE_CXX_COMPILER clang++)
  find_llvm_command(CMAKE_LINKER llvm-link)
  find_llvm_command(CMAKE_AR llvm-ar)
  if (LINUX)
    # On Linux, strip ends up being more useful for us.
    find_command(
      VARIABLE
        CMAKE_STRIP
      COMMAND
        strip
      REQUIRED
        ON
    )
  else()
    find_llvm_command(CMAKE_STRIP llvm-strip)
  endif()
  find_llvm_command(CMAKE_RANLIB llvm-ranlib)
  if(LINUX)
    find_llvm_command(LLD_PROGRAM ld.lld)
  endif()
  if(APPLE)
    find_llvm_command(CMAKE_DSYMUTIL dsymutil)
  endif()
endif()

if(ENABLE_ANALYSIS)
  find_llvm_command(CLANG_FORMAT_PROGRAM clang-format)
  find_llvm_command(CLANG_TIDY_PROGRAM clang-tidy)
endif()
