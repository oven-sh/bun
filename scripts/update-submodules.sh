#!/usr/bin/env bash
cd "$(dirname "${BASH_SOURCE[0]}")"
cd ..
NAMES=$(cat .gitmodules | grep 'path = ' | awk '{print $3}')

if ! [ "$1" == '--webkit' ]; then
  # we will exclude webkit unless you explicitly clone it yourself (a huge download)
  if [ ! -e "src/bun.js/WebKit/.git" ]; then
    NAMES=$(echo "$NAMES" | grep -v 'WebKit')
  fi
fi

set -exo pipefail
git submodule update --init --recursive --progress --depth=1 --checkout $NAMES
