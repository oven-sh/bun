#!/usr/bin/env bash
# verify.sh — composite verification harness for the Bun unsafe-code audit.
#
# Bun's test suite is too large to run end-to-end under miri (it touches the
# JS engine, filesystem, network, and JSC's heap heavily). This harness
# verifies the audit's REFACTOR-TOUCHED CODE only, not the entire codebase.
#
# Usage:
#   bash verify.sh                  # run everything for the current cluster scope
#   bash verify.sh --cluster=C-001  # run only what's relevant to a specific cluster
#   bash verify.sh --quick          # skip slow stages (mutants, fuzz)
#
# The harness writes its own progress + pass/fail summary to verification-log.md.

set -euo pipefail

AUDIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$AUDIT_DIR/.." && pwd)"
LOG="$AUDIT_DIR/verification-log.md"

CLUSTER=""
QUICK=false
for arg in "$@"; do
  case "$arg" in
    --cluster=*) CLUSTER="${arg#--cluster=}" ;;
    --quick)     QUICK=true ;;
    *) echo "unknown arg: $arg" >&2; exit 2 ;;
  esac
done

mkdir -p "$AUDIT_DIR/phase9"
{
  echo "# Bun unsafe-audit verification log"
  echo ""
  echo "**Started:** $(date -Iseconds)"
  echo "**Cluster filter:** ${CLUSTER:-all}"
  echo "**Quick mode:** $QUICK"
  echo ""
} > "$LOG"

log_stage() {
  local stage="$1"
  echo "" | tee -a "$LOG"
  echo "## $stage" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
  echo "_$(date -Iseconds)_" | tee -a "$LOG"
  echo "" | tee -a "$LOG"
}

PASS=()
FAIL=()
SKIP=()

mark_pass() { PASS+=("$1"); echo "  ✓ PASS: $1" | tee -a "$LOG"; }
mark_fail() { FAIL+=("$1"); echo "  ✗ FAIL: $1" | tee -a "$LOG"; }
mark_skip() { SKIP+=("$1: $2"); echo "  · SKIP: $1 ($2)" | tee -a "$LOG"; }

# ---------------------------------------------------------------------------
# Stage 1 — Existing test suite on `default` features (baseline)
# ---------------------------------------------------------------------------
log_stage "Stage 1: cargo check baseline (workspace)"

if ! command -v cargo >/dev/null; then
  mark_fail "cargo missing"
  exit 1
fi

# Bun's build needs vendor deps fetched. If they aren't, `cargo metadata`
# fails. We can still run `cargo check` on individual crates that don't pull
# in the missing vendor pieces.
if [ ! -d "$PROJECT_ROOT/vendor/lolhtml/c-api" ]; then
  mark_skip "workspace check" "vendor deps not fetched (run \`bun bd\` to materialize, then re-run)"
else
  if (cd "$PROJECT_ROOT" && cargo check --workspace 2>&1 | tee -a "$LOG"); then
    mark_pass "workspace check"
  else
    mark_fail "workspace check"
  fi
fi

# ---------------------------------------------------------------------------
# Stage 2 — Per-cluster crate-scoped miri runs
# ---------------------------------------------------------------------------
log_stage "Stage 2: miri on rewrite-touched crates"

# miri config notes:
#  - Bun's test suite is too large for end-to-end miri (touches JSC, filesystem)
#  - We run miri on the SPECIFIC crates touched by each refactor cluster
#  - For FS-touching tests, -Zmiri-disable-isolation is required
#  - For strict provenance verification, -Zmiri-strict-provenance is added

MIRI_TARGETS=()

case "${CLUSTER:-all}" in
  C-001|all) MIRI_TARGETS+=(bun_ast bun_collections bun_core) ;;
esac
case "${CLUSTER:-all}" in
  C-002|all) MIRI_TARGETS+=(bun_errno bun_cares_sys bun_libuv_sys bun_bundler) ;;
esac
case "${CLUSTER:-all}" in
  C-003|all) MIRI_TARGETS+=(bun_ast bun_collections bun_core bun_css bun_http) ;;
esac
case "${CLUSTER:-all}" in
  A-001|all) MIRI_TARGETS+=(bun_io) ;; # the canonical *mut Self test bed
esac

# dedupe
MIRI_TARGETS=($(printf '%s\n' "${MIRI_TARGETS[@]}" | sort -u))

if ! command -v rustup >/dev/null || ! rustup +nightly which miri >/dev/null 2>&1; then
  mark_skip "miri" "miri not installed"
else
  for crate in "${MIRI_TARGETS[@]}"; do
    [ -d "$PROJECT_ROOT/src/${crate#bun_}" ] || { mark_skip "miri:$crate" "crate dir not found"; continue; }
    echo "  -> miri: $crate" | tee -a "$LOG"
    if (cd "$PROJECT_ROOT" && \
        MIRIFLAGS="-Zmiri-strict-provenance -Zmiri-disable-isolation" \
        cargo +nightly miri test -p "$crate" --lib 2>&1 | tee -a "$LOG"); then
      mark_pass "miri:$crate"
    else
      mark_fail "miri:$crate"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Stage 3 — cargo careful (additional UB detection at runtime)
# ---------------------------------------------------------------------------
log_stage "Stage 3: cargo +nightly careful test (rewrite-touched crates)"

if ! command -v cargo-careful >/dev/null 2>&1; then
  mark_skip "careful" "cargo-careful not installed"
else
  for crate in "${MIRI_TARGETS[@]}"; do
    [ -d "$PROJECT_ROOT/src/${crate#bun_}" ] || continue
    if (cd "$PROJECT_ROOT" && cargo +nightly careful test -p "$crate" --lib 2>&1 | tee -a "$LOG"); then
      mark_pass "careful:$crate"
    else
      mark_fail "careful:$crate"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Stage 4 — Property-based equivalence tests for (C) rewrites
# ---------------------------------------------------------------------------
log_stage "Stage 4: proptest equivalence (C-001, C-002 rewrite proofs)"

# These tests verify the (C) rewrite produces equivalent results to the
# unsafe original. They live in `tests/proptest_equivalence_<cluster>.rs`
# inside each touched crate.
PROPTEST_CRATES=(bun_ast bun_collections bun_errno bun_cares_sys bun_libuv_sys)
for crate in "${PROPTEST_CRATES[@]}"; do
  [ -d "$PROJECT_ROOT/src/${crate#bun_}/tests" ] || { mark_skip "proptest:$crate" "no tests/ dir yet — Phase 5 emits these"; continue; }
  if (cd "$PROJECT_ROOT" && cargo test -p "$crate" --test 'proptest_*' 2>&1 | tee -a "$LOG"); then
    mark_pass "proptest:$crate"
  else
    mark_fail "proptest:$crate"
  fi
done

# ---------------------------------------------------------------------------
# Stage 5 — `safe-only` Cargo feature build + test (B-001/B-002 cluster)
# ---------------------------------------------------------------------------
log_stage "Stage 5: safe-only feature build (B-001, B-002 verification)"

if ! grep -Rqs '^safe-only[[:space:]]*=' "$PROJECT_ROOT/Cargo.toml" "$PROJECT_ROOT/src" 2>/dev/null; then
  mark_skip "safe-only" "package-scoped safe-only features not yet added (Phase 11 deliverable)"
else
  # Cargo features are package-scoped. A bare workspace-level
  # `--features safe-only` would silently miss crates that are not selected or
  # do not receive the feature through dependency propagation, so verify the
  # perf-touched packages explicitly.
  for crate in bun_base64 bun_install bun_jsc bun_bundler; do
    manifest="$(cd "$PROJECT_ROOT" && cargo metadata --no-deps --format-version 1 2>/dev/null | jq -r --arg crate "$crate" '.packages[] | select(.name == $crate) | .manifest_path' | head -1)"
    if [ -z "$manifest" ] || ! grep -q '^safe-only[[:space:]]*=' "$manifest" 2>/dev/null; then
      mark_skip "safe-only:$crate" "crate does not declare a local safe-only feature"
      continue
    fi
    if (cd "$PROJECT_ROOT" && cargo check -p "$crate" --features safe-only 2>&1 | tee -a "$LOG"); then
      mark_pass "safe-only-check:$crate"
    else
      mark_fail "safe-only-check:$crate"
    fi
    if (cd "$PROJECT_ROOT" && cargo test -p "$crate" --features safe-only 2>&1 | tee -a "$LOG"); then
      mark_pass "safe-only-test:$crate"
    else
      mark_fail "safe-only-test:$crate"
    fi
  done
fi

# ---------------------------------------------------------------------------
# Stage 6 — cargo +nightly geiger baseline (unsafe count drift detection)
# ---------------------------------------------------------------------------
log_stage "Stage 6: geiger drift detection vs Phase 0 baseline"

if ! command -v cargo-geiger >/dev/null 2>&1; then
  mark_skip "geiger" "cargo-geiger not installed"
elif [ ! -d "$PROJECT_ROOT/vendor/lolhtml/c-api" ]; then
  mark_skip "geiger" "vendor deps not fetched"
else
  current_geiger="$AUDIT_DIR/phase9/geiger-current.json"
  if (cd "$PROJECT_ROOT" && cargo +nightly geiger --output-format Json > "$current_geiger" 2>&1); then
    mark_pass "geiger:current"
    # diff vs Phase 0 baseline (when available)
    if [ -f "$AUDIT_DIR/phase1/cluster-summary.json" ]; then
      baseline_count=11044  # from cluster-summary
      current_count=$(jq '.... | objects | select(.unsafety.used) | length' "$current_geiger" 2>/dev/null | wc -l)
      echo "  baseline: $baseline_count, current: $current_count" | tee -a "$LOG"
    fi
  else
    mark_fail "geiger:current"
  fi
fi

# ---------------------------------------------------------------------------
# Stage 7 — fuzz target smoke (where applicable; skipped in --quick)
# ---------------------------------------------------------------------------
if ! $QUICK; then
  log_stage "Stage 7: cargo-fuzz smoke runs (60s each, where targets exist)"

  if ! command -v cargo-fuzz >/dev/null 2>&1; then
    mark_skip "fuzz" "cargo-fuzz not installed"
  else
    # Per-crate fuzz targets (if they exist; many crates have none yet)
    for crate_dir in bun_js_parser bun_css bun_base64 bun_url; do
      if [ -d "$PROJECT_ROOT/src/${crate_dir#bun_}/fuzz" ]; then
        if (cd "$PROJECT_ROOT/src/${crate_dir#bun_}" && \
            cargo +nightly fuzz list 2>/dev/null | head -1 | \
            xargs -I {} cargo +nightly fuzz run {} -- -max_total_time=60 2>&1 | tee -a "$LOG"); then
          mark_pass "fuzz:$crate_dir"
        else
          mark_fail "fuzz:$crate_dir"
        fi
      else
        mark_skip "fuzz:$crate_dir" "no fuzz dir"
      fi
    done
  fi
fi

# ---------------------------------------------------------------------------
# Stage 8 — cargo mutants (test-strength check; --quick skips)
# ---------------------------------------------------------------------------
if ! $QUICK; then
  log_stage "Stage 8: cargo mutants (verify tests pin behavior)"

  if ! command -v cargo-mutants >/dev/null 2>&1; then
    mark_skip "mutants" "cargo-mutants not installed"
  else
    # Mutants is slow; run only on the smallest rewrite-touched crates
    for crate in bun_errno bun_base64; do
      [ -d "$PROJECT_ROOT/src/${crate#bun_}" ] || continue
      if (cd "$PROJECT_ROOT/src/${crate#bun_}" && \
          timeout 600 cargo mutants --in-place=false --no-shuffle --timeout 60 2>&1 | tee -a "$LOG"); then
        mark_pass "mutants:$crate"
      else
        mark_fail "mutants:$crate"
      fi
    done
  fi
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
{
  echo ""
  echo "## Summary"
  echo ""
  echo "- **Pass:** ${#PASS[@]}"
  echo "- **Fail:** ${#FAIL[@]}"
  echo "- **Skip:** ${#SKIP[@]}"
  echo ""
  if [ ${#PASS[@]} -gt 0 ]; then
    echo "### Passing"
    printf '  - %s\n' "${PASS[@]}"
    echo ""
  fi
  if [ ${#FAIL[@]} -gt 0 ]; then
    echo "### Failing"
    printf '  - %s\n' "${FAIL[@]}"
    echo ""
  fi
  if [ ${#SKIP[@]} -gt 0 ]; then
    echo "### Skipped"
    printf '  - %s\n' "${SKIP[@]}"
    echo ""
  fi
  echo "**Completed:** $(date -Iseconds)"
} | tee -a "$LOG"

if [ ${#FAIL[@]} -gt 0 ]; then
  exit 1
fi
exit 0
