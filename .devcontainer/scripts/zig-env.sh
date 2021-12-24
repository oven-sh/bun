#!/bin/bash

curl -L https://github.com/Jarred-Sumner/vscode-zig/releases/download/fork-v1/zig-0.2.5.vsix >/home/ubuntu/vscode-zig.vsix
git clone https://github.com/zigtools/zls /home/ubuntu/zls
cd /home/ubuntu/zls
git checkout e472fca3be6335f16032b48e40ca0d5ffda6ab0a
git submodule update --init --recursive --progress --depth=1
zig build -Drelease-fast
