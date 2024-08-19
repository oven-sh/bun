#!/bin/bash

set -eo pipefail

function assert_build() {
  if [ -z "$BUILDKITE_REPO" ]; then
    echo "error: Cannot find repository for this build"
    exit 1
  fi
  if [ -z "$BUILDKITE_COMMIT" ]; then
    echo "error: Cannot find commit for this build"
    exit 1
  fi
}

function assert_buildkite_agent() {
  if ! command -v buildkite-agent &> /dev/null; then
    echo "error: Cannot find buildkite-agent, please install it:"
    echo "https://buildkite.com/docs/agent/v3/install"
    exit 1
  fi
}

function assert_jq() {
  assert_command "jq" "jq" "https://stedolan.github.io/jq/"
}

function assert_curl() {
  assert_command "curl" "curl" "https://curl.se/download.html"
}

function assert_command() {
  local command="$1"
  local package="$2"
  local help_url="$3"
  if ! command -v "$command" &> /dev/null; then
    echo "warning: $command is not installed, installing..."
    if command -v brew &> /dev/null; then
      HOMEBREW_NO_AUTO_UPDATE=1 brew install "$package"
    else
      echo "error: Cannot install $command, please install it"
      if [ -n "$help_url" ]; then
        echo ""
        echo "hint: See $help_url for help"
      fi
      exit 1
    fi
  fi
}

function assert_release() {
  if [ "$RELEASE" == "1" ]; then
    run_command buildkite-agent meta-data set canary "0"
  fi
}

function assert_canary() {
  local canary="$(buildkite-agent meta-data get canary 2>/dev/null)"
  if [ -z "$canary" ]; then
    local repo=$(echo "$BUILDKITE_REPO" | sed -E 's#https://github.com/([^/]+)/([^/]+).git#\1/\2#g')
    local tag="$(curl -sL "https://api.github.com/repos/$repo/releases/latest" | jq -r ".tag_name")"
    if [ "$tag" == "null" ]; then
      canary="1"
    else
      local revision=$(curl -sL "https://api.github.com/repos/$repo/compare/$tag...$BUILDKITE_COMMIT" | jq -r ".ahead_by")
      if [ "$revision" == "null" ]; then
        canary="1"
      else
        canary="$revision"
      fi
    fi
    run_command buildkite-agent meta-data set canary "$canary"
  fi
}

function upload_buildkite_pipeline() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo "error: Cannot find pipeline: $path"
    exit 1
  fi
  run_command buildkite-agent pipeline upload "$path"
}

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

assert_build
assert_buildkite_agent
assert_jq
assert_curl
assert_release
assert_canary
upload_buildkite_pipeline ".buildkite/ci.yml"
