# Work in progress: keep a framed DATAGRAM that lsquic cannot send yet

Temporary research files. They are removed before the pull request.

## Findings (debug builds of 8e451fb55b1, linux x64)

- Repro `drop-before-send.mjs`: exit 1 on the base, 3 of 3. Log lines: "sc_n_consec_rtos: 1, sc_next_limit is 0", then "Dropping packet #22 from scheduled queue" three times.
- Prototype 1 (keep the packet in `lsquic_send_ctl_squeeze_sched`, renumber it under PO_REPACKNO with the DATAGRAM frame kept): repro exits 0, 3 of 3.
- Prototype 1 stalls a connection that the base does not stall. `hazard-1.mjs` with `N=2 SETTLE_MS=8000 OUTAGE_MS=2500`: the base resends the stream packet at each RTO and the server has the stream data 518 ms after the outage ends. Prototype 1 sends the kept datagram packet at RTO #2 and then nothing for 25 s. Cause: the kept packet makes `have_delayed_packets` true in the RTO tick, the tick leaves before `lsquic_send_ctl_reschedule_packets`, and a DATAGRAM-only packet arms no retransmission alarm.
- The base has the same stall class with path MTU probes (PADDING+PING, not retransmittable): `hazard-1.mjs` with `MODE=idle N=3 SETTLE_MS=9000 OUTAGE_MS=2500` sends nothing after the outage on the base.
- Prototype 2 (`lsquic-proto2.diff`) = prototype 1 plus two rules. (a) In the tick, when no data packet is delayed, reschedule the lost packets before the early exit. (b) In `lsquic_send_ctl_next_packet_to_send`, when a packet waits behind `sc_next_limit == 0` and the RETX alarm is not set, set it.
  - repro: exit 0, 3 of 3
  - `hazard-1.mjs N=2`: stream data 345 ms after the outage ends
  - `hazard-1.mjs MODE=idle N=3`: stream data 1663 ms after the outage ends (base: never)
  - `resend-cycle.mjs`: 'lost' callbacks in a 3 s outage 350 and 475 on the base, 32 and 35 with prototype 2. Datagram packets on the wire in the outage: 29 and 30 against 29 and 34.
  - `test/js/node/quic/` 40 pass, `serve-http3.test.ts` 73 pass, `fetch-http3-*.test.ts` 101 pass.
- About one datagram packet is framed per tick: `write_datagram` offers the last scheduled packet again, `on_dg_write` returns -1 when the next datagram does not fit, and the loop ends.
- Draft tests (`draft-datagram.test.ts.txt`): 3 pass with prototype 2, 3 fail on the base.

## How to rebuild a prototype without touching vendor/

`build-proto.sh <name>` compiles the lsquic files that differ in a scratch tree and links `/tmp/lsq/bun-<name>` from the objects of `build/debug`.
The scratch tree is the upstream tarball plus `patches/lsquic/*.patch` in the order of `scripts/build/deps/lsquic.ts`, one git commit per patch.
`git diff <before> <after> | grep -v '^diff --git \|^index '` regenerates `node-quic-accessors.patch` byte for byte.
