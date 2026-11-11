 0 with an unhandledRejection.
- process.nextTick per chunk is 0.72-0.90 against 0.86-0.88 with main's JS.
- 9 new tests pass; 7 of them fail with main's JS. Node v26.3.0 prints every expected value.
- This replaces the earlier caveat that the prototype (076667baed0) emulated the bool with process.listenerCount.

**E: cost {emit-catch-handled-flag:common-path-cost}.**
- +1 non-inlinable JS frame per emitted event on child stdout/stderr: about +14 instructions per 'data' at top tier (E 76.9 vs base 62.6), +152 in DFG.
- 0 added ticks, promises, Buffer allocations or syscalls. It removes nothing.
- The prototype also allocated one 64-byte Arguments object per emit until FTL (100 of 100 chunks; base 0).
- emitAndCatch is 48 instructions, bytecode cost 235; 19 run on the no-throw 'data' path.
- Every event enters it: 5 per short-lived child on stdout, 4 on stderr, 10 for an execFile with both.
- native-readable.js 8358 B (#48553) to 9130 B (+772); shared.js +25.

**E: regressions where main equals Node {blast-radius, fixes-it, existing-suites}.**
- The catch sits in a writable own `emit` (NR:75, :197-208 at 076667baed0), on 2 of 9 stream kinds.
- A listener throw through emit('data'), push(), unshift() or read() no longer reaches the caller's try/catch (4 of 4 entry points). With no handler the process exits 1 instead of 0.
- The same inside an 'uncaughtException' handler exits 7.
- events.captureRejections is lost. Prototype emit wrappers see 0 of 1 'data'. Pause-on-uncaught pauses 0 times where main pauses once at the flow() site.
- A program that assigns child.stdout.emit gets the stall back (1 of 3 listener calls, unhandledRejection; Node 3 of 3). An emit patched onto a prototype sees 0 of 3 events.
- Existing suites see none of it: 0 results change in 824 bun:test cases in 42 files and 271 vendored Node test files (named suites: 12 files, 344 cases).
- Fixed: all 11 child_process rows run, both emit sites, stdout and stderr.
- Left: 2 inherent regressions, 3 repairable defects (exit 7 when the handler calls read(); 1 to 39 more pulls after a fatal report; captureRejections bypassed), 3 orders unlike Node, 8 sibling cases unchanged.

**E: the flow() site {one-throw-at-flow-site}.**
- After one listener throw at the flow() site, E reads on to 'end' in 5 of 16 fixed-shape rows where Node and E's own base do not.
- That is 0 of 8 rows with one chunk buffered at resume(), 5 of 8 with two, and 0 rows the other way.
- paused-then-throw.cjs SIZE=1024 THROWS=1000: 8 of 8 calls on E; Node and main stop at 4 of 8.

**E: latch and review {what-the-latch-reads, review-cost}.**
- `handled` is false under --hot and --watch while the process stays (VM:2229-2321; exit gate VM:2295-2298 from a950fc5307f, #46270; run_command.rs:1656-1671).
- A latched stdout then delivers 2 of 12 lines, and 0 of 2 after a hot-reloaded fix (main 2 of 2 after pause()/resume(); stdio[3] 12 of 12).
- So any latch must read a native value meaning "this report ends the run". Plan step 5 does this in native.
- A stale AOT contract row aborts a --aot executable (exit 134 with a stand-in). #34661 is not based on main.
- Product diff: about 60 changed lines in 7 files, no second text. With its test matrix: about 640 lines (est 330).
- #44849's bool hunk is +11 -10 in 5 files (operand-changes.builtins.ts:282-286, SH:157, BP:5539-5544, ZigGlobalObject.h:91, virtual_machine_exports.rs:84-95). `git apply --check` fails for 2 of the 5.
- Six review points fall outside what `bun bd test` checks.

**pushandcheck-catch-rearm (PR #37171, head 9006a439fb2).**
- The catch is at NR:224-240 of that head (report :232, re-arm tick :234, readAfterListenerThrow :242-246).
- pushAndCheck has four call paths (:161, :167, :191, :184). Only :184 reaches RD:500. It is on the stack for 1 of 24 'data' calls on a gapless writer.
- Parked-pull site: equal to Node in all 26 handler-installed variants.
- flow() site: identical to main. One throw strands the stream (66560 of 154096 bytes, no 'end' or 'close', 5 of 5).
- three-throws K=1000000 stalls 14 of 14; K=3 H=both stalls 6 of 15 at 540672 of 13107200 bytes.
- A gapless child whose listener throws on every chunk delivers about 10% of 4 MiB with no 'end' and exit 0 (6 of 6).
- R1 is worse than main: reportUncaughtException returns undefined (BP:5539-5544) and :234 re-arms anyway (VM:2309-2310, :1851-1852).
- fatal-gapless: 3 to 4 listener calls (Node, main, E: 1). fatal-late-eof-nosleep: 'exit|data 1|end|child close 0', status 0 (Node and main: 'exit|data 1', status 1).
- Cost: 0 allocations, ticks, pulls or syscalls per chunk. pushAndCheck grows from 62 to 178 bytecode bytes, passes the DFG inline cap of 80, and costs +46 instructions per chunk in DFG (+2.4 Baseline) on every NativeReadable.
- Bytes: 8514 to 8993 B (+651 over #48553, +503 over main).
- Tests: 3 tests, 1 fails on main. All 3 pass while the head shows the failures above. Two are paced by a 50 ms timer (REVIEW.md:9). Its author's status note says do not merge this head.

**Hold-one (the push-site variant of #37171).**
- Removing the flow() site inside NR works: 0 fresh chunks through flow(), 46 of 48 paced cells equal Node.
- The literal variant regresses 3 rows main passes. R3 goes from 0 of 10 to 10 of 10 (50 of 50 in another run).
- A plain port fails 1 pinned test (16 of 17 in spawn-stdio-syscall-error, 65536 bytes lost before EIO) and reorders bytes on a nested read(0).
- The working text is +164 lines against +28 (another build: +250 lines, +5.7 KB of built-in JS).
- Cost: +4 to +10 instructions per 'data' at FTL, +14 to +16 in DFG; a chunk pulled inside `_read()` gets cheaper (-453 FTL, -924 DFG). Same harness: E +14 / +152, #37171 +5 / +48.
- Written plainly it costs every NativeReadable +19 to +49 per chunk.
- The flow() site still stalls (pause-gapless 3 of 3) where E reads on.

**deferred-delivery.**
- Three incompatible diffs: stack B (origin/robobun/f00c9907/rebased-stack, 6 files, +478 -30), PR #48551 (ae0d792747e, 3 files, +240 -73), draft #43790 (1bbaee09335, 11 files, +580 -28).
- All three end the hang (32 of 32 handled-throw rows equal Node).
- B and #48551 fail R1: exit 0 after a fatal throw with 5 to 68 listener calls (Node and main: 1 call, status 1).
- They fail R2 and R3 for programs that never throw: 3 and 2 of 6 blocks to a re-attaching listener, no 'end'; 'end' before an async continuation 10 of 10. This is inherent to a process.nextTick queue.
- #48551 changes both constructNativeReadable callers (CP:1308; WA:44, from WA:618, RD:1731, duplexify.ts:64 and :140). fetch-door H=ur exits 1 (R4). `read()` at 'exit' returns null 4 of 4 (CP:1195-1199).
- #43790, through a JS-only port, passes R3, R4 and the tick/job order but fails R1 (5 listener calls) and R2 (1 of 6 blocks).
- Only that port plus two repairs and an emulated flag matched Node on every row (0 of 48 differing).
- #43790 does not apply to main: 7 of 22 source hunks fail, all 4 in the tick loop, which has SHA-pinned second texts. Its 26 tests pin 1 of 5 requirements (R3).
- Cost: for 25 MiB from a fast writer, stack B queues 935-939 ticks where main queues 3, with 1.7x more 'data' events.
- #48551: 2.00 ticks per chunk against 1.00 paced, and 260 against 6 per 8 MiB on every Readable.fromWeb stream.
- #43790: +1 queue entry and +1 object per chunk, plus a check at every tick-loop exit of every process. B adds +1,169 B of built-in JS.
- Commit 80825a7a878 (#43739) declined a later-tick push in this file: 'it costs a tick for each chunk on the hot path'.

**fd-socket-with-guard-residue.**
- Origin: Jarred-Sumner, CHANGES_REQUESTED on #36316 (2026-07-29): 'can we instead make it so stdout and stderr are file descriptors we then pass to net.Socket?'
- Nothing ran the design. 'socket-fd' at slots 1 and 2 throws today (spawn/stdio.rs:419-424). The stand-in is stdio[3] of unfixed main (CP:1330-1341, NET:799-816).
- Stand-in equals Node on the symptom: x.mjs 655360 of 655360; three-throws 8 of 8 cells at 13107200 bytes; gapless-fd3 4194304 of 4194304.
- Three gaps its text does not name: late-attach delivers 0 of 300000 bytes; R1 at the flow() site exits 0 where Node exits 1 (3 of 3); a read error with no 'error' listener becomes a clean 'end' (2 of 2; main and Node raise EIO).
- More changes on the stand-in: an unref'd child with unread pipes holds the parent 1999 ms (main 0 ms); a stream handed to a second child loses bytes in 4 of 8 runs; listeners see the spawn-time ALS store.
- destroy() inside 'data' gives 'end' then 'close', which fails the pin at child_process.test.ts:1578-1580 (3 of 3).
- It changes a public Bun.spawn type (bun.d.ts:8133-8143, :8583-8589; spawn.test.ts:1219) and code shared by 10 spawn_process call sites and all 3 net.ts data handlers.
- Per chunk on POSIX: 0 promises, 1 recvfrom, 0 epoll_ctl.
- Per spawn with two piped outputs: +18 syscalls, +6 ticks, +53k to +71k instructions (+10 to 13%); 180,224 bytes buffered per unread stream (Node 65536, main 0).
- First piped spawn loads node:net: +7 modules, about +2,050 live objects, +320 KB heap, +12 to 14 M instructions (about +37% of a one-spawn script).
- The swap alone also fixes 4 NativeReadable-only defects: kept-chunk overwrite; an 'error'-listener throw losing 'close'; next 'data' before the listener's promise job (6 of 45 chunks to 0); 'end' before an async continuation (31-35 of 40 to 0).
- On Windows 0 fresh chunks reach the flow() site (PIPE:1939-1943; FR:939-973, :980-997, :999-1006, :1012-1022, :633-654). The right residue there is a push-site catch plus latch (about 19 + 3 lines), not E whole.
- Size: about +175 -77 production lines in 15 files plus 420 to 600 test lines, about 5 times E's production diff. Its 12 listed files omit at least 7.
- Rebase exposure: #46522 rewrites net.ts (+26389 -16263); #47776 rewrites Windows pipe code (+26880 -32782).

**no-change and demand.**
- It fixes 0 of 24 sibling rows re-run on release main (16 through NativeReadable, 8 in other delivery code).
- On all 9 child-stdio entry points a throw on a waiting-pull chunk stays 'unhandledRejection' with no read scheduled (1 of 4 blocks after 20 s; Node 4 of 4).
- Only a single throw on a flow()-emitted chunk already equals Node.
- Main also emits 'end' and stream 'close' after a fatal report at the flow() site ('data|end|stream close|exit listener 1'; Node 'data|exit listener 1').
- Readline probe: Node 'lines [1,3] ... rl close | child close 0'; main 'lines [1] | unhandledRejection SyntaxError', then a stall.
- No user has reported it. Three issue searches return 6 issues (#30443, #28792, #429, #16823, #16868, #21974), none about a throwing child-stdio listener. PR #37171 has 0 human reviews in 95 days.
- But the deadlock ships: three-throws H=both is still alive at 10 s on published 1.4.2 and 1.4.3, and x.mjs on 1.4.3, where 1.3.13 exits 0.
- Its one free win is empty: 0 edited lines against the 6 open PRs that edit native-readable.ts.

**Prior attempts {tracker}.**
- Across 16,247 ref tips no branch puts stdout/stderr on an fd-backed net.Socket. That design exists only as the #36316 request (a question back unanswered for 105 days) plus parts in #29141, #47776 and #46522.
- The nextTick push has been built 7 times and never merged, once backed out by a maintainer.
- The JS catch-and-report merged twice for sibling sources: #34019 (POI:260-277) and #35347 (NET:799-816).
- `pushAndCheck` appears in 9 PRs: #48551, #37171, #43790, #48553, #47413, #47974, #39760 open; #41608 closed; #36035 merged.
- 20 open PRs touch native-readable.ts.

**Sibling sites {siblings}.**
- 6 other reaction sites in 3 files deliver a Node listener or callback from a promise reaction over a now-or-later binding, and misroute a throw on main: /workspace/bun/src/js/internal/fs/streams.ts (4 sites, writeFast at :728-744), WA (1), dgram.ts (1).
- The bindings: Source.pull returns number, boolean, Promise, Uint8Array or undefined (BIND:10-16). Sink.write returns number, boolean or Promise (/workspace/bun/src/runtime/webcore/Sink.bind.ts:41, :49-54).
- None passes through NR. They meet only at frame 4 (transport), frames 9-10 (native completion turned into a Promise) and frame 17 (the uncaught report).

## 7. Considered and set aside

The dismissed list is empty (0 facts refuted). These come from the losing candidates and their variants.

- **E as the fix.** Built and Node-equal on the symptom rows on a real build (720c2ab711c). Set aside because it compensates, bills a frame per event forever, and regresses manual emit/read() and 5 of 16 flow()-site rows. Kept unmerged as the fallback.
- **PR #37171 as written.** Guards 1 of 2 emit sites and re-arms with no handled flag, so it exits 0 after a fatal throw. Its own author's note says do not merge.
- **Hold-one inside native-readable.ts.** Reaches 46 of 48 paced cells, but it is a +164 to +250 line JS redesign that keeps the promise and still stalls pause-gapless 3 of 3.
- **A process.nextTick push (stack B, #48551).** R2 and R3 regressions are inherent to the queue. #43739 already declined the per-chunk tick. Built 7 times, never merged.
- **The tick-drain hook (draft #43790).** Edits the tick loop and its SHA-pinned second texts for every process, does not apply to main, and fails R1 and R2 in the port.
- **fd-backed net.Socket for stdout/stderr (#36316).** Bills every spawn (+18 syscalls, node:net load), is POSIX only, and needs E as residue. A separate project, not this fix.
- **no-change.** Ranked 4th, above the two designs that bill every chunk or spawn. Set aside because a deadlock ships on 1.4.2 and 1.4.3 and an installed handler is never called.
- **Reusing #29141's Pipe read callback.** No child stdio stream can reach it and it waits on 4 unanswered maintainer decisions. Credit it and converge later.

Still open, not set aside: whether the arm is a fourth delivery variant or a SinkHandle kind (plan step 2).