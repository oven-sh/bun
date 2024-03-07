#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"
FORCE=

while getopts "f" opt; do
  case ${opt} in
    f )
      FORCE=1
      ;;
    \? )
      echo "Usage: all-dependencies.sh [-h] [-f]"
      echo "Options:"
      echo " h     Print this help message"
      echo " f     Set force to 1"
      exit 1
      ;;
  esac
done

BUILT_ANY=0

dep() {
    local script="$1"
    if [ -z "$FORCE" ]; then
        HAS_ALL_DEPS=1
        shift
        for lib in "$@"; do
            if [ ! -f "$BUN_DEPS_OUT_DIR/$lib" ]; then
                HAS_ALL_DEPS=0
                break
            fi
        done
        if [ "$HAS_ALL_DEPS" == "1" ]; then
            printf "%s - already built\n" "$script"
            return
        fi
    fi
    printf "building %s\n" "$script"

    set +e
    bash "$SCRIPT_DIR/build-$script.sh"
    EXIT=$?

    if [ "$EXIT" -ne 0 ]; then
        printf "Failed to build %s\n" "$script"
        exit "$EXIT"
    fi

    set -e

    BUILT_ANY=1
}

dep base64 libbase64.a
dep boringssl libcrypto.a libssl.a libdecrepit.a
dep cares libcares.a
dep libarchive libarchive.a
dep lolhtml liblolhtml.a
dep mimalloc-debug libmimalloc-debug.a libmimalloc-debug.o
dep mimalloc libmimalloc.a libmimalloc.o
dep tinycc libtcc.a
dep zlib libz.a
dep zstd libzstd.a
dep lshpack liblshpack.a

if [ "$BUILT_ANY" -eq 0 ]; then
    printf "(run with -f to rebuild)\n"
fi
