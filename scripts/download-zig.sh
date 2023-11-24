#!/usr/bin/env bash
set -e
cd $(dirname $(dirname "${BASH_SOURCE[0]}"))

zig_version=""
if [ -n "$1" ]; then
  zig_version="$1"
  update_repo=true

  if [ "$zig_version" == "master" ]; then
    zig_version=$(curl -fsSL https://ziglang.org/download/index.json | jq -r .master.version)
  fi
else
  zig_version=$(grep 'recommended_zig_version = "' "build.zig" | cut -d'"' -f2)
fi

unamestr=$(uname)
if [[ "$unamestr" == 'Linux' ]]; then
  platform='linux'
elif [[ "$unamestr" == 'Darwin' ]]; then
  platform='macos'
else
  printf "error: cannot get platform name from '%s'\n" "${unamestr}"
  exit 1
fi

# i dont think this works
arch=$(uname -m)
if [[ "$arch" == *'arm64'* ]]; then
  arch="aarch64"
elif [[ "$arch" == *"x86_64"* ]]; then
  arch="x86_64"
fi

url="https://ziglang.org/builds/zig-${platform}-${arch}-${zig_version}.tar.xz"
dest=".cache/zig-${zig_version}.tar.xz"
extract_at=".cache/zig"

update_repo_if_needed() {
  if [ "$update_repo" == "true" ]; then
    files=(
      build.zig
      Dockerfile

      .github/workflows/*

      docs/project/contributing.md
      docs/project/building-windows.md
    );

    zig_version_previous=$(grep 'recommended_zig_version = "' "build.zig" | cut -d'"' -f2)

    for file in ${files[@]}; do
      sed -i '' 's/'"${zig_version_previous}"'/'"${zig_version}"'/g' "$file"
    done

    printf "Zig was updated to ${zig_version}. Please commit new files."
  fi
}

if [ -e "${extract_at}/.version" ]; then
  if [ "$(cat "${extract_at}/.version")" == "${zig_version}" ]; then
    update_repo_if_needed
    exit 0
  fi
fi

if ! [ -e "${dest}" ]; then
  printf "Downloading Zig v%s\n" "${zig_version}"
  curl -o "$dest" -L "$url"
fi

rm -rf "${extract_at}"
mkdir "${extract_at}"
tar -xzf "${dest}" -C "${extract_at}" --strip-components=1

echo "${zig_version}" > "${extract_at}/.version"

update_repo_if_needed