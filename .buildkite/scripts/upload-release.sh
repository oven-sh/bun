#!/bin/bash

set -eo pipefail

function assert_main() {
  if [[ "$BUILDKITE_PULL_REQUEST_REPO" && "$BUILDKITE_REPO" != "$BUILDKITE_PULL_REQUEST_REPO" ]]; then
    echo "error: Cannot upload release from a fork"
    exit 1
  fi
  if [ "$BUILDKITE_PULL_REQUEST" != "false" ]; then
    echo "error: Cannot upload release from a pull request"
    exit 1
  fi
  if [ "$BUILDKITE_BRANCH" != "main" ]; then
    echo "error: Cannot upload release from a branch other than main"
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

function assert_gh() {
  if ! command -v gh &> /dev/null; then
    echo "warning: gh is not installed, installing..."
    if command -v brew &> /dev/null; then
      brew install gh
    else
      echo "error: Cannot install gh, please install it:"
      echo "https://github.com/cli/cli#installation"
      exit 1
    fi
  fi
}

function assert_gh_token() {
  local token=$(buildkite-agent secret get GITHUB_TOKEN)
  if [ -z "$token" ]; then
    echo "error: Cannot find GITHUB_TOKEN secret"
    echo ""
    echo "hint: Create a secret named GITHUB_TOKEN with a GitHub access token:"
    echo "https://buildkite.com/docs/pipelines/buildkite-secrets"
    exit 1
  fi
  export GH_TOKEN="$token"
}

function download_artifact() {
  local name=$1
  buildkite-agent artifact download "$name" .
  if [ ! -f "$name" ]; then
    echo "error: Cannot find Buildkite artifact: $name"
    exit 1
  fi
}

function upload_assets() {
  local tag=$1
  local files=${@:2}
  gh release upload "$tag" $files --clobber --repo "$BUILDKITE_REPO"
}

assert_main
assert_buildkite_agent
assert_gh
assert_gh_token

declare artifacts=(
  bun-darwin-aarch64.zip
  bun-darwin-aarch64-profile.zip
  bun-darwin-x64.zip
  bun-darwin-x64-profile.zip
  bun-linux-aarch64.zip
  bun-linux-aarch64-profile.zip
  bun-linux-x64.zip
  bun-linux-x64-profile.zip
  bun-linux-x64-baseline.zip
  bun-linux-x64-baseline-profile.zip
  bun-windows-x64.zip
  bun-windows-x64-profile.zip
  bun-windows-x64-baseline.zip
  bun-windows-x64-baseline-profile.zip
)

for artifact in "${artifacts[@]}"; do
  download_artifact $artifact
done

upload_assets "canary" "${artifacts[@]}"
