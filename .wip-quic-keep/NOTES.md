# Work in progress: a framed DATAGRAM that lsquic cannot send yet

Temporary research files. They are removed before the pull request.

## State (2026-10-12)

The commit below this one is the first form of the fix: keep the packet in the scheduled queue
(`patches/lsquic/keep-unsent-datagram.patch`). A review of that form found the problems below.
The place of the fix is under review again. Do not open a pull request from the first form.

Binaries used (linux x64): release main 367d939d9, debug build of 8e451fb55b1 (the base, #44680),
debug build of the first form.

## Problems of the first form

A DATAGRAM-only packet that stays in the scheduled queue is a state that upstream lsquic never has.

Alarm helper (`send_ctl_ensure_retx_alarm`):
- A1. The two calls at the end of the squeeze run with no RTO in effect when the socket would block.
  The alarm rings with nothing in flight and declares RTOs that the base does not declare
  (cubic cwnd about 93 KB to 2920 B).
- A2. They use PNS_APP for a delayed Initial. In a 0-RTT handshake the alarm rings (TLP, TLP, RTO,
  RTO) and a delivered 0-RTT datagram is reported 'lost'. `review-probes/pns/`.
- A3. The gate check runs while the engine batches, before `lsquic_send_ctl_sent_packet` runs for the
  packets of the batch. The helper then sets the alarm before the regular path does: no TLP mode,
  no MAX_RTO_DELAY clamp.
- A4. `lsquic_engine_add_conn_to_attq` replaces the earlier wake-up time of the pacer with the RTO
  time. The stream retransmission can leave 0.9 to 1.7 s after the kept datagram.
- A5. On a closing connection the call at the gate leaves the connection on the ATTQ. `closed`
  settles 0.9 to 3.3 s late. `review-probes/close/linger4.test.ts`.
- A6. On a server session the extra RTO resets the path MTU (1472 to 1252) for the connection.
- A7. The two calls at the end of the squeeze are needed in states that no test builds.
  `review-probes/squeeze-alarm/x.test.ts` (MODE=x2 CC=cubic, MODE=sb CC=bbr) deadlocks without them.
  One rule in `lsquic_send_ctl_sent_packet` (a packet that used a post-RTO slot and sets no alarm
  sets the RETX alarm) recovered both under gdb (`sent.gdb`). It is not built.

Tick:
- B1. While the kept packet is at the head, the tick writes only an ACK packet. No frame can share
  the packet of an ACK through the gate, and the PING after 12 to 27 ACK-only packets is not sent.
  Stream recovery is 0.4 to 1.3 s later than on the base. `review-probes/ack-riding/`.

Renumber arm:
- C1. The chop loop runs only for an ACK+DATAGRAM packet after a send that would block. No test.
  `review-probes/ack-datagram/`.
- C3. The arm does not return the encrypted buffer (`send_ctl_return_enc_data`). A tick that the
  pacer blocks skips the squeeze, so stale ciphertext can leave.

Session ends:
- E2. A kept 0-RTT DATAGRAM packet survives a rejected 0-RTT flight as a 1-RTT packet
  (`lsquic_send_ctl_stash_0rtt_packets` walks unacked packets only). `review-probes/zero-rtt/`.
- F1. A datagram that still waits when the session ends is destroyed in
  `lsquic_send_ctl_drop_scheduled` with no status.

Tests:
- Only the renumber arm fails a test when it is removed.
- The would-block route has no test: `bsd_sendmmsg` has no fault hook (#44800 adds one).
  `review-probes/would-block/wb2.test.ts` has tests that work with the hook.
- `review-probes/late-ack/a.test.ts` pins the alarm call at the gate (late ACK).
- `review-probes/unit/test_keep_datagram.c`: 13 cases for lsquic's own unit harness.

## A stall on main with no datagram

Only a packet with a retransmittable frame sets the RETX alarm in `lsquic_send_ctl_sent_packet`.
A path MTU probe (PING+PADDING) that uses a post-RTO slot sets none. An ACK whose largest acked
packet the RTO already destroyed clears the alarm and does not clear `sc_n_consec_rtos`. The gate
(`sc_next_limit == 0`) then holds the head packet with no timer.

`review-probes/main-stall/nq-stream-stall.mjs` with `MODE=mtu` on release 367d939d9: the client
sends nothing for 20 s after the outage, 2 of 2 runs. `review-probes/h3-late-ack/run.mjs` is the
HTTP/3 form. `review-probes/gate-probe/gate3.mjs`: on the first form a framed datagram behind an
MTU probe waits until the idle timeout.

## Candidates for the second round

- Keep the packet (first form), with the alarm rules repaired, keyed on DATAGRAM or not.
- Hand the payload back inside lsquic and frame it again: `requeue-in-lsquic.diff`. The scheduled
  queue then behaves as upstream.
- Do not frame while the post-RTO limit would hold the packet. The datagram stays in the queue of
  bun, as it stays in the queue of Node. The would-block route needs one of the two above.

## How to rebuild a prototype without touching vendor/

`build-proto.sh <name>` compiles the lsquic files that differ in a scratch tree and links
`/tmp/lsq/bun-<name>` from the objects of `build/debug`. The scratch tree is the upstream tarball
plus `patches/lsquic/*.patch` in the order of `scripts/build/deps/lsquic.ts`, one git commit per
patch. `git diff <before> <after> | grep -v '^diff --git \|^index '` regenerates a patch file.
