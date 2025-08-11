#!/bin/bash

# Script to download zip files from a GitHub release, extract them, and create tar.gz and tar.xz archives
# Usage: ./create-tar-archives.sh <tag> [temp_dir]

set -euo pipefail

TAG="${1:-}"
TEMP_DIR="${2:-/tmp/bun-archives-$$}"
GITHUB_REPO="oven-sh/bun"

if [[ -z "$TAG" ]]; then
    echo "Usage: $0 <tag> [temp_dir]"
    echo "Example: $0 bun-v1.2.20"
    exit 1
fi

# Ensure we have required tools
for tool in curl jq unzip tar; do
    if ! command -v "$tool" &> /dev/null; then
        echo "Error: $tool is not installed"
        exit 1
    fi
done

echo "Creating temporary directory: $TEMP_DIR"
mkdir -p "$TEMP_DIR"

# Function to cleanup on exit
cleanup() {
    if [[ -d "$TEMP_DIR" ]]; then
        echo "Cleaning up temporary directory: $TEMP_DIR"
        rm -rf "$TEMP_DIR"
    fi
}
trap cleanup EXIT

echo "Fetching release information for tag: $TAG"
RELEASE_DATA=$(curl -s "https://api.github.com/repos/$GITHUB_REPO/releases/tags/$TAG")

if [[ $(echo "$RELEASE_DATA" | jq -r '.message // empty') == "Not Found" ]]; then
    echo "Error: Release with tag '$TAG' not found"
    exit 1
fi

# Get all zip file URLs
ZIP_ASSETS=$(echo "$RELEASE_DATA" | jq -r '.assets[] | select(.name | endswith(".zip")) | "\(.name)|\(.browser_download_url)"')

if [[ -z "$ZIP_ASSETS" ]]; then
    echo "No zip files found in release $TAG"
    exit 0
fi

echo "Found zip files to process:"
echo "$ZIP_ASSETS" | cut -d'|' -f1 | sed 's/^/  - /'

CREATED_ARCHIVES=()

while IFS='|' read -r ASSET_NAME DOWNLOAD_URL; do
    echo
    echo "Processing: $ASSET_NAME"
    
    # Download the zip file
    ZIP_PATH="$TEMP_DIR/$ASSET_NAME"
    echo "  Downloading $ASSET_NAME..."
    curl -L -o "$ZIP_PATH" "$DOWNLOAD_URL"
    
    # Extract the zip file
    EXTRACT_DIR="$TEMP_DIR/extract_$(basename "$ASSET_NAME" .zip)"
    mkdir -p "$EXTRACT_DIR"
    echo "  Extracting to $EXTRACT_DIR..."
    unzip -q "$ZIP_PATH" -d "$EXTRACT_DIR"
    
    # Find the directory inside (should be only one)
    CONTENT_DIR=$(find "$EXTRACT_DIR" -mindepth 1 -maxdepth 1 -type d | head -1)
    if [[ -z "$CONTENT_DIR" ]]; then
        echo "  Warning: No directory found inside $ASSET_NAME, skipping..."
        continue
    fi
    
    CONTENT_DIR_NAME=$(basename "$CONTENT_DIR")
    echo "  Found content directory: $CONTENT_DIR_NAME"
    
    # Create tar.gz archive
    TAR_GZ_NAME="${ASSET_NAME%.zip}.tar.gz"
    TAR_GZ_PATH="$TEMP_DIR/$TAR_GZ_NAME"
    echo "  Creating $TAR_GZ_NAME..."
    (cd "$EXTRACT_DIR" && tar -czf "$TAR_GZ_PATH" "$CONTENT_DIR_NAME")
    CREATED_ARCHIVES+=("$TAR_GZ_PATH")
    
    # Create tar.xz archive
    TAR_XZ_NAME="${ASSET_NAME%.zip}.tar.xz"
    TAR_XZ_PATH="$TEMP_DIR/$TAR_XZ_NAME"
    echo "  Creating $TAR_XZ_NAME..."
    (cd "$EXTRACT_DIR" && tar -cJf "$TAR_XZ_PATH" "$CONTENT_DIR_NAME")
    CREATED_ARCHIVES+=("$TAR_XZ_PATH")
    
    # Clean up intermediate files
    rm -f "$ZIP_PATH"
    rm -rf "$EXTRACT_DIR"
    
done <<< "$ZIP_ASSETS"

echo
echo "Created archives:"
for archive in "${CREATED_ARCHIVES[@]}"; do
    echo "  - $(basename "$archive") ($(du -h "$archive" | cut -f1))"
done

# If GITHUB_TOKEN is set, upload the archives to the release
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    echo
    echo "GITHUB_TOKEN found, uploading archives to release..."
    
    RELEASE_ID=$(echo "$RELEASE_DATA" | jq -r '.id')
    UPLOAD_URL="https://uploads.github.com/repos/$GITHUB_REPO/releases/$RELEASE_ID/assets"
    
    for ARCHIVE_PATH in "${CREATED_ARCHIVES[@]}"; do
        ARCHIVE_NAME=$(basename "$ARCHIVE_PATH")
        echo "  Uploading $ARCHIVE_NAME..."
        
        # Delete existing asset if it exists
        EXISTING_ASSET_ID=$(echo "$RELEASE_DATA" | jq -r ".assets[] | select(.name == \"$ARCHIVE_NAME\") | .id")
        if [[ "$EXISTING_ASSET_ID" != "null" && -n "$EXISTING_ASSET_ID" ]]; then
            echo "    Deleting existing asset..."
            curl -X DELETE \
                -H "Authorization: token $GITHUB_TOKEN" \
                "https://api.github.com/repos/$GITHUB_REPO/releases/assets/$EXISTING_ASSET_ID"
        fi
        
        # Upload new asset
        CONTENT_TYPE="application/octet-stream"
        if [[ "$ARCHIVE_NAME" == *.tar.gz ]]; then
            CONTENT_TYPE="application/gzip"
        elif [[ "$ARCHIVE_NAME" == *.tar.xz ]]; then
            CONTENT_TYPE="application/x-xz"
        fi
        
        curl -X POST \
            -H "Authorization: token $GITHUB_TOKEN" \
            -H "Content-Type: $CONTENT_TYPE" \
            --data-binary "@$ARCHIVE_PATH" \
            "$UPLOAD_URL?name=$ARCHIVE_NAME"
        
        echo "    Uploaded $ARCHIVE_NAME"
    done
else
    echo
    echo "GITHUB_TOKEN not set, archives saved to:"
    for archive in "${CREATED_ARCHIVES[@]}"; do
        echo "  $archive"
    done
    echo
    echo "To upload these manually, set GITHUB_TOKEN and re-run this script."
fi

# Don't cleanup if GITHUB_TOKEN is not set, so user can access the files
if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    trap '' EXIT  # Disable cleanup
    echo "Temporary directory preserved: $TEMP_DIR"
fi

echo
echo "Done!"