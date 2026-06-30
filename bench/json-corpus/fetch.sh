#!/usr/bin/env bash
# Fetch the JSON benchmark fixture corpus: real package.json files and real
# npm registry API responses (both abbreviated install-v1 manifests, which is
# what `bun install` fetches, and full packuments).
#
# package.json fixtures are version-pinned. Manifests/packuments are a whole
# publish history, which the registry only serves live (no snapshot URL), so
# they drift; the gitignored corpus is only compared within one checkout.
set -euo pipefail
cd "$(dirname "$0")"

ACCEPT_ABBREV='Accept: application/vnd.npm.install-v1+json'

# package.json files (pretty-printed, human-authored shape)
pkg() { curl -fsSL "https://unpkg.com/$1@$2/package.json" -o "pkgjson-$1.json"; echo "pkgjson-$1.json"; }
pkg express 4.19.2
pkg react 18.3.1
pkg typescript 5.5.4
pkg webpack 5.93.0
pkg eslint 9.8.0
pkg axios 1.7.3
pkg next 14.2.5
pkg vite 5.3.5

# Abbreviated registry manifests (what `bun install` actually parses, minified)
abbrev() { curl -fsSL -H "$ACCEPT_ABBREV" "https://registry.npmjs.org/$1" -o "manifest-abbrev-$2.json"; echo "manifest-abbrev-$2.json"; }
abbrev is-number is-number
abbrev express express
abbrev react react
abbrev lodash lodash
abbrev typescript typescript
abbrev next next
abbrev @types/node types-node
abbrev @babel/core babel-core

# Full packuments (largest realistic payloads; `bun audit` / `bun pm view` shape)
full() { curl -fsSL "https://registry.npmjs.org/$1" -o "packument-full-$2.json"; echo "packument-full-$2.json"; }
full express express
full axios axios

# huge real-world manifests bun install parses constantly
abbrev drizzle-orm drizzle-orm
abbrev drizzle-kit drizzle-kit

ls -la
