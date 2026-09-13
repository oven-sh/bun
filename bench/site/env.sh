# Sourced by every script in bench/site. Bench sources come from this checkout; toolchains, caches, results and
# scratch state live under $SITEBENCH_HOME (default ~/sitebench). The Bun under test is $BUN.
SITE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
BENCH_DIR=$(cd "$SITE_DIR/.." && pwd)
S=${SITEBENCH_HOME:-$HOME/sitebench}; T=$S/toolchains
NODE=${NODE:-$T/node/bin/node}
DENO=${DENO:-$T/deno/deno}
PNPM=${PNPM:-$T/npm-global/bin/pnpm}
YARN=${YARN:-$T/npm-global/bin/yarn}
NPM=${NPM:-$T/npm-global/bin/npm}
BUN_RELEASE=${BUN_RELEASE:-$T/bun-release/bun}
BUN=${BUN:?set BUN=/abs/path/to/bun (the Bun binary under test)}
[ -x "$BUN" ] || { echo "BUN=$BUN is not executable" >&2; exit 2; }
GNU_TIME=${GNU_TIME:-/usr/bin/time}
export PATH=$T/npm-global/bin:$T/node/bin:$PATH
export NO_COLOR=1
BUN_LABEL="bun-$($BUN --version)+$($BUN --revision | sed 's/.*+//')"
BUN_RELEASE_LABEL="bun-$($BUN_RELEASE --version)"
NODE_LABEL="node-$($NODE --version | tr -d v)"
DENO_LABEL="deno-$($DENO --version | head -1 | awk '{print $2}')"
OUT=${OUT:-$S/results/latest}; mkdir -p "$OUT"
TMP=$S/tmp; rm -rf "$TMP"; mkdir -p "$TMP"
RUNS=${RUNS:-3}
cpu_ticks() { awk '{print $14+$15}' /proc/$1/stat 2>/dev/null || echo 0; }
peak_rss_mb() { echo $(( $(awk '/VmHWM/{print $2}' /proc/$1/status 2>/dev/null || echo 0) / 1024 )); }
