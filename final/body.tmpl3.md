### Problem
- A `node:http2` server ends the session with GOAWAY(ENHANCE_YOUR_CALM) and `ERR_HTTP2_SESSION_ERROR` at the 100th stream over the SETTINGS_MAX_CONCURRENT_STREAMS it advertised. Node keeps the session until refusal 1002.
- Cause: JS refuses the stream after the engine opened it (`src/js/node/http2.ts:4053`) and charges `maxSessionRejectedStreams`. #31584 added that charge on the premise that nghttp2 does the same. It does not.
- Reach: a client that sends 100 streams over the limit before it reads SETTINGS, like Bun's `http2.connect()`. No user report.

### Fix
- `Connection::handle_headers` refuses the stream before it makes a stream entry: RST_STREAM(REFUSED_STREAM), charged to `maxSessionInvalidFrames`, like node.
- `H2FrameParser` counts the open peer streams in a `Cell<u32>`. The JS count is deleted.
- Verified: `test/js/node/http2/node-http2-max-concurrent-streams.test.ts` (22 tests fail before). Its last test runs the file on Node.js. Also all of `test/js/node/http2/` and node's `test-http2-*` tests.
- Self-reviewed: SELF_REVIEW_LINE

### Background
- The engine (`connection.rs`) parses inbound frames. `H2FrameParser` embeds it and writes responses.
- A refused stream has no engine entry. `refused_ids` keeps later frames on its id without a second answer (Notes).
- Considered and removed: holding the slot of an ended stream until the read ends. It cannot follow node's writes (Notes).
- Two questions for a maintainer are in Notes: the budget move, and a limit that the client ACKed.

### Downsides
- A server that lowered `maxSessionInvalidFrames` ends the session at refusal max + 2, as node does.
- `refused_ids` keeps 4 bytes for each refused stream. The invalid-frame budget bounds it: 4 KB at the default.
- Cost: COST_LINE

<details><summary>Notes</summary>

**What is in this PR.** It targets `main` and has one commit for each part:
1. #44248, as it is (three commits). When #44248 lands, I rebase and they go.
2. The pins: 33 tests that say when a stream gives its slot back, and two helpers (`Connection::count_invalid_frame`, `H2FrameParser::close_unsent`). No behaviour change. This was #44335.
3. The limit: the part that the Fix bullets describe.

Earlier attempt: #32675 (closed). This PR keeps its decision point (refuse in `handle_headers` before `on_stream_open`) and the O(1) count that was asked for there.

**Reach.** Two kinds of client, measured with the public API against a server with limit 10.

| Client, requests, handler | node v26.3.0 server | Bun 1.4.3 server | this PR |
|---|---|---|---|
| Bun `http2.connect()`, 150 at once, handler answers after 100 ms | 10 served, 140 refused | 0 served, session ends | 10 served, 140 refused |
| node client, 300 at once, handler answers after 100 ms | 210 served, 90 refused | 210 served, 90 refused | 210 served, 90 refused |
| node client, 300 at once, handler answers at once | 210 served, 90 refused | 300 served | 300 served |

A client on nghttp2 holds its first flight to 100 streams, so it gets at most 100 refusals at once and sees no change. A client with no such cap (Bun's own, and grpc-js on Bun) loses every call of the burst on 1.4.x, the admitted ones too. On 1.4.x the server option `maxSessionRejectedStreams: 1002` gives node's count.

**History.** Bun 1.3.14 did not enforce the limit: every request reached a handler. #31584 added the enforcement in JS and, after two review findings ([r3337691981](https://github.com/oven-sh/bun/pull/31584#discussion_r3337691981), [r3345228319](https://github.com/oven-sh/bun/pull/31584#discussion_r3345228319)), the charge to `maxSessionRejectedStreams`. The second finding says "nghttp2 counts concurrency-limit REFUSED_STREAM toward the rejected-streams cap". Node's `rejected_stream_count_` counts the streams that node itself turns away for memory ([node_http2.cc:1035](https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L1035-L1050)). A stream over the limit never reaches that code: nghttp2 refuses it and reports an invalid frame ([nghttp2_session.c:3905](https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_session.c#L3905-L3908)), and node charges `maxSessionInvalidFrames` with `count++ > max` ([node_http2.cc:1128](https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L1128-L1143)). The flood bound that #31584 wanted stays, at 1000 in place of 100.

**Repro.** Server `http2.createServer({ settings: { maxConcurrentStreams: 10 } })`, handler `stream.respond({ ":status": 200 }); stream.write("hello")`. A raw client sends the preface, an empty SETTINGS frame and N complete requests in one write, then a PING.

| N | node v26.3.0 | Bun 1.4.3 | this PR |
|---|---|---|---|
| 150 | 140 RST_STREAM(7), session open | 99 RST_STREAM(7), GOAWAY(last 219, code 11) | 140 RST_STREAM(7), session open |
| 1011 | 1001 RST_STREAM(7), session open | same as above | 1001 RST_STREAM(7), session open |
| 1012 | 1002 RST_STREAM(7), `ERR_HTTP2_TOO_MANY_INVALID_FRAMES` | same as above | 1002 RST_STREAM(7), `ERR_HTTP2_TOO_MANY_INVALID_FRAMES`, GOAWAY(last 19, code 2) |

**Two questions for a maintainer.**
1. The budget. This PR moves the refusal from `maxSessionRejectedStreams` (100) to `maxSessionInvalidFrames` (1000), which is what node does and the opposite of what #31584 chose. cirospaciari merged #31584, so the question is for him: is that move right?
2. A stream over a limit that the client ACKed. nghttp2 makes it a connection error ([nghttp2_session.c:3889](https://github.com/nodejs/node/blob/v26.3.0/deps/nghttp2/lib/nghttp2_session.c#L3889-L3893)): node ends the session with `ERR_HTTP2_ERROR` and GOAWAY(INTERNAL_ERROR). Bun 1.4.x refuses the stream and counts it (99 are kept). This PR refuses the stream and counts it on the other budget (1001 are kept). RFC 9113 5.1.2 asks for a stream error. The choices are node's connection error, the old budget for this one case, or what this PR does. No test pins it.

**Where it still differs from node.**
- Slot timing. Bun gives a slot back when the stream closes, which is when the handler has ended the response. Node gives it back when nghttp2 has written the frame that closes the stream. Node writes at several points, some of them inside a read, and the points depend on the transport. So Bun can serve a request that node refuses: three GET requests in one write at limit 1, with a handler that answers at once, are all served by Bun 1.4.3 and by this PR, and node serves one. This PR does not change it. One test pins it and is marked Bun only.
- An earlier version of this PR held the slot until the read ended, to follow node. A review measured that the rule cannot follow node's writes: with `respond(); end(); destroy()` node serves 300 of 300 requests of a node client and the rule served 210. It also took 90 requests from a node client that Bun 1.4.3 serves. It is removed.
- HEADERS over the limit after `goaway()` or `close()` still get RST_STREAM(7), now on the invalid-frame budget. Node ignores them. #43475 adds that.
- A GOAWAY that the engine writes for a connection error names the highest stream id that it has read, a refused one too. Node names the last stream that it processed. #37588 owns that id. The GOAWAY of `close()`, `goaway()` and `destroy()` is right.
- Node has two more gates on this path that Bun does not have: `CanAddStream` (a refusal for memory, RST_STREAM(ENHANCE_YOUR_CALM)) is tested after the limit as here, and nghttp2's glitch rate limit (#42522).
- The engine takes the limit test when the whole HEADERS frame has arrived. nghttp2 takes it at the 9-byte frame header.
- Node resets a stream whose response ended and whose request body nobody read, with RST_STREAM(NO_ERROR), one turn later. Bun does that only when body bytes are buffered or arrive (on purpose, since #32488). So an answered upload that sends nothing more keeps its slot in Bun.
- A peer RST_STREAM for a refused stream is not counted by the reset limit (`streamResetBurst`). Node counts it. The refusal is counted.
- WINDOW_UPDATE with increment 0 on a refused stream gets RST_STREAM(PROTOCOL_ERROR), as on any closed stream. Node ignores it. #45801 owns that rule.

**What else changes.**
- The refusal is the same on every entry point: core API, compat API, TLS, `performServerHandshake()` over a Duplex. `session.settings()` and `server.updateSettings()` set the limit that native code reads, from the call on.
- A refused stream is not the last processed stream. `session.state.lastProcStreamID` and the GOAWAY of `close()`, `goaway()` and `destroy()` name the last admitted stream. 1.4.3 names the refused stream, so a client cannot know that it can send the request again.
- A refused request with a malformed block gets one RST_STREAM. 1.4.3 sends two.
- A frame on a refused stream gets no second answer and no second charge, in the same read and in a later one. That is DATA (an empty frame and a frame that a read cuts in two also) and a trailer block. Frames on stream 3, which the server refused at limit 1:

  | Client sends after the refused HEADERS frame | node v26.3.0 | Bun 1.4.3 | this PR |
  |---|---|---|---|
  | 2 DATA frames, same write | RST_STREAM(7) | RST_STREAM(7) | RST_STREAM(7) |
  | 2 DATA frames, later write | RST_STREAM(7) | RST_STREAM(7), 2 RST_STREAM(5) | RST_STREAM(7) |
  | a trailer block, same write | RST_STREAM(7) | RST_STREAM(7) | RST_STREAM(7) |
  | a trailer block, later write | RST_STREAM(7) | 2 RST_STREAM(7), RST_STREAM(1) | RST_STREAM(7) |
- A slot is taken only for a stream that the engine admitted. A `Stream` that a host function makes for an id with no entry takes none.
- The JS count had two defects. A `respond()` that failed and a later reset or end of that stream gave two slots back, so a limit of 1 admitted 2 streams. An `'aborted'` listener that throws kept the slot for the rest of the session. Both have a test.
- A limit that was never sent to the peer is not enforced: `{ maxConcurrentStreams: 5, settings: { maxConcurrentStreams: undefined } }`.
- When the allowance is used up the engine stops at that frame. 1.4.3 parsed and allocated for every remaining HEADERS frame of the chunk.

**Not changed.** Three other rejections still end the session at the 100th: a malformed block, an oversized header list and a refusal for `maxSessionMemory`. 150 malformed requests: node answers 150 and keeps the session, Bun ends it at the 100th. Node's rule sets its count back to 0 for each admitted stream, which takes away a bound that Bun has today, so that change needs its own decision. A first flight with large responses therefore still ends on the memory budget.

**The count.** `open_peer_streams` goes up where `handle_received_stream_id` makes the `Stream` of a request that the engine admitted. `Stream::release_peer_slot` takes the bit and goes down, so a second call does nothing. It is called from `free_resources` and from `close_unsent`, and from nowhere else. It never reads `Stream.state`: a local half-close can write over CLOSED after a reset. `assert_peer_slots` checks in builds with debug assertions, once per read, that the count is the number of streams with the bit and that no CLOSED stream has it.

**The refused ids.** A refused stream has no engine entry, so a later frame on its id finds nothing. On 1.4.3 the engine still has the entry of a refused stream for the rest of the read, so the frames that follow in the same write get no answer. Node gives them no answer in any read. One of the pins holds that, and without a record of the refused ids this PR fails it (DATA gets RST_STREAM(STREAM_CLOSED), a trailer block is refused a second time). `refused_ids` is that record: a sorted `Vec<u32>` with one entry for each refused stream. `handle_headers` and the two DATA paths read it, and the first test is one compare with the last id. It keeps the last 2048 ids at most (8 KB). The default budgets end a session before it has refused that many streams, so only a server that raised them can drop an id. A frame on a dropped id gets the reply that `main` gives today.

A review asked for the commit of #37985 in place of the list. That commit reads every client id at or below the highest id, with no entry, as a closed stream. I did not take it. Jarred's note on #31359 ([r3295037991](https://github.com/oven-sh/bun/pull/31359#discussion_r3295037991)) says why that rule needs care: Bun's own client can write stream ids out of order (#37568 is the client half). #45801 leaves that rule out for the same reason. The list is exact for the ids that this server refused and says nothing about any other id. When #37985 and #45801 land, the list can go.

**Both runtimes.** The tests are written for `node:test` and `node:assert`. In Bun the last test of the file runs the same file on Node.js, as `node-http-agent-free-socket.test.ts` does, so CI checks both. Node.js v26.3.0: 59 tests, 52 pass, 0 fail, 7 are skipped as Bun only. Six of those need a `respond()` that fails, and the calls that make it fail in Bun (`weight: 0`, a parent out of range, options that are not an object, a header block over `maxSendHeaderBlockLength`) do not fail on node. The seventh pins the slot timing above. This PR: 60 pass. Bun 1.4.3: 22 of the 26 tests of the new block fail. The test of #44248 that pinned the old budget is rewritten in place, as its comment asks.

**The self-review.** SELF_REVIEW_BLOCK

**Suites on a debug build:** SUITES_LINE

**Measurements.** MEASURE_BLOCK

**Left for later.**
- Bun's `node:http2` client does not hold its first flight to 100 streams before the SETTINGS of the server arrive (`peerMaxConcurrentStreams`). For that client the session still ends, at refusal 1002. `ClientHttp2Session.request()` reads `#remoteSettings?.maxConcurrentStreams`, which is undefined until then.
- `session.settings({ enableConnectProtocol })` inside a handler applies from the next read. Node applies it from the call.
- `#connections`, the JS count of the streams of a session, is given back twice after a `respond()` that fails.
- After a `respond()` that fails, the server writes no RST_STREAM, and the entries of the stream stay until the peer resets it. `main` does the same. The slot is given back at once, as on 1.4.3. #43478 and #43419 remove two of the ways to make `respond()` fail.
- A stream whose `streamStart` makes no JS stream (it threw, or an exception was pending) stays open until the peer resets it, and it holds its slot for that time. The JS count of 1.4.3 did not count such a stream. Node resets it.
- #43478: `respond()` fails in Bun for `weight: 0` and for a parent out of range. Node accepts both.
- #43539: Bun answers a peer reset of some streams with its own RST_STREAM(CANCEL).
- The client side: a push response over the limit that the client advertised.

</details>
