#!/bin/bash

set -euxo pipefail

bun install
bun install --cwd ./integration/snippets
bun install --cwd ./integration/scripts

make $BUN_TEST_NAME
