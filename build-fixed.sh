#!/bin/bash
set -e

echo "Setting up build environment..."

# Set up environment
export PATH="/opt/homebrew/opt/llvm@19/bin:$PATH"

# Clean build directory
echo "Cleaning build directory..."
rm -rf build

# Configure with explicit macOS deployment target to work around SDK 26 issue
echo "Configuring build with macOS deployment target 15.0..."
cmake -G Ninja \
    -DCMAKE_BUILD_TYPE=Debug \
    -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 \
    -B build/debug \
    -S .

# Build
echo "Building Bun debug..."
ninja -C build/debug

echo "Build complete! Binary is at: build/debug/bun-debug"