if(CACHE_STRATEGY STREQUAL "none")
  return()
endif()

function(check_aws_credentials OUT_VAR)
  set(HAS_CREDENTIALS FALSE)

  if(DEFINED ENV{AWS_ACCESS_KEY_ID} AND DEFINED ENV{AWS_SECRET_ACCESS_KEY})
    set(HAS_CREDENTIALS TRUE)
    message(NOTICE
      "sccache: Using AWS credentials found in environment variables")
  endif()

  # Check for ~/.aws directory since sccache may use that.
  if(NOT HAS_CREDENTIALS)
    if(WIN32)
      set(AWS_CONFIG_DIR "$ENV{USERPROFILE}/.aws")
    else()
      set(AWS_CONFIG_DIR "$ENV{HOME}/.aws")
    endif()

    if(EXISTS "${AWS_CONFIG_DIR}/credentials")
      set(HAS_CREDENTIALS TRUE)
      message(NOTICE
        "sccache: Using AWS credentials found in ${AWS_CONFIG_DIR}/credentials")
    endif()
  endif()

  set(${OUT_VAR} ${HAS_CREDENTIALS} PARENT_SCOPE)
endfunction()

function(check_running_in_ci OUT_VAR)
  set(IS_CI FALSE)

  # Query EC2 instance metadata service to check if running on buildkite-agent
  # The IP address 169.254.169.254 is a well-known link-local address for querying EC2 instance
  # metdata:
  # https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html
  execute_process(
    COMMAND curl -s -m 0.5 http://169.254.169.254/latest/meta-data/tags/instance/Service
    OUTPUT_VARIABLE METADATA_OUTPUT
    ERROR_VARIABLE METADATA_ERROR
    RESULT_VARIABLE METADATA_RESULT
    OUTPUT_STRIP_TRAILING_WHITESPACE
    ERROR_QUIET
  )

  # Check if the request succeeded and returned exactly "buildkite-agent"
  if(METADATA_RESULT EQUAL 0 AND METADATA_OUTPUT STREQUAL "buildkite-agent")
    set(IS_CI TRUE)
  endif()

  set(${OUT_VAR} ${IS_CI} PARENT_SCOPE)
endfunction()

check_running_in_ci(IS_IN_CI)
find_command(VARIABLE SCCACHE_PROGRAM COMMAND sccache REQUIRED ${IS_IN_CI})
if(NOT SCCACHE_PROGRAM)
  message(WARNING "sccache not found. Your builds will be slower.")
  return()
endif()

set(SCCACHE_ARGS CMAKE_C_COMPILER_LAUNCHER CMAKE_CXX_COMPILER_LAUNCHER)
foreach(arg ${SCCACHE_ARGS})
  setx(${arg} ${SCCACHE_PROGRAM})
  list(APPEND CMAKE_ARGS -D${arg}=${${arg}})
endforeach()

# Configure S3 bucket for distributed caching
setenv(SCCACHE_BUCKET "bun-build-sccache-store")
setenv(SCCACHE_REGION "us-west-1")
setenv(SCCACHE_DIR "${CACHE_PATH}/sccache")

# Handle credentials based on cache strategy
if (CACHE_STRATEGY STREQUAL "read-only")
  setenv(SCCACHE_S3_NO_CREDENTIALS "1")
  message(STATUS "sccache configured in read-only mode.")
else()
  # Check for AWS credentials and enable anonymous access if needed
  check_aws_credentials(HAS_AWS_CREDENTIALS)
  if(NOT IS_IN_CI AND NOT HAS_AWS_CREDENTIALS)
    setenv(SCCACHE_S3_NO_CREDENTIALS "1")
    message(NOTICE "sccache: No AWS credentials found, enabling anonymous S3 "
      "access. Writing to the cache will be disabled.")
  endif()
endif()

setenv(SCCACHE_LOG "info")

message(STATUS "sccache configured for bun-build-sccache-store (us-west-1).")
