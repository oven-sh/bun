#!/bin/sh
# Nightly cleanup of a bare macOS test runner. `agent.mjs install` embeds this file in
# /Library/LaunchDaemons/com.buildkite.cleanup.plist, which runs it as root at 06:27 local time with
# AGENT_HOME (the agent home, with builds/ and cache/) and AGENT_USER (the user the agent runs as).
#
# It stops the agent before the wipe and the reboot. On its first SIGTERM buildkite-agent stops taking
# jobs, finishes the job it is running, and exits 0. `agent.mjs start` forwards the signal to it, and
# launchd (KeepAlive SuccessfulExit=false) leaves the service down until RunAtLoad starts it after the
# reboot.

: "${AGENT_HOME:?}" "${AGENT_USER:?}"

launchctl kill SIGTERM system/buildkite-agent

# Past the deadline, reboot with the job still running. Buildkite records it as a lost agent and
# .buildkite/ci.mjs retries it.
waited=0
while pgrep -x buildkite-agent >/dev/null && [ "$waited" -lt 7200 ]; do
  sleep 30
  waited=$((waited + 30))
done
echo "$(date) agent stopped after ${waited}s, wiping and rebooting"

# The paths cover the Homebrew layout of the older x64 boxes as well as the Library layout of agent.mjs.
BASE_PREFIX=/usr/local
[ "$(uname -m)" = arm64 ] && BASE_PREFIX=/opt/homebrew
rm -rf "$BASE_PREFIX"/var/buildkite-agent/builds/* "$BASE_PREFIX"/var/buildkite-agent/cache/* \
  "$BASE_PREFIX"/etc/buildkite-agent/builds/* "$BASE_PREFIX"/etc/buildkite-agent/cache/* \
  "$AGENT_HOME"/builds/* "$AGENT_HOME"/cache/* /tmp/* /var/tmp/*
chown -R "$AGENT_USER":admin "$BASE_PREFIX"/var/buildkite-agent "$BASE_PREFIX"/etc/buildkite-agent
chmod -R 755 "$BASE_PREFIX"/var/buildkite-agent "$BASE_PREFIX"/etc/buildkite-agent

shutdown -r now || reboot || launchctl kickstart system/buildkite-agent
