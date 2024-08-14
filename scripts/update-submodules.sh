#!/usr/bin/env bash

set -euo pipefail

FORCE_UPDATE_SUBMODULES=${FORCE_UPDATE_SUBMODULES:-0}

cd "$(dirname "${BASH_SOURCE[0]}")"
cd ..
NAMES=$(cat .gitmodules | grep 'path = ' | awk '{print $3}')

if ! [ "${1:-}" == '--webkit' ]; then
  # we will exclude webkit unless you explicitly clone it yourself (a huge download)
  if [ ! -e "src/bun.js/WebKit/.git" ]; then
    NAMES=$(echo "$NAMES" | grep -v 'WebKit')
  fi
fi

set -exo pipefail
git submodule update --init --recursive --progress --depth=1 --checkout $NAMES
if [ "$FORCE_UPDATE_SUBMODULES" == "1" ]; then
  # Set --force in CI.
  git submodule update --init --recursive --progress --depth=1 --checkout --force $NAMES
else
  git submodule update --init --recursive --progress --depth=1 --checkout $NAMES
fi
