#!/bin/sh
# Nightly cleanup of a bare macOS test runner. `agent.mjs install` embeds this file in
# /Library/LaunchDaemons/com.buildkite.cleanup.plist, which runs it as root at 06:27 local time with
# AGENT_HOME (the agent home, where builds/ lives) in its environment.
#
# The wipe never runs under a job. On its first SIGTERM buildkite-agent stops taking jobs, finishes the
# job it is running, and exits 0. `agent.mjs start` forwards the signal to it, and launchd (KeepAlive
# SuccessfulExit=false) leaves the service down until RunAtLoad starts it again after the reboot.

: "${AGENT_HOME:?}"

# Through launchd, not `pkill -x buildkite-agent`: that would also signal the `buildkite-agent bootstrap`
# process of the running job.
launchctl kill SIGTERM system/buildkite-agent

waited=0
while pgrep -x buildkite-agent >/dev/null && [ "$waited" -lt 7200 ]; do
  sleep 30
  waited=$((waited + 30))
done

if pgrep -x buildkite-agent >/dev/null; then
  # The reboot ends the job as a lost agent, which .buildkite/ci.mjs retries. The wipe waits for a night
  # when the agent exits in time.
  echo "$(date) agent still running after ${waited}s, rebooting without the wipe"
else
  echo "$(date) agent exited after ${waited}s, wiping and rebooting"
  # builds/ itself, not builds/*: a glob would follow a builds symlink a job left behind, rm does not.
  # The agent creates the directory again for its next job.
  rm -rf "$AGENT_HOME"/builds /tmp/* /var/tmp/*
fi

shutdown -r now || reboot || launchctl kickstart system/buildkite-agent
