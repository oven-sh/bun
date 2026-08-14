#!/bin/bash
# Clones rolldown/benchmarks (bundler benchmark) under $SITEBENCH_HOME and installs the deps of the bench/ sources in this
# checkout (express, websocket-server, postgres). Idempotent. Run setup-toolchains.sh first.
set -euo pipefail
SITE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); BENCH_DIR=$(cd "$SITE_DIR/.." && pwd)
S=${SITEBENCH_HOME:-$HOME/sitebench}; T=$S/toolchains
ROLLDOWN_BENCH_REV=${ROLLDOWN_BENCH_REV:-257a585028663a339641e72e0c2d9ea6a0aa2752}
export PATH=$T/npm-global/bin:$T/node/bin:$PATH
mkdir -p "$S"; cd "$S"
[ -d benchmarks ] || git clone --depth 1 https://github.com/rolldown/benchmarks.git
(cd benchmarks && git fetch -q --depth 1 origin "$ROLLDOWN_BENCH_REV" && git checkout -q FETCH_HEAD && git log -1 --format="rolldown/benchmarks at %h %ci")
echo "--- rolldown/benchmarks pnpm install"; (cd benchmarks && pnpm install --frozen-lockfile --config.strict-dep-builds=false 2>&1 | tail -3)
for d in express websocket-server postgres; do
  echo "--- bench/$d"; (cd "$BENCH_DIR/$d" && "$T/bun-release/bun" install 2>&1 | tail -2)
done
echo "--- deno warms (express + postgres)"
(cd "$BENCH_DIR/express" && "$T/deno/deno" install --allow-scripts >/dev/null 2>&1 || true)
(cd "$BENCH_DIR/postgres" && "$T/deno/deno" install --allow-scripts >/dev/null 2>&1 || true)
echo REPOS_DONE
