# Differential tests of `bun_brotli` against the C library

Drives `src/brotli` and google/brotli v1.2.1 in lock step, in one process, and compares every call: return value, input
consumed, output produced, the bytes, `has_more_output`, `is_finished`, error code.

```sh
git init brotli-ref && git -C brotli-ref remote add origin https://github.com/google/brotli
git -C brotli-ref fetch --depth 1 origin db24a98aed38a16de78cc05ca15cdd8dc2a0d92d && git -C brotli-ref checkout FETCH_HEAD
CC=clang AR=llvm-ar ./build-cref.sh       # builds cref/libbrotliref.a
RUSTFLAGS=--cap-lints=warn cargo build    # overflow checks and debug assertions on; add --release for speed
target/debug/harness enc-fuzz 1 1000 4194304 4095
```

The reference is built with `-ffp-contract=off`, and with `cref.patch`, which fixes an out of bounds write in the encoder that
cannot be reproduced.

Subcommands: `testdata`, `dec-fuzz <seed> <iterations> <max length>`, `dec-garbage <seed> <iterations>`,
`enc-fuzz <seed> <iterations> <max length> <bit mask of qualities>`, `enc-files <mask> <lgwin>`, `enc-one <file> <param>=<value>...`,
`bench-dec` / `bench-enc <file> <quality> <lgwin> <repetitions>`, `bench-small <file> <length> <quality> <lgwin> <repetitions>`.
Every iteration is derived from its seed, so `<subcommand> <seed> 1 ...` reproduces a failure. `TRACE=1` prints every encoder
call. Failing inputs are saved in the temporary directory.
