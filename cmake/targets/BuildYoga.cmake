# Since we already have Yoga cloned, just build it directly
set(YOGA_PATH ${VENDOR_PATH}/yoga)

if(NOT EXISTS ${YOGA_PATH})
  message(FATAL_ERROR "Yoga not found at ${YOGA_PATH}. Please clone it manually.")
endif()

# Build Yoga as a subdirectory
add_subdirectory(${YOGA_PATH} ${BUILD_PATH}/yoga EXCLUDE_FROM_ALL)

# Set the include directories
if(TARGET ${bun})
  target_include_directories(${bun} PRIVATE ${YOGA_PATH})
  target_link_libraries(${bun} PRIVATE yogacore)
endif()

# Create a custom target for consistency with other dependencies
add_custom_target(yoga DEPENDS yogacore)