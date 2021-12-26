export DOCKER_BUILDKIT=1

export BUILDKIT_ARCH=$(uname -m)
export ARCH=${BUILDKIT_ARCH}

if [ "$BUILDKIT_ARCH" == "amd64" ]; then
    export BUILDKIT_ARCH="amd64"
    export ARCH=x64
fi

if [ "$BUILDKIT_ARCH" == "x86_64" ]; then
    export BUILDKIT_ARCH="amd64"
    export ARCH=x64
fi

if [ "$BUILDKIT_ARCH" == "arm64" ]; then
    export BUILDKIT_ARCH="arm64"
    export ARCH=aarch64
fi

if [ "$BUILDKIT_ARCH" == "aarch64" ]; then
    export BUILDKIT_ARCH="arm64"
    export ARCH=aarch64
fi

if [ "$BUILDKIT_ARCH" == "armv7l" ]; then
    echo "Unsupported platform: $BUILDKIT_ARCH"
    exit 1
fi

export BUILD_ID=$(cat build-id)
export CONTAINER_NAME=bun-linux-$ARCH
export DEBUG_CONTAINER_NAME=debug-bun-linux-$ARCH
export TEMP=/tmp/bun-0.0.$BUILD_ID
