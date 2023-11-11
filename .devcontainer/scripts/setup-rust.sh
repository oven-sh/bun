#!/bin/bash

# Intended for devcontainer image build ONLY
# Assumes mcr.microsoft.com/vscode/devcontainers/base:bullseye base image for [aarch64|amd64]

echo "Installing Rust"
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
