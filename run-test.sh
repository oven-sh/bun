#!/bin/bash

set -euxo pipefail

cd $GITHUB_WORKSPACE/bun

bun install
bun install --cwd $GITHUB_WORKSPACE/bun/integration/snippets
bun install --cwd $GITHUB_WORKSPACE/bun/integration/scripts

make $BUN_TEST_NAME
