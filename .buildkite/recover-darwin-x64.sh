#!/bin/bash
# One-shot recovery for darwin-test-x64-1 (and harmless on its siblings).
# - Restores /usr/local/bin/tailscale{,d} from the go-installed copies so
#   tailscale-ssh works again after the next reboot.
# - Adds release-tier=oldest to the buildkite-agent cfg if missing.
# Idempotent: safe to run on any macOS-13 x64 test box.
set -euo pipefail

echo "--- host: $(hostname) / $(curl -s --max-time 3 ifconfig.me || true)"

# 1. Restore tailscale binaries if they were removed.
for b in tailscale tailscaled; do
  if [ ! -e "/usr/local/bin/$b" ] || [ -L "/usr/local/bin/$b" ] && [ ! -e "$(readlink -f "/usr/local/bin/$b" 2>/dev/null)" ]; then
    if [ -x "$HOME/go/bin/$b" ]; then
      sudo cp "$HOME/go/bin/$b" "/usr/local/bin/$b"
      sudo chmod 755 "/usr/local/bin/$b"
      echo "restored /usr/local/bin/$b"
    fi
  else
    echo "/usr/local/bin/$b already present"
  fi
done

# 2. Add release-tier=oldest to the agent cfg if missing.
CFG=/usr/local/etc/buildkite-agent/buildkite-agent.cfg
if [ -f "$CFG" ] && ! grep -q "release-tier=" "$CFG"; then
  sudo cp "$CFG" "$CFG.bak-tier"
  sudo sed -i '' 's/^tags="\(.*\)"$/tags="\1,release-tier=oldest"/' "$CFG"
  echo "added release-tier=oldest to $CFG"
  grep '^tags=' "$CFG"
else
  echo "cfg already has release-tier or not found"
fi

echo "--- done; agent will pick up cfg on next restart (daily reboot or manual)"
