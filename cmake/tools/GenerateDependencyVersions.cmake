# GenerateDependencyVersions.cmake
# Generates a header file with all dependency versions

# Function to extract version from git tree object
function(get_git_tree_hash dep_name output_var)
  execute_process(
    COMMAND git rev-parse HEAD:./src/deps/${dep_name}
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    OUTPUT_VARIABLE commit_hash
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
    RESULT_VARIABLE result
  )
  if(result EQUAL 0 AND commit_hash)
    set(${output_var} "${commit_hash}" PARENT_SCOPE)
  else()
    set(${output_var} "unknown" PARENT_SCOPE)
  endif()
endfunction()

# Function to extract version from header file using regex
function(extract_version_from_header header_file regex_pattern output_var)
  if(EXISTS "${header_file}")
    file(STRINGS "${header_file}" version_line REGEX "${regex_pattern}")
    if(version_line)
      string(REGEX MATCH "${regex_pattern}" _match "${version_line}")
      if(CMAKE_MATCH_1)
        set(${output_var} "${CMAKE_MATCH_1}" PARENT_SCOPE)
      else()
        set(${output_var} "unknown" PARENT_SCOPE)
      endif()
    else()
      set(${output_var} "unknown" PARENT_SCOPE)
    endif()
  else()
    set(${output_var} "unknown" PARENT_SCOPE)
  endif()
endfunction()

# Main function to generate the header file
function(generate_dependency_versions_header)
  set(DEPS_PATH "${CMAKE_SOURCE_DIR}/src/deps")
  set(VENDOR_PATH "${CMAKE_SOURCE_DIR}/vendor")
  
  # Initialize version variables
  set(DEPENDENCY_VERSIONS "")
  
  # WebKit version (from SetupWebKit.cmake or command line)
  if(WEBKIT_VERSION)
    set(WEBKIT_VERSION_STR "${WEBKIT_VERSION}")
  else()
    set(WEBKIT_VERSION_STR "0ddf6f47af0a9782a354f61e06d7f83d097d9f84")
  endif()
  list(APPEND DEPENDENCY_VERSIONS "WEBKIT" "${WEBKIT_VERSION_STR}")
  
  # Track input files so CMake reconfigures when they change
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
    "${CMAKE_SOURCE_DIR}/package.json"
    "${VENDOR_PATH}/libdeflate/libdeflate.h"
    "${VENDOR_PATH}/zlib/zlib.h"
    "${DEPS_PATH}/zstd/lib/zstd.h"
  )
  
  # Hardcoded dependency versions (previously from generated_versions_list.zig)
  # These are the commit hashes/tree objects for each dependency
  list(APPEND DEPENDENCY_VERSIONS "BORINGSSL" "29a2cd359458c9384694b75456026e4b57e3e567")
  list(APPEND DEPENDENCY_VERSIONS "C_ARES" "d1722e6e8acaf10eb73fa995798a9cd421d9f85e")
  list(APPEND DEPENDENCY_VERSIONS "LIBARCHIVE" "898dc8319355b7e985f68a9819f182aaed61b53a")
  list(APPEND DEPENDENCY_VERSIONS "LIBDEFLATE_HASH" "dc76454a39e7e83b68c3704b6e3784654f8d5ac5")
  list(APPEND DEPENDENCY_VERSIONS "LOLHTML" "8d4c273ded322193d017042d1f48df2766b0f88b")
  list(APPEND DEPENDENCY_VERSIONS "LSHPACK" "3d0f1fc1d6e66a642e7a98c55deb38aa986eb4b0")
  list(APPEND DEPENDENCY_VERSIONS "MIMALLOC" "4c283af60cdae205df5a872530c77e2a6a307d43")
  list(APPEND DEPENDENCY_VERSIONS "PICOHTTPPARSER" "066d2b1e9ab820703db0837a7255d92d30f0c9f5")
  list(APPEND DEPENDENCY_VERSIONS "TINYCC" "ab631362d839333660a265d3084d8ff060b96753")
  list(APPEND DEPENDENCY_VERSIONS "ZLIB_HASH" "886098f3f339617b4243b286f5ed364b9989e245")
  list(APPEND DEPENDENCY_VERSIONS "ZSTD_HASH" "794ea1b0afca0f020f4e57b6732332231fb23c70")
  
  # Extract semantic versions from header files where available
  extract_version_from_header(
    "${VENDOR_PATH}/libdeflate/libdeflate.h"
    "#define LIBDEFLATE_VERSION_STRING[ \t]+\"([0-9\\.]+)\""
    LIBDEFLATE_VERSION_STRING
  )
  list(APPEND DEPENDENCY_VERSIONS "LIBDEFLATE_VERSION" "${LIBDEFLATE_VERSION_STRING}")
  
  extract_version_from_header(
    "${VENDOR_PATH}/zlib/zlib.h"
    "#define[ \t]+ZLIB_VERSION[ \t]+\"([^\"]+)\""
    ZLIB_VERSION_STRING
  )
  list(APPEND DEPENDENCY_VERSIONS "ZLIB_VERSION" "${ZLIB_VERSION_STRING}")
  
  extract_version_from_header(
    "${DEPS_PATH}/zstd/lib/zstd.h"
    "#define[ \t]+ZSTD_VERSION_STRING[ \t]+\"([^\"]+)\""
    ZSTD_VERSION_STRING
  )
  list(APPEND DEPENDENCY_VERSIONS "ZSTD_VERSION" "${ZSTD_VERSION_STRING}")
  
  # Bun version from package.json
  if(EXISTS "${CMAKE_SOURCE_DIR}/package.json")
    file(READ "${CMAKE_SOURCE_DIR}/package.json" PACKAGE_JSON)
    string(REGEX MATCH "\"version\"[ \t]*:[ \t]*\"([^\"]+)\"" _ ${PACKAGE_JSON})
    if(CMAKE_MATCH_1)
      set(BUN_VERSION_STRING "${CMAKE_MATCH_1}")
    else()
      set(BUN_VERSION_STRING "unknown")
    endif()
  else()
    set(BUN_VERSION_STRING "${VERSION}")
  endif()
  list(APPEND DEPENDENCY_VERSIONS "BUN_VERSION" "${BUN_VERSION_STRING}")
  
  # Node.js compatibility version (hardcoded as in the current implementation)
  set(NODEJS_COMPAT_VERSION "22.12.0")
  list(APPEND DEPENDENCY_VERSIONS "NODEJS_COMPAT_VERSION" "${NODEJS_COMPAT_VERSION}")
  
  # Get Bun's git SHA for uws/usockets versions (they use Bun's own SHA)
  execute_process(
    COMMAND git rev-parse HEAD
    WORKING_DIRECTORY "${CMAKE_SOURCE_DIR}"
    OUTPUT_VARIABLE BUN_GIT_SHA
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
  )
  if(NOT BUN_GIT_SHA)
    set(BUN_GIT_SHA "unknown")
  endif()
  list(APPEND DEPENDENCY_VERSIONS "UWS" "${BUN_GIT_SHA}")
  list(APPEND DEPENDENCY_VERSIONS "USOCKETS" "${BUN_GIT_SHA}")
  
  # Zig version - hardcoded for now, can be updated as needed
  # This should match the version of Zig used to build Bun
  list(APPEND DEPENDENCY_VERSIONS "ZIG" "0.14.1")
  
  # Generate the header file content
  set(HEADER_CONTENT "// This file is auto-generated by CMake. Do not edit manually.\n")
  string(APPEND HEADER_CONTENT "#ifndef BUN_DEPENDENCY_VERSIONS_H\n")
  string(APPEND HEADER_CONTENT "#define BUN_DEPENDENCY_VERSIONS_H\n\n")
  string(APPEND HEADER_CONTENT "#ifdef __cplusplus\n")
  string(APPEND HEADER_CONTENT "extern \"C\" {\n")
  string(APPEND HEADER_CONTENT "#endif\n\n")
  string(APPEND HEADER_CONTENT "// Dependency versions\n")
  
  # Process the version list
  list(LENGTH DEPENDENCY_VERSIONS num_versions)
  math(EXPR last_idx "${num_versions} - 1")
  set(i 0)
  while(i LESS num_versions)
    list(GET DEPENDENCY_VERSIONS ${i} name)
    math(EXPR value_idx "${i} + 1")
    if(value_idx LESS num_versions)
      list(GET DEPENDENCY_VERSIONS ${value_idx} value)
      # Only emit #define if value is not "unknown"
      if(NOT "${value}" STREQUAL "unknown")
        string(APPEND HEADER_CONTENT "#define BUN_DEP_${name} \"${value}\"\n")
      endif()
    endif()
    math(EXPR i "${i} + 2")
  endwhile()
  
  string(APPEND HEADER_CONTENT "\n")
  string(APPEND HEADER_CONTENT "// C string constants for easy access\n")
  
  # Create C string constants
  set(i 0)
  while(i LESS num_versions)
    list(GET DEPENDENCY_VERSIONS ${i} name)
    math(EXPR value_idx "${i} + 1")
    if(value_idx LESS num_versions)
      list(GET DEPENDENCY_VERSIONS ${value_idx} value)
      # Only emit constant if value is not "unknown"
      if(NOT "${value}" STREQUAL "unknown")
        string(APPEND HEADER_CONTENT "static const char* const BUN_VERSION_${name} = \"${value}\";\n")
      endif()
    endif()
    math(EXPR i "${i} + 2")
  endwhile()
  
  string(APPEND HEADER_CONTENT "\n#ifdef __cplusplus\n")
  string(APPEND HEADER_CONTENT "}\n")
  string(APPEND HEADER_CONTENT "#endif\n\n")
  string(APPEND HEADER_CONTENT "#endif // BUN_DEPENDENCY_VERSIONS_H\n")

  # Write the header file only if content has changed
  set(OUTPUT_FILE "${CMAKE_BINARY_DIR}/bun_dependency_versions.h")

  # Read existing content if file exists
  set(EXISTING_CONTENT "")
  if(EXISTS "${OUTPUT_FILE}")
    file(READ "${OUTPUT_FILE}" EXISTING_CONTENT)
  endif()

  # Only write if content is different
  if(NOT "${EXISTING_CONTENT}" STREQUAL "${HEADER_CONTENT}")
    file(WRITE "${OUTPUT_FILE}" "${HEADER_CONTENT}")
    message(STATUS "Updated dependency versions header: ${OUTPUT_FILE}")
  else()
    message(STATUS "Dependency versions header unchanged: ${OUTPUT_FILE}")
  endif()
  
  # Also create a more detailed version for debugging
  set(DEBUG_OUTPUT_FILE "${CMAKE_BINARY_DIR}/bun_dependency_versions_debug.txt")
  set(DEBUG_CONTENT "Bun Dependency Versions\n")
  string(APPEND DEBUG_CONTENT "=======================\n\n")
  set(i 0)
  while(i LESS num_versions)
    list(GET DEPENDENCY_VERSIONS ${i} name)
    math(EXPR value_idx "${i} + 1")
    if(value_idx LESS num_versions)
      list(GET DEPENDENCY_VERSIONS ${value_idx} value)
      string(APPEND DEBUG_CONTENT "${name}: ${value}\n")
    endif()
    math(EXPR i "${i} + 2")
  endwhile()
  file(WRITE "${DEBUG_OUTPUT_FILE}" "${DEBUG_CONTENT}")
endfunction()

# Call the function to generate the header
generate_dependency_versions_header()