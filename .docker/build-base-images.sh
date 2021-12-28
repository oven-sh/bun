#!/bin/bash

set -euxo pipefail

export DOCKER_BUILDKIT=1

docker login --username bunbunbunbun

docker build -f Dockerfile.base -t bunbunbunbun/bun-test-base --target bun-test-base . --platform=linux/$BUILDARCH --build-arg BUILDARCH=$BUILDARCH
docker build -f Dockerfile.base -t bunbunbunbun/bun-base-with-zig-and-webkit --target bun-base-with-zig-and-webkit . --platform=linux/$BUILDARCH --build-arg BUILDARCH=$BUILDARCH
docker build -f Dockerfile.base -t bunbunbunbun/bun-base --target bun-base --platform=linux/$BUILDARCH . --build-arg BUILDARCH=$BUILDARCH

docker push bunbunbunbun/bun-test-base:latest
docker push bunbunbunbun/bun-base-with-zig-and-webkit:latest
docker push bunbunbunbun/bun-base:latest
