The tests of this PR on Node.js v26.3.0, for the rule from #37588 and #41305 (a test must pass on Bun and on node).

The tests are in `test/js/node/http2/node-http2-max-concurrent-streams.test.ts`. The file is written for `node:test` and `node:assert`, so node and Bun run the same file. In Bun, the last test of the file starts Node.js on that file, so CI checks both runtimes.

```sh
node test/js/node/http2/node-http2-max-concurrent-streams.test.ts
bun bd test test/js/node/http2/node-http2-max-concurrent-streams.test.ts
```

| Block | Tests | node v26.3.0 | Bun 1.4.3 | This PR (d8c5baf2c4) |
| --- | --- | --- | --- | --- |
| `the slots of SETTINGS_MAX_CONCURRENT_STREAMS` (the pins) | 33 | 29 pass, 4 skipped | 33 pass | 33 pass |
| `a stream refused over SETTINGS_MAX_CONCURRENT_STREAMS` (the limit) | 26 | 23 pass, 3 skipped | 22 fail, 4 pass | 26 pass |
| `Node.js compatibility` (Bun only, it starts node) | 1 | not run | pass | pass |

The 7 tests that node skips are marked Bun only.

- 6 need a `respond()` that fails. The ways to make it fail in Bun (`weight: 0`, a parent out of range, options that are not an object, a header block over `maxSendHeaderBlockLength`) do not fail on node. They guard the slot count on the failure paths of `respond()`.
- 1 pins the slot timing of Bun: three GET requests in one write at limit 1, with a handler that answers at once, are all served. Node serves the first one. The PR body lists this as a difference that stays.

What changed since the first version of this report:

- An earlier head held a slot until the end of the read, to follow node in that last case. A review measured that the rule cannot follow node (node serves 300 of 300 requests with `respond(); end(); destroy()`, the rule served 210) and that it refused requests that Bun 1.4.3 serves. The rule and the tests that pinned it are removed.
- 3 tests on a session that reads from a Duplex used the PING ACK as the barrier. Node writes the ACK before the responses there. `outcome()` now waits for an answer to every request.
- 1 test asserted that a stream over a limit that the client ACKed is refused and the session stays open. Node ends the session. The test is removed and the difference is an open question in the PR body.

`node-http2-rejected-streams.test.ts` (from #44248, written for `bun:test`) had one test of the old budget, `a stream refused over maxConcurrentStreams is counted`. Its comment asks for a rewrite when the refusal moves to the other budget. It now asserts what node does: three refusals with `maxSessionRejectedStreams: 3` keep the session.
