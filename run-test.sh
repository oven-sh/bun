#!/bin/bash

set -euxo pipefail

cd $GITHUB_WORKSPACE

bun install
bun install --cwd $GITHUB_WORKSPACE/integration/snippets
bun install --cwd $GITHUB_WORKSPACE/integration/scripts

make $BUN_TEST_NAME
