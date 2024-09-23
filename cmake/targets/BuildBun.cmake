# register_target(bun)
set(bun bun)

# Some commands use this path, and some do not.
# In the future, change those commands so that generated files are written to this path.
optionx(CODEGEN_PATH FILEPATH "Path to the codegen directory" DEFAULT ${BUILD_PATH}/codegen)

if((NOT DEFINED CONFIGURE_DEPENDS AND NOT CI) OR CONFIGURE_DEPENDS)
  set(CONFIGURE_DEPENDS "CONFIGURE_DEPENDS")
else()
  set(CONFIGURE_DEPENDS "")
endif()

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
    ${bun}-identifier-data
  COMMENT
    "Generating src/js_lexer/*.blob"
  COMMAND
    ${ZIG_EXECUTABLE}
      run
      ${CMAKE_ZIG_FLAGS}
      ${BUN_ZIG_IDENTIFIER_SCRIPT}
  SOURCES
    ${BUN_ZIG_IDENTIFIER_SOURCES}
  OUTPUTS
    ${BUN_ZIG_IDENTIFIER_OUTPUTS}
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
    ${bun}-error
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
    ${bun}-fallback-decoder
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
    ${bun}-runtime-js
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
    ${bun}-node-fallbacks
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
    ${bun}-error-code
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
    ${bun}-zig-generated-classes
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
    ${bun}-js-modules
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

set(BUN_KIT_RUNTIME_CODEGEN_SCRIPT ${CWD}/src/codegen/kit-codegen.ts)

file(GLOB_RECURSE BUN_KIT_RUNTIME_SOURCES ${CONFIGURE_DEPENDS}
  ${CWD}/src/kit/*.ts
  ${CWD}/src/kit/*/*.ts
)

list(APPEND BUN_KIT_RUNTIME_CODEGEN_SOURCES
  ${CWD}/src/bun.js/bindings/InternalModuleRegistry.cpp
)

set(BUN_KIT_RUNTIME_OUTPUTS
  ${CODEGEN_PATH}/kit_empty_file
  ${CODEGEN_PATH}/kit.client.js
  ${CODEGEN_PATH}/kit.server.js
)

register_command(
  TARGET
    ${bun}-kit-codegen
  COMMENT
    "Bundling Kit Runtime"
  COMMAND
    ${BUN_EXECUTABLE}
      run
      ${BUN_KIT_RUNTIME_CODEGEN_SCRIPT}
        --debug=${DEBUG}
        --codegen_root=${CODEGEN_PATH}
  SOURCES
    ${BUN_KIT_RUNTIME_SOURCES}
    ${BUN_KIT_RUNTIME_CODEGEN_SOURCES}
    ${BUN_KIT_RUNTIME_CODEGEN_SCRIPT}
  OUTPUTS
    ${BUN_KIT_RUNTIME_OUTPUTS}
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
    ${bun}-js-sink
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
      ${bun}-codegen-lut-${filename}
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
  ${CWD}/src/*.zig
)

list(APPEND BUN_ZIG_SOURCES
  ${CWD}/build.zig
  ${CWD}/root.zig
  ${CWD}/root_wasm.zig
)

set(BUN_ZIG_GENERATED_SOURCES
  ${BUN_ZIG_IDENTIFIER_OUTPUTS}
  ${BUN_ERROR_OUTPUTS}
  ${BUN_FALLBACK_DECODER_OUTPUT}
  ${BUN_RUNTIME_JS_OUTPUT}
  ${BUN_NODE_FALLBACKS_OUTPUTS}
  ${BUN_ERROR_CODE_OUTPUTS}
  ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
  ${BUN_JAVASCRIPT_OUTPUTS}
)

# In debug builds, these are not embedded, but rather referenced at runtime.
if (DEBUG)
  list(APPEND BUN_ZIG_GENERATED_SOURCES ${CODEGEN_PATH}/kit_empty_file)
else()
  list(APPEND BUN_ZIG_GENERATED_SOURCES ${BUN_KIT_RUNTIME_OUTPUTS})
endif()

set(BUN_ZIG_OUTPUT ${BUILD_PATH}/bun-zig.o)

if(CMAKE_SYSTEM_PROCESSOR MATCHES "arm|ARM|arm64|ARM64|aarch64|AARCH64")
  if(APPLE)
    set(ZIG_CPU "apple_m1")
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

register_command(
  TARGET
    ${bun}-zig
  GROUP
    console
  COMMENT
    "Building src/*.zig for ${ZIG_TARGET}"
  COMMAND
    ${ZIG_EXECUTABLE}
      build obj
      ${CMAKE_ZIG_FLAGS}
      --prefix ${BUILD_PATH}
      -Dobj_format=${ZIG_OBJECT_FORMAT}
      -Dtarget=${ZIG_TARGET}
      -Doptimize=${ZIG_OPTIMIZE}
      -Dcpu=${ZIG_CPU}
      -Denable_logs=$<IF:$<BOOL:${ENABLE_LOGS}>,true,false>
      -Dversion=${VERSION}
      -Dsha=${REVISION}
      -Dreported_nodejs_version=${NODEJS_VERSION}
      -Dcanary=${CANARY_REVISION}
      -Dgenerated-code=${CODEGEN_PATH}
  ARTIFACTS
    ${BUN_ZIG_OUTPUT}
  SOURCES
    ${BUN_ZIG_SOURCES}
    ${BUN_ZIG_GENERATED_SOURCES}
)

set_property(TARGET ${bun}-zig PROPERTY JOB_POOL compile_pool)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "build.zig")

# --- C/C++ Object ---

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
  ${CWD}/src/kit/*.cpp
  ${CWD}/src/deps/*.cpp
  ${BUN_USOCKETS_SOURCE}/src/crypto/*.cpp
)

file(GLOB BUN_C_SOURCES ${CONFIGURE_DEPENDS}
  ${BUN_USOCKETS_SOURCE}/src/*.c
  ${BUN_USOCKETS_SOURCE}/src/eventing/*.c
  ${BUN_USOCKETS_SOURCE}/src/internal/*.c
  ${BUN_USOCKETS_SOURCE}/src/crypto/*.c
)

list(APPEND BUN_C_SOURCES ${VENDOR_PATH}/picohttpparser/picohttpparser.c)

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

add_library(${bun}-cpp STATIC ${BUN_CPP_SOURCES})

set_target_properties(${bun}-cpp PROPERTIES
  OUTPUT_NAME ${bun}
  CXX_STANDARD 20
  CXX_STANDARD_REQUIRED YES
  CXX_EXTENSIONS YES
  CXX_VISIBILITY_PRESET hidden
  C_STANDARD 17
  C_STANDARD_REQUIRED YES
  VISIBILITY_INLINES_HIDDEN YES
)

set(BUN_CPP_OUTPUT ${BUILD_PATH}/${CMAKE_STATIC_LIBRARY_PREFIX}${bun}${CMAKE_STATIC_LIBRARY_SUFFIX})

# --- C/C++ Includes ---

register_includes(
  ${CWD}/packages
  ${CWD}/packages/bun-usockets
  ${CWD}/packages/bun-usockets/src
  ${CWD}/src/bun.js/bindings
  ${CWD}/src/bun.js/bindings/webcore
  ${CWD}/src/bun.js/bindings/webcrypto
  ${CWD}/src/bun.js/bindings/sqlite
  ${CWD}/src/bun.js/modules
  ${CWD}/src/js/builtins
  ${CWD}/src/napi
  ${CWD}/src/deps
  ${CWD}/src/bun.js/bindings/windows ${WIN32}
  ${CODEGEN_PATH}
  TARGET ${bun}-cpp
)

# --- C/C++ Definitions ---

if(ENABLE_ASSERTIONS)
  register_compiler_definitions(
    TARGET ${bun}-cpp
    DESCRIPTION "Enable bun assertions"
    ASSERT_ENABLED=1
  )
endif()

if(DEBUG)
  register_compiler_definitions(
    TARGET ${bun}-cpp
    DESCRIPTION "Enable bun assertions in debug builds"
    BUN_DEBUG=1
  )
endif()

if(WIN32)
  register_compiler_definitions(
    TARGET ${bun}-cpp
    WIN32
    _WINDOWS
    WIN32_LEAN_AND_MEAN=1
    _CRT_SECURE_NO_WARNINGS
    BORINGSSL_NO_CXX=1 # lol
  )
endif()

register_compiler_definitions(
  TARGET ${bun}-cpp
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
  register_compiler_definitions(
    TARGET ${bun}-cpp
    BUN_DYNAMIC_JS_LOAD_PATH=\"${BUILD_PATH}/js\"    
  )
endif()

# --- Compiler options ---

if(NOT WIN32)
  register_compiler_flags(
    TARGET ${bun}-cpp
    -fconstexpr-steps=2542484
    -fconstexpr-depth=54
    -fno-pic
    -fno-pie
    -faddrsig
  )
  if(DEBUG)
    register_compiler_flags(
      TARGET ${bun}-cpp
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
      -Wno-nullability-completeness
      -Werror
      -fsanitize=null
      -fsanitize-recover=all
      -fsanitize=bounds
      -fsanitize=return
      -fsanitize=nullability-arg
      -fsanitize=nullability-assign
      -fsanitize=nullability-return
      -fsanitize=returns-nonnull-attribute
      -fsanitize=unreachable
    )
  else()
    # Leave -Werror=unused off in release builds so we avoid errors from being used in ASSERT
    register_compiler_flags(
      TARGET ${bun}-cpp
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
      -Wno-nullability-completeness
      -Werror
    )
  endif()
endif()

# --- Dependencies ---

register_includes(
  TARGET ${bun}-cpp
  ${VENDOR_PATH}/${picohttpparser}
  ${VENDOR_PATH}/${boringssl}/include
  ${VENDOR_PATH}/${brotli}/c/include
  ${VENDOR_PATH}/${cares}/include
  ${VENDOR_PATH}/${libarchive}/include
  ${VENDOR_PATH}/${libdeflate}
  ${VENDOR_PATH}/${libuv}/include ${WIN32}
  ${VENDOR_PATH}/${lshpack}
  ${VENDOR_PATH}/${lshpack}/compat/queue ${WIN32}
  ${VENDOR_PATH}/${mimalloc}/include
  ${VENDOR_PATH}/${zlib}
)

if(WEBKIT_LOCAL)
  register_includes(
    TARGET ${bun}-cpp
    ${WEBKIT_PATH}
    ${WEBKIT_PATH}/JavaScriptCore/Headers/JavaScriptCore
    ${WEBKIT_PATH}/JavaScriptCore/PrivateHeaders
    ${WEBKIT_PATH}/bmalloc/Headers
    ${WEBKIT_PATH}/WTF/Headers
  )
else()
  register_includes(
    TARGET ${bun}-cpp
    ${WEBKIT_PATH}/include
    ${WEBKIT_PATH}/include/wtf/unicode NOT ${APPLE}
  )
endif()

if(USE_STATIC_SQLITE)
  target_compile_definitions(${bun}-cpp PRIVATE LAZY_LOAD_SQLITE=0)
else()
  target_compile_definitions(${bun}-cpp PRIVATE LAZY_LOAD_SQLITE=1)
endif()

add_dependencies(${bun}-cpp clone-webkit)

# --- Executable ---

file(GENERATE OUTPUT ${CODEGEN_PATH}/bun.h CONTENT "# Empty file")

add_executable(${bun}-exe ${CODEGEN_PATH}/bun.h)

set(BUN_EXE_OUTPUT ${BUILD_PATH}/${CMAKE_EXECUTABLE_PREFIX}${bun}${CMAKE_EXECUTABLE_SUFFIX})

set_target_properties(${bun}-exe PROPERTIES
  OUTPUT_NAME ${bun}
  LINKER_LANGUAGE CXX
)

target_link_options(${bun}-exe PRIVATE -fsanitize=null)

target_link_libraries(${bun}-exe PRIVATE
  ${BUN_CPP_OUTPUT}
  ${BUN_ZIG_OUTPUT}
)

link_targets(
  TARGET ${bun}-exe
  ${boringssl}
  ${brotli}
  ${cares}
  ${libarchive}
  ${libdeflate}
  ${libuv} ${WIN32}
  ${lolhtml}
  ${lshpack}
  ${mimalloc}
  ${tinycc}
  ${sqlite} ${USE_STATIC_SQLITE}
  ${webkit}
  ${zlib}
  ${zstd}
)

if(APPLE)
  target_link_libraries(${bun}-exe PRIVATE icucore resolv)
endif()

if(LINUX)
  target_link_libraries(${bun}-exe PRIVATE c pthread dl)

  if(USE_STATIC_LIBATOMIC)
    target_link_libraries(${bun}-exe PRIVATE libatomic.a)
  else()
    target_link_libraries(${bun}-exe PUBLIC libatomic.so)
  endif()

  if(USE_SYSTEM_ICU)
    target_link_libraries(${bun}-exe PRIVATE libicudata.a)
    target_link_libraries(${bun}-exe PRIVATE libicui18n.a)
    target_link_libraries(${bun}-exe PRIVATE libicuuc.a)
  else()
    target_link_libraries(${bun}-exe PRIVATE ${WEBKIT_LIB_PATH}/libicudata.a)
    target_link_libraries(${bun}-exe PRIVATE ${WEBKIT_LIB_PATH}/libicui18n.a)
    target_link_libraries(${bun}-exe PRIVATE ${WEBKIT_LIB_PATH}/libicuuc.a)
  endif()
endif()

if(WIN32)
  target_link_libraries(${bun}-exe PRIVATE
    winmm
    bcrypt
    ntdll
    userenv
    dbghelp
    wsock32 # ws2_32 required by TransmitFile aka sendfile on windows
    delayimp.lib
  )
endif()

# --- Linker options ---

if(WIN32)
  register_linker_flags(
    TARGET ${bun}-exe
    /STACK:0x1200000,0x100000
    /errorlimit:0
  )
  if(RELEASE)
    register_linker_flags(
      TARGET ${bun}-exe
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
    )
  endif()
elseif(APPLE)
  register_linker_flags(
    TARGET ${bun}-exe
    -dead_strip
    -dead_strip_dylibs
    -Wl,-stack_size,0x1200000
    -fno-keep-static-consts
  )
else()
  register_linker_flags(
    TARGET ${bun}-exe
    -fuse-ld=lld-${LLVM_VERSION_MAJOR}
    -fno-pic
    -static-libstdc++
    -static-libgcc
    -Wl,-no-pie
    -Wl,-icf=safe
    -Wl,--as-needed
    -Wl,--gc-sections
    -Wl,-z,stack-size=12800000
    -Wl,--wrap=fcntl
    -Wl,--wrap=fcntl64
    -Wl,--wrap=stat64
    -Wl,--wrap=pow
    -Wl,--wrap=exp
    -Wl,--wrap=expf
    -Wl,--wrap=log
    -Wl,--wrap=log2
    -Wl,--wrap=lstat
    -Wl,--wrap=stat64
    -Wl,--wrap=stat
    -Wl,--wrap=fstat
    -Wl,--wrap=fstatat
    -Wl,--wrap=lstat64
    -Wl,--wrap=fstat64
    -Wl,--wrap=fstatat64
    -Wl,--wrap=mknod
    -Wl,--wrap=mknodat
    -Wl,--wrap=statx
    -Wl,--wrap=fmod
    -Wl,--compress-debug-sections=zlib
    -Wl,-z,lazy
    -Wl,-z,norelro
  )
endif()

# --- Symbols list ---

if(WIN32)
  set(BUN_SYMBOLS_PATH ${CWD}/src/symbols.def)
  register_linker_flags(
    TARGET ${bun}-exe
    /DEF:${BUN_SYMBOLS_PATH}
  )
elseif(APPLE)
  set(BUN_SYMBOLS_PATH ${CWD}/src/symbols.txt)
  register_linker_flags(
    TARGET ${bun}-exe
    -exported_symbols_list ${BUN_SYMBOLS_PATH}
  )
else()
  set(BUN_SYMBOLS_PATH ${CWD}/src/symbols.dyn)
  set(BUN_LINKER_LDS_PATH ${CWD}/src/linker.lds)
  register_linker_flags(
    TARGET ${bun}-exe
    -Bsymbolics-functions
    -rdynamic
    -Wl,--dynamic-list=${BUN_SYMBOLS_PATH}
    -Wl,--version-script=${BUN_LINKER_LDS_PATH}
  )
  set_target_properties(${bun}-exe PROPERTIES LINK_DEPENDS ${BUN_LINKER_LDS_PATH})
endif()

set_target_properties(${bun}-exe PROPERTIES LINK_DEPENDS ${BUN_SYMBOLS_PATH})

register_command(
  TARGET
    ${bun}-exe
  TARGET_PHASE
    POST_BUILD
  COMMENT
    "Testing ${bun}"
  COMMAND
    ${CMAKE_COMMAND}
      -E env BUN_DEBUG_QUIET_LOGS=1
      ${BUN_EXE_OUTPUT}
        --revision
  CWD
    ${BUILD_PATH}
)

# --- Packaging ---

# register_command(
#   TARGET
#     ${bun}-strip
#   COMMENT
#     "Stripping ${bun}"
#   COMMAND
#     ${CMAKE_STRIP}
#       ${bunExe}
#       --strip-all
#       --strip-debug
#       --discard-all
#       -o ${bunStripExe}
#   CWD
#     ${BUILD_PATH}
#   OUTPUTS
#     ${BUILD_PATH}/${bunStripExe}
# )

# # if(NOT BUN_CPP_ONLY)
# #   if(bunStrip)
# #     register_command(
# #       TARGET
# #         ${bun}
# #       TARGET_PHASE
# #         POST_BUILD
# #       COMMENT
# #         "Stripping ${bun}"
# #       COMMAND
# #         ${CMAKE_STRIP}
# #           ${bunExe}
# #           --strip-all
# #           --strip-debug
# #           --discard-all
# #           -o ${bunStripExe}
# #       CWD
# #         ${BUILD_PATH}
# #       OUTPUTS
# #         ${BUILD_PATH}/${bunStripExe}
# #     )
# #   endif()

# #   register_command(
# #     TARGET
# #       ${bun}
# #     TARGET_PHASE
# #       POST_BUILD
# #     COMMENT
# #       "Testing ${bun}"
# #     COMMAND
# #       ${CMAKE_COMMAND}
# #       -E env BUN_DEBUG_QUIET_LOGS=1
# #       ${BUILD_PATH}/${bunExe}
# #         --revision
# #     CWD
# #       ${BUILD_PATH}
# #   )

# #   if(CI)
# #     set(BUN_FEATURES_SCRIPT ${CWD}/scripts/features.mjs)
# #     register_command(
# #       TARGET
# #         ${bun}
# #       TARGET_PHASE
# #         POST_BUILD
# #       COMMENT
# #         "Generating features.json"
# #       COMMAND
# #         ${CMAKE_COMMAND}
# #           -E env
# #             BUN_GARBAGE_COLLECTOR_LEVEL=1
# #             BUN_DEBUG_QUIET_LOGS=1
# #             BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING=1
# #           ${BUILD_PATH}/${bunExe}
# #           ${BUN_FEATURES_SCRIPT}
# #       CWD
# #         ${BUILD_PATH}
# #       ARTIFACTS
# #         ${BUILD_PATH}/features.json
# #     )
# #   endif()

# #   if(CMAKE_HOST_APPLE AND bunStrip)
# #     register_command(
# #       TARGET
# #         ${bun}
# #       TARGET_PHASE
# #         POST_BUILD
# #       COMMENT
# #         "Generating ${bun}.dSYM"
# #       COMMAND
# #         ${CMAKE_DSYMUTIL}
# #           ${bun}
# #           --flat
# #           --keep-function-for-static
# #           --object-prefix-map .=${CWD}
# #           -o ${bun}.dSYM
# #           -j ${CMAKE_BUILD_PARALLEL_LEVEL}
# #       CWD
# #         ${BUILD_PATH}
# #       OUTPUTS
# #         ${BUILD_PATH}/${bun}.dSYM
# #     )
# #   endif()

# #   if(CI)
# #     if(ENABLE_BASELINE)
# #       set(bunTriplet bun-${OS}-${ARCH}-baseline)
# #     else()
# #       set(bunTriplet bun-${OS}-${ARCH})
# #     endif()
# #     string(REPLACE bun ${bunTriplet} bunPath ${bun})
# #     set(bunFiles ${bunExe} features.json)
# #     if(WIN32)
# #       list(APPEND bunFiles ${bun}.pdb)
# #     elseif(APPLE)
# #       list(APPEND bunFiles ${bun}.dSYM)
# #     endif()
# #     register_command(
# #       TARGET
# #         ${bun}
# #       TARGET_PHASE
# #         POST_BUILD
# #       COMMENT
# #         "Generating ${bunPath}.zip"
# #       COMMAND
# #         ${CMAKE_COMMAND} -E rm -rf ${bunPath} ${bunPath}.zip
# #         && ${CMAKE_COMMAND} -E make_directory ${bunPath}
# #         && ${CMAKE_COMMAND} -E copy ${bunFiles} ${bunPath}
# #         && ${CMAKE_COMMAND} -E tar cfv ${bunPath}.zip --format=zip ${bunPath}
# #         && ${CMAKE_COMMAND} -E rm -rf ${bunPath}
# #       CWD
# #         ${BUILD_PATH}
# #       ARTIFACTS
# #         ${BUILD_PATH}/${bunPath}.zip
# #     )

# #     if(bunStrip)
# #       string(REPLACE bun ${bunTriplet} bunStripPath ${bunStrip})
# #       register_command(
# #         TARGET
# #           ${bun}
# #         TARGET_PHASE
# #           POST_BUILD
# #         COMMENT
# #           "Generating ${bunStripPath}.zip"
# #         COMMAND
# #           ${CMAKE_COMMAND} -E rm -rf ${bunStripPath} ${bunStripPath}.zip
# #           && ${CMAKE_COMMAND} -E make_directory ${bunStripPath}
# #           && ${CMAKE_COMMAND} -E copy ${bunStripExe} ${bunStripPath}
# #           && ${CMAKE_COMMAND} -E tar cfv ${bunStripPath}.zip --format=zip ${bunStripPath}
# #           && ${CMAKE_COMMAND} -E rm -rf ${bunStripPath}
# #         CWD
# #           ${BUILD_PATH}
# #         ARTIFACTS
# #           ${BUILD_PATH}/${bunStripPath}.zip
# #       )
# #     endif()
# #   endif()
# # endif()
