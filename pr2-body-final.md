### Problem
- A `node:http2` server ends the session with GOAWAY(ENHANCE_YOUR_CALM) and `ERR_HTTP2_SESSION_ERROR` at the 100th stream over the SETTINGS_MAX_CONCURRENT_STREAMS it advertised. Node keeps the session until refusal 1002.
- Reach: a client with no stream cap before SETTINGS, like Bun's `http2.connect()`. Not user-reported.
- Cause: JS refuses the stream after the engine opened it (`src/js/node/http2.ts:4053`) and charges `maxSessionRejectedStreams`.

### Fix
- `Connection::handle_headers` refuses the stream before it makes a stream entry: RST_STREAM(REFUSED_STREAM), charged to `maxSessionInvalidFrames`, like node.
- `H2FrameParser` counts the open peer streams in a `Cell<u32>`, and the JS count is deleted. A slot that the server frees during a read stays held until the read ends, as in nghttp2. A peer RST_STREAM frees it at once.
- Verified: `test/js/node/http2/node-http2-max-concurrent-streams.test.ts`, written for `node:test` (29 tests fail before, node v26.3.0 passes 59 and skips 6 that are Bun only), and the 261 `test-http2-*` node tests.
- Self-reviewed: 19 concerns raised, 15 addressed (Notes).

### Background
- The engine (`connection.rs`) parses inbound frames. `H2FrameParser` embeds it and writes responses.
- `refused_ids` is a stand-in for the closed-id mark of #37985.
- Considered: move only the charge. A refused request then still costs a stream allocation and JS calls.

### Downsides
- Two changes toward node. A server that lowered `maxSessionInvalidFrames` ends the session at refusal max + 2. A request in the same read as a stream that the handler ended is refused (Bun 1.4.3 served it).
- Open question for a maintainer: the stream over a limit that the client ACKed (Notes).
- Cost: +72 bytes per session, +2,048 bytes of `.text`, +67 instructions per request.

<details><summary>Notes</summary>

Stacked on #44335, which is stacked on #44248. Earlier attempt: #32675 (closed). This PR keeps its decision point (refuse in `handle_headers` before `on_stream_open`) and the O(1) count that was asked for there.

**Reach and history.** Bun 1.3.14 did not enforce the limit: 110 requests at limit 10 all reached a handler. Bun 1.4.x enforces it and ends the session at the 100th refusal. A client that follows nghttp2 holds its first flight to 100 streams, so it gets at most 99 refusals and sees no change (a node client, limit 10, 300 requests: 210 served and 90 refused on 1.4.3, on this PR and on node). Bun's own client has no such cap. I found this by inspection, not from a report. On 1.4.x the server option `maxSessionRejectedStreams: 1002` gives node's count. `maxSessionRejectedStreams` no longer counts these refusals after this PR.

**Repro.** Server `http2.createServer({ settings: { maxConcurrentStreams: 10 } })`, handler `stream.respond({ ":status": 200 }); stream.write("hello")`. A raw client sends the preface, an empty SETTINGS frame and N complete requests in one write, then a PING.

| N | node v26.3.0 | Bun 1.4.3 | this PR |
|---|---|---|---|
| 150 | 140 RST_STREAM(7), session open | 99 RST_STREAM(7), GOAWAY(11) | 140 RST_STREAM(7), session open |
| 1011 | 1001 RST_STREAM(7), session open | same as above | 1001 RST_STREAM(7), session open |
| 1012 | 1002 RST_STREAM(7), `ERR_HTTP2_TOO_MANY_INVALID_FRAMES` | same as above | 1002 RST_STREAM(7), `ERR_HTTP2_TOO_MANY_INVALID_FRAMES`, GOAWAY(2) |

With `maxSessionInvalidFrames: 3`, node and this PR wrote the same frames: RST_STREAM(7) for 5 streams, then GOAWAY(last stream 1, code 2).

The public API shows the same. A `http2.connect()` client of Bun sends 110 requests on a new session, the server has limit 10 and answers after 100 ms. Bun 1.4.3 as the server: 0 requests succeed, 99 get `NGHTTP2_REFUSED_STREAM` and 11 get `ERR_HTTP2_SESSION_ERROR`, the 10 admitted requests too. Node and this PR as the server: 10 succeed and 100 get `NGHTTP2_REFUSED_STREAM`.

**Node's rule.** nghttp2 refuses the stream before it exists and reports the HEADERS frame as invalid ([nghttp2_session.c:3905](https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_session.c#L3905-L3908)). Node charges that to `maxSessionInvalidFrames` with `count++ > max` ([node_http2.cc:1128](https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L1128-L1143)). `maxSessionRejectedStreams` has no part in it. The review of #31584 asked for the charge to `maxSessionRejectedStreams` and said that nghttp2 does the same. The measurements above show that node does not.

**Slot timing.** nghttp2 closes a stream when it writes the frame that ends it, and node writes after nghttp2 has read the whole chunk. So a stream that the handler ends inside a read has its slot until that read ends. Bun 1.4.3 frees the slot when the handler returns, and serves a request that arrives later in the same read. This PR follows node:
- A slot that a local frame gives back during a read is held until the read ends: END_STREAM from `end()`, `respond({ endStream: true })`, `sendTrailers()`, `res.end()`, a local RST_STREAM, and a stream that the engine resets for a malformed block. A stream refused for memory is held the same way.
- A peer RST_STREAM gives the slot back when it is read, also for a stream that is held.
- The END_STREAM of the peer gives the slot back when it is read, unless this side wrote its own END_STREAM in the same read.
- A read is one call of `rewrite_read`, with the bytes that a handler feeds to the session during it. The held slots are free when that call has flushed the frames.
- A session with no limit holds nothing.

Three requests in one write at limit 1, handler `respond()` then `end()`: node serves 1 and refuses 2. Bun 1.4.3 serves 3. This PR serves 1 and refuses 2. Before this change a session that reads from a Duplex and a session on a socket differed for `sendTrailers()`. They are the same now.

**Where it still differs from node.**
1. A stream over a limit that the client ACKed. nghttp2 makes it a connection error ([nghttp2_session.c:3889](https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_session.c#L3889-L3893)): node ends the session with `ERR_HTTP2_ERROR` and GOAWAY(INTERNAL_ERROR). This PR sends RST_STREAM(REFUSED_STREAM) and keeps the session, as 1.4.3 does and as RFC 9113 5.1.2 asks. To follow node here ends sessions that Bun keeps today. **This needs a decision from a maintainer.** No test pins it.
2. HEADERS over the limit after `goaway()` or `close()` still get RST_STREAM(7), now on the invalid-frame budget. Node ignores them. #43475 adds that.
3. A limit that `session.settings()` sets after a stream ended in the same read does not count that stream. To count it, every session with no limit would keep the list of held streams.
4. A response that ends outside a read frees its slot at once. Node frees it at its next write, which it schedules at once.
5. A peer RST_STREAM for a refused stream is not counted by the reset limit (`streamResetBurst`). Node counts it. The refusal is counted.
6. WINDOW_UPDATE with increment 0 on a refused stream gets RST_STREAM(PROTOCOL_ERROR), as on any closed stream. Node ignores it. #42467 owns that rule.

**The self-review.** It asked for three things: tests that pass on node too, node's slot timing in place of Bun-only pins, and a body that states the reach, the workaround and the order. Those are done, with these smaller items: an empty DATA frame on a refused stream is not charged, a slot is taken only for an admitted stream, a test through `http2.connect()`, a test that a client session has no limit, and the doc of `Sink::open_peer_streams`. Not taken:
- The closed-id mark in place of `refused_ids`. It is #37985 (see "The refused ids").
- One admission verdict from the embedder in place of the two `Sink` getters. The engine is where nghttp2 makes this test, and the two numbers are what the engine will own when it writes the responses too.
- One `Discard` disposition in place of the four that are not `Deliver`. It rewrites code that this PR does not need to touch.
- A cheaper `assert_peer_slots`. It walks the streams of a session once per read in builds with debug assertions. CI is green with it on every lane.

**What else changes.**
- The refusal is the same on every entry point: core API, compat API, TLS, `performServerHandshake()` over a Duplex. `session.settings()` and `server.updateSettings()` set the limit that native code reads, from the call on.
- A refused stream is not the last processed stream. `session.state.lastProcStreamID` and the GOAWAY of `close()`, `goaway()` and `destroy()` name the last admitted stream. 1.4.3 names the refused stream, so a client cannot know that it can send the request again.
- A refused request with a malformed block gets one RST_STREAM. 1.4.3 sends two.
- A first flight with large responses and `maxSessionMemory` keeps the session. A stream refused for memory holds a slot until the read ends, as in node, so the requests after it are over the limit. Limit 10, 200 KB per response, 150 requests: node 5 handlers, 5 RST_STREAM(11), 140 RST_STREAM(7). This PR: 6, 4, 140. Bun 1.4.3: 6 handlers, 100 RST_STREAM(11), GOAWAY(11).
- DATA or trailers on a refused stream in a later read get no answer and no charge, an empty DATA frame too. 1.4.3 sends RST_STREAM(STREAM_CLOSED) for the DATA frame and charges the empty one.
- A slot is taken only for a stream that the engine admitted. A `Stream` that a host function makes for an id with no entry takes none.
- The JS count had two defects. A `respond()` that failed and a later reset or end of that stream gave two slots back, so a limit of 1 admitted 2 streams. An `'aborted'` listener that throws kept the slot for the rest of the session. Both have a test.
- A limit that was never sent to the peer is not enforced: `{ maxConcurrentStreams: 5, settings: { maxConcurrentStreams: undefined } }`.
- When the allowance is used up the engine stops at that frame. 1.4.3 parsed and allocated for every remaining HEADERS frame of the chunk.

**Measurements.** The sizes and the instruction counts are from c9a12cbbf1. The hit counts, the `sendto` count and the CPU times are from 9ee2fe9f4e, before the slot timing change, which does not touch the refused path. The slot timing adds one `Vec<u32>` push for each stream that a local frame ends or closes inside a read, on a session that set a limit. A session with no limit does not push.

Debug builds of #44335 (base) and of this PR, gdb breakpoint hit counts, first flight at limit 10.

| Per refused stream | base | this PR |
|---|---|---|
| `Box<Stream>` | 1 | 0 |
| engine stream map inserts | 1 | 0 |
| JS calls | 3 | 0 |
| header blocks made into JS objects | 1 | 0 |

Per admitted stream nothing changes: 1 `Box<Stream>`, 1 map insert, the same JS calls.

| | base | this PR |
|---|---|---|
| `sendto` calls of the server, first flight of 150 at limit 10 (`maxSessionRejectedStreams` raised so that the base session stays open) | 153 | 13 |
| `size_of` legacy `Stream` | 104 | 104 |
| `size_of` engine `Stream` | 56 | 56 |
| `size_of` `Connection` | 448 | 472 |
| `size_of` `H2FrameParser` | 1496 | 1568 |

The engine alone, 200,000 refused requests in reads of 20,000 (the engine sources in a scratch crate, release profile): 244 ns per refusal, 5.1 hash slots examined per refusal in read 1 and in read 10, 0 inserts. The same engine driven as 1.4.3 drives it (open, then refuse from the embedder): 840 ns per refusal in read 1 and 61,000 ns in read 10.

Release builds of #44335 (base) and of this PR, same toolchain:

| | base | this PR |
|---|---|---|
| `.text` (`size -A`) | 58,150,389 | 58,152,437 (+2,048) |
| `.rodata` | 19,804,908 | 19,804,908 |
| `.bun_builtins` (the JS modules) | 2,629,929 | 2,629,036 (-893) |
| file | 80,836,168 | 80,836,168 |

Host functions +0, codegen entries +0.

Server CPU from `process.cpuUsage()`, N requests in one write at limit 100, the handler holds its stream. Each cell is the median of 5 sessions. Two server processes per build, run in turns:

| N | base | this PR |
|---|---|---|
| 4,000 | 28 and 26 ms | 7 and 6 ms |
| 8,000 | 62 and 52 ms | 7 and 7 ms |
| 16,000 | 104 and 103 ms | 8 and 11 ms |
| 32,000 | 204 and 210 ms | 13 and 11 ms |
| 64,000 | 290 and 356 ms | 17 and 17 ms |

That is about 6 us per refused stream on base and about 0.2 us with this PR. Both grow in step with N.

A server with no limit, 20,000 requests in one write, handler `respond()` then `end()`, the same method: base 323, 315 and 263 ms. This PR 293, 296 and 350 ms. The difference is inside the noise.

`stream.id` getter calls per served request, client and server in one process: 7 on base, 6 with this PR.

Instructions that each function executes for one request that is admitted, callees not counted. Release builds, gdb single-step, the same count on every repeat.

| Server, one GET request, no limit set | base | this PR |
|---|---|---|
| `Connection::receive` (the read with the HEADERS frame) | 297 | 311 |
| `Connection::finish_header_block` | 1487 | 1521 |
| `handle_received_stream_id` (2 calls) | 189 + 38 | 197 + 40 |
| `Stream::free_resources` | 161 | 165 |
| `rewrite_read` | 190 | 195 |
| sum | 2362 | 2429 (+67) |

| Client, one `http2.connect()` request | base | this PR |
|---|---|---|
| `Connection::receive` (the read with the response) | 486 | 475 |
| `Connection::finish_header_block` | 730 | 749 |
| `handle_received_stream_id` (3 calls) | 160 + 38 + 38 | 164 + 40 + 40 |
| `Stream::free_resources` | 104 | 108 |
| `rewrite_read` | 159 | 165 |
| sum | 1715 | 1741 (+26) |

The source of `finish_header_block` does not change on this path. Its +34 and +19 are register moves in the header loop: the compiler lays the function out in another way. The server loses the JS count for each stream: 3 `% 2` tests, 4 private-field reads, 2 writes and 1 call of the `stream.id` getter.

`perf_event_open` is not permitted in the build container, and `valgrind`, `strace` and `bloaty` are not installed. So there is no whole-process instruction count.

**The count.** `open_peer_streams` goes up where `handle_received_stream_id` makes the `Stream` of a request that the engine admitted. `Stream::release_peer_slot_now` takes the bit and goes down, so a second release does nothing. It is reached from `free_resources` and `close_unsent` (through `release_peer_slot`, which holds the slot until the read ends), from `on_peer_reset`, and from `on_stream_end` for a stream that this side ended before the read. It never reads `Stream.state`: a local half-close can write over CLOSED after a reset. `assert_peer_slots` checks in builds with debug assertions, once per read, that the count is the number of streams with the bit and that no CLOSED stream has it.

**The refused ids.** A sorted `Vec<u32>` with one entry for each refused stream. It is read only where the stream map has no entry, and the first test is one compare with the last id. It is a stand-in: #37985 adds `last_peer_stream_id`, and "a peer id at or below that mark with no entry is closed" answers the same question for every closed stream. #42467 has the same rule for DATA. When they land, `refused_ids`, `was_refused`, `remember_refused` and `BlockDisposition::Ignored` go. I asked on #37985 how to proceed, because that branch conflicts with `main` today.

**Both runtimes.** The tests of this stack are in `node-http2-max-concurrent-streams.test.ts`, written for `node:test` and `node:assert`, so the same file runs on real node: `node --test test/js/node/http2/node-http2-max-concurrent-streams.test.ts`. Node.js v26.3.0: 65 tests, 59 pass, 0 fail, 6 are skipped as Bun only (a `respond()` that fails in Bun for `weight: 0`, a parent out of range, options that are not an object, or a header block over `maxSendHeaderBlockLength`; node accepts or handles these in another way). This PR: 65 pass. On Bun 1.4.3, 29 of the 32 tests of the new block fail. The 3 others pass on both sides: a peer reset frees the slot at once, `sendTrailers()` on a Duplex, and a client's own limit. The test of #44248 that pinned the old budget is rewritten in place, as its comment asks: `a stream refused over maxConcurrentStreams does not use maxSessionRejectedStreams`.

**Suites on a debug build of c9a12cbbf1**, with a 60 s test timeout because the build machine is loaded: the 261 `test-http2-*` files of `test/js/node/test` all exit 0. All 13 files of `test/js/node/http2/` pass (`node-http2.test.js` 393 pass and 6 skip, `h2-conformance.test.ts` 84, `node-http2-max-concurrent-streams.test.ts` 65, `node-http2-rejected-streams.test.ts` 16). Of the 29 grpc-js files, 26 pass. `test-client`, `test-resolver` and `test-tonic` fail, as they do on the base in this container (they need DNS and a cargo fetch).

**Open PRs on the same lines:** #40240 (the `request()` exits and the state writers), #43475 (its arm goes in front of the limit test), #37588 (the GOAWAY last-stream-id: the new test `a refused stream is not the last stream that the session processed` guards it), #42467 (DATA on a closed stream), #41305 (the constructor lines this PR deletes), #42522, #43539.

**Left for later.**
- Four other writers charge the never-reset `rejected_streams` with `max <= count`: the memory refusal, a malformed block, an oversized header list, and `request()` over the memory limit. Node uses `count++ > max`, resets the count on each admitted stream, and charges a malformed block to `maxSessionInvalidFrames` only.
- Node's connection error after the SETTINGS ACK.
- The client side: a push response over the limit that the client advertised.
- A late HEADERS frame on an evicted stream id is still tested like a new stream.
- The legacy `Stream.state` is not final at CLOSED. Bun still answers a peer reset of some streams with its own RST_STREAM(CANCEL).
- Bun's `node:http2` client does not cap its first flight before the SETTINGS of the server arrive, as node does at 100 (`peerMaxConcurrentStreams`). For that client the session still ends, at refusal 1002. `ClientHttp2Session.request()` reads `#remoteSettings?.maxConcurrentStreams`, which is undefined until then.
- `session.settings({ enableConnectProtocol })` inside a handler applies from the next read. Node applies it from the call.
- `respond()` fails in Bun for `weight: 0`, for a parent out of range and for options that are not an object. Node accepts the first two.
- An interim fix for a patch release, if this stack waits: on 1.4.x the server option `maxSessionRejectedStreams: 1002` gives node's count.

</details>



