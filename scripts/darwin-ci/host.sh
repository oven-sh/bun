#!/bin/bash
# First contact with a freshly imaged host: installs brew and bun, then hands off to main.ts provision.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
sudo -n true 2>/dev/null || { echo "needs passwordless sudo for $(whoami)"; exit 1; }

# https://github.com/Homebrew/install/commits/master
brew_installer_commit=a34ae4ee9151cbce4c3b33bca7043a972b7ae9a5
brew_installer_sha256=12479a24be3f5307eecac7cde670fad7118640f031229e964f544b1367b52a41
# https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/SHASUMS256.txt
bun_version=1.3.14
bun_sha256_aarch64=d8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620
bun_sha256_x64=4183df3374623e5bab315c547cfa0974533cd457d86b73b639f7a87974cd6633

if [ "$(uname -m)" = arm64 ]; then prefix=/opt/homebrew; target=aarch64; bun_sha256=$bun_sha256_aarch64; else prefix=/usr/local; target=x64; bun_sha256=$bun_sha256_x64; fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

fetch() { # <url> <file> <sha256>
  curl -fsSL -o "$2" "$1"
  echo "$3  $2" | shasum -a 256 -c - >/dev/null || { echo "checksum mismatch for $1"; exit 1; }
}

if [ ! -x "$prefix/bin/brew" ]; then
  fetch "https://raw.githubusercontent.com/Homebrew/install/$brew_installer_commit/install.sh" "$tmp/brew-install.sh" "$brew_installer_sha256"
  NONINTERACTIVE=1 /bin/bash "$tmp/brew-install.sh"
fi
eval "$("$prefix/bin/brew" shellenv)"

if [ ! -x /usr/local/bin/bun ]; then
  fetch "https://github.com/oven-sh/bun/releases/download/bun-v$bun_version/bun-darwin-$target.zip" "$tmp/bun.zip" "$bun_sha256"
  unzip -q "$tmp/bun.zip" -d "$tmp"
  sudo mkdir -p /usr/local/bin
  sudo install -m 755 "$tmp/bun-darwin-$target/bun" /usr/local/bin/bun
fi

rm -rf "$tmp"; trap - EXIT
exec /usr/local/bin/bun "$here/main.ts" provision "$@"
