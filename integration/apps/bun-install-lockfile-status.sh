#!/bin/bash

set -euo pipefail

killall -9 $(basename $BUN_BIN) || echo ""

dir=$(mktemp -d --suffix=bun-lockfile)

cd $dir

$BUN_BIN add react

echo "node_modules" >.gitignore

git init && git add . && git commit -am "Initial commit"

$BUN_BIN install

ORIG_LOCKFILE=$($BUN_BIN bun.lockb)

[[ -z $(git status --untracked-files=no --porcelain) ]] || {
    echo "ERR: Expected empty git status, got '$(git status --untracked-files=no --porcelain)'"
    exit 1
}

$BUN_BIN add react

NEW_LOCKFILE=$($BUN_BIN bun.lockb)

diff <(echo "$ORIG_LOCKFILE") <(echo "$NEW_LOCKFILE") || {
    echo "ERR: Expected lockfile to be unchanged, got '$NEW_LOCKFILE'"
    exit 1
}

[[ -z $(git status --untracked-files=no --porcelain) ]] || {
    echo "ERR: Expected empty git status, got '$(git status --untracked-files=no --porcelain)'"
    exit 1
}

$BUN_BIN remove react
$BUN_BIN add react

NEW_LOCKFILE=$($BUN_BIN bun.lockb)

diff <(echo "$ORIG_LOCKFILE") <(echo "$NEW_LOCKFILE") || {
    echo "ERR: Expected lockfile to be unchanged, got '$NEW_LOCKFILE'"
    exit 1
}

echo '{ "dependencies": { "react": "17.0.2", "react-dom": "17.0.2" } }' >package.json

$BUN_BIN install

echo "var {version} = JSON.parse(require(\"fs\").readFileSync('./node_modules/react-dom/package.json', 'utf8')); if (version !== '17.0.2') {throw new Error('Unexpected react-dom version');}; " >index.js
$BUN_BIN run ./index.js

echo "var {version} = JSON.parse(require(\"fs\").readFileSync('./node_modules/react/package.json', 'utf8')); if (version !== '17.0.2') {throw new Error('Unexpected react version');}; " >index.js
$BUN_BIN run ./index.js

realpath -e node_modules/react-dom
realpath -e node_modules/react
