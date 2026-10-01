#!/bin/sh
# Second clippy run of the final sources (without the scratch-only vector test), then the logs go to the notes.
cd /tmp/c2td/ws || exit 1
L=/tmp/c2td/logs
N=/workspace/notes/lint/units/cli/c2-seam-arbitration/final/logs
export CARGO_TERM_COLOR=never
( cargo clippy -p bun_ast -p bun_lint --all-targets --no-deps --message-format=short; echo "clippy-exit=$?" ) > $L/06-clippy.log 2>&1
( cargo check -p bun_lint --message-format=short; echo "check-lib-only-exit=$?" ) > $L/08-check-lib.log 2>&1
cp $L/06-clippy.log $L/08-check-lib.log $N/ 2>/dev/null
echo done > $L/run2.done
