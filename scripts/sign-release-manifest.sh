#!/bin/bash

# Generate (and optionally clearsign) SHASUMS256.txt for a bun release.
#
# Usage:
#   sign-release-manifest.sh <dir> <artifact> [<artifact>...]
#
# The script walks the artifacts in <dir> and writes SHASUMS256.txt next
# to them. If GPG_PRIVATE_KEY / GPG_PASSPHRASE are set, it also clearsigns
# the manifest into SHASUMS256.txt.asc. If they are not set, only the
# unsigned manifest is written — fresh accurate checksums are still useful
# to anyone running `sha256sum -c`, and a user who is not verifying the
# PGP signature should not be penalised by the rollout state of the
# Buildkite GPG secrets. The daily .github/workflows/release.yml sign
# cron will catch up with a signed manifest within 24h.
#
# Inputs (env, optional):
#   GPG_PRIVATE_KEY  ASCII-armored private key (required to sign)
#   GPG_PASSPHRASE   Passphrase for the private key (required to sign)
#
# Outputs (in <dir>):
#   SHASUMS256.txt       Plain-text sha256 manifest, sorted by filename
#   SHASUMS256.txt.asc   Clearsigned copy of the same body (only if signing)

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

# Pick a sha256 tool. macOS has shasum; Linux usually has both.
if command -v sha256sum >/dev/null 2>&1; then
  sha256_cmd=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  sha256_cmd=(shasum -a 256)
else
  echo "error: neither sha256sum nor shasum is installed" >&2
  exit 1
fi

should_sign=0
if [ -n "${GPG_PRIVATE_KEY:-}" ] && [ -n "${GPG_PASSPHRASE:-}" ]; then
  should_sign=1
  if ! command -v gpg >/dev/null 2>&1; then
    echo "error: gpg is not installed" >&2
    exit 1
  fi
fi

manifest="$dir/SHASUMS256.txt"
signed_manifest="$manifest.asc"
# We write hash lines into a .tmp sibling and rename to $manifest atomically
# once every archive has been hashed. This keeps the final $manifest path
# either whole or absent on disk even if the script is SIGKILL'd mid-loop
# (the normal EXIT trap wouldn't fire for SIGKILL, so the `: > $manifest`
# + append pattern would leave a partial file that the caller cannot tell
# from a complete one).
tmp_manifest="$manifest.tmp"

# Set up cleanup BEFORE anything is written, so every failure path — the
# missing-artifact check below, a gpg --import error, a gpg --clearsign
# error — leaves the directory in the same state: either the outputs we
# were supposed to produce exist (success) or nothing does (failure). A
# half-written unsigned manifest alongside a stale .asc is exactly the
# integrity failure this script exists to prevent.
success=0
gnupghome=""
cleanup() {
  local rc=$?
  if [ "$success" -ne 1 ]; then
    rm -f "$tmp_manifest" "$manifest" "$signed_manifest"
  else
    # Belt and braces: if success=1 fired but the rename still somehow
    # left a .tmp on disk, wipe it so a subsequent run doesn't see stale
    # bytes from this invocation.
    rm -f "$tmp_manifest"
  fi
  if [ -n "$gnupghome" ]; then
    GNUPGHOME="$gnupghome" gpgconf --kill all >/dev/null 2>&1 || true
    # `|| true` matches the gpgconf line above. With set -eo pipefail, a
    # non-zero rm would otherwise propagate and return from this trap with
    # the wrong exit code, making the caller think signing failed when it
    # actually succeeded (success=1 already captured above).
    rm -rf "$gnupghome" || true
  fi
  exit "$rc"
}
trap cleanup EXIT

# Sort the artifact list so the manifest is deterministic regardless of
# the caller's ordering. This matches packages/bun-release/scripts/upload-assets.ts
# which localeCompare-sorts the same map.
sorted=()
while IFS= read -r line; do
  sorted+=("$line")
done < <(printf '%s\n' "${artifacts[@]}" | LC_ALL=C sort)

# Remove any stale .asc from a previous run BEFORE we start producing
# output, regardless of which branch we'll take. If this directory was
# previously signed and we're now running unsigned (e.g. secrets got
# rotated or removed mid-rollout), the old .asc still refers to the
# previous manifest body — uploading it alongside our fresh .txt would
# recreate the exact identity mismatch this PR is fixing. The signed
# branch overwrites via `gpg --output` anyway, so this rm is a no-op
# there and a correctness fix in the unsigned branch.
rm -f "$signed_manifest"

: > "$tmp_manifest"
for artifact in "${sorted[@]}"; do
  path="$dir/$artifact"
  if [ ! -f "$path" ]; then
    echo "error: missing artifact for signing: $path" >&2
    exit 1
  fi
  # The manifest lists each file by basename, not full path — the validator
  # (and every downstream consumer) resolves them relative to the release.
  #
  # Binary-mode marker: ` *NAME` (space + asterisk) tells sha256sum -c to
  # open the file in binary mode, preventing line-ending translation of
  # .zip contents on platforms where O_TEXT vs O_BINARY differ (Windows,
  # Cygwin, msys). On POSIX systems this is equivalent to the two-space
  # text-mode separator; on Windows it's a correctness fix. The validator
  # regex in the issue already accepts both forms.
  #
  # Both sha256sum and shasum -a 256 print `HASH  FILENAME` with a known
  # space separator, so `cut -d ' ' -f 1` is sufficient to extract the hex
  # digest without pulling in awk.
  sha=$("${sha256_cmd[@]}" "$path" | cut -d ' ' -f 1)
  printf '%s *%s\n' "$sha" "$artifact" >> "$tmp_manifest"
done

# Atomic rename — the final $manifest only appears once every hash has
# been written. Prior SIGKILL would leave a .tmp that cleanup() (or the
# next run's cleanup() via rm -f) removes before the caller ever sees it.
mv "$tmp_manifest" "$manifest"

# Diagnostics go to stderr, matching the warn:/error: lines above. Writing
# the cosmetic dump to stdout would let a broken stdout pipe (e.g. the
# Buildkite log aggregator dying) SIGPIPE `cat`, fire set -e with the
# success flag still 0, and cleanup() would delete the correctly-written
# manifest before any signing has started. Stderr is diagnostic-only and
# is captured by the build log just the same.
echo "Generated $manifest:" >&2
cat "$manifest" >&2

if [ "$should_sign" -ne 1 ]; then
  # Fresh unsigned manifest is strictly more useful to `sha256sum -c` users
  # than leaving a stale one in place. The sibling .asc will still point at
  # the previous manifest body until the daily cron runs, so strict PGP
  # validators will see a temporary identity mismatch. Document the state.
  echo "warn: GPG_PRIVATE_KEY/GPG_PASSPHRASE not set; wrote SHASUMS256.txt" >&2
  echo "warn: without a signature. The daily release sign workflow will" >&2
  echo "warn: catch up with a matching SHASUMS256.txt.asc within 24h." >&2
  success=1
  exit 0
fi

# Use an isolated GNUPGHOME so we never touch the agent's default keyring.
gnupghome=$(mktemp -d)
chmod 700 "$gnupghome"

GNUPGHOME="$gnupghome" gpg --batch --quiet --import <<< "$GPG_PRIVATE_KEY"

# --clearsign emits the signed body plus a PGP SIGNATURE block. The body is
# byte-identical to the input manifest, which is what the validator checks.
#
# --digest-algo SHA512 matches the algorithm the existing production
# clearsigned manifest uses (the one uploaded by the daily cron via
# packages/bun-release/scripts/upload-assets.ts). The 256 in SHASUMS256.txt
# refers to the sha256 of each archive listed inside the body, not the
# OpenPGP signature digest — they're independent, and the validator is
# algorithm-agnostic (`Hash: .*`). Keeping the signature digest consistent
# with production so nothing downstream that inspects the `Hash:` header
# sees a change.
GNUPGHOME="$gnupghome" gpg \
  --batch --yes --quiet \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --digest-algo SHA512 \
  --clearsign \
  --output "$signed_manifest" \
  "$manifest" <<< "$GPG_PASSPHRASE"

# Set success BEFORE the echo, and write the echo to stderr so every
# diagnostic in this script is on the same stream. The success flag
# protects cleanup() from deleting the signed manifest even if a broken
# stdout pipe SIGPIPE'd the echo — gpg --clearsign returning 0 is the
# real success criterion, the echo is cosmetic.
success=1
echo "Signed $signed_manifest" >&2
