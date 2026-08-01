# h2-default bench

Measures `fetch()` with `BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT` on vs off
against a local HTTP/2-capable TLS server (`allowHTTP1: true`, ALPN decides).

Step 1 of the Deno→Bun perf sweep item "HTTP/2 is off by default for fetch".

## Run

```sh
# clean loopback
bun bench.ts --bun /path/to/release/bun --reps 7 --label clean

# simulated 1% loss + 60ms RTT (userspace proxy, no CAP_NET_ADMIN needed)
bun bench.ts --bun /path/to/release/bun --reps 5 --label lossy --lossy \
  --delay 30 --loss 0.01 --rto 200

# real packet-level loss (needs root; macOS)
sudo bash lossy.sh /path/to/release/bun
```

`lossy.sh` is written for Linux `tc netem`; on macOS replace with:
```sh
sudo dnctl pipe 1 config delay 30 plr 0.01
echo "dummynet out proto tcp from any to any port $SRVPORT pipe 1" | sudo pfctl -f -
```

## Files

- `server.ts`   local h2+h1 TLS server, counts secureConnections / h2 sessions
- `client.ts`   fires N concurrent fetches, emits one JSON row
- `bench.ts`    driver: server + N×{4,16,100,500}×{h1,h2}×reps, median table
- `lossy-proxy.ts`  userspace byte-stream proxy, per-chunk delay + probabilistic stall
- `lossy.sh`    wraps bench.ts with `tc netem` (Linux, needs CAP_NET_ADMIN)
- `warm-pool.ts` probe: does a warm h1 keepalive socket pin H1OrH2 to h1?
- `tls.ts`      self-signed cert (SAN: localhost, 127.0.0.1, ::1)

## Results @ HEAD (df49a6e1c)

### Clean loopback (median of 7, 4KB payload)

| N   | h1 wall | h2 wall | speedup | h1 sockets | h2 sockets |
| --- | ------- | ------- | ------- | ---------- | ---------- |
| 4   | 7.3ms   | 3.7ms   | 2.0x    | 4          | 1          |
| 16  | 35.3ms  | 4.7ms   | 7.5x    | 15         | 1          |
| 100 | 188.8ms | 10.1ms  | 18.7x   | ~98        | 1          |
| 500 | 567.5ms | 53.1ms  | 10.7x   | ~255       | 2          |

RSS flat ~30-40MB both modes. TTFB p50 tracks wall. h1 caps at ~255 sockets
for N=500 (keepalive pool reuse, not the fd limit).

### Simulated loss (1% / 60ms RTT, median of 5)

| N   | h1 wall | h2 wall  | winner |
| --- | ------- | -------- | ------ |
| 4   | 188ms   | 153ms    | h2     |
| 16  | 388ms   | 426ms    | h1     |
| 100 | 478ms   | 2826ms   | h1 (5.9x) |
| 500 | 893ms   | 5815ms   | h1 (6.5x) |

**Caveat**: `lossy-proxy.ts` stalls at byte-stream level per `write()` chunk,
not per TCP segment. h2 sends ~N× more chunks through its one connection than
each h1 connection does, so it rolls ~N× more loss dice. Real packet loss with
SACK/fast-retransmit recovers multiple losses per RTT; this model does not.
Direction is correct (TCP HOL is real); magnitude is pessimistic. The
authoritative lossy number needs `tc netem` / `dnctl` on bare metal.

### Warm-pool pinning (step 3, bullet 3)

Confirmed: with the h2 flag on, `fetch(url, {protocol:"http1.1"})` followed
by default `fetch(url)` reuses the pooled h1 socket and never upgrades.
`existing_socket()` matches an h1 pooled socket for `H1OrH2` requests
(HTTPContext.rs:725-731), and `connect()` only checks `active_h2_sessions` /
`pending_h2_connects` before the keepalive pool; an idle h1 socket is neither.

### Not measured

- **Real CDN**: container egress is via `HTTP_PROXY` and `can_offer_h2()`
  returns false when `http_proxy.is_some()`, so CDN fetches stay h1 regardless.
  Needs a proxy-free host.
- **`active_h2_sessions` linear scan**: at 500-way same-origin only 2-3
  sessions exist (`has_headroom()` opens a second at the server's
  MAX_CONCURRENT_STREAMS). Linear scan over 3 entries is noise. Would need
  many distinct origins to matter.

## Compat sweep (step 4)

Ran `test/js/web/fetch/` twice each with the flag off and on (release @ HEAD);
diffed the stable-in-both-runs failure sets.

**Regressions with flag on: 1** (expected):
- `fetch() over HTTP/2 (BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT) > flag off: ALPN does not offer h2`
  — asserts the flag's current default; needs inverting when the default flips.

**Tests that pass only with flag on: ~12**
- All `it.concurrent` in `fetch.test.ts` hitting a shared `httpsServer`.
  With h1 each concurrent fetch opens its own TLS connection and the pack
  exhausts something (fds/accept backlog) and times out; with h2 they
  multiplex on one session. These are pre-existing h1 flakes that h2 avoids.

**`node:https.request()` unaffected.** It routes through `tls.connect()` +
llhttp (`src/js/node/_http_client.ts`), never touches `src/http/lib.rs`.
The flag changes `fetch()` only.

### User-visible response deltas (`deltas.ts`)

| field | h1 | h2 |
| --- | --- | --- |
| `res.headers.get("connection")` | `"keep-alive"` | `null` |
| `res.headers.get("keep-alive")` | `"timeout=5"` | `null` |
| header name casing | lowercase | lowercase |
| `res.status`, `res.type`, `res.redirected` | same | same |
| abort error | `AbortError` code 20 | `AbortError` code 20 |

The absent `Connection`/`Keep-Alive` headers are RFC 9113 §8.2.2-correct
(connection-specific headers are not sent over h2). User code that reads them
would observe `null` instead of a value. undici (`allowH2:false` by default)
keeps these present, so this is the one Node-compat delta to call out in
release notes.
