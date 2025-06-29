# This script prepares Node.js headers for use with Bun
# It removes conflicting OpenSSL and libuv headers since Bun uses BoringSSL and its own libuv

if(NOT DEFINED NODE_INCLUDE_DIR)
  message(FATAL_ERROR "NODE_INCLUDE_DIR not defined")
endif()

if(NOT EXISTS "${NODE_INCLUDE_DIR}/node")
  message(FATAL_ERROR "Node headers not found at ${NODE_INCLUDE_DIR}/node")
endif()

# Remove OpenSSL headers that conflict with BoringSSL
if(EXISTS "${NODE_INCLUDE_DIR}/node/openssl")
  file(REMOVE_RECURSE "${NODE_INCLUDE_DIR}/node/openssl")
  message(STATUS "Removed conflicting OpenSSL headers")
endif()

# Remove libuv headers that might conflict
if(EXISTS "${NODE_INCLUDE_DIR}/node/uv")
  file(REMOVE_RECURSE "${NODE_INCLUDE_DIR}/node/uv")
  message(STATUS "Removed conflicting libuv headers")
endif()

if(EXISTS "${NODE_INCLUDE_DIR}/node/uv.h")
  file(REMOVE "${NODE_INCLUDE_DIR}/node/uv.h")
  message(STATUS "Removed conflicting uv.h header")
endif()

# Add the node directory to include path for cppgc
# This is needed because cppgc internal headers use relative includes
file(WRITE "${NODE_INCLUDE_DIR}/.node-headers-prepared" "1")
