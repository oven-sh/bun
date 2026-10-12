#!/bin/bash
# Runs inside a fresh guest to turn the base image into bun-ci-base, after the host has put the generated toolchain
# script at /tmp/bootstrap.sh. Args: <buildkite-agent version> <tools to verify>
set -euo pipefail
exec </dev/null
agent_version=$1 toolchain=$2

printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' | sudo tee /etc/ssh/sshd_config.d/000-hardening.conf >/dev/null
sudo /System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart -deactivate -stop >/dev/null 2>&1 || true
sudo launchctl disable system/com.apple.screensharing 2>/dev/null || true

eval "$(/opt/homebrew/bin/brew shellenv)"
# the base image ships a brew node that shadows the pinned one
brew uninstall --force --ignore-dependencies node node@24 node@22 >/dev/null 2>&1 || true
rm -f /opt/homebrew/bin/node /opt/homebrew/bin/npm /opt/homebrew/bin/npx

sh /tmp/bootstrap.sh

missing=0
for tool in $toolchain; do
  path=$(bash -lc "command -v $tool" || true)
  printf '  %-10s %s\n' "$tool" "${path:-MISSING}"
  [ -n "$path" ] || missing=1
done
[ "$missing" = 0 ] || exit 1

tmp=$(mktemp -d)
curl -fsSL -o "$tmp/agent.tgz" "https://github.com/buildkite/agent/releases/download/v$agent_version/buildkite-agent-darwin-arm64-$agent_version.tar.gz"
tar -xzf "$tmp/agent.tgz" -C "$tmp"
sudo mkdir -p /usr/local/bin
sudo install -m 755 "$tmp/buildkite-agent" /usr/local/bin/buildkite-agent

mkdir -p ~/work
rm -rf "$tmp" /tmp/bootstrap.sh ~/Library/Caches/Homebrew/downloads
echo BAKE_OK
