#!/bin/bash

set -euxo pipefail

export DOCKER_BUILDKIT=1

docker buildx build -t bunbunbunbun/bun-test-base:latest -f Dockerfile.base --target bun-test-base . --platform=linux/amd64 --build-arg BUILDARCH=amd64
docker buildx build -t bunbunbunbun/bun-base:latest --platform=linux/amd64 --build-arg BUILDARCH=amd64 .
docker buildx build -t bunbunbunbun/bun-base-with-zig-and-webkit:latest --platform=linux/amd64 --build-arg BUILDARCH=amd64 .

docker push bunbunbunbun/bun-test-base:latest
docker push bunbunbunbun/bun-base:latest
docker push bunbunbunbun/bun-base-with-zig-and-webkit:latest
