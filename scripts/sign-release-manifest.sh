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
# trip on empty-array expansion under 3.2. Every `mktemp` call passes
# an explicit template (`mktemp -d "<prefix>/...XXXXXXXX"`) — the one
# form accepted by every GNU and BSD mktemp — so we never need the
# BSD `-t` fallback. The scratch_dir template is rooted in `${dir}`;
# the gnupghome and hash_dir templates are rooted in `${scratch_dir}`.
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

# GPG secrets: classify into one of three states.
#
# - BOTH SET: sign the manifest (`should_sign=1`). Verify `gpg` is on
#   PATH; missing gpg is a hard error because we have signing material
#   but no way to use it.
#
# - BOTH ABSENT/EMPTY: unsigned rollout fallback. Documented staged-
#   deployment state — see the script header comment and the
#   sign_and_upload_manifest() block in .buildkite/scripts/upload-release.sh.
#   Users running `sha256sum -c` get accurate hashes immediately; the
#   daily .github/workflows/release.yml sign cron regenerates the
#   matching .asc within 24h. `should_sign` stays 0 and the run exits
#   zero after publishing SHASUMS256.txt.
#
# - PARTIAL (exactly one set): hard error. A lone GPG_PRIVATE_KEY or
#   lone GPG_PASSPHRASE is almost always a typo in a secret name
#   (BUILDKITE GPG_PRIVATEKEY vs GPG_PRIVATE_KEY, missing alias, half-
#   completed provisioning) or a secret store returning an empty value
#   for one of the two. Failing here gives the operator an immediate,
#   actionable error before any output mutation, instead of silently
#   degrading to the unsigned path and publishing an unsigned manifest
#   that looks like a successful rollout state. Exit code 1 with a
#   specific error message so the buildkite wrapper treats it as a
#   signing failure (see `sign_exit` branch in upload-release.sh).
should_sign=0
_key_set=""
_pass_set=""
[ -n "${GPG_PRIVATE_KEY:-}" ] && _key_set=1
[ -n "${GPG_PASSPHRASE:-}" ] && _pass_set=1
if [ -n "${_key_set}" ] && [ -n "${_pass_set}" ]; then
  should_sign=1
  if ! command -v gpg >/dev/null 2>&1; then
    echo "error: gpg is not installed" >&2
    exit 1
  fi
elif [ -n "${_key_set}" ] || [ -n "${_pass_set}" ]; then
  if [ -n "${_key_set}" ]; then
    echo "error: GPG_PRIVATE_KEY is set but GPG_PASSPHRASE is empty/unset" >&2
  else
    echo "error: GPG_PASSPHRASE is set but GPG_PRIVATE_KEY is empty/unset" >&2
  fi
  echo "error: both must be set to sign, or both unset to publish unsigned" >&2
  echo "error: partial configuration is almost always a typo in a secret name" >&2
  exit 1
fi
unset -v _key_set _pass_set

# Output path derivations. The `_basename` values are the reserved-name
# inputs the validation loop below rejects, and the full paths below
# compose from them rather than repeating the SHASUMS256.txt literal.
# Scratch/rollback files (*.tmp, *.bak, sorted artifact list) live
# inside `${scratch_dir}` — a per-invocation subdirectory under `${dir}`
# created after validation — so they can never collide with a
# caller-supplied artifact basename. See the scratch_dir block below.
manifest_basename="SHASUMS256.txt"
signed_manifest_basename="${manifest_basename}.asc"
manifest="${dir}/${manifest_basename}"
signed_manifest="${manifest}.asc"
scratch_prefix=".sign-manifest-scratch."

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
gnupghome=""
scratch_dir=""
backup_manifest=""
backup_signed_manifest=""
# Per-output mutation flags. Both are set immediately AFTER a
# successful atomic `mv` from the scratch-dir tmp into the final
# output path — see the collation block (manifest_written) and the
# signing block (signed_manifest_written) below for the exact sites.
# cleanup() only `rm -f`'s an output if the matching flag is set, so
# a failure path that never touched the output paths (e.g. mktemp
# fails, the backup `mv` fails, the hash job fails, the collate
# fails, gpg --clearsign fails before the tmp→final rename) leaves
# any pre-existing file on disk instead of deleting it.
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
  # still required on every rm.
  #
  # The restore `mv` paths below are the ONE exception: a failure there
  # costs the caller their last-good manifest/.asc and must NOT be
  # swallowed. If restore fails, we preserve the scratch directory as
  # a manual recovery surface (so the .bak files the mv left behind
  # remain reachable) and override the trap's exit code with 75
  # (EX_TEMPFAIL from sysexits.h) so the buildkite wrapper can
  # distinguish "transient filesystem problem — retry or page an
  # operator" from ordinary signing failures.
  local restore_failed=0
  if [ "${success}" -ne 1 ]; then
    # Roll back: wipe any partial outputs we produced in ${dir} — but
    # ONLY outputs we actually wrote to this invocation — then restore
    # the pre-existing copies from their backups inside scratch_dir.
    # The `manifest_written` / `signed_manifest_written` gate matters
    # because an unconditional `rm -f "${manifest}" "${signed_manifest}"`
    # would destroy pre-existing files on any failure between trap
    # installation and the final mv/gpg, even though those failures
    # never touched the output paths. Failing mktemp, failing backup
    # mv, failing hash job, failing collate — none of them should cost
    # the caller their last good outputs.
    if [ "${manifest_written}" -eq 1 ]; then
      rm -f "${manifest}" || true
    fi
    if [ "${signed_manifest_written}" -eq 1 ]; then
      rm -f "${signed_manifest}" || true
    fi
    # `-f` (not `-n`): the backup invariant is "variable set iff backup
    # exists", but checking the filesystem directly is defense-in-depth —
    # if the backup file was somehow removed between its successful `mv`
    # and this restore, we skip cleanly.
    #
    # No `|| true` here: if the restore `mv` fails, we set
    # `restore_failed=1` and let the block below preserve scratch_dir
    # so the .bak copy the `mv` didn't move remains reachable for
    # manual recovery. Swallowing the failure here would combine with
    # the unconditional `rm -rf "${scratch_dir}"` that used to live
    # below to silently nuke the last-good file — exactly the data
    # loss coderabbit flagged.
    if [ -f "${backup_manifest}" ]; then
      if ! mv -f "${backup_manifest}" "${manifest}"; then
        echo "error: failed to restore ${manifest} from ${backup_manifest}" >&2 || true
        restore_failed=1
      fi
    fi
    if [ -f "${backup_signed_manifest}" ]; then
      if ! mv -f "${backup_signed_manifest}" "${signed_manifest}"; then
        echo "error: failed to restore ${signed_manifest} from ${backup_signed_manifest}" >&2 || true
        restore_failed=1
      fi
    fi
  fi
  # Kill the gpg-agent BEFORE removing scratch_dir (or before leaving
  # it in place for recovery): the agent's socket lives inside
  # gnupghome/, which lives inside scratch_dir/, and a live agent with
  # a deleted socket dir will crash noisily in the CI log. Done
  # unconditionally (not gated on restore_failed) because we never
  # want to leave a gpg-agent running after this script exits.
  # `gpgconf --kill all` takes GNUPGHOME from the env, so export it
  # inline for the one call.
  if [ -d "${gnupghome}" ]; then
    GNUPGHOME="${gnupghome}" gpgconf --kill all >/dev/null 2>&1 || true
  fi
  if [ "${restore_failed}" -eq 1 ]; then
    # Preserve scratch_dir as a recovery surface. The .bak files sit
    # inside it; an operator with write access to ${dir} can manually
    # copy them back once the underlying filesystem issue is cleared.
    # Using the EX_TEMPFAIL exit code (75) so the buildkite wrapper
    # can distinguish this from a signing failure (exit 1).
    echo "error: scratch directory preserved for manual recovery: ${scratch_dir}" >&2 || true
    echo "error: manually copy .bak files back into ${dir} once the filesystem issue is resolved" >&2 || true
    exit 75
  fi
  # On success (or a failure path where restore succeeded / wasn't
  # needed) drop the entire scratch directory. On success it holds
  # only cleanup-eligible state (the backups we just removed, the
  # intermediate .tmp whose content is now live in ${manifest} via
  # the atomic rename, and the gnupghome). A single rm -rf handles
  # both branches.
  if [ -d "${scratch_dir}" ]; then
    rm -rf "${scratch_dir}" || true
  fi
  exit "${rc}"
}
trap cleanup EXIT

# Sweep any orphaned scratch dirs from prior SIGKILL'd runs before
# creating ours. In Buildkite's reused-workspace model (agent config
# dependent), an OOM kill or agent restart can leave a prior run's
# scratch_dir on disk with no cleanup trap having fired; without this
# sweep, those orphans accumulate until the workspace itself is wiped.
# Safe because the validator above already rejects the `scratch_prefix`
# as a caller artifact name, so nothing inside
# `${dir}/${scratch_prefix}*/` can belong to a caller — and the `-d`
# guard handles the no-match case (glob expands literally without
# `nullglob`, and a glob pattern is never a directory).
#
# Rollback-preserving restore: before we `rm -rf` the orphans, probe
# each one for `.bak` backup files. If a prior run was SIGKILLed after
# moving the pre-existing `${manifest}` / `${signed_manifest}` into its
# scratch dir (see the backup block below) but before publishing new
# outputs, the LIVE path is now empty and the only copy of the
# last-good file sits inside the orphan. A naive sweep would delete
# it, leaving the caller with neither the old nor the new manifest.
#
# Multi-orphan selection: in the rare case two or more orphans each
# contain a `.bak` (two separate SIGKILLs before any sweep ran), we
# want the NEWEST — an older run's `.bak` is strictly staler than the
# newer run's, which observed it via this same restore-from-orphan
# path and then re-backed it up on its own mutation. First-glob-wins
# would silently discard the newer version if its mktemp suffix sorts
# after an older one. Instead, do two passes:
#
#   1. Walk all orphans. For each `${manifest_basename}.bak` /
#      `${signed_manifest_basename}.bak` found, track the path to the
#      newest copy via POSIX `[ A -nt B ]` (modification-time
#      comparison — POSIX test operator, works on bash 3.2 and every
#      BSD/GNU shell, no `stat -c %Y` or `printf %()T` dependency).
#   2. Restore only the newest of each, iff the corresponding live
#      path is missing. Then rm -rf every orphan (including the ones
#      whose .bak we skipped).
#
# Identical-mtime tiebreaker: `-nt` is false on ties, so the first
# orphan wins — deterministic given a stable glob order. In practice
# filesystem mtime resolution is at least 1s so this rarely matters.
#
# No `|| true` on the restore `mv` below. If the rename fails (for
# example because ${dir} became read-only between the prior run and
# this one), we must not remove the orphan scratch dir — doing so
# would discard the last-good .bak and leave the caller with neither
# the old nor the new file. Fail fast with a distinctive error and an
# EX_TEMPFAIL (75) exit so the buildkite wrapper can distinguish a
# filesystem problem from a signing failure.
#
# Concurrency note: this intentionally blows away every matching dir,
# including any that might belong to a currently-running sibling
# invocation against the same `${dir}`. Both known callers — the
# Buildkite upload step and this file's test suite, which uses a
# fresh `tempDir` per test — only ever invoke the helper sequentially
# against a given directory, so that tradeoff is academic.
#
# Future concurrent-caller support (sketched here so the next person
# has a shape to work from — NOT implemented because no caller needs
# it yet and YAGNI):
#
#   Inside each new scratch_dir, do `mkdir "${scratch_dir}/.lock"`
#   immediately after the outer mktemp. `mkdir` is atomic on every
#   POSIX filesystem (returns EEXIST if the directory already exists,
#   no partial state), so it doubles as an advisory lock without
#   touching `flock(1)` (which isn't portable to stock macOS). Stash
#   the owning PID via `echo $$ > "${scratch_dir}/.lock/owner"` so
#   stale locks can be detected via `kill -0 $(<.lock/owner)` on
#   sweep.
#
#   Teach this sweep to skip any orphan whose `.lock` subdir still
#   exists AND whose recorded PID is still alive. That preserves
#   in-flight sibling invocations and only reaps truly-dead runs.
#   cleanup() removes the `.lock` dir as part of the normal
#   scratch_dir rm -rf, so the success path stays clean.
#
#   Preferring mkdir-based locks over time-based aging (e.g. "skip
#   orphans younger than 3 hours") because `mkdir` is exact and
#   portable, while aging needs bash 4.2's `printf '%(%s)T'` or GNU
#   `stat -c %Z`, neither of which runs on macOS's default 3.2 bash.
#   Also, a buildkite canary job that legitimately runs longer than
#   any fixed threshold (aarch64-musl linker times spike on cold
#   caches) would have its own scratch dir false-aged and swept by a
#   sibling — a worse bug than the one the aging check was meant to
#   fix.
_newest_manifest_bak=""
_newest_signed_bak=""
for _stale in "${dir}/${scratch_prefix}"*/; do
  if [ -d "${_stale}" ]; then
    _stale_manifest_bak="${_stale}${manifest_basename}.bak"
    _stale_signed_bak="${_stale}${signed_manifest_basename}.bak"
    if [ -f "${_stale_manifest_bak}" ]; then
      if [ -z "${_newest_manifest_bak}" ] || [ "${_stale_manifest_bak}" -nt "${_newest_manifest_bak}" ]; then
        _newest_manifest_bak="${_stale_manifest_bak}"
      fi
    fi
    if [ -f "${_stale_signed_bak}" ]; then
      if [ -z "${_newest_signed_bak}" ] || [ "${_stale_signed_bak}" -nt "${_newest_signed_bak}" ]; then
        _newest_signed_bak="${_stale_signed_bak}"
      fi
    fi
  fi
done
# Restore the newest of each iff the live file is missing. If live
# already exists (prior completed run's output or — hypothetically —
# a concurrent producer; see concurrency note above), don't clobber
# it with an older backup. The rm pass below still removes the
# orphan directory, which is correct: the orphan held a stale copy
# we no longer need.
if [ -n "${_newest_manifest_bak}" ] && ! [ -e "${manifest}" ]; then
  if ! mv -f "${_newest_manifest_bak}" "${manifest}"; then
    echo "error: failed to restore ${manifest} from orphan ${_newest_manifest_bak}" >&2 || true
    echo "error: orphan directory preserved for manual recovery" >&2 || true
    exit 75
  fi
fi
if [ -n "${_newest_signed_bak}" ] && ! [ -e "${signed_manifest}" ]; then
  if ! mv -f "${_newest_signed_bak}" "${signed_manifest}"; then
    echo "error: failed to restore ${signed_manifest} from orphan ${_newest_signed_bak}" >&2 || true
    echo "error: orphan directory preserved for manual recovery" >&2 || true
    exit 75
  fi
fi
# Now safe to wipe every orphan. The `.bak` we promoted has already
# been `mv`'d out of its orphan and into the live path, so no live
# data is inside the scratch trees any more.
for _stale in "${dir}/${scratch_prefix}"*/; do
  if [ -d "${_stale}" ]; then
    rm -rf "${_stale}" || true
  fi
done
unset -v _stale _stale_manifest_bak _stale_signed_bak _newest_manifest_bak _newest_signed_bak

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
# corresponding `mv` returns successfully. Setting the variable before
# the `mv` would mean a failed rename (EACCES, EROFS, etc.) leaves the
# variable pointing at a file that doesn't exist, and cleanup() would
# `rm -f "${manifest}"` (wiping the still-present original) before the
# restore `mv` silently no-ops. Assigning after the successful `mv`
# keeps the invariant "backup_* non-empty iff the backup file exists"
# intact.
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
# finished first. `${hash_dir}` is a nested subdirectory of the scratch
# root via the same `mktemp -d <template>` form used for `scratch_dir`
# and `gnupghome` above — every GNU and BSD mktemp accepts that form,
# and the `rm -rf "${scratch_dir}"` in cleanup() tears it down along
# with every other intermediate, so there's no separate cleanup branch.
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
hash_dir=$(mktemp -d "${scratch_dir}/hashes-XXXXXXXX")

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
    # `|| true` matches every other post-trap diagnostic echo in this
    # file. A dead Buildkite log aggregator delivers SIGPIPE here; an
    # unguarded echo under `set -eo pipefail` would exit 141 instead
    # of 1, making the caller see a pipe error instead of the real
    # sha256 failure.
    echo "error: sha256 failed for one or more artifacts" >&2 || true
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
    # `|| true` for the same SIGPIPE reason as the sha256-wait loop
    # above: a dead log aggregator would turn the real 'malformed
    # sha256' failure into a misleading exit 141 for the caller.
    echo "error: malformed sha256 for ${artifact}: '${sha}'" >&2 || true
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
# Nested inside `${scratch_dir}` (not /tmp) so a single `rm -rf scratch_dir`
# in cleanup() tears down both the intermediates and the keyring in one
# shot, and so the private-key material stays inside the release staging
# directory — which buildkite wipes between jobs — rather than /tmp,
# which on bare-metal agents outlives a single run. mktemp's template
# guarantees a unique subdir under scratch_dir.
gnupghome=$(mktemp -d "${scratch_dir}/.gnupg-XXXXXXXX")
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
#
# Structure:
#   1. `gpg --output "${tmp_signed_manifest}" ... || exit` — gpg writes
#      into a scratch-dir tmp path. The trailing `|| exit` is load-bearing:
#      without it, `set -e` would still fire on a non-zero gpg exit, but
#      the naked `exit` propagates gpg's own exit code (instead of whatever
#      subsequent command ran) so the caller can tell sign failed vs. mv.
#   2. `mv "${tmp_signed_manifest}" "${signed_manifest}"` — atomic rename
#      into the final output path. A gpg crash between `--output` opening
#      the target and the final bytes flushing cannot leave a partial .asc
#      at `${signed_manifest}`, because the target only appears via this
#      mv after gpg exits cleanly.
#   3. `signed_manifest_written=1` — set AFTER the mv so cleanup() only
#      rm's the output if we actually touched it, mirroring how
#      `manifest_written` is set after its mv in the collation block above.
#   4. `success=1` — entering the fully-signed path means every integrity
#      invariant is satisfied; cleanup() skips the rollback branch.
tmp_signed_manifest="${scratch_dir}/${signed_manifest_basename}.tmp"
GNUPGHOME="${gnupghome}" gpg \
  --batch --yes --quiet \
  --pinentry-mode loopback \
  --passphrase-fd 0 \
  --digest-algo SHA512 \
  --clearsign \
  --output "${tmp_signed_manifest}" \
  "${manifest}" <<< "${GPG_PASSPHRASE}" || exit
mv "${tmp_signed_manifest}" "${signed_manifest}"
signed_manifest_written=1
success=1

# Final diagnostic also guarded — same reasoning as the echo/cat above.
# Here success=1 is already set, so a SIGPIPE would leave the .txt and
# .asc on disk (cleanup() preserves them), but bash would still exit 141,
# and the caller in .buildkite/scripts/upload-release.sh treats any
# non-zero exit from the helper as a signing failure and skips the
# upload entirely — the exact canary-release integrity failure this PR
# fixes. `|| true` turns a logging hiccup into a clean exit 0.
echo "Signed ${signed_manifest}" >&2 || true
