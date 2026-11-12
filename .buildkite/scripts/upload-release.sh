#!/bin/bash

# upload-release.sh canary: replaces the files of the canary release, on main.
# upload-release.sh draft: replaces the draft releases of a release branch.

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
    echo "https://buildkite.com/docs/agent/self-hosted/install"
    exit 1
  fi
}

function assert_github() {
  assert_command "gh" "gh" "https://github.com/cli/cli#installation"
  assert_buildkite_secret "GITHUB_APP_BUN_RELEASE_UPLOAD_PRIVATE_KEY_BASE64"
  local pem
  pem="$(openssl base64 -d -A <<< "$GITHUB_APP_BUN_RELEASE_UPLOAD_PRIVATE_KEY_BASE64")"
  unset GITHUB_APP_BUN_RELEASE_UPLOAD_PRIVATE_KEY_BASE64
  # The bun-release-upload app's client ID, and the ID of its installation on oven-sh.
  create_github_app_token "Iv23li0GlmKSYj59x7e3" "177437987" "$pem"
  buildkite-agent redactor add <<< "$GH_TOKEN"
}

# Exports an installation access token as $GH_TOKEN, where gh expects it. The JWT is GitHub's example:
# https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app#example-using-bash-to-generate-a-jwt
function create_github_app_token() {
  local client_id="$1"
  local installation_id="$2"
  local pem="$3"

  local now=$(date +%s)
  local iat=$((${now} - 60)) # Issues 60 seconds in the past
  local exp=$((${now} + 300)) # Expires 5 minutes in the future

  function b64enc() { openssl base64 | tr -d '=' | tr '/+' '_-' | tr -d '\n'; }

  local header_json='{
    "typ":"JWT",
    "alg":"RS256"
}'
  local payload_json="{
    \"iat\":${iat},
    \"exp\":${exp},
    \"iss\":\"${client_id}\"
}"
  local header payload signature
  header=$( echo -n "${header_json}" | b64enc )
  payload=$( echo -n "${payload_json}" | b64enc )
  local header_payload="${header}"."${payload}"
  signature=$(
    openssl dgst -sha256 -sign <(echo -n "${pem}") \
    <(echo -n "${header_payload}") | b64enc
  )
  local jwt="${header_payload}"."${signature}"

  local response
  if ! response="$(curl --silent --show-error --fail-with-body --request POST \
    --url "https://api.github.com/app/installations/${installation_id}/access_tokens" \
    --header "Accept: application/vnd.github+json" \
    --header "Authorization: Bearer ${jwt}" \
    --header "X-GitHub-Api-Version: 2026-03-10")"; then
    echo "error: Cannot create a GitHub App installation access token"
    echo ""
    echo "$response"
    exit 1
  fi
  GH_TOKEN="$(jq --raw-output ".token" <<< "$response")"
  export GH_TOKEN
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
      echo "hint: the agent image is supposed to have it; see scripts/build/ci-images/spec.ts"
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
  # limited to 60 req/hour per IP (GH_TOKEN is not exported yet), and piping curl into a
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
  # A signed zip has the name of the unsigned one that build-bun uploaded.
  local step_args=()
  if [ "$kind" == "draft" ]; then
    case "$name" in
      bun-windows-*) step_args=(--step "windows-sign") ;;
      bun-darwin-*) step_args=(--step "darwin-sign") ;;
    esac
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

# Puts the files of a release in the current directory, and their names in $files.
function download_release_files() {
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
      bun-linux-x64-android.zip)       echo "bun-linux-x64-android-baseline.zip" ;;
      bun-linux-x64-android-profile.zip) echo "bun-linux-x64-android-baseline-profile.zip" ;;
      bun-freebsd-x64.zip)             echo "bun-freebsd-x64-baseline.zip" ;;
      bun-freebsd-x64-profile.zip)     echo "bun-freebsd-x64-baseline-profile.zip" ;;
      bun-windows-x64.zip)             echo "bun-windows-x64-baseline.zip" ;;
      bun-windows-x64-profile.zip)     echo "bun-windows-x64-baseline-profile.zip" ;;
      *)                               echo "" ;;
    esac
  }

  # Repack `$src_zip` (inner dir = basename of $src_zip) as `$dst_zip` with the
  # inner dir renamed to match `$dst_zip`'s basename, which is what install.sh
  # extracts. Not done in the build step's makeZip, where the staging dir is
  # already in hand: signed zips are re-uploaded by the signing steps, so
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
  files=()
  local pids=() artifact
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
}

function create_canary() {
  assert_main
  assert_buildkite_agent
  assert_archive_tools
  assert_github
  assert_aws
  assert_sentry

  download_release_files
  upload_github_assets "canary" "${files[@]}"
  update_github_release "canary"
  create_sentry_release "canary"
  send_discord_announcement "canary"
  upload_s3_files "canary" "${files[@]}"
}

function print_release_notes() {
  local version="$1" previous_tag="$2"
  # From commits, because GitHub's generated notes find no pull request behind a cherry-picked commit.
  local contributors
  contributors="$(
    gh api --paginate "repos/oven-sh/bun/compare/$previous_tag...$BUILDKITE_COMMIT?per_page=100" \
      --jq '.commits[].author | select(.type == "User") | .login' | LC_ALL=C sort --unique --ignore-case
  )"
  cat << EOF
To install Bun v$version
\`\`\`bash
curl -fsSL https://bun.com/install | bash
# or you can use npm
# npm install -g bun
\`\`\`

Windows:
\`\`\`bash
powershell -c "irm bun.com/install.ps1|iex"
\`\`\`

To upgrade to Bun v$version:
\`\`\`bash
bun upgrade
\`\`\`

### [Read Bun v$version's release notes on Bun's blog](https://bun.com/blog/bun-v$version)

### Thanks to $(wc -w <<< "$contributors") contributors!

EOF
  local login
  for login in $contributors; do
    echo "- [@$login](https://github.com/$login)"
  done
}

function list_drafts() {
  local repo="$1" tag="$2"
  gh api --paginate "repos/$repo/releases?per_page=100" \
    --jq ".[] | select(.draft and .tag_name == \"$tag\") | .id"
}

# By id: the `gh release` commands that take a tag also match a published release.
function delete_drafts() {
  local repo="$1" tag="$2" ids id
  ids="$(list_drafts "$repo" "$tag")"
  for id in $ids; do
    run_command gh api --method DELETE "repos/$repo/releases/$id"
  done
}

# Prints the id of the draft, once it is known to hold the expected files.
function verify_draft() {
  local repo="$1" tag="$2" expected="$3" id actual
  id="$(list_drafts "$repo" "$tag")" || return
  if ! [[ "$id" =~ ^[0-9]+$ ]]; then
    echo "error: Expected one draft of $tag on $repo, found:" ${id:-none} >&2
    return 1
  fi
  actual="$(
    gh api --paginate "repos/$repo/releases/$id/assets?per_page=100" \
      --jq '.[] | "\(.digest)  \(.name)"' | sort
  )" || return
  if [ "$actual" != "$expected" ]; then
    echo "error: The files of the draft on $repo are not the files of this build" >&2
    diff <(echo "$expected") <(echo "$actual") >&2
    return 1
  fi
  echo "$id"
}

# Prints the URL of the draft.
function rename_draft() {
  local repo="$1" tag="$2" id="$3" title="$4"
  # Editing a draft without its tag_name clears the tag.
  gh api --method PATCH "repos/$repo/releases/$id" -f tag_name="$tag" -f name="$title" --jq ".html_url"
}

function create_drafts() {
  assert_buildkite_agent
  assert_archive_tools
  download_release_files
  assert_github

  # Checked when the build started, but the branch and the tags can have moved since.
  local previous_tag
  previous_tag="$(node scripts/check-release.ts)"

  local tag="${BUILDKITE_BRANCH#release/}"
  local version="${tag#bun-v}"
  local repo="oven-sh/bun" updater_repo="oven-sh/bun-releases-for-updater"
  local notes
  notes="$(mktemp)"
  print_release_notes "$version" "$previous_tag" > "$notes"

  delete_drafts "$repo" "$tag"
  delete_drafts "$updater_repo" "$tag"

  local title="Bun v$version"
  run_command gh release create "$tag" "${files[@]}" --repo "$repo" --draft \
    --title "$title (incomplete, do not publish)" --target "$BUILDKITE_COMMIT" --notes-file "$notes"
  run_command gh release create "$tag" "${files[@]}" --repo "$updater_repo" --draft \
    --title "$title (incomplete, do not publish)" --notes "bunbunbun"

  local digests id updater_id url updater_url
  digests="$(sha256sum "${files[@]}" | sed "s/^/sha256:/" | sort)"
  id="$(verify_draft "$repo" "$tag" "$digests")"
  updater_id="$(verify_draft "$updater_repo" "$tag" "$digests")"
  # The draft that is published first is the last to look ready.
  updater_url="$(rename_draft "$updater_repo" "$tag" "$updater_id" "$title")"
  url="$(rename_draft "$repo" "$tag" "$id" "$title")"

  buildkite-agent annotate --context "release" --style "success" --priority 10 << EOF
The drafts of $title are ready. Check the tests of this build, then publish them in this order:

1. [$repo]($url)
2. [$updater_repo]($updater_url)
EOF
}

kind="$1"
case "$kind" in
  canary) create_canary ;;
  draft) create_drafts ;;
  *) echo "error: Expected canary or draft, got: $kind"; exit 1 ;;
esac
