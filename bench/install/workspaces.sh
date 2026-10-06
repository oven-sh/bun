#!/bin/bash
# Peak RSS, CPU time and minor page faults of `bun install` in a repo of N workspaces with no registry dependency.
#   BUN=/abs/path/to/bun [KINDS="two-key full escaped"] [SIZES="0 100 1000 3000"] [RUNS=5] \
#     bench/install/workspaces.sh [/abs/path/to/another/bun ...]
# Manifest kinds, one package.json for each workspace under packages/:
#   two-key : name and version
#   full    : about 975 bytes: 5 scripts, 3 dependencies and 2 devDependencies on sibling workspaces, 9 more fields
#   escaped : 19 scripts of 19 lengths, each with an escaped quote
# Flows: `install` from a clean tree, and `update -r` over the lockfile and node_modules of an install by that binary.
# Linux only: GNU time reports the peak RSS (KB), the minor faults and the user+system CPU (ms) of the one process.
# Each row is the median of RUNS runs. The runs of the binaries are interleaved.
set -u
BUN=${BUN:?set BUN=/abs/path/to/bun (the Bun binary under test)}
GNU_TIME=${GNU_TIME:-/usr/bin/time}
KINDS=${KINDS:-two-key full escaped}
SIZES=${SIZES:-0 100 1000 3000}
RUNS=${RUNS:-5}
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
export BUN_INSTALL_CACHE_DIR=$WORK/cache NO_COLOR=1

read -r -d '' GENERATE <<'EOF'
const { mkdirSync, writeFileSync } = require("node:fs");
const [dir, count, kind] = process.argv.slice(1);
const n = Number(count);
mkdirSync(dir + "/packages", { recursive: true });
writeFileSync(dir + "/package.json", JSON.stringify({ name: "root", version: "1.0.0", private: true, workspaces: ["packages/*"] }, null, 2));
const escaped = {};
for (let length = 8; length <= 1024; length += Math.max(8, length >> 2)) escaped["s" + length] = '"' + "x".repeat(length - 2) + '"';
for (let i = 0; i < n; i++) {
  const sibling = k => "p" + ((i + k) % n);
  const manifest = { name: "p" + i, version: "1.0.0" };
  if (kind === "escaped") manifest.scripts = escaped;
  if (kind === "full")
    Object.assign(manifest, {
      description: "workspace package number " + i + " used to measure the memory cost of one cached manifest",
      main: "./dist/index.js",
      module: "./dist/index.mjs",
      types: "./dist/index.d.ts",
      license: "MIT",
      scripts: {
        build: "tsc -p tsconfig.json && node ./scripts/postbuild.js",
        test: "bun test --coverage",
        lint: "eslint . --ext .ts,.tsx --max-warnings 0",
        clean: "rm -rf dist .turbo node_modules/.cache",
        typecheck: "tsc --noEmit -p tsconfig.json",
      },
      dependencies: { [sibling(1)]: "workspace:*", [sibling(2)]: "workspace:*", [sibling(3)]: "workspace:*" },
      devDependencies: { [sibling(4)]: "workspace:*", [sibling(5)]: "workspace:*" },
      files: ["dist", "README.md", "LICENSE"],
      repository: { type: "git", url: "https://example.invalid/monorepo.git", directory: "packages/p" + i },
      publishConfig: { access: "public" },
      sideEffects: false,
    });
  mkdirSync(dir + "/packages/p" + i);
  writeFileSync(dir + "/packages/p" + i + "/package.json", JSON.stringify(manifest, null, 2) + "\n");
}
EOF

median() { sort -n | sed -n "$(( (RUNS + 1) / 2 ))p"; }
# measure <binary> <dir> <flow>: one run, prints "rss_kb minflt cpu_ms rc"
measure() {
  (cd "$2" && $GNU_TIME -f "%M %R %U %S" -o "$WORK/time.txt" "$1" $3 > "$WORK/out.log" 2>&1); local rc=$?
  echo "$(awk 'END { printf "%d %d %d", $1, $2, ($3 + $4) * 1000 }' "$WORK/time.txt") $rc"
}

echo "host: $(uname -sm) kernel=$(uname -r) cpu=\"$(lscpu 2>/dev/null | sed -n 's/Model name: *//p')\" runs=$RUNS"
BINARIES=("$BUN" "$@"); LABELS=()
for binary in "${BINARIES[@]}"; do
  LABELS+=("$(basename "$(dirname "$binary")")/bun-$("$binary" --version)+$("$binary" --revision | sed 's/.*+//')")
done
for kind in $KINDS; do
  for n in $SIZES; do
    dir=$WORK/$kind-$n
    "$BUN" -e "$GENERATE" "$dir" "$n" "$kind" || exit 1
    for flow in install "update -r"; do
      # `update -r` needs a lockfile, and an install of no workspace writes none.
      [ "$flow" != install ] && [ "$n" = 0 ] && continue
      for i in "${!BINARIES[@]}"; do : > "$WORK/rows.$i"; done
      for run in $(seq 1 "$RUNS"); do
        for i in "${!BINARIES[@]}"; do
          rm -rf "$dir/node_modules" "$dir/bun.lock"
          # `update -r` starts from the lockfile and node_modules of an install by the same binary.
          if [ "$flow" != install ] && ! (cd "$dir" && "${BINARIES[$i]}" install > "$WORK/out.log" 2>&1); then
            echo "${LABELS[$i]}: the install before \`update -r\` failed in $kind n=$n" >&2
            tail -3 "$WORK/out.log" >&2
            exit 1
          fi
          measure "${BINARIES[$i]}" "$dir" "$flow" >> "$WORK/rows.$i"
        done
      done
      for i in "${!BINARIES[@]}"; do
        printf "%-40s %-8s n=%-5s %-10s peak_rss_kb=%-7s minflt=%-6s cpu_ms=%-5s rc=%s\n" "${LABELS[$i]}" "$kind" "$n" \
          "$flow" "$(cut -d' ' -f1 "$WORK/rows.$i" | median)" "$(cut -d' ' -f2 "$WORK/rows.$i" | median)" \
          "$(cut -d' ' -f3 "$WORK/rows.$i" | median)" "$(cut -d' ' -f4 "$WORK/rows.$i" | sort -u | tr '\n' ' ')"
      done
    done
  done
done
