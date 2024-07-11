#!/usr/bin/env bash
set -exo pipefail
source $(dirname -- "${BASH_SOURCE[0]}")/env.sh

export USE_LTO="${USE_LTO:-ON}"
case "$(uname -m)" in
  aarch64|arm64)
    export CPU_TARGET="${CPU_TARGET:-native}"
    ;;
  *)
    export CPU_TARGET="${CPU_TARGET:-haswell}"
    ;;
esac

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fast|--no-lto)
      export USE_LTO="OFF"
      shift
      ;;
    --baseline)
      export CPU_TARGET="nehalem"
      shift
      ;;
    --cpu)
      export CPU_TARGET="$2"
      shift
      shift
      ;;
    *|-*|--*)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

mkdir -p build
cd build
mkdir -p tmp_modules tmp_functions js codegen
cmake .. \
  -GNinja \
  -DCMAKE_BUILD_TYPE=Release \
  -DUSE_LTO=${USE_LTO} \
  -DCPU_TARGET=${CPU_TARGET} \
  -DBUN_CPP_ONLY=1 \
  -DNO_CONFIGURE_DEPENDS=1
chmod +x ./compile-cpp-only.sh
bash ./compile-cpp-only.sh -v
