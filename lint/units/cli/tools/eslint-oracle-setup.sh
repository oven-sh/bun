#!/bin/sh
# Makes the oracle of the lint rules runnable under /workspace/ref: ESLint at the pin of src/lint/UPSTREAM_PORTED with
# its runtime dependencies (/workspace/ref/eslint), the parser and the plugin of typescript-eslint beside it
# (/workspace/ref/tseslint, which resolves `eslint` to the pin), and the sources of regexpp (/workspace/ref/regexpp).
# Safe to run again. One run at a time: a second caller waits for the first and then finds the work done.
# usage: sh /workspace/notes/lint/units/cli/tools/eslint-oracle-setup.sh
set -e
PIN=4618052eed6bb3ef420cf0db0490bbda2fd835a5
TSESLINT=8.58.2
TYPESCRIPT=6.0.3
R=/workspace/ref
mkdir -p "$R"
exec 9>"$R/.eslint-oracle.lock"
flock 9
if [ ! -d "$R/eslint/.git" ]; then
  git init -q "$R/eslint"
  git -C "$R/eslint" remote add origin https://github.com/eslint/eslint
  git -C "$R/eslint" fetch -q --depth 1 origin "$PIN"
  git -C "$R/eslint" checkout -q FETCH_HEAD
fi
[ "$(git -C "$R/eslint" rev-parse HEAD)" = "$PIN" ] || { echo "$R/eslint is not at $PIN" >&2; exit 1; }
if [ ! -f "$R/eslint/node_modules/.oracle-ready" ]; then
  (cd "$R/eslint" && npm install --omit=dev --ignore-scripts --no-audit --no-fund)
  touch "$R/eslint/node_modules/.oracle-ready"
fi
# typescript-eslint names `eslint` as a peer: it is kept out of the checkout of the pin and given the pin by a link.
if [ ! -f "$R/tseslint/node_modules/.oracle-ready" ]; then
  mkdir -p "$R/tseslint"
  printf '{ "name": "tseslint-oracle", "private": true }\n' > "$R/tseslint/package.json"
  (cd "$R/tseslint" && npm install --legacy-peer-deps --ignore-scripts --no-audit --no-fund \
    "@typescript-eslint/parser@$TSESLINT" "@typescript-eslint/eslint-plugin@$TSESLINT" "typescript@$TYPESCRIPT")
  ln -sfn "$R/eslint" "$R/tseslint/node_modules/eslint"
  touch "$R/tseslint/node_modules/.oracle-ready"
fi
V=$(cd "$R/eslint" && node -p 'require("@eslint-community/regexpp/package.json").version')
if [ ! -d "$R/regexpp/.git" ]; then
  git clone -q --depth 1 --branch "v$V" https://github.com/eslint-community/regexpp "$R/regexpp"
fi
{
  echo "eslint $(cd "$R/eslint" && node -p 'require("./package.json").version') at $PIN"
  for n in espree acorn eslint-scope eslint-visitor-keys @eslint-community/regexpp @eslint-community/eslint-utils; do
    echo "$n $(cd "$R/eslint" && node -p "require('$n/package.json').version")"
  done
  for n in @typescript-eslint/parser @typescript-eslint/eslint-plugin @typescript-eslint/scope-manager typescript; do
    echo "$n $(cd "$R/tseslint" && node -p "require('$n/package.json').version")"
  done
  echo "regexpp sources at $(git -C "$R/regexpp" rev-parse HEAD)"
} | tee "$R/eslint-oracle-versions.txt"
