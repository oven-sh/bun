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

## Results (Windows 11 arm64, build 26100)

The storage type and the core count of the machine were not recorded.

### Raw syscall microbenchmark (`ioring_bench.c`, outside Bun)

512 files × 2 KB, 20 iterations, warm page cache, 4-thread pool:

| scenario                               | 4-thread pool | ioring         |
| -------------------------------------- | ------------- | -------------- |
| cached reads                           | 0.50 ms/iter  | 1.46 ms/iter   |
| cached reads, pool + completion hop    | 0.63 ms/iter  | 1.46 ms/iter   |
| unbuffered reads (sync handle)         | 18.6 ms/iter  | 64.0 ms/iter   |
| unbuffered reads (`FILE_FLAG_OVERLAPPED`) | n/a        | **3.5 ms/iter** |
| cached writes                          | 2.3 ms/iter   | **1.5 ms/iter** |

What the table shows, and what it does not show:

- Cached reads: the ring takes about as long as a single-threaded `ReadFile`
  loop (1.25 ms/iter). The 4-thread pool is faster. `FILE_FLAG_OVERLAPPED`
  makes no difference here (1.60 ms/iter with the flag).
- Unbuffered reads on a handle without `FILE_FLAG_OVERLAPPED`: the ring takes
  the same time as the single-threaded loop (65 ms/iter). The benchmark did
  not measure whether `SubmitIoRing` blocks the calling thread for that time.
- Unbuffered reads with `FILE_FLAG_OVERLAPPED`: the ring is ~5× faster than a
  4-thread pool of blocking reads. The benchmark has no row for plain
  overlapped `ReadFile` with IOCP, so it does not show that the ring is the
  cause.
- Cached writes: do not use this row. The pool timing includes 512
  `SetFilePointer` calls per iteration and the ring timing does not. The
  end-to-end table below shows the opposite result.
- `FILE_FLAG_NO_BUFFERING` is a stand-in for a cold cache. No run used a real
  cold cache.
- The statement that `uv_fs_open` does not set `FILE_FLAG_OVERLAPPED` was not
  checked against the libuv source.

### End-to-end Bun `fs.read`/`fs.write` (this benchmark)

Release build, batched `SubmitIoRing` via `uv_prepare_t`, 3 runs averaged:

| scenario                      | uv threadpool | ioring    | delta       |
| ----------------------------- | ------------- | --------- | ----------- |
| 512 × 2 KB reads (cached)     | 0.88 ms       | 2.21 ms   | 2.5× slower |
| 64 MB seq read, 64 KB chunks  | 58.5 ms       | 59.1 ms   | ~same       |
| 512 × 2 KB writes             | 0.77 ms       | 2.28 ms   | 3.0× slower |

All 426 tests in `test/js/node/fs/fs.test.ts` pass with the flag enabled. Only
positional async `fs.read`/`fs.write` calls reach the ring, so most of those
tests do not exercise it.

## Conclusion

Measured: for positional `fs.read`/`fs.write` on handles that are already
open, with a warm cache, small concurrent reads and writes are 2.5× to 3×
slower through the ring than through the libuv threadpool. Awaited sequential
64 KB reads take the same time.

Not measured:

- `fs.readFile`/`fs.writeFile`. They do not use the ring in this branch.
- Concurrent `readFile` of many small files (open, read, close per file).
- An end-to-end run with a cold cache or with `FILE_FLAG_OVERLAPPED`.
- Registered buffers and registered file handles.
- Windows 11 x64.

Known defects in the flag-on path:

- The ring is one process-wide singleton. Each thread has its own libuv loop,
  so a Worker that calls `fs.read` uses the ring of another thread.
- `flush()` ignores a failed `SubmitIoRing`. The affected promises never
  settle.
- If `RegisterWaitForSingleObject` fails in `FsIoRing::new`, the started
  `uv_prepare_t` keeps a pointer to the freed ring.
- The HRESULT to errno mapping has no test.

References:
- Yarden Shafir, "I/O Rings - When One I/O Operation is Not Enough",
  windows-internals.com
- Yarden Shafir, "IoRing vs. io_uring: a comparison of Windows and Linux
  implementations", windows-internals.com
- `ioringapi.h` / `ntioring_x.h` in the Windows SDK
