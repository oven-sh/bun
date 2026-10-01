#!/bin/sh
# usage: check.sh [lib|test|clippy|fmt]
set -e
cd /tmp/leafport
W="-D warnings -D unreachable_pub -D dead_code -D unused_imports -D unused_variables -D unused_mut -D unused_assignments -D unused_macros -D unreachable_code -D unreachable_patterns"
case "${1:-lib}" in
  lib) rustc --edition 2024 --crate-type lib --crate-name leaf --emit=metadata -o out/libleaf.rmeta $W lib.rs ;;
  test) rustc --edition 2024 --test --crate-name leaf -C opt-level=1 -o out/leaf_tests $W lib.rs && shift && ./out/leaf_tests "$@" ;;
  clippy) CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --crate-type lib --crate-name leaf --emit=metadata -o out/libleaf_clippy.rmeta lib.rs -D warnings -W clippy::all $(cat /workspace/notes/lint/units/typecheck/conventions-scratch/data/clippy_flags.txt) ;;
  clippytest) CLIPPY_CONF_DIR=/workspace/wt/typecheck clippy-driver --edition 2024 --test --crate-name leaf --emit=metadata -o out/libleaf_clippy_t.rmeta lib.rs -D warnings -W clippy::all $(cat /workspace/notes/lint/units/typecheck/conventions-scratch/data/clippy_flags.txt) ;;
  fmt) shift; rustfmt --edition 2024 --check "$@" ;;
esac
