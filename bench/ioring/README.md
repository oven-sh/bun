# Windows I/O Ring backend for async `node:fs`

Exploratory backend that routes async `fs.read`/`fs.write` through
`CreateIoRing`/`BuildIoRingReadFile`/`BuildIoRingWriteFile` (KernelBase,
Windows 11 build 22000+; writes need 22621+) instead of the libuv threadpool.
Gated behind `BUN_FEATURE_FLAG_WINDOWS_IORING=1`. See
`src/sys/windows/ioring.rs` for the integration.

## Running

```powershell
bun run build:release bench/ioring/fs-read-write.mjs
$env:BUN_FEATURE_FLAG_WINDOWS_IORING=1; bun run build:release bench/ioring/fs-read-write.mjs
```

## Results (Windows 11 24H2 arm64, build 26100, NVMe SSD)

### Raw syscall microbenchmark (`ioring_bench.c`, outside Bun)

512 files × 2 KB, 20 iterations, warm page cache, 4-thread pool:

| scenario                               | 4-thread pool | ioring         |
| -------------------------------------- | ------------- | -------------- |
| cached reads                           | 0.50 ms/iter  | 1.46 ms/iter   |
| cached reads, pool + completion hop    | 0.63 ms/iter  | 1.46 ms/iter   |
| unbuffered reads (sync handle)         | 18.6 ms/iter  | 64.0 ms/iter   |
| unbuffered reads (`FILE_FLAG_OVERLAPPED`) | n/a        | **3.5 ms/iter** |
| cached writes                          | 2.3 ms/iter   | **1.5 ms/iter** |

Key observation: an I/O ring processes submissions **serially** when the file
handle was opened without `FILE_FLAG_OVERLAPPED`, eliminating any I/O
parallelism. `uv_fs_open` (and therefore `fs.open`) does not set that flag, so
for `fs.read(fd, ...)` on user-opened descriptors the ring is strictly slower
than the threadpool. With an overlapped handle the ring gains real kernel-side
parallelism and is ~5× faster than a 4-thread pool on uncached reads.

### End-to-end Bun `fs.read`/`fs.write` (this benchmark)

Release build, batched `SubmitIoRing` via `uv_prepare_t`, 3 runs averaged:

| scenario                      | uv threadpool | ioring    | delta       |
| ----------------------------- | ------------- | --------- | ----------- |
| 512 × 2 KB reads (cached)     | 0.88 ms       | 2.21 ms   | 2.5× slower |
| 64 MB seq read, 64 KB chunks  | 58.5 ms       | 59.1 ms   | ~same       |
| 512 × 2 KB writes             | 0.77 ms       | 2.28 ms   | 3.0× slower |

All 426 tests in `test/js/node/fs/fs.test.ts` pass with the flag enabled.

## Conclusion

For the current `fs.read`/`fs.write` surface, where handles come from
`uv_fs_open` without `FILE_FLAG_OVERLAPPED`, the I/O ring backend is not a
win: cached reads regress ~2-3× and uncached reads regress ~3.4×. Writes see
a ~1.5× improvement.

The ring only outperforms the threadpool when Bun itself controls the open
flags (e.g. `fs.readFile(path)` could open with `FILE_FLAG_OVERLAPPED`), and
only on cold-cache workloads. That scope is narrower than the brief's original
target and the warm-cache regression would still apply, so the backend stays
behind a feature flag for further experimentation rather than being enabled by
default.

References:
- Yarden Shafir, "I/O Rings - When One I/O Operation is Not Enough",
  windows-internals.com
- Yarden Shafir, "IoRing vs. io_uring: a comparison of Windows and Linux
  implementations", windows-internals.com
- `ioringapi.h` / `ntioring_x.h` in the Windows SDK
