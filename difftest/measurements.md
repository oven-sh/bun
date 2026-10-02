# Measurements for PR #41750, hybrid design (candidate d3baa9d7a3 vs merge base bf42a525d5)

Release builds of both from the same tree and toolchain (linux-x64). The binaries and some helper scripts were
lost with a container; the numbers below are the recorded results. Helper scripts that survive are in this
directory (st.c tracer, sc.c counter, mkshapes.py).
perf, valgrind, strace and bloaty are not installed; perf_event_open is not permitted (perf_event_paranoid=4);
the package mirrors are not reachable. So there are no instruction counts.

## 1. Extraction syscalls (mkdirat + openat/openat2 + close + write/pwrite64), extraction only
Shapes (mkshapes.py): D flat; A 200 leaf directories at depth 4, 10 files each, sorted, no directory members
(421 directories); E = A with 421 directory members; B 2000 leaf directories at depth 6, one file each
(2656 directories); C = B shuffled.

default extractor      D      A      E      B      C
main first          6003   6845   6424  11315  11315
PR   first          6003   7685   7264  16625  16625
main second         6003   6003   6424   6003   6003
PR   second         6003   6003   7264   6003   6003

glob extractor         D      A      E      B      C
main first          6003   8445   8424   9315   9315
PR   first          6003   7685   7264  16625  16625
main second         6003   8003   8424   8003   8003
PR   second         6003   6003   7264   6003   6003

Rule (kernel arm): a file in a directory that exists costs what it cost (1 open). A directory that has to be made
below another directory costs +2 (open its parent, close it). A directory member below another directory costs +2.

Real layouts in npm member order (npm-packlist sorts by extension, then basename, then path), default extractor:
package            files  dirs   main first  PR first        main second  PR second   PR walk first (fallback)
caniuse-lite         837     7       2528     2540 (+0.5%)       2514        2514          2984
rxjs 7.8.1          2277    88       7010     7184 (+2.5%)       6834        6834         21255
core-js 3.37.1      3487   168      10800    11134 (+3.1%)      10464       10464         19977
astro 5.5.5          888   103       2850     3054 (+7.2%)       2644        2644          5476
aws-cdk-lib 2.148   5012   928      16888    18742 (+11.0%)     15032       15032         34681

## 2. bun install syscall vector (fresh cache and HOME; rxjs + aws-cdk-lib tarballs in npm member order)
buffered (file: tarballs, BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL=1): 37,891 syscalls.
  base vs PR: only madvise and futex differ (they also differ between two runs of one binary). openat2 0 vs 0.
streaming (http tarball URLs from a local server): about 38,100 syscalls.
  base vs PR: only sched_yield, madvise, recvfrom, futex, epoll_pwait2 differ (same set between two base runs).
  Every file system call count is equal (openat 9161, close 8334, mkdirat 2242, pwrite64 8448). openat2 0 vs 0.
--compile download: not run (needs a download). Its call site passes DestinationKind::PrivateFresh like the
buffered install path.

## 3. Fallback walk (BUN_FEATURE_FLAG_DISABLE_OPENAT2=1), first extraction, default
D 6003, A 7267, E 7266, B 13972, C 31231 (main 6003/6845/6424/11315/11315). Second: 6003/6845/7266/11315/24985.

## 4. Rare paths
A symlink under the member's own name (2000 members): +2 syscalls per replaced member at depth 0, +4 at depth 3.
A member under a symlinked parent: 2 opens (both ELOOP), then the rejection. main: writes through.

## 5. Binary size (`size`, release, linux-x64)
base text=80676555 data=110424 bss=1822992 ; file 80844360
PR   text=80693707 data=110424 bss=1822992 ; file 80860744
delta: text +17152 bytes, file +16384 bytes.  (The walk alone, before the rework, was text +5632.)

## 6. Instructions per open
Not measured: perf stat is not available. Wall clock of 100,000 open+close of a depth-4 path on tmpfs, 11 interleaved
rounds: openat 1835 ns, openat again 1803 ns (A/A -1.8%), openat2(RESOLVE_NO_SYMLINKS) 1800 ns (A/B -1.9%).
Second run: A/A -3.5%, A/B -3.6%. No difference above the noise.

Extraction wall clock, tmpfs, 31 interleaved runs, median, A/B (A/A noise):
D -1.8% (-3.3%), A +11.3% (+12.0%), E +4.6% (-0.4%), B +6.9% (-3.7%), rxjs -0.6% (-2.5%), core-js +3.6% (-6.3%),
astro +8.8% (+6.7%), aws-cdk-lib +4.3% (-1.9%).

## 7. Descriptors
Peak open descriptors during extraction (sampled at each open): main 9, PR kernel arm 10 (root + file + one
transient parent), PR fallback 13 to 17 on these shapes (one per directory level, at most 128).
A 70-deep tree extracts under ulimit -n 16, 24, 40 and 64 with the kernel arm and with the walk.

## 8. openat2 on the Bun.Archive path
Extraction of A: main 0 openat2 calls, PR 2620 (first), 2000 (second).
Under a seccomp filter that answers openat2 with ENOSYS, or with EPERM: 2 openat2 calls (the first try and the probe
on "."), then the walk. Result (count 2000) and tree digest are identical to the unfiltered run and to main.

## Differential (97 generated archive/destination shapes x {default, glob} x 2 runs)
base vs PR: 194 pairs, 33 differ, same set as root (umask 022 and 000) and as uid 65534:
 - 22 pairs: a symlink already in the destination (11 shapes). PR rejects with ELOOP or replaces the leaf link.
 - 8 glob pairs: one archive writes through or over its own symlink. glob now creates symlinks last, as the
   default extractor does. In one of them (symlink-nested-three) the base glob path never returns.
 - 3 pairs: a symlink member whose name ends in `/` (malformed). base leaves empty directories behind.
PR kernel arm vs PR with openat2 disabled: 194 pairs, 0 differ (root umask 022, uid 65534 umask 000).

## bun create (GitHub template through a local server), destination has `shared -> ../victim`, template has shared/f.txt
main: exit 0, victim/f.txt written. PR without --force: "contains files that could conflict: shared/", exit 1.
PR with --force: "error: ELOOP: a symbolic link in dest/ is in the way of shared/f.txt", exit 1. victim untouched.
