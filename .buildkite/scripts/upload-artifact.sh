#!/bin/bash

set -euo pipefail

function assert_buildkite_agent() {
  if ! command -v buildkite-agent &>/dev/null; then
    echo "error: Cannot find buildkite-agent, please install it:"
    echo "https://buildkite.com/docs/agent/v3/install"
    exit 1
  fi
}

function assert_split() {
  if ! command -v split &>/dev/null; then
    echo "error: Cannot find split, please install it:"
    echo "https://www.gnu.org/software/coreutils/split"
    exit 1
  fi
}

function upload_buildkite_artifact() {
  if [ -z "${1:-}" ]; then
    return
  fi

  local path="$1"
  shift
  local split="0"
  local args=() # Initialize args as an empty array
  while true; do
    if [ -z "${1:-}" ]; then
      break
    fi
    case "$1" in
    --split)
      split="1"
      shift
      ;;
    *)
      args+=("$1")
      shift
      ;;
    esac
  done
  if [ ! -f "$path" ]; then
    echo "error: Could not find artifact: $path"
    exit 1
  fi
  if [ "$split" == "1" ]; then
    run_command rm -f "$path."*
    run_command split -b 50MB -d "$path" "$path."
    if [ "${args[@]:-}" != "" ]; then
      run_command buildkite-agent artifact upload "$path.*" "${args[@]}"
    else
      run_command buildkite-agent artifact upload "$path.*"
    fi
  elif [ "${args[@]:-}" != "" ]; then
    run_command buildkite-agent artifact upload "$path" "${args[@]:-}"
  else
    run_command buildkite-agent artifact upload "$path"
  fi
}

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

assert_buildkite_agent
upload_buildkite_artifact "$@"
