#!/bin/sh

# This script builds a Docker image for building and testing Bun on Linux.

execute() {
  echo "$ $@" >&2
  if ! "$@"; then
    echo "Command failed: $@" >&2
    exit 1
  fi
}

error() {
  echo "error: $@" >&2
  exit 1
}

script_version() {
  path="../scripts/bootstrap.sh"
  if ! [ -f "$path" ]; then
    error "Script not found: $path"
  fi
  cat "$path" | grep 'v=' | sed 's/v=\"//;s/\"//' | head -n 1
}

build_docker_image() {
  case "$1" in
  x64 | amd64 | x86_64)
    arch="x64"
    platform="linux/amd64"
    ;;
  aarch64 | arm64)
    arch="aarch64"
    platform="linux/arm64"
    ;;
  *)
    error "Unsupported architecture: $1"
    ;;
  esac
  
  case "$2" in
  debian | ubuntu | amazonlinux | alpine)
    distro="$2"
    ;;
  *)
    error "Unsupported distro: $2"
    ;;
  esac

  release="$3"
  release_tag="$(echo "$release" | sed 's/\.//')"
  tag="linux-$arch-$distro-$release_tag-v$(script_version)"

  execute docker build ../ \
    --progress plain \
    --platform "$platform" \
    --tag "$tag" \
    --file linux/Dockerfile \
    --build-arg "IMAGE=docker.io/library/$distro:$release"

  if [ "$distro" = "alpine" ]; then
    script="mkdir /workspace && cd /workspace && git clone --single-branch --depth 1 https://github.com/oven-sh/bun bun && cd bun && bun run build:ci && node scripts/runner.node.mjs --exec-path ./build/release-ci/bun || exit 0"
  else
    script="mkdir /workspace && cd /workspace && git clone --single-branch --depth 1 https://github.com/oven-sh/bun bun && cd bun && node scripts/runner.node.mjs || exit 0"
  fi

  execute docker run \
    --rm \
    -e "CI=${CI:-"false"}" \
    -e "GITHUB_ACTIONS=${GITHUB_ACTIONS:-"false"}" \
    -e "GITHUB_OUTPUT=/github/output" \
    -v "${GITHUB_OUTPUT:-"/dev/null"}:/github/output" \
    -e "GITHUB_STEP_SUMMARY=/github/step-summary" \
    -v "${GITHUB_STEP_SUMMARY:-"/dev/null"}:/github/step-summary" \
    -v "/var/run/docker.sock:/var/run/docker.sock" \
    -t "$tag" \
    /bin/sh -c "$script"
}

main() {
  arch="${1:-"$(uname -m)"}"
  distro="${2:-"debian"}"
  release="${3:-"11"}"

  build_docker_image "$arch" "$distro" "$release"
}

main "$@"
