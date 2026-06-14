#!/usr/bin/env bash
# scripts/audit/triage-soak-results.sh — META-SOAK-TRIAGE
#
# STAGED LOCATION: .ub-exorcism/2026-05-15-exhaustive/scripts/audit/triage-soak-results.sh
# CANONICAL LOCATION: scripts/audit/triage-soak-results.sh
#
# Pulls + triages Phase-11 SOAK campaign results from a remote worker.
# Per phase11_execution_log.md the SOAK state is: 4 Miri configs (sb/tb/sp/sa)
# + 2 sanitizers (asan/tsan) running under nohup; PIDs in
# <worker-dir>/logs/<tag>.pid.
#
# Configuration (REQUIRED via environment — no defaults, to avoid embedding
# any operator-specific host or SSH key path in a public artifact):
#
#   BUN_SOAK_WORKER  user@host of the SOAK worker (e.g. ubuntu@worker.example.com)
#   BUN_SOAK_KEY     optional path to ssh private key (default: ssh agent)
#   BUN_SOAK_DIR     optional worker-side dir holding the run (default: /home/ubuntu/bun-ub-soak)
#
# Usage:
#   BUN_SOAK_WORKER=ubuntu@your-worker.example.com triage-soak-results.sh
#   triage-soak-results.sh --kill <tag>     # kill a stuck campaign on the worker
#   triage-soak-results.sh --json           # JSON output

set -euo pipefail
JSON=0; KILL_TAG=""
WORKER="${BUN_SOAK_WORKER:-}"
KEY="${BUN_SOAK_KEY:-}"
WORKER_DIR="${BUN_SOAK_DIR:-/home/ubuntu/bun-ub-soak}"

if [[ -z "$WORKER" ]]; then
    echo "ERROR: BUN_SOAK_WORKER not set. Provide user@host of your SOAK worker:" >&2
    echo "  BUN_SOAK_WORKER=ubuntu@your-worker.example.com $0" >&2
    exit 2
fi

while [[ $# -gt 0 ]]; do
    case "$1" in
        --json)   JSON=1; shift ;;
        --kill)   KILL_TAG="$2"; shift 2 ;;
        --worker) WORKER="$2"; shift 2 ;;
        *) echo "unknown flag: $1" >&2; exit 2 ;;
    esac
done

REPO_ROOT="$(cd "$(dirname "$0")/../../../.." && pwd)"
LOCAL_DIR="$REPO_ROOT/.ub-exorcism/2026-05-15-exhaustive/phase11_artifacts/soak-results"
mkdir -p "$LOCAL_DIR"

SSH_CMD=(ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)
[[ -f "$KEY" ]] && SSH_CMD+=(-i "$KEY")

if [[ -n "$KILL_TAG" ]]; then
    # Tag must be alphanumeric / dash / underscore — prevent remote shell
    # injection (the tag is interpolated into the ssh command line).
    if [[ ! "$KILL_TAG" =~ ^[A-Za-z0-9_-]+$ ]]; then
        echo "ERROR: --kill <tag> must match [A-Za-z0-9_-]+, got: $KILL_TAG" >&2
        exit 2
    fi
    echo "Killing $KILL_TAG on $WORKER..."
    "${SSH_CMD[@]}" "$WORKER" "pkill -F $WORKER_DIR/logs/${KILL_TAG}.pid || true; rm -f $WORKER_DIR/logs/${KILL_TAG}.pid"
    exit 0
fi

# 1. Status check.
#    The remote shell script EMITS TAB-SEPARATED FIELDS so the local parser
#    can split deterministically. The earlier version used `echo "$a$b$c$d"`
#    which produced an unparseable concatenation (the `column -t` filter
#    did nothing because there were no tabs to split on).
echo "[soak-triage] querying $WORKER status..."
STATUS_RAW="$("${SSH_CMD[@]}" "$WORKER" "
for p in $WORKER_DIR/logs/*.pid; do
    [[ -f \"\$p\" ]] || continue
    tag=\$(basename \"\$p\" .pid)
    pid=\$(cat \"\$p\")
    state=\$(kill -0 \"\$pid\" 2>/dev/null && echo RUNNING || echo DONE)
    lines=\$(wc -l < \"$WORKER_DIR/logs/\$tag.log\" 2>/dev/null || echo 0)
    # Use SOH (0x01) separator so empty fields don't get collapsed by
    # IFS-splitting on the local end. `IFS=\$'\\t' read` treats tab as
    # whitespace and merges consecutive tabs into one separator, which
    # would silently shift fields if pid or state were empty.
    printf '%s\x01%s\x01%s\x01%s\n' \"\$tag\" \"\$state\" \"\$pid\" \"\$lines\"
done
" 2>&1 || echo "ssh failed")"

# 2. Per-campaign pull for DONE logs.
SUMMARIES=()
while IFS=$'\x01' read -r tag state pid lines; do
    [[ -z "$tag" || "$tag" == "ssh"* || "$state" != "DONE" ]] && continue

    LOCAL_LOG="$LOCAL_DIR/${tag}-$(date -u +%Y%m%d-%H%M).log"
    if [[ ! -f "$LOCAL_LOG" ]]; then
        # Use array expansion via -e <command> by quoting properly. ssh option
        # strings don't contain spaces in our defaults, but the "${SSH_CMD[*]}"
        # joined-with-IFS pattern is fragile. rsync's -e wants a single string,
        # so we explicitly join with spaces (preserving the simple options used).
        rsh_str="${SSH_CMD[*]}"
        if rsync -avz --quiet -e "$rsh_str" \
                "$WORKER:$WORKER_DIR/logs/$tag.log" "$LOCAL_LOG" 2>/dev/null; then
            ub_count=$(grep -cE 'error: Undefined Behavior' "$LOCAL_LOG" || true)
            SUMMARIES+=("$tag DONE ub_lines=$ub_count log=$LOCAL_LOG")
        fi
    fi
done <<< "$STATUS_RAW"

if [[ $JSON -eq 1 ]]; then
    # Pass status + summaries via a temp file (avoids heredoc shell-injection
    # if a campaign tag or log path contains $, \, ', or """).
    STATUS_FILE="$(mktemp)"; SUMMARIES_FILE="$(mktemp)"
    trap 'rm -f "$STATUS_FILE" "$SUMMARIES_FILE"' EXIT
    printf '%s' "$STATUS_RAW" > "$STATUS_FILE"
    printf '%s\n' "${SUMMARIES[@]}" > "$SUMMARIES_FILE"
    python3 - "$STATUS_FILE" "$SUMMARIES_FILE" <<'PYEOF'
import json, sys
status = open(sys.argv[1]).read().strip()
summaries = [l for l in open(sys.argv[2]).read().splitlines() if l.strip()]
print(json.dumps({'status': status, 'pulled': summaries}, indent=2))
PYEOF
else
    echo ""
    echo "=== Campaign status on $WORKER ==="
    # Translate SOH (0x01) separators back to tabs for human display.
    # Internally we use SOH so empty fields don't collapse under bash's
    # tab-is-whitespace IFS behavior (see line 70 fix); but for printing
    # we want visible spacing.
    printf '%s\n' "$STATUS_RAW" | tr '\001' '\t' | column -t -s $'\t' 2>/dev/null \
        || printf '%s\n' "$STATUS_RAW" | tr '\001' '\t'
    echo ""
    if [[ ${#SUMMARIES[@]} -gt 0 ]]; then
        echo "=== Pulled DONE campaigns ==="
        printf '  %s\n' "${SUMMARIES[@]}"
    else
        echo "(no new DONE logs to pull)"
    fi
fi

# 3. If any DONE log shows UB, recommend next steps
for s in "${SUMMARIES[@]}"; do
    if echo "$s" | grep -q 'ub_lines=[^0]'; then
        log_path="$(echo "$s" | grep -oE 'log=[^ ]+' | cut -d= -f2)"
        echo ""
        echo "[soak-triage] UB DETECTED in $log_path"
        echo "  -> next: run scripts/audit/match-signal-to-exp.py < $log_path"
        echo "  -> if no match: file-new-exp-triplet.sh EXP-NNN \"title\""
    fi
done
