#!/bin/sh
# The candidate with the kernel arm off: every entry goes through the component walk.
BUN_FEATURE_FLAG_DISABLE_OPENAT2=1 exec /tmp/arc/bun-pr-debug2 "$@"
