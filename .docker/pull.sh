#!/bin/bash

set -euxo pipefail

docker pull bunbunbunbun/bun-test-base:latest --platform=linux/amd64
docker pull bunbunbunbun/bun-base:latest --platform=linux/amd64
docker pull bunbunbunbun/bun-base-with-zig-and-webkit:latest --platform=linux/amd64

docker tag bunbunbunbun/bun-test-base:latest bun-base:latest
docker tag bunbunbunbun/bun-base:latest bun-base:latest
docker tag bunbunbunbun/bun-base-with-zig-and-webkit:latest bun-base-with-zig-and-webkit:latest
