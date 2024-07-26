#!/bin/bash

set -eo pipefail

function assert_buildkite_agent() {
  if ! command -v buildkite-agent &> /dev/null; then
    echo "error: Cannot find buildkite-agent, please install it:"
    echo "https://buildkite.com/docs/agent/v3/install"
    exit 1
  fi
}

function download_buildkite_artifact() {
  local path="$1"; shift
  local split="0"
  local args=()
  while true; do
    if [ -z "$1" ]; then
      break
    fi
    case "$1" in
      --split) split="1"; shift ;;
      *) args+=("$1"); shift ;;
    esac
  done
  if [ "$split" == "1" ]; then
    run_command buildkite-agent artifact download "$path.*" . "${args[@]}"
    run_command cat $path.?? > "$path"
    run_command rm -f $path.??
  else
    run_command buildkite-agent artifact download "$path" . "${args[@]}"
  fi
  if [ ! -f "$path" ]; then
    echo "error: Could not find artifact: $path"
    exit 1
  fi
}

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

assert_buildkite_agent
download_buildkite_artifact "$@"
