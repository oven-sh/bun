#!/bin/bash

chsh -s $(which zsh)
sh -c "$(curl -fsSL https://starship.rs/install.sh) -- --platform linux_musl"
echo "eval \"$(starship init zsh)\"" >>~/.zshrc

curl https://github.com/Jarred-Sumner/vscode-zig/releases/download/fork-v1/zig-0.2.5.vsix >/home/ubuntu/vscode-zig.vsix
