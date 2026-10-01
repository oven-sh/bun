#!/bin/bash
# Installs every runtime/tool the site benchmarks need under $SITEBENCH_HOME/toolchains (Linux x64, no system changes).
# The versions below are the ones the published numbers were produced with; override any of them via the environment.
set -euo pipefail
S=${SITEBENCH_HOME:-$HOME/sitebench}; T=$S/toolchains; mkdir -p "$T"; cd "$T"
NODE_VER=${NODE_VER:-v26.7.0}
DENO_VER=${DENO_VER:-v2.9.5}
BUN_REL=${BUN_REL:-1.3.14}
PNPM_VER=${PNPM_VER:-11.21.0}
YARN_VER=${YARN_VER:-1.22.22}
NPM_VER=${NPM_VER:-12.0.2}
echo "node=$NODE_VER deno=$DENO_VER bun-release=$BUN_REL pnpm=$PNPM_VER yarn=$YARN_VER npm=$NPM_VER"
if [ ! -x "$T/node/bin/node" ] || [ "$("$T/node/bin/node" --version)" != "$NODE_VER" ]; then
  rm -rf "$T/node"; curl -fsSL "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-x64.tar.xz" | tar xJ && mv "node-$NODE_VER-linux-x64" node
fi
export PATH=$T/node/bin:$PATH
mkdir -p "$T/npm-global"
npm_config_prefix=$T/npm-global npm install -g "pnpm@$PNPM_VER" "yarn@$YARN_VER" "npm@$NPM_VER" >/dev/null 2>&1
if [ ! -x "$T/deno/deno" ] || ! "$T/deno/deno" --version | head -1 | grep -q "${DENO_VER#v}"; then
  rm -rf "$T/deno"; mkdir -p "$T/deno"; curl -fsSL -o "$T/deno.zip" "https://dl.deno.land/release/$DENO_VER/deno-x86_64-unknown-linux-gnu.zip" && unzip -oq "$T/deno.zip" -d "$T/deno" && rm -f "$T/deno.zip"
fi
if [ ! -x "$T/bun-release/bun" ] || [ "$("$T/bun-release/bun" --version)" != "$BUN_REL" ]; then
  rm -rf "$T/bun-release" "$T/bunrel"; mkdir -p "$T/bun-release"
  curl -fsSL -o "$T/bunrel.zip" "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_REL/bun-linux-x64.zip" && unzip -oq "$T/bunrel.zip" -d "$T/bunrel" && mv "$T/bunrel/bun-linux-x64/bun" "$T/bun-release/bun" && rm -rf "$T/bunrel" "$T/bunrel.zip"
fi
# the Bun under test is whatever $BUN points at; the current canary is downloaded as a convenient default
if [ "${SKIP_CANARY:-}" != 1 ]; then
  rm -rf "$T/bun-canary" "$T/buncan"; mkdir -p "$T/bun-canary"
  curl -fsSL -o "$T/buncan.zip" https://github.com/oven-sh/bun/releases/download/canary/bun-linux-x64.zip && unzip -oq "$T/buncan.zip" -d "$T/buncan" && mv "$T/buncan/bun-linux-x64/bun" "$T/bun-canary/bun" && rm -rf "$T/buncan" "$T/buncan.zip"
fi
for tool in bombardier hyperfine pg_ctl; do command -v $tool >/dev/null || echo "warning: $tool not found on PATH (install it before running the $tool-based benchmarks)"; done
echo TOOLCHAINS_DONE
