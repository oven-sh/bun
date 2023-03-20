#!/bin/bash
set -euxo pipefail

parent_path=$(
    cd "$(dirname "${BASH_SOURCE[0]}")"
    pwd -P
)

cd "$parent_path/../"

# if bun-webkit node_modules directory exists
# this is how we know we are in development mode
if [ -d ./node_modules/bun-webkit ]; then
    rm -f bun-webkit
    # get the first matching bun-webkit-* directory name
    ln -s ./node_modules/$(ls ./node_modules | grep bun-webkit- | head -n 1) ./bun-webkit
fi

IS_BUN_RELEASE_BUILD=${IS_BUN_RELEASE_BUILD:-"false"}
ZLS_VERSION_USED_BY_BUN=${ZLS_VERSION_USED_BY_BUN:-"4b034f1afba5c6d1224ee76f69bedd3f82cf65a6"}

if [ "$IS_BUN_RELEASE_BUILD" == "false" ]; then
    if command -v zig && command -v git; then
        if [ ! -d ./zls ]; then
            echo "Cloning Zig Language Server..."
            git clone https://github.com/zigtools/zls --depth 1 --recurse-submodules
            echo "Cloned Zig Language Server"
        fi

        # if zls executable does not exist OR if the zls version is not the same as the one we want to clone
        if [ ! -f ./zls/zig-out/bin/zls ] || [ ! -f ./zls/.zls-version ] || [ "$(cat ./zls/.zls-version)" != "$ZLS_VERSION_USED_BY_BUN" ]; then
            echo "Updating Zig Language Server to $ZLS_VERSION_USED_BY_BUN..."
            cd ./zls
            git fetch origin $ZLS_VERSION_USED_BY_BUN
            git checkout --force "$ZLS_VERSION_USED_BY_BUN"
            git submodule update --init --recursive
            zig build -Doptimize=ReleaseFast
            rm -f .zls-version
            echo "$ZLS_VERSION_USED_BY_BUN" > .zls-version
            echo ""
            echo "Zig Language Server updated to $ZLS_VERSION_USED_BY_BUN"
            cd ..
        fi
    fi
fi
