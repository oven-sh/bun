/**
 * lsquic — Litespeed's QUIC and HTTP/3 implementation. Powers Bun.serve's
 * `h3: true` listener.
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

const LSQUIC_COMMIT = "3181911301b1aa4f54c1ed690901abc674ee08fb";

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
  versionMacro: "LSQUIC",

  source: () => ({
    kind: "github-archive",
    repo: "litespeedtech/lsquic",
    commit: LSQUIC_COMMIT,
  }),

  patches: [
    "patches/lsquic/versions-to-string.patch",
    "patches/lsquic/allow-no-sni.patch",
    "patches/lsquic/skip-priority-walk.patch",
    "patches/lsquic/disable-gquic.patch",
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
        HAVE_BORINGSSL: 1,
        ...(cfg.windows ? { WIN32: 1, WIN32_LEAN_AND_MEAN: 1 } : {}),
        XXH_HEADER_NAME: "xxhash.h",
        LSQPACK_ENC_LOGGER_HEADER: "lsquic_qpack_enc_logger.h",
        LSQPACK_DEC_LOGGER_HEADER: "lsquic_qpack_dec_logger.h",
        LSQUIC_DEBUG_NEXT_ADV_TICK: 0,
        LSQUIC_CONN_STATS: 0,
        LSQUIC_QIR: 0,
        LSQUIC_WEBTRANSPORT_SERVER_SUPPORT: 0,
      },
      // -w: lsquic emits a lot of -Wsign-compare and -Wunused under -Wall;
      // upstream builds with -Werror disabled. Treat as a third-party lib.
      cflags: ["-w"],
    };
    return spec;
  },

  provides: cfg => ({
    libs: [],
    includes: cfg.windows ? ["include", "wincompat"] : ["include"],
  }),
};
