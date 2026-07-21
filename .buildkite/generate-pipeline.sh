#!/bin/sh
# Generate the Buildkite pipeline (.buildkite/ci.mjs) under the spec-pinned
# Node.js, independent of whatever node the CI agent has installed.
#
# ci.mjs imports the CI image system's .ts modules directly (node's
# built-in type stripping, node >= 25). The agent that runs this step is a
# standing host whose node is not managed by anything in this repo, so
# instead of depending on it, this shim downloads exactly the Node.js pinned
# in scripts/build/ci/spec.ts (the same version baked onto every CI image)
# and runs ci.mjs under it. The version is READ from spec.ts, not restated
# here, so bumping node stays a one-line spec edit.
#
# POSIX sh + curl/tar only: this must run on the bare agent before any tool
# is available, exactly like the linux bake shim (scripts/build/ci/delivery.ts).

set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
spec="$repo_root/scripts/build/ci/spec.ts"

# The pinned version is the `version` field of `export const nodejs` in
# spec.ts. Read it from the single source of truth.
node_version=$(sed -n '/^export const nodejs/,/version:/ s/.*version: "\([0-9.]*\)".*/\1/p' "$spec" | head -n 1)
if [ -z "$node_version" ]; then
  echo "generate-pipeline: could not read nodejs.version from $spec" >&2
  exit 1
fi

# Match the tarball to THIS host (the standing agent may be darwin or
# linux, x64 or arm64 — resolve it, don't assume it).
case "$(uname -s)" in
  Linux) node_platform="linux" ;;
  Darwin) node_platform="darwin" ;;
  *) echo "generate-pipeline: unsupported OS $(uname -s)" >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) node_cpu="x64" ;;
  arm64|aarch64) node_cpu="arm64" ;;
  *) echo "generate-pipeline: unsupported CPU $(uname -m)" >&2; exit 1 ;;
esac

folder="node-v${node_version}-${node_platform}-${node_cpu}"
cache_dir="${HOME:-/tmp}/.cache/bun-ci-node"
node_bin="$cache_dir/$folder/bin/node"

if [ ! -x "$node_bin" ]; then
  url="https://nodejs.org/dist/v${node_version}/${folder}.tar.gz"
  echo "--- Fetching Node.js ${node_version} for the pipeline generator (${node_platform} ${node_cpu})"
  echo "    $url"
  mkdir -p "$cache_dir"
  tmp_tarball="$cache_dir/${folder}.tar.gz.$$"
  # curl if present, else wget (mirrors the linux bake shim).
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL --retry 5 --retry-all-errors "$url" -o "$tmp_tarball"
  else
    wget -q --tries=5 -O "$tmp_tarball" "$url"
  fi
  tar -xzf "$tmp_tarball" -C "$cache_dir"
  rm -f "$tmp_tarball"
fi

echo "--- Generating pipeline with $("$node_bin" --version) (spec-pinned; agent's own node is not used)"
cd "$repo_root"
exec "$node_bin" .buildkite/ci.mjs "$@"
