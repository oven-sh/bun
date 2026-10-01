# libuv's names and error numbers

Bun does not link libuv on any platform. It exports every `uv_*` function all the same, so that a NAPI module which uses one loads: the handful Bun implements (`uv-polyfills.c`), and a stub for each of the others (`uv-stubs.c`) which crashes with a helpful error message when it is called.

`uv/errno.h` is copied from libuv. It has libuv's error numbers, which are what `err.errno` is on Windows.

libuv commit hash: bb706f5fe71827f667f0bce532e95ce0698a498d

## Generating symbol stubs

1. Clone libuv repo using the above hash
2. Use the following command to get the list of symbols: `llvm-nm -g libuv.dylib | grep _uv &> symbols.txt`, you're gonna have to clean them up a bit this is not automated sorry ( ͡° ͜ʖ ͡°)
3. Update the `symbols` list in `generate_uv_stubs_constants.ts` (`polyfills` lists the functions Bun implements itself)
4. Run `bun uv-stubs`. It regenerates `src/jsc/bindings/uv-stubs.c` and `test/napi/uv-stub-stuff/plugin.c`, and rewrites the `uv_*` names in `src/symbols.def`, `src/symbols.txt`, `src/linker.lds` and `src/linker-freebsd.lds` when they differ from the lists
