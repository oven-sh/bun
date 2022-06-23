#!/bin/bash

set -euxo pipefail

bun install
bun install --cwd ./test/snippets
bun install --cwd ./test/scripts

make $BUN_TEST_NAME
