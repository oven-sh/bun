# Clang Static Analyzer (scan-build) integration
# https://clang-analyzer.llvm.org/

# Find scan-build binary
find_program(SCAN_BUILD_PROGRAM
  NAMES scan-build scan-build-19 scan-build-18 scan-build-17
  HINTS /usr/lib/llvm-19/bin /usr/lib/llvm-18/bin /usr/lib/llvm-17/bin
  DOC "Path to scan-build binary"
)

if(NOT SCAN_BUILD_PROGRAM)
  message(WARNING "scan-build not found. Clang Static Analyzer targets will not be available.")
  return()
endif()

# Create output directory for scan-build reports
set(SCAN_BUILD_OUTPUT_DIR ${BUILD_PATH}/scan-build-reports)
file(MAKE_DIRECTORY ${SCAN_BUILD_OUTPUT_DIR})

# Configure scan-build command
set(SCAN_BUILD_COMMAND ${SCAN_BUILD_PROGRAM}
  -o ${SCAN_BUILD_OUTPUT_DIR}
  --html-title "Bun Static Analysis Report"
  --keep-going
  --use-analyzer ${CMAKE_CXX_COMPILER}
  -enable-checker core
  -enable-checker cplusplus
  -enable-checker deadcode
  -enable-checker nullability
  -enable-checker security
  -enable-checker unix
  -disable-checker webkit
  -disable-checker alpha
)

# Add verbose output if requested
if(CMAKE_VERBOSE_MAKEFILE)
  list(APPEND SCAN_BUILD_COMMAND -v)
endif()

register_command(
  TARGET
    scan-build
  COMMENT
    "Running clang static analyzer (scan-build)"
  COMMAND
    ${CMAKE_COMMAND} -E remove_directory ${SCAN_BUILD_OUTPUT_DIR}
  COMMAND
    ${CMAKE_COMMAND} -E make_directory ${SCAN_BUILD_OUTPUT_DIR}
  COMMAND
    ${SCAN_BUILD_COMMAND}
      ${CMAKE_COMMAND} --build ${BUILD_PATH} --target bun-debug --parallel ${CMAKE_BUILD_PARALLEL_LEVEL}
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)

register_command(
  TARGET
    scan-build-view
  COMMENT
    "Open scan-build results in browser"
  COMMAND
    ${CMAKE_COMMAND} -E echo "Opening scan-build report..."
  COMMAND
    python3 -c "import webbrowser; import os; import glob; reports = glob.glob('${SCAN_BUILD_OUTPUT_DIR}/*/index.html'); webbrowser.open('file://' + os.path.abspath(reports[-1]) if reports else 'file://' + os.path.abspath('${SCAN_BUILD_OUTPUT_DIR}'))"
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)

# Lightweight scan-build for core files only
register_command(
  TARGET
    scan-build-core
  COMMENT
    "Running clang static analyzer on core Bun files only"
  COMMAND
    ${CMAKE_COMMAND} -E remove_directory ${SCAN_BUILD_OUTPUT_DIR}-core
  COMMAND
    ${CMAKE_COMMAND} -E make_directory ${SCAN_BUILD_OUTPUT_DIR}-core
  COMMAND
    ${SCAN_BUILD_PROGRAM}
      -o ${SCAN_BUILD_OUTPUT_DIR}-core
      --html-title "Bun Core Static Analysis Report"
      --keep-going
      --use-analyzer ${CMAKE_CXX_COMPILER}
      -enable-checker core
      -enable-checker cplusplus.NewDeleteLeaks
      -enable-checker deadcode.DeadStores
      -enable-checker security.insecureAPI
      ${CMAKE_COMMAND} --build ${BUILD_PATH} --target clone-zlib --parallel ${CMAKE_BUILD_PARALLEL_LEVEL}
  CWD
    ${BUILD_PATH}
  ALWAYS_RUN
)

message(STATUS "Clang Static Analyzer (scan-build) integration enabled")
message(STATUS "  scan-build: ${SCAN_BUILD_PROGRAM}")
message(STATUS "  Output: ${SCAN_BUILD_OUTPUT_DIR}")