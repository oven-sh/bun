#!/bin/bash
set -e

# Set up environment
export PATH="/opt/homebrew/opt/llvm@19/bin:$PATH"
export CMAKE_OSX_DEPLOYMENT_TARGET="15.0"

# Configure if needed
if [ ! -f build/debug/build.ninja ]; then
    echo "Configuring build..."
    cmake -G Ninja \
        -DCMAKE_BUILD_TYPE=Debug \
        -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0 \
        -B build/debug \
        -S .
fi

# Build
echo "Building Bun debug..."
ninja -C build/debug

echo "Build complete! Binary is at: build/debug/bun-debug"