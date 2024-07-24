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

function assert_buildkite_secret() {
  local key="$1"
  local value=$(buildkite-agent secret get "$key")
  if [ -z "$value" ]; then
    echo "error: Cannot find $key secret"
    echo ""
    echo "hint: Create a secret named $key with a value:"
    echo "https://buildkite.com/docs/pipelines/buildkite-secrets"
    exit 1
  fi
  export "$key"="$value"
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

function calculate_canary_revision() {
  local tag_name="$(curl -sL "https://api.github.com/repos/$BUILDKITE_REPO/releases/latest" | jq -r ".tag_name")"
  if [ "$tag_name" == "null" ]; then
    echo "1"
  else
    local ahead_by=$(curl -sL "https://api.github.com/repos/$BUILDKITE_REPO/compare/$tag_name...$BUILDKITE_COMMIT" | jq -r ".ahead_by")
    if [ "$ahead_by" == "null" ]; then
      echo "1"
    else
      echo "$ahead_by"
    fi
  fi
}

function upload_buildkite_pipeline() {
  local path="$1"
  if [ ! -f "$path" ]; then
    echo "error: Cannot find pipeline: $path"
    exit 1
  fi
  local pipeline="$(cat "$path")"
  local canary="$(buildkite-agent meta-data get canary 2>/dev/null || echo "1")"
  if [ "$canary" != "1" ] && [ "$canary" != "true" ]; then
    pipeline="$(echo "$pipeline" | sed "s/CANARY: \"0\"/CANARY: 0/g")"
  else
    local revision="$(calculate_canary_revision)"
    pipeline="$(echo "$pipeline" | sed "s/CANARY: 1/CANARY: \"$revision\"/g")"
  fi
  echo "$pipeline" | buildkite-agent pipeline upload
}

assert_build
assert_buildkite_agent
assert_buildkite_secret "GITHUB_TOKEN"
assert_jq
assert_curl
upload_buildkite_pipeline ".buildkite/ci.yml"
