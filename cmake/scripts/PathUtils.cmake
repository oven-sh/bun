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