#!/bin/sh
# Survey of the typecheck crate: it is green when cargo compiles every source file of the crate without an error.
# Prints a bounded report. Exit 0 only when `cargo check` passes AND no .rs file is outside the module tree.
cd /workspace/wt/typecheck || exit 2
out=/tmp/typecheck-survey.$$.log
/workspace/tools/lk cargo check -p bun_typecheck --message-format=short > "$out" 2>&1
code=$?
errors=$(grep -cE '^[^ ]+\.rs:[0-9]+:[0-9]+: error' "$out")
echo "cargo check -p bun_typecheck: exit $code, $errors errors"
if [ "$code" -ne 0 ]; then
  echo "--- errors by file (most first):"
  grep -E '^[^ ]+\.rs:[0-9]+:[0-9]+: error' "$out" | sed -E 's/^([^:]+):.*/\1/' | sort | uniq -c | sort -rn | head -60
  echo "--- errors by kind (most first):"
  grep -E '^[^ ]+\.rs:[0-9]+:[0-9]+: error' "$out" | sed -E 's/^[^ ]+ error(\[E[0-9]+\])?: //' | sed -E 's/`[^`]*`/`_`/g' | cut -c1-90 | sort | uniq -c | sort -rn | head -30
  echo "--- first 120 error lines:"
  grep -E '^[^ ]+\.rs:[0-9]+:[0-9]+: error|^error' "$out" | cut -c1-260 | head -120
  echo "(the full output is in $out)"
  exit "$code"
fi
rm -f "$out"
python3 /workspace/notes/lint/tools/undeclared.py /workspace/wt/typecheck/src/typecheck || {
  echo "The crate compiles, but cargo does not compile the files above. Declare the next layer in its parent module (see the goal for the order) and fix what the compiler then reports."
  exit 1
}
echo "every source file of bun_typecheck is compiled and cargo check passes"
