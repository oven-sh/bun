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

function assert_zip() {
  command -v zip &> /dev/null || package_manager_install zip
  command -v unzip &> /dev/null || package_manager_install unzip
}

function run_command() {
  set -x
  "$@"
  { set +x; } 2>/dev/null
}

function maybe_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    run_command "$@"
  elif command -v sudo &> /dev/null; then
    run_command sudo "$@"
  else
    run_command "$@"
  fi
}

function package_manager_install() {
  if command -v dnf &> /dev/null; then
    maybe_sudo dnf install -y "$@"
  elif command -v yum &> /dev/null; then
    maybe_sudo yum install -y "$@"
  elif command -v apt-get &> /dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    maybe_sudo apt-get install -y "$@"
  elif command -v apk &> /dev/null; then
    maybe_sudo apk add "$@"
  else
    echo "error: No supported package manager found to install: $*"
    exit 1
  fi
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
  maybe_sudo install -m 0755 "$dir/bin/gh" /usr/local/bin/gh
  rm -rf "$dir"
}

function install_aws_linux() {
  command -v unzip &> /dev/null || package_manager_install unzip
  local dir
  dir="$(mktemp -d)"
  run_command curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "$dir/awscliv2.zip"
  run_command unzip -q "$dir/awscliv2.zip" -d "$dir"
  maybe_sudo "$dir/aws/install" --update
  rm -rf "$dir"
}

function install_sentry_cli_linux() {
  # The installer drops a single static binary into INSTALL_DIR.
  maybe_sudo bash -c "curl -fsSL https://sentry.io/get-cli/ | INSTALL_DIR=/usr/local/bin sh"
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
  assert_github
  assert_aws
  assert_sentry
  assert_zip

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

  # x64 builds only baseline (Nehalem). The -baseline names are copies of
  # the plain zip with the inner directory renamed to match, since bun upgrade
  # and the install scripts require the folder name to equal the zip name.
  local -A baseline_alias=(
    [bun-linux-x64]=bun-linux-x64-baseline
    [bun-linux-x64-profile]=bun-linux-x64-baseline-profile
    [bun-linux-x64-musl]=bun-linux-x64-musl-baseline
    [bun-linux-x64-musl-profile]=bun-linux-x64-musl-baseline-profile
    [bun-windows-x64]=bun-windows-x64-baseline
    [bun-windows-x64-profile]=bun-windows-x64-baseline-profile
  )

  function repackage_baseline() {
    local src="$1" dst="$2"
    rm -rf "$src" "$dst" "$dst.zip"
    unzip -q "$src.zip"
    mv "$src" "$dst"
    zip -qry "$dst.zip" "$dst" # inner folder is $dst
    rm -rf "$dst"
  }

  function upload_file() {
    local file="$1"
    if [ "$tag" == "canary" ]; then
      upload_s3_file "releases/$BUILDKITE_COMMIT-canary" "$file" &
    else
      upload_s3_file "releases/$BUILDKITE_COMMIT" "$file" &
    fi
    upload_s3_file "releases/$tag" "$file" &
    upload_github_asset "$tag" "$file" &
    wait
  }

  function upload_artifact() {
    local artifact="$1"
    download_buildkite_artifact "$artifact"
    local alias="${baseline_alias[${artifact%.zip}]}"
    if [ -n "$alias" ]; then
      # Build the alias before publishing either so the pair uploads together.
      repackage_baseline "${artifact%.zip}" "$alias"
      upload_file "$artifact"
      upload_file "$alias.zip"
    else
      upload_file "$artifact"
    fi
  }

  for artifact in "${artifacts[@]}"; do
    upload_artifact "$artifact"
  done

  update_github_release "$tag"
  create_sentry_release "$tag"
  send_discord_announcement "$tag"
}

function assert_canary() {
  if [ -z "$CANARY" ] || [ "$CANARY" == "0" ]; then
    echo "warn: Skipping release because this is not a canary build"
    exit 0
  fi
}

assert_canary
create_release "canary"
