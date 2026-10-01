#!/bin/bash
# Does `cargo clippy -p bun_ast --no-deps` lint bun_ast after bun_ast was built as a dependency of a clippy run?
T=/tmp/parser-base/tgt-clippy
echo "== 1: clippy -p bun_js_parser --no-deps (fresh target dir)"
cargo clippy -p bun_js_parser --no-deps --message-format=short --target-dir $T 2>&1 | grep -E "bun_ast|bun_js_parser|Finished|warning|error" | head -20
echo "== 2: clippy -p bun_ast --no-deps (same target dir)"
cargo clippy -p bun_ast --no-deps --message-format=short --target-dir $T 2>&1 | grep -E "bun_ast|bun_js_parser|Finished|warning|error" | head -20
echo "== 3: clippy -p bun_ast -p bun_js_parser --no-deps (same target dir)"
cargo clippy -p bun_ast -p bun_js_parser --no-deps --message-format=short --target-dir $T 2>&1 | grep -E "bun_ast|bun_js_parser|Finished|warning|error" | head -20
