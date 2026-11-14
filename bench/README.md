```bash
# run from this directory. bench/ has its own package.json and bun.lock,
# the repo root does not install benchmark dependencies such as mitata.
bun install

# a directory that declares its own dependencies (json5, scanner, xml,
# yaml, ...) needs `bun install` in that directory too.

bun run ffi
bun run log
bun run gzip
bun run async
bun run sqlite

# to use custom version of bun/deno/node binary
BUN=path/to/bun bun run ffi
# or edit .env file
```
