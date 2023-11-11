#!/bin/bash

# Intended for devcontainer image build ONLY
# Assumes mcr.microsoft.com/vscode/devcontainers/base:bullseye base image for [aarch64|amd64]

echo "Installing Zig"
arch=$TARGETARCH && \
    case ${arch} in \
        "arm64")  export ARCH=aarch64 ;; \
        "amd64")  export ARCH=x86_64 ;; \
        *)        echo "error: unsupported architecture: $arch"; exit 1 ;; \
    esac
echo "TARGETARCH:$TARGETARCH"
echo "ARCH:$ARCH"

ZIG_FOLDERNAME="zig-linux-$ARCH-$ZIG_VERSION"
ZIG_FILENAME="$ZIG_FOLDERNAME.tar.xz"
curl -sSL "https://ziglang.org/builds/$ZIG_FILENAME" -o /tmp/$ZIG_FILENAME
tar xf /tmp/${ZIG_FILENAME} -C /tmp
sudo mv /tmp/$ZIG_FOLDERNAME/lib /usr/lib/zig
sudo mv /tmp/$ZIG_FOLDERNAME/zig /usr/bin/zig
