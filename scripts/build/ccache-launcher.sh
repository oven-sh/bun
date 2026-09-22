#!/bin/sh
# Compiler launcher for nested cmake builds: `ccache-launcher.sh <ccache> <compiler> <args...>`.
# Runs the compile through ccache, except a precompiled-header compile, which
# runs the compiler directly. See the comment where source.ts sets
# CMAKE_<LANG>_COMPILER_LAUNCHER.
ccache=$1
shift
for arg; do
  if [ "$arg" = "-emit-pch" ]; then
    exec "$@"
  fi
done
exec "$ccache" "$@"
