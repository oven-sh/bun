include(Macros)

optionx(BUILDKITE_CACHE BOOL "If the build can use Buildkite caches, even if not running in Buildkite" DEFAULT ${BUILDKITE})

if(NOT BUILDKITE_CACHE)
  return()
endif()

optionx(BUILDKITE_ORGANIZATION_SLUG STRING "The organization slug to use on Buildkite" DEFAULT "bun")
optionx(BUILDKITE_PIPELINE_SLUG STRING "The pipeline slug to use on Buildkite" DEFAULT "bun")
optionx(BUILDKITE_BRANCH STRING "The branch to build on Buildkite" DEFAULT "main")

if(BUILDKITE)
  optionx(BUILDKITE_STEP_ID STRING "The step ID to use on Buildkite" REQUIRED)
  optionx(BUILDKITE_CLEAN_CHECKOUT BOOL "If the build should be clean and not use caches" DEFAULT OFF)
endif()

set(BUILDKITE_PATH ${BUILD_PATH}/buildkite)
set(BUILDKITE_BUILDS_PATH ${BUILDKITE_PATH}/builds.json)

setx(BUILDKITE_BUILDS_URL "https://buildkite.com/${BUILDKITE_ORGANIZATION_SLUG}/${BUILDKITE_PIPELINE_SLUG}/builds")
file(
  DOWNLOAD ${BUILDKITE_BUILDS_URL}
  HTTPHEADER "Accept: application/json"
  TIMEOUT 15
  STATUS BUILDKITE_BUILDS_STATUS
  ${BUILDKITE_BUILDS_PATH}
)

if(NOT BUILDKITE_BUILDS_STATUS EQUAL 0)
  message(WARNING "Failed to download list of builds from Buildkite: ${BUILDKITE_BUILDS_STATUS}")
  return()
endif()

file(READ ${BUILDKITE_BUILDS_PATH} BUILDKITE_BUILDS)

string(JSON BUILDKITE_BUILDS_LENGTH ERROR_VARIABLE BUILDKITE_BUILDS_ERROR LENGTH ${BUILDKITE_BUILDS})
if(BUILDKITE_BUILDS_ERROR)
  message(WARNING "Failed to parse list of builds from Buildkite: ${BUILDKITE_BUILDS_ERROR}")
  return()
endif()
