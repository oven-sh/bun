#!/bin/bash
# Runs inside the per-job guest. Expects ~/job.env (exported by the command hook) and the checkout at ~/work.
set -u
export PATH=/usr/local/bin:/opt/homebrew/bin:/opt/rust/bin:$PATH
# bootstrap.sh installs rustup into /opt/rust and only exports these from the login profile, which this script
# does not source; without them the proxies in /opt/rust/bin look for a toolchain in ~/.rustup and find none.
export RUSTUP_HOME=/opt/rust CARGO_HOME=/opt/rust
export BUILDKITE_BUILD_CHECKOUT_PATH=$HOME/work
set -a; source ~/job.env || exit 1; set +a
cd ~/work || exit 1

echo "[guest] macOS $(sw_vers -productVersion) shard=${BUILDKITE_PARALLEL_JOB:-0}/${BUILDKITE_PARALLEL_JOB_COUNT:-1}"
# warms node_modules with the guest's bun; the runner repeats both installs with the bun under test and reports those
for dir in . test; do
  (cd "$dir" && bun install) >"$HOME/install.out" 2>&1 || { echo "[guest] bun install in $dir failed:"; cat "$HOME/install.out"; }
done

# the runner can leak servers that keep node alive after the run, so wait on it directly and stream its log
log=$HOME/runner.out
: >"$log"
bash -e -o pipefail -c "$BUILDKITE_COMMAND" >"$log" 2>&1 &
runner=$!
tail -f "$log" &
tailer=$!
wait $runner
status=$?
kill $tailer 2>/dev/null
exit $status
