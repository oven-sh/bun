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

if [ -f "$OUTDIR/.tag" ]; then
  read_tag="$(cat "$OUTDIR/.tag")"
  if [ "$read_tag" == "$TAG-$PKG" ]; then
    exit 0
  fi
fi

rm -rf "$OUTDIR"

download () {
  local command="$1"
  local retries="$2"
  local options="$-"
  if [[ $options == *e* ]]; then
    set +e
  fi
  $command
  local exit_code=$?
  if [[ $options == *e* ]]; then
    set -e
  fi
  if [[ $exit_code -ne 0 && $retries -gt 0 ]]; then
    download "$command" $(($retries - 1)) 
  else
    return $exit_code
  fi
}

# this is a big download so we will retry 5 times and ask curl to resume
# download from where failure occurred if it fails and is rerun
if [ ! -f "$tar" ]; then
  echo "-- Downloading WebKit"
  if ! download "curl -C - --http1.1 -o $tar.tmp -L $url" 5; then
    echo "Failed to download $url"
    exit 1
  else
    mv $tar.tmp $tar
  fi
fi

tar -xzf "$tar" -C "$(dirname "$OUTDIR")" || (rm "$tar" && exit 1)

# We want to make sure we use the system-version of icucore on macOS
if [ "$(uname)" == "Darwin" ]; then
  # delete the unicode folder from include
  rm -rf "$OUTDIR/include/unicode"
fi

echo "$TAG-$PKG" >"$OUTDIR/.tag"
