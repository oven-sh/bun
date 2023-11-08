#!/usr/bin/env bash
set -e

OUTDIR="$1"
TAG="$2"
PKG="$3"

if [ -z "$OUTDIR" ]; then
  echo "Missing outdir"
  exit 1
fi
if [ -z "$TAG" ]; then
  echo "Missing tag"
  exit 1
fi
if [ -z "$PKG" ]; then
  echo "Missing package"
  exit 1
fi


url="https://github.com/oven-sh/WebKit/releases/download/autobuild-$TAG/$PKG.tar.gz"

old_tar_dir="$(dirname "$0")/../.webkit-cache"
tar_dir="$(dirname "$0")/../.cache"
if [ -d "$old_tar_dir" ]; then
  # migration step from the old system
  mkdir "$tar_dir"
  mv "$old_tar_dir"/* "$tar_dir"
  rm -r "$old_tar_dir"
fi

tar="$tar_dir/$PKG-$TAG.tar.gz"

mkdir -p "$OUTDIR"
mkdir -p "$tar_dir"

# TODO: Remove this block, future builds may not include a package.json
if [ -f "$OUTDIR/package.json" ]; then
  read_version=$(grep -o '"version": "[^"]*"' "$OUTDIR/package.json" | sed 's/"version": "\(.*\)"/\1/' 2>/dev/null)
  if [ "$read_version" == "0.0.1-$TAG" ]; then
    echo "$TAG" > "$OUTDIR/.tag"
    exit 0
  fi
fi

if [ -f "$OUTDIR/.tag" ]; then
  read_tag="$(cat "$OUTDIR/.tag")"
  if [ "$read_tag" == "$TAG" ]; then
    exit 0
  fi
fi

rm -rf "$OUTDIR"

if [ ! -f "$tar" ]; then
  echo "-- Downloading WebKit"
  if ! curl -o "$tar" -L "$url"; then
    echo "Failed to download $url"
    exit 1
  fi
fi

tar -xzf "$tar" -C "$(dirname "$OUTDIR")" || (rm "$tar" && exit 1)

echo "$TAG" > "$OUTDIR/.tag"
