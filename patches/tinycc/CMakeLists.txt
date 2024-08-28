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

add_compile_definitions(
  ONE_SOURCE=1
  CONFIG_TCC_STATIC=1
  # CONFIG_TCC_PREDEFS=1
  TCC_LIBTCC1="\\0"
)

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

if(APPLE)
  add_compile_definitions(DWARF_VERSION=4)
endif()

add_library(tcc STATIC libtcc.c)
target_include_directories(tcc PUBLIC 
  ${CMAKE_CURRENT_SOURCE_DIR}
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)
