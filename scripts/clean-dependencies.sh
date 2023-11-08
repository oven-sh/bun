#!/usr/bin/env bash
FORCE=

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
BUN_BASE_DIR=${BUN_BASE_DIR:-$(cd $SCRIPT_DIR && cd .. && pwd)}
BUN_DEPS_OUT_DIR=${BUN_DEPS_OUT_DIR:-$BUN_BASE_DIR/src/deps/}
BUN_DEPS_DIR=${BUN_DEPS_DIR:-$BUN_BASE_DIR/src/deps/}

rm -f $BUN_DEPS_OUT_DIR/*.a

git_reset() {
  dir=$(pwd)
  cd $1
  git reset --hard
  git clean -fdx
  cd $dir
}

git_reset $BUN_DEPS_DIR/boringssl
git_reset $BUN_DEPS_DIR/c-ares
git_reset $BUN_DEPS_DIR/libarchive
git_reset $BUN_DEPS_DIR/lol-html
git_reset $BUN_DEPS_DIR/mimalloc
git_reset $BUN_DEPS_DIR/picohttpparser
git_reset $BUN_DEPS_DIR/tinycc
git_reset $BUN_DEPS_DIR/zlib
git_reset $BUN_DEPS_DIR/zstd
git_reset $BUN_DEPS_DIR/lshpack