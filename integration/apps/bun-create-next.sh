#!/bin/bash

# The important part of this test: make sure that Bun.js successfully loads
# The most likely reason for this test to fail is that something broke in the JavaScriptCore <> Bun integration
killall -9 $(basename $BUN_BIN) || echo "";

rm -rf /tmp/next-app;
mkdir -p /tmp/next-app;
$BUN_BIN create next /tmp/next-app;
cd /tmp/next-app;
BUN_CRASH_WITHOUT_JIT=1 $BUN_BIN --port 8087 &
sleep 0.005

curl --fail http://localhost:8087/ && killall -9 $(basename $BUN_BIN) && echo "✅ bun create next passed."
exit $?

