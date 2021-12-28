#!/bin/bash

set -euxo pipefail

export DOCKER_BUILDKIT=1

docker buildx build \
    -t bunbunbunbun/bun-test-base:latest -f Dockerfile.base \
    --target bun-test-base \
    --platform=linux/$BUILDARCH --build-arg BUILDARCH=$BUILDARCH .
docker buildx build \
    --target bun-base \
    -f Dockerfile.base \
    -t bunbunbunbun/bun-base:latest --platform=linux/$BUILDARCH \
    --build-arg BUILDARCH=$BUILDARCH .
docker buildx build \
    -t bunbunbunbun/bun-base-with-zig-and-webkit:latest \
    -f Dockerfile.base \
    --target bun-base-with-zig-and-webkit \
    --platform=linux/$BUILDARCH --build-arg BUILDARCH=$BUILDARCH .

docker push bunbunbunbun/bun-test-base:latest
docker push bunbunbunbun/bun-base:latest
docker push bunbunbunbun/bun-base-with-zig-and-webkit:latest
