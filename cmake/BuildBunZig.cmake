parse_option(ZIG_OBJECT_PATH FILEPATH "Path to the Zig object file" ${BUILD_PATH}/bun-zig.o)

# To use LLVM bitcode from Zig, more work needs to be done. Currently, an install of
# LLVM 18.1.7 does not compatible with what bitcode Zig 0.13 outputs (has LLVM 18.1.7)
# Change to "bc" to experiment, "Invalid record" means it is not valid output.
parse_option(ZIG_OBJECT_FORMAT "obj|bc" "Output file format for Zig object files" obj)

# TODO: if ZIG_OBJECT_PATH does not end with "bun-zig.o", we need to rename it
get_filename_component(ZIG_OBJECT_PARENT_PATH ${ZIG_OBJECT_PATH} DIRECTORY)

# TODO: src/deps/zig/*.zig files are currently included, but should be excluded
file(GLOB_RECURSE BUN_ZIG_OBJECT_SOURCES 
  ${CONFIGURE_DEPENDS}
  ${CWD}/src/*.zig
)

list(APPEND BUN_ZIG_OBJECT_SOURCES
  build.zig
  root.zig
  root_wasm.zig
)

# TODO: change build.zig to support ON/OFF as a boolean argument
if(ENABLE_LOGS)
  set(ZIG_ENABLE_LOGS "true")
else()
  set(ZIG_ENABLE_LOGS "false")
endif()

set(USES_TERMINAL_NOT_IN_CI "")
if(NOT CI)
  set(USES_TERMINAL_NOT_IN_CI "USES_TERMINAL")
endif()

add_custom_command(
  COMMENT
    "Building Zig object"
  WORKING_DIRECTORY
    ${CWD}
  VERBATIM COMMAND
    ${CMAKE_ZIG_COMPILER}
      build obj
      ${CMAKE_ZIG_FLAGS}
      --prefix ${ZIG_OBJECT_PARENT_PATH}
      -Dobj_format=${ZIG_OBJECT_FORMAT}
      -Dtarget=${ZIG_TARGET}
      -Doptimize=${ZIG_OPTIMIZE}
      -Dcpu=${CPU}
      -Denable_logs=${ZIG_ENABLE_LOGS}
      -Dversion=${VERSION}
      -Dsha=${REVISION}
      -Dreported_nodejs_version=${NODEJS_VERSION}
      -Dcanary=${CANARY_REVISION}
      -Dgenerated-code=${CODEGEN_PATH}
  OUTPUT
    ${ZIG_OBJECT_PATH}
  MAIN_DEPENDENCY
    ${CWD}/build.zig
  DEPENDS
    ${BUN_ZIG_OBJECT_SOURCES}
    ${BUN_ZIG_IDENTIFIER_OUTPUTS}
    ${BUN_ERROR_OUTPUTS}
    ${BUN_FALLBACK_DECODER_OUTPUT}
    ${BUN_RUNTIME_JS_OUTPUT}
    ${BUN_NODE_FALLBACKS_OUTPUTS}
    ${BUN_ERROR_CODE_OUTPUTS}
    ${BUN_ZIG_GENERATED_CLASSES_OUTPUTS}
    ${BUN_JAVASCRIPT_OUTPUTS}
    clone-zig
  ${USES_TERMINAL_NOT_IN_CI}
)

add_custom_target(zig DEPENDS ${ZIG_OBJECT_PATH})
