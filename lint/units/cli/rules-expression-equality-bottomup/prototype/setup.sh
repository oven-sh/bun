#!/bin/sh
# Makes ./eslint-pin: the lib of ESLint at the pin of /workspace/ref/eslint, with its dependencies from npm.
set -e
cd "$(dirname "$0")"
rm -rf eslint-pin
mkdir eslint-pin
cp -r /workspace/ref/eslint/lib /workspace/ref/eslint/conf /workspace/ref/eslint/messages /workspace/ref/eslint/package.json eslint-pin/
cd eslint-pin
npm install --omit=dev --ignore-scripts --no-audit --no-fund
