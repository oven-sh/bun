#!/bin/bash

curl -L https://github.com/zigtools/zls-vscode/releases/download/1.1.6/zls-vscode-1.1.6.vsix >/home/ubuntu/vscode-zig.vsix
git clone https://github.com/zigtools/zls /home/ubuntu/zls
cd /home/ubuntu/zls
git checkout 30869d7d8741656448e46fbf14f14da9ca7e5a21
git submodule update --init --recursive --progress --depth=1
zig build -Doptimize=ReleaseFast
