# libuv copied headers

These are copied headers from libuv which are used by `bun uv-stubs` to generate stubs which crash with a helpful error message when a NAPI
module tries to access a libuv function which is not supported in Bun.

libuv commit hash: 5152db2cbfeb5582e9c27c5ea1dba2cd9e10759b (v1.51.0)

## Generating symbol stubs

1. Clone libuv repo using the above hash
2. Use the following command to get the list of symbols: `llvm-nm -g libuv.dylib | grep _uv &> symbols.txt`, you're gonna have to clean them up a bit this is not automated sorry ( ͡° ͜ʖ ͡°)
3. Update `src/symbols.txt`, `src/linker.lds`, `src/linker-freebsd.lds` and `src/symbols.def`
4. Update the `symbols` list in `generate_uv_stubs_constants.ts`
5. Run `bun install` in this directory, then `bun uv-stubs`
