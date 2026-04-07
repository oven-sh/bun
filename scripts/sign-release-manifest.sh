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

if ! [ -d "${dir}" ]; then
  echo "error: directory not found: ${dir}" >&2
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
probe_sha256() {
  local out
  local empty_sha256="e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  if ! out=$(printf '' | "$@" 2>/dev/null); then
    return 1
  fi
  # GNU tools print `HASH  -` when hashing stdin (`-` is the stdin
  # marker). Strip from the first space onward and compare the digest.
  out="${out%% *}"
  [ "${out}" = "${empty_sha256}" ]
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

# Output path derivations. The three `_basename` values are the
# reserved-name inputs the validation loop below rejects (including
# the `.tmp` sibling — see comment #3 in the validation loop for why),
# and the full paths compose from them rather than repeating the
# SHASUMS256.txt literal.
manifest_basename="SHASUMS256.txt"
signed_manifest_basename="${manifest_basename}.asc"
tmp_manifest_basename="${manifest_basename}.tmp"
manifest="${dir}/${manifest_basename}"
signed_manifest="${manifest}.asc"
tmp_manifest="${manifest}.tmp"

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
# 2. The helper's contract is basename-only: the name is interpolated
#    into `${hash_dir}/${artifact}.digest` below and written into the
#    manifest body as-is. A caller passing `dist/foo.zip` would miss
#    a subdir; `../foo.zip` would escape `${hash_dir}` entirely; `"."`
#    and `".."` break manifest parsing.
# 3. The helper writes SHASUMS256.txt, SHASUMS256.txt.asc, and the
#    intermediate SHASUMS256.txt.tmp — accepting any of the three as
#    an input would compute a hash of the previous run's output and
#    then clobber it. The `.tmp` case is especially destructive:
#    `: > "${tmp_manifest}"` in the collation phase would truncate a
#    caller-supplied artifact with that basename in place, then the
#    collation loop would overwrite its bytes with manifest text, and
#    the final `mv "${tmp_manifest}" "${manifest}"` would promote the
#    corrupted file into SHASUMS256.txt — silent data loss. All three
#    basenames are valid per check #2, which is why this arm lives
#    after it.
# 4. Duplicate basenames would launch two hash jobs writing the same
#    `${hash_dir}/${artifact}.digest` path and the collation loop would
#    emit the same archive twice. We track seen names in a single
#    `/`-delimited string so the dup check is one `case` glob instead
#    of a nested loop. `/` is the delimiter because check #2 above
#    already rejects any artifact name containing `/` — so the
#    delimiter is guaranteed not to appear in any name, with no extra
#    coupling. Leading and trailing `/` sentinels keep the glob
#    symmetric and prevent prefix false-positives (e.g. `foo.zip`
#    does not match inside `/foo.zip-profile/`).
# 5. The file must exist inside `${dir}` so the hash job can read it.
seen_artifacts="/"
for artifact in "${artifacts[@]}"; do
  # Collapse the syntactic checks into a single `case`. Patterns are
  # tried in order; quoted `"${manifest_basename}"` /
  # `"${signed_manifest_basename}"` / `"${tmp_manifest_basename}"` are
  # literal matches so the glob chars inside those values (if any) are
  # not interpreted.
  case "${artifact}" in
    *$'\n'*|*$'\r'*)
      echo "error: artifact name contains line break: $(printf '%q' "${artifact}")" >&2
      exit 1
      ;;
    ""|.|..|*/*)
      echo "error: artifact names must be basenames (no slashes, not '.' or '..'): ${artifact}" >&2
      exit 1
      ;;
    "${manifest_basename}"|"${signed_manifest_basename}"|"${tmp_manifest_basename}")
      echo "error: artifact name is reserved for manifest output: ${artifact}" >&2
      exit 1
      ;;
  esac
  # Quoted "${artifact}" inside the case pattern is matched as a literal,
  # so any glob metacharacters in the name are compared byte-for-byte
  # (they can't confuse the dup check).
  case "${seen_artifacts}" in
    */"${artifact}"/*)
      echo "error: duplicate artifact for signing: ${artifact}" >&2
      exit 1
      ;;
  esac
  seen_artifacts="${seen_artifacts}${artifact}/"
  if ! [ -f "${dir}/${artifact}" ]; then
    echo "error: missing artifact for signing: ${dir}/${artifact}" >&2
    exit 1
  fi
done
unset -v artifact seen_artifacts

# Now that the request is validated, install cleanup for the mutation
# phase. Every failure below this point — a sha256 worker crash, a
# gpg --import error, a gpg --clearsign error — must leave the directory
# with at least as much valid state as it had on entry. Two invariants:
#
# - On success: only the outputs we promised exist (SHASUMS256.txt,
#   and SHASUMS256.txt.asc in the signed path). Any pre-existing copies
#   are overwritten with the new bytes.
# - On failure: no partially-written outputs remain, AND any
#   pre-existing outputs we moved out of the way are restored
#   byte-for-byte. The caller's directory is byte-identical to what
#   it looked like when the script was invoked. A half-written
#   unsigned manifest alongside a stale .asc is exactly the integrity
#   failure this script exists to prevent, and so is *losing* a valid
#   manifest the caller still owned because our own hash job failed.
#
# The rollback is implemented by renaming pre-existing outputs out of
# the way into `.bak.$$` siblings before we mutate anything, then
# either removing the backups on success or renaming them back on
# failure. Using rename (not cp) keeps it atomic, zero-copy, and
# leaves no half-formed bytes on disk in the interim.
success=0
gnupghome=""
hash_dir=""
backup_manifest=""
backup_signed_manifest=""
cleanup() {
  local rc=$?
  # Every rm inside this trap ends in `|| true`. With `set -eo pipefail`
  # in effect, a non-zero rm (permission error, NFS stale handle, etc.)
  # would otherwise propagate out of the trap with rm's exit code instead
  # of the captured `${rc}`, making the caller think signing failed when it
  # actually succeeded. The -f flag only suppresses ENOENT — it doesn't
  # cover EACCES / EROFS / EIO / stale-NFS / SIGPIPE — so `|| true` is
  # still required. Same reason for the `mv -f ... || true` on the restore
  # paths below.
  if [ "${success}" -ne 1 ]; then
    # Roll back: wipe any partial outputs we produced, then restore the
    # pre-existing copies from their .bak.$$ siblings. Net effect is the
    # directory looks byte-identical to how we found it.
    rm -f "${tmp_manifest}" "${manifest}" "${signed_manifest}" || true
    if [ -n "${backup_manifest}" ]; then
      mv -f "${backup_manifest}" "${manifest}" || true
    fi
    if [ -n "${backup_signed_manifest}" ]; then
      mv -f "${backup_signed_manifest}" "${signed_manifest}" || true
    fi
  else
    # Success: the new outputs are live. Drop the backups and any stray
    # .tmp left behind by a partial rename (belt and braces — the atomic
    # `mv` below should make .tmp invisible on this path).
    rm -f "${tmp_manifest}" "${backup_manifest}" "${backup_signed_manifest}" || true
  fi
  if [ -n "${hash_dir}" ]; then
    rm -rf "${hash_dir}" || true
  fi
  if [ -n "${gnupghome}" ]; then
    GNUPGHOME="${gnupghome}" gpgconf --kill all >/dev/null 2>&1 || true
    rm -rf "${gnupghome}" || true
  fi
  exit "${rc}"
}
trap cleanup EXIT

# Rename any pre-existing outputs out of the way via atomic `mv`. These
# backups live next to the originals (same filesystem → rename is cheap
# and atomic) and are either removed on success or moved back on failure
# by cleanup() above. This replaces the earlier `rm -f` on the stale .asc
# — the rename accomplishes the same "get the old .asc off disk" effect
# in the unsigned-rollout case AND preserves it for restore on failure.
# The `$$` in the suffix makes the backup path unique per invocation so
# concurrent same-dir runs (unsupported but possible) can't collide on a
# shared .bak path.
if [ -f "${manifest}" ]; then
  backup_manifest="${manifest}.bak.$$"
  mv "${manifest}" "${backup_manifest}"
fi
if [ -f "${signed_manifest}" ]; then
  backup_signed_manifest="${signed_manifest}.bak.$$"
  mv "${signed_manifest}" "${backup_signed_manifest}"
fi

# Hash every artifact in parallel. The canary set is 22 archives, each
# roughly 30-150 MB — sequential sha256sum runs ~6-7 s on the buildkite
# linux agent; parallelised across cores it drops to ~1-2 s. We write
# each result to `${hash_dir}/${artifact}.digest` so the collation loop
# can pick them up in sorted order without caring about which job
# finished first. `${hash_dir}` is an isolated mktemp directory cleaned
# up by the EXIT trap above.
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
  "${sha256_cmd[@]}" "${dir}/${artifact}" > "${hash_dir}/${artifact}.digest" &
  pids+=("$!")
done

# Wait for every hash job and fail-fast on any non-zero exit. We wait on
# each pid individually (rather than a bare `wait`) so a failure in any
# one job propagates out with a meaningful error instead of being masked
# by a later-successful job.
for pid in "${pids[@]}"; do
  if ! wait "${pid}"; then
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
: > "${tmp_manifest}"
while IFS= read -r artifact; do
  sha=$(cut -d ' ' -f 1 "${hash_dir}/${artifact}.digest")
  if [ "${#sha}" -ne 64 ]; then
    echo "error: malformed sha256 for ${artifact}: '${sha}'" >&2
    exit 1
  fi
  printf '%s *%s\n' "${sha}" "${artifact}" >> "${tmp_manifest}"
done < <(printf '%s\n' "${artifacts[@]}" | LC_ALL=C sort)

# Atomic rename — the final `${manifest}` only appears once every hash
# has been written. Prior SIGKILL would leave a .tmp that cleanup() (or
# the next run's cleanup() via rm -f) removes before the caller ever
# sees it.
mv "${tmp_manifest}" "${manifest}"

# Declare the unsigned-path success as early as possible: the atomic mv
# above is the entire contract for the unsigned fallback, so flipping
# success here protects every subsequent diagnostic (echo/cat/warn) from
# tripping cleanup() on a stderr SIGPIPE. The signed path can't do this
# — it needs gpg --clearsign to produce a matching .asc first, otherwise
# a crash between this line and the signing step would leave an unsigned
# .txt alongside a stale .asc, exactly the integrity mismatch this PR
# exists to prevent.
if [ "${should_sign}" -ne 1 ]; then
  success=1
fi

# Diagnostics go to stderr. Each one ends in `|| true` because on
# Buildkite both stdout and stderr are multiplexed through a single
# log-aggregator child process: if that aggregator dies (OOM, agent
# restart, etc.) the kernel delivers SIGPIPE on fd 2 just like fd 1,
# and the bash SIGPIPE exit (141) would fire `set -e` here. In the
# signed path `success` is still 0 at this point (we only flip it after
# gpg succeeds below), so a `cleanup()` triggered here would delete the
# correctly-written `${manifest}`. Guarding the diagnostics suppresses
# that edge without losing the log output on a healthy run.
echo "Generated ${manifest}:" >&2 || true
cat "${manifest}" >&2 || true

if [ "${should_sign}" -ne 1 ]; then
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
chmod 700 "${gnupghome}"

GNUPGHOME="${gnupghome}" gpg --batch --quiet --import <<< "${GPG_PRIVATE_KEY}"

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
GNUPGHOME="${gnupghome}" gpg \
  --batch --yes --quiet \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --digest-algo SHA512 \
  --clearsign \
  --output "${signed_manifest}" \
  "${manifest}" <<< "${GPG_PASSPHRASE}" && success=1 || exit

# Final diagnostic also guarded — same reasoning as the echo/cat above.
# Here success=1 is already set, so a SIGPIPE would leave the .txt and
# .asc on disk (cleanup() preserves them), but bash would still exit 141,
# and the caller in .buildkite/scripts/upload-release.sh treats any
# non-zero exit from the helper as a signing failure and skips the
# upload entirely — the exact canary-release integrity failure this PR
# fixes. `|| true` turns a logging hiccup into a clean exit 0.
echo "Signed ${signed_manifest}" >&2 || true
