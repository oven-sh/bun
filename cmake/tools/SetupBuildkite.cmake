optionx(BUILDKITE_CACHE BOOL "If the build can use Buildkite caches, even if not running in Buildkite" DEFAULT ${BUILDKITE})

if(NOT BUILDKITE_CACHE OR NOT BUN_LINK_ONLY)
  return()
endif()

optionx(BUILDKITE_ORGANIZATION_SLUG STRING "The organization slug to use on Buildkite" DEFAULT "bun")
optionx(BUILDKITE_PIPELINE_SLUG STRING "The pipeline slug to use on Buildkite" DEFAULT "bun")
optionx(BUILDKITE_BUILD_ID STRING "The build ID (UUID) to use on Buildkite")
optionx(BUILDKITE_BUILD_NUMBER STRING "The build number to use on Buildkite")
optionx(BUILDKITE_GROUP_ID STRING "The group ID to use on Buildkite")

if(ENABLE_BASELINE)
  set(DEFAULT_BUILDKITE_GROUP_KEY ${OS}-${ARCH}-baseline)
else()
  set(DEFAULT_BUILDKITE_GROUP_KEY ${OS}-${ARCH})
endif()

optionx(BUILDKITE_GROUP_KEY STRING "The group key to use on Buildkite" DEFAULT ${DEFAULT_BUILDKITE_GROUP_KEY})

if(BUILDKITE)
  optionx(BUILDKITE_BUILD_ID_OVERRIDE STRING "The build ID to use on Buildkite")
  if(BUILDKITE_BUILD_ID_OVERRIDE)
    setx(BUILDKITE_BUILD_ID ${BUILDKITE_BUILD_ID_OVERRIDE})
  endif()
endif()

# This runs inside the ${targetKey}-build-bun step (see .buildkite/ci.mjs), which
# links artifacts from ${targetKey}-build-cpp and ${targetKey}-build-zig in the
# same build. Step keys follow a fixed ${targetKey}-build-{cpp,zig,bun} pattern, so
# we derive the sibling step keys by swapping the suffix on our own BUILDKITE_STEP_KEY.
# That avoids having to reconstruct targetKey (which includes abi/baseline/profile
# components) from CMake-side platform detection.

if(NOT DEFINED ENV{BUILDKITE_STEP_KEY})
  message(FATAL_ERROR "BUILDKITE_STEP_KEY is not set (expected inside a Buildkite job)")
endif()
set(BUILDKITE_STEP_KEY $ENV{BUILDKITE_STEP_KEY})

if(NOT BUILDKITE_STEP_KEY MATCHES "^(.+)-build-bun$")
  message(FATAL_ERROR "Unexpected BUILDKITE_STEP_KEY '${BUILDKITE_STEP_KEY}' (expected '<target>-build-bun')")
endif()
set(BUILDKITE_TARGET_KEY ${CMAKE_MATCH_1})

set(BUILDKITE_SOURCE_STEPS
  ${BUILDKITE_TARGET_KEY}-build-cpp
  ${BUILDKITE_TARGET_KEY}-build-zig
)

# `buildkite-agent artifact search` lists artifacts from a sibling step in the
# current build using the agent token — no HTTP scraping, no dependence on the
# public buildkite.com JSON (which stopped inlining the jobs array in early 2026).
# Output is one artifact path per line; empty if the step produced nothing.
#
# We only want linkable/archive artifacts. Asking the agent for each extension
# separately and then flattening keeps us out of the brace-expansion-in-CMake
# tarpit, and the extra round-trips are negligible (agent is local).
set(BUILDKITE_ARTIFACT_GLOBS "*.o" "*.a" "*.lib" "*.zip" "*.tar" "*.gz")

set(BUILDKITE_STEPS_MATCHED)
set(BUILDKITE_STEPS_EMPTY)

foreach(STEP ${BUILDKITE_SOURCE_STEPS})
  set(STEP_ARTIFACTS)
  foreach(GLOB ${BUILDKITE_ARTIFACT_GLOBS})
    execute_process(
      COMMAND buildkite-agent artifact search ${GLOB} --step ${STEP} --format "%p\\n" --allow-empty-results
      OUTPUT_VARIABLE SEARCH_OUT
      ERROR_VARIABLE SEARCH_ERR
      RESULT_VARIABLE SEARCH_RC
      OUTPUT_STRIP_TRAILING_WHITESPACE
    )
    if(NOT SEARCH_RC EQUAL 0)
      message(FATAL_ERROR "buildkite-agent artifact search failed for ${STEP} ${GLOB}: ${SEARCH_ERR}")
    endif()
    if(SEARCH_OUT)
      string(REPLACE "\n" ";" SEARCH_OUT "${SEARCH_OUT}")
      list(APPEND STEP_ARTIFACTS ${SEARCH_OUT})
    endif()
  endforeach()

  if(NOT STEP_ARTIFACTS)
    list(APPEND BUILDKITE_STEPS_EMPTY ${STEP})
    continue()
  endif()
  list(REMOVE_DUPLICATES STEP_ARTIFACTS)
  list(APPEND BUILDKITE_STEPS_MATCHED ${STEP})

  foreach(ARTIFACT_PATH ${STEP_ARTIFACTS})
    # build-cpp uploads libbun-*.a but the consuming step gzipped it first
    # (upload bandwidth), so the actual artifact on the wire is the .gz.
    # Search finds the .gz; only the bare .a needs this remap.
    if(ARTIFACT_PATH STREQUAL "libbun-profile.a")
      set(ARTIFACT_PATH libbun-profile.a.gz)
    elseif(ARTIFACT_PATH STREQUAL "libbun-asan.a")
      set(ARTIFACT_PATH libbun-asan.a.gz)
    endif()

    add_custom_command(
      COMMENT "Downloading ${ARTIFACT_PATH} from ${STEP}"
      VERBATIM COMMAND
        buildkite-agent artifact download ${ARTIFACT_PATH} . --step ${STEP}
      WORKING_DIRECTORY ${BUILD_PATH}
      OUTPUT ${BUILD_PATH}/${ARTIFACT_PATH}
    )

    if(ARTIFACT_PATH STREQUAL "libbun-profile.a.gz")
      add_custom_command(
        COMMENT "Unpacking libbun-profile.a.gz"
        VERBATIM COMMAND gunzip libbun-profile.a.gz
        WORKING_DIRECTORY ${BUILD_PATH}
        OUTPUT ${BUILD_PATH}/libbun-profile.a
        DEPENDS ${BUILD_PATH}/libbun-profile.a.gz
      )
    elseif(ARTIFACT_PATH STREQUAL "libbun-asan.a.gz")
      add_custom_command(
        COMMENT "Unpacking libbun-asan.a.gz"
        VERBATIM COMMAND gunzip libbun-asan.a.gz
        WORKING_DIRECTORY ${BUILD_PATH}
        OUTPUT ${BUILD_PATH}/libbun-asan.a
        DEPENDS ${BUILD_PATH}/libbun-asan.a.gz
      )
    endif()
  endforeach()
endforeach()

if(BUILDKITE_STEPS_EMPTY)
  list(JOIN BUILDKITE_STEPS_EMPTY " " BUILDKITE_STEPS_EMPTY)
  message(WARNING "No linkable artifacts from: ${BUILDKITE_STEPS_EMPTY}")
endif()

if(BUILDKITE_STEPS_MATCHED)
  list(JOIN BUILDKITE_STEPS_MATCHED " " BUILDKITE_STEPS_MATCHED)
  message(STATUS "Found artifacts from: ${BUILDKITE_STEPS_MATCHED}")
else()
  message(FATAL_ERROR "No artifacts found from any of: ${BUILDKITE_SOURCE_STEPS}")
endif()
