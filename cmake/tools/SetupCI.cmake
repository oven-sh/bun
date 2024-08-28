if(NOT CMAKE_GENERATOR MATCHES "Ninja")
  message(FATAL_ERROR "Builds in CI must use Ninja, please set -GNinja")
endif()
