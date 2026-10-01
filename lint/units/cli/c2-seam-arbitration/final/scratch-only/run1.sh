#!/bin/sh
# Verification batch of the final C2 prototype, in the scratch workspace only.
cd /tmp/c2td/ws || exit 1
L=/tmp/c2td/logs
export CARGO_TERM_COLOR=never
( cargo check -p bun_ast -p bun_lint --all-targets --message-format=short; echo "check-exit=$?" ) > $L/01-check.log 2>&1
( cargo clippy -p bun_ast -p bun_lint --all-targets --no-deps --message-format=short; echo "clippy-exit=$?" ) > $L/02-clippy.log 2>&1
( cargo fmt -p bun_lint -- --check; echo "fmt-lint-exit=$?"; rustfmt --edition 2024 --check ast/lib.rs; echo "fmt-astlib-exit=$?" ) > $L/03-fmt.log 2>&1
( MIRIFLAGS=-Zmiri-tree-borrows cargo miri test -p bun_ast --lib msg_code_tests; echo "miri-ast-exit=$?" ) > $L/04-miri-ast.log 2>&1
( MIRIFLAGS=-Zmiri-tree-borrows cargo miri test -p bun_lint --lib -- --skip vector_tests; echo "miri-lint-exit=$?" ) > $L/05-miri-lint.log 2>&1
echo done > $L/run1.done
