#!/usr/bin/env bash
set -euxo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

export CPU_TARGET="${1:-${CPU_TARGET:-native}}"

cmake -S . \
  -GNinja \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_LTO=ON \
  -DBUN_CPP_ONLY=1 \
  -DNO_CONFIGURE_DEPENDS=1

chmod +x compile-cpp-only.sh
bash compile-cpp-only.sh -v
