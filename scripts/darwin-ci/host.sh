#!/bin/bash
# First contact with a freshly imaged host: installs brew and bun, then hands off to main.ts provision.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
sudo -n true 2>/dev/null || { echo "needs passwordless sudo for $(whoami)"; exit 1; }

if [ "$(uname -m)" = arm64 ]; then prefix=/opt/homebrew; target=aarch64; else prefix=/usr/local; target=x64; fi

if [ ! -x "$prefix/bin/brew" ]; then
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$("$prefix/bin/brew" shellenv)"

if [ ! -x /usr/local/bin/bun ]; then
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/bun.zip" "https://github.com/oven-sh/bun/releases/latest/download/bun-darwin-$target.zip"
  unzip -q "$tmp/bun.zip" -d "$tmp"
  sudo mkdir -p /usr/local/bin
  sudo install -m 755 "$tmp/bun-darwin-$target/bun" /usr/local/bin/bun
  rm -rf "$tmp"
fi

exec /usr/local/bin/bun "$here/main.ts" provision "$@"
