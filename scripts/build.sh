#!/bin/bash

set -eo pipefail

build_path="build"
configure_args=()
build_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    -B|--build)
      build_path="$2"
      shift 2
      ;;
    -S*|-C*|-D*|-U*|-G*|-T*|-A*|-W*|--fresh|--trace*|--log-level*|--help*)
      configure_args+=("$1")
      shift
      ;;
    *)
      build_args+=("$1")
      shift
      ;;
  esac
done

set -x

cmake -B "$build_path" -GNinja "${configure_args[@]}"
cmake --build "$build_path" "${build_args[@]}"
