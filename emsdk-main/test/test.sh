#!/usr/bin/env bash

echo "test the standard workflow (as close as possible to how a user would do it, in the shell)"
echo "machine: $(uname -m)"
echo "kernel: $(uname -s)"

set -x
set -e

# Test that arbitrary (non-released) versions can be installed and
# activated.
# This test cannot run on linux-arm64 because only certain binaries
# get uploaded for this architecture.
if [[ !($(uname -s) == "Linux" && $(uname -m) == "aarch64") ]]; then
  ./emsdk install sdk-upstream-1b7f7bc6002a3ca73647f41fc10e1fac7f06f804
  ./emsdk activate sdk-upstream-1b7f7bc6002a3ca73647f41fc10e1fac7f06f804
  source ./emsdk_env.sh
  which emcc
  emcc -v
fi

# Install an older version of the SDK that requires EM_CACHE to be
# set in the environment, so that we can test it is later removed
# This test only runs on x64 because we didn't build arm binaries
# when this older version of the SDK was built.
if [[ $(uname -m) == "x86_64" ]]; then
  ./emsdk install sdk-1.39.15
  ./emsdk activate sdk-1.39.15
  source ./emsdk_env.sh
  which emcc
  emcc -v
  test -n "$EM_CACHE"
fi

# Install the latest version of the SDK which is the expected precondition
# of test.py.
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh --build=Release
# Test that EM_CACHE was unset
test -z "$EM_CACHE"

# On mac and windows python3 should be in the path and point to the
# bundled version.
which python3
which emcc
emcc -v
