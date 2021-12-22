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

temp=$(mktemp -d)

docker build . -t $CONTAINER_NAME  --progress=plain --platform=linux/$BUILDKIT_ARCH

if (($?)); then
    echo "Failed to build container"
    exit 1
fi

id=$(docker create $CONTAINER_NAME:latest)
docker cp $id:/home/ubuntu/bun-release $temp/$CONTAINER_NAME
if (($?)); then
    echo "Failed to cp container"
    exit 1
fi

cd $temp && zip -r $CONTAINER_NAME.zip $CONTAINER_NAME
docker rm -v $id
docker tag $CONTAINER_NAME:latest  ghcr.io/Jarred-Sumner/$CONTAINER_NAME:latest

