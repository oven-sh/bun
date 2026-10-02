# Measurements for PR #41750 (candidate 8de1be4c71 vs merge base bf42a525d5)

Release builds of both, same tree and toolchain: /tmp/arc/bun-base-bf42a525, /tmp/arc/bun-pr-8de1be4c.
Tools: /tmp/arc/st (ptrace tracer, ST_SUMMARY=1), /tmp/arc/ab/ab.py (interleaved A/B), `size`.
perf, valgrind, strace, bloaty are not installed; perf_event_open is not permitted (perf_event_paranoid=4);
apt mirrors are not reachable. So no instruction counts.

## Binary size (`size`, release, linux-x64)
base text=80676555 data=110424 bss=1822992 ; file 80844360
pr   text=80682187 data=110424 bss=1822992 ; file 80848456
delta: text +5632 bytes, file +4096 bytes

## Extractor syscalls (mkdirat + openat + close + write/pwrite64, extraction only)
Synthetic, 2000 file members each:
| shape | base | pr | delta |
| D flat, no directory | 6002 | 6002 | 0 |
| A 421 directories, no directory entries, sorted | 6844 | 7266 | +422 (+6.2%) |
| E 421 directories with directory entries | 6423 | 7265 | +842 (+13.1%) |
| B 2656 directories, one file each, sorted | 11314 | 13971 | +2657 (+23.5%) |
| C same as B, members in random order | 11314 | 31174 | +19860 (+175%) |

Real npm package layouts (sorted, no directory entries, names from the install cache):
| package | files | dirs | base | pr | delta |
| caniuse-lite | 837 | 8 | 2530 | 2538 | +8 (+0.3%) |
| core-js 3.37.1 | 3487 | 169 | 10802 | 10971 | +169 (+1.6%) |
| astro 5.5.5 | 888 | 104 | 2852 | 2956 | +104 (+3.6%) |
| aws-cdk-lib 2.148.0 | 5945 | 1051 | 19933 | 20984 | +1051 (+5.3%) |
Rule: +1 syscall per directory of the archive (the close of its fd) when the archive has no directory
entries, +2 when it has them. 0 for entries in the destination root.

## Wall clock, 41 interleaved runs, median, tmpfs (/dev/shm). A/A = base vs base (noise floor)
D: A/A -1.9%  A/B +0.3%
A: A/A -0.7%  A/B -2.8%
E: A/A -3.8%  A/B -2.5%
B: A/A -10.5% A/B -13.8%
C: A/A +6.1%  A/B +22.8%   (25.5 ms -> 31.3 ms)
caniuse-lite: A/A +11.6% A/B +7.8%
core-js:      A/A -0.4%  A/B -4.6%
astro:        A/A -6.1%  A/B -1.0%
aws-cdk-lib:  A/A +7.9%  A/B -1.6%
On the overlay disk the A/A noise is 9..18% and every A/B delta is inside it.

## Differential (83 generated archive/destination shapes x {default, glob} x 2 runs; root and uid 65534)
76 shapes: 152 pairs, 26 differ (same set for root and nobody, debug and release builds):
 - 18 pairs: a symlink already in the destination (the bug). default rejects, glob skips.
 - 8 glob pairs: one archive writes through or over its own symlink. glob now gives the tree the default
   extractor gives (symlinks created last). In symlink-nested-three the base glob path never returns.
7 more shapes (order of member vs its directory entry, dangling links, hardlink): 14 pairs, 0 differ.

## Descriptors
One fd per directory level of the current entry stays open (at most 128). On EMFILE/ENFILE the cache
halves itself and retries. `ulimit -n 24/40/64` with a 70-level tree extracts.
A nested entry needs 2 free descriptors (parent + file) where main needs 1.

## Handoff script as uid 65534 (candidate)
1 read-only destination: REJECTED ReadError | on disk: (nothing)
2 `a`, then `a/b`: REJECTED ReadError | on disk: a
3 layer 2 over bin -> usr/bin: REJECTED ReadError | on disk: bin usr usr/bin
(base: 1 REJECTED, 2 REJECTED, 3 resolved 2 with usr/bin/tool written through the link)
