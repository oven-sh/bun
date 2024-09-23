#!/bin/bash

set -eo pipefail

function assert_main() {
  if [ "$RELEASE" == "1" ]; then
    echo "info: Skipping canary release because this is a release build"
    exit 0
  fi
  if [ -z "$BUILDKITE_REPO" ]; then
    echo "error: Cannot find repository for this build"
    exit 1
  fi
  if [ -z "$BUILDKITE_COMMIT" ]; then
    echo "error: Cannot find commit for this build"
    exit 1
  fi
  if [ -n "$BUILDKITE_PULL_REQUEST_REPO" ] && [ "$BUILDKITE_REPO" != "$BUILDKITE_PULL_REQUEST_REPO" ]; then
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
  if ! command -v "buildkite-agent" &> /dev/null; then
    echo "error: Cannot find buildkite-agent, please install it:"
    echo "https://buildkite.com/docs/agent/v3/install"
    exit 1
  fi
}

function assert_github() {
  assert_command "gh" "gh" "https://github.com/cli/cli#installation"
  assert_buildkite_secret "GITHUB_TOKEN"
  # gh expects the token in $GH_TOKEN
  export GH_TOKEN="$GITHUB_TOKEN"
}

function assert_aws() {
  assert_command "aws" "awscli" "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html"
  for secret in "AWS_ACCESS_KEY_ID" "AWS_SECRET_ACCESS_KEY" "AWS_ENDPOINT"; do
    assert_buildkite_secret "$secret"
  done
  assert_buildkite_secret "AWS_BUCKET" --skip-redaction
}

function assert_sentry() {
  assert_command "sentry-cli" "getsentry/tools/sentry-cli" "https://docs.sentry.io/cli/installation/"
  for secret in "SENTRY_AUTH_TOKEN" "SENTRY_ORG" "SENTRY_PROJECT"; do
    assert_buildkite_secret "$secret"
  done
}

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

function assert_command() {
  local command="$1"
  local package="$2"
  local help_url="$3"
  if ! command -v "$command" &> /dev/null; then
    echo "warning: $command is not installed, installing..."
    if command -v brew &> /dev/null; then
      HOMEBREW_NO_AUTO_UPDATE=1 run_command brew install "$package"
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

function assert_buildkite_secret() {
  local key="$1"
  local value=$(buildkite-agent secret get "$key" ${@:2})
  if [ -z "$value" ]; then
    echo "error: Cannot find $key secret"
    echo ""
    echo "hint: Create a secret named $key with a value:"
    echo "https://buildkite.com/docs/pipelines/buildkite-secrets"
    exit 1
  fi
  export "$key"="$value"
}

function release_tag() {
  local version="$1"
  if [ "$version" == "canary" ]; then
    echo "canary"
  else
    echo "bun-v$version"
  fi
}

function create_sentry_release() {
  local version="$1"
  local release="$version"
  if [ "$version" == "canary" ]; then
    release="$BUILDKITE_COMMIT-canary"
  fi
  run_command sentry-cli releases new "$release" --finalize
  run_command sentry-cli releases set-commits "$release" --auto --ignore-missing
  if [ "$version" == "canary" ]; then
    run_command sentry-cli deploys new --env="canary" --release="$release"
  fi
}

function download_buildkite_artifact() {
  local name="$1"
  local dir="$2"
  if [ -z "$dir" ]; then
    dir="."
  fi
  run_command buildkite-agent artifact download "$name" "$dir"
  if [ ! -f "$dir/$name" ]; then
    echo "error: Cannot find Buildkite artifact: $name"
    exit 1
  fi
}

function upload_github_asset() {
  local version="$1"
  local tag="$(release_tag "$version")"
  local file="$2"
  run_command gh release upload "$tag" "$file" --clobber --repo "$BUILDKITE_REPO"

  # Sometimes the upload fails, maybe this is a race condition in the gh CLI?
  while [ "$(gh release view "$tag" --repo "$BUILDKITE_REPO" | grep -c "$file")" -eq 0 ]; do
    echo "warn: Uploading $file to $tag failed, retrying..."
    sleep "$((RANDOM % 5 + 1))"
    run_command gh release upload "$tag" "$file" --clobber --repo "$BUILDKITE_REPO"
  done
}

function update_github_release() {
  local version="$1"
  local tag="$(release_tag "$version")"
  if [ "$tag" == "canary" ]; then
    sleep 5 # There is possibly a race condition where this overwrites artifacts?
    run_command gh release edit "$tag" --repo "$BUILDKITE_REPO" \
      --notes "This release of Bun corresponds to the commit: $BUILDKITE_COMMIT"
  fi
}

function upload_s3_file() {
  local folder="$1"
  local file="$2"
  run_command aws --endpoint-url="$AWS_ENDPOINT" s3 cp "$file" "s3://$AWS_BUCKET/$folder/$file"
}

function create_release() {
  assert_main
  assert_buildkite_agent
  assert_github
  assert_aws
  assert_sentry

  local tag="$1" # 'canary' or 'x.y.z'
  local artifacts=(
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

  function upload_artifact() {
    local artifact="$1"
    download_buildkite_artifact "$artifact"
    if [ "$tag" == "canary" ]; then
      upload_s3_file "releases/$BUILDKITE_COMMIT-canary" "$artifact" &
    else
      upload_s3_file "releases/$BUILDKITE_COMMIT" "$artifact" &
    fi
    upload_s3_file "releases/$tag" "$artifact" &
    upload_github_asset "$tag" "$artifact" &
    wait
  }

  for artifact in "${artifacts[@]}"; do
    upload_artifact "$artifact"
  done

  update_github_release "$tag"
  create_sentry_release "$tag"
}

function assert_canary() {
  local canary="$(buildkite-agent meta-data get canary 2>/dev/null)"
  if [ -z "$canary" ] || [ "$canary" == "0" ]; then
    echo "warn: Skipping release because this is not a canary build"
    exit 0
  fi
}

assert_canary
create_release "canary"
