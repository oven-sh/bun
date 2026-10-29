#!/usr/bin/env python3
# Writes the description of the first of the two PRs: the backport of lsquic's write check.
# usage: body-a.py <out> [key=value ...]
import re
import sys

dst = sys.argv[1]
P = {
    "reviewed": "Self-reviewed with #46881: 99 concerns raised, 77 addressed, 1 rejected (a byte-count minimum: timing moves it).",
    "second": "#46881",
}
for arg in sys.argv[2:]:
    key, value = arg.split("=", 1)
    assert key in P, key
    P[key] = value

BUMP = "https://github.com/oven-sh/bun/issues/33082#issuecomment-4849840143"
NODE_QUIC_PLAN = "https://github.com/oven-sh/bun/pull/46528#issuecomment-6397987907"

visible = f"""### Problem
- Behind a 100 Continue, `Bun.serve` loses HTTP/3 responses. Stock curl 8.14.1 gets 3 to 16 of 40 POSTs with `Expect: 100-continue` answered by 1.4.3 (30 ms round trip, default windows). The others end with `ERR_QPACK_FATAL` or `ERR_QPACK_DECOMPRESSION_FAILED`.
- lsquic 4.9.4 takes a body write while the final header block still waits, and puts the bytes into that block's HEADERS frame (`COMMON_WRITE_CHECKS` in `lsquic_stream.c`).
- It also calls the writer while such a block waits for the QPACK encoder stream: the block never leaves, and one core stays busy.

### Fix
- `patches/lsquic/write-while-headers-pending.patch` carries upstream a9616720af (4.10.2) and 555de41db3 (4.11.0). A write returns 0 while a header block waits.
- bun's callers already treat that 0 as backpressure.
- Verified: 3 rows of "Bun.serve HTTP/3 responses behind a 100 Continue" in `serve-http3.test.ts`. A debug build without the patch fails all 3. {P["reviewed"]}

### Background
- A 1xx response and the final response are two header blocks on one stream. lsquic keeps a block that it cannot write at once.
- The other way is a bump to lsquic v4.11.1, which has both commits: for #33082 the ask was a bump ({BUMP}). It needs work in 5 of 34 lsquic patches and changes the default congestion controller. Say so, and I send the bump.
- {P["second"]} (the credit check) follows this PR.

### Downsides
- Cost: 80 bytes of `.text`, 16 more instructions per 49,500-byte response (29,430 before).
- One more carried patch. It stops applying at 4.11.0.

"""

notes = f"""<details><summary>Notes</summary>

**The edits, and the test that fails without each.** All three are upstream's, in `lsquic_stream.c`.

| Edit | Without it | Test |
| --- | --- | --- |
| the condition in `COMMON_WRITE_CHECKS` | the body goes into the HEADERS frame of the block that waits | "keep the body out of a header block that waits" (2 rows) |
| `sm_write_avail` after `send_headers_ietf` keeps a block | a final header block that waits for the QPACK encoder stream never leaves, and lsquic calls the writer without end (16 s of CPU in 18 s) | "arrive when the client's SETTINGS come with the request's content" |
| the reset check comes first | a write after STOP_SENDING returns 0 and not an error | none. Upstream's `tests/test_send_headers.c` |

**Reach.** No user has reported this. It needs an `Expect` header (or another 1xx in front of the final response), a final header block of more than about 1,150 bytes, a first body write of 1 to about 1,150 bytes, and a connection that is busy.

- curl 8.14.1 (nghttp3 1.8.0) through a UDP relay that adds 15 ms each way, 40 POSTs with `-H 'Expect: 100-continue'` on one connection, a 3,000-byte response header field and a 10-byte body: 3 to 16 of 40 get their 200 from 1.4.3 (4 runs), and 2 to 12 of 40 from this tree without the patch (4 runs). With the patch 40 of 40 do (4 runs).
- Over loopback with no delay curl gets all 40 from 1.4.3. The congestion window is never full there.
- bun's own client over loopback: 15 of 40 responses arrive, and the others never do. One POST beside one 5 MB download gets its 100 and no response (3 of 3).
- The row for the first flight of a connection is a guard more than a proof. Without the patch it fails on a debug build, and in 2 of 20 runs on a release build.

**The callers.** `lsquic_stream_write()` now returns 0 while a header block of the stream waits. `us_quic_stream_write()` (`packages/bun-usockets/src/quic.c`) passes that on, `Http3Response` keeps the bytes in its backpressure buffer, `QuicStream::drain_outbound` (`src/runtime/node/quic/stream.rs`) keeps them in its queue, and the HTTP/3 client (`src/http/h3_client/encode.rs`) waits for the next write event.

**The lsquic bump.** v4.11.1 (2f4cd42f) has both commits. Of the 34 lsquic patches on this tree, 28 apply to it unchanged and one with fuzz. Five need work, 7 hunks in all: `node-quic-accessors` (1 of 96), `connection-close-pns` (1 of 6), `abort-error-code-zero` (2 of 4), `cubic-llp64-overflow` (2 of 2) and `merge-acks-contained-range` (1 of 1). Upstream has its own fix for the Cubic overflow and for the close code 0. v4.11.0 also removes the adaptive congestion controller, which is the default at the pin, and makes BBRv1 the default.

**A later node:quic change.** A planned node:quic PR ({NODE_QUIC_PLAN}) queues a header block that lsquic refuses, and keeps a body back with a flag in `QuicStream` so that lsquic does not put it into a block that waits. This patch does that in lsquic for every caller, so the flag is not needed with it.

**Measurements.** On one linux-x64 machine.

- `lsquic_stream.o`, release flags without LTO: `.text` 38,912 to 38,992 bytes.
- Instructions that `lsquic_stream.o` executes per stream, counted by single-stepping a driver in the scaffolding of lsquic's `tests/test_h3_framing.c`, mean of 10 streams: a header block with a 49,500-byte body 29,430 to 29,446, a header block alone 2,137 to 2,137, a 103 in front 30,754 to 30,770.
- The patch file reverse-applies to v4.11.1, so upstream has every hunk.

</details>
"""

body = visible + notes
vis_words = [w for w in re.split(r"\s+", visible) if w and w not in ("-", "###")]
for line in body.split("\n"):
    assert "\u2014" not in line and "\u2013" not in line, line
open(dst, "w").write(body)
print("ok", len(body), "bytes; visible words", len(vis_words))
