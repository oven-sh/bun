#!/usr/bin/env bash
# usage: run.sh <test file> [node args]
# Runs a bun:test file on node: bun strips the types (no bundling), node:test runs the result.
set -e
f=$1; shift
out=/tmp/h2repro/nodeshim/out
mkdir -p "$out"
js="$out/$(basename "${f%.ts}").mjs"
bun build --no-bundle --target=node "$f" --outfile="$js" > /dev/null
exec node --import /tmp/h2repro/nodeshim/hooks.mjs --test-reporter=spec "$@" "$js"
