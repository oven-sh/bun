// Memory sampling for a leak fixture: a child process that calls the code under test in rounds and
// samples its memory after each. A fixture imports this file and not "harness", which adds 0.8 s to
// the start of a debug build.
import { readFileSync } from "node:fs";

// The `Anonymous:` field of every mapping in /proc/self/smaps, summed.
function anonymousBytes(): number {
  let kilobytes = 0;
  for (const mapping of readFileSync("/proc/self/smaps", "utf8").split("\nAnonymous:").slice(1)) {
    kilobytes += parseInt(mapping);
  }
  return kilobytes * 1024;
}

function readsSmaps(): boolean {
  try {
    return anonymousBytes() > 0;
  } catch {
    return false;
  }
}

/**
 * The resident memory of this process, in bytes. Sample it after Bun.gc(true).
 *
 * On Linux it is the anonymous memory, which the kernel counts from the page tables. That is exact,
 * and it leaves out the pages of the bun binary, which the kernel can evict at any time. The two
 * cheaper sources are not exact:
 * - process.memoryUsage.rss() reads /proc/self/stat. Since Linux 6.2 the kernel keeps that counter
 *   per CPU and adds each CPU's part to the total in batches. On a machine with many cores the
 *   total is off by several MB, and the error changes from one read to the next.
 * - /proc/self/smaps_rollup is the same sum in one read, but Linux 6.1 to 6.9 leave a mapping out
 *   of it each time another thread waits for the mmap lock. On an ASAN build a quarter of the reads
 *   are low, by up to 180 MB. torvalds/linux@6d065f507d82 fixes it in 6.10, 6.9.5 and 6.6.34. The
 *   6.1 series does not have the fix.
 *
 * Elsewhere, and where smaps cannot be read, it is process.memoryUsage.rss(). One source serves the
 * whole run, because the two do not count the same pages.
 */
export const residentBytes: () => number =
  process.platform === "linux" && readsSmaps() ? anonymousBytes : process.memoryUsage.rss;
