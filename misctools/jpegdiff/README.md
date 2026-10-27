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
4. `cargo build --release` here. That profile keeps overflow checks and debug assertions; `--profile fast` is for timing.

Programs:

- `jpegdiff <file or dir>...`: decodes at every scale from 8/8 to 1/8 with both and compares pixels, size, ICC profile,
  whether it fails, at which stage, and whether there was a warning.
- `mutate <dir>... --iters N --seed S --threads T`: the same for random mutations of the files. Failures are saved to
  `/root/ref/corpus/fail`.
- `encfuzz --iters N --seed S --threads T --max-dim D`: encodes generated images with both and compares the bytes.
- `encspecial`: encoder cases that random images do not reach.
- `bench [file.jpg]...`: times both.

`src/reference.rs` replays what `src/runtime/image/codec_jpeg.rs` did at 92e819d8. `tools/gen_corpus.sh` makes the seed
corpus with libjpeg-turbo's `cjpeg` and `jpegtran`. `regress/` holds inputs that once differed. The reference takes
`JSIMD_FORCENONE=1` and `JSIMD_FORCESSE2=1` in the environment.
