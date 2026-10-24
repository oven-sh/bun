/**
 * lsquic — Litespeed's QUIC and HTTP/3 implementation. Powers Bun.serve's
 * `http3: true` listener.
 *
 * DirectBuild: ~85 .c files from src/liblsquic. The upstream build runs a
 * Perl script to generate lsquic_versions_to_string.c at configure time;
 * we ship the generated output as a patch so DirectBuild stays declarative.
 *
 * lsquic vendors xxhash (lsquic_xxhash.c) but never calls it directly —
 * it's only there for the ls-hpack/ls-qpack submodules. lsqpack.c is built
 * here with the xxhash it bundles itself, so we skip lsquic's copy.
 */

import type { Dependency, DirectBuild } from "../source.ts";
import { depBuildDir, depSourceDir } from "../source.ts";
import { lsxpackDefines } from "./lsqpack.ts";

const LSQUIC_COMMIT = "f812ceb9529e26717df78c6064a2ff648b949f3e";

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
    // lsquic_http1x_if.c includes lshpack.h only for lsxpack_header.h, which
    // lsquic has itself. ls-hpack is called by the gQUIC sources, which are not
    // built.
    "patches/lsquic/no-lshpack-include.patch",
  ],

  fetchDeps: ["zlib", "lsqpack", "boringssl"],

  build: cfg => {
    const boringssl = depSourceDir(cfg, "boringssl");
    const lsqpackSrc = depSourceDir(cfg, "lsqpack");
    const zlibBuild = depBuildDir(cfg, "zlib");
    const zlibSrc = depSourceDir(cfg, "zlib");
    const needCompatQueue = cfg.abi === "musl";
    const spec: DirectBuild = {
      kind: "direct",
      sources: [
        ...liblsquic.map(s => "src/liblsquic/" + s),
        lsqpackSrc + "/lsqpack.c",
        lsqpackSrc + "/deps/xxhash/xxhash.c",
      ],
      includes: [
        "include",
        "src/liblsquic",
        boringssl + "/include",
        lsqpackSrc,
        lsqpackSrc + "/deps/xxhash",
        ...(cfg.windows ? ["wincompat", lsqpackSrc + "/wincompat"] : []),
        zlibBuild,
        zlibSrc,
        // <sys/queue.h> ships with glibc and BSD libc but not musl. wincompat/
        // holds nothing else.
        ...(needCompatQueue ? [lsqpackSrc + "/wincompat"] : []),
      ],
      defines: {
        ...lsxpackDefines,
        HAVE_BORINGSSL: 1,
        ...(cfg.windows ? { WIN32: 1, WIN32_LEAN_AND_MEAN: 1 } : {}),
        XXH_HEADER_NAME: "xxhash.h",
        // lsqpack.c defaults LS_QPACK_USE_LARGE_TABLES=1 internally; setting
        // it here is purely defensive so the bss-huff-tables patch can't be
        // silently disabled by a future upstream change to the default.
        LS_QPACK_USE_LARGE_TABLES: 1,
        LS_QPACK_BSS_LARGE_TABLES: 1,
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
