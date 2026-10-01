#!/bin/sh
# Makes the oracle of the lint rules runnable under /workspace/ref: ESLint at the pin of src/lint/UPSTREAM_PORTED with
# its runtime dependencies, the TypeScript parser and plugin of typescript-eslint, and the sources of regexpp.
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
cd "$R/eslint"
if [ ! -f node_modules/.oracle-ready ]; then
  npm install --omit=dev --ignore-scripts --no-audit --no-fund
  npm install --omit=dev --no-save --ignore-scripts --no-audit --no-fund \
    "@typescript-eslint/parser@$TSESLINT" "@typescript-eslint/eslint-plugin@$TSESLINT" "typescript@$TYPESCRIPT"
  touch node_modules/.oracle-ready
fi
V=$(node -p 'require("@eslint-community/regexpp/package.json").version')
if [ ! -d "$R/regexpp/.git" ]; then
  git clone -q --depth 1 --branch "v$V" https://github.com/eslint-community/regexpp "$R/regexpp"
fi
node -e '
const v = n => require(n + "/package.json").version;
const names = ["espree", "acorn", "eslint-scope", "eslint-visitor-keys", "@eslint-community/regexpp", "@eslint-community/eslint-utils", "@typescript-eslint/parser", "@typescript-eslint/eslint-plugin", "@typescript-eslint/scope-manager", "typescript"];
console.log("eslint " + require("./package.json").version + " at '"$PIN"'");
for (const n of names) console.log(n + " " + v(n));
' | tee "$R/eslint-oracle-versions.txt"
echo "regexpp sources: $R/regexpp at $(git -C "$R/regexpp" rev-parse --short HEAD)"
