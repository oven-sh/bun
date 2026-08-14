#!/bin/bash
# Clones rolldown/benchmarks (bundler benchmark) under $SITEBENCH_HOME and installs the deps of the bench/ sources in this
# checkout (express, websocket-server, postgres). Idempotent. Run setup-toolchains.sh first.
# rolldown/benchmarks pins older rolldown/rspack/rsbuild than npm `latest`; the versions below are what the published
# numbers used (npm `latest` on 2026-08-14). Override any of them via the environment.
set -euo pipefail
SITE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd); BENCH_DIR=$(cd "$SITE_DIR/.." && pwd)
S=${SITEBENCH_HOME:-$HOME/sitebench}; T=$S/toolchains
ROLLDOWN_BENCH_REV=${ROLLDOWN_BENCH_REV:-257a585028663a339641e72e0c2d9ea6a0aa2752}
ROLLDOWN_VER=${ROLLDOWN_VER:-1.2.4} RSPACK_VER=${RSPACK_VER:-2.1.10} RSBUILD_VER=${RSBUILD_VER:-2.1.13}
export PATH=$T/npm-global/bin:$T/node/bin:$PATH
mkdir -p "$S"; cd "$S"
[ -d benchmarks ] || git clone --depth 1 https://github.com/rolldown/benchmarks.git
(cd benchmarks && git fetch -q --depth 1 origin "$ROLLDOWN_BENCH_REV" && git checkout -q -f FETCH_HEAD && git log -1 --format="rolldown/benchmarks at %h %ci")
echo "--- rolldown/benchmarks pins: rolldown=$ROLLDOWN_VER rspack=$RSPACK_VER rsbuild=$RSBUILD_VER"
(cd benchmarks && node -e '
const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json", "utf8")); const [rd, rs, rb] = process.argv.slice(1);
p.devDependencies.rolldown = rd; p.devDependencies["@rspack/core"] = rs; p.devDependencies["@rspack/cli"] = rs; p.devDependencies["@rsbuild/core"] = rb;
fs.writeFileSync("package.json", JSON.stringify(p, null, "\t") + "\n");' "$ROLLDOWN_VER" "$RSPACK_VER" "$RSBUILD_VER")
echo "--- rolldown/benchmarks pnpm install"
(cd benchmarks && pnpm install --no-frozen-lockfile --config.strict-dep-builds=false 2>&1 | tail -3; git checkout -q -- pnpm-workspace.yaml 2>/dev/null || true)
# a stale bun.lock keeps node-gyp-build < 4.8, which does not find bufferutil 4.1's prebuild and silently falls back to JS
(cd "$BENCH_DIR/websocket-server" && rm -rf node_modules bun.lock)
for d in express websocket-server postgres; do
  echo "--- bench/$d"; (cd "$BENCH_DIR/$d" && "$T/bun-release/bun" install 2>&1 | tail -2)
done
echo "--- deno warms (express + postgres)"
(cd "$BENCH_DIR/express" && "$T/deno/deno" install --allow-scripts >/dev/null 2>&1 || true)
(cd "$BENCH_DIR/postgres" && "$T/deno/deno" install --allow-scripts >/dev/null 2>&1 || true)
echo "--- resolved versions"
(cd benchmarks && node -e 'for (const p of ["rolldown","@rspack/core","@rspack/cli","@rsbuild/core","esbuild","rollup","vite"]) console.log("  " + p, require(p + "/package.json").version)')
(cd "$BENCH_DIR/websocket-server" && node -e 'for (const p of ["ws","bufferutil","utf-8-validate"]) console.log("  " + p, require(p + "/package.json").version); console.log("  bufferutil native:", require("node-gyp-build").path(process.cwd() + "/node_modules/bufferutil"))')
echo REPOS_DONE
