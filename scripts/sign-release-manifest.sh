#!/bin/bash

# Generate and clearsign SHASUMS256.txt for a bun release.
#
# Usage:
#   sign-release-manifest.sh <dir> <artifact> [<artifact>...]
#
# The script walks the artifacts in <dir>, writes SHASUMS256.txt and
# SHASUMS256.txt.asc next to them, and leaves them on disk for the caller
# to upload. If GPG_PRIVATE_KEY / GPG_PASSPHRASE are not set, the script
# exits 2 and writes nothing — this lets the canary pipeline roll out
# before the buildkite secrets exist and fall back to the daily sign cron
# until they do.
#
# Inputs (env):
#   GPG_PRIVATE_KEY  ASCII-armored private key (required for signing)
#   GPG_PASSPHRASE   Passphrase for the private key (required for signing)
#
# Outputs (in <dir>):
#   SHASUMS256.txt       Plain-text sha256 manifest, sorted by filename
#   SHASUMS256.txt.asc   Clearsigned copy of the same body

set -eo pipefail

if [ "$#" -lt 2 ]; then
  echo "error: usage: $0 <dir> <artifact> [<artifact>...]" >&2
  exit 1
fi

dir="$1"
shift
artifacts=("$@")

if [ ! -d "$dir" ]; then
  echo "error: directory not found: $dir" >&2
  exit 1
fi

if [ -z "${GPG_PRIVATE_KEY:-}" ] || [ -z "${GPG_PASSPHRASE:-}" ]; then
  echo "warn: GPG_PRIVATE_KEY/GPG_PASSPHRASE not set; skipping SHASUMS256.txt signing." >&2
  echo "warn: The daily release sign workflow will regenerate the manifest later." >&2
  exit 2
fi

if ! command -v gpg >/dev/null 2>&1; then
  echo "error: gpg is not installed" >&2
  exit 1
fi

# Pick a sha256 tool. macOS has shasum; Linux usually has both.
if command -v sha256sum >/dev/null 2>&1; then
  sha256_cmd=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  sha256_cmd=(shasum -a 256)
else
  echo "error: neither sha256sum nor shasum is installed" >&2
  exit 1
fi

manifest="$dir/SHASUMS256.txt"
signed_manifest="$manifest.asc"

# Sort the artifact list so the manifest is deterministic regardless of
# the caller's ordering. This matches packages/bun-release/scripts/upload-assets.ts
# which localeCompare-sorts the same map.
sorted=()
while IFS= read -r line; do
  sorted+=("$line")
done < <(printf '%s\n' "${artifacts[@]}" | LC_ALL=C sort)

: > "$manifest"
for artifact in "${sorted[@]}"; do
  path="$dir/$artifact"
  if [ ! -f "$path" ]; then
    echo "error: missing artifact for signing: $path" >&2
    rm -f "$manifest"
    exit 1
  fi
  # The manifest lists each file by basename, not full path — the validator
  # (and every downstream consumer) resolves them relative to the release.
  sha=$("${sha256_cmd[@]}" "$path" | awk '{print $1}')
  printf '%s  %s\n' "$sha" "$artifact" >> "$manifest"
done

echo "Generated $manifest:"
cat "$manifest"

# Use an isolated GNUPGHOME so we never touch the agent's default keyring.
gnupghome=$(mktemp -d)
chmod 700 "$gnupghome"
cleanup() {
  GNUPGHOME="$gnupghome" gpgconf --kill all >/dev/null 2>&1 || true
  rm -rf "$gnupghome"
}
trap cleanup EXIT

GNUPGHOME="$gnupghome" gpg --batch --quiet --import <<< "$GPG_PRIVATE_KEY"

# --clearsign emits the signed body plus a PGP SIGNATURE block. The body is
# byte-identical to the input manifest, which is what the validator checks.
GNUPGHOME="$gnupghome" gpg \
  --batch --yes --quiet \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --digest-algo SHA256 \
  --clearsign \
  --output "$signed_manifest" \
  "$manifest" <<< "$GPG_PASSPHRASE"

echo "Signed $signed_manifest"
