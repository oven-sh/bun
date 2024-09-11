#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

cd $BUN_DEPS_DIR/lol-html/c-api
cargo build --release
cp target/release/liblolhtml.a $BUN_DEPS_OUT_DIR/liblolhtml.a
