#!/usr/bin/env bash

echo "Test that node is added to that PATH if, and only if, it is not one already present".

if [ -n "$EMSDK" ]; then
    echo "EMSDK is already defined in this shell. Run tests in a shell without sourcing emsdk_env.sh first"
    exit 1
fi

DIR=$(dirname "$BASH_SOURCE")
cd $DIR/..

./emsdk install latest
./emsdk activate latest

if which node; then
  echo "Test should be run without node in the path"
  exit 1
fi

# Run emsdk_env.sh and confirm that node was added to the PATH
. emsdk_env.sh

if ! which node; then
  echo "node not found in path after emsdk_env.sh"
  exit 1
fi

# Run emsdk_env.sh again and confirm that node is still in the PATH
. emsdk_env.sh

if ! which node; then
  echo "node not found in path after emsdk_env.sh"
  exit 1
fi
