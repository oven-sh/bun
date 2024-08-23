# Append the given dependencies to the source file
macro(WEBKIT_ADD_SOURCE_DEPENDENCIES _source _deps)
  set(_tmp)
  get_source_file_property(_tmp ${_source} OBJECT_DEPENDS)

  if(NOT _tmp)
    set(_tmp "")
  endif()

  foreach(f ${_deps})
    list(APPEND _tmp "${f}")
  endforeach()

  set_source_files_properties(${_source} PROPERTIES OBJECT_DEPENDS "${_tmp}")
  unset(_tmp)
endmacro()

# --- package.json ---

add_custom_command(
  COMMENT
    "Installing dependencies"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE}
      install
      --frozen-lockfile
  OUTPUT
    ${CWD}/bun.lockb
  MAIN_DEPENDENCY
    ${CWD}/package.json
)

# --- src/ls_lexer ---

set(BUN_ZIG_IDENTIFIER_SOURCE ${CWD}/src/js_lexer)
set(BUN_ZIG_IDENTIFIER_SCRIPT ${BUN_ZIG_IDENTIFIER_SOURCE}/identifier_data.zig)

file(GLOB BUN_ZIG_IDENTIFIER_SOURCES
  ${CONFIGURE_DEPENDS}
  ${BUN_ZIG_IDENTIFIER_SOURCE}/*.zig
)

set(BUN_ZIG_IDENTIFIER_OUTPUTS
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_continue_bitset.blob
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_continue_bitset.meta.blob
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_start_bitset.blob
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_start_bitset.meta.blob
)

add_custom_command(
  COMMENT
    "Generating src/js_lexer/*.blob"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${CMAKE_ZIG_COMPILER}
    run
    ${CMAKE_ZIG_FLAGS}
    ${BUN_ZIG_IDENTIFIER_SCRIPT}
  OUTPUT
    ${BUN_ZIG_IDENTIFIER_OUTPUTS}
  MAIN_DEPENDENCY
    ${BUN_ZIG_IDENTIFIER_SCRIPT}
  DEPENDS
    ${BUN_ZIG_IDENTIFIER_SOURCES}
)

# --- packages/bun-error ---

set(BUN_ERROR_SOURCE ${CWD}/packages/bun-error)

add_custom_command(
  COMMENT
    "Installing bun-error"
  WORKING_DIRECTORY
    ${BUN_ERROR_SOURCE}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE}
      install
      --frozen-lockfile
  OUTPUT
    ${BUN_ERROR_SOURCE}/bun.lockb
  MAIN_DEPENDENCY
    ${BUN_ERROR_SOURCE}/package.json
)

file(GLOB BUN_ERROR_SOURCES
  ${CONFIGURE_DEPENDS}
  ${BUN_ERROR_SOURCE}/*.json
  ${BUN_ERROR_SOURCE}/*.ts
  ${BUN_ERROR_SOURCE}/*.tsx
  ${BUN_ERROR_SOURCE}/*.css
  ${BUN_ERROR_SOURCE}/img/*
)

set(BUN_ERROR_OUTPUTS
  ${BUN_ERROR_SOURCE}/dist/index.js
  ${BUN_ERROR_SOURCE}/dist/bun-error.css
)

add_custom_command(
  COMMENT
    "Building bun-error"
  WORKING_DIRECTORY
    ${BUN_ERROR_SOURCE}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE} x
    esbuild
      index.tsx
      bun-error.css
      --outdir=dist
      --define:process.env.NODE_ENV=\"'production'\"
      --minify
      --bundle
      --platform=browser
      --format=esm
  OUTPUT
    ${BUN_ERROR_OUTPUTS}
  MAIN_DEPENDENCY
    ${BUN_ERROR_SOURCE}/bun.lockb
  DEPENDS
    ${BUN_ERROR_SOURCES}
)

# --- src/fallback.out.js ---

set(BUN_FALLBACK_DECODER_SOURCE ${CWD}/src/fallback.ts)
set(BUN_FALLBACK_DECODER_OUTPUT ${CWD}/src/fallback.out.js)

add_custom_command(
  COMMENT
    "Building src/fallback.out.js"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE} x
      esbuild
        ${BUN_FALLBACK_DECODER_SOURCE}
        --outfile=${BUN_FALLBACK_DECODER_OUTPUT}
        --target=esnext
        --bundle
        --format=iife
        --platform=browser
        --minify
  OUTPUT
    ${BUN_FALLBACK_DECODER_OUTPUT}
  MAIN_DEPENDENCY
    ${BUN_FALLBACK_DECODER_SOURCE}
  DEPENDS
    ${CWD}/bun.lockb
)

# --- src/runtime.out.js ---

set(BUN_RUNTIME_JS_SOURCE ${CWD}/src/runtime.bun.js)
set(BUN_RUNTIME_JS_OUTPUT ${CWD}/src/runtime.out.js)

add_custom_command(
  COMMENT
    "Building src/runtime.out.js"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE} x
      esbuild
        ${BUN_RUNTIME_JS_SOURCE}
        --outfile=${BUN_RUNTIME_JS_OUTPUT}
        --define:process.env.NODE_ENV=\"'production'\"
        --target=esnext
        --bundle
        --format=esm
        --platform=node
        --minify
        --external:/bun:*
  OUTPUT
    ${BUN_RUNTIME_JS_OUTPUT}
  MAIN_DEPENDENCY
    ${BUN_RUNTIME_JS_SOURCE}
  DEPENDS
    ${CWD}/bun.lockb
)

# --- src/node-fallbacks ---

set(BUN_NODE_FALLBACKS_SOURCE ${CWD}/src/node-fallbacks)

add_custom_command(
  COMMENT
    "Installing src/node-fallbacks"
  WORKING_DIRECTORY
    ${BUN_NODE_FALLBACKS_SOURCE}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE}
      install
      --frozen-lockfile
  OUTPUT
    ${BUN_NODE_FALLBACKS_SOURCE}/bun.lockb
  MAIN_DEPENDENCY
    ${BUN_NODE_FALLBACKS_SOURCE}/package.json
)

file(GLOB BUN_NODE_FALLBACKS_SOURCES
  ${CONFIGURE_DEPENDS}
  ${BUN_NODE_FALLBACKS_SOURCE}/*.js
)

set(BUN_NODE_FALLBACKS_OUTPUTS ${BUN_NODE_FALLBACKS_SOURCES})

add_custom_command(
  COMMENT
    "Building src/node-fallbacks"
  WORKING_DIRECTORY
    ${BUN_NODE_FALLBACKS_SOURCE}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE} x
      esbuild
        ${BUN_NODE_FALLBACKS_SOURCES}
        --outdir=out
        --format=esm
        --minify
        --bundle
        --platform=browser
  OUTPUT
    ${BUN_NODE_FALLBACKS_OUTPUTS}
  MAIN_DEPENDENCY
    ${BUN_NODE_FALLBACKS_SOURCE}/bun.lockb
  DEPENDS
    ${BUN_NODE_FALLBACKS_SOURCE}/package.json
)

# TODO: change custom commands defined above this, to use the codegen path instead of in-source 
parse_option(CODEGEN_PATH FILEPATH "Path to the codegen directory" ${BUN_WORKDIR}/codegen)

# --- ErrorCode.{zig,h} --

set(BUN_ERROR_CODE_SCRIPT ${CWD}/src/codegen/generate-node-errors.ts)

set(BUN_ERROR_CODE_SOURCES
  ${CWD}/src/bun.js/bindings/ErrorCode.ts
  ${CWD}/src/bun.js/bindings/ErrorCode.cpp
  ${CWD}/src/bun.js/bindings/ErrorCode.h
)

set(BUN_ERROR_CODE_OUTPUTS
  ${CODEGEN_PATH}/ErrorCode+List.h
  ${CODEGEN_PATH}/ErrorCode+Data.h
  ${CODEGEN_PATH}/ErrorCode.zig
)

add_custom_command(
  COMMENT
    "Generating ErrorCode.{zig,h}"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE}
      run
      ${BUN_ERROR_CODE_SCRIPT}
      ${CODEGEN_PATH}
  OUTPUT
    ${BUN_ERROR_CODE_OUTPUTS}
  MAIN_DEPENDENCY
    ${BUN_ERROR_CODE_SCRIPT}
  DEPENDS
    ${BUN_ERROR_CODE_SOURCES}
)

# This needs something to force it to be regenerated
WEBKIT_ADD_SOURCE_DEPENDENCIES(
  ${CWD}/src/bun.js/bindings/ErrorCode.cpp
  ${CODEGEN_PATH}/ErrorCode+List.h
)

WEBKIT_ADD_SOURCE_DEPENDENCIES(
  ${CWD}/src/bun.js/bindings/ErrorCode.h
  ${CODEGEN_PATH}/ErrorCode+Data.h
)

# --- ZigGeneratedClasses.{zig,cpp,h} --

set(BUN_ZIG_GENERATED_CLASSES_SCRIPT ${CWD}/src/codegen/generate-classes.ts)

file(GLOB BUN_ZIG_GENERATED_CLASSES_SOURCES
  ${CONFIGURE_DEPENDS}
  ${CWD}/src/bun.js/*.classes.ts
  ${CWD}/src/bun.js/api/*.classes.ts
  ${CWD}/src/bun.js/node/*.classes.ts
  ${CWD}/src/bun.js/test/*.classes.ts
  ${CWD}/src/bun.js/webcore/*.classes.ts
)

set(BUN_ZIG_GENERATED_CLASSES_OUTPUTS
  ${CODEGEN_PATH}/ZigGeneratedClasses.h
  ${CODEGEN_PATH}/ZigGeneratedClasses.cpp
  ${CODEGEN_PATH}/ZigGeneratedClasses+lazyStructureHeader.h
  ${CODEGEN_PATH}/ZigGeneratedClasses+DOMClientIsoSubspaces.h
  ${CODEGEN_PATH}/ZigGeneratedClasses+DOMIsoSubspaces.h
  ${CODEGEN_PATH}/ZigGeneratedClasses+lazyStructureImpl.h
  ${CODEGEN_PATH}/ZigGeneratedClasses.zig
)

add_custom_command(
  COMMENT
    "Generating ZigGeneratedClasses.{zig,cpp,h}"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE}
      run
      ${BUN_ZIG_GENERATED_CLASSES_SCRIPT}
      ${BUN_ZIG_GENERATED_CLASSES_SOURCES}
      ${CODEGEN_PATH}
  OUTPUT
    ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
  MAIN_DEPENDENCY
    ${BUN_ZIG_GENERATED_CLASSES_SCRIPT}
  DEPENDS
    ${BUN_ZIG_GENERATED_CLASSES_SOURCES}
)

# --- src/js/*.{js,ts} ---

set(BUN_JAVASCRIPT_SCRIPT ${CWD}/src/codegen/bundle-modules.ts)

file(GLOB_RECURSE BUN_JAVASCRIPT_SOURCES
  ${CONFIGURE_DEPENDS}
  ${CWD}/src/js/*.js
  ${CWD}/src/js/*.ts
)

file(GLOB BUN_JAVASCRIPT_CODEGEN_SOURCES
  ${CONFIGURE_DEPENDS}
  ${CWD}/src/codegen/*.ts
)

list(APPEND BUN_JAVASCRIPT_CODEGEN_SOURCES
  ${CWD}/src/bun.js/bindings/InternalModuleRegistry.cpp
)

set(BUN_JAVASCRIPT_OUTPUTS
  ${CODEGEN_PATH}/WebCoreJSBuiltins.cpp
  ${CODEGEN_PATH}/WebCoreJSBuiltins.h
  ${CODEGEN_PATH}/InternalModuleRegistryConstants.h
  ${CODEGEN_PATH}/InternalModuleRegistry+createInternalModuleById.h
  ${CODEGEN_PATH}/InternalModuleRegistry+enum.h
  ${CODEGEN_PATH}/InternalModuleRegistry+numberOfModules.h
  ${CODEGEN_PATH}/NativeModuleImpl.h
  ${CODEGEN_PATH}/ResolvedSourceTag.zig
  ${CODEGEN_PATH}/SyntheticModuleType.h
  ${CODEGEN_PATH}/GeneratedJS2Native.h
  # Zig will complain if files are outside of the source directory
  ${CWD}/src/bun.js/bindings/GeneratedJS2Native.zig
)

add_custom_command(
  COMMENT
    "Generating JavaScript modules"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE}
      run
      ${BUN_JAVASCRIPT_SCRIPT}
      --debug=${ENABLE_ASSERTIONS}
      ${BUILD_PATH}
  OUTPUT
    ${BUN_JAVASCRIPT_OUTPUTS}
  MAIN_DEPENDENCY
    ${BUN_JAVASCRIPT_SCRIPT}
  DEPENDS
    ${BUN_JAVASCRIPT_SOURCES}
    ${BUN_JAVASCRIPT_CODEGEN_SOURCES}
)

WEBKIT_ADD_SOURCE_DEPENDENCIES(
  ${CWD}/src/bun.js/bindings/InternalModuleRegistry.cpp
  ${CODEGEN_PATH}/InternalModuleRegistryConstants.h
)

# --- JSSink.{cpp,h} ---

set(BUN_JS_SINK_SCRIPT ${CWD}/src/codegen/generate-jssink.ts)

set(BUN_JS_SINK_OUTPUTS
  ${CODEGEN_PATH}/JSSink.cpp
  ${CODEGEN_PATH}/JSSink.h
)

add_custom_command(
  COMMENT
    "Generating JSSink.{cpp,h}"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE}
      run
      ${BUN_JS_SINK_SCRIPT}
      ${CODEGEN_PATH}
  OUTPUT
    ${BUN_JS_SINK_OUTPUTS}
  MAIN_DEPENDENCY
    ${BUN_JS_SINK_SCRIPT}
)

# --- *.lut.h ---

set(BUN_OBJECT_LUT_SCRIPT ${CWD}/src/codegen/create-hash-table.ts)

set(BUN_OBJECT_LUT_SOURCES
  ${CWD}/src/bun.js/bindings/BunObject.cpp
  ${CWD}/src/bun.js/bindings/ZigGlobalObject.lut.txt
  ${CWD}/src/bun.js/bindings/JSBuffer.cpp
  ${CWD}/src/bun.js/bindings/BunProcess.cpp
  ${CWD}/src/bun.js/bindings/ProcessBindingConstants.cpp
  ${CWD}/src/bun.js/bindings/ProcessBindingNatives.cpp
)

set(BUN_OBJECT_LUT_OUTPUTS
  ${CODEGEN_PATH}/BunObject.lut.h
  ${CODEGEN_PATH}/ZigGlobalObject.lut.h
  ${CODEGEN_PATH}/JSBuffer.lut.h
  ${CODEGEN_PATH}/BunProcess.lut.h
  ${CODEGEN_PATH}/ProcessBindingConstants.lut.h
  ${CODEGEN_PATH}/ProcessBindingNatives.lut.h
)

list(LENGTH BUN_OBJECT_LUT_SOURCES BUN_OBJECT_LUT_SOURCES_COUNT)

foreach(i RANGE ${BUN_OBJECT_LUT_SOURCES_COUNT})
  math(EXPR i "${i} - 1")
  list(GET BUN_OBJECT_LUT_SOURCES ${i} BUN_OBJECT_LUT_SOURCE)
  list(GET BUN_OBJECT_LUT_OUTPUTS ${i} BUN_OBJECT_LUT_OUTPUT)

  get_filename_component(filename ${BUN_OBJECT_LUT_SOURCE} NAME_WE)
  add_custom_command(
    COMMENT
      "Generating ${filename}.lut.h"
    WORKING_DIRECTORY
      ${CWD}
    VERBATIM COMMAND
      ${BUN_EXECUTABLE}
        run
        ${BUN_OBJECT_LUT_SCRIPT}
        ${BUN_OBJECT_LUT_SOURCE}
        ${BUN_OBJECT_LUT_OUTPUT}
    OUTPUT
      ${BUN_OBJECT_LUT_OUTPUT}
    MAIN_DEPENDENCY
      ${BUN_OBJECT_LUT_SCRIPT}
    DEPENDS
      ${BUN_OBJECT_LUT_SOURCE}
  )

  WEBKIT_ADD_SOURCE_DEPENDENCIES(${BUN_OBJECT_LUT_SOURCE} ${BUN_OBJECT_LUT_OUTPUT})
endforeach()

WEBKIT_ADD_SOURCE_DEPENDENCIES(
  ${CWD}/src/bun.js/bindings/ZigGlobalObject.cpp
  ${CODEGEN_PATH}/ZigGlobalObject.lut.h
)

# --- target: codegen ---

add_custom_target(
  codegen
  COMMENT
    "Running codegen"
  DEPENDS
    ${BUN_OBJECT_LUT_OUTPUTS}
    ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
    ${BUN_JS_SINK_OUTPUTS}
    ${BUN_JAVASCRIPT_OUTPUTS}
    ${BUN_ERROR_CODE_OUTPUTS}
    ${BUN_ZIG_OBJECT_OUTPUTS}
)
