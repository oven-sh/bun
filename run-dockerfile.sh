#!/bin/bash

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
rm -rf $TEMP
mkdir -p $TEMP

docker build . --target build_release --progress=plain -t $CONTAINER_NAME:latest --build-arg BUILDKIT_INLINE_CACHE=1 --platform=linux/aarch64 --cache-from $CONTAINER_NAME:latest

if (($?)); then
  echo "Failed to build container"
  exit 1
fi

id=$(docker create $CONTAINER_NAME:latest)
docker cp $id:/home/ubuntu/bun-release $TEMP/$CONTAINER_NAME
if (($?)); then
  echo "Failed to cp container"
  exit 1
fi

cd $TEMP
mkdir -p $TEMP/$CONTAINER_NAME $TEMP/$DEBUG_CONTAINER_NAME
mv $CONTAINER_NAME/bun-profile $DEBUG_CONTAINER_NAME/bun
zip -r $CONTAINER_NAME.zip $CONTAINER_NAME
zip -r $DEBUG_CONTAINER_NAME.zip $DEBUG_CONTAINER_NAME
docker rm -v $id
abs=$(realpath $TEMP/$CONTAINER_NAME.zip)
debug_abs=$(realpath $TEMP/$DEBUG_CONTAINER_NAME.zip)

if command -v bun --version >/dev/null; then
  cp $TEMP/$CONTAINER_NAME/bun $(which bun)
  cp $TEMP/$DEBUG_CONTAINER_NAME/bun $(which bun-profile)
fi

echo "Saved to:"
echo $debug_abs
echo $abs
