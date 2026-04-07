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
# trip on empty-array expansion under 3.2.
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

# Output path derivations. The `_basename` values are the reserved-name
# inputs the validation loop below rejects, and the full paths below
# compose from them rather than repeating the SHASUMS256.txt literal.
# Scratch/rollback files (*.tmp, *.bak, sorted artifact list) live
# inside `${scratch_dir}` — a per-invocation subdirectory under `${dir}`
# created after validation — so they can never collide with a
# caller-supplied artifact basename. See the scratch_dir block below.
manifest_basename="SHASUMS256.txt"
signed_manifest_basename="${manifest_basename}.asc"
scratch_prefix=".sign-manifest-scratch."
manifest="${dir}/${manifest_basename}"
signed_manifest="${manifest}.asc"

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
# 3. The helper writes SHASUMS256.txt and SHASUMS256.txt.asc directly
#    in `${dir}`. Accepting either as an artifact input would compute
#    a hash of the previous run's output and then clobber it. Both
#    names are valid per check #2, which is why this arm lives after
#    it. Scratch/rollback files (.tmp, .bak) are NOT on this list —
#    they live inside `${scratch_dir}` below, not alongside the
#    artifacts, so a caller can legitimately ship a file named
#    `SHASUMS256.txt.tmp`.
# 4. Names starting with `${scratch_prefix}` (".sign-manifest-scratch.")
#    are reserved for the per-invocation scratch subdirectory created
#    after validation. Using that prefix as an artifact basename would
#    cause the scratch-dir mkdir to collide with (or shadow) the
#    artifact, corrupting both.
# 5. Duplicate basenames would launch two hash jobs writing the same
#    `${hash_dir}/${artifact}.digest` path and the collation loop would
#    emit the same archive twice. We track seen names in a single
#    `/`-delimited string so the dup check is one `case` glob instead
#    of a nested loop. `/` is the delimiter because check #2 above
#    already rejects any artifact name containing `/` — so the
#    delimiter is guaranteed not to appear in any name, with no extra
#    coupling. Leading and trailing `/` sentinels keep the glob
#    symmetric and prevent prefix false-positives (e.g. `foo.zip`
#    does not match inside `/foo.zip-profile/`).
# 6. The file must exist inside `${dir}` so the hash job can read it.
seen_artifacts="/"
for artifact in "${artifacts[@]}"; do
  # Collapse the syntactic checks into a single `case`. Patterns are
  # tried in order; quoted `"${manifest_basename}"` /
  # `"${signed_manifest_basename}"` are literal matches so the glob
  # chars inside those values (if any) are not interpreted.
  case "${artifact}" in
    *$'\n'*|*$'\r'*)
      echo "error: artifact name contains line break: $(printf '%q' "${artifact}")" >&2
      exit 1
      ;;
    ""|.|..|*/*)
      echo "error: artifact names must be basenames (no slashes, not '.' or '..'): ${artifact}" >&2
      exit 1
      ;;
    "${manifest_basename}"|"${signed_manifest_basename}")
      echo "error: artifact name is reserved for manifest output: ${artifact}" >&2
      exit 1
      ;;
    "${scratch_prefix}"*)
      echo "error: artifact name is reserved for scratch directory: ${artifact}" >&2
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

# Now that the request is validated, install cleanup and create the
# scratch directory. Every failure below this point — a sha256 worker
# crash, a gpg --import error, a gpg --clearsign error — must leave the
# directory with at least as much valid state as it had on entry. Two
# invariants:
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
# Rollback strategy: the mutation phase keeps every intermediate
# (.tmp, .bak, sorted list) inside a per-invocation scratch directory
# `${scratch_dir}` created as a child of `${dir}`. Keeping it under
# `${dir}` guarantees the scratch filesystem matches the output
# filesystem, so every `mv` between them is an atomic rename. Cleanup
# removes the scratch directory unconditionally on success OR failure
# — on failure it also moves the backup copies inside scratch_dir
# back into `${dir}` first. A caller can therefore legitimately ship a
# file named `SHASUMS256.txt.tmp` as an artifact: nothing inside
# `${dir}` itself (apart from the scratch subdir) is written to until
# the final atomic rename.
success=0
scratch_dir=""
gnupghome=""
backup_manifest=""
backup_signed_manifest=""
# Per-output mutation flags. These are set immediately after a
# successful write to the corresponding output path (or, for
# signed_manifest, immediately BEFORE the gpg --output invocation that
# may crash mid-write). cleanup() only `rm -f`'s an output if the
# matching flag is set — so a failure path that never touched
# `${manifest}` (e.g. mktemp fails, the backup `mv` fails, the hash
# loop fails before the final mv) leaves the pre-existing file on
# disk instead of deleting it.
manifest_written=0
signed_manifest_written=0
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
    # Roll back: wipe any partial outputs we produced in ${dir} — but
    # ONLY outputs we actually wrote to this invocation — then restore
    # the pre-existing copies from their backups inside scratch_dir.
    # The `manifest_written` / `signed_manifest_written` gate exists
    # because the old unconditional `rm -f "${manifest}" "${signed_manifest}"`
    # would destroy pre-existing files on any failure between trap
    # installation and the final mv/gpg, even though those failures
    # never touched the output paths. coderabbit caught this: failing
    # mktemp, failing backup mv, failing hash job, failing collate —
    # none of them should cost the caller their last good outputs.
    if [ "${manifest_written}" -eq 1 ]; then
      rm -f "${manifest}" || true
    fi
    if [ "${signed_manifest_written}" -eq 1 ]; then
      rm -f "${signed_manifest}" || true
    fi
    if [ -n "${backup_manifest}" ]; then
      mv -f "${backup_manifest}" "${manifest}" || true
    fi
    if [ -n "${backup_signed_manifest}" ]; then
      mv -f "${backup_signed_manifest}" "${signed_manifest}" || true
    fi
  fi
  # Success and failure both drop the entire scratch directory. On
  # success it holds only cleanup-eligible state (the backups and the
  # intermediate .tmp whose content is now live in ${manifest} via
  # the atomic rename). On failure any partial state is wiped along
  # with it. Single rm -rf handles both branches.
  if [ -n "${scratch_dir}" ]; then
    # Kill any gpg-agent that was started inside our isolated GNUPGHOME
    # before removing the directory — gpg-agent holds a socket lock and
    # may leave stale files behind otherwise.
    if [ -d "${scratch_dir}/gnupghome" ]; then
      GNUPGHOME="${scratch_dir}/gnupghome" gpgconf --kill all >/dev/null 2>&1 || true
    fi
    rm -rf "${scratch_dir}" || true
  fi
  exit "${rc}"
}
trap cleanup EXIT

# Create the per-invocation scratch directory inside ${dir}. Using
# `mktemp -d "${dir}/.sign-manifest-scratch.XXXXXXXX"` gives us a name
# that:
#
# - sits on the same filesystem as the outputs (atomic renames)
# - is collision-resistant by construction (`mktemp -d`, not a manual
#   `$$` suffix), so concurrent same-dir runs can't trip on each other
# - shares the `${scratch_prefix}` namespace the validator above
#   rejects, so the scratch directory can never shadow a caller's
#   artifact
#
# Only the GNU `mktemp -d <template>` form is used here — every modern
# coreutils and BSD mktemp accepts it (unlike the bare `mktemp -d`
# which BSD rejects), so no portable fallback is needed.
scratch_dir=$(mktemp -d "${dir}/${scratch_prefix}XXXXXXXX")
tmp_manifest="${scratch_dir}/${manifest_basename}.tmp"

# Rename any pre-existing outputs into scratch_dir via atomic `mv`.
# These backups are either removed by cleanup() on success or moved
# back into ${dir} on failure. Using rename (not cp) keeps it atomic,
# zero-copy, and leaves no half-formed bytes on disk in the interim.
# This replaces the earlier `rm -f` on the stale .asc — the rename
# achieves the same "get the old .asc off disk" effect in the
# unsigned-rollout case AND preserves it for restore on failure.
#
# Invariant: the `backup_*` variables are ONLY assigned after their
# corresponding `mv` returns successfully. claude[bot] caught this —
# setting the variable before the `mv` means a failed rename (EACCES,
# EROFS, etc.) leaves the variable pointing at a file that doesn't
# exist, and cleanup() would `rm -f "${manifest}"` (wiping the still-
# present original) before the restore `mv` silently no-ops. Assigning
# after the successful `mv` keeps the invariant "backup_* non-empty
# iff the backup file exists" intact.
if [ -f "${manifest}" ]; then
  _bak_path="${scratch_dir}/${manifest_basename}.bak"
  mv "${manifest}" "${_bak_path}"
  backup_manifest="${_bak_path}"
fi
if [ -f "${signed_manifest}" ]; then
  _bak_path="${scratch_dir}/${signed_manifest_basename}.bak"
  mv "${signed_manifest}" "${_bak_path}"
  backup_signed_manifest="${_bak_path}"
fi
unset -v _bak_path

# Hash every artifact in parallel. The canary set is 22 archives, each
# roughly 30-150 MB — sequential sha256sum runs ~6-7 s on the buildkite
# linux agent; parallelised across cores it drops to ~1-2 s. We write
# each result to `${hash_dir}/${artifact}.digest` so the collation loop
# can pick them up in sorted order without caring about which job
# finished first. `${hash_dir}` is a subdirectory of `${scratch_dir}`,
# cleaned up by the EXIT trap above.
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
hash_dir="${scratch_dir}/hashes"
mkdir "${hash_dir}"

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
# which localeCompare-sorts the same map.
#
# We write the sorted list to a regular file inside scratch_dir and
# then iterate the file. Feeding the `while read` loop from a process
# substitution (`< <(printf | sort)`) would NOT propagate a non-zero
# exit from the pipeline — `set -eo pipefail` does not cover process
# substitution, so a `sort` that OOMs or gets SIGPIPE'd would leave
# the loop reading a truncated stream and the resulting `tmp_manifest`
# partial. Using a pipeline into a file IS covered by pipefail, so a
# failure here surfaces before the collation loop even starts.
sorted_list="${scratch_dir}/sorted"
printf '%s\n' "${artifacts[@]}" | LC_ALL=C sort > "${sorted_list}"
: > "${tmp_manifest}"
while IFS= read -r artifact; do
  sha=$(cut -d ' ' -f 1 "${hash_dir}/${artifact}.digest")
  if [ "${#sha}" -ne 64 ]; then
    echo "error: malformed sha256 for ${artifact}: '${sha}'" >&2
    exit 1
  fi
  printf '%s *%s\n' "${sha}" "${artifact}" >> "${tmp_manifest}"
done < "${sorted_list}"

# Atomic rename — the final `${manifest}` only appears once every hash
# has been written. Prior SIGKILL would leave a .tmp that cleanup() (or
# the next run's cleanup() via rm -f) removes before the caller ever
# sees it. Flag the output as mutated AFTER the mv returns successfully:
# rename(2) is atomic, so on failure the destination is unchanged and
# we don't want cleanup() to rm it.
mv "${tmp_manifest}" "${manifest}"
manifest_written=1

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
# The directory lives inside the scratch subdirectory so cleanup() can
# reach it with a single `rm -rf "${scratch_dir}"`.
gnupghome="${scratch_dir}/gnupghome"
mkdir "${gnupghome}"
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
# Flag the signed manifest as about-to-be-written BEFORE gpg runs.
# gpg --clearsign --output writes bytes to ${signed_manifest} before
# exiting, so if gpg crashes mid-write the file on disk is partial and
# must be removed on rollback. Setting the flag first guarantees
# cleanup() sees it and rm's the partial bytes; on gpg success, the
# `&& success=1` flip below makes cleanup skip the rollback branch
# entirely, so the flag is harmless.
signed_manifest_written=1
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