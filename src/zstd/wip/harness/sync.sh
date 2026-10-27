#!/bin/sh
# A copy of the crate with everything public, so that the harness can reach what Bun does not.
set -e
src=${1:-/root/repos/oven-sh/bun/src/zstd}
dst=$(dirname "$0")/zstd-pub
rm -rf "$dst"
mkdir -p "$dst"
cp -r "$src"/. "$dst"/
find "$dst" -name '*.rs' -exec sed -i -E 's/pub\((crate|super)\) /pub /g; s/^mod /pub mod /; s/^    fn reset_session/    pub fn reset_session/; s/^(const |static |fn |struct |enum |type )/pub \1/; s/^use (common|decompress|compress)::/pub use \1::/' {} +
cat > "$dst/Cargo.toml" <<EOT
[package]
name = "bun_zstd"
version = "0.0.0"
edition = "2024"
[lib]
path = "lib.rs"
[dependencies]
strum = { version = "0.26", features = ["derive"] }
bun_pod = { path = "$(dirname "$src")/pod", features = ["alloc"] }
EOT
