# TODO: Commit to oven-sh/tinycc

cmake_minimum_required(VERSION 3.10)
project(tinycc VERSION 0.9.28 LANGUAGES C)

if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Debug)
endif()

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

if(WIN32)
  set(CMAKE_WINDOWS_EXPORT_ALL_SYMBOLS ON)
endif()

add_compile_options(-Wall)

if(NOT CMAKE_C_COMPILER_ID MATCHES "tcc")
  add_compile_options(
    -fno-strict-aliasing
    -Wdeclaration-after-statement
    -Wpointer-sign
    -Wsign-compare
    -Wunused-result
    -Wformat-truncation
  )
endif()

if(CMAKE_C_COMPILER_ID MATCHES "GNU")
  add_compile_options(
    -Wno-string-plus-int
    -Wno-deprecated-declarations
  )
endif()

add_compile_definitions(
  CONFIG_TCC_PREDEFS
  ONE_SOURCE=0
  TCC_LIBTCC1="\\0"
)

if(APPLE)
  add_compile_definitions(
    TCC_TARGET_MACHO
    CONFIG_CODESIGN
    CONFIG_NEW_MACHO
    CONFIG_USR_INCLUDE=\"${CMAKE_OSX_SYSROOT}\"
  )
endif()

if(WIN32)
  add_compile_definitions(
    CONFIG_WIN32
    CONFIG_TCCDIR=\"${CMAKE_CURRENT_SOURCE_DIR}/win32\"
  )
endif()

option(BUILD_C2STR "Build the c2str utility" ON)
option(BUILD_TCC "Build the tcc compiler" ON)

if(BUILD_C2STR)
  if(CMAKE_CROSSCOMPILING)
    file(MAKE_DIRECTORY ${CMAKE_CURRENT_BINARY_DIR}/c2str)
    add_custom_target(c2str.exe
      COMMAND
        ${CMAKE_COMMAND}
          -S ${CMAKE_CURRENT_SOURCE_DIR}
          -B ${CMAKE_CURRENT_BINARY_DIR}/c2str
          -G${CMAKE_GENERATOR}
          -DCMAKE_BUILD_TYPE=${CMAKE_BUILD_TYPE}
          -DBUILD_TCC=OFF
      COMMAND
        ${CMAKE_COMMAND}
          --build ${CMAKE_CURRENT_BINARY_DIR}/c2str
          --target c2str.exe
      WORKING_DIRECTORY
        ${CMAKE_CURRENT_BINARY_DIR}/c2str
    )
  else()
    add_executable(c2str.exe conftest.c)
    target_compile_options(c2str.exe PRIVATE -DC2STR)

    add_custom_command(
      TARGET
        c2str.exe POST_BUILD
      COMMAND
        c2str.exe include/tccdefs.h tccdefs_.h
      WORKING_DIRECTORY
        ${CMAKE_CURRENT_SOURCE_DIR}
    )
  endif()
endif()

if(BUILD_TCC)
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
      i386-asm.c
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

  if(BUILD_C2STR)
    add_dependencies(tcc c2str.exe)
  endif()

  target_include_directories(tcc PUBLIC 
    ${CMAKE_CURRENT_SOURCE_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/include
  )
endif()
