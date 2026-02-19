register_repository(
  NAME
    zlib
  REPOSITORY
    cloudflare/zlib
  COMMIT
    886098f3f339617b4243b286f5ed364b9989e245
)

# cloudflare/zlib hardcodes STATIC_LIBRARY_FLAGS "/machine:x64" for 64-bit MSVC,
# which conflicts with ARM64 object files. Patch it after clone to use the correct
# machine type based on CMAKE_SYSTEM_PROCESSOR.
if(WIN32 AND CMAKE_SYSTEM_PROCESSOR MATCHES "ARM64|aarch64|AARCH64")
  set(ZLIB_PATCH_SCRIPT "${BUILD_PATH}/zlib-arm64-patch.cmake")
  file(WRITE ${ZLIB_PATCH_SCRIPT} "
    file(READ \"\${ZLIB_CMAKELISTS}\" content)
    string(REPLACE \"/machine:x64\" \"/machine:ARM64\" content \"\${content}\")
    file(WRITE \"\${ZLIB_CMAKELISTS}\" \"\${content}\")
    file(TOUCH \"\${ZLIB_PATCH_MARKER}\")
  ")
  register_command(
    COMMENT "Patching zlib for ARM64"
    TARGET patch-zlib
    COMMAND ${CMAKE_COMMAND}
      -DZLIB_CMAKELISTS=${VENDOR_PATH}/zlib/CMakeLists.txt
      -DZLIB_PATCH_MARKER=${VENDOR_PATH}/zlib/.arm64-patched
      -P ${ZLIB_PATCH_SCRIPT}
    SOURCES ${VENDOR_PATH}/zlib/.ref
    OUTPUTS ${VENDOR_PATH}/zlib/.arm64-patched
  )
  if(TARGET clone-zlib)
    add_dependencies(patch-zlib clone-zlib)
  endif()
endif()

# https://gitlab.kitware.com/cmake/cmake/-/issues/25755
if(APPLE)
  set(ZLIB_CMAKE_C_FLAGS "-fno-define-target-os-macros")
  set(ZLIB_CMAKE_CXX_FLAGS "-fno-define-target-os-macros")
endif()

if(WIN32)
  if(DEBUG)
    set(ZLIB_LIBRARY "zlibd")
  else()
    set(ZLIB_LIBRARY "zlib")
  endif()
else()
  set(ZLIB_LIBRARY "z")
endif()

register_cmake_command(
  TARGET
    zlib
  TARGETS
    zlib
  ARGS
    -DBUILD_SHARED_LIBS=OFF
    -DBUILD_EXAMPLES=OFF
    "-DCMAKE_C_FLAGS=${ZLIB_CMAKE_C_FLAGS}"
    "-DCMAKE_CXX_FLAGS=${ZLIB_CMAKE_CXX_FLAGS}"
  LIBRARIES
    ${ZLIB_LIBRARY}
  INCLUDES
    .
)

# Ensure zlib is patched before configure
if(TARGET patch-zlib)
  add_dependencies(configure-zlib patch-zlib)
endif()
