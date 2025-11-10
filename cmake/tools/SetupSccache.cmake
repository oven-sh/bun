if(CACHE_STRATEGY STREQUAL "none")
  return()
endif()

function(check_aws_credentials OUT_VAR)
  set(HAS_CREDENTIALS FALSE)

  if(DEFINED ENV{AWS_ACCESS_KEY_ID} AND DEFINED ENV{AWS_SECRET_ACCESS_KEY})
    set(HAS_CREDENTIALS TRUE)
    message(STATUS
      "sccache: Found AWS credentials in environment variables")
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
      message(STATUS
        "sccache: Found AWS credentials in ${AWS_CONFIG_DIR}/credentials")
    endif()
  endif()

  if(HAS_CREDENTIALS)
    # Great, we found some credentials, but now we need to test whether these credentials are authorized to hit our build
    # cache.
    execute_process(
      COMMAND
        bun
        run
        ${CMAKE_SOURCE_DIR}/scripts/build-cache/have-access.ts
        --bucket bun-build-sccache-store
        --region us-west-1
      OUTPUT_VARIABLE HAVE_ACCESS_EXIT_CODE
    )

    if(HAVE_ACCESS_EXIT_CODE EQUAL 0)
      message(NOTICE "sccache: AWS credentials have access to the build cache.")
      set(HAS_CREDENTIALS TRUE)
    else()
      message(NOTICE "sccache: AWS credentials do not have access to the build cache.")
      set(HAS_CREDENTIALS FALSE)
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

setenv(SCCACHE_LOG "info")

check_aws_credentials(HAS_AWS_CREDENTIALS)
if (HAS_AWS_CREDENTIALS)
  setenv(SCCACHE_BUCKET "bun-build-sccache-store")
  setenv(SCCACHE_REGION "us-west-1")
  setenv(SCCACHE_DIR "${CACHE_PATH}/sccache")
  message(STATUS "sccache configured for bun-build-sccache-store (us-west-1).")
else()
  unset(ENV{SCCACHE_BUCKET})
  unset(ENV{SCCACHE_REGION})
  unset(ENV{SCCACHE_DIR})

  if (IS_IN_CI)
    message(FATAL_ERROR "In CI environment but no AWS credentials found for sccache.")
  else()
    message(WARNING "sccache: No authorized bun build cache AWS credentials found, falling back to "
      "local filesystem cache.")
    setenv(SCCACHE_DIR "${CACHE_PATH}/sccache")
  endif()
endif()
