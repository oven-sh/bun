#!/bin/bash

killall -9 $(basename $BUN_BIN) || echo "";

rm -rf /tmp/react-app;
mkdir -p /tmp/react-app;
$BUN_BIN create react /tmp/react-app;
cd /tmp/react-app;
BUN_CRASH_WITHOUT_JIT=1 $BUN_BIN --port 8087 &
sleep 0.005

curl --fail http://localhost:8087/ && killall -9 $(basename $BUN_BIN) && echo "✅ bun create react passed."
exit $?

