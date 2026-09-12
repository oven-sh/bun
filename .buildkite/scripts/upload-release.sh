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

function sign_and_upload_manifest() {
  # Generate SHASUMS256.txt (always) and SHASUMS256.txt.asc (when the
  # Buildkite GPG secrets exist) for the uploaded file list in the
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

  # Fetch each GPG secret separately so a real backend failure (network
  # down, auth error, agent crash, expired token) surfaces in the log
  # instead of being silently swallowed into an empty string. The exit
  # code alone can't reliably distinguish "secret genuinely not
  # configured" (the expected rollout-fallback state) from "backend
  # temporarily broken" — so we capture stderr on each call and echo it
  # as a `warn:` line when the fetch fails. The value is treated as
  # unset either way (preserving rollout safety), but the operator has
  # a breadcrumb in the log to triage the difference manually.
  #
  # Every diagnostic echo ends in `>&2 || true`: Buildkite multiplexes
  # stdout/stderr through one log-aggregator process, and if it dies
  # (OOM, agent restart) the kernel delivers SIGPIPE on every fd
  # writing to it. Under `set -eo pipefail` an unguarded echo would
  # exit 141 before sign-release-manifest.sh ever ran, leaving
  # SHASUMS256.txt ungenerated on that canary push.
  local gpg_private_key=""
  local gpg_passphrase=""
  local _key_lookup_failed=0
  local _pass_lookup_failed=0
  local _secret_err
  _secret_err=$(mktemp)
  if ! gpg_private_key=$(buildkite-agent secret get "GPG_PRIVATE_KEY" 2>"$_secret_err"); then
    gpg_private_key=""
    _key_lookup_failed=1
    if [ -s "$_secret_err" ]; then
      echo "warn: buildkite-agent secret get GPG_PRIVATE_KEY failed (treating as unset):" >&2 || true
      sed 's/^/warn:   /' "$_secret_err" >&2 || true
    fi
  fi
  : > "$_secret_err"
  if ! gpg_passphrase=$(buildkite-agent secret get "GPG_PASSPHRASE" 2>"$_secret_err"); then
    gpg_passphrase=""
    _pass_lookup_failed=1
    if [ -s "$_secret_err" ]; then
      echo "warn: buildkite-agent secret get GPG_PASSPHRASE failed (treating as unset):" >&2 || true
      sed 's/^/warn:   /' "$_secret_err" >&2 || true
    fi
  fi
  rm -f "$_secret_err"

  # If EITHER lookup failed while the other succeeded, clear both to the
  # unsigned-fallback state instead of letting the partial-config branch
  # below hard-fail the canary run. A transient backend blip on one
  # fetch (while both secrets are actually configured) is
  # indistinguishable from a half-provisioned secret state using the
  # exit code alone, so we trade strict partial-config detection for
  # release resilience: both events still leave a clear `warn:` trail
  # in the log, and the daily sign cron self-heals within 24h.
  if [ "${_key_lookup_failed}" -ne 0 ] || [ "${_pass_lookup_failed}" -ne 0 ]; then
    gpg_private_key=""
    gpg_passphrase=""
  fi
  unset -v _key_lookup_failed _pass_lookup_failed

  # Three-way state handling: both-set (sign), neither-set (unsigned
  # rollout fallback), exactly-one-set (hard error before the helper
  # runs — almost always a typo in a secret name, and a distinct error
  # here beats the confusing rollout-warning-then-helper-error pair).
  if [ -n "$gpg_private_key" ] && [ -n "$gpg_passphrase" ]; then
    # Inline probe, not assert_command: assert_command `exit`s on a
    # missing tool, which would terminate the whole script and bypass
    # the fail-soft `||` guard at this function's call site. A `return`
    # keeps the failure inside the guard.
    if ! command -v gpg >/dev/null 2>&1; then
      echo "error: gpg is not installed; cannot sign manifest" >&2 || true
      return 1
    fi
  elif [ -n "$gpg_private_key" ] || [ -n "$gpg_passphrase" ]; then
    echo "error: only one of GPG_PRIVATE_KEY / GPG_PASSPHRASE is set in Buildkite secrets;" >&2 || true
    echo "error: both are required to sign, or both unset to publish unsigned." >&2 || true
    return 1
  else
    echo "warn: GPG_PRIVATE_KEY/GPG_PASSPHRASE not set in Buildkite secrets;" >&2 || true
    echo "warn: uploading SHASUMS256.txt unsigned. The daily sign workflow" >&2 || true
    echo "warn: will catch up with a matching SHASUMS256.txt.asc within 24h." >&2 || true
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
    echo "error: failed to generate SHASUMS256.txt (exit $sign_exit)" >&2 || true
    return "$sign_exit"
  fi

  # Only upload .asc when THIS run actually signed (gpg secrets
  # present). A bare `[ -f SHASUMS256.txt.asc ]` would upload a stale
  # .asc left behind by a previous run on a reused workspace and
  # reintroduce the manifest/signature drift this function exists to
  # close. Gating on the secrets is defense-in-depth on top of the
  # helper's own stale-.asc removal.
  local manifest_files=(SHASUMS256.txt)
  if [ -n "$gpg_private_key" ] && [ -n "$gpg_passphrase" ] && [ -f SHASUMS256.txt.asc ]; then
    manifest_files+=(SHASUMS256.txt.asc)
  fi
  upload_github_assets "$version" "${manifest_files[@]}"
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
  # Hash and optionally clearsign the full uploaded file list (including
  # the re-zipped baseline aliases) in place, then upload the manifest.
  # Must run after upload_github_assets so the sha256 entries in
  # SHASUMS256.txt match the archive bytes GitHub now serves — signing
  # in the same run as the upload is the fix for the .txt/.asc drift in
  # https://github.com/oven-sh/bun/issues/28931.
  # Guarded: a manifest/signing failure must not abort the script between
  # the archive upload and the remaining release steps. The daily sign
  # cron self-heals the manifest on the next pass.
  sign_and_upload_manifest "$tag" "${files[@]}" \
    || echo "warn: manifest sign/upload failed (exit $?); the daily sign cron will catch up" >&2 || true
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
