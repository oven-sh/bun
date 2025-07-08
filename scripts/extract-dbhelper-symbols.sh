#!/bin/bash

# Extract dbHelper symbols from Zig object file and append to symbols.txt

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build/debug"
ZIG_OBJECT="$BUILD_DIR/bun-zig.o"
SYMBOLS_FILE="$PROJECT_ROOT/src/symbols.txt"

if [ ! -f "$ZIG_OBJECT" ]; then
    echo "Error: Zig object file not found at $ZIG_OBJECT"
    echo "Please build the project first with 'bun run build:debug'"
    exit 1
fi

echo "Extracting dbHelper symbols from $ZIG_OBJECT..."

# Remove any existing dbHelper entries and the wildcard pattern
sed -i.bak '/\.dbHelper$/d' "$SYMBOLS_FILE"
sed -i.bak '/\*dbHelper/d' "$SYMBOLS_FILE"

# Extract dbHelper symbols and append to symbols.txt
# Use cut to ensure we get complete symbol names (sometimes awk truncates long fields)
llvm-nm "$ZIG_OBJECT" 2>/dev/null | grep "\.dbHelper$" | cut -d' ' -f3- | sort -u >> "$SYMBOLS_FILE"

# Count how many symbols were added
SYMBOL_COUNT=$(llvm-nm "$ZIG_OBJECT" 2>/dev/null | grep -c "\.dbHelper$")

echo "Added $SYMBOL_COUNT dbHelper symbols to $SYMBOLS_FILE"
echo "You can now rebuild with 'bun run build:debug' to include these symbols"