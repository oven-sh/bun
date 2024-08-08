#!/bin/bash

set -eo pipefail
source "$(dirname "$0")/env.sh"
source "$(realpath $(dirname "$0")/../../scripts/all-dependencies.sh)"

artifacts=(
  libcrypto.a libssl.a libdecrepit.a
  libcares.a
  libarchive.a
  liblolhtml.a
  libmimalloc.a libmimalloc.o
  libtcc.a
  libz.a
  libzstd.a
  libdeflate.a
  liblshpack.a
)

for artifact in "${artifacts[@]}"; do
  source "$(dirname "$0")/upload-artifact.sh" "build/bun-deps/$artifact"
done
