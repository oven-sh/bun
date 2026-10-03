import re
s=open('/tmp/h2repro/pr2-body.md').read()
def rep(old,new,count=1):
    global s
    assert s.count(old)==count,(s.count(old),old[:80])
    s=s.replace(old,new)
rep('- Verified: `test/js/node/http2/node-http2-rejected-streams.test.ts` (27 tests fail before, 72 of 78 pass on node v26.3.0, 6 are Bun only) and the 261 `test-http2-*` node tests.',
    '- Verified: `test/js/node/http2/node-http2-max-concurrent-streams.test.ts`, written for `node:test` (29 tests fail before, node v26.3.0 passes 59 and skips 6 that are Bun only), and the 261 `test-http2-*` node tests.')
a=s.index('**Slot timing.**'); b=s.index('**Where it still differs from node.**')
s=s[:a]+'''**Slot timing.** nghttp2 closes a stream when it writes the frame that ends it, and node writes after nghttp2 has read the whole chunk. So a stream that the handler ends inside a read has its slot until that read ends. Bun 1.4.3 frees the slot when the handler returns, and serves a request that arrives later in the same read. This PR follows node:
- A slot that a local frame gives back during a read is held until the read ends: END_STREAM from `end()`, `respond({ endStream: true })`, `sendTrailers()`, `res.end()`, a local RST_STREAM, and a stream that the engine resets for a malformed block. A stream refused for memory is held the same way.
- A peer RST_STREAM gives the slot back when it is read, also for a stream that is held.
- The END_STREAM of the peer gives the slot back when it is read, unless this side wrote its own END_STREAM in the same read.
- A read is one call of `rewrite_read`, with the bytes that a handler feeds to the session during it. The held slots are free when that call has flushed the frames.
- A session with no limit holds nothing.

Three requests in one write at limit 1, handler `respond()` then `end()`: node serves 1 and refuses 2. Bun 1.4.3 serves 3. This PR serves 1 and refuses 2. Before this change a session that reads from a Duplex and a session on a socket differed for `sendTrailers()`. They are the same now.

'''+s[b:]
rep('''3. A stream from an earlier read that the handler ends during this read, before the END_STREAM of the peer in the same read: the slot is free at that END_STREAM. Node holds it until the read ends.
4. A limit that `session.settings()` sets after a stream ended in the same read does not count that stream.
5. A peer RST_STREAM for a refused stream is not counted by the reset limit (`streamResetBurst`). Node counts it. The refusal is counted.
6. WINDOW_UPDATE with increment 0 on a refused stream gets RST_STREAM(PROTOCOL_ERROR), as on any closed stream. Node ignores it. #42467 owns that rule.
''','''3. A limit that `session.settings()` sets after a stream ended in the same read does not count that stream. To count it, every session with no limit would keep the list of held streams.
4. A response that ends outside a read frees its slot at once. Node frees it at its next write, which it schedules at once.
5. A peer RST_STREAM for a refused stream is not counted by the reset limit (`streamResetBurst`). Node counts it. The refusal is counted.
6. WINDOW_UPDATE with increment 0 on a refused stream gets RST_STREAM(PROTOCOL_ERROR), as on any closed stream. Node ignores it. #42467 owns that rule.
''')
a=s.index('**Both runtimes.**'); b=s.index('**Suites on a debug build:**')
s=s[:a]+'''**Both runtimes.** The tests of this stack are in `node-http2-max-concurrent-streams.test.ts`, written for `node:test` and `node:assert`, so the same file runs on real node: `node --test test/js/node/http2/node-http2-max-concurrent-streams.test.ts`. Node.js v26.3.0: 65 tests, 59 pass, 0 fail, 6 are skipped as Bun only (a `respond()` that fails in Bun for `weight: 0`, a parent out of range, options that are not an object, or a header block over `maxSendHeaderBlockLength`; node accepts or handles these in another way). This PR: 65 pass. On Bun 1.4.3, 29 of the 32 tests of the new block fail. The 3 others pass on both sides: a peer reset frees the slot at once, `sendTrailers()` on a Duplex, and a client's own limit. The test of #44248 that pinned the old budget is rewritten in place, as its comment asks: `a stream refused over maxConcurrentStreams does not use maxSessionRejectedStreams`.

'''+s[b:]
a=s.index('**The count.**'); b=s.index('**The refused ids.**')
s=s[:a]+'''**The count.** `open_peer_streams` goes up where `handle_received_stream_id` makes the `Stream` of a request that the engine admitted. `Stream::release_peer_slot_now` takes the bit and goes down, so a second release does nothing. It is reached from `free_resources` and `close_unsent` (through `release_peer_slot`, which holds the slot until the read ends), from `on_peer_reset`, and from `on_stream_end` for a stream that this side ended before the read. It never reads `Stream.state`: a local half-close can write over CLOSED after a reset. `assert_peer_slots` checks in builds with debug assertions, once per read, that the count is the number of streams with the bit and that no CLOSED stream has it.

'''+s[b:]
open('/tmp/h2repro/pr2-body-new.md','w').write(s)
vis=s.split('<details>')[0]
print('visible words without markers', len(re.findall(r'\S+', re.sub(r'(?m)^(###|-)\s', '', vis))))
