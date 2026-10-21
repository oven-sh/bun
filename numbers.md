# Measurements (release builds, same build directory and flags, linux x64)

base = main b28212a12c. D = late subtest (ab3e94328c). B = t.error record (62b1d12764). C = worker id (92a2f38820).

| | base | D | B | C |
|---|---|---|---|---|
| text (size bun-profile) | 106,416,027 | 106,424,507 (+8,480) | 106,419,276 (+3,249) | 106,416,283 (+256) |
| data / bss | 114,968 / 1,823,304 | same | same | same |
| stripped binary bytes | 106,559,240 | 106,571,528 (+12,288) | 106,563,336 (+4,096) | 106,563,336 (+4,096) |
| jest.rs entries in GeneratedJS2Native.h | 4 | 6 | 4 | 4 |
| node:test JS bytes (js/node/test.js) | 64,405 | 68,533 (+4,128) | 67,654 (+3,249) | same |
| objects added by require("node:test"): Function / FunctionExecutable / NativeExecutable / Structure | 1513 / 948 / 401 / 1632 | 1518 / 953 / 401 / 1633 | 1524 / 959 / 401 / 1652 | same |
| TestNode cell (heap snapshot, 20,002 cells) | 224 B | 224 B | 224 B | same |
| bytecode addTest (instructions) | 270 | 280 | 270 | same |
| bytecode createTopLevelTestRunner | 15 | 22 | 15 | same |
| bytecode executeTestNode (2 blocks) | 619 / 3,441 B | 698 / 4,007 B | 834 / 5,016 B | same |
| bytecode TestNode.pass | - | - | 30 / 268 B (1 call per test) | - |

Symbols (nm -S, bun-profile):
- base: Execution::advance_sequence 11,753 B (handle_test_completed is inlined into it), BunTest::on_uncaught_exception 643 B.
- D: CommandLineReporter::handle_test_completed 13,278 B (one copy, two callers), Execution::advance_sequence 1,369 B, BunTest::print_error 111 B, BunTest::on_uncaught_exception 538 B, JS2Rust jsNodeTestReportDetached 1,381 B.

Wall clock, `bun test --dots`, interleaved runs, median (two series of the base binary show the noise):
- 5,000 empty bun:test tests (11 runs): base 19.9 / 20.6 ms, D 19.0, B 17.6, C 21.9.
- 20,000 empty node:test tests (15 runs): base 328.0 / 339.1 ms, D 367.5, B 329.1. Spread of one series: 214 to 590 ms.
- 5,000 node:test subtests of one test (11 runs): base 95.1 / 96.1 ms, D 99.1, B 81.1, C 99.6.
Tools not available on the machine: valgrind, perf, bloaty, strace.

C: keys of process.env in a bun:test test: serial 37 -> 38, --parallel 39 -> 40.

console-fail-test@0.10.0 (cft() with auto-detection, a test that calls console.error):
| file | main | with NODE_TEST_WORKER_ID set by bun test |
|---|---|---|
| imports only bun:test, serial | the test fails (intended) | the test passes |
| imports only bun:test, --parallel=2 | fails (intended) | passes |
| uses node:test | fails (intended) | fails (intended) |
| node --test (Node v26.3.0) | fails (intended) | - |

R at d6f25d4564 (on main 017b2439a7): node:test JS 68,565 B (+4,160 over 64,405). node-test.test.ts: 62 pass with the change, 49 pass and 13 fail on base src.
R at 0d3c9b32b7: node:test JS 69,138 B (+4,733 over 64,405). node-test.test.ts: 63 pass with the change, 49 pass and 14 fail on base src.

Lifecycle PR (step 1 of the late-subtest series), adc7f0527a on main 017b2439a7:
- node:test JS 65,508 B (+1,103 over 64,405).
- TestNode cell 224 B on both (no new field). Live Promise cells after 2,001 registered tests: base 2,040 (65,270 B), branch 39 (1,238 B): the shared settled chain removes one promise (32 B) for each test node.
- node-test.test.ts: 53 pass with the change (45 + 8 new), 50 pass and 3 fail on base src.
- Node v26.3.0: 32 pass 9; 32b pass 3, fail 10; 32c pass 4, fail 1 (the file); 32d pass 1, fail 2, cancelled 2.
- Mutants killed: addTest guard, addSuite guard, unbounded wait, failed-body rule, recount, identity clause, hookFailure, loop, gap snapshot, catch.

Lifecycle PR v2 (after its self-review, merge-after-changes): node:test JS 66,065 B (+1,660). Module load: Function +7, FunctionExecutable +5, NativeExecutable +2, Promise +1 (1505/962/383 vs 1498/957/381). TestNode 224 B both. Live promises after 2,001 tests: base 2,040, branch 39. Driver: 54 pass; main src: 49 pass, 5 fail. 18 single-clause mutants killed; retry-node filePath and todoFlag copies have no test.
Node v26.3.0: 39 pass 14; 39b pass 3, fail 13, cancelled 1; 39c pass 2, cancelled 2; 39d pass 9, fail 4. main (release): 39 6/2, 39b 6/2, 39c 0/2, 39d 6/2, 40 --retry 1: 0/1.

PRs of this session: #45334 (t.assert, status comment 6192490027), #45716 (t.workerId, 6231993657), #45717 (ERR_TEST_FAILURE record, 6231998624), #45834 (lifecycle: finished after hooks, 6244673220, branch robobun/4cbb2235/node-test-subtests-in-hooks, head 7d58abf3d1).
Late-subtest series: step 1 = #45834. Step 2 (report-only sink; prototype ab3e94328c at refs/robobun-wip/4cbb2235/node-test-late-subtest; review in D-review/) waits for #45834, #38876, #43751 and the owner's answer about the reporter seam.

Lifecycle PR #45834 after the bot review (head 7311e9a6f0 on main 91e7e3b140, 2 commits): per-attempt retry node removed (needs #38876), `unfinishedSubtests` counter added. node:test JS 66,225 B (+1,820 over 64,405). Module load: Function +7, FunctionExecutable +5, NativeExecutable +2, Structure +1, Promise +1. TestNode 224 B before and after. Live promises after 2,001 tests: 2,040 to 39. Driver: 53 pass; main src: 49 pass, 4 fail. 24 single-clause mutants killed.
Node v26.3.0: 39 pass 18; 39b pass 3, fail 14, cancelled 3; 39c pass 2, cancelled 2; 39d pass 8, fail 7. main: 39 9/2, 39b 7/2, 39c 0/2, 39d 8/2. Branch: 11/0, 1/8, 1/1, 5/5.
CI build 127932 (old head): darwin aarch64 artifact download timeout (infra), node-http-uaf.test.ts RED on darwin x64 (reported to main-break triage).
Status comment node id on #45834: IC_kwDOFVKCyc8AAAABdDYmxA (databaseId 6244673220).

#45834 head 1145c642da (3 commits on main 91e7e3b140): the wait races the chain with process.nextTick (was setImmediate: flaky for fast I/O, found by review). node:test JS 66,213 B (+1,808). Module load: Function +5, FunctionExecutable +5, Promise +1. TestNode 224 B. Driver 53 pass; main src 49 pass, 4 fail. Node: 39 pass 18; 39b pass 3, fail 15, cancelled 4; 39c pass 2, cancelled 2; 39d pass 8, fail 7. main: 39 9/2, 39b 8/2, 39c 0/2, 39d 8/2. branch: 11/0, 1/9, 1/1, 5/5. The readFile case fails 20 of 20 runs on bun.
CI build 128956 (7311e9a6): bake.test.ts red on windows 2019 x64 (pre-existing, reported to main-break triage).

State at the wrap-up: #45334, #45716, #45717, #45834 are open, mergeable, with green CI (builds 126948, 127439, 127477, 128980) and no open review thread. #45834 head 1145c642da. The step 2 choice (native sink, file-level afterAll, or registration after the build) is in the Notes of #45834. Step 2 and the port PR (refs/robobun-wip/4cbb2235/node-test-late-subtest, node-test-error-port-full) are not built as PRs.
