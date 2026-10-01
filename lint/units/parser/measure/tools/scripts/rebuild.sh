#!/bin/bash
# Second release build of the same source: forces the bun_js_parser edge and everything after it, then compares.
cd /workspace/wt/parser || exit 9
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then echo "worktree dirty, abort"; git status --short | head; exit 3; fi
D=build/release/rust-target/x86_64-unknown-linux-gnu/deps
ls -la $D/libbun_js_parser-*.rlib $D/libbun_js_parser-*.rmeta
rm -f $D/libbun_js_parser-*.rlib $D/libbun_js_parser-*.rmeta
s=$(date +%s)
bun run build:release > /tmp/parser-base/rebuild.build.log 2>&1
rc=$?
echo "build:release rc=$rc $(( $(date +%s) - s ))s"
tail -5 /tmp/parser-base/rebuild.build.log
B=/workspace/notes/lint/units/parser/measure/base
sha256sum build/release/bun build/release/bun-profile $B/bin/bun $B/bin/bun-profile
cmp build/release/bun-profile $B/bin/bun-profile && echo "bun-profile IDENTICAL to the base copy"
cmp build/release/bun $B/bin/bun && echo "bun IDENTICAL to the base copy"
mkdir -p $B/bin2 && cp -p build/release/bun-profile $B/bin2/bun-profile && cp -p build/release/bun $B/bin2/bun
exit $rc
