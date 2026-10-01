#!/bin/sh
# Rebuilds what a fresh machine lacks: reference clones, valgrind, helper commands, fixed bench inputs.
# Needs /workspace/bun (the repository) and /workspace/notes (worktree of the notes branch). Safe to run again.
set -e
mkdir -p /workspace/ref /workspace/tools/dl /workspace/wt
if [ ! -d /workspace/ref/typescript-go/.git ]; then
  git clone --quiet --depth 1 --recurse-submodules --shallow-submodules https://github.com/microsoft/typescript-go /workspace/ref/typescript-go
fi
if [ ! -x /workspace/tools/valgrind/bin/valgrind ]; then
  D=8be2699653b4e3be2c2cb9fc407807eb38c334f8d0f81dc94d1e9edb03dc54d2
  curl -s -L -m 300 -H "Authorization: Bearer QQ==" -o /workspace/tools/dl/valgrind.tar.gz https://ghcr.io/v2/homebrew/core/valgrind/blobs/sha256:$D
  echo "$D  /workspace/tools/dl/valgrind.tar.gz" | sha256sum -c -
  mkdir -p /workspace/tools/valgrind && tar -xzf /workspace/tools/dl/valgrind.tar.gz -C /workspace/tools/valgrind --strip-components=2
fi
cp /workspace/notes/lint/tools/bin/* /workspace/tools/
chmod +x /workspace/tools/vg /workspace/tools/lk /workspace/tools/save-notes /workspace/tools/autopush /workspace/tools/memwatch
R=/workspace/notes/lint/benchroot
if [ ! -f "$R/bench/snippets/transpiler-typescript.mjs" ]; then
  mkdir -p "$R/node_modules/typescript/lib"
  (cd /workspace/bun && git archive 36cd1514ec packages/bun-types src/js bench/react-hello-world/react-hello-world.node.js bench/runner.mjs | tar -x -C "$R")
  mkdir -p "$R/bench/snippets"
  (cd /workspace/bun && git show origin/robobun/abbc0c92/bun-lint:bench/snippets/transpiler-typescript.mjs > "$R/bench/snippets/transpiler-typescript.mjs" && git show origin/robobun/abbc0c92/bun-lint:bench/snippets/transpiler-typescript-fixture.tsx > "$R/bench/snippets/transpiler-typescript-fixture.tsx")
  cp /workspace/bun/node_modules/typescript/lib/lib*.d.ts "$R/node_modules/typescript/lib/"
  cp /workspace/bun/node_modules/typescript/package.json "$R/node_modules/typescript/"
fi
echo "bootstrap done"
