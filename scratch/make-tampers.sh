#!/bin/zsh
# Generate 3 tampered variants per ported test; each must FAIL (non-zero exit).
set -eu
cd /Users/ciro/code/bun/.claude/worktrees/wave-insp
P=test/js/node/test/parallel
T=scratch/tampered
mkdir -p $T

# test-cwd-enoent.js
sed 's/assert.strictEqual(exitCode, 0)/assert.strictEqual(exitCode, 1)/' $P/test-cwd-enoent.js > $T/test-cwd-enoent.t1.js
sed "s/assert.strictEqual(signalCode, null)/assert.strictEqual(signalCode, 'SIGKILL')/" $P/test-cwd-enoent.js > $T/test-cwd-enoent.t2.js
sed 's/common.mustCall(function(exitCode, signalCode) {/common.mustCall(function(exitCode, signalCode) { assert.fail("tamper");/' $P/test-cwd-enoent.js > $T/test-cwd-enoent.t3.js

# test-cwd-enoent-preload.js
sed 's/assert.strictEqual(exitCode, 0)/assert.strictEqual(exitCode, 7)/' $P/test-cwd-enoent-preload.js > $T/test-cwd-enoent-preload.t1.js
sed "s/assert.strictEqual(signalCode, null)/assert.strictEqual(signalCode, 'SIGTERM')/" $P/test-cwd-enoent-preload.js > $T/test-cwd-enoent-preload.t2.js
sed 's/common.mustCall(function(exitCode, signalCode) {/common.mustCall(function(exitCode, signalCode) { assert.fail("tamper");/' $P/test-cwd-enoent-preload.js > $T/test-cwd-enoent-preload.t3.js

# test-cwd-enoent-repl.js
sed 's/assert.strictEqual(exitCode, 42)/assert.strictEqual(exitCode, 41)/' $P/test-cwd-enoent-repl.js > $T/test-cwd-enoent-repl.t1.js
sed "s/assert.strictEqual(signalCode, null)/assert.strictEqual(signalCode, 'SIGKILL')/" $P/test-cwd-enoent-repl.js > $T/test-cwd-enoent-repl.t2.js
sed 's/common.mustCall(function(exitCode, signalCode) {/common.mustCall(function(exitCode, signalCode) { assert.fail("tamper");/' $P/test-cwd-enoent-repl.js > $T/test-cwd-enoent-repl.t3.js

# test-cwd-enoent-improved-message.js
sed "s/code: 'ENOENT'/code: 'EACCES'/" $P/test-cwd-enoent-improved-message.js > $T/test-cwd-enoent-improved-message.t1.js
sed 's/the current working directory was likely removed/the current working directory was DEFINITELY removed/' $P/test-cwd-enoent-improved-message.js > $T/test-cwd-enoent-improved-message.t2.js
sed 's/assert.throws(/assert.doesNotThrow(/' $P/test-cwd-enoent-improved-message.js > $T/test-cwd-enoent-improved-message.t3.js
echo "tampers written"
