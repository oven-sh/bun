#!/bin/bash

set -euxo pipefail

id=$(docker create --name=bun-binary $CONTAINER_TAG)
docker container cp bun-binary:$BUN_RELEASE_DIR bun-binary
docker rm bun-binary
