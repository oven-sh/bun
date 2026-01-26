# This file is included after project() via CMAKE_PROJECT_INCLUDE
# It fixes the static library creation command to use ARM64 machine type

if(WIN32 AND CMAKE_SYSTEM_PROCESSOR STREQUAL \"aarch64\")
  # Override the static library creation commands to avoid spurious /machine:x64 flags
  set(CMAKE_C_CREATE_STATIC_LIBRARY \"<CMAKE_AR> /nologo /machine:ARM64 /out:<TARGET> <OBJECTS>\" CACHE STRING \"\" FORCE)
  set(CMAKE_CXX_CREATE_STATIC_LIBRARY \"<CMAKE_AR> /nologo /machine:ARM64 /out:<TARGET> <OBJECTS>\" CACHE STRING \"\" FORCE)
endif()