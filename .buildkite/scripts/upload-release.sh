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
  local name="$(basename "$file")"
  run_command gh release upload "$tag" "$file" --clobber --repo "$BUILDKITE_REPO"

  # Sometimes the upload fails, maybe this is a race condition in the gh CLI?
  #
  # Query asset names one-per-line via --json so we can exact-match the full
  # line. A plain substring `grep -c "$file"` would false-positive when one
  # asset name is a prefix of another — e.g. SHASUMS256.txt vs
  # SHASUMS256.txt.asc — and skip the retry even though the file is missing.
  while [ "$(gh release view "$tag" --repo "$BUILDKITE_REPO" --json assets --jq '.assets[].name' | grep -cFx -- "$name")" -eq 0 ]; do
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

function sign_and_upload_manifest() {
  # Generate SHASUMS256.txt (always) and SHASUMS256.txt.asc (when the
  # Buildkite GPG secrets exist) for the canonical artifact list in the
  # current working directory, then upload both to the release.
  #
  # Rollout: before GPG_PRIVATE_KEY / GPG_PASSPHRASE are provisioned in
  # Buildkite, the helper writes SHASUMS256.txt only and the wrapper
  # uploads just that. Users running `sha256sum -c` get accurate hashes
  # immediately; the daily .github/workflows/release.yml sign cron still
  # regenerates the matching SHASUMS256.txt.asc within 24h. Once both
  # secrets exist every canary push signs inline and the .asc stays
  # byte-in-step with the .txt.
  #
  # See: https://github.com/oven-sh/bun/issues/28931
  local version="$1"
  shift
  local artifacts=("$@")

  local gpg_private_key
  local gpg_passphrase
  gpg_private_key=$(buildkite-agent secret get "GPG_PRIVATE_KEY" 2>/dev/null || true)
  gpg_passphrase=$(buildkite-agent secret get "GPG_PASSPHRASE" 2>/dev/null || true)

  if [ -n "$gpg_private_key" ] && [ -n "$gpg_passphrase" ]; then
    assert_command "gpg" "gnupg" "https://gnupg.org/download/"
  else
    echo "warn: GPG_PRIVATE_KEY/GPG_PASSPHRASE not set in Buildkite secrets;"
    echo "warn: uploading SHASUMS256.txt unsigned. The daily sign workflow"
    echo "warn: will catch up with a matching SHASUMS256.txt.asc within 24h."
  fi

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

  # `set -e` would kill the pipeline on a non-zero exit, so capture the
  # helper's exit via `|| sign_exit=$?`.
  local sign_exit=0
  GPG_PRIVATE_KEY="$gpg_private_key" \
  GPG_PASSPHRASE="$gpg_passphrase" \
    "$script_dir/scripts/sign-release-manifest.sh" "$PWD" "${artifacts[@]}" \
    || sign_exit=$?

  if [ "$sign_exit" -ne 0 ]; then
    echo "error: failed to generate SHASUMS256.txt (exit $sign_exit)"
    return "$sign_exit"
  fi

  upload_github_asset "$version" SHASUMS256.txt
  # The helper only writes .asc when the GPG secrets were present. Upload
  # it opportunistically so the unsigned fallback path stays a no-op here.
  if [ -f SHASUMS256.txt.asc ]; then
    upload_github_asset "$version" SHASUMS256.txt.asc
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
    bun-linux-aarch64-musl.zip
    bun-linux-aarch64-musl-profile.zip
    bun-linux-x64-musl.zip
    bun-linux-x64-musl-profile.zip
    bun-linux-x64-musl-baseline.zip
    bun-linux-x64-musl-baseline-profile.zip
    bun-windows-x64.zip
    bun-windows-x64-profile.zip
    bun-windows-x64-baseline.zip
    bun-windows-x64-baseline-profile.zip
    bun-windows-aarch64.zip
    bun-windows-aarch64-profile.zip
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

  # Hash and sign the canonical archive list in place, then upload the
  # manifest. Must run after every archive has been uploaded so that the
  # sha256 entries in SHASUMS256.txt match what GitHub now serves.
  sign_and_upload_manifest "$tag" "${artifacts[@]}"

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
