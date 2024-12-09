#!/bin/bash

set -eo pipefail

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

run_command node ".buildkite/ci.mjs" "$@"
