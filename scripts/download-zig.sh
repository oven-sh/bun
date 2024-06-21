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

case $(uname -ms) in
'Darwin x86_64')
  target='macos'
  arch='x86_64'
  ;;
'Darwin arm64')
  target='macos'
  arch='aarch64'
  ;;
'Linux aarch64' | 'Linux arm64')
  target='linux'
  arch='aarch64'
  ;;
'Linux x86_64')
  target='linux'
  arch='x86_64'
  ;;
*)
  printf "error: cannot get platform name from '%s'\n" "${unamestr}"
  exit 1
  ;;
esac

url="https://ziglang.org/builds/zig-${target}-${arch}-${zig_version}.tar.xz"
dest="$(pwd)/.cache/zig-${zig_version}.tar.xz"
extract_at="$(pwd)/.cache/zig"

mkdir -p ".cache"

update_repo_if_needed() {
  if [ "$update_repo" == "true" ]; then
    files=(
      build.zig
      Dockerfile
      scripts/download-zig.ps1
      .github/workflows/*
    )

    zig_version_previous=$(grep 'recommended_zig_version = "' "build.zig" | cut -d'"' -f2)

    for file in ${files[@]}; do
      sed -i 's/'"${zig_version_previous}"'/'"${zig_version}"'/g' "$file"
    done

    printf "Zig was updated to ${zig_version}. Please commit new files."
  fi
  # symlink extracted zig to  extracted zig.exe
  # TODO: Workaround for https://github.com/ziglang/vscode-zig/issues/164
  ln -sf "${extract_at}/zig" "${extract_at}/zig.exe"
  chmod +x "${extract_at}/zig.exe"
}

if [ -e "${extract_at}/.version" ]; then
  if [ "$(cat "${extract_at}/.version")" == "${url}" ]; then
    update_repo_if_needed
    exit 0
  fi
fi

if ! [ -e "${dest}" ]; then
  printf -- "-- Downloading Zig v%s\n" "${zig_version}"
  curl -o "$dest" -L "$url"
fi

rm -rf "${extract_at}"
mkdir -p "${extract_at}"
tar -xf "${dest}" -C "${extract_at}" --strip-components=1

echo "${url}" > "${extract_at}/.version"

update_repo_if_needed
