#!/bin/bash
# One-shot recovery for darwin-test-x64-1 (and harmless on its siblings).
# Runs as the buildkite-agent's user (administrator) — no sudo, since the
# cfg and /usr/local/bin are administrator:admin on the Homebrew x64 boxes.
set -uo pipefail

echo "--- host: $(hostname) / $(curl -s --max-time 3 ifconfig.me || true)"

# 1. Restore tailscale binaries if they were removed.
for b in tailscale tailscaled; do
  if [ ! -e "/usr/local/bin/$b" ]; then
    if [ -x "$HOME/go/bin/$b" ]; then
      if cp "$HOME/go/bin/$b" "/usr/local/bin/$b" 2>/dev/null && chmod 755 "/usr/local/bin/$b"; then
        echo "restored /usr/local/bin/$b"
      else
        echo "WARN: cannot write /usr/local/bin/$b (need root) — skipping"
      fi
    fi
  else
    echo "/usr/local/bin/$b already present"
  fi
done

# 2. Add release-tier=oldest to the agent cfg if missing.
CFG=/usr/local/etc/buildkite-agent/buildkite-agent.cfg
if [ -f "$CFG" ] && ! grep -q "release-tier=" "$CFG"; then
  cp "$CFG" "$CFG.bak-tier"
  sed -i '' 's/^tags="\(.*\)"$/tags="\1,release-tier=oldest"/' "$CFG"
  echo "added release-tier=oldest:"
  grep '^tags=' "$CFG"
else
  echo "cfg already has release-tier (or cfg not at $CFG)"
fi

echo "--- done; agent will pick up cfg on next restart"
exit 0
