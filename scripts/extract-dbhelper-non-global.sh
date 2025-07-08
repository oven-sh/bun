#!/bin/bash

# Extract dbHelper symbols from Zig object file for non_global_symbols_no_strip_list

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_DIR="$PROJECT_ROOT/build/debug"
ZIG_OBJECT="$BUILD_DIR/bun-zig.o"
OUTPUT_FILE="$PROJECT_ROOT/src/symbols-non-global.txt"

if [ ! -f "$ZIG_OBJECT" ]; then
    echo "Error: Zig object file not found at $ZIG_OBJECT"
    echo "Please build the project first with 'bun run build:debug'"
    exit 1
fi

echo "Extracting dbHelper symbols from $ZIG_OBJECT..."

# Extract dbHelper symbols that are local (marked with 't')
# The symbols already have the underscore prefix, so we use them as-is
# Use cut to ensure we get complete symbol names (awk can truncate long fields)
llvm-nm "$ZIG_OBJECT" 2>/dev/null | grep " t " | grep "\.dbHelper$" | cut -d' ' -f3- | sort -u > "$OUTPUT_FILE"

# Count how many symbols were added
SYMBOL_COUNT=$(wc -l < "$OUTPUT_FILE")

echo "Extracted $SYMBOL_COUNT dbHelper symbols to $OUTPUT_FILE"
echo "These symbols will be preserved when using -dead_strip"