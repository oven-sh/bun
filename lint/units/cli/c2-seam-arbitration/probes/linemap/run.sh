#!/bin/sh
# The line map of src/lint/scanner.rs against the functions of typescript-go (89d5d5b), on every position of 4000 inputs.
# usage: sh run.sh <scratch dir>
set -e
here=$(cd "$(dirname "$0")" && pwd)
mkdir -p "$1" && cd "$1"
cp "$here/main.rs" "$here/ref.go" "$here/gen.py" .
python3 gen.py
rustup run nightly-2026-09-15 rustc --edition 2024 -O -o linemap main.rs
./linemap < inputs.txt > rust.out
printf 'module linemapref\n\ngo 1.24\n' > go.mod
GOFLAGS=-mod=mod go run ref.go < inputs.txt > go.out
cmp rust.out go.out && echo "identical: $(wc -l < rust.out) inputs"
