#!/bin/bash

# Intended for devcontainer image build ONLY
# Assumes mcr.microsoft.com/vscode/devcontainers/base:bullseye base image for [aarch64|amd64]

echo "Installing LLVM"
wget -P /tmp https://apt.llvm.org/llvm.sh
chmod +x /tmp/llvm.sh
sudo /tmp/llvm.sh $LLVM_VERSION
sudo ln -s /usr/bin/clang-$LLVM_VERSION /usr/bin/clang
sudo ln -s /usr/bin/clang++-$LLVM_VERSION /usr/bin/clang++
sudo ln -s /usr/bin/lld-$LLVM_VERSION /usr/bin/lld
sudo ln -s /usr/bin/lldb-$LLVM_VERSION /usr/bin/lldb
sudo ln -s /usr/bin/clangd-$LLVM_VERSION /usr/bin/clangd
sudo ln -s /usr/bin/llvm-ar-$LLVM_VERSION /usr/bin/llvm-ar
