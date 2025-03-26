# libuv copied headers

These are copied headers from libuv. They are used by `uv-posix-polyfills.h`. Most of them are stubbed to just throw an error as they are not supported in Bun.

libuv commit hash: bb706f5fe71827f667f0bce532e95ce0698a498d

## Generating symbol stubs

right now we using claude code to do this since this is mostly a one off task done infrequently, documenting the process here in case we need to do it again:

1. Clone libuv repo using the above hash
2. Use the following command to get the list of symbols: `llvm-nm -g libuv.dylib | grep _uv &> symbols.txt`
3. Update `src/symbol.txt` and `src/linker.lds`
4. Use the CLAUDE.md prompt to generate the stubs (you will need to create a list of symbols for it to go one by one)

in the future we should write some code to:

1. amalgamate all the libuv headers into a single file using: https://github.com/rindeal/Amalgamate
2. use libclang or some parser to parse function declarations and variable declarations
3. generate the stubs copy-pasting the declaration code that we parsed
