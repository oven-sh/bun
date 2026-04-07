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
# Portability: this script is written against Bash 3.2 — the /bin/bash
# shipped on macOS — so it runs unmodified on stock macOS, Alpine, and
# every modern Linux. It intentionally avoids bash 4+ features like
# `${var,,}`, `declare -A`, and nounset (`set -u`) because those all
# trip on empty-array expansion under 3.2; the `mktemp` calls use the
# portable `mktemp -d 2>/dev/null || mktemp -d -t ...` fallback for
# BSD mktemp, which rejects bare `-d`.
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

if ! [ -d "$dir" ]; then
  echo "error: directory not found: $dir" >&2
  exit 1
fi

# Pick a sha256 tool. Order of preference:
#
# 1. `cksum -a sha256 --untagged` — GNU coreutils ≥ 9.0's unified
#    checksum tool. Upstream has been consolidating md5sum / sha*sum
#    into `cksum -a`, so prefer it on hosts where it's available.
#    `--untagged` forces the classic `HASH  FILENAME` output instead
#    of the BSD-tagged `SHA256 (file) = HASH`, which is what our
#    collation loop below expects.
# 2. `sha256sum` — GNU coreutils classic, available on every Linux
#    distro with coreutils regardless of version.
# 3. `shasum -a 256` — Perl-based, ships in the base install on macOS,
#    other BSDs, and git-for-windows.
#
# We don't trust the binary's presence alone: each candidate is
# functionally probed by sha256'ing the empty string and comparing the
# first whitespace-delimited word to the known SHA-256(""). That rejects
# BusyBox `cksum` (CRC32-only, doesn't recognise `-a`), older GNU cksum
# pre-9.0 (same), and catches any future host where the tool's output
# format drifts away from `HASH  FILENAME`. `printf ''` (not `<<<''`,
# which would inject a trailing newline) so we hash the genuine empty
# string. We also reject any tool that prints uppercase hex — every
# modern implementation emits lowercase, and a mismatch there is a
# signal the tool is non-standard enough that we should skip it.
empty_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
probe_sha256() {
  local out
  if ! out=$(printf '' | "$@" 2>/dev/null); then
    return 1
  fi
  # GNU tools print `HASH  -` when hashing stdin (`-` is the stdin
  # marker). Strip from the first space onward and compare the digest.
  out="${out%% *}"
  [ "$out" = "$empty_sha256" ]
}
if probe_sha256 cksum -a sha256 --untagged; then
  sha256_cmd=(cksum -a sha256 --untagged)
elif probe_sha256 sha256sum; then
  sha256_cmd=(sha256sum)
elif probe_sha256 shasum -a 256; then
  sha256_cmd=(shasum -a 256)
else
  echo "error: no working sha256 tool found (tried cksum -a sha256 --untagged, sha256sum, shasum -a 256)" >&2
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
manifest_basename="SHASUMS256.txt"
signed_manifest_basename="SHASUMS256.txt.asc"
tmp_manifest="$manifest.tmp"

# Validate every artifact BEFORE we touch any output file or install
# the cleanup trap — fail-fast with a clear error, no orphaned
# background subshells, no half-written state, and no accidental
# removal of a pre-existing valid manifest the caller still owns.
#
# Checks applied in order:
#
# 1. Line-break characters (\n / \r) in a name would inject bogus
#    extra lines into the manifest body and split the sort below into
#    multiple entries.
# 2. The helper writes SHASUMS256.txt and SHASUMS256.txt.asc — accepting
#    either as an input would compute a hash of the previous run's
#    manifest output and then clobber it.
# 3. The helper's contract is basename-only: the name is interpolated
#    into `$hash_dir/$artifact.digest` below and written into the
#    manifest body as-is. A caller passing `dist/foo.zip` would miss
#    a subdir; `../foo.zip` would escape `$hash_dir` entirely; `"."`
#    and `".."` break manifest parsing.
# 4. Duplicate basenames would launch two hash jobs writing the same
#    `$hash_dir/$artifact.digest` path and the collation loop would
#    emit the same archive twice. We track seen names in a plain
#    array with a linear scan — O(n²) but n≤22 for the canary set,
#    and using `declare -A` here would break Bash 3.2 / stock macOS
#    /bin/bash where this script's test suite also runs.
# 5. The file must exist inside `$dir` so the hash job can read it.
seen_artifacts=()
for artifact in "${artifacts[@]}"; do
  case "$artifact" in
    *$'\n'*|*$'\r'*)
      echo "error: artifact name contains line break: $(printf '%q' "$artifact")" >&2
      exit 1
      ;;
  esac
  if [ "$artifact" = "$manifest_basename" ] || [ "$artifact" = "$signed_manifest_basename" ]; then
    echo "error: artifact name is reserved for manifest output: $artifact" >&2
    exit 1
  fi
  case "$artifact" in
    ""|.|..|*/*)
      echo "error: artifact names must be basenames (no slashes, not '.' or '..'): $artifact" >&2
      exit 1
      ;;
  esac
  for seen in "${seen_artifacts[@]}"; do
    if [ "$seen" = "$artifact" ]; then
      echo "error: duplicate artifact for signing: $artifact" >&2
      exit 1
    fi
  done
  seen_artifacts+=("$artifact")
  if [ ! -f "$dir/$artifact" ]; then
    echo "error: missing artifact for signing: $dir/$artifact" >&2
    exit 1
  fi
done
unset artifact seen seen_artifacts

# Now that the request is validated, install cleanup for the mutation
# phase. Every failure below this point — `rm -f` on a stale .asc, a
# gpg --import error, a gpg --clearsign error — must leave the directory
# in the same state: either the outputs we were supposed to produce
# exist (success) or nothing new does (failure). A half-written unsigned
# manifest alongside a stale .asc is exactly the integrity failure this
# script exists to prevent.
success=0
gnupghome=""
hash_dir=""
cleanup() {
  local rc=$?
  # Every rm inside this trap ends in `|| true`. With `set -eo pipefail`
  # in effect, a non-zero rm (permission error, NFS stale handle, etc.)
  # would otherwise propagate out of the trap with rm's exit code instead
  # of the captured `$rc`, making the caller think signing failed when it
  # actually succeeded. The -f flag only suppresses ENOENT — it doesn't
  # cover EACCES / EROFS / EIO / stale-NFS / SIGPIPE — so `|| true` is
  # still required.
  if [ "$success" -ne 1 ]; then
    rm -f "$tmp_manifest" "$manifest" "$signed_manifest" || true
  else
    # Belt and braces: if success=1 fired but the rename still somehow
    # left a .tmp on disk, wipe it so a subsequent run doesn't see stale
    # bytes from this invocation.
    rm -f "$tmp_manifest" || true
  fi
  if [ -n "$hash_dir" ]; then
    rm -rf "$hash_dir" || true
  fi
  if [ -n "$gnupghome" ]; then
    GNUPGHOME="$gnupghome" gpgconf --kill all >/dev/null 2>&1 || true
    rm -rf "$gnupghome" || true
  fi
  exit "$rc"
}
trap cleanup EXIT

# Remove any stale .asc from a previous run BEFORE we start producing
# output, regardless of which branch we'll take. If this directory was
# previously signed and we're now running unsigned (e.g. secrets got
# rotated or removed mid-rollout), the old .asc still refers to the
# previous manifest body — uploading it alongside our fresh .txt would
# recreate the exact identity mismatch this PR is fixing. The signed
# branch overwrites via `gpg --output` anyway, so this rm is a no-op
# there and a correctness fix in the unsigned branch.
#
# `|| true` matches the rest of the script (see the cleanup() comment
# above): `-f` only suppresses ENOENT, not EACCES / EROFS / EIO /
# stale-NFS. Without the guard, a permission error on the stale .asc
# would fire `set -e` here with success=0, and cleanup() would delete
# the pre-existing valid SHASUMS256.txt — strictly worse than leaving
# everything alone.
rm -f "$signed_manifest" || true

# Hash every artifact in parallel. The canary set is 22 archives, each
# roughly 30-150 MB — sequential sha256sum runs ~6-7 s on the buildkite
# linux agent; parallelised across cores it drops to ~1-2 s. We write
# each result to `$hash_dir/$artifact.digest` so the collation loop can
# pick them up in sorted order without caring about which job finished
# first. $hash_dir is an isolated mktemp directory cleaned up by the
# EXIT trap above.
#
# Manifest format:
# - Each file by basename, not full path — the validator (and every
#   downstream consumer) resolves them relative to the release.
# - Binary-mode marker: ` *NAME` (space + asterisk) tells sha256sum -c
#   to open the file in binary mode, preventing line-ending translation
#   of .zip contents on platforms where O_TEXT vs O_BINARY differ
#   (Windows, Cygwin, msys). On POSIX systems this is equivalent to the
#   two-space text-mode separator; on Windows it's a correctness fix.
#   The validator regex in the issue already accepts both forms.
# - Each digest file contains the full `HASH  FILENAME\n` line as
#   emitted by the sha256 tool. The collation loop extracts just the
#   hash via `cut -d ' ' -f 1` — doing the cut there (not inside the
#   parallel hash job) keeps the job a single exec and means the file
#   on disk has enough context for a post-mortem if anything ever goes
#   wrong reading it back.
#
# `mktemp -d 2>/dev/null || mktemp -d -t ...` is the portable form:
# GNU mktemp accepts a bare `-d`, BSD mktemp (macOS) rejects it and
# needs a `-t TEMPLATE` argument. Run GNU first, fall back to BSD form.
hash_dir=$(mktemp -d 2>/dev/null || mktemp -d -t bun-sign-release-manifest)

pids=()
for artifact in "${artifacts[@]}"; do
  "${sha256_cmd[@]}" "$dir/$artifact" > "$hash_dir/$artifact.digest" &
  pids+=("$!")
done

# Wait for every hash job and fail-fast on any non-zero exit. We wait on
# each pid individually (rather than a bare `wait`) so a failure in any
# one job propagates out with a meaningful error instead of being masked
# by a later-successful job.
for pid in "${pids[@]}"; do
  if ! wait "$pid"; then
    echo "error: sha256 failed for one or more artifacts" >&2
    exit 1
  fi
done

# Collate the per-artifact digests into the manifest in sorted order.
# Sort the artifact list so the manifest is deterministic regardless of
# the caller's ordering; LC_ALL=C matches packages/bun-release/scripts/upload-assets.ts
# which localeCompare-sorts the same map. The while-read pulls directly
# from the sorted process substitution, so there's no intermediate
# `sorted` array to keep in sync with the artifact list.
: > "$tmp_manifest"
while IFS= read -r artifact; do
  sha=$(cut -d ' ' -f 1 "$hash_dir/$artifact.digest")
  if [ "${#sha}" -ne 64 ]; then
    echo "error: malformed sha256 for $artifact: '$sha'" >&2
    exit 1
  fi
  printf '%s *%s\n' "$sha" "$artifact" >> "$tmp_manifest"
done < <(printf '%s\n' "${artifacts[@]}" | LC_ALL=C sort)

# Atomic rename — the final $manifest only appears once every hash has
# been written. Prior SIGKILL would leave a .tmp that cleanup() (or the
# next run's cleanup() via rm -f) removes before the caller ever sees it.
mv "$tmp_manifest" "$manifest"

# Declare the unsigned-path success as early as possible: the atomic mv
# above is the entire contract for the unsigned fallback, so flipping
# success here protects every subsequent diagnostic (echo/cat/warn) from
# tripping cleanup() on a stderr SIGPIPE. The signed path can't do this
# — it needs gpg --clearsign to produce a matching .asc first, otherwise
# a crash between this line and the signing step would leave an unsigned
# .txt alongside a stale .asc, exactly the integrity mismatch this PR
# exists to prevent.
if [ "$should_sign" -ne 1 ]; then
  success=1
fi

# Diagnostics go to stderr. Each one ends in `|| true` because on
# Buildkite both stdout and stderr are multiplexed through a single
# log-aggregator child process: if that aggregator dies (OOM, agent
# restart, etc.) the kernel delivers SIGPIPE on fd 2 just like fd 1,
# and the bash SIGPIPE exit (141) would fire `set -e` here. In the
# signed path `success` is still 0 at this point (we only flip it after
# gpg succeeds below), so a `cleanup()` triggered here would delete the
# correctly-written $manifest. Guarding the diagnostics suppresses that
# edge without losing the log output on a healthy run.
echo "Generated $manifest:" >&2 || true
cat "$manifest" >&2 || true

if [ "$should_sign" -ne 1 ]; then
  # Fresh unsigned manifest is strictly more useful to `sha256sum -c` users
  # than leaving a stale one in place. The sibling .asc will still point at
  # the previous manifest body until the daily cron runs, so strict PGP
  # validators will see a temporary identity mismatch. Document the state.
  # success=1 was already set above.
  echo "warn: GPG_PRIVATE_KEY/GPG_PASSPHRASE not set; wrote SHASUMS256.txt" >&2 || true
  echo "warn: without a signature. The daily release sign workflow will" >&2 || true
  echo "warn: catch up with a matching SHASUMS256.txt.asc within 24h." >&2 || true
  exit 0
fi

# Use an isolated GNUPGHOME so we never touch the agent's default keyring.
gnupghome=$(mktemp -d 2>/dev/null || mktemp -d -t bun-sign-release-manifest-gpg)
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
# `&& success=1 || exit` ties the success flip textually and atomically
# to gpg's own exit code: gpg succeeds → success=1, continue; gpg fails
# → skip success=1, fall into `|| exit` which propagates gpg's non-zero
# status (naked `exit` uses the most-recent command's status). This
# intentionally sidesteps the `set -e` exemption for the left side of
# `&&`, which would otherwise silently fall through on gpg failure.
GNUPGHOME="$gnupghome" gpg \
  --batch --yes --quiet \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --digest-algo SHA512 \
  --clearsign \
  --output "$signed_manifest" \
  "$manifest" <<< "$GPG_PASSPHRASE" && success=1 || exit

# Final diagnostic also guarded — same reasoning as the echo/cat above.
# Here success=1 is already set, so a SIGPIPE would leave the .txt and
# .asc on disk (cleanup() preserves them), but bash would still exit 141,
# and the caller in .buildkite/scripts/upload-release.sh treats any
# non-zero exit from the helper as a signing failure and skips the
# upload entirely — the exact canary-release integrity failure this PR
# fixes. `|| true` turns a logging hiccup into a clean exit 0.
echo "Signed $signed_manifest" >&2 || true
