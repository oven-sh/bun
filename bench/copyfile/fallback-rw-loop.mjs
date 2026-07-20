// Benchmark the read/write fallback copy loop (the path taken when the
// kernel-side fast paths are unavailable). On Linux, setting
// BUN_CONFIG_DISABLE_COPY_FILE_RANGE=1 makes Bun.write(file, file) go
// straight to NodeFS::copy_file_using_read_write_loop.
//
// Cold-cache measurement: each iteration evicts the source from the page
// cache via posix_fadvise(DONTNEED) so readahead behaviour is observable.
//
//   BUN_CONFIG_DISABLE_COPY_FILE_RANGE=1 bun bench/copyfile/fallback-rw-loop.mjs
import fs from "node:fs";
import { dlopen, FFIType } from "bun:ffi";
import { tmpdir } from "node:os";
import { join } from "node:path";

const libc = dlopen(process.platform === "darwin" ? "libc.dylib" : "libc.so.6", {
  posix_fadvise: {
    args: [FFIType.i32, FFIType.i64, FFIType.i64, FFIType.i32],
    returns: FFIType.i32,
  },
  fdatasync: { args: [FFIType.i32], returns: FFIType.i32 },
});
const POSIX_FADV_DONTNEED = 4;

function evict(path) {
  let fd;
  try {
    fd = fs.openSync(path, "r+");
  } catch {
    return;
  }
  libc.symbols.fdatasync(fd);
  libc.symbols.posix_fadvise(fd, 0n, 0n, POSIX_FADV_DONTNEED);
  fs.closeSync(fd);
}

if (!process.env.BUN_CONFIG_DISABLE_COPY_FILE_RANGE) {
  console.error("note: BUN_CONFIG_DISABLE_COPY_FILE_RANGE not set; fast paths will be used");
}

for (const mb of [1, 64, 512]) {
  const src = join(tmpdir(), `cp-fallback-src-${mb}m.bin`);
  const dst = join(tmpdir(), `cp-fallback-dst-${mb}m.bin`);
  if (!fs.existsSync(src) || fs.statSync(src).size !== mb * 1048576) {
    const chunk = Buffer.allocUnsafe(1048576);
    for (let i = 0; i < chunk.length; i++) chunk[i] = i & 0xff;
    const fd = fs.openSync(src, "w");
    for (let i = 0; i < mb; i++) fs.writeSync(fd, chunk);
    fs.closeSync(fd);
  }

  const iters = 8;
  const times = [];
  for (let i = 0; i < iters; i++) {
    evict(src);
    evict(dst);
    try {
      fs.unlinkSync(dst);
    } catch {}
    const t0 = performance.now();
    await Bun.write(Bun.file(dst), Bun.file(src));
    const t1 = performance.now();
    times.push(t1 - t0);
  }
  times.sort((a, b) => a - b);
  const min = times[0];
  const med = times[iters >> 1];
  console.log(
    `${mb} MiB: min=${min.toFixed(2)}ms med=${med.toFixed(2)}ms (${(mb / (min / 1000)).toFixed(0)} MiB/s peak)`,
  );
  try {
    fs.unlinkSync(dst);
  } catch {}
}
