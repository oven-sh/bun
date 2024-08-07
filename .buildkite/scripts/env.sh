#!/bin/bash

set -eo pipefail

function assert_os() {
  local os="$(uname -s)"
  case "$os" in
    Linux)
      echo "linux" ;;
    Darwin)
      echo "darwin" ;;
    *)
      echo "error: Unsupported operating system: $os" 1>&2
      exit 1
      ;;
  esac
}

function assert_arch() {
  local arch="$(uname -m)"
  case "$arch" in
    aarch64 | arm64)
      echo "aarch64" ;;
    x86_64 | amd64)
      echo "x64" ;;
    *)
      echo "error: Unknown architecture: $arch" 1>&2
      exit 1
      ;;
  esac
}

function assert_build() {
  if [ -z "$BUILDKITE_REPO" ]; then
    echo "error: Cannot find repository for this build"
    exit 1
  fi
  if [ -z "$BUILDKITE_COMMIT" ]; then
    echo "error: Cannot find commit for this build"
    exit 1
  fi
  if [ -z "$BUILDKITE_STEP_KEY" ]; then
    echo "error: Cannot find step key for this build"
    exit 1
  fi
  if [ -n "$BUILDKITE_GROUP_KEY" ] && [[ "$BUILDKITE_STEP_KEY" != "$BUILDKITE_GROUP_KEY"* ]]; then
    echo "error: Build step '$BUILDKITE_STEP_KEY' does not start with group key '$BUILDKITE_GROUP_KEY'"
    exit 1
  fi
  # Skip os and arch checks for Zig, since it's cross-compiled on macOS
  if [[ "$BUILDKITE_STEP_KEY" != *"zig"* ]]; then
    local os="$(assert_os)"
    if [[ "$BUILDKITE_STEP_KEY" != *"$os"* ]]; then
      echo "error: Build step '$BUILDKITE_STEP_KEY' does not match operating system '$os'"
      exit 1
    fi
    local arch="$(assert_arch)"
    if [[ "$BUILDKITE_STEP_KEY" != *"$arch"* ]]; then
      echo "error: Build step '$BUILDKITE_STEP_KEY' does not match architecture '$arch'"
      exit 1
    fi
  fi
}

function assert_buildkite_agent() {
  if ! command -v buildkite-agent &> /dev/null; then
    echo "error: Cannot find buildkite-agent, please install it:"
    echo "https://buildkite.com/docs/agent/v3/install"
    exit 1
  fi
}

function export_environment() {
  source "$(realpath $(dirname "$0")/../../scripts/env.sh)"
  source "$(realpath $(dirname "$0")/../../scripts/update-submodules.sh)"
  { set +x; } 2>/dev/null
  export GIT_SHA="$BUILDKITE_COMMIT"
  export CCACHE_DIR="$HOME/.cache/ccache/$BUILDKITE_STEP_KEY"
  export SCCACHE_DIR="$HOME/.cache/sccache/$BUILDKITE_STEP_KEY"
  export ZIG_LOCAL_CACHE_DIR="$HOME/.cache/zig-cache/$BUILDKITE_STEP_KEY"
  export ZIG_GLOBAL_CACHE_DIR="$HOME/.cache/zig-cache/$BUILDKITE_STEP_KEY"
  export BUN_DEPS_CACHE_DIR="$HOME/.cache/bun-deps/$BUILDKITE_STEP_KEY"
  if [ "$(assert_os)" == "linux" ]; then
    export USE_LTO="ON"
  fi
  if [ "$(assert_arch)" == "aarch64" ]; then
    export CPU_TARGET="native"
  elif [[ "$BUILDKITE_STEP_KEY" == *"baseline"* ]]; then
    export CPU_TARGET="nehalem"
  else
    export CPU_TARGET="haswell"
  fi
  if $(buildkite-agent meta-data exists release &> /dev/null); then
    export CMAKE_BUILD_TYPE="$(buildkite-agent meta-data get release)"
  else
    export CMAKE_BUILD_TYPE="Release"
  fi
  if $(buildkite-agent meta-data exists canary &> /dev/null); then
    export CANARY="$(buildkite-agent meta-data get canary)"
  else
    export CANARY="1"
  fi
  if $(buildkite-agent meta-data exists assertions &> /dev/null); then
    export USE_DEBUG_JSC="$(buildkite-agent meta-data get assertions)"
  else
    export USE_DEBUG_JSC="OFF"
  fi
  if [ "$BUILDKITE_CLEAN_CHECKOUT" == "true" || "$BUILDKITE_BRANCH" == "main" ]; then
    rm -rf "$CCACHE_DIR"
    rm -rf "$SCCACHE_DIR"
    rm -rf "$ZIG_LOCAL_CACHE_DIR"
    rm -rf "$ZIG_GLOBAL_CACHE_DIR"
    rm -rf "$BUN_DEPS_CACHE_DIR"
    export CCACHE_RECACHE="1"
  fi
}

assert_build
assert_buildkite_agent
export_environment
