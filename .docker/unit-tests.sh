#!/bin/bash

set -euxo pipefail

docker container run --security-opt seccomp=.docker/chrome.json --env GITHUB_WORKSPACE=$GITHUB_WORKSPACE --ulimit memlock=-1:-1 --init --rm bun-unit-tests:latest
