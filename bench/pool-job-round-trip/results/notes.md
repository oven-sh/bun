# Work pool round trip: draft description, numbers and open problems

This file is the draft description of the branch `robobun/2d85858d/pool-job-round-trip` (commit 9a3cc840c2), with the numbers behind it.
The branch is not ready to merge. Read "Open problems" first.

## The report does not reproduce on a quiet machine

The report says that an awaited `bun_jsc::Job` takes about 100 us, 4 times as long as a crypto.subtle call. On this VM that is so only while its host is busy. Then a thread wakes in 22 us, and the thread that wakes it loses 39 us in the call ("VM as it is" in the tables below).

At 2026-10-29 14:04 UTC the host was quiet (steal time 0.15 %). A thread that slept less than 200 us then wakes in 3.3 us, and the wake call takes 1.2 us (`results/meta-quiet.txt`). In that state, with no helper program, both carriers take the same time on main: 7 to 21 us at 2 to 12 CPUs.

p50 in us, main (11c367163a) → this branch, 7 interleaved runs of 3000 awaited calls, with the lowest and highest run in brackets (`results/chains-quiet.txt`):

| call | 1 CPU | 2 CPUs | 4 CPUs | 8 CPUs | 12 CPUs |
|---|---|---|---|---|---|
| crypto.hkdf | 3.7 [3.7..3.9] → 2.8 [2.8..4] | 7.6 [7.4..21.1] → 2.8 [1.9..5.7] | 19.6 [10.9..22.4] → 3.1 [1.9..5.8] | 9.2 [8..21.3] → 5 [1.9..5.4] | 10.6 [9.7..22] → 1.9 [1.9..6] |
| fs.promises.stat | 3.6 [2.9..3.6] → 2.6 [2.5..3.7] | 6.8 [6.6..7.5] → 2.5 [1.7..2.9] | 11.8 [8.2..18.7] → 1.7 [1.7..4] | 10.8 [7.9..19.9] → 1.7 [1.7..5] | 9.5 [7.7..18.6] → 4.6 [1.7..5.4] |
| fs.promises.readFile (4 KB) | 4.4 [4.3..4.7] → 4.6 [4.3..4.8] | 10 [9.5..10.2] → 3.4 [2.9..3.6] | 9.4 [9.2..9.5] → 3.2 [2.9..3.5] | 20.3 [10.2..21.7] → 3.2 [3..6.5] | 20.1 [10.4..21.7] → 3.6 [3..6.2] |
| crypto.subtle.sign (HMAC) | 4.2 [3.8..4.4] → 2.8 [2.8..3.2] | 21.1 [7.9..23.4] → 7.6 [2.9..8.1] | 8.5 [8.2..9.6] → 2.1 [2..2.4] | 18.5 [8.1..23.6] → 6.8 [2..7.8] | 10.3 [8.4..20.6] → 7 [2.1..7.8] |

Mean in us (wall time of the chain / calls), and CPU time of the process per call in parentheses.

| call | 1 CPU | 2 CPUs | 4 CPUs | 8 CPUs | 12 CPUs |
|---|---|---|---|---|---|
| crypto.hkdf | 4.3 → 3.4 (4.3 → 3.3) | 8.4 → 3 (10.9 → 3.8) | 18 → 3.3 (19.2 → 5) | 12.6 → 5.8 (14.3 → 11.1) | 11.1 → 2.6 (14.6 → 5.7) |
| fs.promises.stat | 4.1 → 3.2 (4.1 → 3.1) | 7.6 → 2.7 (9.3 → 3.7) | 12.4 → 1.9 (16.5 → 4.6) | 11.3 → 1.9 (14.6 → 4.5) | 10 → 4.5 (12.9 → 9.5) |
| fs.promises.readFile (4 KB) | 6.1 → 6.4 (6 → 6.4) | 11 → 4.5 (13.1 → 6.9) | 10.7 → 4.4 (12.8 → 8.1) | 20.5 → 5.6 (22.5 → 11) | 19.8 → 6.2 (22.3 → 12.7) |
| crypto.subtle.sign (HMAC) | 4.7 → 3.3 (4.7 → 3.3) | 21.4 → 8.6 (22.9 → 16.8) | 9.1 → 2.3 (11.3 → 4.8) | 16.8 → 7.5 (19.4 → 15.1) | 11.2 → 7.7 (14.4 → 15.7) |

- `crypto.hkdf` is a `bun_jsc::Job`. `crypto.subtle.sign` uses the older carrier.
- `fs.promises.readFile` on 1 CPU does not get faster: mean 6.1 → 6.4 us here and 6.9 → 7.3 us in the table below, inside the range of the runs both times.

## Open problems

A review of the branch found these after the numbers below were made. The ones without a number of mine are not verified by me.

- `test/js/node/test/parallel/test-zlib-invalid-input-memory.js` fails in some runs of a release build of the branch: 4 of 100 runs with `--expose-gc`, and 0 of 100 on main. The message is `Mismatched noop function calls. Expected exactly 1, actual 0`: the zlib stream is not collected. The cause is not proven. The lead is that `auto_tick_active` has a stack frame that is 16 bytes larger, and that a word which a dead frame left on the stack then names the native zlib handle. That lead needs a heap snapshot and a debugger session before anyone relies on it.
- The event loop waits before it polls. A socket that is readable at that time is served after the wait: the review measured a `data` event beside a chain of jobs at p50 8.8 to 25.2 us. A poll with a zero timeout before the wait removes this.
- After a wait in vain the poll uses the timeout from before the wait. A timer can be late by the length of the wait, and by more when `sched_yield` loses the CPU.
- The check of the event loop is not exact. `tickets_outstanding() > 0` is also true for a live Worker or a fetch in flight. `WorkPool::schedule` also sets the flag for tasks that post nothing to the loop (`bun_io::Closer::close`). A count of pool tasks that are out, kept on `EventLoop`, is exact.
- One `Patience` serves all jobs. A mix of short and long jobs makes the waits for the short jobs skip.
- No switch turns the waits off in a release build.
- Windows: only the pool thread's wait works, because `tick_with_timeout` ignores the timeout there.
- Not measured: bare metal, macOS, Windows, Linux 6.6 or later (EEVDF), SMT siblings, gVisor, a build with LTO.
- The case in the report (a VM with slow wakes and 4 or more CPUs) does not get faster.

## How to run the numbers again

- Build a release binary of main and of the branch.
- `sh tools/build.sh`
- One row: `python3 ab.py 7 0-3 awake chain.mjs nodeHkdf 3000 -- base=<bun of main> fix=<bun of the branch>`
- All rows: `BASE=<bun of main> FIX=<bun of the branch> ./run-suite.sh <results dir>`
- The carrier gap alone needs one binary: compare `chain.mjs subtleHmac` with `chain.mjs nodeHkdf`.

## Draft description

### Problem
- An awaited work pool task (`fs.promises.stat`, `crypto.hkdf`) costs three thread wakes: 9 to 14 us where a wake is fast, about 100 us in a VM whose idle vCPUs halt.
- A pool thread sleeps in `ThreadPool::wait` (`src/threading/ThreadPool.rs`) when its queue is empty, and the event loop in the poll of `auto_tick` (`src/runtime/jsc_hooks.rs`). The next task or result comes microseconds later.

### Fix
- A pool thread that ran a task keeps the waking role for 20 us (`ThreadPool::linger`). A task scheduled meanwhile needs no futex wake and no spare thread.
- Before a poll that would sleep, the event loop waits 20 us for the result of a task its thread gave the pool (`EventLoop::await_pool_job`).
- Both waits call `sched_yield` in a loop. A wait in vain skips the next 1, 2, 4, up to 64 waits.
- Verified: `test/js/bun/perf/pool-job-brief-wait.test.ts` and Rust unit tests. `crypto.hkdf`, 4 CPUs, fast wakes: p50 10.0 to 2.3 us.

### Background
- `ThreadPool` gives one thread at a time the waking role. While a thread has it, `schedule` only sets a bit.
- `bun_jsc::Job` is not slower than crypto.subtle's older carrier. The notes say why it looked slower.
- Considered `without_spare_threads()` for the work pool: slower where main is fast. See the notes.

### Downsides
- A wait in vain costs up to 20 us of CPU: 1577 to 1597 us per 1.4 ms job, inside the noise.
- The event loop can hold a ready socket for 20 us, but no timer that is due sooner.
- With slow wakes and 4 or more CPUs the waits rarely end in time.

## Notes

#### How the numbers were made

- Machine: a 12-vCPU KVM guest (AMD EPYC), Linux 6.1.155 (CFS), on a host that other guests share. Steal time is high.
- Binaries: release builds with `--lto=off` of the merge base 11c367163a ("main") and of this branch.
- Each row is the median of 7 to 11 runs. The runs of the two binaries alternate, and the order rotates. The brackets show the lowest and the highest run: that is the noise.
- A run is 3000 awaited calls after 300 warm-up calls, one at a time, with `taskset` for the CPU count.
- "Fast wakes": one `SCHED_IDLE` busy thread is pinned to each CPU, so no vCPU halts. A thread then wakes in 3.3 us, and the wake call takes 1.5 us. This stands in for a machine whose idle CPUs wake fast.
- "VM as it is": an idle vCPU halts. A thread then wakes in 22 us, and the thread that wakes it loses 39 us in the call.
- `perf`, `strace` and `valgrind` are not on this machine. Syscall counts come from an `LD_PRELOAD` shim that counts libc `syscall(SYS_futex)`, `sched_yield` and 8-byte `write` calls. CPU time comes from `process.cpuUsage()`.
- Not measured: bare metal, macOS, Windows, and Linux 6.6 or later (EEVDF).

#### The cause

Calls per awaited `crypto.hkdf`, 4 CPUs, fast wakes, main → this PR:

| | main | this PR |
|---|---|---|
| `FUTEX_WAKE` by the event loop thread (wake a pool thread) | 1.00 | 0.04 |
| `FUTEX_WAKE` by a pool thread (wake the spare thread) | 1.00 | 0.04 |
| `FUTEX_WAIT` by pool threads | 2.00 | 0.05 |
| eventfd write by a pool thread (wake the event loop) | 1.00 | 1.00 |
| `sched_yield` by the event loop thread | 0 | 5.2 |
| `sched_yield` by pool threads | 0 | 6.6 |

- `crypto.subtle.sign` makes 2 eventfd writes for each call on main and on this branch. `zlib.gzip` makes 2 pool tasks for each call.
- With a 1.4 ms job, every wait is in vain: futex wakes 1.00 + 1.01 → 0.93 + 0.94, `sched_yield` 2.0 (loop) + 6.6 (pool) for each call.
- The gap in the report (`bun_jsc::Job` about 100 us, crypto.subtle about 25 us) comes from where the guest kernel puts the threads. The fast calls are the calls in which the pool thread runs on the CPU of the event loop thread. With both threads pinned to one CPU, both carriers take 4.7 us. With fast wakes, both take 9 to 14 us.
- The kernel puts a woken thread on the CPU of the thread that wakes it only when the other CPUs look busy. The second loop wakeup of the older carrier, and the spare thread of the pool, make them look busy.

#### Results

**One awaited call at a time, vCPUs kept awake (fast wakes).** p50 in us, main → this PR, with the lowest and highest run in brackets.

| call | 1 CPU | 2 CPUs | 4 CPUs | 8 CPUs | 12 CPUs |
|---|---|---|---|---|---|
| crypto.hkdf | 4.3 [4.2..4.4] → 3.1 [3.1..3.5] | 9.4 [5..19.2] → 2.3 [2.2..5.2] | 10 [9.4..11.2] → 2.3 [2.2..2.4] | 11.3 [9..23] → 3.1 [2.2..5] | 14.4 [6.4..23.6] → 3.2 [2.2..5.1] |
| fs.promises.stat | 4.1 [3.3..4.2] → 3 [3..3.7] | 9 [3.7..21.3] → 3.2 [2..4.6] | 9.3 [9..9.7] → 2.1 [2..3.5] | 9.7 [9.1..21.9] → 2.1 [1.9..2.2] | 10.3 [4.6..12.9] → 2 [2..4.6] |
| fs.promises.readFile (4 KB) | 5.7 [4.9..6.9] → 4.7 [4.4..4.9] | 10.3 [7.2..233.9] → 4.5 [3.3..8.5] | 13.1 [10.8..24.7] → 3.6 [3.4..6.9] | 12.7 [11..13.2] → 3.8 [3.6..5.3] | 11.5 [9.1..12.8] → 4.9 [3.7..6.5] |
| crypto.subtle.sign (HMAC) | 4.5 [4.4..5.7] → 3.3 [3.2..5.5] | 9.5 [5.7..23.9] → 3.2 [2.4..5.6] | 11.1 [9.4..24.3] → 2.7 [2.3..6.6] | 14.5 [11..23.5] → 3.1 [2.4..6.9] | 12.5 [10.9..23.2] → 6.3 [2.4..6.9] |

Mean in us (wall time of the chain / calls), and CPU time of the process per call in parentheses.

| call | 1 CPU | 2 CPUs | 4 CPUs | 8 CPUs | 12 CPUs |
|---|---|---|---|---|---|
| crypto.hkdf | 5.4 → 4.1 (5.2 → 4.1) | 11.9 → 6.3 (16.9 → 12.3) | 24.9 → 8 (21 → 8.1) | 39.5 → 6.7 (39.9 → 9.1) | 32.3 → 8.2 (28.7 → 6.5) |
| fs.promises.stat | 4.9 → 4.1 (4.9 → 4) | 39 → 6.2 (16.7 → 8.2) | 89.1 → 35.1 (18.7 → 8.1) | 197.3 → 13.9 (28.8 → 7.3) | 54.7 → 17.1 (20.6 → 9) |
| fs.promises.readFile (4 KB) | 8.1 → 7.6 (8 → 7.4) | 49.6 → 8.3 (21.2 → 11.1) | 28.6 → 6.7 (26 → 10.7) | 84.4 → 102.8 (29.6 → 17.2) | 34.1 → 49.6 (21.9 → 15.5) |
| crypto.subtle.sign (HMAC) | 5.3 → 4.2 (5.2 → 4) | 19.9 → 6 (15.7 → 6.6) | 22.9 → 7.6 (22.9 → 9) | 54.7 → 16.3 (31.4 → 11.6) | 29.4 → 8.4 (25.3 → 12.4) |

**One awaited call at a time, VM as it is (a wake costs 22 us, and 39 us for the thread that wakes).** p50 in us, main → this PR, with the lowest and highest run in brackets.

| call | 1 CPU | 2 CPUs | 4 CPUs | 8 CPUs | 12 CPUs |
|---|---|---|---|---|---|
| crypto.hkdf | 4.2 [4.2..4.7] → 3.1 [3.1..3.6] | 6.3 [4..54.1] → 3.4 [3.2..53.2] | 107.5 [95.4..114] → 84.9 [3.3..111.3] | 102.7 [84.8..137.1] → 112 [2.2..132.2] | 105.5 [96.2..113.7] → 108.3 [99.9..114.6] |
| fs.promises.stat | 4.2 [4.1..4.2] → 3 [3..3.3] | 51.1 [3.5..52.5] → 3 [3..51.1] | 108.1 [92..126.1] → 116.2 [3.2..127.2] | 113.1 [107.4..136.7] → 115.6 [99.5..131.6] | 108 [87.8..112.5] → 101.8 [94.3..113.4] |
| fs.promises.readFile (4 KB) | 4.9 [4.6..5.3] → 4.9 [4.7..5.4] | 11 [6.6..82] → 5 [3.3..287.7] | 87.3 [8..333.2] → 76.3 [3.4..339.5] | 336.1 [123.1..359.9] → 328.1 [93.7..346] | 331.8 [78.4..343.1] → 228 [3.5..342.8] |
| crypto.subtle.sign (HMAC) | 4.5 [4.5..4.9] → 3.3 [3.2..3.3] | 5.2 [4.8..51.1] → 3.4 [3.1..4.2] | 5.3 [4.8..5.9] → 3.8 [3.5..5.6] | 6 [5.5..98.4] → 4.2 [3.6..99.9] | 97.1 [93.6..106.6] → 96.7 [89.2..98.5] |

Mean in us (wall time of the chain / calls), and CPU time of the process per call in parentheses.

| call | 1 CPU | 2 CPUs | 4 CPUs | 8 CPUs | 12 CPUs |
|---|---|---|---|---|---|
| crypto.hkdf | 5.4 → 4.2 (5.2 → 4.1) | 41.5 → 17.3 (31.3 → 13.3) | 143.7 → 83.7 (90.7 → 58.1) | 125.1 → 136.4 (81.9 → 90.4) | 133.1 → 137 (83 → 84.2) |
| fs.promises.stat | 4.9 → 3.8 (4.9 → 3.8) | 52.4 → 7.5 (37.8 → 6.9) | 140.4 → 145.4 (94.5 → 98.7) | 151.2 → 131.4 (100.1 → 85.8) | 132.1 → 129.3 (78.4 → 74.2) |
| fs.promises.readFile (4 KB) | 6.9 → 7.3 (6.9 → 7.2) | 79.9 → 22.9 (72.3 → 20.7) | 180.4 → 163.4 (153.6 → 136.3) | 323.2 → 307.3 (260.2 → 237.2) | 317.4 → 269.7 (239.8 → 208.7) |
| crypto.subtle.sign (HMAC) | 5.5 → 4.1 (5.3 → 4) | 30 → 10.4 (24.5 → 9.1) | 31.7 → 19.4 (22.4 → 18.9) | 59.8 → 64 (52.2 → 54.3) | 141.1 → 132.9 (134.5 → 140.9) |

**Other calls, 4 CPUs, one awaited call at a time.**

| call | p50 us | mean us | CPU us per call |
|---|---|---|---|
| Bun.file().bytes(), fast wakes | 14.1 [12.4..14.5] → 5.8 [4.7..8.3] | 26.2 [18.1..90.3] → 12.4 [7..248.2] | 26.7 [22..27.1] → 14.6 [12.5..184.2] |
| Bun.file().bytes(), VM as it is | 102.3 [9.3..333.9] → 32.2 [6.9..388.1] | 217.5 [140.7..285.8] → 203.5 [98.3..382.5] | 186.1 [117.8..246.8] → 181.6 [81.6..335.5] |
| zlib.gzip 4 KB, fast wakes | 28.1 [27.1..52.7] → 11.3 [9.1..15.5] | 46.5 [32.3..560] → 22.4 [14.9..59.3] | 72.9 [61.9..156.6] → 46.6 [36.2..61.9] |
| zlib.gzip 4 KB, VM as it is | 224.2 [99.7..242.5] → 224 [11.1..245.6] | 268 [164.3..291.7] → 274.7 [83.8..306.9] | 189.1 [126.9..209] → 177.7 [78.4..221.3] |
| fs.promises.writeFile, fast wakes | 26.4 [9.8..28.9] → 7 [6.7..9.6] | 54.3 [27..133.1] → 11.8 [9.3..66.1] | 43.8 [17.5..49.6] → 17.7 [15.4..24.9] |
| fs.promises.writeFile, VM as it is | 336.5 [9.5..346.3] → 9.3 [8.2..343.2] | 276 [70.3..326.2] → 147 [67.8..326.4] | 228.4 [62.1..267] → 126.1 [59.4..273.3] |
| crypto.randomBytes, fast wakes | 10.6 [10.3..21.3] → 3.6 [1.9..3.9] | 15.3 [12.9..90.9] → 4.6 [2.3..5.5] | 21.9 [17.2..34.9] → 8.9 [4.5..9.6] |
| crypto.randomBytes, VM as it is | 90.4 [57.5..120.9] → 92.2 [1.8..123.2] | 115.4 [71.8..139.4] → 109.4 [8.1..138.8] | 77.3 [44.4..95.3] → 74.9 [8.6..94.2] |
| crypto.subtle.digest 4 KB, fast wakes | 24.2 [13.3..25.9] → 8.8 [5..9.3] | 42.2 [18.1..149.6] → 11 [6.9..19.9] | 37.9 [19..54.1] → 18.7 [8.6..24.6] |
| crypto.subtle.digest 4 KB, VM as it is | 8.1 [7.1..8.6] → 6.3 [5.7..8.3] | 35 [16.8..52.8] → 27.1 [13..40.6] | 28.9 [16.1..47.3] → 22.8 [12.4..33.1] |

**Jobs that outlast the wait (every wait is in vain), one awaited call at a time.**

| job | p50 us | mean us | CPU us per call |
|---|---|---|---|
| scrypt about 100 us, 4 CPUs, fast wakes | 107.7 [99.6..197.4] → 97.4 [92.5..98.3] | 233.4 [104.4..409.8] → 132.8 [115.1..179.9] | 122.2 [111.6..214.6] → 114.7 [106..123.8] |
| scrypt about 100 us, 4 CPUs, VM as it is | 208.1 [185.5..225.7] → 206.1 [181..230] | 248 [240.1..257.7] → 246.5 [232.9..262.4] | 202.9 [200.9..211.1] → 205.2 [195.3..216.1] |
| scrypt about 1.4 ms, 4 CPUs, fast wakes | 1457.8 [1399.4..1700.9] → 1433.8 [1381..1523.5] | 2335.1 [1904..3240.3] → 1905.9 [1781..2425.3] | 1638.4 [1499.8..1754.9] → 1477.2 [1389.5..1572.4] |
| scrypt about 1.4 ms, 4 CPUs, VM as it is | 1593.2 [1568..1638.1] → 1574.8 [1553.7..1607.6] | 1701.8 [1639.9..2038] → 1724.9 [1617.5..1901.9] | 1577.1 [1567.6..1608.3] → 1596.6 [1560.7..1809.9] |
| scrypt about 1.4 ms, 12 CPUs, fast wakes | 1431.2 [1407.4..1485.9] → 1444.7 [1388.8..1469.1] | 1920.4 [1668.3..2130.7] → 1890.4 [1518.3..2337.4] | 1621.9 [1473.2..2015.3] → 1640.9 [1436.4..2061.5] |
| scrypt about 1.4 ms, 12 CPUs, VM as it is | 1644.7 [1620.9..1660.5] → 1634.3 [1624.9..1661.5] | 1772.7 [1701..2116] → 1870.3 [1678.7..2189.6] | 1618 [1602.4..1745.2] → 1623.5 [1601.6..1778.6] |

**JS work between two awaits, crypto.hkdf, 4 CPUs, fast wakes.**

| JS work | p50 us | CPU us per call |
|---|---|---|
| 5 us | 10.2 [9.5..23] → 2.4 [2.3..5.5] | 28.1 [22.5..46.4] → 19.2 [15.9..36.5] |
| 20 us | 20 [10.2..23.9] → 15.4 [6.1..16.4] | 50.4 [30.7..128.4] → 57.6 [46.1..96.6] |
| 100 us | 22.7 [12.4..24.8] → 16.7 [10.3..17.9] | 150.2 [129.9..220.1] → 145.8 [128.8..262.8] |

**Many calls in flight: Promise.all of K calls, repeated. VM as it is.**

| K calls | p50 us of one round | CPU us per job |
|---|---|---|
| 2 crypto.hkdf, 4 CPUs | 8.8 [6.7..93.1] → 7 [5.5..11.1] | 37.89 [19.72..46.46] → 26.61 [16.23..36.24] |
| 2 fs.promises.readFile, 4 CPUs | 11.9 [11.3..21.7] → 11.5 [10.8..12.5] | 51.58 [37.57..57.61] → 44.74 [31.88..58.3] |
| 8 crypto.hkdf, 4 CPUs | 17.3 [15..30.8] → 16 [13.9..25.4] | 13.27 [10.24..18.38] → 13.31 [9.78..16.95] |
| 64 crypto.hkdf, 12 CPUs | 224.4 [202.4..247.9] → 222.8 [211.7..249.9] | 8.82 [3.96..20.39] → 7.4 [5.9..10.96] |
| 1000 crypto.hkdf, 12 CPUs | 1907.7 [1733.6..2448.4] → 1938.5 [1775..2936.8] | 2.6 [2.06..3.96] → 2.45 [2.18..8.72] |
| 64 fs.promises.readFile, 12 CPUs | 306.4 [254.4..356.9] → 314.3 [294.4..344.4] | 13.93 [9.32..77.74] → 13.11 [10.21..18.86] |
| 4 scrypt 1.4 ms, 12 CPUs | 6941.8 [6336.4..7483.4] → 6942.6 [5313.1..7473] | 2564.06 [2035.29..3784.53] → 2246.96 [1924.18..3374.88] |
| 8 scrypt 1.4 ms, 12 CPUs | 14405.8 [10421.2..16250.4] → 13952.2 [10426.6..15240.5] | 3339.06 [2722.6..8713.16] → 3433.44 [2694.07..5299.03] |
| 24 scrypt 1.4 ms, 12 CPUs | 28073.5 [15949.6..43967.7] → 29858 [10601.7..46921.8] | 3009.42 [2778.96..5401.76] → 3292.99 [2323.69..5121.02] |
| 4 zlib.deflate 256 KB, 12 CPUs | 4292.8 [3771.7..4880] → 4654.6 [3850.7..4934.8] | 1715.33 [1241.81..2596.95] → 1717.92 [1342.75..2017.17] |

**Other programs on every CPU: N busy threads of normal priority. crypto.hkdf, one awaited call at a time.**

| load | p50 us | mean us | CPU us per call |
|---|---|---|---|
| 4 busy threads, 4 CPUs | 4.4 [3.7..10.9] → 3.6 [2.3..3.9] | 11.2 [4.9..23] → 18.1 [4.5..36.8] | 9.1 [6.4..20] → 6.4 [4.7..12.8] |
| 8 busy threads, 4 CPUs | 4.7 [3.5..9.4] → 3.5 [3.3..3.9] | 47.5 [5.6..73.7] → 11.7 [4..30] | 9.9 [4.6..64.3] → 5.8 [5.1..7.7] |
| 12 busy threads, 12 CPUs | 4.5 [3.5..10.6] → 3.4 [3.2..3.6] | 30.9 [8.8..310.7] → 8 [4.1..11.5] | 12.9 [5.3..20.5] → 5.1 [4.7..6.5] |
| 24 busy threads, 12 CPUs | 4.3 [3.4..25.1] → 3.2 [2.3..3.7] | 12.4 [4.4..244] → 14.2 [3.7..59.2] | 5.4 [4.3..36] → 6.1 [3.9..11.1] |

**Bun.build() of 1500 modules through the JS API (it uses the work pool), 12 CPUs.**

|  | build ms | CPU ms per build |
|---|---|---|
| VM as it is | 197.5 [157.2..230.5] → 213.7 [130.1..258.6] | 348.6 [279.2..439.9] → 332.2 [286.7..484.4] |
| fast wakes | 216.6 [116.6..305] → 144.5 [84.7..368] | 403.4 [238.9..561.3] → 355.6 [203.4..426.9] |

#### More results

- Timers are not held back. A 1 ms interval beside a chain of `fs.promises.stat`, 4 CPUs, fast wakes: 21,872 → 171,248 stat calls per second, 679 → 795 ticks per second, lateness of a tick p50 53 → 8 us and p99 4.2 → 3.4 ms. VM as it is: 7,489 → 10,958 calls per second, 903 → 906 ticks, lateness p50 71 → 74 us, p99 685 [562..2747] → 770 [585..3265] us.
- A 2 ms interval beside a chain of 1.4 ms scrypt jobs: lateness p50 60 → 59 us with fast wakes, 990 → 996 us with the VM as it is.
- Idle: one job, then 5 s behind a timer. CPU time 6.9 to 10.2 ms → 6.9 to 7.2 ms. Voluntary context switches of all threads 55 to 114 → 41 to 59 (3 runs each).
- Size of the release binary: text 131,892,680 → 131,893,784 bytes (+1,104), bss +72 bytes (`size`).
- `bench/snippets/webcrypto.mjs` (mitata avg, 5 interleaved rounds, 4 CPUs). The 63-byte group is computed in the call: 1.6 to 1.7 us on both. The 4096-byte group: 42.0, 50.7, 51.0, 54.2 → 35.1, 31.3, 44.2, 43.5 us with the VM as it is (the ranges overlap), and 95, 104, 113, 102 → 17.6, 19.0, 30.3, 39.6 us with fast wakes. The 64 MB group: 44.1, 46.5, 104.9, 103.6 → 44.6, 46.3, 106.9, 104.8 ms.
- `bench/snippets/readfile-not-found.mjs`: `readFile` 32.7 → 7.3 us with fast wakes. With the VM as it is 241 [146..334] → 270 [65..373] us over 12 rounds: the ranges overlap. `readFileSync` 2.28 → 2.31 us.
- Node 26.3.0, Bun 1.4.3-canary.1+367d939d9, main, this PR. p50 in us at 4 CPUs with fast wakes: `crypto.hkdf` 27.8, 9.6, 12.5, 3.1. `fs.promises.stat` 10.5, 9.7, 10.1, 2.1. `crypto.subtle.sign` 11.9, 9.8, 9.5, 3.2. With the VM as it is: `crypto.hkdf` 148.6, 88.7, 85.8, 4.6 [3.2..121.3].
- `Bun.serve` whose handler awaits one `crypto.hkdf`, server on 4 CPUs, client on 4 others, 7 rounds of 3 s. Requests per second with 16 and with 256 connections: 15.1k [10.3k..33.5k] → 22.0k [12.7k..30.5k] and 45.4k [28.7k..67.5k] → 59.9k [40.6k..99.5k] with fast wakes, 11.4k → 11.6k and 30.6k [21.0k..39.4k] → 27.3k [21.7k..44.4k] with the VM as it is. This benchmark has too much noise on this machine to show a difference.
- Pool threads after 0, 1, 51 and 2051 awaited jobs: 0, 2, 2, 2 to 4 on main and 0, 2, 2 to 3, 3 on this branch.

#### What stays as it is, and what can get worse

- A VM with slow wakes and 4 or more CPUs: the waits end in time only when the two threads already run on one vCPU. The rows above are equal inside the noise.
- One CPU: the two threads hand the CPU to each other with `sched_yield` (4.2 → 3.1 us). After a wait in vain the pool thread sleeps. On this kernel a thread that just woke does not give way with `sched_yield` at once, so for a time the calls cost about 3.8 us (event loop waits, pool thread sleeps).
- `sched_yield` beside a runnable thread of another program can give that thread the CPU for a scheduler time slice. A pool thread that lingers has the waking role in that time, so a task that is scheduled then waits for it. A wait that took more than 25 times its length (`Patience::LATE`) makes the next 64 waits skip. With busy threads of normal priority on every CPU the tables show no loss. With the idle-priority busy threads of the "fast wakes" set-up, the tail can grow: `fs.promises.readFile` at 12 CPUs has p50 11.5 → 4.9 us and p99 0.47 → 1.16 ms.
- Linux 6.6 and later (EEVDF) changed what `sched_yield` gives up. This machine has 6.1, so that case is not measured.
- A request that awaits two short pool tasks and then nothing makes one wait in vain: up to 20 us of CPU on a pool thread for each request.
- Windows: `tick_with_timeout` ignores the timeout, so the event loop's wait only saves the sleep when the completion is already posted. Not measured.

#### A question for the reviewer: the spare thread

On main a pool thread that takes a task wakes a second thread to look for more (`keeps_spare_thread_awake`). #45631 added `without_spare_threads()` and uses it for one other pool. This PR keeps the spare thread for a pool thread that slept, and wakes none for a thread that lingered.

The other choice is `.lingering().without_spare_threads()` for the work pool. It makes `linger` simpler (no `keeps_spare` parameter, no left-behind notification), starts 1 pool thread for a lone job where main starts 2, and removes one wake from every task. I measured it. p50 in us [lowest..highest run] and mean, VM as it is, 9 interleaved runs:

| call, CPUs | main | this PR | no spare thread |
|---|---|---|---|
| crypto.hkdf, 2 | 5.7 [4.3..52.3], mean 41.2 | 3.3 [3..3.7], mean 9.5 | 50 [48..51.4], mean 77.6 |
| fs.promises.stat, 2 | 50.3 [3.6..52.9], mean 51.7 | 3.1 [2.8..47.4], mean 9 | 49.7 [49.2..50.5], mean 74.8 |
| crypto.subtle.sign (HMAC), 2 | 5.2 [4.7..6.1], mean 21.7 | 3.3 [2.5..4.1], mean 7.4 | 3.4 [2.3..53.6], mean 21.4 |
| crypto.hkdf, 4 | 116.9 [95..126.1], mean 136.9 | 104.9 [3.2..119.6], mean 128.6 | 50.9 [49.8..51.5], mean 79.7 |
| fs.promises.stat, 4 | 111.3 [3.5..125.5], mean 137 | 110.1 [76.7..122.1], mean 137.4 | 51.2 [49.8..52.1], mean 79.9 |
| crypto.subtle.sign (HMAC), 4 | 5.4 [4.6..5.9], mean 30 | 3.7 [3.4..4.4], mean 13.2 | 82 [56.9..84.4], mean 111.6 |
| crypto.hkdf, 8 | 108 [92.5..119.5], mean 132 | 109.6 [94.7..114.7], mean 140.5 | 51.8 [3.3..52.5], mean 80 |
| fs.promises.stat, 8 | 107.7 [97.8..124.4], mean 139.3 | 113.5 [103.9..128.3], mean 143 | 51.3 [49.6..52.3], mean 78.4 |
| crypto.subtle.sign (HMAC), 8 | 6.8 [4.7..95.9], mean 61.2 | 92.9 [3.4..96.1], mean 119.6 | 85.2 [81.7..86.4], mean 107.7 |
| crypto.hkdf, 12 | 108.4 [94..119.8], mean 131.8 | 97.3 [2.3..117.3], mean 133.2 | 51.4 [2.1..52.2], mean 80.6 |
| fs.promises.stat, 12 | 104.2 [95.9..115.2], mean 132.8 | 103.8 [96..116.1], mean 132.8 | 51.9 [51.1..52.9], mean 84.3 |
| crypto.subtle.sign (HMAC), 12 | 96.5 [91.5..100.8], mean 133.9 | 95.1 [63.4..97.9], mean 128.9 | 85.2 [82.3..88], mean 108.1 |

- It is faster where both threads sleep anyway: 4 to 12 CPUs for `bun_jsc::Job` calls (mean about 135 → 80 us), and jobs that outlast the wait (scrypt about 100 us: 201.5 → 148.5 us).
- It is slower where main is fast because the spare wake makes the guest put both threads on one vCPU: every call at 2 CPUs, and crypto.subtle at 4 and 8 CPUs.
- With fast wakes the two choices are equal (2 to 6 us).
- I kept the spare thread because with it no row moves outside the range of its runs. Two cells flip between two states from run to run on both binaries (crypto.subtle.sign at 8 CPUs: runs of about 5 us and runs of about 95 us), so their medians can differ by chance. The other choice is a small change to this branch.

A second question: `WorkPool::schedule` sets a thread-local flag, and the event loop of that thread reads it. The flag is not state of a VM: it says that this thread gave the pool a task. About 20 call sites give the pool a task without `bun_jsc::Job` (node:zlib, `fs.cp`, N-API async work, module transpile, shell builtins), and a flag in `Job::schedule` misses them: `zlib.gzip` of 4 KB takes 27.7 us with that flag and 12.8 us with this one (main 47.7 us, fast wakes).

#### Designs that were measured and dropped

- A `PAUSE` spin in place of `sched_yield`: on one CPU the other thread cannot run during the spin, and in the VM at 2 CPUs the calls stay at 53 us where `sched_yield` gives 3 us.
- A wait that ends a little late counts as in vain (1 or 2 times the length): the 2-CPU rows in the VM lose most of the gain (mean 9 → 25 to 48 us).
- Waits only while one job is in flight: added for a PBKDF2 slowdown that turned out to be code layout. PBKDF2 on a pool thread is 27 % slower in every binary built after the merge base, with the new code switched off too. A review traced it to the stack frame of `Thread::run`, which grows by 16 bytes: a context that BoringSSL keeps on the stack then lies across a page boundary. I did not verify that.
- Skip the eventfd write when the event loop is awake, and wake the most recently parked pool thread: both need changes under every uSockets loop or a parker for each thread. Not in this PR.

#### Tests

- `pool-job-brief-wait.test.ts` counts the voluntary context switches of the event loop thread and of the pool threads over chains of awaited jobs, for `bun_jsc::Job` and for crypto.subtle. A debug build takes longer than 20 us for its turn, so `BUN_DEBUG_TEST_LONG_BRIEF_WAIT` makes the wait 10 s. It exists only in builds with debug assertions, like `BUN_DEBUG_TEST_WORKER_TEARDOWN_GATE`. On main the pool threads sleep 24 times in 12 jobs. On this branch they sleep 0 to 2 times.
- `brief_wait.rs` tests run on a clock that the test sets, natively and under Miri.
- `threads.rs` tests (native): tasks one after the other on a pool of 8 threads and of 1, 4 x 20,000 tasks from 4 threads, a thread limit, idle tasks, shutdown beside a thread that lingers, and the flag of `WorkPool::schedule`.

