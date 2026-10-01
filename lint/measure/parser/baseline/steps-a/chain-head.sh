#!/bin/sh
# head: sizes, then the Rust tests, then the twelve files plain and with the leak environment; each is one turn at the lock
P=/workspace/notes/lint/units/parser/measure/sizeprobe-a
O=/workspace/notes/lint/measure/parser/baseline/sizes-a
/tmp/parser-bb/step.sh head-sizes /workspace/wt/parser "$P/run.sh" head /workspace/wt/parser /workspace/wt/parser/build/debug/codegen "$O"
/tmp/parser-bb/step.sh cargotest /workspace/wt/parser /tmp/parser-bb/cargotest.sh
/tmp/parser-bb/step.sh tests-plain /workspace/wt/parser /tmp/parser-bb/tests.sh plain
/tmp/parser-bb/step.sh tests-leak /workspace/wt/parser /tmp/parser-bb/tests.sh leak
echo "chain-head finished $(date -u +%FT%TZ)" > /tmp/parser-bb/chain-head.done
