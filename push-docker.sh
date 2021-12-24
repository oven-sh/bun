#!/bin/bash

source "dockerfile-common.sh"

export CONTAINER_NAME=$CONTAINER_NAME

docker build . --target release --progress=plain -t $CONTAINER_NAME:latest --build-arg BUILDKIT_INLINE_CACHE=1 --platform=linux/$BUILDKIT_ARCH --cache-from $CONTAINER_NAME:latest

if (($?)); then
    echo "Failed to build container"
    exit 1
fi

id=$(docker create $CONTAINER_NAME:latest)
if (($?)); then
    echo "Failed to cp container"
    exit 1
fi

REGISTRY="ghcr.io/jarred-sumner"
docker push $REGISTRY/$CONTAINER_NAME:latest
# docker push $ECR/$CONTAINER_NAME:$BUILD_ID
