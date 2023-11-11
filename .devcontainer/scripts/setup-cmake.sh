#!/bin/bash

# Intended for devcontainer image build ONLY
# Assumes mcr.microsoft.com/vscode/devcontainers/base:bullseye base image for [aarch64|amd64]

echo "Installing CMake"
arch=$TARGETARCH && \
    case ${arch} in \
        "arm64")  export ARCH=aarch64 ;; \
        "amd64")  export ARCH=x86_64 ;; \
        *)        echo "error: unsupported architecture: $arch"; exit 1 ;; \
    esac
echo "TARGETARCH:$TARGETARCH"
echo "ARCH:$ARCH"

wget -P /tmp https://github.com/Kitware/CMake/releases/download/v$CMAKE_VERSION/cmake-$CMAKE_VERSION-linux-$ARCH.sh
chmod +x /tmp/cmake-$CMAKE_VERSION-linux-$ARCH.sh
sudo mkdir -p /usr/bin/cmake
sudo /tmp/cmake-$CMAKE_VERSION-linux-$ARCH.sh --skip-license --prefix=/usr/bin/cmake
echo export PATH=\$PATH:/usr/bin/cmake/bin >> ~/.bashrc
