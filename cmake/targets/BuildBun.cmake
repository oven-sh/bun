include(PathUtils)

if(DEBUG)
  set(bun bun-debug)
elseif(ENABLE_ASAN AND ENABLE_VALGRIND)
  set(bun bun-asan-valgrind)
elseif(ENABLE_ASAN)
  set(bun bun-asan)
elseif(ENABLE_VALGRIND)
  set(bun bun-valgrind)
elseif(ENABLE_ASSERTIONS)
  set(bun bun-assertions)
else()
  set(bun bun-profile)
  set(bunStrip bun)
endif()

if(TEST)
  set(bun ${bun}-test)
endif()

set(bunExe ${bun}${CMAKE_EXECUTABLE_SUFFIX})

if(bunStrip)
  set(bunStripExe ${bunStrip}${CMAKE_EXECUTABLE_SUFFIX})
  set(buns ${bun} ${bunStrip})
else()
  set(buns ${bun})
endif()

optionx(CODEGEN_PATH FILEPATH "Path to the codegen directory" DEFAULT ${BUILD_PATH}/codegen)

if(RELEASE OR CI)
  set(DEFAULT_CODEGEN_EMBED ON)
else()
  set(DEFAULT_CODEGEN_EMBED OFF)
endif()

optionx(CODEGEN_EMBED BOOL "If codegen files should be embedded in the binary" DEFAULT ${DEFAULT_CODEGEN_EMBED})

if((NOT DEFINED CONFIGURE_DEPENDS AND NOT CI) OR CONFIGURE_DEPENDS)
  set(CONFIGURE_DEPENDS "CONFIGURE_DEPENDS")
else()
  set(CONFIGURE_DEPENDS "")
endif()

set(LLVM_ZIG_CODEGEN_THREADS 0)

# --- Dependencies ---

set(BUN_DEPENDENCIES
  BoringSSL
  Brotli
  Cares
  Highway
  LibDeflate
  LolHtml
  Lshpack
  Mimalloc
  Zlib
  LibArchive # must be loaded after zlib
  HdrHistogram # must be loaded after zlib
  Zstd
)

# TinyCC is optional - disabled on Windows ARM64 where it's not supported
if(ENABLE_TINYCC)
  list(APPEND BUN_DEPENDENCIES TinyCC)
endif()

include(CloneZstd)

# --- Codegen ---

set(BUN_ERROR_SOURCE ${CWD}/packages/bun-error)

absolute_sources(BUN_ERROR_SOURCES ${CWD}/cmake/sources/BunErrorSources.txt)

set(BUN_ERROR_OUTPUT ${CODEGEN_PATH}/bun-error)
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
set(BUN_FALLBACK_DECODER_OUTPUT ${CODEGEN_PATH}/fallback-decoder.js)

register_command(
  TARGET
    bun-fallback-decoder
  COMMENT
    "Building fallback-decoder.js"
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
set(BUN_RUNTIME_JS_OUTPUT ${CODEGEN_PATH}/runtime.out.js)

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

absolute_sources(BUN_NODE_FALLBACKS_SOURCES ${CWD}/cmake/sources/NodeFallbacksSources.txt)

set(BUN_NODE_FALLBACKS_OUTPUT ${CODEGEN_PATH}/node-fallbacks)
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
    "Building node-fallbacks/*.js"
  CWD
    ${BUN_NODE_FALLBACKS_SOURCE}
  COMMAND
    ${BUN_EXECUTABLE} ${BUN_FLAGS} run build-fallbacks
      ${BUN_NODE_FALLBACKS_OUTPUT}
      ${BUN_NODE_FALLBACKS_SOURCES}
  SOURCES
    ${BUN_NODE_FALLBACKS_SOURCES}
    ${BUN_NODE_FALLBACKS_NODE_MODULES}
  OUTPUTS
    ${BUN_NODE_FALLBACKS_OUTPUTS}
)

# An embedded copy of react-refresh is used when the user forgets to install it.
# The library is not versioned alongside React.
set(BUN_REACT_REFRESH_OUTPUT ${BUN_NODE_FALLBACKS_OUTPUT}/react-refresh.js)
register_command(
  TARGET
    bun-node-fallbacks-react-refresh
  COMMENT
    "Building node-fallbacks/react-refresh.js"
  CWD
    ${BUN_NODE_FALLBACKS_SOURCE}
  COMMAND
    ${BUN_EXECUTABLE} ${BUN_FLAGS} build
      ${BUN_NODE_FALLBACKS_SOURCE}/node_modules/react-refresh/cjs/react-refresh-runtime.development.js
      --outfile=${BUN_REACT_REFRESH_OUTPUT}
      --target=browser
      --format=cjs
      --minify
      --define:process.env.NODE_ENV=\"'development'\"
  SOURCES
    ${BUN_NODE_FALLBACKS_SOURCE}/package.json
    ${BUN_NODE_FALLBACKS_SOURCE}/bun.lock
    ${BUN_NODE_FALLBACKS_NODE_MODULES}
  OUTPUTS
    ${BUN_REACT_REFRESH_OUTPUT}
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
      ${BUN_FLAGS}
      run
      ${BUN_ERROR_CODE_SCRIPT}
      ${CODEGEN_PATH}
  SOURCES
    ${BUN_ERROR_CODE_SOURCES}
  OUTPUTS
    ${BUN_ERROR_CODE_OUTPUTS}
)

set(BUN_ZIG_GENERATED_CLASSES_SCRIPT ${CWD}/src/codegen/generate-classes.ts)

absolute_sources(BUN_ZIG_GENERATED_CLASSES_SOURCES ${CWD}/cmake/sources/ZigGeneratedClassesSources.txt)

# hand written cpp source files. Full list of "source" code (including codegen) is in BUN_CPP_SOURCES
absolute_sources(BUN_CXX_SOURCES ${CWD}/cmake/sources/CxxSources.txt)
absolute_sources(BUN_C_SOURCES ${CWD}/cmake/sources/CSources.txt)

set(BUN_ZIG_GENERATED_CLASSES_OUTPUTS
  ${CODEGEN_PATH}/ZigGeneratedClasses.h
  ${CODEGEN_PATH}/ZigGeneratedClasses.cpp
  ${CODEGEN_PATH}/ZigGeneratedClasses+lazyStructureHeader.h
  ${CODEGEN_PATH}/ZigGeneratedClasses+DOMClientIsoSubspaces.h
  ${CODEGEN_PATH}/ZigGeneratedClasses+DOMIsoSubspaces.h
  ${CODEGEN_PATH}/ZigGeneratedClasses+lazyStructureImpl.h
  ${CODEGEN_PATH}/ZigGeneratedClasses.zig
  ${CODEGEN_PATH}/ZigGeneratedClasses.lut.txt
)

register_command(
  TARGET
    bun-zig-generated-classes
  COMMENT
    "Generating ZigGeneratedClasses.{zig,cpp,h}"
  COMMAND
    ${BUN_EXECUTABLE}
      ${BUN_FLAGS}
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

absolute_sources(BUN_JAVASCRIPT_SOURCES ${CWD}/cmake/sources/JavaScriptSources.txt)
absolute_sources(BUN_JAVASCRIPT_CODEGEN_SOURCES ${CWD}/cmake/sources/JavaScriptCodegenSources.txt)

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

set(BUN_CPP_OUTPUTS
  ${CODEGEN_PATH}/cpp.zig
)

set(BUN_CI_INFO_OUTPUTS
  ${CODEGEN_PATH}/ci_info.zig
)

register_command(
  TARGET
    bun-cppbind
  COMMENT
    "Generating C++ --> Zig bindings"
  COMMAND
    ${BUN_EXECUTABLE}
      ${BUN_FLAGS}
      ${CWD}/src/codegen/cppbind.ts
      ${CWD}/src
      ${CODEGEN_PATH}
  SOURCES
    ${BUN_JAVASCRIPT_CODEGEN_SOURCES}
    ${BUN_CXX_SOURCES}
  OUTPUTS
    ${BUN_CPP_OUTPUTS}
)

register_command(
  TARGET
    bun-ci-info
  COMMENT
    "Generating CI info"
  COMMAND
    ${BUN_EXECUTABLE}
      ${BUN_FLAGS}
      ${CWD}/src/codegen/ci_info.ts
      ${CODEGEN_PATH}/ci_info.zig
  SOURCES
    ${BUN_JAVASCRIPT_CODEGEN_SOURCES}
  OUTPUTS
    ${BUN_CI_INFO_OUTPUTS}
)

if(SKIP_CODEGEN)
  # Skip JavaScript codegen - useful for Windows ARM64 debug builds where bun crashes
  message(STATUS "SKIP_CODEGEN is ON - skipping bun-js-modules codegen")
  foreach(output ${BUN_JAVASCRIPT_OUTPUTS})
    if(NOT EXISTS ${output})
      message(FATAL_ERROR "SKIP_CODEGEN is ON but ${output} does not exist. Run codegen manually first.")
    endif()
  endforeach()
else()
  register_command(
    TARGET
      bun-js-modules
    COMMENT
      "Generating JavaScript modules"
    COMMAND
      ${BUN_EXECUTABLE}
        ${BUN_FLAGS}
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
endif()

set(BUN_BAKE_RUNTIME_CODEGEN_SCRIPT ${CWD}/src/codegen/bake-codegen.ts)

absolute_sources(BUN_BAKE_RUNTIME_SOURCES ${CWD}/cmake/sources/BakeRuntimeSources.txt)

list(APPEND BUN_BAKE_RUNTIME_CODEGEN_SOURCES
  ${CWD}/src/bun.js/bindings/InternalModuleRegistry.cpp
)

set(BUN_BAKE_RUNTIME_OUTPUTS
  ${CODEGEN_PATH}/bake.client.js
  ${CODEGEN_PATH}/bake.server.js
)

register_command(
  TARGET
    bun-bake-codegen
  COMMENT
    "Bundling Bake Runtime"
  COMMAND
    ${BUN_EXECUTABLE}
      ${BUN_FLAGS}
      run
      ${BUN_BAKE_RUNTIME_CODEGEN_SCRIPT}
        --debug=${DEBUG}
        --codegen-root=${CODEGEN_PATH}
  SOURCES
    ${BUN_BAKE_RUNTIME_SOURCES}
    ${BUN_BAKE_RUNTIME_CODEGEN_SOURCES}
    ${BUN_BAKE_RUNTIME_CODEGEN_SCRIPT}
  OUTPUTS
    ${CODEGEN_PATH}/bake_empty_file
    ${BUN_BAKE_RUNTIME_OUTPUTS}
)

set(BUN_BINDGENV2_SCRIPT ${CWD}/src/codegen/bindgenv2/script.ts)

absolute_sources(BUN_BINDGENV2_SOURCES ${CWD}/cmake/sources/BindgenV2Sources.txt)
# These sources include the script itself.
absolute_sources(BUN_BINDGENV2_INTERNAL_SOURCES
  ${CWD}/cmake/sources/BindgenV2InternalSources.txt)
string(REPLACE ";" "," BUN_BINDGENV2_SOURCES_COMMA_SEPARATED
  "${BUN_BINDGENV2_SOURCES}")

execute_process(
  COMMAND ${BUN_EXECUTABLE} ${BUN_FLAGS} run ${BUN_BINDGENV2_SCRIPT}
    --command=list-outputs
    --sources=${BUN_BINDGENV2_SOURCES_COMMA_SEPARATED}
    --codegen-path=${CODEGEN_PATH}
  OUTPUT_VARIABLE bindgen_outputs
  COMMAND_ERROR_IS_FATAL ANY
)
foreach(output IN LISTS bindgen_outputs)
  if(output MATCHES "\.cpp$")
    list(APPEND BUN_BINDGENV2_CPP_OUTPUTS ${output})
  elseif(output MATCHES "\.zig$")
    list(APPEND BUN_BINDGENV2_ZIG_OUTPUTS ${output})
  else()
    message(FATAL_ERROR "unexpected bindgen output: [${output}]")
  endif()
endforeach()

register_command(
  TARGET
    bun-bindgen-v2
  COMMENT
    "Generating bindings (v2)"
  COMMAND
    ${BUN_EXECUTABLE} ${BUN_FLAGS} run ${BUN_BINDGENV2_SCRIPT}
      --command=generate
      --codegen-path=${CODEGEN_PATH}
      --sources=${BUN_BINDGENV2_SOURCES_COMMA_SEPARATED}
  SOURCES
    ${BUN_BINDGENV2_SOURCES}
    ${BUN_BINDGENV2_INTERNAL_SOURCES}
  OUTPUTS
    ${BUN_BINDGENV2_CPP_OUTPUTS}
    ${BUN_BINDGENV2_ZIG_OUTPUTS}
)

set(BUN_BINDGEN_SCRIPT ${CWD}/src/codegen/bindgen.ts)

absolute_sources(BUN_BINDGEN_SOURCES ${CWD}/cmake/sources/BindgenSources.txt)

set(BUN_BINDGEN_CPP_OUTPUTS
  ${CODEGEN_PATH}/GeneratedBindings.cpp
)

set(BUN_BINDGEN_ZIG_OUTPUTS
  ${CWD}/src/bun.js/bindings/GeneratedBindings.zig
)

register_command(
  TARGET
    bun-binding-generator
  COMMENT
    "Processing \".bind.ts\" files"
  COMMAND
    ${BUN_EXECUTABLE}
      ${BUN_FLAGS}
      run
      ${BUN_BINDGEN_SCRIPT}
        --debug=${DEBUG}
        --codegen-root=${CODEGEN_PATH}
  SOURCES
    ${BUN_BINDGEN_SOURCES}
    ${BUN_BINDGEN_SCRIPT}
  OUTPUTS
    ${BUN_BINDGEN_CPP_OUTPUTS}
    ${BUN_BINDGEN_ZIG_OUTPUTS}
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
      ${BUN_FLAGS}
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
  ${CWD}/src/bun.js/bindings/ProcessBindingBuffer.cpp
  ${CWD}/src/bun.js/bindings/ProcessBindingConstants.cpp
  ${CWD}/src/bun.js/bindings/ProcessBindingFs.cpp
  ${CWD}/src/bun.js/bindings/ProcessBindingNatives.cpp
  ${CWD}/src/bun.js/bindings/ProcessBindingHTTPParser.cpp
  ${CWD}/src/bun.js/modules/NodeModuleModule.cpp
  ${CODEGEN_PATH}/ZigGeneratedClasses.lut.txt
)

set(BUN_OBJECT_LUT_OUTPUTS
  ${CODEGEN_PATH}/BunObject.lut.h
  ${CODEGEN_PATH}/ZigGlobalObject.lut.h
  ${CODEGEN_PATH}/JSBuffer.lut.h
  ${CODEGEN_PATH}/BunProcess.lut.h
  ${CODEGEN_PATH}/ProcessBindingBuffer.lut.h
  ${CODEGEN_PATH}/ProcessBindingConstants.lut.h
  ${CODEGEN_PATH}/ProcessBindingFs.lut.h
  ${CODEGEN_PATH}/ProcessBindingNatives.lut.h
  ${CODEGEN_PATH}/ProcessBindingHTTPParser.lut.h
  ${CODEGEN_PATH}/NodeModuleModule.lut.h
  ${CODEGEN_PATH}/ZigGeneratedClasses.lut.h
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
    DEPENDS
      ${BUN_OBJECT_LUT_SOURCE}
    COMMAND
      ${BUN_EXECUTABLE}
        ${BUN_FLAGS}
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

absolute_sources(BUN_ZIG_SOURCES ${CWD}/cmake/sources/ZigSources.txt)

list(APPEND BUN_ZIG_SOURCES
  ${CWD}/build.zig
  ${BUN_BINDGEN_ZIG_OUTPUTS}
)

set(BUN_ZIG_GENERATED_SOURCES
  ${BUN_ERROR_OUTPUTS}
  ${BUN_FALLBACK_DECODER_OUTPUT}
  ${BUN_RUNTIME_JS_OUTPUT}
  ${BUN_NODE_FALLBACKS_OUTPUTS}
  ${BUN_REACT_REFRESH_OUTPUT}
  ${BUN_ERROR_CODE_OUTPUTS}
  ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
  ${BUN_JAVASCRIPT_OUTPUTS}
  ${BUN_CPP_OUTPUTS}
  ${BUN_CI_INFO_OUTPUTS}
  ${BUN_BINDGENV2_ZIG_OUTPUTS}
)

# In debug builds, these are not embedded, but rather referenced at runtime.
if (DEBUG)
  list(APPEND BUN_ZIG_GENERATED_SOURCES ${CODEGEN_PATH}/bake_empty_file)
else()
  list(APPEND BUN_ZIG_GENERATED_SOURCES ${BUN_BAKE_RUNTIME_OUTPUTS})
endif()

if (TEST)
  set(BUN_ZIG_OUTPUT ${BUILD_PATH}/bun-test.o)
  set(ZIG_STEPS test)
else()
  if (LLVM_ZIG_CODEGEN_THREADS GREATER 1)
    foreach(i RANGE ${LLVM_ZIG_CODEGEN_THREADS})
      list(APPEND BUN_ZIG_OUTPUT ${BUILD_PATH}/bun-zig.${i}.o)
    endforeach()
  else()
    set(BUN_ZIG_OUTPUT ${BUILD_PATH}/bun-zig.o)
  endif()
  set(ZIG_STEPS obj)
endif()

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm|ARM|arm64|ARM64|aarch64|AARCH64")
  if(APPLE)
    set(ZIG_CPU "apple_m1")
  elseif(WIN32)
    # Windows ARM64: use a specific CPU with NEON support
    # Zig running under x64 emulation would detect wrong CPU with "native"
    set(ZIG_CPU "cortex_a76")
  else()
    set(ZIG_CPU "native")
  endif()
elseif(CMAKE_SYSTEM_PROCESSOR MATCHES "x86_64|X86_64|x64|X64|amd64|AMD64")
  if(ENABLE_BASELINE)
    set(ZIG_CPU "nehalem")
  else()
    set(ZIG_CPU "haswell")
  endif()
else()
  unsupported(CMAKE_SYSTEM_PROCESSOR)
endif()

set(ZIG_FLAGS_BUN)
if(NOT "${REVISION}" STREQUAL "")
  set(ZIG_FLAGS_BUN ${ZIG_FLAGS_BUN} -Dsha=${REVISION})
endif()

register_command(
  TARGET
    bun-zig
  GROUP
    console
  COMMENT
    "Building src/*.zig into ${BUN_ZIG_OUTPUT} for ${ZIG_TARGET}"
  COMMAND
    ${ZIG_EXECUTABLE}
      build ${ZIG_STEPS}
      ${CMAKE_ZIG_FLAGS}
      --prefix ${BUILD_PATH}
      -Dobj_format=${ZIG_OBJECT_FORMAT}
      -Dtarget=${ZIG_TARGET}
      -Doptimize=${ZIG_OPTIMIZE}
      -Dcpu=${ZIG_CPU}
      -Denable_logs=$<IF:$<BOOL:${ENABLE_LOGS}>,true,false>
      -Denable_asan=$<IF:$<BOOL:${ENABLE_ZIG_ASAN}>,true,false>
      -Denable_fuzzilli=$<IF:$<BOOL:${ENABLE_FUZZILLI}>,true,false>
      -Denable_valgrind=$<IF:$<BOOL:${ENABLE_VALGRIND}>,true,false>
      -Denable_tinycc=$<IF:$<BOOL:${ENABLE_TINYCC}>,true,false>
      -Duse_mimalloc=$<IF:$<BOOL:${USE_MIMALLOC_AS_DEFAULT_ALLOCATOR}>,true,false>
      -Dllvm_codegen_threads=${LLVM_ZIG_CODEGEN_THREADS}
      -Dversion=${VERSION}
      -Dreported_nodejs_version=${NODEJS_VERSION}
      -Dcanary=${CANARY_REVISION}
      -Dcodegen_path=${CODEGEN_PATH}
      -Dcodegen_embed=$<IF:$<BOOL:${CODEGEN_EMBED}>,true,false>
      --prominent-compile-errors
      --summary all
      ${ZIG_FLAGS_BUN}
  ARTIFACTS
    ${BUN_ZIG_OUTPUT}
  TARGETS
    clone-zig
    clone-zstd
    bun-cppbind
  SOURCES
    ${BUN_ZIG_SOURCES}
    ${BUN_ZIG_GENERATED_SOURCES}
    ${CWD}/src/install/PackageManager/scanner-entry.ts # Is there a better way to do this?
)

set_property(TARGET bun-zig PROPERTY JOB_POOL compile_pool)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "build.zig")

# --- C/C++ Sources ---

set(BUN_USOCKETS_SOURCE ${CWD}/packages/bun-usockets)

if(WIN32)
  list(APPEND BUN_CXX_SOURCES ${CWD}/src/bun.js/bindings/windows/rescle.cpp)
  list(APPEND BUN_CXX_SOURCES ${CWD}/src/bun.js/bindings/windows/rescle-binding.cpp)
endif()

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

set(NODEJS_HEADERS_PATH ${VENDOR_PATH}/nodejs)

register_command(
  TARGET
    bun-node-headers
  COMMENT
    "Download node ${NODEJS_VERSION} headers"
  COMMAND
    ${CMAKE_COMMAND}
      -DDOWNLOAD_PATH=${NODEJS_HEADERS_PATH}
      -DDOWNLOAD_URL=https://nodejs.org/dist/v${NODEJS_VERSION}/node-v${NODEJS_VERSION}-headers.tar.gz
      -P ${CWD}/cmake/scripts/DownloadUrl.cmake
  COMMAND
    ${CMAKE_COMMAND}
      -DNODE_INCLUDE_DIR=${NODEJS_HEADERS_PATH}/include
      -P ${CWD}/cmake/scripts/PrepareNodeHeaders.cmake
  OUTPUTS
    ${NODEJS_HEADERS_PATH}/include/node/node_version.h
    ${NODEJS_HEADERS_PATH}/include/.node-headers-prepared
)

list(APPEND BUN_CPP_SOURCES
  ${BUN_C_SOURCES}
  ${BUN_CXX_SOURCES}
  ${BUN_ERROR_CODE_OUTPUTS}
  ${VENDOR_PATH}/picohttpparser/picohttpparser.c
  ${NODEJS_HEADERS_PATH}/include/node/node_version.h
  ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
  ${BUN_JS_SINK_OUTPUTS}
  ${BUN_JAVASCRIPT_OUTPUTS}
  ${BUN_OBJECT_LUT_OUTPUTS}
  ${BUN_BINDGEN_CPP_OUTPUTS}
  ${BUN_BINDGENV2_CPP_OUTPUTS}
)

if(WIN32)
  if(ENABLE_CANARY)
    set(Bun_VERSION_WITH_TAG ${VERSION}-canary.${CANARY_REVISION})
  else()
    set(Bun_VERSION_WITH_TAG ${VERSION})
  endif()
  configure_file(${CWD}/src/bun.ico ${CODEGEN_PATH}/bun.ico COPYONLY)
  set(BUN_ICO_PATH ${CODEGEN_PATH}/bun.ico)
  configure_file(
    ${CWD}/src/windows-app-info.rc
    ${CODEGEN_PATH}/windows-app-info.rc
    @ONLY
  )
  set(WINDOWS_RESOURCES ${CODEGEN_PATH}/windows-app-info.rc ${CWD}/src/bun.exe.manifest)
endif()

# --- Executable ---

set(BUN_CPP_OUTPUT ${BUILD_PATH}/${CMAKE_STATIC_LIBRARY_PREFIX}${bun}${CMAKE_STATIC_LIBRARY_SUFFIX})

if(BUN_LINK_ONLY)
  add_executable(${bun} ${BUN_CPP_OUTPUT} ${BUN_ZIG_OUTPUT} ${WINDOWS_RESOURCES})
  set_target_properties(${bun} PROPERTIES LINKER_LANGUAGE CXX)
  target_link_libraries(${bun} PRIVATE ${BUN_CPP_OUTPUT})
elseif(BUN_CPP_ONLY)
  add_library(${bun} STATIC ${BUN_CPP_SOURCES})
  register_command(
    TARGET
      ${bun}
    TARGET_PHASE
      POST_BUILD
    COMMENT
      "Uploading ${bun}"
    COMMAND
      ${CMAKE_COMMAND} -E true
    ARTIFACTS
      ${BUN_CPP_OUTPUT}
  )
else()
  add_executable(${bun} ${BUN_CPP_SOURCES} ${WINDOWS_RESOURCES})
  target_link_libraries(${bun} PRIVATE ${BUN_ZIG_OUTPUT})
endif()

if(NOT bun STREQUAL "bun")
  add_custom_target(bun DEPENDS ${bun})
endif()

# --- C/C++ Properties ---

set_target_properties(${bun} PROPERTIES
  CXX_STANDARD 23
  CXX_STANDARD_REQUIRED YES
  CXX_EXTENSIONS YES
  CXX_VISIBILITY_PRESET hidden
  C_STANDARD 17 # Cannot uprev to C23 because MSVC doesn't have support.
  C_STANDARD_REQUIRED YES
  VISIBILITY_INLINES_HIDDEN YES
)

if (NOT WIN32)
  # Enable precompiled headers
  # Only enable in these scenarios:
  # 1. NOT in CI, OR
  # 2. In CI AND BUN_CPP_ONLY is enabled
  if(NOT CI OR (CI AND BUN_CPP_ONLY))
    target_precompile_headers(${bun} PRIVATE
      "$<$<COMPILE_LANGUAGE:CXX>:${CWD}/src/bun.js/bindings/root.h>"
    )
  endif()
endif()

# --- C/C++ Includes ---

if(WIN32)
  target_include_directories(${bun} PRIVATE ${CWD}/src/bun.js/bindings/windows)
endif()

target_include_directories(${bun} PRIVATE
  ${CWD}/packages
  ${CWD}/packages/bun-usockets
  ${CWD}/packages/bun-usockets/src
  ${CWD}/src/bun.js/bindings
  ${CWD}/src/bun.js/bindings/webcore
  ${CWD}/src/bun.js/bindings/webcrypto
  ${CWD}/src/bun.js/bindings/node/crypto
  ${CWD}/src/bun.js/bindings/node/http
  ${CWD}/src/bun.js/bindings/sqlite
  ${CWD}/src/bun.js/bindings/v8
  ${CWD}/src/bun.js/modules
  ${CWD}/src/js/builtins
  ${CWD}/src/napi
  ${CWD}/src/deps
  ${CODEGEN_PATH}
  ${VENDOR_PATH}
  ${VENDOR_PATH}/picohttpparser
  ${VENDOR_PATH}/zlib
  ${NODEJS_HEADERS_PATH}/include
  ${NODEJS_HEADERS_PATH}/include/node
)

if(NOT WIN32)
  target_include_directories(${bun} PRIVATE ${CWD}/src/bun.js/bindings/libuv)
endif()

if(LINUX)
  include(CheckIncludeFiles)
  check_include_files("sys/queue.h" HAVE_SYS_QUEUE_H)
  if(NOT HAVE_SYS_QUEUE_H)
    target_include_directories(${bun} PRIVATE vendor/lshpack/compat/queue)
  endif()
endif()

# --- C/C++ Definitions ---

if(ENABLE_ASSERTIONS)
  target_compile_definitions(${bun} PRIVATE ASSERT_ENABLED=1)
endif()

if(DEBUG)
  target_compile_definitions(${bun} PRIVATE BUN_DEBUG=1)
endif()

if(APPLE)
  target_compile_definitions(${bun} PRIVATE _DARWIN_NON_CANCELABLE=1)
endif()

if(WIN32)
  target_compile_definitions(${bun} PRIVATE
    WIN32
    _WINDOWS
    WIN32_LEAN_AND_MEAN=1
    _CRT_SECURE_NO_WARNINGS
    BORINGSSL_NO_CXX=1 # lol
  )
endif()

if(USE_MIMALLOC_AS_DEFAULT_ALLOCATOR)
  target_compile_definitions(${bun} PRIVATE USE_BUN_MIMALLOC=1)
endif()

target_compile_definitions(${bun} PRIVATE
  _HAS_EXCEPTIONS=0
  LIBUS_USE_OPENSSL=1
  LIBUS_USE_BORINGSSL=1
  WITH_BORINGSSL=1
  STATICALLY_LINKED_WITH_JavaScriptCore=1
  STATICALLY_LINKED_WITH_BMALLOC=1
  BUILDING_WITH_CMAKE=1
  JSC_OBJC_API_ENABLED=0
  BUN_SINGLE_THREADED_PER_VM_ENTRY_SCOPE=1
  NAPI_EXPERIMENTAL=ON
  NOMINMAX
  IS_BUILD
  BUILDING_JSCONLY__
  REPORTED_NODEJS_VERSION=\"${NODEJS_VERSION}\"
  REPORTED_NODEJS_ABI_VERSION=${NODEJS_ABI_VERSION}
)

if(DEBUG AND NOT CI)
  target_compile_definitions(${bun} PRIVATE
    BUN_DYNAMIC_JS_LOAD_PATH=\"${BUILD_PATH}/js\"
  )
endif()


# --- Compiler options ---

if(NOT WIN32)
  target_compile_options(${bun} PUBLIC
    -fconstexpr-steps=2542484
    -fconstexpr-depth=54
    -fno-pic
    -fno-pie
    -faddrsig
  )
  if(DEBUG)
    # TODO: this shouldn't be necessary long term
    if (NOT ABI STREQUAL "musl")
      target_compile_options(${bun} PUBLIC
        -fsanitize=null
        -fno-sanitize-recover=all
        -fsanitize=bounds
        -fsanitize=return
        -fsanitize=nullability-arg
        -fsanitize=nullability-assign
        -fsanitize=nullability-return
        -fsanitize=returns-nonnull-attribute
        -fsanitize=unreachable
      )
      target_link_libraries(${bun} PRIVATE
        -fsanitize=null
      )
    endif()

    if(ENABLE_ASAN)
      target_compile_options(${bun} PUBLIC -fsanitize=address)
      target_link_libraries(${bun} PUBLIC -fsanitize=address)
    endif()

    target_compile_options(${bun} PUBLIC
      -Werror=return-type
      -Werror=return-stack-address
      -Werror=implicit-function-declaration
      -Werror=uninitialized
      -Werror=conditional-uninitialized
      -Werror=suspicious-memaccess
      -Werror=int-conversion
      -Werror=nonnull
      -Werror=move
      -Werror=sometimes-uninitialized
      -Werror=unused
      -Wno-unused-function
      -Wno-c++23-lambda-attributes
      -Wno-nullability-completeness
      -Werror
    )
  else()
    # Leave -Werror=unused off in release builds so we avoid errors from being used in ASSERT
    target_compile_options(${bun} PUBLIC ${LTO_FLAG}
      -Werror=return-type
      -Werror=return-stack-address
      -Werror=implicit-function-declaration
      -Werror=uninitialized
      -Werror=conditional-uninitialized
      -Werror=suspicious-memaccess
      -Werror=int-conversion
      -Werror=nonnull
      -Werror=move
      -Werror=sometimes-uninitialized
      -Wno-c++23-lambda-attributes
      -Wno-nullability-completeness
      -Werror
    )

    if(ENABLE_ASAN)
      target_compile_options(${bun} PUBLIC
        -fsanitize=null
        -fno-sanitize-recover=all
        -fsanitize=bounds
        -fsanitize=return
        -fsanitize=nullability-arg
        -fsanitize=nullability-assign
        -fsanitize=nullability-return
        -fsanitize=returns-nonnull-attribute
        -fsanitize=unreachable
      )
      target_link_libraries(${bun} PRIVATE
        -fsanitize=null
      )
      target_compile_options(${bun} PUBLIC -fsanitize=address)
      target_link_libraries(${bun} PUBLIC -fsanitize=address)
    endif()
  endif()
else()
  target_compile_options(${bun} PUBLIC
    -Wno-nullability-completeness
    -Wno-inconsistent-dllimport
    -Wno-incompatible-pointer-types
    -Wno-deprecated-declarations
  )
endif()

# --- Linker options ---

if(WIN32)
  target_link_options(${bun} PUBLIC
    /STACK:0x1200000,0x200000
    /errorlimit:0
  )
  if(RELEASE)
    target_link_options(${bun} PUBLIC
      /LTCG
      /OPT:REF
      /OPT:NOICF
      /DEBUG:FULL
      /delayload:ole32.dll
      /delayload:WINMM.dll
      /delayload:dbghelp.dll
      /delayload:VCRUNTIME140_1.dll
      # libuv loads these two immediately, but for some reason it seems to still be slightly faster to delayload them
      /delayload:WS2_32.dll
      /delayload:WSOCK32.dll
      /delayload:ADVAPI32.dll
      /delayload:IPHLPAPI.dll
      /delayload:CRYPT32.dll
    )
  endif()
endif()

if(APPLE)
  target_link_options(${bun} PUBLIC
    -Wl,-ld_new
    -Wl,-no_compact_unwind
    -Wl,-stack_size,0x1200000
    -fno-keep-static-consts
  )

  if(DEBUG)
    target_link_options(${bun} PUBLIC
    # Suppress ALL linker warnings on macOS.
    # The intent is to only suppress linker alignment warnings.
    # As of July 21st, 2025 there doesn't seem to be a more specific suppression just for linker alignment warnings.
    # If you find one, please update this to only be for linker alignment.
    -Wl,-w
    )
  endif()

  # don't strip in debug, this seems to be needed so that the Zig std library
  # `*dbHelper` DWARF symbols (used by LLDB for pretty printing) are in the
  # output executable
  if(NOT DEBUG)
    target_link_options(${bun} PUBLIC
      -dead_strip
      -dead_strip_dylibs
      -Wl,-map,${bun}.linker-map
    )
  endif()
endif()

if(LINUX)
  if(NOT ABI STREQUAL "musl")
  target_link_options(${bun} PUBLIC
    -Wl,--wrap=exp
    -Wl,--wrap=exp2
    -Wl,--wrap=expf
    -Wl,--wrap=fcntl64
    -Wl,--wrap=gettid
    -Wl,--wrap=log
    -Wl,--wrap=log2
    -Wl,--wrap=log2f
    -Wl,--wrap=logf
    -Wl,--wrap=pow
    -Wl,--wrap=powf
  )
  endif()

  if(NOT ABI STREQUAL "musl")
    target_link_options(${bun} PUBLIC
      -static-libstdc++
      -static-libgcc
    )
  else()
    target_link_options(${bun} PUBLIC
      -lstdc++
      -lgcc
    )
  endif()

  if (ENABLE_LTO)
    # We are optimizing for size at a slight debug-ability cost
    target_link_options(${bun} PUBLIC
      -Wl,--no-eh-frame-hdr
    )
  else()
    target_link_options(${bun} PUBLIC
      -Wl,--eh-frame-hdr
    )
  endif()

  target_link_options(${bun} PUBLIC
    --ld-path=${LLD_PROGRAM}
    -fno-pic
    -Wl,-no-pie
    -Wl,--as-needed
    -Wl,-z,stack-size=12800000
    -Wl,--compress-debug-sections=zlib
    -Wl,-z,lazy
    -Wl,-z,norelro
    # enable string tail merging
    -Wl,-O2
    # make debug info faster to load
    -Wl,--gdb-index
    -Wl,-z,combreloc
    -Wl,--sort-section=name
    -Wl,--hash-style=both
    -Wl,--build-id=sha1  # Better for debugging than default
  )

  # don't strip in debug, this seems to be needed so that the Zig std library
  # `*dbHelper` DWARF symbols (used by LLDB for pretty printing) are in the
  # output executable
  if(NOT DEBUG)
    target_link_options(${bun} PUBLIC
      -Wl,--gc-sections
    )
  endif()

  if (NOT DEBUG AND NOT ENABLE_ASAN AND NOT ENABLE_VALGRIND)
    target_link_options(${bun} PUBLIC
      -Wl,-icf=safe
      -Wl,-Map=${bun}.linker-map
    )
  endif()

endif()

# --- Symbols list ---

if(WIN32)
  set(BUN_SYMBOLS_PATH ${CWD}/src/symbols.def)
  target_link_options(${bun} PUBLIC /DEF:${BUN_SYMBOLS_PATH})
elseif(APPLE)

  set(BUN_SYMBOLS_PATH ${CWD}/src/symbols.txt)
  target_link_options(${bun} PUBLIC -exported_symbols_list ${BUN_SYMBOLS_PATH})
else()
  set(BUN_SYMBOLS_PATH ${CWD}/src/symbols.dyn)
  set(BUN_LINKER_LDS_PATH ${CWD}/src/linker.lds)
  target_link_options(${bun} PUBLIC
    -Bsymbolics-functions
    -rdynamic
    -Wl,--dynamic-list=${BUN_SYMBOLS_PATH}
    -Wl,--version-script=${BUN_LINKER_LDS_PATH}
  )
  set_target_properties(${bun} PROPERTIES LINK_DEPENDS ${BUN_LINKER_LDS_PATH})
endif()

set_target_properties(${bun} PROPERTIES LINK_DEPENDS ${BUN_SYMBOLS_PATH})

# --- WebKit ---

include(SetupWebKit)

if(BUN_LINK_ONLY)
  register_command(
    TARGET
      ${bun}
    TARGET_PHASE
      POST_BUILD
    COMMENT
      "Uploading link metadata"
    COMMAND
      ${CMAKE_COMMAND} -E env
        BUN_VERSION=${VERSION}
        WEBKIT_DOWNLOAD_URL=${WEBKIT_DOWNLOAD_URL}
        WEBKIT_VERSION=${WEBKIT_VERSION}
        ZIG_COMMIT=${ZIG_COMMIT}
        ${BUN_EXECUTABLE} ${BUN_FLAGS} ${CWD}/scripts/create-link-metadata.mjs ${BUILD_PATH} ${bun}
    SOURCES
      ${BUN_ZIG_OUTPUT}
      ${BUN_CPP_OUTPUT}
    ARTIFACTS
      ${BUILD_PATH}/link-metadata.json
  )
endif()

if(WIN32)
  if(DEBUG)
    target_link_libraries(${bun} PRIVATE
      ${WEBKIT_LIB_PATH}/WTF.lib
      ${WEBKIT_LIB_PATH}/JavaScriptCore.lib
      ${WEBKIT_LIB_PATH}/bmalloc.lib
      ${WEBKIT_LIB_PATH}/sicudtd.lib
      ${WEBKIT_LIB_PATH}/sicuind.lib
      ${WEBKIT_LIB_PATH}/sicuucd.lib
    )
  else()
    target_link_libraries(${bun} PRIVATE
      ${WEBKIT_LIB_PATH}/WTF.lib
      ${WEBKIT_LIB_PATH}/JavaScriptCore.lib
      ${WEBKIT_LIB_PATH}/bmalloc.lib
      ${WEBKIT_LIB_PATH}/sicudt.lib
      ${WEBKIT_LIB_PATH}/sicuin.lib
      ${WEBKIT_LIB_PATH}/sicuuc.lib
    )
  endif()
else()
  target_link_libraries(${bun} PRIVATE
    ${WEBKIT_LIB_PATH}/libWTF.a
    ${WEBKIT_LIB_PATH}/libJavaScriptCore.a
  )
  if(NOT APPLE OR EXISTS ${WEBKIT_LIB_PATH}/libbmalloc.a)
    target_link_libraries(${bun} PRIVATE ${WEBKIT_LIB_PATH}/libbmalloc.a)
  endif()
endif()

include_directories(${WEBKIT_INCLUDE_PATH})

# Include the generated dependency versions header
include_directories(${CMAKE_BINARY_DIR})

if(NOT WEBKIT_LOCAL AND NOT APPLE)
  include_directories(${WEBKIT_INCLUDE_PATH}/wtf/unicode)
endif()

# --- Dependencies ---

if(WIN32)
  list(APPEND BUN_DEPENDENCIES Libuv)
endif()

if(USE_STATIC_SQLITE)
  list(APPEND BUN_DEPENDENCIES SQLite)
endif()

foreach(dependency ${BUN_DEPENDENCIES})
  include(Build${dependency})
endforeach()

list(TRANSFORM BUN_DEPENDENCIES TOLOWER OUTPUT_VARIABLE BUN_TARGETS)
add_custom_target(dependencies DEPENDS ${BUN_TARGETS})

if(APPLE)
  target_link_libraries(${bun} PRIVATE icucore resolv)
  target_compile_definitions(${bun} PRIVATE U_DISABLE_RENAMING=1)
endif()

if(USE_STATIC_SQLITE)
  target_compile_definitions(${bun} PRIVATE LAZY_LOAD_SQLITE=0)
else()
  target_compile_definitions(${bun} PRIVATE LAZY_LOAD_SQLITE=1)
endif()

if(LINUX)
  target_link_libraries(${bun} PRIVATE c pthread dl)

  if(USE_STATIC_LIBATOMIC)
    target_link_libraries(${bun} PRIVATE libatomic.a)
  else()
    target_link_libraries(${bun} PUBLIC libatomic.so)
  endif()

  target_link_libraries(${bun} PRIVATE ${WEBKIT_LIB_PATH}/libicudata.a)
  target_link_libraries(${bun} PRIVATE ${WEBKIT_LIB_PATH}/libicui18n.a)
  target_link_libraries(${bun} PRIVATE ${WEBKIT_LIB_PATH}/libicuuc.a)
endif()

if(WIN32)
  target_link_libraries(${bun} PRIVATE
    winmm
    bcrypt
    ntdll
    userenv
    dbghelp
    crypt32
    wsock32 # ws2_32 required by TransmitFile aka sendfile on windows
    delayimp.lib
  )
  # Required for static ICU linkage - without this, ICU headers expect DLL linkage
  # which causes ABI mismatch and crashes (STATUS_STACK_BUFFER_OVERRUN)
  target_compile_definitions(${bun} PRIVATE U_STATIC_IMPLEMENTATION)
endif()

# --- Packaging ---

if(NOT BUN_CPP_ONLY)
  set(CMAKE_STRIP_FLAGS "")
  if(APPLE)
    # We do not build with exceptions enabled. These are generated by lolhtml
    # and other dependencies. We build lolhtml with abort on panic, so it
    # shouldn't be including these in the first place.
    set(CMAKE_STRIP_FLAGS --remove-section=__TEXT,__eh_frame --remove-section=__TEXT,__unwind_info --remove-section=__TEXT,__gcc_except_tab)
  elseif(LINUX AND NOT ABI STREQUAL "musl")
    # When you use llvm-strip to do this, it doesn't delete it from the binary and instead keeps it as [LOAD #2 [R]]
    # So, we must use GNU strip to do this.
    set(CMAKE_STRIP_FLAGS -R .eh_frame -R .gcc_except_table)
  endif()

  if(bunStrip)
    # First, strip bun-profile.exe to create bun.exe
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
          ${CMAKE_STRIP_FLAGS}
          --strip-all
          --strip-debug
          --discard-all
          -o ${bunStripExe}
      CWD
        ${BUILD_PATH}
      OUTPUTS
        ${BUILD_PATH}/${bunStripExe}
    )

    # Then sign both executables on Windows
    if(WIN32 AND ENABLE_WINDOWS_CODESIGNING)
      set(SIGN_SCRIPT "${CMAKE_SOURCE_DIR}/.buildkite/scripts/sign-windows.ps1")

      # Verify signing script exists
      if(NOT EXISTS "${SIGN_SCRIPT}")
        message(FATAL_ERROR "Windows signing script not found: ${SIGN_SCRIPT}")
      endif()

      # Use PowerShell for Windows code signing (native Windows, no path issues)
      find_program(POWERSHELL_EXECUTABLE
        NAMES pwsh.exe powershell.exe
        PATHS
          "C:/Program Files/PowerShell/7"
          "C:/Program Files (x86)/PowerShell/7"
          "C:/Windows/System32/WindowsPowerShell/v1.0"
        DOC "Path to PowerShell executable"
      )

      if(NOT POWERSHELL_EXECUTABLE)
        set(POWERSHELL_EXECUTABLE "powershell.exe")
      endif()

      message(STATUS "Using PowerShell executable: ${POWERSHELL_EXECUTABLE}")

      # Sign both bun-profile.exe and bun.exe after stripping
      register_command(
        TARGET
          ${bun}
        TARGET_PHASE
          POST_BUILD
        COMMENT
          "Code signing bun-profile.exe and bun.exe with DigiCert KeyLocker"
        COMMAND
          "${POWERSHELL_EXECUTABLE}" "-NoProfile" "-ExecutionPolicy" "Bypass" "-File" "${SIGN_SCRIPT}" "-BunProfileExe" "${BUILD_PATH}/${bunExe}" "-BunExe" "${BUILD_PATH}/${bunStripExe}"
        CWD
          ${CMAKE_SOURCE_DIR}
        SOURCES
          ${BUILD_PATH}/${bunStripExe}
      )
    endif()
  endif()

  # somehow on some Linux systems we need to disable ASLR for ASAN-instrumented binaries to run
  # when spawned by cmake (they run fine from a shell!)
  # otherwise they crash with:
  # ==856230==Shadow memory range interleaves with an existing memory mapping. ASan cannot proceed correctly. ABORTING.
  # ==856230==ASan shadow was supposed to be located in the [0x00007fff7000-0x10007fff7fff] range.
  # ==856230==This might be related to ELF_ET_DYN_BASE change in Linux 4.12.
  # ==856230==See https://github.com/google/sanitizers/issues/856 for possible workarounds.
  # the linked issue refers to very old kernels but this still happens to us on modern ones.
  # disabling ASLR to run the binary works around it
  set(TEST_BUN_COMMAND_BASE ${BUILD_PATH}/${bunExe} --revision)
  set(TEST_BUN_COMMAND_ENV_WRAP
    ${CMAKE_COMMAND} -E env BUN_DEBUG_QUIET_LOGS=1)
  if (LINUX AND ENABLE_ASAN)
    set(TEST_BUN_COMMAND
      ${TEST_BUN_COMMAND_ENV_WRAP} setarch ${CMAKE_HOST_SYSTEM_PROCESSOR} -R ${TEST_BUN_COMMAND_BASE}
      || ${TEST_BUN_COMMAND_ENV_WRAP} ${TEST_BUN_COMMAND_BASE})
  else()
    set(TEST_BUN_COMMAND
      ${TEST_BUN_COMMAND_ENV_WRAP} ${TEST_BUN_COMMAND_BASE})
  endif()

  register_command(
    TARGET
      ${bun}
    TARGET_PHASE
      POST_BUILD
    COMMENT
      "Testing ${bun}"
    COMMAND
      ${TEST_BUN_COMMAND}
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
      ARTIFACTS
        ${BUILD_PATH}/features.json
    )
  endif()

  if(CMAKE_HOST_APPLE AND bunStrip)
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
    set(bunTriplet bun-${OS}-${ARCH})
    if(LINUX AND ABI STREQUAL "musl")
      set(bunTriplet ${bunTriplet}-musl)
    endif()
    if(ENABLE_BASELINE)
      set(bunTriplet ${bunTriplet}-baseline)
    endif()

    if (ENABLE_ASAN AND ENABLE_VALGRIND)
      set(bunTriplet ${bunTriplet}-asan-valgrind)
      set(bunPath ${bunTriplet})
    elseif (ENABLE_VALGRIND)
      set(bunTriplet ${bunTriplet}-valgrind)
      set(bunPath ${bunTriplet})
    elseif(ENABLE_ASAN)
      set(bunTriplet ${bunTriplet}-asan)
      set(bunPath ${bunTriplet})
    else()
      string(REPLACE bun ${bunTriplet} bunPath ${bun})
    endif()

    set(bunFiles ${bunExe} features.json)
    if(WIN32)
      list(APPEND bunFiles ${bun}.pdb)
    elseif(APPLE)
      list(APPEND bunFiles ${bun}.dSYM)
    endif()

    if((APPLE OR LINUX) AND NOT ENABLE_ASAN)
      list(APPEND bunFiles ${bun}.linker-map)
    endif()


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
        && ${CMAKE_COMMAND} -E copy ${bunFiles} ${bunPath}
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
endif()
