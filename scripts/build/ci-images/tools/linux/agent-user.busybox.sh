addgroup -S "$AGENT_USER"
adduser -S -G "$AGENT_USER" -s /bin/sh -h "$AGENT_HOME" -H -D "$AGENT_USER"
for dir in "$AGENT_HOME" "$AGENT_CACHE" "$AGENT_LOGS"; do
  mkdir -p "$dir"
  chown "$AGENT_USER:$AGENT_USER" "$dir"
done

# One checkout directory for every job, so compiler caches keyed on paths hit.
mkdir -p "$AGENT_HOME/hooks"
cat > "$AGENT_HOME/hooks/environment" <<HOOK
#!/bin/sh
set -efu
export BUILDKITE_BUILD_CHECKOUT_PATH=$AGENT_HOME/build
HOOK
chmod +x "$AGENT_HOME/hooks/environment"
chown -R "$AGENT_USER:$AGENT_USER" "$AGENT_HOME/hooks"
