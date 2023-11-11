#!/bin/bash

#TODO: Build with CI :shrug2:
BUN_VERSION="1.0.11"

docker build -t oven/bun-devcontainer:$BUN_VERSION .
