cache=/var/cache/bun-install
mkdir -p "$cache"
for package in . test scripts/ci-remap-server; do
  (cd "$REPO_DIR/$package" && BUN_INSTALL_CACHE_DIR="$cache" bun install --ignore-scripts)
done
chown -R "$AGENT_USER:$AGENT_USER" "$cache"
set_env BUN_INSTALL_CACHE_DIR "$cache"
