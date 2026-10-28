#!/bin/bash
# `install` on bench/install (create-t3-app Next.js app: 25 direct deps, ~220 resolved packages) for bun (default linker),
# bun --linker=isolated, bun-release, pnpm, yarn 1, npm. Six scenarios x RUNS runs each; every PM uses a private cache/store
# under $SITEBENCH_HOME/caches so "cold" only wipes our own cache. Wall time in ms around the process; peak RSS via GNU time.
#   clean     : no cache, no lockfile, no node_modules
#   cache     : warm cache, no lockfile, no node_modules
#   ci-cold   : lockfile only (cold cache, no node_modules)
#   ci-cache  : lockfile + warm cache, no node_modules
#   nm-lock   : lockfile + node_modules, cold cache
#   uptodate  : everything present (no-op install)
source "$(dirname "${BASH_SOURCE[0]}")/../env.sh"
B=$S/install; C=$S/caches; mkdir -p "$B" "$C"
export BUN_INSTALL_CACHE_DIR=$C/bun npm_config_cache=$C/npm YARN_CACHE_FOLDER=$C/yarn
PMS=${PMS:-bun bun-isolated bun-release pnpm yarn npm}
lock() { case $1 in bun*) echo bun.lock;; yarn) echo yarn.lock;; pnpm) echo pnpm-lock.yaml;; npm) echo package-lock.json;; esac; }
cmd() { case $1 in
  bun)          echo "$BUN install";;
  bun-isolated) echo "$BUN install --linker=isolated";;
  bun-release)  echo "$BUN_RELEASE install";;
  pnpm)         echo "$PNPM install --prefer-offline --config.strict-dep-builds=false --store-dir $C/pnpm-store --cache-dir $C/pnpm-cache";;
  yarn)         echo "$YARN install --prefer-offline --non-interactive";;
  npm)          echo "$NPM install --prefer-offline --no-audit --no-fund";;
esac; }
label() { case $1 in bun) echo "$BUN_LABEL";; bun-isolated) echo "$BUN_LABEL --linker=isolated";; bun-release) echo "$BUN_RELEASE_LABEL";; pnpm) echo "pnpm-$($PNPM --version)";; yarn) echo "yarn-$($YARN --version)";; npm) echo "npm-$($NPM --version)";; esac; }
clr_cache() { case $1 in bun*) rm -rf "$C/bun";; yarn) rm -rf "$C/yarn";; pnpm) rm -rf "$C/pnpm-store" "$C/pnpm-cache";; npm) rm -rf "$C/npm";; esac; }
RES=$OUT/install.txt; : > "$RES"
for pm in $PMS; do
  D=$B/$pm; rm -rf "$D"; mkdir -p "$D"; cp "$BENCH_DIR/install/package.json" "$D/"
  case $pm in bun*) cp "$BENCH_DIR/install/bun.lock" "$D/";; esac
  cd "$D"
  # baseline: one real install to warm the cache and produce this PM's lockfile + node_modules
  t0=$(date +%s%N); $(cmd $pm) > "$TMP/inst.log" 2>&1; rc=$?; t1=$(date +%s%N)
  echo "$pm baseline-install rc=$rc $(( (t1-t0)/1000000 ))ms $(tail -1 "$TMP/inst.log" | sed 's/\x1b\[[0-9;?]*[a-zA-Z]//g')"
  [ $rc = 0 ] || { echo "$pm BASELINE_FAILED" | tee -a "$RES"; tail -5 "$TMP/inst.log"; continue; }
  L=$(lock $pm); cp $L .lock_keep; rm -rf .nm_keep; cp -al node_modules .nm_keep
  # run <scenario> <cache 0/1> <lockfile 0/1> <node_modules 0/1>
  run() { local scen=$1 c=$2 l=$3 nm=$4
    for r in $(seq 1 $RUNS); do
      if [ $nm = 1 ]; then [ -d node_modules ] || cp -al .nm_keep node_modules; else rm -rf node_modules; fi
      if [ $l = 1 ]; then cp .lock_keep $L; else rm -f $L; fi
      [ $c = 0 ] && clr_cache $pm
      sync; sleep 1
      local t0=$(date +%s%N)
      $GNU_TIME -f "%M" -o "$TMP/inst-rss.txt" $(cmd $pm) > "$TMP/inst.log" 2>&1; local rc=$?
      local t1=$(date +%s%N)
      printf "%-40s %-9s r%s  %7d ms   peak_rss=%4d MB   rc=%s\n" "$(label $pm)" "$scen" "$r" "$(( (t1-t0)/1000000 ))" "$(( $(tail -1 "$TMP/inst-rss.txt") / 1024 ))" "$rc" | tee -a "$RES"
      [ $rc = 0 ] || tail -3 "$TMP/inst.log"
    done
    cp .lock_keep $L
  }
  run clean    0 0 0
  run cache    1 0 0
  run ci-cold  0 1 0
  run ci-cache 1 1 0
  run nm-lock  0 1 1
  run uptodate 1 1 1
done
echo INSTALL_DONE | tee -a "$RES"
