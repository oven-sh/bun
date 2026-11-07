# jpegdiff

Compares `src/jpeg` (`bun_jpeg`) with libjpeg-turbo 3.2.0 as Bun linked it. Temporary: it is here while the replacement
is under review, so that whoever works on it has the same tools, and goes away before the merge.

Set-up, on x86-64 Linux with clang, nasm and llvm-ar:

1. `git clone https://github.com/libjpeg-turbo/libjpeg-turbo /root/ref/libjpeg-turbo` and check out
   `c85e6b905bf237038faa936dab160ebfc5da0344`.
2. Copy it to `/root/ref/libjpeg-turbo-patched` and apply what Bun applied, from the commit before the removal:
   `git show 92e819d8:patches/libjpeg-turbo/<file>` for each file of `git ls-tree 92e819d8 patches/libjpeg-turbo/`
   (`scripts/build/deps/libjpeg-turbo.ts` at that commit says how: two patches and the `jbun_stubs.c` overlay).
3. `mkdir -p /root/ref/build && cp -r include /root/ref/build/` (the headers that the build generated), then
   `./build-ref.sh`, which writes `/root/ref/build/libtjref.a`.
4. `vendor/highway` has to be there, which it is after any build of Bun (`scripts/build/deps/highway.ts` has the commit and
   two patches): `build.rs` compiles `src/jsc/bindings/highway_jpeg.cpp`, the kernels that `bun_jpeg` calls, with `clang++-23`.
5. `cargo build --release` here. That profile keeps overflow checks and debug assertions; `--profile fast` is for timing.

Programs:

- `jpegdiff <file or dir>...`: decodes at every scale from 8/8 to 1/8 with both and compares pixels, size, ICC profile,
  whether it fails, and at which stage. A stream that `bun_jpeg` refuses for a redundant scan, which libjpeg-turbo
  decodes, is counted as `redundant-scan` and not compared.
- `mutate <dir>... --iters N --seed S --threads T`: the same for random mutations of the files. Failures are saved to
  `/root/ref/corpus/fail`.
- `encfuzz --iters N --seed S --threads T --max-dim D`: encodes generated images with both and compares the bytes.
- `encspecial`: encoder cases that random images do not reach.
- `bench [file.jpg]...`: times both.
- `tools/kernels.sh`: checks the kernels alone, for every target of this machine and under qemu for those of arm64.

`HWY_TARGET=SSSE3` (or `AVX2`) in the environment makes any of the programs use the kernels for that target and not
for the best one that the CPU has.

`src/reference.rs` replays what `src/runtime/image/codec_jpeg.rs` did at 92e819d8. `tools/gen_corpus.sh` makes the seed
corpus with libjpeg-turbo's `cjpeg` and `jpegtran`. `regress/` holds inputs that once differed. The reference takes
`JSIMD_FORCENONE=1` and `JSIMD_FORCESSE2=1` in the environment.
