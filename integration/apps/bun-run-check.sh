#!/bin/bash

killall -9 $(basename $BUN_BIN) || echo "";

# https://github.com/Jarred-Sumner/bun/issues/40
# Define a function (details aren't important)
fn() { :; }
# The important bit: export the function
export -f fn


rm -rf /tmp/bun-run-check
mkdir -p /tmp/bun-run-check


cp ./bun-run-check-package.json /tmp/bun-run-check/package.json
cd /tmp/bun-run-check

$BUN_BIN run bash -- -c ""

if (( $? )); then
    echo "Bash exported functions are broken"
    exit 1
fi

$BUN_BIN run --silent this-should-work

exit $?



