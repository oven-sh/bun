#!/bin/sh
# Makes the oracle runnable: ESLint at the pin of src/lint/UPSTREAM_PORTED with its dependencies (/workspace/ref/eslint) and
# @typescript-eslint/parser beside it (/workspace/ref/tseslint). The versions are then in /workspace/ref/eslint-oracle-versions.txt.
exec sh /workspace/notes/lint/units/cli/tools/eslint-oracle-setup.sh
