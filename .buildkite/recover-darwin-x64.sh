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
# Diagnostics — figure out why the system daemon isn't reachable even
# though the plist exists.
echo "--- tailscale diagnostics"
ls -l /Library/LaunchDaemons/com.tailscale.tailscaled.plist /usr/local/bin/tailscaled 2>&1
launchctl print system/com.tailscale.tailscaled 2>&1 | grep -E "state|pid|last exit" || true
pgrep -fl tailscaled || echo "(no tailscaled process)"
/usr/local/bin/tailscale status 2>&1 | head -5 || true
ls -la /Library/Tailscale/ 2>&1 || true

# Only act on the broken box (public IP match). Siblings are fine.
PUBIP="$(curl -s --max-time 3 ifconfig.me || true)"
if [ "$PUBIP" = "207.254.60.44" ]; then

  echo "--- this is x64-1; bootstrapping userspace daemon"

  KEY="$(buildkite-agent secret get TAILSCALE_AUTH_KEY_TMP 2>/dev/null || true)"
  if [ -z "$KEY" ]; then
    echo "WARN: TAILSCALE_AUTH_KEY_TMP secret not set — skipping tailscale bring-up"
  else
    TS_HOME="$HOME/.tailscale-userspace"
    SOCK="$TS_HOME/tailscaled.sock"
    mkdir -p "$TS_HOME" "$HOME/Library/LaunchAgents"

    # User LaunchAgent so it survives the daily reboot until we replace it
    # with the real system daemon. RunAtLoad+KeepAlive = start at login and
    # restart on crash.
    cat > "$HOME/Library/LaunchAgents/com.tailscale.userspace.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.tailscale.userspace</string>
  <key>ProgramArguments</key><array>
    <string>/usr/local/bin/tailscaled</string>
    <string>--tun=userspace-networking</string>
    <string>--statedir=$TS_HOME</string>
    <string>--socket=$SOCK</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$TS_HOME/tailscaled.log</string>
  <key>StandardErrorPath</key><string>$TS_HOME/tailscaled.log</string>
</dict></plist>
PLIST

    # Start now. bootstrap is idempotent-ish; ignore "already loaded" noise.
    launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/com.tailscale.userspace.plist" 2>&1 || true
    launchctl kickstart -k "gui/$(id -u)/com.tailscale.userspace" 2>&1 || true

    # Give tailscaled a moment to open its socket.
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      [ -S "$SOCK" ] && break
      sleep 1
    done

    if [ -S "$SOCK" ]; then
      # Register as a fresh node; we'll merge/clean up in the admin console.
      # Hostname suffix makes it obvious this is the temporary userspace node.
      /usr/local/bin/tailscale --socket="$SOCK" up \
        --auth-key="$KEY" \
        --ssh \
        --hostname="darwin-test-x64-1-userspace" \
        --advertise-tags=tag:server \
        --accept-risk=all 2>&1
      echo "--- tailscale userspace status:"
      /usr/local/bin/tailscale --socket="$SOCK" status 2>&1 | head -3
    else
      echo "ERROR: tailscaled socket never appeared"
      tail -n 40 "$TS_HOME/tailscaled.log" 2>/dev/null || true
    fi
  fi
else
  echo "not x64-1 ($PUBIP) — skipping userspace bring-up"
fi

echo "--- done; agent will pick up cfg on next restart"
exit 0
