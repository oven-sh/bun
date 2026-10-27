### Problem
- `node:quic` drops a header block that it sends while lsquic still holds part of the stream's previous one. `sendHeaders()` returns `false`, and a body or `end()` after it resets the stream (`H3_INTERNAL_ERROR`). lsquic logs `cannot send headers while previous header block is pending`.
- 24 requests answered with a 6 KB `103`, then a `200`, lose 15 responses.
- Cause: lsquic holds one unsent block per stream and answers `EAGAIN`, which `put_header_block` (`src/runtime/node/quic/stream.rs`) takes for a refusal.

### Fix
- `put_header_block` returns `Sent`, `Retry` or `Refused`. A `Retry` block waits in the stream's queue for the next write event. `sendHeaders()` returns `true`, as in Node.
- `destroy()` writes no body while lsquic can still hold part of a queued block (`may_hold_queued_block`). lsquic 4.9.4 would put it into that block's frame.
- A block that ends the write side drops the body that is not out yet.
- Verified: `test/js/node/quic/quic-stream.test.ts`, 17 new cases, 14 fail without the fix. Self-reviewed: __RAISED__ concerns raised, __ADDRESSED__ addressed.

### Background
- A header block is one HEADERS frame (`1xx`, response, trailers).
- lsquic holds what the congestion window (about 47 KB at first) has no room for.
- `Bun.serve` already resends such a block (`Http3Response::sendBufferedHeaders`). Considered a queue inside lsquic: a permanent patch against its contract.

### Downsides
- `QuicStream`: 256 to 264 bytes. `.text`: +__TEXT__ bytes. Each `node:quic` header block: +14 instructions.
- Not fixed: a body behind a later header block that lsquic got directly and still holds (`QPACK decompression error` after `destroy()`). lsquic 4.11.0 has the check.

<details><summary>Notes</summary>

**Question: the flag, or an accessor.** `may_hold_queued_block` is set when lsquic takes a queued block and cleared at lsquic's next write event. It copies a state that lsquic has. A read-only accessor under `patches/lsquic` (about 35 lines, `sm_send_headers_state != SSHS_BEGIN || sm_header_block`, the test behind the `EAGAIN`) gives the exact state. It also covers the block that lsquic got directly (the "Not fixed" line), and the flag and its `workarounds.ts` entry go. #33083 had this accessor for `Bun.serve` and was closed in favor of an lsquic update. This PR has the flag, so it carries no lsquic patch. I can change it to the accessor.

**Who meets this.** An HTTP/3 server on `node:quic` that sends a `1xx` and the response in one turn while lsquic cannot send all of the `1xx`: a burst of streams on one connection, one large block, or a small stream window. No user reported it. It was found while testing #46528.

**What the loss looks like.** Released builds (1.4.3) drop the block with no error: for the 24 requests above the client gets 24 `103`s, 9 `200`s and 24 bodies. The reset with `H3_INTERNAL_ERROR` is the rule of #46528 for a body behind a refused block.

**Counts.** Debug builds, Linux x64. `onheaders` answers each request with a `103` that has one `link` field, then a `200`.

| | before | with this change |
|---|---|---|
| 24 streams, 6 KB `link`, a body | 15 of 24 responses lost | 0 lost |
| 100 streams, 3 KB `link` | 83 of 100 lost | 0 lost |
| `curl --http3-only --parallel`, 60 GETs, 3 KB `link` (curl 8.19.0, ngtcp2) | 17 of 60 get the `200`, 43 get `reset by server (error 0x102 INTERNAL_ERROR)` | 60 of 60 get the `200` |
| 16 streams with a 3 KB `link`, or 100 streams with 1.2 KB | 0 lost | 0 lost |
| one stream, a `103` with 108 KB of fields | lost in 10 of 10 runs | lost in 0 of 10 |

**Node.** Node gives every block to nghttp3's frame queue and returns `true`: [`SendHeaders`](https://github.com/nodejs/node/blob/v26.3.0/src/quic/http3.cc#L562-L631), [`conn_submit_headers_data`](https://github.com/ngtcp2/nghttp3/blob/v1.15.0/lib/nghttp3_conn.c#L2414-L2456). This is read from source, not run: the Node in the test container has no `node:quic`.

**Since f0c5437ba2a** (the commit that was posted in #46528). The second commit of this PR has the changes.
- The early return in `drain_outbound` is in #46528 now (e76056c826), with its case. It is not in this PR.
- `destroy()` drains outside of a write event. After a queued block it could write the body while lsquic held part of that block: the client closed the whole connection with `QPACK decompression error` in 3 of 8 runs, where only that stream was reset before the queue. With `may_hold_queued_block` only that stream is reset (20 of 20 runs). The flag is not set for a stream's first block: lsquic keeps the body behind that one itself, and a request that opens behind an upload must not be reset by `destroy()`.
- A header block that ends the write side discards the body that is not out yet, as every other end of the write side does. That is true for a block from the queue and for a block that lsquic takes directly. Before, that body went into the block's frame when lsquic held part of it, or it stayed in the stream's queue behind a closed write side.
- A block that waits for lsquic to send the one before it does not report its stream as blocked (`onblocked`). It has flow-control credit. A wait for credit still reports, and so does a body that lsquic does not take, as before.
- More cases: the order of three queued blocks, a burst behind each stream's flow-control window, three `destroy()` cases, a terminal block with a body behind it, and a body after a block that was refused.

**Costs, measured.** Release builds of the base (__BASE__) and of this change.
- `us_nq_stream_send_headers`: 10 more instructions on the path that lsquic accepts, and 4 for `__errno_location` (objdump). The helper is inlined.
- `us_quic_stream_send_headers` (`Bun.serve`): 212 to 211 instructions, the same operations.
- `.text`: __TEXT_FROM__ to __TEXT_TO__ bytes. The stripped binary: __BIN__.
- `size_of::<QuicStream>()` is read from the debug builds. The new flag uses padding.
- Write events of a stream (`drain_outbound` runs, gdb breakpoint count): 1 in both builds when lsquic accepts every block, and 2 for a stream that queues a block.
- No line of `src/js`, of the bindings or of the types changes.
- valgrind, perf and strace are not in the test container, so there is no executed-instruction count for a whole request.

**Tests.** Of the 17 new cases, 14 fail on the base. The 3 others keep behavior that the base has: no block after a terminal block, a request that opens behind an upload is not reset by `destroy()`, and a burst behind each stream's flow-control window. Each clause of the change has a case that fails without it (checked with a build that switches one clause off at a time). Also run: `test/js/node/quic/` (__QUIC_PASS__ pass), `serve-http3.test.ts` (117 pass), `fetch-http3-client.test.ts` (107 pass, 1 skip), and the 235 vendored `test-quic-*` files (the same 3 fail as on the base. `test-quic-callback-error-onstream.mjs` fails in 2 of 20 runs on both builds).

**Differences from Node that stay.**
- `sendTrailers()` before the body is out sends the trailers first and ends the stream, so the body is dropped. Node sends the body first: nghttp3 keeps the trailers behind the stream's DATA entry ([`nghttp3_conn_submit_trailers`](https://github.com/ngtcp2/nghttp3/blob/v1.15.0/lib/nghttp3_conn.c#L2568-L2587)). Bun did the same before this PR when lsquic took the trailers at once. When lsquic refused them, the stream was reset. Now both cases drop the body.
- `onblocked`: Node's HTTP/3 streams never get it ([`BlockStream`](https://github.com/nodejs/node/blob/v26.3.0/src/quic/http3.cc#L352-L355)). Bun reports a wait for flow-control credit and a body that lsquic does not take. This PR does not change that.

**Not in this change.**
- lsquic 4.9.4 takes body bytes while it holds part of a header block that is not the stream's first. `may_hold_queued_block` covers the blocks of the queue, and a block that ends the stream has no body behind it any more. A block that lsquic got directly and that does not end the stream is not covered: `destroy()` right after a small `103`, a large `200` and a body still closes the connection, and so does a `Bun.serve` burst of 24 `Expect: 100-continue` requests with a 6 KB response header (8 of 24 complete).
- lsquic 4.11.0 has the check (4.10.2 and litespeedtech/lsquic#711, three hunks of `lsquic_stream.c`). As a carried patch they fix both cases above (built and run: 12 of 12 and 24 of 24). They also have a cost in `Bun.serve`: a response that the client stops while lsquic holds its header block is not given up (28 ms today for a block behind a `100`, not within 2.5 s with the patch, as for a first block today). So that patch needs a `Bun.serve` change and its own PR. `scripts/build/workarounds.ts` stops the configure step at the lsquic update until `may_hold_queued_block` is deleted. A PR that carries the check as a patch has to delete the flag itself.
- #46866 changes the same functions. The second of the two to merge needs one more cut.

**Considered.**
- A queue inside lsquic. lsquic documents that the caller sends the block again after `EAGAIN`, so the patch would stay for good.
- An update to lsquic 4.11.0. It keeps the `EAGAIN`, and it changes the default congestion controller.
- A `destroy()` that leaves an ended stream to lsquic's write events. It needs no guard, but it reverses the rule of c6596e69a4 that `destroy()` resets a stream whose header block still waits.

</details>
