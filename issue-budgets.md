### What happens

A `node:http2` server in Bun ends the session with GOAWAY(ENHANCE_YOUR_CALM) at the 100th request that it rejects, for every kind of rejection. Node keeps the session in the cases below.

Bun has one counter, `rejected_streams`, that never goes back to 0, and it compares with `max <= count`. Four places add to it: a request refused for `maxSessionMemory`, a malformed header block, a header list over `maxHeaderListSize`, and `request()` over the memory limit. Node:

- counts with `rejected_stream_count_++ > max` and sets the count to 0 for each stream that it admits ([node_http2.cc:1038](https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L1035-L1050)). Only the memory refusal uses this counter.
- charges a malformed block to `maxSessionInvalidFrames` (default 1000), not to `maxSessionRejectedStreams` ([node_http2.cc:1128](https://github.com/nodejs/node/blob/v26.3.0/src/node_http2.cc#L1128-L1143)).

### Repro

A raw client sends the preface, SETTINGS and 150 requests in one write, then a PING. Each request block has a `connection: close` field, which makes it malformed (RFC 9113 8.2.2). The server is `http2.createServer()` with default options.

| | RST_STREAM(PROTOCOL_ERROR) | session |
|---|---|---|
| node v26.3.0 | 150 | open, PING answered |
| Bun 1.4.3 | 100 | GOAWAY(last stream 199, ENHANCE_YOUR_CALM), `ERR_HTTP2_SESSION_ERROR` |

### Notes

- `test/js/node/http2/node-http2.test.js` has tests that pin the current count (a GOAWAY at the first rejection with `maxSessionRejectedStreams: 0`). Node keeps the session for that first rejection.
- #44337 moves the refusal for SETTINGS_MAX_CONCURRENT_STREAMS to `maxSessionInvalidFrames`, as in node. It does not change the four writers above.
