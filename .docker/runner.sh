#!/bin/bash

set -euxo pipefail

docker container run --security-opt seccomp=.docker/chrome.json --env GITHUB_WORKSPACE=$GITHUB_WORKSPACE --env BUN_TEST_NAME=$BUN_TEST_NAME --ulimit memlock=-1:-1 --init --rm bun-test:latest
