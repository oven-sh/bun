#!/usr/bin/env bash
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

WEBKIT_TAG=$(grep 'set(WEBKIT_TAG' "CMakeLists.txt" | awk '{print $2}' | cut -f 1 -d ')')
if [ -z "${WEBKIT_TAG}" ]; then
    echo "Could not find WEBKIT_TAG in CMakeLists.txt"
    exit 1
fi

echo "Setting WebKit submodule to ${WEBKIT_TAG}"
cd src/bun.js/WebKit
git checkout "${WEBKIT_TAG}"