#!/bin/bash

set -euxo pipefail

docker pull bunbunbunbun/bun-test-base:latest --platform=linux/amd64
docker pull bunbunbunbun/bun-base:latest --platform=linux/amd64
docker pull bunbunbunbun/bun-base-with-zig-and-webkit:latest --platform=linux/amd64

docker tag bun-base:latest bunbunbunbun/bun-base
docker tag bun-base-with-zig-and-webkit:latest bunbunbunbun/bun-base-with-zig-and-webkit:latest
