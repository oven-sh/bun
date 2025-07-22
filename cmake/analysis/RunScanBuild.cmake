# https://clang-analyzer.llvm.org/scan-build

set(SCAN_BUILD_SOURCES ${BUN_C_SOURCES} ${BUN_CXX_SOURCES})

find_llvm_command_no_version(SCAN_BUILD_PROGRAM scan-build)

set(SCAN_BUILD_COMMAND ${SCAN_BUILD_PROGRAM}
  -o ${BUILD_PATH}/scan-build-results
  --use-analyzer=${CMAKE_CXX_COMPILER}
  --status-bugs
  --html-title="Bun Static Analysis Report"
)

# Enable specific analyzers
list(APPEND SCAN_BUILD_COMMAND
  -enable-checker alpha.core.BoolAssignment
  -enable-checker alpha.core.CastSize  
  -enable-checker alpha.core.CastToStruct
  -enable-checker alpha.core.FixedAddr
  -enable-checker alpha.core.PointerArithm
  -enable-checker alpha.core.PointerSub
  -enable-checker alpha.core.SizeofPtr
  -enable-checker alpha.core.TestAfterDivZero
  -enable-checker alpha.deadcode.UnreachableCode
  -enable-checker alpha.security.ArrayBound
  -enable-checker alpha.security.MallocOverflow
  -enable-checker alpha.security.ReturnPtrRange
  -enable-checker alpha.unix.SimpleStream
  -enable-checker alpha.unix.Stream
  -enable-checker alpha.unix.cstring.BufferOverlap
  -enable-checker alpha.unix.cstring.NotNullTerminated
  -enable-checker alpha.unix.cstring.OutOfBounds
)

if(CMAKE_COLOR_DIAGNOSTICS)
  list(APPEND SCAN_BUILD_COMMAND --use-color)
endif()

# Clean previous results
register_command(
  TARGET
    scan-build-clean
  COMMENT
    "Cleaning scan-build results"
  COMMAND
    ${CMAKE_COMMAND} -E rm -rf ${BUILD_PATH}/scan-build-results
  ALWAYS_RUN
)

# Run scan-build on the entire project
register_command(
  TARGET
    scan-build
  COMMENT
    "Running scan-build static analyzer"
  COMMAND
    ${SCAN_BUILD_COMMAND}
      ${CMAKE_COMMAND} --build ${BUILD_PATH} --target bun
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
  DEPENDS
    scan-build-clean
)

# Run scan-build with verbose output
register_command(
  TARGET
    scan-build-verbose
  COMMENT
    "Running scan-build static analyzer (verbose)"
  COMMAND
    ${SCAN_BUILD_COMMAND}
      -v
      -V
      ${CMAKE_COMMAND} --build ${BUILD_PATH} --target bun
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
  DEPENDS
    scan-build-clean
)