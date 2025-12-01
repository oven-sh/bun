# Setup sccache as the C and C++ compiler launcher to speed up builds by caching
if(CACHE_STRATEGY STREQUAL "none")
  return()
endif()

set(SCCACHE_SHARED_CACHE_REGION "us-west-1")
set(SCCACHE_SHARED_CACHE_BUCKET "bun-build-sccache-store")

# Function to check if the system AWS credentials have access to the sccache S3 bucket.
function(check_aws_credentials OUT_VAR)
  # Install dependencies first
  execute_process(
    COMMAND ${BUN_EXECUTABLE} install --frozen-lockfile
    WORKING_DIRECTORY ${CMAKE_SOURCE_DIR}/scripts/build-cache
    RESULT_VARIABLE INSTALL_EXIT_CODE
    OUTPUT_VARIABLE INSTALL_OUTPUT
    ERROR_VARIABLE INSTALL_ERROR
  )

  if(NOT INSTALL_EXIT_CODE EQUAL 0)
    message(FATAL_ERROR "Failed to install dependencies in scripts/build-cache\n"
      "Exit code: ${INSTALL_EXIT_CODE}\n"
      "Output: ${INSTALL_OUTPUT}\n"
      "Error: ${INSTALL_ERROR}")
  endif()

  # Check AWS credentials
  execute_process(
    COMMAND
      ${BUN_EXECUTABLE}
      run
      have-access.ts
      --bucket ${SCCACHE_SHARED_CACHE_BUCKET}
      --region ${SCCACHE_SHARED_CACHE_REGION}
    WORKING_DIRECTORY
      ${CMAKE_SOURCE_DIR}/scripts/build-cache
    RESULT_VARIABLE HAVE_ACCESS_EXIT_CODE
  )

  if(HAVE_ACCESS_EXIT_CODE EQUAL 0)
    set(HAS_CREDENTIALS TRUE)
  else()
    set(HAS_CREDENTIALS FALSE)
  endif()

  set(${OUT_VAR} ${HAS_CREDENTIALS} PARENT_SCOPE)
endfunction()

# Configure sccache to use the local cache only.
function(sccache_configure_local_filesystem)
  unsetenv(SCCACHE_BUCKET)
  unsetenv(SCCACHE_REGION)
  setenv(SCCACHE_DIR "${CACHE_PATH}/sccache")
endfunction()

# Configure sccache to use the distributed cache (S3 + local).
function(sccache_configure_distributed)
  setenv(SCCACHE_BUCKET "${SCCACHE_SHARED_CACHE_BUCKET}")
  setenv(SCCACHE_REGION "${SCCACHE_SHARED_CACHE_REGION}")
  setenv(SCCACHE_DIR "${CACHE_PATH}/sccache")
endfunction()

function(sccache_configure_environment_ci)
  if(CACHE_STRATEGY STREQUAL "auto" OR CACHE_STRATEGY STREQUAL "distributed")
    check_aws_credentials(HAS_AWS_CREDENTIALS)
    if(HAS_AWS_CREDENTIALS)
      sccache_configure_distributed()
      message(NOTICE "sccache: Using distributed cache strategy.")
    else()
      message(FATAL_ERROR "CI CACHE_STRATEGY is set to '${CACHE_STRATEGY}', but no valid AWS "
        "credentials were found. Note that 'auto' requires AWS credentials to access the shared "
        "cache in CI.")
    endif()
  elseif(CACHE_STRATEGY STREQUAL "local")
    # We disallow this because we want our CI runs to always used the shared cache to accelerate
    # builds.
    # none, distributed and auto are all okay.
    #
    # If local is configured, it's as good as "none", so this is probably user error.
    message(FATAL_ERROR "CI CACHE_STRATEGY is set to 'local', which is not allowed.")
  endif()
endfunction()

function(sccache_configure_environment_developer)
  # Local environments can use any strategy they like. S3 is set up in such a way so as to clean
  # itself from old entries automatically.
  if (CACHE_STRATEGY STREQUAL "auto" OR CACHE_STRATEGY STREQUAL "local")
    # In the local environment, we prioritize using the local cache. This is because sccache takes
    # into consideration the whole absolute path of the files being compiled, and it's very
    # unlikely users will have the same absolute paths on their local machines.
    sccache_configure_local_filesystem()
    message(NOTICE "sccache: Using local cache strategy.")
  elseif(CACHE_STRATEGY STREQUAL "distributed")
    check_aws_credentials(HAS_AWS_CREDENTIALS)
    if(HAS_AWS_CREDENTIALS)
      sccache_configure_distributed()
      message(NOTICE "sccache: Using distributed cache strategy.")
    else()
      message(FATAL_ERROR "CACHE_STRATEGY is set to 'distributed', but no valid AWS credentials "
        "were found.")
    endif()
  endif()
endfunction()

find_command(VARIABLE SCCACHE_PROGRAM COMMAND sccache REQUIRED ${CI})
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

if (CI)
  sccache_configure_environment_ci()
else()
  sccache_configure_environment_developer()
endif()
