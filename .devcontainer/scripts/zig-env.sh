#!/bin/bash

curl -L https://github.com/zigtools/zls-vscode/releases/download/1.1.6/zls-vscode-1.1.6.vsix >/home/ubuntu/vscode-zig.vsix
git clone https://github.com/zigtools/zls /home/ubuntu/zls
cd /home/ubuntu/zls
git checkout aabdb0c6ecb3c9a47feff2c2bfb9be4e95adf723
git submodule update --init --recursive --progress --depth=1
zig build -Drelease-fast
