#!/bin/bash

killall -9 $(basename $BUN_BIN) || echo "";

rm -rf /tmp/next-app;
mkdir -p /tmp/next-app;
$BUN_BIN create next /tmp/next-app;
cd /tmp/next-app;
$BUN_BIN --port 8087 &
sleep 0.005

curl --fail http://localhost:8087/ && killall -9 $(basename $BUN_BIN) && echo "✅ bun create next passed."
exit $?

