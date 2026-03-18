optionx(BUILDKITE_CACHE BOOL "If the build can use Buildkite caches, even if not running in Buildkite" DEFAULT ${BUILDKITE})

if(NOT BUILDKITE_CACHE OR NOT BUN_LINK_ONLY)
  return()
endif()

# This runs inside the ${targetKey}-build-bun step (see .buildkite/ci.mjs), which
# links artifacts from ${targetKey}-build-cpp and ${targetKey}-build-zig in the
# same build. Step keys follow a fixed ${targetKey}-build-{cpp,zig,bun} pattern
# and build-bun's depends_on lists exactly those two steps, so we derive the
# siblings by swapping the suffix on our own BUILDKITE_STEP_KEY.

if(NOT DEFINED ENV{BUILDKITE_STEP_KEY})
  message(FATAL_ERROR "BUILDKITE_STEP_KEY is not set (expected inside a Buildkite job)")
endif()
set(BUILDKITE_STEP_KEY $ENV{BUILDKITE_STEP_KEY})

if(NOT BUILDKITE_STEP_KEY MATCHES "^(.+)-build-bun$")
  message(FATAL_ERROR "Unexpected BUILDKITE_STEP_KEY '${BUILDKITE_STEP_KEY}' (expected '<target>-build-bun')")
endif()
set(BUILDKITE_TARGET_KEY ${CMAKE_MATCH_1})

# Download all artifacts from both sibling steps. The agent scopes to the
# current build via $BUILDKITE_BUILD_ID; --step resolves by key within it.
# git clean -ffxdq runs between builds (BUILDKITE_GIT_CLEAN_FLAGS), so
# ${BUILD_PATH} starts clean.

file(MAKE_DIRECTORY ${BUILD_PATH})

foreach(SUFFIX cpp zig)
  set(STEP ${BUILDKITE_TARGET_KEY}-build-${SUFFIX})
  message(STATUS "Downloading artifacts from ${STEP}")
  execute_process(
    COMMAND buildkite-agent artifact download * . --step ${STEP}
    WORKING_DIRECTORY ${BUILD_PATH}
    RESULT_VARIABLE DOWNLOAD_RC
    ERROR_VARIABLE DOWNLOAD_ERR
  )
  if(NOT DOWNLOAD_RC EQUAL 0)
    message(FATAL_ERROR "buildkite-agent artifact download from ${STEP} failed: ${DOWNLOAD_ERR}")
  endif()
endforeach()

# libbun-profile.a and libbun-asan.a are gzipped before upload (see
# register_command's ARTIFACTS handling in Globals.cmake). Windows .lib
# files are not gzipped, so this glob is empty there.

file(GLOB BUILDKITE_GZ_ARTIFACTS "${BUILD_PATH}/*.gz")
foreach(GZ ${BUILDKITE_GZ_ARTIFACTS})
  message(STATUS "Unpacking ${GZ}")
  execute_process(
    COMMAND gunzip -f ${GZ}
    RESULT_VARIABLE GUNZIP_RC
    ERROR_VARIABLE GUNZIP_ERR
  )
  if(NOT GUNZIP_RC EQUAL 0)
    message(FATAL_ERROR "gunzip ${GZ} failed: ${GUNZIP_ERR}")
  endif()
endforeach()

# Artifacts are uploaded with subdirectory paths (lolhtml/release/liblolhtml.a,
# mimalloc/CMakeFiles/mimalloc-obj.dir/src/static.c.o, etc.) and the agent
# recreates that structure on download. Recurse, but skip top-level CMakeFiles/
# (our own compiler detection) and cache/ — nested CMakeFiles/ are real artifacts.

file(GLOB_RECURSE BUILDKITE_LINK_ARTIFACTS
  "${BUILD_PATH}/*.o"
  "${BUILD_PATH}/*.a"
  "${BUILD_PATH}/*.lib"
)
string(REGEX REPLACE "\\." "\\\\." BUILD_PATH_RE "${BUILD_PATH}")
list(FILTER BUILDKITE_LINK_ARTIFACTS EXCLUDE REGEX "^${BUILD_PATH_RE}/(CMakeFiles|cache)/")

if(NOT BUILDKITE_LINK_ARTIFACTS)
  message(FATAL_ERROR "No linkable artifacts found in ${BUILD_PATH} after download")
endif()
list(LENGTH BUILDKITE_LINK_ARTIFACTS BUILDKITE_LINK_COUNT)
message(STATUS "Registered ${BUILDKITE_LINK_COUNT} linkable artifacts from ${BUILDKITE_TARGET_KEY}-build-{cpp,zig}")

# Register a no-op custom command for each linkable artifact so register_command
# (Globals.cmake) sees them as GENERATED and shims its own output to
# ${output}.always_run_${target} instead of overwriting them with a rebuild.
# With no DEPENDS, the no-op never fires — the file already exists.

foreach(ARTIFACT ${BUILDKITE_LINK_ARTIFACTS})
  add_custom_command(
    OUTPUT ${ARTIFACT}
    COMMAND ${CMAKE_COMMAND} -E true
  )
endforeach()
