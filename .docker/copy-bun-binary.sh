#!/bin/bash

set -euxo pipefail

name=$(openssl rand -hex 12)
id=$(docker create --name=bun-binary-$name $CONTAINER_TAG)
docker container cp bun-binary-$name:$BUN_RELEASE_DIR bun-binary
echo -e "bun-binary-$name"
