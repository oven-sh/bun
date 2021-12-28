#!/bin/bash

set -euxo pipefail

docker pull bunbunbunbun/bun-test-base:amd64 --platform=linux/amd64
docker pull bunbunbunbun/bun-base:amd64 --platform=linux/amd64
docker pull bunbunbunbun/bun-base-with-zig-and-webkit:amd64 --platform=linux/amd64

docker tag bun-base:latest bunbunbunbun/bun-base:amd64
docker tag bun-base-with-zig-and-webkit:latest bunbunbunbun/bun-base-with-zig-and-webkit:amd64
docker tag bun-test-base:latest bunbunbunbun/bun-test-base:amd64
