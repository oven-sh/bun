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

# 3. Bring tailscale back via a *userspace* tailscaled — no root needed.
# The system-daemon plist was removed during the failed brew migration and
# /Library/LaunchDaemons is root-only, so we run tailscaled with
# --tun=userspace-networking from a user LaunchAgent instead. That's enough
# for tailscale-ssh (it's tailscaled's own SSH server, not OS sshd). Once
# we're back in via tailscale-ssh as root, we'll reinstall the system daemon
# properly and remove this LaunchAgent.
#
# Only act on the broken box (public IP match). Siblings are fine.
PUBIP="$(curl -s --max-time 3 ifconfig.me || true)"
if [ "$PUBIP" = "207.254.60.44" ]; then

  echo "--- this is x64-1; re-authenticating system tailscaled"

  # Clean up the abandoned userspace LaunchAgent attempt from the previous
  # revision (it failed to bootstrap from a non-GUI session anyway).
  rm -f "$HOME/Library/LaunchAgents/com.tailscale.userspace.plist"
  rm -rf "$HOME/.tailscale-userspace"

  # The system daemon IS running (see diagnostics) but the node was removed
  # server-side, so it's connected-to-nothing with stale local state. Re-auth
  # it with a fresh key. `tailscale up` talks to the running tailscaled over
  # its local socket; the operator is the install user, so administrator can
  # do this without sudo.
  KEY="$(buildkite-agent secret get TAILSCALE_AUTH_KEY_TMP 2>/dev/null || true)"
  if [ -z "$KEY" ]; then
    echo "WARN: TAILSCALE_AUTH_KEY_TMP secret not set — skipping re-auth"
  else
    /usr/local/bin/tailscale up \
      --auth-key="$KEY" \
      --force-reauth \
      --ssh \
      --hostname="darwin-test-x64-1" \
      --advertise-tags=tag:server \
      --accept-risk=all 2>&1
    rc=$?
    echo "tailscale up exit=$rc"
    # Don't print `tailscale status` — it leaks tailnet device names/IPs to
    # the public build log. Self-IP only is enough to confirm.
    /usr/local/bin/tailscale ip -4 2>&1 || true
  fi
else
  echo "not x64-1 ($PUBIP) — skipping re-auth"
fi

echo "--- done; agent will pick up cfg on next restart"
exit 0
