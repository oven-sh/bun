#!/bin/bash
set -euxo pipefail

# sets up vscode C++ intellisense
rm -f .vscode/clang++
ln -s $(which clang++-16 || which clang++) .vscode/clang++ 2>/dev/null
