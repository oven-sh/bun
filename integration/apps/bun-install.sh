#!/bin/bash

set -euo pipefail

dir=$(mktemp -d --suffix=bun-install-test-1)

cd $dir
${NPM_CLIENT:-$(which bun)} add react react-dom @types/react

echo "console.log(typeof require(\"react\").createElement);" >index.js
chmod +x index.js

JS_RUNTIME=${JS_RUNTIME:-"$(which bun)"}

if [ "$JS_RUNTIME" == "node" ]; then
    result="$(node ./index.js)"
fi

if [ "$JS_RUNTIME" != "node" ]; then
    result="$($JS_RUNTIME run ./index.js)"
fi

echo "console.log(typeof require(\"react-dom\").render);" >index.js
chmod +x index.js

JS_RUNTIME=${JS_RUNTIME:-"$(which bun)"}

if [ "$JS_RUNTIME" == "node" ]; then
    result="$(node ./index.js)"
fi

if [ "$JS_RUNTIME" != "node" ]; then
    result="$($JS_RUNTIME run ./index.js)"
fi

if [ "$result" != "function" ]; then
    echo "ERR: Expected 'function', got '$result'"
    exit 1
fi

${NPM_CLIENT:-$(which bun)} remove react-dom

if [ -d "node_modules/react-dom" ]; then
    echo "ERR: react-dom module still exists in $dir"
    exit 1
fi

yarn_dot_lock=$(${NPM_CLIENT:-$(which bun)} bun.lockb)

if echo "$yarn_dot_lock" | grep -q "react-dom"; then
    echo "ERR: react-dom module still exists in lockfile"
    exit 1
fi

${NPM_CLIENT:-$(which bun)} remove @types/react

yarn_dot_lock=$(${NPM_CLIENT:-$(which bun)} bun.lockb)

if echo "$yarn_dot_lock" | grep -q "@types/react"; then
    echo "ERR: @types/react module still exists in lockfile"
    exit 1
fi

if echo "$yarn_dot_lock" | grep -q "@types/react"; then
    echo "ERR: @types/react module still exists in $dir"
    exit 1
fi

${NPM_CLIENT:-$(which bun)} remove react

if [ -d "node_modules/react" ]; then
    echo "ERR: react module still exists in $dir"
    exit 1
fi

if [ -d "bun.lockb" ]; then
    echo "ERR: empty bun.lockb should be deleted"
    exit 1
fi
