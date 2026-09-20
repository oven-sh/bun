prefetch=/opt/bun-prefetch
mkdir -p "$prefetch"
(cd "$REPO_DIR" && bun scripts/prefetch-deps.ts "$prefetch")
chmod -R a-w "$prefetch"
set_env BUN_BUILD_PREFETCH_DIR "$prefetch"
