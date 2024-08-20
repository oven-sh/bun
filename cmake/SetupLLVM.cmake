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
  if(NOT DEFINED DEFAULT_LLVM_PREFIX)
    set(DEFAULT_LLVM_PREFIX /opt/homebrew/opt/llvm)
  endif()
elseif(NOT WIN32)
  set(DEFAULT_LLVM_PREFIX /usr/lib/llvm-${LLVM_VERSION_MAJOR}/bin)
else()
  set(DEFAULT_LLVM_PREFIX /usr)
endif()

parse_option(LLVM_PREFIX STRING "The path to the LLVM installation" ${DEFAULT_LLVM_PREFIX})
set(LLVM_PATH ${LLVM_PREFIX}/bin)

if(WIN32)
  set(CMAKE_C_COMPILER "clang-cl")
  set(CMAKE_CXX_COMPILER "clang-cl")
  set(CMAKE_LINKER "lld-link")
  set(CMAKE_AR "llvm-lib")
  set(CMAKE_STRIP "llvm-strip")
else()
  set(CMAKE_C_COMPILER "clang")
  set(CMAKE_CXX_COMPILER "clang++")
  set(CMAKE_LINKER "llvm-link")
  set(CMAKE_AR "llvm-ar")
  set(CMAKE_STRIP "llvm-strip")
  set(CMAKE_RANLIB "llvm-ranlib")
  if(APPLE)
    set(CMAKE_DSYMUTIL "dsymutil")
  endif()
endif()

find_program(
  CMAKE_C_COMPILER
  NAMES ${CMAKE_C_COMPILER} ${CMAKE_C_COMPILER}-${LLVM_VERSION}
  PATHS ENV PATH ${LLVM_PATH}
  VALIDATOR check_version
  REQUIRED
)

find_program(
  CMAKE_CXX_COMPILER
  NAMES ${CMAKE_CXX_COMPILER} ${CMAKE_CXX_COMPILER}-${LLVM_VERSION}
  PATHS ENV PATH ${LLVM_PATH}
  VALIDATOR check_version
  REQUIRED
)

find_program(
  CMAKE_LINKER
  NAMES ${CMAKE_LINKER} ${CMAKE_LINKER}-${LLVM_VERSION}
  PATHS ENV PATH ${LLVM_PATH}
  VALIDATOR check_version
  REQUIRED
)

find_program(
  CMAKE_AR
  NAMES ${CMAKE_AR} ${CMAKE_AR}-${LLVM_VERSION}
  PATHS ENV PATH ${LLVM_PATH}
  VALIDATOR check_version
  REQUIRED
)

find_program(
  CMAKE_STRIP
  NAMES ${CMAKE_STRIP} ${CMAKE_STRIP}-${LLVM_VERSION}
  PATHS ENV PATH ${LLVM_PATH}
  VALIDATOR check_version
  REQUIRED
)

if(NOT WIN32)
  find_program(
    CMAKE_RANLIB
    NAMES ${CMAKE_RANLIB} ${CMAKE_RANLIB}-${LLVM_VERSION}
    PATHS ENV PATH ${LLVM_PATH}
    VALIDATOR check_version
    REQUIRED
  )
endif()

if(APPLE)
  find_program(
    CMAKE_DSYMUTIL
    NAMES ${CMAKE_DSYMUTIL} ${CMAKE_DSYMUTIL}-${LLVM_VERSION}
    PATHS ENV PATH ${LLVM_PATH}
    VALIDATOR check_version
    REQUIRED
  )
endif()

enable_language(C)
enable_language(CXX)

message(STATUS "Using LLVM ${LLVM_VERSION}")
message(STATUS "Using C Compiler: ${CMAKE_C_COMPILER}")
message(STATUS "Using C++ Compiler: ${CMAKE_CXX_COMPILER}")
message(STATUS "Using Archiver: ${CMAKE_AR}")
message(STATUS "Using Linker: ${CMAKE_LINKER}")
message(STATUS "Using Ranlib: ${CMAKE_RANLIB}")
