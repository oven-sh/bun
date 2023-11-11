#!/bin/bash

# Intended for devcontainer image build ONLY
# Assumes mcr.microsoft.com/vscode/devcontainers/base:bullseye base image for [aarch64|amd64]
# Assumes running first before all other setup-*.sh scripts

export CXX=clang++-16
export CC=clang-16
export AR=/usr/bin/llvm-ar-16
export LD=lld-16

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg

echo "Installing Deps"
sudo apt-get install -y \
    wget \
    bash \
    software-properties-common \
    build-essential \
    autoconf \
    automake \
    libtool \
    pkg-config \
    make \
    ninja-build \
    file \
    libc-dev \
    libxml2 \
    libxml2-dev \
    xz-utils \
    git \
    tar \
    rsync \
    gzip \
    unzip \
    perl \
    python3 \
    ruby \
    golang \
    ccache \
    ruby-full
