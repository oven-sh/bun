#!/bin/bash
# Updates the vendored uucode library and regenerates grapheme tables.
#
# Usage:
#   ./scripts/update-uucode.sh                    # update from default URL
#   ./scripts/update-uucode.sh /path/to/uucode    # update from local directory
#   ./scripts/update-uucode.sh https://url.tar.gz # update from URL
#
# After running, verify with:
#   bun bd test test/js/bun/util/stringWidth.test.ts

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUN_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
UUCODE_DIR="$BUN_ROOT/src/deps/uucode"
ZIG="$BUN_ROOT/vendor/zig/zig"

if [ ! -x "$ZIG" ]; then
    echo "error: zig not found at $ZIG"
    echo "       run scripts/bootstrap.sh first"
    exit 1
fi

update_from_dir() {
    local src="$1"
    echo "Updating uucode from: $src"
    rm -rf "$UUCODE_DIR"
    mkdir -p "$UUCODE_DIR"
    cp -r "$src"/* "$UUCODE_DIR/"
}

update_from_url() {
    local url="$1"
    local tmp
    tmp=$(mktemp -d)
    trap "rm -rf $tmp" EXIT

    echo "Downloading uucode from: $url"
    curl -fsSL "$url" | tar -xz -C "$tmp" --strip-components=1

    update_from_dir "$tmp"
}

# Handle source argument
if [ $# -ge 1 ]; then
    SOURCE="$1"
    if [ -d "$SOURCE" ]; then
        update_from_dir "$SOURCE"
    elif [[ "$SOURCE" == http* ]]; then
        update_from_url "$SOURCE"
    else
        echo "error: argument must be a directory or URL"
        exit 1
    fi
else
    # Default: use the zig global cache if available
    CACHED=$(find "$HOME/.cache/zig/p" -maxdepth 1 -name "uucode-*" -type d 2>/dev/null | sort -V | tail -1)
    if [ -n "$CACHED" ]; then
        update_from_dir "$CACHED"
    else
        echo "error: no uucode source specified and none found in zig cache"
        echo ""
        echo "usage: $0 <path-to-uucode-dir-or-url>"
        exit 1
    fi
fi

echo ""
echo "Regenerating grapheme tables..."
cd "$BUN_ROOT"
"$ZIG" build generate-grapheme-tables

echo ""
echo "Done. Updated files:"
echo "  src/deps/uucode/         (vendored library)"
echo "  src/string/immutable/grapheme_tables.zig (regenerated)"
echo ""
echo "Next steps:"
echo "  1. bun bd test test/js/bun/util/stringWidth.test.ts"
echo "  2. git add src/deps/uucode src/string/immutable/grapheme_tables.zig"
echo "  3. git commit -m 'Update uucode to <version>'"
