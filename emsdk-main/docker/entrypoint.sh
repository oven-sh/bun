#!/bin/bash
set -e

# Set-up PATH and other environment variables
EMSDK_QUIET=1 source /emsdk/emsdk_env.sh

exec "$@"
