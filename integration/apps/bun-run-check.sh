#!/bin/bash

killall -9 $(basename $BUN_BIN) || echo "";

rm -rf /tmp/bun-run-check
mkdir -p /tmp/bun-run-check


cp ./bun-run-check-package.json /tmp/bun-run-check/package.json
cd /tmp/bun-run-check
bun run --silent this-should-work
exit $?



