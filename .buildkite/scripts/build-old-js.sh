#!/bin/bash

set -eo pipefail
source "$(dirname "$0")/env.sh"

function assert_bun() {
  if ! command -v bun &>/dev/null; then
    echo "error: bun is not installed" 1>&2
    exit 1
  fi
}

function assert_make() {
  if ! command -v make &>/dev/null; then
    echo "error: make is not installed" 1>&2
    exit 1
  fi
}

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

function build_node_fallbacks() {
  local cwd="src/node-fallbacks"
  run_command bun install --cwd "$cwd" --frozen-lockfile
  run_command bun run --cwd "$cwd" build
}

function build_old_js() {
  run_command bun install --frozen-lockfile
  run_command make runtime_js fallback_decoder bun_error
}

assert_bun
assert_make
build_node_fallbacks
build_old_js
