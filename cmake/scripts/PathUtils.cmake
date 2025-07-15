# Function to convert relative paths from a file to absolute paths
# Usage: absolute_sources(OUTPUT_VAR INPUT_FILE [BASE_DIR])
# OUTPUT_VAR: Variable name to store the resulting absolute paths
# INPUT_FILE: File containing relative paths (one per line)
# BASE_DIR: Optional base directory for resolving paths (defaults to CMAKE_CURRENT_SOURCE_DIR)
function(absolute_sources OUTPUT_VAR INPUT_FILE)
    # Check if a custom base directory was provided
    if(${ARGC} GREATER 2)
        set(BASE_DIR ${ARGV2})
    else()
        set(BASE_DIR ${CMAKE_CURRENT_SOURCE_DIR})
    endif()
    
    # Read the file containing relative paths
    file(STRINGS "${INPUT_FILE}" RELATIVE_PATHS)
    
    # Create a list to store absolute paths
    set(RESULT_LIST "")
    
    # Convert each relative path to absolute
    foreach(REL_PATH ${RELATIVE_PATHS})
        # Skip empty lines
        if(NOT "${REL_PATH}" STREQUAL "")
            # Construct the absolute path
            get_filename_component(ABS_PATH "${BASE_DIR}/${REL_PATH}" ABSOLUTE)
            list(APPEND RESULT_LIST ${ABS_PATH})
        endif()
    endforeach()
    
    # Set the output variable in the parent scope
    set(${OUTPUT_VAR} ${RESULT_LIST} PARENT_SCOPE)
    
    # Tell CMake that the configuration depends on this file
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${INPUT_FILE}")
endfunction()

# Function to extract @embedFile dependencies from Zig files
# Usage: zig_embed_dependencies(OUTPUT_VAR ZIG_FILE [BASE_DIR])
# OUTPUT_VAR: Variable name to store the resulting absolute paths of embedded files
# ZIG_FILE: Zig source file to scan for @embedFile statements
# BASE_DIR: Optional base directory for resolving relative paths (defaults to directory containing ZIG_FILE)
function(zig_embed_dependencies OUTPUT_VAR ZIG_FILE)
    # Check if a custom base directory was provided
    if(${ARGC} GREATER 2)
        set(BASE_DIR ${ARGV2})
    else()
        get_filename_component(BASE_DIR "${ZIG_FILE}" DIRECTORY)
    endif()
    
    # Read the Zig source file
    file(STRINGS "${ZIG_FILE}" ZIG_LINES)
    
    # Create a list to store embedded file paths
    set(RESULT_LIST "")
    
    # Join all lines into a single string to handle multi-line @embedFile statements
    string(REPLACE ";" " " ZIG_CONTENT "${ZIG_LINES}")
    
    # Find all @embedFile statements using a regex that handles multiple matches
    string(REGEX MATCHALL "@embedFile\\(\"([^\"]+)\"\\)" EMBED_MATCHES "${ZIG_CONTENT}")
    
    # Extract the path from each match
    foreach(MATCH ${EMBED_MATCHES})
        if(MATCH MATCHES "@embedFile\\(\"([^\"]+)\"\\)")
            set(EMBED_PATH ${CMAKE_MATCH_1})
            
            # Skip empty paths
            if(NOT "${EMBED_PATH}" STREQUAL "")
                # Construct the absolute path relative to the base directory
                get_filename_component(ABS_PATH "${BASE_DIR}/${EMBED_PATH}" ABSOLUTE)
                list(APPEND RESULT_LIST ${ABS_PATH})
            endif()
        endif()
    endforeach()
    
    # Set the output variable in the parent scope
    set(${OUTPUT_VAR} ${RESULT_LIST} PARENT_SCOPE)
    
    # Tell CMake that the configuration depends on the Zig source file
    set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${ZIG_FILE}")
endfunction()