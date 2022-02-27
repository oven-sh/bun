#!/bin/bash

set -euo pipefail

killall -9 $(basename $BUN_BIN) || echo ""

dir=$(mktemp -d --suffix=bun-ADD)

cd $dir

# https://github.com/Jarred-Sumner/bun/issues/115
echo '{ "author": "Arnuad Barré (https://github.com/ArnaudBarre)" }' >package.json

$BUN_BIN add react
