#!/usr/bin/env bash
set -euo pipefail

# This script updates SQLite amalgamation files with the required compiler flags.
# It downloads the SQLite source, configures it with necessary flags, builds the
# amalgamation, and copies the generated files to the Bun source tree.
#
# Usage:
#   ./scripts/update-sqlite-amalgamation.sh <version_number> <year>
#
# Example:
#   ./scripts/update-sqlite-amalgamation.sh 3500400 2025
#
# The version number is a 7-digit SQLite version (e.g., 3500400 for 3.50.4)
# The year is the release year found in the download URL

if [ $# -ne 2 ]; then
  echo "Usage: $0 <version_number> <year>"
  echo "Example: $0 3500400 2025"
  exit 1
fi

VERSION_NUM="$1"
YEAR="$2"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

cd "$TEMP_DIR"

echo "Downloading SQLite source version $VERSION_NUM from year $YEAR..."
DOWNLOAD_URL="https://sqlite.org/$YEAR/sqlite-src-$VERSION_NUM.zip"
echo "URL: $DOWNLOAD_URL"

wget -q "$DOWNLOAD_URL"
unzip -q "sqlite-src-$VERSION_NUM.zip"
cd "sqlite-src-$VERSION_NUM"

echo "Configuring SQLite with required flags..."
# These flags must be set during amalgamation generation for them to take effect
# in the parser and other compile-time generated code
CFLAGS="-DSQLITE_ENABLE_UPDATE_DELETE_LIMIT=1 -DSQLITE_ENABLE_COLUMN_METADATA=1"
./configure CFLAGS="$CFLAGS" > /dev/null 2>&1

echo "Building amalgamation..."
make sqlite3.c > /dev/null 2>&1

echo "Copying files to Bun source tree..."
# Add clang-format off directive and copy the amalgamation
echo "// clang-format off" > "$REPO_ROOT/src/bun.js/bindings/sqlite/sqlite3.c"
cat sqlite3.c >> "$REPO_ROOT/src/bun.js/bindings/sqlite/sqlite3.c"

echo "// clang-format off" > "$REPO_ROOT/src/bun.js/bindings/sqlite/sqlite3_local.h"
cat sqlite3.h >> "$REPO_ROOT/src/bun.js/bindings/sqlite/sqlite3_local.h"

echo "✓ Successfully updated SQLite amalgamation files"
