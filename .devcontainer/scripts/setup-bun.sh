#!/bin/bash

# Intended for devcontainer image build ONLY
# Assumes mcr.microsoft.com/vscode/devcontainers/base:bullseye base image for [aarch64|amd64]

echo "Installing Bun"
curl -fsSL https://bun.sh/install | bash -s "bun-v$BUN_VERSION"
