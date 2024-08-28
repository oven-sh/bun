# TODO: Commit to oven-sh/tinycc

cmake_minimum_required(VERSION 3.10)
project(tinycc VERSION 0.9.28 LANGUAGES C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

if(WIN32)
  set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS ON)
endif()

if(APPLE)
  set(CMAKE_MACOSX_RPATH ON)
endif()

if(NOT CMAKE_C_COMPILER_ID MATCHES "tcc")
  add_compile_options(
    -Wall
    -Wdeclaration-after-statement
    -fno-strict-aliasing
    -Wpointer-sign
    # -Wsign-compare
    -Wunused-result
  )
  
  if(CMAKE_C_COMPILER_ID MATCHES "GNU")
    add_compile_options(
      -Wformat-truncation
      -Wstringop-truncation
    )
  endif()
endif()

if(CMAKE_C_COMPILER_ID MATCHES "Clang")
  add_compile_options(
    -fheinous-gnu-extensions
    -Wstring-plus-int
    -Wdeprecated-declarations
  )
endif()

file(READ ${CMAKE_CURRENT_SOURCE_DIR}/VERSION TCC_VERSION)

add_compile_definitions(TCC_VERSION=\"${TCC_VERSION}\")

execute_process(
  COMMAND git rev-parse --short HEAD
  OUTPUT_VARIABLE TCC_GITHASH
  OUTPUT_STRIP_TRAILING_WHITESPACE
  ERROR_QUIET
)

if(TCC_GITHASH)
  add_compile_definitions(TCC_GITHASH=\"${TCC_GITHASH}\")
endif()

add_compile_definitions(
  ONE_SOURCE=0
  CONFIG_TCC_STATIC=1
  CONFIG_TCC_PREDEFS=1
  DWARF_VERSION=4
  TCC_LIBTCC1="\\0"
)

if(APPLE)
  add_compile_definitions(CONFIG_CODESIGN=1)
  if(CMAKE_OSX_SYSROOT)
    add_compile_definitions(CONFIG_USR_INCLUDE=\"${CMAKE_OSX_SYSROOT}\")
  endif()
endif()

if(WIN32)
  add_compile_definitions(
    TCC_TARGET_PE=1
    CONFIG_WIN32=1
    CONFIG_TCCDIR=\"${CMAKE_CURRENT_SOURCE_DIR}\"
  )
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64|ARM64")
  add_compile_definitions(TCC_TARGET_ARM64=1)
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|x64|amd64|AMD64")
  add_compile_definitions(TCC_TARGET_X86_64=1)
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_SYSTEM_PROCESSOR}")
endif()

set(TCC_SOURCES
  libtcc.c
  tccpp.c
  tccgen.c
  tccdbg.c
  tccelf.c
  tccasm.c
  tccrun.c
)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm64|aarch64|ARM64")
  list(APPEND TCC_SOURCES
    arm64-gen.c
    arm64-link.c
    arm64-asm.c
  )
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|x64|amd64|AMD64")
  list(APPEND TCC_SOURCES
    x86_64-gen.c
    x86_64-link.c
    x86_64-asm.c
  )
else()
  message(FATAL_ERROR "Unsupported architecture: ${CMAKE_SYSTEM_PROCESSOR}")
endif()

if(APPLE)
  list(APPEND TCC_SOURCES tccmacho.c)
endif()

if(WIN32)
  list(APPEND TCC_SOURCES tccpe.c)
endif()

add_library(tcc STATIC ${TCC_SOURCES})

target_include_directories(tcc PUBLIC 
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)
