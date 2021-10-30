# Upcoming release

- [Bun.js] Enable `SharedArrayBuffer` and Atomics

# 0.41.0

- [bun run] `bun run ./file.js` now supports running JavaScript, TS, TSX, and JSX files with Bun.js. Before, it would say `"error: Missing script"`. If there is a `#!` shebang at the start of the file, the file will not be run with Bun.js. You can still use Node & Deno with `bun run`, that works the same as before.
- [Bun.js] Top-level await
- [Bun.js] `performance.now()` is implemented
- [Bun.js] `fetch()` is fixed
- [.env loader] Pass through process environment variable values verbatim instead of treating them similarly to .env files. `.env` needs special parsing because quotes are optional, values are potentially nested, and it's whitespace sensitive. This probably also improves the performance of loading process environment variables, but that was already pretty quick so it probably doesn't matter.
