include(cmake/Utils.cmake)

if(WIN32 OR APPLE)
  set(DEFAULT_LLVM_VERSION "18.1.8")
else()
  set(DEFAULT_LLVM_VERSION "16.0.6")
endif()

parse_option(LLVM_VERSION STRING "The version of LLVM to use" ${DEFAULT_LLVM_VERSION})
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
  set(DEFAULT_LLVM_PREFIX /usr/lib/llvm-${LLVM_VERSION_MAJOR}/bin)
else()
  set(DEFAULT_LLVM_PREFIX /usr)
endif()

parse_option(LLVM_PREFIX STRING "The path to the LLVM installation" ${DEFAULT_LLVM_PREFIX})
set(LLVM_PATH ${LLVM_PREFIX}/bin)

function(check_llvm_version found executable)
  set(${found} FALSE PARENT_SCOPE)

  execute_process(
    COMMAND ${executable} --version
    RESULT_VARIABLE result
    OUTPUT_VARIABLE output
    OUTPUT_STRIP_TRAILING_WHITESPACE
  )

  if(NOT result EQUAL 0)
    message(DEBUG "Checking ${executable} (expected \"${LLVM_VERSION}\", exited with \"${result}\")")
    return()
  endif()

  parse_semver("${output}" executable)
  if(NOT executable_VERSION STREQUAL LLVM_VERSION)
    message(DEBUG "Checking ${executable} (expected \"${LLVM_VERSION}\", received \"${executable_VERSION}\")")
    return()
  endif()

  set(${found} TRUE PARENT_SCOPE)
endfunction()

macro(find_llvm_program variable program_name)
  set(${variable}_NAMES
    ${program_name}
    ${program_name}-${LLVM_VERSION_MAJOR}
    ${program_name}-${LLVM_VERSION}
  )

  find_program(
    ${variable}
    NAMES ${${variable}_NAMES}
    PATHS ENV PATH ${LLVM_PATH}
    VALIDATOR check_llvm_version
  )

  if(NOT ${variable})
    if(CMAKE_HOST_APPLE)
      set(LLVM_INSTALL_COMMAND "brew install llvm@${LLVM_VERSION_MAJOR} --force")
    elseif(CMAKE_HOST_WIN32)
      set(LLVM_INSTALL_COMMAND "choco install llvm@${LLVM_VERSION}")
    else()
      set(LLVM_INSTALL_COMMAND "curl -fsSL https://apt.llvm.org/llvm.sh | bash -s ${LLVM_VERSION}")
    endif()
    message(FATAL_ERROR "Command not found: ${program_name}\n"
      "Do you have LLVM ${LLVM_VERSION} installed? To fix this, try running:\n"
      "   ${LLVM_INSTALL_COMMAND}\n")
  endif()

  message(STATUS "Set ${variable}: ${${variable}}")
endmacro()

if(WIN32)
  find_llvm_program(CMAKE_C_COMPILER "clang-cl")
  find_llvm_program(CMAKE_CXX_COMPILER "clang-cl")
  find_llvm_program(CMAKE_LINKER "lld-link")
  find_llvm_program(CMAKE_AR "llvm-lib")
  find_llvm_program(CMAKE_STRIP "llvm-strip")
else()
  find_llvm_program(CMAKE_C_COMPILER "clang")
  find_llvm_program(CMAKE_CXX_COMPILER "clang++")
  find_llvm_program(CMAKE_LINKER "llvm-link")
  find_llvm_program(CMAKE_AR "llvm-ar")
  find_llvm_program(CMAKE_STRIP "llvm-strip")
  find_llvm_program(CMAKE_RANLIB "llvm-ranlib")
  if(APPLE)
    find_llvm_program(CMAKE_DSYMUTIL "dsymutil")
  endif()
endif()

enable_language(C)
enable_language(CXX)
