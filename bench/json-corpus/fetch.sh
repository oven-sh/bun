#!/usr/bin/env bash
# Fetch the JSON benchmark fixture corpus: real package.json files plus npm registry responses
# (abbreviated install-v1 manifests and full packuments). Gitignored; only compared within a checkout.
set -euo pipefail
cd "$(dirname "$0")"

ACCEPT_ABBREV='Accept: application/vnd.npm.install-v1+json'

pkg() { curl -fsSL "https://unpkg.com/$1@$2/package.json" -o "pkgjson-$1.json"; echo "pkgjson-$1.json"; }
pkg express 4.19.2
pkg react 18.3.1
pkg typescript 5.5.4
pkg webpack 5.93.0
pkg eslint 9.8.0
pkg axios 1.7.3
pkg next 14.2.5
pkg vite 5.3.5

abbrev() { curl -fsSL -H "$ACCEPT_ABBREV" "https://registry.npmjs.org/$1" -o "manifest-abbrev-$2.json"; echo "manifest-abbrev-$2.json"; }
abbrev is-number is-number
abbrev express express
abbrev react react
abbrev lodash lodash
abbrev typescript typescript
abbrev next next
abbrev @types/node types-node
abbrev @babel/core babel-core

full() { curl -fsSL "https://registry.npmjs.org/$1" -o "packument-full-$2.json"; echo "packument-full-$2.json"; }
full express express
full axios axios

abbrev drizzle-orm drizzle-orm
abbrev drizzle-kit drizzle-kit

ls -la
