include(Utils)

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

add_bun_install(NAME bun)

set(BUN_ZIG_IDENTIFIER_SOURCE ${CWD}/src/js_lexer)
set(BUN_ZIG_IDENTIFIER_SCRIPT ${BUN_ZIG_IDENTIFIER_SOURCE}/identifier_data.zig)

file(GLOB BUN_ZIG_IDENTIFIER_SOURCES
  ${CONFIGURE_DEPENDS}
  ${BUN_ZIG_IDENTIFIER_SCRIPT}
  ${BUN_ZIG_IDENTIFIER_SOURCE}/*.zig
)

set(BUN_ZIG_IDENTIFIER_OUTPUTS
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_continue_bitset.blob
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_continue_bitset.meta.blob
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_start_bitset.blob
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_start_bitset.meta.blob
)

add_target(
  NAME  
    bun-codegen-identifier-data
  ALIASES
    bun-codegen
  COMMENT
    "Generating src/js_lexer/*.blob"
  COMMAND
    ${CMAKE_ZIG_COMPILER}
      run
      ${CMAKE_ZIG_FLAGS}
      ${BUN_ZIG_IDENTIFIER_SCRIPT}
  SOURCES
    ${BUN_ZIG_IDENTIFIER_SOURCES}
  OUTPUTS
    ${BUN_ZIG_IDENTIFIER_OUTPUTS}
  DEPENDS
    clone-zig
)

set(BUN_ERROR_SOURCE ${CWD}/packages/bun-error)

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

add_target(
  NAME
    bun-codegen-bun-error
  ALIASES
    bun-codegen
  COMMENT
    "Building bun-error"
  WORKING_DIRECTORY
    ${BUN_ERROR_SOURCE}
  COMMAND
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
  SOURCES
    ${BUN_ERROR_SOURCES}
  OUTPUTS
    ${BUN_ERROR_OUTPUTS}
  DEPENDS
    install-bun
)

add_bun_install(
  NAME
    bun-codegen-bun-error
  WORKING_DIRECTORY
    ${BUN_ERROR_SOURCE}
)

set(BUN_FALLBACK_DECODER_SOURCE ${CWD}/src/fallback.ts)
set(BUN_FALLBACK_DECODER_OUTPUT ${CWD}/src/fallback.out.js)

add_target(
  NAME
    bun-codegen-fallback-decoder
  ALIASES
    bun-codegen
  COMMENT
    "Building src/fallback.out.js"
  COMMAND
    ${BUN_EXECUTABLE} x
    esbuild
      ${BUN_FALLBACK_DECODER_SOURCE}
      --outfile=${BUN_FALLBACK_DECODER_OUTPUT}
      --target=esnext
      --bundle
      --format=iife
      --platform=browser
      --minify
  SOURCES
    ${BUN_FALLBACK_DECODER_SOURCE}
  OUTPUTS
    ${BUN_FALLBACK_DECODER_OUTPUT}
  DEPENDS
    install-bun
)

set(BUN_RUNTIME_JS_SOURCE ${CWD}/src/runtime.bun.js)
set(BUN_RUNTIME_JS_OUTPUT ${CWD}/src/runtime.out.js)

add_target(
  NAME
    bun-codegen-runtime-js
  ALIASES
    bun-codegen
  COMMENT
    "Building src/runtime.out.js"
  COMMAND
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
  SOURCES
    ${BUN_RUNTIME_JS_SOURCE}
  OUTPUTS
    ${BUN_RUNTIME_JS_OUTPUT}
  DEPENDS
    install-bun
)

set(BUN_NODE_FALLBACKS_SOURCE ${CWD}/src/node-fallbacks)

file(GLOB BUN_NODE_FALLBACKS_SOURCES
  ${CONFIGURE_DEPENDS}
  ${BUN_NODE_FALLBACKS_SOURCE}/*.js
)

set(BUN_NODE_FALLBACKS_OUTPUTS ${BUN_NODE_FALLBACKS_SOURCES})

add_target(
  NAME
    bun-codegen-node-fallbacks
  ALIASES
    bun-codegen
  COMMENT
    "Building src/node-fallbacks"
  WORKING_DIRECTORY
    ${BUN_NODE_FALLBACKS_SOURCE}
  COMMAND
    ${BUN_EXECUTABLE} x
    esbuild
      ${BUN_NODE_FALLBACKS_SOURCES}
      --outdir=out
      --format=esm
      --minify
      --bundle
      --platform=browser
  SOURCES
    ${BUN_NODE_FALLBACKS_SOURCES}
  OUTPUTS
    ${BUN_NODE_FALLBACKS_OUTPUTS}
)

add_bun_install(
  NAME
    bun-codegen-node-fallbacks
  WORKING_DIRECTORY
    ${BUN_NODE_FALLBACKS_SOURCE}
)

# TODO: change custom commands defined above this, to use the codegen path instead of in-source 
parse_option(CODEGEN_PATH FILEPATH "Path to the codegen directory" ${BUILD_PATH}/codegen)

# --- ErrorCode.{zig,h} --

set(BUN_ERROR_CODE_SCRIPT ${CWD}/src/codegen/generate-node-errors.ts)

set(BUN_ERROR_CODE_SOURCES
  ${BUN_ERROR_CODE_SCRIPT}
  ${CWD}/src/bun.js/bindings/ErrorCode.ts
  ${CWD}/src/bun.js/bindings/ErrorCode.cpp
  ${CWD}/src/bun.js/bindings/ErrorCode.h
)

set(BUN_ERROR_CODE_OUTPUTS
  ${CODEGEN_PATH}/ErrorCode+List.h
  ${CODEGEN_PATH}/ErrorCode+Data.h
  ${CODEGEN_PATH}/ErrorCode.zig
)

add_target(
  NAME
    bun-codegen-error-code
  ALIASES
    bun-codegen
  COMMENT
    "Generating ErrorCode.{zig,h}"
  COMMAND
    ${BUN_EXECUTABLE}
      run
      ${BUN_ERROR_CODE_SCRIPT}
      ${CODEGEN_PATH}
  SOURCES
    ${BUN_ERROR_CODE_SOURCES}
  OUTPUTS
    ${BUN_ERROR_CODE_OUTPUTS}
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

file(GLOB BUN_ZIG_GENERATED_CLASSES_SOURCES ${CONFIGURE_DEPENDS}
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

add_target(
  NAME
    bun-codegen-zig-generated-classes
  ALIASES
    bun-codegen
  COMMENT
    "Generating ZigGeneratedClasses.{zig,cpp,h}"
  COMMAND
    ${BUN_EXECUTABLE}
      run
      ${BUN_ZIG_GENERATED_CLASSES_SCRIPT}
      ${BUN_ZIG_GENERATED_CLASSES_SOURCES}
      ${CODEGEN_PATH}
  SOURCES
    ${BUN_ZIG_GENERATED_CLASSES_SCRIPT}
    ${BUN_ZIG_GENERATED_CLASSES_SOURCES}
  OUTPUTS
    ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
)

set(BUN_JAVASCRIPT_CODEGEN_SCRIPT ${CWD}/src/codegen/bundle-modules.ts)

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

add_target(
  NAME
    bun-codegen-js-modules
  ALIASES
    bun-codegen
  COMMENT
    "Generating JavaScript modules"
  COMMAND
    ${BUN_EXECUTABLE}
      run
      ${BUN_JAVASCRIPT_CODEGEN_SCRIPT}
        --debug=${DEBUG}
        ${BUILD_PATH}
  SOURCES
    ${BUN_JAVASCRIPT_SOURCES}
    ${BUN_JAVASCRIPT_CODEGEN_SOURCES}
    ${BUN_JAVASCRIPT_CODEGEN_SCRIPT}
  OUTPUT
    ${BUN_JAVASCRIPT_OUTPUTS}
)

WEBKIT_ADD_SOURCE_DEPENDENCIES(
  ${CWD}/src/bun.js/bindings/InternalModuleRegistry.cpp
  ${CODEGEN_PATH}/InternalModuleRegistryConstants.h
)

set(BUN_JS_SINK_SCRIPT ${CWD}/src/codegen/generate-jssink.ts)

set(BUN_JS_SINK_SOURCES
  ${BUN_JS_SINK_SCRIPT}
  ${CWD}/src/codegen/create-hash-table
  ${CWD}/src/codegen/create-hash-table.ts
)

set(BUN_JS_SINK_OUTPUTS
  ${CODEGEN_PATH}/JSSink.cpp
  ${CODEGEN_PATH}/JSSink.h
  ${CODEGEN_PATH}/JSSink.lut.h
)

add_target(
  NAME
    bun-codegen-js-sink
  ALIASES
    bun-codegen
  COMMENT
    "Generating JSSink.{cpp,h}"
  COMMAND
    ${BUN_EXECUTABLE}
      run
      ${BUN_JS_SINK_SCRIPT}
      ${CODEGEN_PATH}
  SOURCES
    ${BUN_JS_SINK_SOURCES}
  OUTPUTS
    ${BUN_JS_SINK_OUTPUTS}
)

set(BUN_OBJECT_LUT_SCRIPT ${CWD}/src/codegen/create-hash-table.ts)

set(BUN_OBJECT_LUT_SOURCES
  ${BUN_OBJECT_LUT_SCRIPT}
  ${CWD}/src/codegen/create-hash-table
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
  add_target(
    NAME
      bun-codegen-lut-${filename}
    ALIASES
      bun-codegen-lut
      bun-codegen
    COMMENT
      "Generating ${filename}.lut.h"
    COMMAND
      ${BUN_EXECUTABLE}
        run
        ${BUN_OBJECT_LUT_SCRIPT}
        ${BUN_OBJECT_LUT_SOURCE}
        ${BUN_OBJECT_LUT_OUTPUT}
    SOURCES
      ${BUN_OBJECT_LUT_SCRIPT}
      ${BUN_OBJECT_LUT_SOURCE}
    OUTPUTS
      ${BUN_OBJECT_LUT_OUTPUT}
  )

  WEBKIT_ADD_SOURCE_DEPENDENCIES(${BUN_OBJECT_LUT_SOURCE} ${BUN_OBJECT_LUT_OUTPUT})
endforeach()

WEBKIT_ADD_SOURCE_DEPENDENCIES(
  ${CWD}/src/bun.js/bindings/ZigGlobalObject.cpp
  ${CODEGEN_PATH}/ZigGlobalObject.lut.h
)
