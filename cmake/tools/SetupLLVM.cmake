include(Macros)

if(WIN32 OR APPLE)
  set(DEFAULT_LLVM_VERSION "18.1.8")
else()
  set(DEFAULT_LLVM_VERSION "16.0.6")
endif()

optionx(LLVM_VERSION STRING "The version of LLVM to use" DEFAULT ${DEFAULT_LLVM_VERSION})
parse_semver(${LLVM_VERSION} LLVM)

if(APPLE)
  execute_process(
    COMMAND brew --prefix llvm@${LLVM_VERSION_MAJOR}
    OUTPUT_VARIABLE DEFAULT_LLVM_PREFIX
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
  )
  if(NOT DEFAULT_LLVM_PREFIX)
    set(DEFAULT_LLVM_PREFIX /opt/homebrew/opt/llvm)
  endif()
elseif(NOT WIN32)
  set(DEFAULT_LLVM_PREFIX /usr/lib/llvm-${LLVM_VERSION_MAJOR})
else()
  set(DEFAULT_LLVM_PREFIX /usr/lib)
endif()

optionx(LLVM_PREFIX FILEPATH "The path to the LLVM installation" DEFAULT ${DEFAULT_LLVM_PREFIX})
set(LLVM_PATH ${LLVM_PREFIX}/bin)

macro(find_llvm_command VARIABLE COMMAND)
  find_command(
    VARIABLE ${VARIABLE}
    COMMAND ${COMMAND}
    PATHS ${LLVM_PATH}
    VERSION ${LLVM_VERSION}
  )
endmacro()

macro(find_llvm_command_no_version VARIABLE COMMAND)
  find_command(
    VARIABLE ${VARIABLE}
    COMMAND ${COMMAND}
    PATHS ${LLVM_PATH}
    REQUIRED ON
  )
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
  find_llvm_command(CMAKE_STRIP llvm-strip)
  find_llvm_command(CMAKE_RANLIB llvm-ranlib)
  if(APPLE)
    find_llvm_command(CMAKE_DSYMUTIL dsymutil)
  endif()
endif()
