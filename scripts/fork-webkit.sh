#!/usr/bin/env bash
# this script is the magic script to configure your devenv for making a patch to WebKit
# once you are done with the patch you can run this again with --undo
# you can also run this with --danger-reset to force reset the submodule (danger)
set -exo pipefail

cd "$(dirname "$0")/.."

if [ "$#" == "0" ]; then
  if ! [ -d build ]; then
    bash ./scripts/setup.sh
  fi

  bash ./scripts/update-submodules.sh --webkit

  platform=linux
  if [ "$(uname)" == "Darwin" ]; then
    platform=mac
  fi

  make jsc-build-${platform}-compile-debug
  cmake -Bbuild -DWEBKIT_DIR=$(pwd)/src/bun.js/WebKit/WebKitBuild/Debug
  # ninja -Cbuild

  echo ""
  echo "Ready"
  echo ""
  echo "TODO: add a better way to invoke the webkit build script"
  echo "For now to recompile WebKit, run:"
  echo ""
  echo "  $ make jsc-build-${platform}-compile-debug && ninja -Cbuild"
  echo ""
  echo "To reset this back to using prebuild, run:"
  echo ""
  echo "  $ $0 --undo"
  echo "  $ $0 --danger-reset # this invokes 'git reset --hard'"
  echo ""


  exit;
fi

if [ "$1" == '--undo' ]; then
  cmake -Bbuild -UWEBKIT_DIR
  echo Reset ./build to use the system WebKit
  exit;
fi

if [ "$1" == '--danger-reset' ]; then
  cmake -Bbuild -UWEBKIT_DIR
  bash ./scripts/set-webkit-submodule-to-cmake.sh
  exit;
fi

echo "Unknown argument: $1"
echo "Usage: $0 [--undo/--danger-reset]"