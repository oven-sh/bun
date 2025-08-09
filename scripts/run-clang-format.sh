#!/usr/bin/env bash
set -euo pipefail

# Run clang-format on all C++ source and header files in the Bun project

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Get the project root directory (parent of scripts/)
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default to format mode (modify files)
MODE="${1:-format}"

# Use LLVM_VERSION_MAJOR from environment or default to 19
LLVM_VERSION="${LLVM_VERSION_MAJOR:-19}"

# Ensure we have the specific clang-format version
CLANG_FORMAT="clang-format-${LLVM_VERSION}"
if ! command -v "$CLANG_FORMAT" &> /dev/null; then
    echo "Error: $CLANG_FORMAT not found" >&2
    echo "Please install clang-format version $LLVM_VERSION" >&2
    exit 1
fi

cd "$PROJECT_ROOT"

# Array to hold all files to format
declare -a FILES_TO_FORMAT

# Find all header files in src/ and packages/, excluding third-party and generated code
echo "Finding header files..."
while IFS= read -r -d '' file; do
    # Additional filtering for specific files and patterns
    if [[ "$file" =~ src/bun\.js/api/ffi- ]] || \
       [[ "$file" =~ src/napi/ ]] || \
       [[ "$file" =~ src/bun\.js/bindings/libuv/ ]] || \
       [[ "$file" =~ src/bun\.js/bindings/sqlite/ ]] || \
       [[ "$file" =~ packages/bun-usockets/.*libuv ]] || \
       [[ "$file" =~ src/deps/ ]]; then
        continue
    fi
    FILES_TO_FORMAT+=("$file")
done < <(find src packages -type f \( -name "*.h" -o -name "*.hpp" \) \
    -not -path "*/vendor/*" \
    -not -path "*/third_party/*" \
    -not -path "*/thirdparty/*" \
    -not -path "*/generated/*" \
    -print0 2>/dev/null || true)

# Read C++ source files from CxxSources.txt
echo "Reading C++ source files from CxxSources.txt..."
if [ -f "cmake/sources/CxxSources.txt" ]; then
    while IFS= read -r file; do
        # Skip empty lines and comments
        if [[ -n "$file" && ! "$file" =~ ^[[:space:]]*# ]]; then
            # Check if file exists
            if [ -f "$file" ]; then
                FILES_TO_FORMAT+=("$file")
            fi
        fi
    done < "cmake/sources/CxxSources.txt"
else
    echo "Warning: cmake/sources/CxxSources.txt not found" >&2
fi

# Remove duplicates while preserving order
declare -a UNIQUE_FILES
declare -A seen
for file in "${FILES_TO_FORMAT[@]}"; do
    if [[ ! -v "seen[$file]" ]]; then
        seen["$file"]=1
        UNIQUE_FILES+=("$file")
    fi
done

echo "Processing ${#UNIQUE_FILES[@]} files..."

# Run clang-format based on mode
if [ "$MODE" = "check" ]; then
    # Check mode - verify formatting without modifying files
    FAILED=0
    for file in "${UNIQUE_FILES[@]}"; do
        # Find the nearest .clang-format file for this source file
        dir=$(dirname "$file")
        while [ "$dir" != "." ] && [ "$dir" != "/" ]; do
            if [ -f "$dir/.clang-format" ]; then
                break
            fi
            dir=$(dirname "$dir")
        done
        
        if ! $CLANG_FORMAT --dry-run --Werror "$file" 2>/dev/null; then
            echo "Format check failed: $file"
            FAILED=1
        fi
    done
    
    if [ $FAILED -eq 1 ]; then
        echo "Some files need formatting. Run 'bun run clang-format' to fix."
        exit 1
    else
        echo "All files are properly formatted."
    fi
elif [ "$MODE" = "format" ] || [ "$MODE" = "fix" ]; then
    # Format mode - modify files in place
    for file in "${UNIQUE_FILES[@]}"; do
        echo "Formatting: $file"
        $CLANG_FORMAT -i "$file"
    done
    echo "Formatting complete."
elif [ "$MODE" = "diff" ]; then
    # Diff mode - show what would change
    for file in "${UNIQUE_FILES[@]}"; do
        if ! $CLANG_FORMAT --dry-run --Werror "$file" 2>/dev/null; then
            echo "=== $file ==="
            diff -u "$file" <($CLANG_FORMAT "$file") || true
        fi
    done
else
    echo "Usage: $0 [check|format|fix|diff]" >&2
    echo "  check  - Check if files are formatted (default)" >&2
    echo "  format - Format files in place" >&2
    echo "  fix    - Same as format" >&2
    echo "  diff   - Show formatting differences" >&2
    exit 1
fi