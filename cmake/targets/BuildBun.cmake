include(Macros)

if(DEBUG)
  set(bun bun-debug)
elseif(CMAKE_BUILD_TYPE STREQUAL "MinSizeRel")
  set(bun bun-smol-profile)
  set(bunStrip bun-smol)
elseif(ENABLE_VALGRIND)
  set(bun bun-valgrind)
elseif(ENABLE_ASSERTIONS)
  set(bun bun-assertions)
else()
  set(bun bun-profile)
  set(bunStrip bun)
endif()

set(bunExe ${bun}${CMAKE_EXECUTABLE_SUFFIX})

if(bunStrip)
  set(bunStripExe ${bunStrip}${CMAKE_EXECUTABLE_SUFFIX})
  set(buns ${bun} ${bunStrip})
else()
  set(buns ${bun})
endif()

# Some commands use this path, and some do not.
# In the future, change those commands so that generated files are written to this path.
optionx(CODEGEN_PATH FILEPATH "Path to the codegen directory" DEFAULT ${BUILD_PATH}/codegen)

# --- Codegen ---

set(BUN_ZIG_IDENTIFIER_SOURCE ${CWD}/src/js_lexer)
set(BUN_ZIG_IDENTIFIER_SCRIPT ${BUN_ZIG_IDENTIFIER_SOURCE}/identifier_data.zig)

file(GLOB BUN_ZIG_IDENTIFIER_SOURCES ${CONFIGURE_DEPENDS}
  ${BUN_ZIG_IDENTIFIER_SCRIPT}
  ${BUN_ZIG_IDENTIFIER_SOURCE}/*.zig
)

set(BUN_ZIG_IDENTIFIER_OUTPUTS
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_continue_bitset.blob
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_continue_bitset.meta.blob
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_start_bitset.blob
  ${BUN_ZIG_IDENTIFIER_SOURCE}/id_start_bitset.meta.blob
)

register_command(
  TARGET
    bun-identifier-data
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
  TARGETS
    clone-zig
)

set(BUN_ERROR_SOURCE ${CWD}/packages/bun-error)

file(GLOB BUN_ERROR_SOURCES ${CONFIGURE_DEPENDS}
  ${BUN_ERROR_SOURCE}/*.json
  ${BUN_ERROR_SOURCE}/*.ts
  ${BUN_ERROR_SOURCE}/*.tsx
  ${BUN_ERROR_SOURCE}/*.css
  ${BUN_ERROR_SOURCE}/img/*
)

set(BUN_ERROR_OUTPUT ${BUN_ERROR_SOURCE}/dist)
set(BUN_ERROR_OUTPUTS
  ${BUN_ERROR_OUTPUT}/index.js
  ${BUN_ERROR_OUTPUT}/bun-error.css
)

register_bun_install(
  CWD
    ${BUN_ERROR_SOURCE}
  NODE_MODULES_VARIABLE
    BUN_ERROR_NODE_MODULES
)

register_command(
  TARGET
    bun-error
  COMMENT
    "Building bun-error"
  CWD
    ${BUN_ERROR_SOURCE}
  COMMAND
    ${ESBUILD_EXECUTABLE} ${ESBUILD_ARGS}
      index.tsx
      bun-error.css
      --outdir=${BUN_ERROR_OUTPUT}
      --define:process.env.NODE_ENV=\"'production'\"
      --minify
      --bundle
      --platform=browser
      --format=esm
  SOURCES
    ${BUN_ERROR_SOURCES}
    ${BUN_ERROR_NODE_MODULES}
  OUTPUTS
    ${BUN_ERROR_OUTPUTS}
)

set(BUN_FALLBACK_DECODER_SOURCE ${CWD}/src/fallback.ts)
set(BUN_FALLBACK_DECODER_OUTPUT ${CWD}/src/fallback.out.js)

register_command(
  TARGET
    bun-fallback-decoder
  COMMENT
    "Building src/fallback.out.js"
  COMMAND
    ${ESBUILD_EXECUTABLE} ${ESBUILD_ARGS}
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
)

set(BUN_RUNTIME_JS_SOURCE ${CWD}/src/runtime.bun.js)
set(BUN_RUNTIME_JS_OUTPUT ${CWD}/src/runtime.out.js)

register_command(
  TARGET
    bun-runtime-js
  COMMENT
    "Building src/runtime.out.js"
  COMMAND
    ${ESBUILD_EXECUTABLE} ${ESBUILD_ARGS}
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
)

set(BUN_NODE_FALLBACKS_SOURCE ${CWD}/src/node-fallbacks)

file(GLOB BUN_NODE_FALLBACKS_SOURCES ${CONFIGURE_DEPENDS}
  ${BUN_NODE_FALLBACKS_SOURCE}/*.js
)

set(BUN_NODE_FALLBACKS_OUTPUT ${BUN_NODE_FALLBACKS_SOURCE}/out)
set(BUN_NODE_FALLBACKS_OUTPUTS)
foreach(source ${BUN_NODE_FALLBACKS_SOURCES})
  get_filename_component(filename ${source} NAME)
  list(APPEND BUN_NODE_FALLBACKS_OUTPUTS ${BUN_NODE_FALLBACKS_OUTPUT}/${filename})
endforeach()

register_bun_install(
  CWD
    ${BUN_NODE_FALLBACKS_SOURCE}
  NODE_MODULES_VARIABLE
    BUN_NODE_FALLBACKS_NODE_MODULES
)

# This command relies on an older version of `esbuild`, which is why
# it uses ${BUN_EXECUTABLE} x instead of ${ESBUILD_EXECUTABLE}.
register_command(
  TARGET
    bun-node-fallbacks
  COMMENT
    "Building src/node-fallbacks/*.js"
  CWD
    ${BUN_NODE_FALLBACKS_SOURCE}
  COMMAND
    ${BUN_EXECUTABLE} x
      esbuild ${ESBUILD_ARGS}
      ${BUN_NODE_FALLBACKS_SOURCES}
      --outdir=${BUN_NODE_FALLBACKS_OUTPUT}
      --format=esm
      --minify
      --bundle
      --platform=browser
  SOURCES
    ${BUN_NODE_FALLBACKS_SOURCES}
    ${BUN_NODE_FALLBACKS_NODE_MODULES}
  OUTPUTS
    ${BUN_NODE_FALLBACKS_OUTPUTS}
)

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

register_command(
  TARGET
    bun-error-code
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

register_command(
  TARGET
    bun-zig-generated-classes
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

file(GLOB_RECURSE BUN_JAVASCRIPT_SOURCES ${CONFIGURE_DEPENDS}
  ${CWD}/src/js/*.js
  ${CWD}/src/js/*.ts
)

file(GLOB BUN_JAVASCRIPT_CODEGEN_SOURCES ${CONFIGURE_DEPENDS}
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

register_command(
  TARGET
    bun-js-modules
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
  OUTPUTS
    ${BUN_JAVASCRIPT_OUTPUTS}
)

set(BUN_JS_SINK_SCRIPT ${CWD}/src/codegen/generate-jssink.ts)

set(BUN_JS_SINK_SOURCES
  ${BUN_JS_SINK_SCRIPT}
  ${CWD}/src/codegen/create-hash-table.ts
)

set(BUN_JS_SINK_OUTPUTS
  ${CODEGEN_PATH}/JSSink.cpp
  ${CODEGEN_PATH}/JSSink.h
  ${CODEGEN_PATH}/JSSink.lut.h
)

register_command(
  TARGET
    bun-js-sink
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

list(LENGTH BUN_OBJECT_LUT_SOURCES BUN_OBJECT_LUT_SOURCES_COUNT)
math(EXPR BUN_OBJECT_LUT_SOURCES_MAX_INDEX "${BUN_OBJECT_LUT_SOURCES_COUNT} - 1")

foreach(i RANGE 0 ${BUN_OBJECT_LUT_SOURCES_MAX_INDEX})
  list(GET BUN_OBJECT_LUT_SOURCES ${i} BUN_OBJECT_LUT_SOURCE)
  list(GET BUN_OBJECT_LUT_OUTPUTS ${i} BUN_OBJECT_LUT_OUTPUT)

  get_filename_component(filename ${BUN_OBJECT_LUT_SOURCE} NAME_WE)
  register_command(
    TARGET
      bun-codegen-lut-${filename}
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
  ${CWD}/src/bun.js/bindings/ErrorCode.cpp
  ${CODEGEN_PATH}/ErrorCode+List.h
)

WEBKIT_ADD_SOURCE_DEPENDENCIES(
  ${CWD}/src/bun.js/bindings/ErrorCode.h
  ${CODEGEN_PATH}/ErrorCode+Data.h
)

WEBKIT_ADD_SOURCE_DEPENDENCIES(
  ${CWD}/src/bun.js/bindings/ZigGlobalObject.cpp
  ${CODEGEN_PATH}/ZigGlobalObject.lut.h
)

WEBKIT_ADD_SOURCE_DEPENDENCIES(
  ${CWD}/src/bun.js/bindings/InternalModuleRegistry.cpp
  ${CODEGEN_PATH}/InternalModuleRegistryConstants.h
)

# --- Zig ---

file(GLOB_RECURSE BUN_ZIG_SOURCES ${CONFIGURE_DEPENDS}
  ${CWD}/*.zig
  ${CWD}/src/*.zig
)

list(APPEND BUN_ZIG_SOURCES
  ${BUN_ZIG_IDENTIFIER_OUTPUTS}
  ${BUN_ERROR_OUTPUTS}
  ${BUN_FALLBACK_DECODER_OUTPUT}
  ${BUN_RUNTIME_JS_OUTPUT}
  ${BUN_NODE_FALLBACKS_OUTPUTS}
  ${BUN_ERROR_CODE_OUTPUTS}
  ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
  ${BUN_JAVASCRIPT_OUTPUTS}
)

set(BUN_ZIG_OUTPUT ${BUILD_PATH}/bun-zig.o)

register_command(
  TARGET
    bun-zig
  GROUP
    console
  COMMENT
    "Building src/*.zig"
  COMMAND
    ${CMAKE_ZIG_COMPILER}
      build obj
      ${CMAKE_ZIG_FLAGS}
      --prefix ${BUILD_PATH}
      -Dobj_format=${ZIG_OBJECT_FORMAT}
      -Dtarget=${ZIG_TARGET}
      -Doptimize=${ZIG_OPTIMIZE}
      -Dcpu=${CPU}
      -Denable_logs=$<IF:$<BOOL:${ENABLE_LOGS}>,true,false>
      -Dversion=${VERSION}
      -Dsha=${REVISION}
      -Dreported_nodejs_version=${NODEJS_VERSION}
      -Dcanary=${CANARY_REVISION}
      -Dgenerated-code=${CODEGEN_PATH}
  OUTPUTS
    ${BUN_ZIG_OUTPUT}
  SOURCES
    ${BUN_ZIG_SOURCES}
  TARGETS
    clone-zig
)

set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "build.zig")

# --- C/C++ ---

set(BUN_DEPS_SOURCE ${CWD}/src/deps)
set(BUN_USOCKETS_SOURCE ${CWD}/packages/bun-usockets)

file(GLOB BUN_CXX_SOURCES ${CONFIGURE_DEPENDS}
  ${CWD}/src/io/*.cpp
  ${CWD}/src/bun.js/modules/*.cpp
  ${CWD}/src/bun.js/bindings/*.cpp
  ${CWD}/src/bun.js/bindings/webcore/*.cpp
  ${CWD}/src/bun.js/bindings/sqlite/*.cpp
  ${CWD}/src/bun.js/bindings/webcrypto/*.cpp
  ${CWD}/src/bun.js/bindings/webcrypto/*/*.cpp
  ${CWD}/src/bun.js/bindings/v8/*.cpp
  ${BUN_USOCKETS_SOURCE}/src/crypto/*.cpp
  ${BUN_DEPS_SOURCE}/*.cpp
)

file(GLOB BUN_C_SOURCES ${CONFIGURE_DEPENDS}
  ${BUN_USOCKETS_SOURCE}/src/*.c
  ${BUN_USOCKETS_SOURCE}/src/eventing/*.c
  ${BUN_USOCKETS_SOURCE}/src/internal/*.c
  ${BUN_USOCKETS_SOURCE}/src/crypto/*.c
)

register_repository(
  NAME
    picohttpparser
  REPOSITORY
    h2o/picohttpparser
  COMMIT
    066d2b1e9ab820703db0837a7255d92d30f0c9f5
  OUTPUTS
    picohttpparser.c
)

list(APPEND BUN_C_SOURCES ${BUN_DEPS_SOURCE}/picohttpparser/picohttpparser.c)

if(WIN32)
  list(APPEND BUN_C_SOURCES ${CWD}/src/bun.js/bindings/windows/musl-memmem.c)
endif()

list(APPEND BUN_CPP_SOURCES
  ${BUN_C_SOURCES}
  ${BUN_CXX_SOURCES}
  ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
  ${BUN_JS_SINK_OUTPUTS}
  ${BUN_JAVASCRIPT_OUTPUTS}
  ${BUN_OBJECT_LUT_OUTPUTS}
)

if(WIN32)
  if(ENABLE_CANARY)
    set(Bun_VERSION_WITH_TAG ${VERSION}-canary.${CANARY_REVISION})
  else()
    set(Bun_VERSION_WITH_TAG ${VERSION})
  endif()
  set(BUN_ICO_PATH ${CWD}/src/bun.ico)
  configure_file(
    ${CWD}/src/windows-app-info.rc
    ${CODEGEN_PATH}/windows-app-info.rc
  )
  list(APPEND BUN_CPP_SOURCES ${CODEGEN_PATH}/windows-app-info.rc)
endif()

# --- Executable ---

if(BUN_CPP_ONLY)
  add_library(${bun} STATIC ${BUN_CPP_SOURCES})
else()
  add_executable(${bun} ${BUN_CPP_SOURCES} ${BUN_ZIG_OUTPUT})
endif()

# --- Dependencies ---

include(BuildDependencies)

if(USE_STATIC_SQLITE)
  target_compile_definitions(${bun} PRIVATE "LAZY_LOAD_SQLITE=0")
else()
  target_compile_definitions(${bun} PRIVATE "LAZY_LOAD_SQLITE=1")
endif()

if(LINUX)
  if(USE_STATIC_LIBATOMIC)
    target_link_libraries(${bun} PRIVATE "libatomic.a")
  else()
    target_link_libraries(${bun} PUBLIC "libatomic.so")
  endif()
endif()

# --- Linking ---

# Since linking locks the file, we need to kill all instances of bun before linking.
# if(WIN32)
#   find_command(
#     VARIABLE
#       POWERSHELL_EXECUTABLE
#     COMMAND
#       pwsh
#       powershell
#   )
#   register_command(
#     TARGET
#       ${bun}
#     TARGET_PHASE
#       PRE_LINK
#     COMMAND
#       ${POWERSHELL_EXECUTABLE} /C
#       "Stop-Process -Name '${bun}' -Force -ErrorAction SilentlyContinue"
#   )
# endif()

# --- Packaging ---

if(bunStrip)
  register_command(
    TARGET
      ${bun}
    TARGET_PHASE
      POST_BUILD
    COMMENT
      "Stripping ${bun}"
    COMMAND
      ${CMAKE_STRIP}
        ${bunExe}
        --strip-all
        --strip-debug
        --discard-all
        -o ${bunStripExe}
    CWD
      ${BUILD_PATH}
    OUTPUTS
      ${BUILD_PATH}/${bunStripExe}
  )
endif()

register_command(
  TARGET
    ${bun}
  TARGET_PHASE
    POST_BUILD
  COMMENT
    "Testing ${bun}"
  COMMAND
    ${CMAKE_COMMAND}
    -E env BUN_DEBUG_QUIET_LOGS=1
    ${BUILD_PATH}/${bunExe}
      --revision
  CWD
    ${BUILD_PATH}
)

if(CI)
  set(BUN_FEATURES_SCRIPT ${CWD}/scripts/features.mjs)
  register_command(
    TARGET
      ${bun}
    TARGET_PHASE
      POST_BUILD
    COMMENT
      "Generating features.json"
    COMMAND
      ${CMAKE_COMMAND}
        -E env
          BUN_GARBAGE_COLLECTOR_LEVEL=1
          BUN_DEBUG_QUIET_LOGS=1
          BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1
        ${BUILD_PATH}/${bunExe}
        ${BUN_FEATURES_SCRIPT}
    CWD
      ${BUILD_PATH}
    OUTPUTS
      ${BUILD_PATH}/features.json
  )
endif()

if(APPLE AND bunStrip)
  register_command(
    TARGET
      ${bun}
    TARGET_PHASE
      POST_BUILD
    COMMENT
      "Generating ${bun}.dSYM"
    COMMAND
      ${CMAKE_DSYMUTIL}
        ${bun}
        --flat
        --keep-function-for-static
        --object-prefix-map .=${CWD}
        -o ${bun}.dSYM
        -j ${CMAKE_BUILD_PARALLEL_LEVEL}
    CWD
      ${BUILD_PATH}
    OUTPUTS
      ${BUILD_PATH}/${bun}.dSYM
  )
endif()

if(CI)
  if(ENABLE_BASELINE)
    setx(bunTriplet bun-${OS}-${ARCH}-baseline)
  else()
    setx(bunTriplet bun-${OS}-${ARCH})
  endif()

  string(REPLACE bun ${bunTriplet} bunPath ${bun})
  register_command(
    TARGET
      ${bun}
    TARGET_PHASE
      POST_BUILD
    COMMENT
      "Generating ${bunPath}.zip"
    COMMAND
      ${CMAKE_COMMAND} -E rm -rf ${bunPath} ${bunPath}.zip
      && ${CMAKE_COMMAND} -E make_directory ${bunPath}
      && ${CMAKE_COMMAND} -E copy ${bunExe} ${bunPath}
      && ${CMAKE_COMMAND} -E tar cfv ${bunPath}.zip --format=zip ${bunPath}
      && ${CMAKE_COMMAND} -E rm -rf ${bunPath}
    CWD
      ${BUILD_PATH}
    ARTIFACTS
      ${BUILD_PATH}/${bunPath}.zip
  )

  if(bunStrip)
    string(REPLACE bun ${bunTriplet} bunStripPath ${bunStrip})
    register_command(
      TARGET
        ${bun}
      TARGET_PHASE
        POST_BUILD
      COMMENT
        "Generating ${bunStripPath}.zip"
      COMMAND
        ${CMAKE_COMMAND} -E rm -rf ${bunStripPath} ${bunStripPath}.zip
        && ${CMAKE_COMMAND} -E make_directory ${bunStripPath}
        && ${CMAKE_COMMAND} -E copy ${bunStripExe} ${bunStripPath}
        && ${CMAKE_COMMAND} -E tar cfv ${bunStripPath}.zip --format=zip ${bunStripPath}
        && ${CMAKE_COMMAND} -E rm -rf ${bunStripPath}
      CWD
        ${BUILD_PATH}
      ARTIFACTS
        ${BUILD_PATH}/${bunStripPath}.zip
    )
  endif()
endif()
