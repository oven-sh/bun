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

file(GLOB_RECURSE BUN_ZIG_IDENTIFIER_SOURCES
  RELATIVE ${CWD}
  FOLLOW_SYMLINKS
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
    ${BUN_ZIG_IDENTIFIER_SOURCE}
  VERBATIM COMMAND
    ${CMAKE_ZIG_COMPILER}
    run
    ${CMAKE_ZIG_FLAGS}
    identifier_data.zig
  OUTPUT
    ${BUN_ZIG_IDENTIFIER_OUTPUTS}
  MAIN_DEPENDENCY
    ${BUN_ZIG_IDENTIFIER_SOURCE}/identifier_data.zig
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

file(GLOB_RECURSE BUN_ERROR_SOURCES
  RELATIVE ${BUN_ERROR_SOURCE}
  FOLLOW_SYMLINKS
  ${CONFIGURE_DEPENDS}
  *.json *.ts *.tsx *.css img/*
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

file(GLOB_RECURSE BUN_NODE_FALLBACKS_SOURCES
  RELATIVE ${BUN_NODE_FALLBACKS_SOURCE}
  FOLLOW_SYMLINKS
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
    ${BUN_NODE_FALLBACKS_OUTPUT}
  MAIN_DEPENDENCY
    ${BUN_NODE_FALLBACKS_SOURCE}/bun.lockb
  DEPENDS
    ${BUN_NODE_FALLBACKS_SOURCE}/package.json
)

# TODO: change custom commands defined above this, to use the codegen path instead of in-source 
parse_option(CODEGEN_PATH FILEPATH "Path to the codegen directory" ${BUN_WORKDIR}/codegen)

# --- ErrorCode.{zig,h} --

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
      src/codegen/generate-node-errors.ts
      ${CODEGEN_PATH}
  OUTPUT
    ${BUN_ERROR_CODE_OUTPUTS}
  MAIN_DEPENDENCY
    ${CWD}/src/codegen/generate-node-errors.ts
  DEPENDS
    ${CWD}/src/bun.js/bindings/ErrorCode.ts
)

# --- ZigGeneratedClasses.{zig,cpp,h} --

file(GLOB_RECURSE BUN_ZIG_GENERATED_CLASSES_SOURCES
  RELATIVE ${CWD}
  FOLLOW_SYMLINKS
  ${CONFIGURE_DEPENDS}
  *.classes.ts
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
      src/codegen/generate-classes.ts
      ${BUN_ZIG_GENERATED_CLASSES_SOURCES}
      ${CODEGEN_PATH}
  OUTPUT
    ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
  MAIN_DEPENDENCY
    ${CWD}/src/codegen/generate-classes.ts
  DEPENDS
    ${BUN_ZIG_GENERATED_CLASSES_SOURCES}
)

# --- src/js/*.{js,ts} ---

file(GLOB_RECURSE BUN_JAVASCRIPT_SOURCES
  RELATIVE ${CWD}
  FOLLOW_SYMLINKS
  ${CONFIGURE_DEPENDS}
  src/js/*.js src/js/*.ts
)

file(GLOB_RECURSE BUN_JAVASCRIPT_CODEGEN_SOURCES
  RELATIVE ${CODEGEN_PATH}
  FOLLOW_SYMLINKS
  ${CONFIGURE_DEPENDS}
  *.ts
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
  ${CODEGEN_PATH}/GeneratedJS2Native.zig
)

add_custom_command(
  COMMENT
    "Generating JavaScript modules"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${BUN_EXECUTABLE}
      run
      src/codegen/bundle-modules.ts
      --debug=${DEBUG}
      ${BUILD_PATH}
  OUTPUT
    ${BUN_JAVASCRIPT_OUTPUTS}
  MAIN_DEPENDENCY
    ${CWD}/src/codegen/bundle-modules.ts
  DEPENDS
    ${BUN_JAVASCRIPT_SOURCES}
    ${BUN_JAVASCRIPT_CODEGEN_SOURCES}
)

# --- JSSink.{cpp,h} ---

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
      src/codegen/generate-jssink.ts
      ${CODEGEN_PATH}
  OUTPUT
    ${BUN_JS_SINK_OUTPUTS}
  MAIN_DEPENDENCY
    ${CWD}/src/codegen/generate-jssink.ts
)
