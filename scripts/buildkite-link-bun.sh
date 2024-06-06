#!/usr/bin/env bash
set -euxo pipefail
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

export TAG=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --tag)
      export TAG="$2"
      shift
      shift
      ;;
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

if [[ -z "$TAG" ]]; then
  echo "--tag <name> is required"
  exit 1
fi

mkdir -p release
buildkite-agent artifact download '**' release --step bun-$TAG-deps
buildkite-agent artifact download '**' release --step bun-$TAG-zig
buildkite-agent artifact download '**' release --step bun-$TAG-cpp

cmake \
  -GNinja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCPU_TARGET=${CPU_TARGET} \
  -DUSE_LTO=${USE_LTO} \
  -DBUN_LINK_ONLY=1 \
  -DBUN_ZIG_OBJ="$(pwd)/release/bun-zig.o" \
  -DBUN_CPP_ARCHIVE="$(pwd)/release/bun-cpp-objects.a" \
  -DBUN_DEPS_OUT_DIR="$(pwd)/release/src/deps" \
  -DNO_CONFIGURE_DEPENDS=1
ninja -v

chmod +x bun-profile bun
mkdir -p bun-$TAG-profile/ bun-$TAG/
mv bun-profile bun-$TAG-profile/bun-profile
mv bun bun-$TAG/bun
zip -r bun-$TAG-profile.zip bun-$TAG-profile
zip -r bun-$TAG.zip bun-$TAG
