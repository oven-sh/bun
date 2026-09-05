#!/bin/bash
# Runs inside the per-job guest. Expects ~/job.env (exported by the command hook) and the checkout at ~/work.
set -u
export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/rust/bin:$PATH
# bootstrap.sh installs rustup into /opt/rust and only exports these from the login profile, which this script
# does not source; without them the proxies in /opt/rust/bin look for a toolchain in ~/.rustup and find none.
export RUSTUP_HOME=/opt/rust CARGO_HOME=/opt/rust
export BUILDKITE_BUILD_CHECKOUT_PATH=$HOME/work
set -a; source ~/job.env; set +a
cd ~/work

echo "[guest] macOS $(sw_vers -productVersion) shard=${BUILDKITE_PARALLEL_JOB:-0}/${BUILDKITE_PARALLEL_JOB_COUNT:-1}"

# Best-effort cache warmup before the runner's own `bun install`. macOS has no timeout(1), and a guest
# whose network stalls here would otherwise sit silent until Buildkite's job timeout kills it.
warm_install() {
  bun install >/dev/null 2>&1 &
  local pid=$!
  ( sleep 180; kill "$pid" 2>/dev/null && echo "[guest] bun install in $PWD timed out after 180s" ) &
  local watchdog=$!
  wait "$pid" 2>/dev/null
  kill "$watchdog" 2>/dev/null
}
warm_install
(cd test && warm_install)

shard=()
[ -n "${BUILDKITE_PARALLEL_JOB:-}" ] && shard=(--shard="$BUILDKITE_PARALLEL_JOB" --max-shards="$BUILDKITE_PARALLEL_JOB_COUNT")

# the runner can leak servers that keep node alive after the run, so wait on it directly and stream its log
log=$HOME/runner.out
: >"$log"
$BUILDKITE_COMMAND "${shard[@]}" >"$log" 2>&1 &
runner=$!
tail -f "$log" &
tailer=$!
wait $runner
status=$?
kill $tailer 2>/dev/null
exit $status
