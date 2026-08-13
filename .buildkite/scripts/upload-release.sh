#!/bin/bash

set -eo pipefail

function assert_main() {
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
  { local status=$?; set +x; } 2>/dev/null
  return "$status"
}

# Zips are read with unzip and written with cmake. Not one tool for both:
# `cmake -E tar xf` streams, so it exits 0 on a truncated archive and leaves a
# corrupt file behind where unzip exits 9, and `zip` is not on the agent image
# (which has no root to install it). cmake is what wrote these zips in the
# first place — scripts/build/ci.ts makeZip.
function assert_archive_tools() {
  for tool in "unzip" "cmake"; do
    if ! command -v "$tool" &> /dev/null; then
      echo "error: Cannot find $tool"
      echo ""
      echo "hint: the agent image is supposed to have it; see scripts/bootstrap.sh"
      exit 1
    fi
  done
}

# Tools this script installs go to a writable directory on PATH instead of
# /usr/local/bin, which needs root on most agents.
function ensure_tools_bin() {
  if [ -n "$TOOLS_BIN" ]; then
    return
  fi
  TOOLS_DIR="${HOME:-}/.cache/bun-release-tools"
  if [ -z "$HOME" ] || ! mkdir -p "$TOOLS_DIR/bin" 2> /dev/null; then
    TOOLS_DIR="$(mktemp -d)"
    mkdir -p "$TOOLS_DIR/bin"
  fi
  TOOLS_BIN="$TOOLS_DIR/bin"
  export PATH="$TOOLS_BIN:$PATH"
}

function install_gh_linux() {
  local arch
  case "$(uname -m)" in
    x86_64 | amd64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) echo "error: Unsupported architecture: $(uname -m)"; exit 1 ;;
  esac
  # Resolve the version from the releases/latest redirect, not the REST API: the API is rate
  # limited to 60 req/hour per IP (GITHUB_TOKEN is not exported yet), and piping curl into a
  # short-circuiting reader such as `grep -m1` makes curl exit 23 (EPIPE) under pipefail.
  local url version
  url="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/cli/cli/releases/latest")"
  version="${url##*/tag/v}"
  if [ -z "$version" ] || [ "$version" == "$url" ]; then
    echo "error: Cannot determine latest gh release version from: $url"
    exit 1
  fi
  local dir
  dir="$(mktemp -d)"
  run_command curl -fsSL "https://github.com/cli/cli/releases/download/v${version}/gh_${version}_linux_${arch}.tar.gz" -o "$dir/gh.tar.gz"
  run_command tar -xzf "$dir/gh.tar.gz" -C "$dir" --strip-components=1
  ensure_tools_bin
  run_command install -m 0755 "$dir/bin/gh" "$TOOLS_BIN/gh"
  rm -rf "$dir"
}

function install_aws_linux() {
  local dir
  dir="$(mktemp -d)"
  run_command curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "$dir/awscliv2.zip"
  run_command unzip -q "$dir/awscliv2.zip" -d "$dir"
  ensure_tools_bin
  run_command "$dir/aws/install" --update -i "$TOOLS_DIR/aws-cli" -b "$TOOLS_BIN"
  rm -rf "$dir"
}

function install_sentry_cli_linux() {
  # The installer drops a single static binary into INSTALL_DIR.
  ensure_tools_bin
  run_command bash -c "curl -fsSL https://sentry.io/get-cli/ | INSTALL_DIR='$TOOLS_BIN' sh"
}

function assert_command() {
  local command="$1"
  local package="$2"
  local help_url="$3"
  if command -v "$command" &> /dev/null; then
    return
  fi
  echo "warning: $command is not installed, installing..."
  if command -v brew &> /dev/null; then
    HOMEBREW_NO_AUTO_UPDATE=1 run_command brew install "$package"
  elif [ "$(uname -s)" == "Linux" ]; then
    case "$command" in
      gh) install_gh_linux ;;
      aws) install_aws_linux ;;
      sentry-cli) install_sentry_cli_linux ;;
      *) echo "error: Don't know how to install $command on Linux"; exit 1 ;;
    esac
  else
    echo "error: Cannot install $command, please install it"
    if [ -n "$help_url" ]; then
      echo ""
      echo "hint: See $help_url for help"
    fi
    exit 1
  fi
  if ! command -v "$command" &> /dev/null; then
    echo "error: Failed to install $command"
    if [ -n "$help_url" ]; then
      echo ""
      echo "hint: See $help_url for help"
    fi
    exit 1
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
  # When signing ran, Windows zips exist in two steps with the same name
  # (build-bun unsigned, windows-sign signed). Pin to the sign step to
  # guarantee we get the signed one.
  local step_args=()
  if [[ -n "$WINDOWS_ARTIFACT_STEP" && "$name" == bun-windows-* ]]; then
    step_args=(--step "$WINDOWS_ARTIFACT_STEP")
  fi
  run_command buildkite-agent artifact download "$name" "$dir" "${step_args[@]}"
  if [ ! -f "$dir/$name" ]; then
    echo "error: Cannot find Buildkite artifact: $name"
    exit 1
  fi
}

function upload_github_assets() {
  local tag="$(release_tag "$1")"
  run_command gh release upload "$tag" "${@:2}" --clobber --repo "$BUILDKITE_REPO"
}

function update_github_release() {
  local version="$1"
  local tag="$(release_tag "$version")"
  if [ "$tag" == "canary" ]; then
    run_command gh release edit "$tag" --repo "$BUILDKITE_REPO" \
      --notes "This release of Bun corresponds to the commit: $BUILDKITE_COMMIT"
  fi
}

# S3 is a mirror; `bun upgrade` and install.sh read the GitHub release. A
# canary that made it to GitHub but not S3 has shipped, so don't fail it.
function upload_s3_files() {
  local version="$1"
  local files=("${@:2}")
  local commit_folder="releases/$BUILDKITE_COMMIT"
  if [ "$version" == "canary" ]; then
    commit_folder="$commit_folder-canary"
  fi
  local status=0 file
  for file in "${files[@]}"; do
    run_command aws --endpoint-url="$AWS_ENDPOINT" s3 cp "$file" "s3://$AWS_BUCKET/$commit_folder/$file" || status=1
    run_command aws --endpoint-url="$AWS_ENDPOINT" s3 cp "$file" "s3://$AWS_BUCKET/releases/$version/$file" || status=1
  done
  if [ "$status" -eq 0 ]; then
    return 0
  fi
  if [ "$version" == "canary" ]; then
    echo "warn: Some S3 uploads failed, ignoring since this is a canary release"
    return 0
  fi
  echo "error: Some S3 uploads failed"
  exit 1
}

function send_discord_announcement() {
  local value=$(buildkite-agent secret get "BUN_ANNOUNCE_CANARY_WEBHOOK_URL")
  if [ -z "$value" ]; then
    echo "warn: BUN_ANNOUNCE_CANARY_WEBHOOK_URL not set, skipping Discord announcement"
    return
  fi

  local version="$1"
  local commit="$BUILDKITE_COMMIT"
  local short_sha="${commit:0:7}"
  local commit_url="https://github.com/oven-sh/bun/commit/$commit"

  if [ "$version" == "canary" ]; then
    local json_payload=$(cat <<EOF
{
  "embeds": [{
    "title": "New Bun Canary now available",
    "description": "A new canary build of Bun has been automatically uploaded ([${short_sha}](${commit_url})). To upgrade, run:\n\n\`\`\`shell\nbun upgrade --canary\n\`\`\`\nCommit: \`${commit}\`",
    "color": 16023551,
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  }]
}
EOF
)
    
    curl -H "Content-Type: application/json" \
         -d "$json_payload" \
         -sf \
         "$value" >/dev/null
  fi
}

function create_release() {
  assert_main
  assert_buildkite_agent
  assert_archive_tools
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
    bun-linux-aarch64-musl.zip
    bun-linux-aarch64-musl-profile.zip
    bun-linux-x64-musl.zip
    bun-linux-x64-musl-profile.zip
    bun-linux-aarch64-android.zip
    bun-linux-aarch64-android-profile.zip
    bun-linux-x64-android.zip
    bun-linux-x64-android-profile.zip
    bun-freebsd-aarch64.zip
    bun-freebsd-aarch64-profile.zip
    bun-freebsd-x64.zip
    bun-freebsd-x64-profile.zip
    bun-windows-x64.zip
    bun-windows-x64-profile.zip
    bun-windows-aarch64.zip
    bun-windows-aarch64-profile.zip
  )

  # x64 ships one nehalem binary under the plain name. Re-zip it under the
  # historical `-baseline` name (inner dir renamed) so older `bun upgrade`
  # clients that still request `-baseline` extract correctly.
  function alias_baseline_artifact() {
    local artifact="$1"
    case "$artifact" in
      bun-darwin-x64.zip)              echo "bun-darwin-x64-baseline.zip" ;;
      bun-darwin-x64-profile.zip)      echo "bun-darwin-x64-baseline-profile.zip" ;;
      bun-linux-x64.zip)               echo "bun-linux-x64-baseline.zip" ;;
      bun-linux-x64-profile.zip)       echo "bun-linux-x64-baseline-profile.zip" ;;
      bun-linux-x64-musl.zip)          echo "bun-linux-x64-musl-baseline.zip" ;;
      bun-linux-x64-musl-profile.zip)  echo "bun-linux-x64-musl-baseline-profile.zip" ;;
      bun-windows-x64.zip)             echo "bun-windows-x64-baseline.zip" ;;
      bun-windows-x64-profile.zip)     echo "bun-windows-x64-baseline-profile.zip" ;;
      *)                               echo "" ;;
    esac
  }

  # Repack `$src_zip` (inner dir = basename of $src_zip) as `$dst_zip` with the
  # inner dir renamed to match `$dst_zip`'s basename, which is what install.sh
  # extracts. Not done in the build step's makeZip, where the staging dir is
  # already in hand: the Windows zips are re-uploaded by the signing step, so
  # an alias built there would carry the unsigned binary. Runs in a fresh
  # mktemp dir so a caller-CWD change can't collide with the extracted names.
  function rezip_as() {
    local src_zip="$1" dst_zip="$2"
    local src_dir="${src_zip%.zip}" dst_dir="${dst_zip%.zip}"
    local abs_src="$PWD/$src_zip" abs_dst="$PWD/$dst_zip"
    local work; work="$(mktemp -d)"
    run_command unzip -q -d "$work" "$abs_src"
    run_command mv "$work/$src_dir" "$work/$dst_dir"
    (cd "$work" && run_command cmake -E tar cf "$abs_dst" --format=zip "$dst_dir")
    run_command rm -rf "$work"
  }

  # Fetch everything up front so the GitHub release can take all assets in one
  # `gh release upload`; per-file uploads raced on the same release.
  local files=() pids=() artifact
  for artifact in "${artifacts[@]}"; do
    download_buildkite_artifact "$artifact" & pids+=("$!")
    files+=("$artifact")
  done
  # Per-pid: a bare `wait` returns 0 however the children exited.
  local pid status=0
  for pid in "${pids[@]}"; do
    wait "$pid" || status=1
  done
  if [ "$status" -ne 0 ]; then
    echo "error: Failed to download one or more Buildkite artifacts"
    exit 1
  fi
  for artifact in "${artifacts[@]}"; do
    local alias="$(alias_baseline_artifact "$artifact")"
    if [ -n "$alias" ]; then
      rezip_as "$artifact" "$alias"
      files+=("$alias")
    fi
  done

  upload_github_assets "$tag" "${files[@]}"
  update_github_release "$tag"
  create_sentry_release "$tag"
  send_discord_announcement "$tag"
  upload_s3_files "$tag" "${files[@]}"
}

function assert_canary() {
  if [ -z "$CANARY" ] || [ "$CANARY" == "0" ]; then
    echo "warn: Skipping release because this is not a canary build"
    exit 0
  fi
}

assert_canary
create_release "canary"
