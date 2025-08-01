# libuv copied headers

These are copied headers from libuv which are used by `bun uv-posix-stubs` to generate stubs which crash with a helpful error message when a NAPI
module tries to access a libuv function which is not supported in Bun.

libuv commit hash: bb706f5fe71827f667f0bce532e95ce0698a498d

## Generating symbol stubs

1. Clone libuv repo using the above hash
2. Use the following command to get the list of symbols: `llvm-nm -g libuv.dylib | grep _uv &> symbols.txt`, you're gonna have to clean them up a bit this is not automated sorry ( ͡° ͜ʖ ͡°)
3. Update `src/symbol.txt` and `src/linker.lds` and `src/symbols.dyn`
4. Update the `symbols` list in `generate_uv_posix_stubs.ts`
5. Run `bun uv-posix-stubs`
