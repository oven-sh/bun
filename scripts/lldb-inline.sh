#!/bin/bash
# LLDB Inline Debug Tool Build & Run Script
#
# This script builds the lldb-inline tool if needed and runs it.
# Usage: ./scripts/lldb-inline.sh <executable> [args...]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL_SOURCE="$SCRIPT_DIR/lldb-inline-tool.cpp"
TOOL_BINARY="$SCRIPT_DIR/lldb-inline"

# Check if we need to rebuild
if [ ! -f "$TOOL_BINARY" ] || [ "$TOOL_SOURCE" -nt "$TOOL_BINARY" ]; then
    # Detect OS and build accordingly
    if [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS with Homebrew LLVM
        c++ -std=c++17 -o "$TOOL_BINARY" "$TOOL_SOURCE" \
            -llldb \
            -L/opt/homebrew/opt/llvm/lib \
            -I/opt/homebrew/opt/llvm/include \
            -Wl,-rpath,/opt/homebrew/opt/llvm/lib >/dev/null 2>&1
    else
        # Linux - try to find LLVM installation
        LLVM_DIR=""
        for version in 18 17 16 15 14 13 12; do
            if [ -d "/usr/lib/llvm-$version" ]; then
                LLVM_DIR="/usr/lib/llvm-$version"
                break
            fi
        done
        
        if [ -z "$LLVM_DIR" ] && [ -d "/usr/lib/llvm" ]; then
            LLVM_DIR="/usr/lib/llvm"
        fi
        
        if [ -z "$LLVM_DIR" ]; then
            # Try pkg-config as fallback
            LLDB_CFLAGS=$(pkg-config --cflags lldb 2>/dev/null)
            LLDB_LIBS=$(pkg-config --libs lldb 2>/dev/null)
            c++ -std=c++17 -o "$TOOL_BINARY" "$TOOL_SOURCE" \
                $LLDB_CFLAGS $LLDB_LIBS >/dev/null 2>&1
        else
            c++ -std=c++17 -o "$TOOL_BINARY" "$TOOL_SOURCE" \
                -llldb \
                -L"$LLVM_DIR/lib" \
                -I"$LLVM_DIR/include" >/dev/null 2>&1
        fi
    fi
    
    if [ $? -ne 0 ]; then
        exit 1
    fi
fi

# Run the tool with all arguments
exec "$TOOL_BINARY" "$@"