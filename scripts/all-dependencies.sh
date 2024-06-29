#!/usr/bin/env bash
set -eo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/env.sh"

if [[ "$CI" ]]; then
  $(dirname -- "${BASH_SOURCE[0]}")/update-submodules.sh
fi

FORCE=

while getopts "f" opt; do
    case ${opt} in
    f)
        FORCE=1
        ;;
    \?)
        echo "Usage: all-dependencies.sh [-h] [-f]"
        echo "Options:"
        echo " h     Print this help message"
        echo " f     Set force to 1"
        exit 1
        ;;
    esac
done

BUILT_ANY=0
SUBMODULES=
CACHE_DIR=
CACHE=0
if [ -n "$BUN_DEPS_CACHE_DIR" ]; then
    CACHE_DIR="$BUN_DEPS_CACHE_DIR"
    CACHE=1
    SUBMODULES="$(git submodule status)"
fi

dep() {
    local submodule="$1"
    local script="$2"
    CACHE_KEY=
    if [ "$CACHE" == "1" ]; then
        CACHE_KEY="$submodule/$(echo "$SUBMODULES" | grep "$submodule" | git hash-object --stdin)"
    fi
    if [ -z "$FORCE" ]; then
        HAS_ALL_DEPS=1
        shift
        for lib in "${@:2}"; do
            if [ ! -f "$BUN_DEPS_OUT_DIR/$lib" ]; then
                if [[ "$CACHE" == "1" && -f "$CACHE_DIR/$CACHE_KEY/$lib" ]]; then
                    mkdir -p "$BUN_DEPS_OUT_DIR"
                    cp "$CACHE_DIR/$CACHE_KEY/$lib" "$BUN_DEPS_OUT_DIR/$lib"
                    printf "%s %s - already cached\n" "$script" "$lib"
                else
                    HAS_ALL_DEPS=0
                    break
                fi
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
    set -e

    if [ "$EXIT" -ne 0 ]; then
        printf "Failed to build %s\n" "$script"
        exit "$EXIT"
    fi

    if [ "$CACHE" == "1" ]; then
        mkdir -p "$CACHE_DIR/$CACHE_KEY"
        for lib in "${@:2}"; do
            cp "$BUN_DEPS_OUT_DIR/$lib" "$CACHE_DIR/$CACHE_KEY/$lib"
            printf "%s %s - cached\n" "$script" "$lib"
        done
    fi

    BUILT_ANY=1
}

dep boringssl boringssl libcrypto.a libssl.a libdecrepit.a
dep c-ares cares libcares.a
dep libarchive libarchive libarchive.a
dep lol-html lolhtml liblolhtml.a
dep mimalloc mimalloc-debug libmimalloc-debug.a libmimalloc-debug.o
dep mimalloc mimalloc libmimalloc.a libmimalloc.o
dep tinycc tinycc libtcc.a
dep zlib zlib libz.a
dep zstd zstd libzstd.a
dep ls-hpack lshpack liblshpack.a

if [ "$BUILT_ANY" -eq 0 ]; then
    printf "(run with -f to rebuild)\n"
fi
