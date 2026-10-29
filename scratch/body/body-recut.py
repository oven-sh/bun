#!/usr/bin/env python3
# Writes the description of oven-sh/bun#46881 for the cut on the tree that has #46528.
# usage: body-recut.py <out> [key=value ...]
# Values that change between runs are parameters, so that a later measurement only changes one line here.
import re
import sys

dst = sys.argv[1]
P = {
    # What the description says about the self-reviews.
    "reviewed": "Self-reviewed: 90 concerns raised, 81 addressed, 1 rejected (a byte-count minimum: timing moves it).",
    # lsquic_stream.o, release flags without LTO, on the final patch stack.
    "text_bytes": "382",
    "bss_bytes": "16",
    # Executed instructions in lsquic_stream.o for one 49,500-byte response.
    "instructions": "33 more instructions per 49,500-byte response (29,430 before)",
    "base": "main with #46528",
}
for arg in sys.argv[2:]:
    key, value = arg.split("=", 1)
    assert key in P, key
    P[key] = value

QUESTIONS = "https://github.com/oven-sh/bun/pull/46881#issuecomment-6482225269"
REFERENCE = "https://github.com/oven-sh/bun/pull/46881#issuecomment-6482220754"
ASKED = "https://github.com/oven-sh/bun/pull/46528#issuecomment-6400763226"
BUMP = "https://github.com/oven-sh/bun/issues/33082#issuecomment-4849840143"

visible = f"""### Problem
- lsquic sends past the peer's MAX_DATA (node:quic: MAX_STREAM_DATA too): a release server delivers 161,007 bytes into a 136,000-byte window. Debug builds stop: ``Assertion `stream->conn_pub->conn_cap.cc_sent <= stream->conn_pub->conn_cap.cc_max' failed``. `frame_hq_gen_read` charges a frame header with no check.
- Header blocks that fill the peer's connection window stall: 40 responses with 1,000-byte fields deliver nothing into 12,000 bytes.
- Behind a 100 Continue, a body lands in a waiting HEADERS frame: 15 of 40 `Bun.serve` responses arrive.

### Fix
- `frame-header-credit.patch`: the writer stops before a frame header without credit. `frame-header-credit-waits.patch` counts the stops for tests (`bun:internal-for-testing`).
- `flush-blocked-buffered-stream.patch`: a write-queue stream without progress calls lsquic's `maybe_flush_stream()`.
- `write-while-headers-pending.patch`: upstream a9616720af and 555de41db3 refuse a write while a header block waits.
- Verified: 13 test rows (`quic-stream.test.ts`, `serve-http3.test.ts`). Without the patches, debug fails 13 and release 12. {P["reviewed"]}

### Background
- MAX_DATA limits a connection's bytes, MAX_STREAM_DATA a stream's. HTTP/3 frame headers count.
- A header block that waits in lsquic (for a packet, credit, or QPACK) has an unpaid HEADERS frame.
- A maintainer asked for this after #46528 ({ASKED}).
- Considered: an lsquic bump (removes only the third patch), a flush in bun (a STREAM frame more per response). Questions: {QUESTIONS}.

### Downsides
- Cost: {P["text_bytes"]} bytes of `.text`, {P["bss_bytes"]} of `.bss`, and {P["instructions"]}. The counter ships in release builds.
- With a used-up window, 100 responses take 523 STREAM frames, not 430.
- Open: a node:quic response with no body keeps its FIN until MAX_DATA.

"""

notes = f"""<details><summary>Notes</summary>

**The edits, and the test that fails without each.** All edits are in `lsquic_stream.c`. lsquic's asserts are off on every CI lane, so only a test can fail there.

| Patch | Edit | Without it | Test |
| --- | --- | --- | --- |
| credit | `stream_write_avail_with_frames` counts the stream's credit with a signed value | a header block goes out past MAX_STREAM_DATA | "a HEADERS frame that has no stream credit waits for it" |
| credit | connection's window in `frame_hq_gen_read` | a flush writes a frame header past MAX_DATA | "a HEADERS frame that has no connection credit waits for it" (2 rows) |
| credit | stream's window in `frame_hq_gen_read` | a flush writes a frame header past MAX_STREAM_DATA | the same stream test: it passes only when lsquic counted a stop for stream credit |
| flush | `maybe_flush_stream()` from the write dispatch | the stall | "header blocks that use up the peer's connection window" (4 rows), "Bun.serve HTTP/3 responses that use up the client's connection window in one turn all arrive" |
| flush | flush target in `stream_flush_nocheck` | `SMQF_WANT_FLUSH` stays set with an empty buffer (a debug build stops in 16 of 3,246 unit configurations) | none |
| write check | the condition in `COMMON_WRITE_CHECKS` | the body goes into the HEADERS frame | "Bun.serve HTTP/3 responses behind a 100 Continue keep the body out of a header block that waits" (2 rows) |
| write check | `sm_write_avail` after a block is kept | a final header block that waits for the QPACK encoder stream never leaves, and lsquic calls the writer without end (16 s of CPU in 18 s) | "... arrive when the client's SETTINGS come with the request's content" |
| write check | the reset check comes first | a write after STOP_SENDING returns 0 and not an error | none. Upstream's `tests/test_send_headers.c` |

**How the tests prove that they reached the state.** A release build of this tree has no lsquic log (`#ifdef BUN_DEBUG` in `packages/bun-usockets/src/quic.c`). So lsquic counts how often `frame_hq_gen_read` stops in front of a frame header, one count for connection credit and one for stream credit, and the tests read the counts through `bun:internal-for-testing`. The connection tests run their fixture up to 4 times and need one run with a stop. On this machine every run had one (30 of 30 release runs, for both rows).

**What puts the stream back on the write queue when MAX_DATA arrives.** Nothing has to, because the stream never leaves it. `send_headers_ietf` sets `SMQF_WANT_WRITE` when it keeps a block, and bun cannot clear that flag while the block waits. `process_max_data_frame` raises `cc_max`, the tick walks `write_streams`, `stream_writeable()` is true again, and `on_write_header_wrapper` writes the block. The credit fixture checks this end to end: after the relay lets the client's MAX_DATA through, all 170 responses end whole.

**Reach.** No user has reported one of these defects: this tracker has 0 issues for `MAX_DATA`, `cc_sent`, `frame_hq_gen_read` and `maybe_flush_stream`.

- The overrun needs a connection window that many responses use up at the same time, and a peer that does not raise it in between. A bun client on the same machine raises it first, so the test keeps the client's MAX_DATA from the server with a UDP relay.
- The stall needs header blocks of one turn that are larger than the client's connection window. 100 responses with a 1,000-byte header field stall into windows of up to 100,000 bytes. `Bun.serve` allows 100 streams per connection, and curl 8.14.1 advertises 786,432 bytes.
- Only node:quic reaches the stream's window. `Bun.serve` sends at most two header blocks per stream, and lsquic refuses a peer whose windows are below 4,096 bytes.
- The 100 Continue defect needs no small window. One POST with `expect: 100-continue` whose response has a 2,000-byte header field, beside one 5 MB download on the same connection, gets its 100 and no response without the third patch (3 of 3), and gets the response with it (3 of 3). The defect needs an `Expect` header, a final header block of more than about 1,150 bytes, a first body write of 1 to about 1,150 bytes, and a connection that is busy.

**Two layers hold a header block.** node:quic keeps a later block in its own queue while lsquic reports no room to write, which is below 3 bytes of stream or connection credit (`must_wait_for_credit`, from #46528). lsquic holds a block from there up to the size of its frame header, and every block that it took with credit and no packet. This PR corrects the doc comment of `must_wait_for_credit` and leaves the code.

**Other ways.**

- An lsquic bump. For the state behind #33082 a maintainer asked for a bump and not a patch ({BUMP}). A bump to v4.11.1 removes only the third patch: v4.11.1 has the same `frame_hq_gen_read`, the same two asserts, and one caller of `maybe_flush_stream()`. 22 of the 34 lsquic patches of #46528 apply to v4.11.1 unchanged.
- A hold in bun's `us_quic_stream_write()` in place of the third patch. bun cannot see a block that waits for the QPACK encoder stream, so the late-SETTINGS test still fails with it.
- A flush where bun hands a block over. It needs 4 calls for 6 sites, sends 203 STREAM frames where lsquic sends 103 for 100 small responses, and cannot see the state: the streams that stall still had credit at hand-over.
- The credit patch alone. Bytes stay parked in 70,368 of 72,000 unit configurations. So the credit patch and the flush go together, after the write check.

**Measurements.** On one linux-x64 machine, on {P["base"]}.

- With the patches: the 13 rows pass on a debug build and on a release build (30 of 30 release runs). Release build: `quic-stream.test.ts` (119), `serve-http3.test.ts` (120, 2 skipped), `quic-endpoint.test.ts` (42, 2 skipped), `quic-sni.test.ts` (20), `fetch-http3-client.test.ts` (108), `test/js/node/test/parallel/test-quic-*.mjs` (233 of 235: the other two import `node:stream/iter`, which does not exist). Debug build: `quic-stream.test.ts` (119) and `serve-http3.test.ts` (122).
- Without the three patches: a debug build fails all 13 rows. A release build fails 12 in every run, and the 100 Continue row for the first flight of a connection in 2 of 20 runs.
- With the third patch alone: the three 100 Continue rows that need no small window pass.
- `lsquic_stream.o`, release flags without LTO: `.text` 38,912 to 39,294 bytes. The counter is 117 of the 382. No patch adds an allocation, a system call or a pass over the streams.
- Instructions that `lsquic_stream.o` executes per stream, counted by single-stepping a driver in the scaffolding of lsquic's `tests/test_h3_framing.c`, mean of 10 streams: a header block with a 49,500-byte body 29,430 to 29,463, a header block alone 2,137 to 2,140, a 103 in front 30,754 to 30,790, trailers behind 30,738 to 30,778. Of the 33, the credit check is 11, the flush 2, the write check 16, the counter 3.
- STREAM frames end to end, measured on main before #46528: 100 small responses into a 1 MiB window give 210 with and without the patches. 100 responses with 3,000-byte bodies into a 30,000-byte window give 430 without and 523 with, in 296 and 295 packets.
- Four unit cases for the first two patches fail on lsquic at the pin with this tree's other patches, and on v4.11.1 (2f4cd42f) as it is. They pass with the two patches. Upstream's `tests/test_h3_framing.c` passes with all four. The cases are in {REFERENCE}.
- Earlier heads of these patches ran through unit sweeps on main's patch stack and on an earlier head of #46528: 74,368 cases at the window edges (0 change from right to wrong), 72,000 configurations of the stall (0 stalled), 3,246 of a flush that ends with a packet (0 stop), 4,056 at the edge of both windows (0 pass a limit, where lsquic at the pin passes one in 548). The sweeps did not run again on this tree.

**Not fixed here.**

- A node:quic HTTP/3 response that ends after its header block with no body (`sendHeaders(h)`, then `writer.endSync()`) keeps its FIN while the peer's connection window is used up. bun sends the FIN from the stream's write event, and lsquic gives none without credit. `sendHeaders(h, {{ terminal: true }})` is not affected.
- `sendTrailers()` while body bytes are still in bun's own queue. The peer gets the trailers and loses the body.
- The first two patches have no upstream report. A draft is in {REFERENCE}. A person has to file it.

</details>
"""

body = visible + notes
vis_words = [w for w in re.split(r"\s+", visible) if w and w not in ("-", "###")]
for line in body.split("\n"):
    assert "\u2014" not in line and "\u2013" not in line, line
open(dst, "w").write(body)
print("ok", len(body), "bytes; visible words", len(vis_words))
