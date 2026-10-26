/**
 * lsquic — Litespeed's QUIC and HTTP/3 implementation. Powers Bun.serve's
 * `http3: true` listener.
 *
 * DirectBuild: ~85 .c files from src/liblsquic. The upstream build runs a
 * Perl script to generate lsquic_versions_to_string.c at configure time;
 * we ship the generated output as a patch so DirectBuild stays declarative.
 *
 * lsquic vendors xxhash (lsquic_xxhash.c) but never calls it directly —
 * it's only there for the ls-hpack/ls-qpack submodules, which we build
 * separately. We skip it to avoid duplicate XXH32/XXH64 with lshpack.
 */

import type { Dependency, DirectBuild } from "../source.ts";
import { depBuildDir, depSourceDir } from "../source.ts";
import { lsxpackDefines } from "./lshpack.ts";

export const LSQUIC_COMMIT = "f812ceb9529e26717df78c6064a2ff648b949f3e";

// gQUIC (Google QUIC, pre-IETF) sources are excluded — Bun only negotiates
// IETF QUIC. The unconditional engine/global references to gQUIC vtables are
// satisfied by lsquic_gquic_stubs.c (added via patches/lsquic/disable-gquic.patch),
// which lets --gc-sections drop ~175 KB of cert tables + handshake code.
const liblsquic: string[] = [
  "ls-sfparser.c",
  "lsquic_adaptive_cc.c",
  "lsquic_alarmset.c",
  "lsquic_arr.c",
  "lsquic_attq.c",
  "lsquic_bbr.c",
  "lsquic_bw_sampler.c",
  "lsquic_cfcw.c",
  "lsquic_conn.c",
  "lsquic_crand.c",
  "lsquic_cubic.c",
  "lsquic_di_error.c",
  "lsquic_di_hash.c",
  "lsquic_di_nocopy.c",
  "lsquic_enc_sess_common.c",
  "lsquic_enc_sess_ietf.c",
  "lsquic_eng_hist.c",
  "lsquic_engine.c",
  "lsquic_ev_log.c",
  "lsquic_frab_list.c",
  "lsquic_full_conn_ietf.c",
  "lsquic_global.c",
  "lsquic_gquic_stubs.c",
  "lsquic_hash.c",
  "lsquic_hcsi_reader.c",
  "lsquic_hcso_writer.c",
  "lsquic_hkdf.c",
  "lsquic_hpi.c",
  "lsquic_http.c",
  "lsquic_http1x_if.c",
  "lsquic_logger.c",
  "lsquic_malo.c",
  "lsquic_min_heap.c",
  "lsquic_mini_conn_ietf.c",
  "lsquic_minmax.c",
  "lsquic_mm.c",
  "lsquic_pacer.c",
  "lsquic_packet_common.c",
  "lsquic_packet_in.c",
  "lsquic_packet_out.c",
  "lsquic_packet_resize.c",
  "lsquic_parse_common.c",
  "lsquic_parse_gquic_common.c",
  "lsquic_parse_ietf_v1.c",
  "lsquic_parse_iquic_common.c",
  "lsquic_pr_queue.c",
  "lsquic_purga.c",
  "lsquic_qdec_hdl.c",
  "lsquic_qenc_hdl.c",
  "lsquic_qlog.c",
  "lsquic_qpack_exp.c",
  "lsquic_rechist.c",
  "lsquic_rtt.c",
  "lsquic_send_ctl.c",
  "lsquic_senhist.c",
  "lsquic_set.c",
  "lsquic_sfcw.c",
  "lsquic_spi.c",
  "lsquic_stock_shi.c",
  "lsquic_str.c",
  "lsquic_stream.c",
  "lsquic_tokgen.c",
  "lsquic_trans_params.c",
  "lsquic_trechist.c",
  "lsquic_util.c",
  "lsquic_varint.c",
  "lsquic_version.c",
  "lsquic_versions_to_string.c",
];

export const lsquic: Dependency = {
  name: "lsquic",

  source: () => ({
    kind: "github-archive",
    repo: "litespeedtech/lsquic",
    commit: LSQUIC_COMMIT,
  }),

  patches: [
    "patches/lsquic/versions-to-string.patch",
    "patches/lsquic/allow-no-sni.patch",
    "patches/lsquic/skip-priority-walk.patch",
    // determine_bpt() walked all_streams with the hash's shared cursor, which
    // ietf_full_conn_ci_close() is already walking when a stream it resets
    // takes the buffered-packet path -- restarting the close loop over a hash
    // whose elements it is destroying. Applies on top of skip-priority-walk.
    "patches/lsquic/hash-nested-iter.patch",
    // ci_abort_error() raised IFC_ERROR without making the conn tickable, so
    // the CONNECTION_CLOSE that session.destroy(err, opts) asks for waited for
    // an unrelated alarm (up to a whole idle timeout) instead of the next tick.
    "patches/lsquic/abort-error-tickable.patch",
    "patches/lsquic/disable-gquic.patch",
    "patches/lsquic/requeue-unsent-coalesced.patch",
    // node:quic accessors: lsquic_engine_conn_count, lsquic_conn_get_ssl,
    // lsquic_conn_transport_params, lsquic_conn_make_uni_stream, and the
    // server-side CONNECTION_CLOSE / IFC_TIMED_OUT immediate-close fixes.
    "patches/lsquic/node-quic-accessors.patch",
    // send_packets_out() leaked every packet already coalesced into the
    // current out_spec when encrypting a later one failed.
    "patches/lsquic/coalesce-batch-drop.patch",
    // generate_connection_close_packet always used PNS_APP; pre-handshake
    // there are no 1-RTT keys, so the CONNECTION_CLOSE could
    // never be encrypted and the peer idled out instead of learning of the
    // close. Select the PNS by handshake progress, as ngtcp2 does.
    "patches/lsquic/connection-close-pns.patch",
    // A connection that sent GOAWAY answered every new peer stream with
    // STOP_SENDING, unidirectional ones included. A client that opens its
    // QPACK encoder stream after the GOAWAY (lsquic does, on a connection
    // whose first request ran server.stop()) has to treat that as
    // H3_CLOSED_CRITICAL_STREAM and closes the connection, which kills the
    // requests the graceful stop was draining. Reject only request streams.
    "patches/lsquic/goaway-accept-uni-streams.patch",
    // lsquic_prq_destroy() only frees the free list. A stateless reset whose
    // send failed is on the returned list, so destroying the engine leaks it.
    "patches/lsquic/prq-free-returned-conns.patch",
    // lsquic_conn_goaway_stream_id: on_goaway_received() does not pass the id
    // of the GOAWAY, and a second GOAWAY with a lower id was not stored.
    "patches/lsquic/goaway-stream-id.patch",
    // A server's GOAWAY named the last request it accepted, which tells the
    // client that this request was rejected. Name the one after it.
    "patches/lsquic/goaway-first-rejected-id.patch",
    // An Initial packet that carries a token left one byte for the token's
    // length, which takes two from 64 bytes on. A client that refilled its
    // ClientHello after a Retry could then fail the connection while it
    // resized a packet that was one byte too large.
    "patches/lsquic/initial-token-length.patch",
    // send_headers_ietf() encoded every header block into 64 KB on the stack
    // and failed for a larger one. Such a block gets a heap buffer, sized from
    // the header list.
    "patches/lsquic/large-header-block.patch",
    // lsquic_engine_packet_in() queues a connection even while the current pass
    // is ticking it, or already has. The pass then ticked it again and linked
    // it on its ticked list twice: an endless loop, or a failed assert in debug
    // builds. It takes a handler that runs the event loop mid-pass (Bun.build()
    // with an async plugin setup). The connection now waits for the next pass.
    "patches/lsquic/tick-once-per-pass.patch",
    // lsquic dropped every request to make a connection tickable while the
    // engine was processing (ENPUB_PROC), no matter which connection it was
    // for. When one connection's handler wrote to another connection's stream,
    // the data waited for that connection's next alarm or packet, and was lost
    // if the idle timeout came first. Only drop the request for a connection
    // the engine looks at again anyway. Applies on top of tick-once-per-pass.
    // On an lsquic bump, check that ci_tick() still has one call site and that
    // every insert into conns_tickable still tests LSCONN_TICKABLE first.
    "patches/lsquic/tickable-per-connection.patch",
    // lsquic_stream_hold_window(): receive backpressure that keeps reading the
    // stream and stops raising its receive limit. Data that
    // lsquic_stream_wantread(s, 0) leaves in a stream also uses up the
    // connection's window, and is dropped when the connection goes away.
    "patches/lsquic/hold-stream-window.patch",
    // ci_going_away() skips the GOAWAY write for a server connection that never
    // carried a request, and with it the call that makes the connection
    // tickable. Its CONNECTION_CLOSE then waited for the next alarm or packet,
    // and so did a graceful server.stop().
    "patches/lsquic/going-away-tickable.patch",
    // Cubic keeps its windows in unsigned long, which is 32 bits on Windows, and
    // multiplies them without widening. The pacing rate (cwnd * 10^6 / srtt)
    // wrapped for every window (litespeedtech/lsquic#391).
    "patches/lsquic/cubic-llp64-overflow.patch",
    // immediate_close() and ci_abort_error() took "error code != 0" to mean
    // that an error is recorded. A close with code 0 from
    // lsquic_conn_abort_error() (an application close, or a transport close
    // with a reason) went out as transport INTERNAL_ERROR.
    "patches/lsquic/abort-error-code-zero.patch",
    // lsquic_stream_is_finished(): inside on_close(), tells a stream that
    // completed on its own from one that was torn down with its connection.
    "patches/lsquic/stream-is-finished.patch",
    // lsquic_conn_make_uni_stream() dropped a request made before the handshake
    // finished. It now counts it, as it does for one that waits for stream
    // credit. lsquic_conn_cancel_pending_uni_streams() takes a request back.
    // Applies on top of node-quic-accessors.
    "patches/lsquic/delayed-uni-streams.patch",
    // on_datagram_status() reports each DATAGRAM frame as acknowledged, lost, or
    // dropped before the send, under the id that on_dg_write gave it with
    // lsquic_conn_set_datagram_id(). Applies on top of node-quic-accessors.
    "patches/lsquic/datagram-ids.patch",
    // lsquic_merge_acks() merges the ACK frames of one batch of packets. When one
    // frame's range lay inside the other's, it cut the outer range short: [16-8]
    // merged with [15-12][10-9] gave [16-12][10-9]. A late packet that only the
    // newer frame acknowledged was then declared lost.
    "patches/lsquic/merge-acks-contained-range.patch",
    // A read shutdown queued STOP_SENDING without making the connection
    // tickable. On a stream whose send side was done, the frame waited for the
    // connection's next alarm or packet.
    "patches/lsquic/stop-sending-tickable.patch",
    // A resumed client seals the application packets it builds before its
    // handshake is done with the 0-RTT keys. lsquic typed them Handshake, and
    // fixed that up only where it wrote a STREAM frame. The server couldn't open
    // a packet with only RESET_STREAM, STOP_SENDING or a BLOCKED frame, and the
    // client kept resending it that way.
    "patches/lsquic/zero-rtt-header-type.patch",
    // A bidirectional stream's initial send limit was picked by the connection's
    // role, not by who opened the stream (RFC 9000 section 18.2). The two agree
    // only for a stream the client opens, the one kind HTTP/3 has. On a stream a
    // node:quic server opens, each side sent up to the wrong window, and the
    // receiver closed the connection with FLOW_CONTROL_ERROR. Also gives a
    // unidirectional stream opened in 0-RTT the unidirectional limit when the
    // handshake completes. litespeedtech/lsquic#629 (a draft) has both changes.
    "patches/lsquic/stream-send-limit-by-initiator.patch",
    // A client enforced a limit of es_max_streams_in (gQUIC's setting, 100) on the
    // streams its server opens, and sized MAX_STREAMS credit from it, whatever
    // limit it advertised. Below 50 it never returned credit. Above 100 it closed
    // the connection on a stream it had allowed. Both roles also computed the
    // limit in 32 bits, so 2^30 streams wrapped to 0.
    "patches/lsquic/peer-stream-limits.patch",
    // A server handshake runs in a mini conn, which had no context, so node:quic
    // had to find a handshake's session again by peer address or by SSL address.
    // on_new_mini_conn gives the mini conn its context before its first packet,
    // promotion moves it to the full conn, and on_mini_conn_failed hands it back.
    // es_handshake_to_strict makes es_handshake_to bound the whole handshake.
    // Applies on top of node-quic-accessors and connection-close-pns.
    "patches/lsquic/mini-conn-ctx.patch",
    // lsquic_conn_local_transport_error(): lsquic_conn_status() has no error
    // code, and it reports an error that fails the handshake, such as a TLS
    // alert, as a version negotiation failure. Applies on top of
    // abort-error-code-zero.
    "patches/lsquic/local-transport-error.patch",
    // lsquic_stream_force_reset_ext() resets the send side only, but it dropped a
    // MAX_STREAM_DATA that was queued for the read side. The receive limit had
    // already moved, so no later read queued the frame again and the peer stayed
    // blocked. It takes a reset between lsquic_stream_hold_window(s, 0) and the
    // next tick. Applies on top of node-quic-accessors.
    "patches/lsquic/reset-keeps-window-update.patch",
    // A header block sent while the end of the body was still in the stream's
    // buffer went out inside the body's last DATA frame, with no HEADERS frame of
    // its own. The peer read trailers as body bytes, or closed the connection
    // when the block didn't fit in that frame's packet.
    "patches/lsquic/headers-after-buffered-body.patch",
  ],

  fetchDeps: ["zlib", "lshpack", "lsqpack", "boringssl"],

  build: cfg => {
    const boringssl = depSourceDir(cfg, "boringssl");
    const lshpackSrc = depSourceDir(cfg, "lshpack");
    const lsqpackSrc = depSourceDir(cfg, "lsqpack");
    const zlibBuild = depBuildDir(cfg, "zlib");
    const zlibSrc = depSourceDir(cfg, "zlib");
    const needCompatQueue = cfg.abi === "musl";
    const spec: DirectBuild = {
      kind: "direct",
      sources: [...liblsquic.map(s => "src/liblsquic/" + s), lsqpackSrc + "/lsqpack.c"],
      includes: [
        "include",
        "src/liblsquic",
        boringssl + "/include",
        lshpackSrc,
        lshpackSrc + "/deps/xxhash",
        lsqpackSrc,
        ...(cfg.windows ? ["wincompat", lsqpackSrc + "/wincompat"] : []),
        zlibBuild,
        zlibSrc,
        ...(needCompatQueue ? [lshpackSrc + "/compat/queue"] : []),
      ],
      defines: {
        ...lsxpackDefines,
        HAVE_BORINGSSL: 1,
        ...(cfg.windows ? { WIN32: 1, WIN32_LEAN_AND_MEAN: 1 } : {}),
        XXH_HEADER_NAME: "xxhash.h",
        // lsqpack.c defaults LS_QPACK_USE_LARGE_TABLES=1 internally; setting
        // it here is defensive (mirrors lshpack.ts).
        LS_QPACK_USE_LARGE_TABLES: 1,
        LS_HPACK_BSS_LARGE_TABLES: 1,
        LSQPACK_ENC_LOGGER_HEADER: "lsquic_qpack_enc_logger.h",
        LSQPACK_DEC_LOGGER_HEADER: "lsquic_qpack_dec_logger.h",
        LSQUIC_DEBUG_NEXT_ADV_TICK: 0,
        // node:quic's session.stats reads bytes/packets/retx via
        // lsquic_conn_get_info; those fields are gated on this define.
        LSQUIC_CONN_STATS: 1,
        LSQUIC_QIR: 0,
        LSQUIC_WEBTRANSPORT_SERVER_SUPPORT: 0,
      },
      cflags: [
        // -w: lsquic emits a lot of -Wsign-compare and -Wunused under -Wall;
        // upstream builds with -Werror disabled. Treat as a third-party lib.
        "-w",
        // lsquic_logger.h defaults LSQUIC_LOWEST_LOG_LEVEL to LSQ_LOG_DEBUG, so
        // every LSQ_DEBUG body and format string compiles in: `LSQ_LOG_ENABLED`
        // then gates on a runtime array lookup the optimizer cannot fold, and
        // ~1,400 call sites cost ~113 KB. Upstream's own CMake sets
        // LSQ_LOG_INFO for non-Debug builds; do the same, and keep the debug
        // messages in debug builds, where BUN_DEBUG_lsquic=1 reads them --
        // matching bun's own scoped loggers, which release already strips.
        ...(cfg.debug ? [] : ["-DLSQUIC_LOWEST_LOG_LEVEL=LSQ_LOG_INFO"]),
      ],
    };
    return spec;
  },

  provides: cfg => ({
    libs: [],
    includes: cfg.windows ? ["include", "wincompat"] : ["include"],
  }),
};
