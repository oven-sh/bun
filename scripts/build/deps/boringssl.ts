/**
 * BoringSSL — Google's OpenSSL fork. Provides TLS, all crypto primitives,
 * and the x509 machinery that node:crypto needs.
 *
 * DirectBuild: BoringSSL ships its full source manifest at gen/sources.json
 * and pre-generated perlasm output under gen/{bcm,crypto}/, so there's no
 * configure or codegen step — just compile the lists. Every .S file
 * self-guards on `OPENSSL_X86_64` / `OPENSSL_AARCH64` / `__ELF__` etc.
 * (via <openssl/asm_base.h>), so the wrong-target ones assemble to empty
 * objects; cmake compiles all of them too.
 *
 * Source lists below are extracted verbatim from gen/sources.json. To regen
 * after a commit bump:
 *
 *   bun -e 'const j=require("./vendor/boringssl/gen/sources.json");
 *           const f=l=>l.map(JSON.stringify).join(", ");
 *           for(const k of ["bcm","crypto","ssl","decrepit"])
 *             console.log(k,"\n",f(j[k].srcs));
 *           console.log("asm\n",f([...j.bcm.asm,...j.crypto.asm]));
 *           console.log("nasm\n",f([...j.bcm.nasm,...j.crypto.nasm]))'
 */

import type { Dependency, DirectBuild } from "../source.ts";

const BORINGSSL_COMMIT = "0c5fce43b7ed5eb6001487ee48ac65766f5ddcd1";

export const boringssl: Dependency = {
  name: "boringssl",
  versionMacro: "BORINGSSL",

  source: () => ({
    kind: "github-archive",
    repo: "oven-sh/boringssl",
    commit: BORINGSSL_COMMIT,
  }),

  build: cfg => {
    // win-x64 uses NASM-syntax .asm; everything else (including win-aarch64)
    // uses gas .S that clang assembles.
    const asm = cfg.windows && cfg.x64 ? NASM : ASM;

    const spec: DirectBuild = {
      kind: "direct",
      lang: "cxx",
      sources: [...BCM_SRCS, ...CRYPTO_SRCS, ...SSL_SRCS, ...DECREPIT_SRCS, ...asm],
      includes: ["include"],
      defines: {
        BORINGSSL_IMPLEMENTATION: true,
        ...(cfg.linux && { _XOPEN_SOURCE: 700 }),
        ...(cfg.windows && {
          _HAS_EXCEPTIONS: 0,
          WIN32_LEAN_AND_MEAN: true,
          NOMINMAX: true,
          _CRT_SECURE_NO_WARNINGS: true,
        }),
      },
      cflags: [
        "-std=c++17",
        "-fno-exceptions",
        "-fno-rtti",
        "-fno-strict-aliasing",
        "-fno-common",
        ...(cfg.windows ? [] : ["-fvisibility=hidden", "-Wa,--noexecstack"]),
      ],
      // nasm needs -I with a trailing slash and CodeView debug info to
      // match cmake's `-gcv8`.
      nasmflags: ["-fwin64", "-gcv8", `-I./vendor/boringssl/gen/`],
    };
    return spec;
  },

  provides: () => ({
    libs: [],
    includes: ["include"],
  }),
};

// ───────────────────────────────────────────────────────────────────────────
// Source lists — see file comment for regen instructions.
// ───────────────────────────────────────────────────────────────────────────

// prettier-ignore
const BCM_SRCS = [
  "crypto/fipsmodule/bcm.cc",
];
// prettier-ignore
const CRYPTO_SRCS = [
  "crypto/aes/aes.cc", "crypto/asn1/a_bitstr.cc", "crypto/asn1/a_bool.cc",
  "crypto/asn1/a_d2i_fp.cc", "crypto/asn1/a_dup.cc", "crypto/asn1/a_gentm.cc",
  "crypto/asn1/a_i2d_fp.cc", "crypto/asn1/a_int.cc", "crypto/asn1/a_mbstr.cc",
  "crypto/asn1/a_object.cc", "crypto/asn1/a_octet.cc", "crypto/asn1/a_strex.cc",
  "crypto/asn1/a_strnid.cc", "crypto/asn1/a_time.cc", "crypto/asn1/a_type.cc",
  "crypto/asn1/a_utctm.cc", "crypto/asn1/asn1_lib.cc", "crypto/asn1/asn1_par.cc",
  "crypto/asn1/asn_pack.cc", "crypto/asn1/f_int.cc", "crypto/asn1/f_string.cc",
  "crypto/asn1/posix_time.cc", "crypto/asn1/tasn_dec.cc", "crypto/asn1/tasn_enc.cc",
  "crypto/asn1/tasn_fre.cc", "crypto/asn1/tasn_new.cc", "crypto/asn1/tasn_typ.cc",
  "crypto/asn1/tasn_utl.cc", "crypto/base64/base64.cc", "crypto/bio/bio.cc",
  "crypto/bio/bio_mem.cc", "crypto/bio/connect.cc", "crypto/bio/errno.cc", "crypto/bio/fd.cc",
  "crypto/bio/file.cc", "crypto/bio/hexdump.cc", "crypto/bio/pair.cc", "crypto/bio/printf.cc",
  "crypto/bio/socket.cc", "crypto/bio/socket_helper.cc", "crypto/blake2/blake2.cc",
  "crypto/bn/bn_asn1.cc", "crypto/bn/convert.cc", "crypto/bn/div.cc",
  "crypto/bn/exponentiation.cc", "crypto/bn/sqrt.cc", "crypto/buf/buf.cc",
  "crypto/bytestring/asn1_compat.cc", "crypto/bytestring/ber.cc", "crypto/bytestring/cbb.cc",
  "crypto/bytestring/cbs.cc", "crypto/bytestring/unicode.cc", "crypto/chacha/chacha.cc",
  "crypto/cipher/derive_key.cc", "crypto/cipher/e_aesctrhmac.cc", "crypto/cipher/e_aeseax.cc",
  "crypto/cipher/e_aesgcmsiv.cc", "crypto/cipher/e_chacha20poly1305.cc", "crypto/cipher/e_des.cc",
  "crypto/cipher/e_null.cc", "crypto/cipher/e_rc2.cc", "crypto/cipher/e_rc4.cc",
  "crypto/cipher/e_tls.cc", "crypto/cipher/get_cipher.cc", "crypto/cipher/tls_cbc.cc",
  "crypto/cms/cms.cc", "crypto/conf/conf.cc", "crypto/cpu_aarch64_apple.cc",
  "crypto/cpu_aarch64_fuchsia.cc", "crypto/cpu_aarch64_linux.cc", "crypto/cpu_aarch64_openbsd.cc",
  "crypto/cpu_aarch64_sysreg.cc", "crypto/cpu_aarch64_win.cc", "crypto/cpu_arm_freebsd.cc",
  "crypto/cpu_arm_linux.cc", "crypto/cpu_intel.cc", "crypto/crypto.cc",
  "crypto/curve25519/curve25519.cc", "crypto/curve25519/curve25519_64_adx.cc",
  "crypto/curve25519/spake25519.cc", "crypto/des/des.cc", "crypto/dh/dh_asn1.cc",
  "crypto/dh/params.cc", "crypto/digest/digest_extra.cc", "crypto/dsa/dsa.cc",
  "crypto/dsa/dsa_asn1.cc", "crypto/ec/ec_asn1.cc", "crypto/ec/ec_derive.cc",
  "crypto/ec/hash_to_curve.cc", "crypto/ecdh/ecdh.cc", "crypto/ecdsa/ecdsa_asn1.cc",
  "crypto/ecdsa/ecdsa_p1363.cc", "crypto/engine/engine.cc", "crypto/err/err.cc",
  "crypto/evp/evp.cc", "crypto/evp/evp_asn1.cc", "crypto/evp/evp_ctx.cc", "crypto/evp/evp_kem.cc",
  "crypto/evp/p_dh.cc", "crypto/evp/p_dsa.cc", "crypto/evp/p_ec.cc", "crypto/evp/p_ed25519.cc",
  "crypto/evp/p_hkdf.cc", "crypto/evp/p_mldsa.cc", "crypto/evp/p_mlkem.cc", "crypto/evp/p_rsa.cc",
  "crypto/evp/p_x25519.cc", "crypto/evp/pbkdf.cc", "crypto/evp/print.cc", "crypto/evp/scrypt.cc",
  "crypto/evp/sign.cc", "crypto/ex_data.cc", "crypto/fipsmodule/fips_shared_support.cc",
  "crypto/fuzzer_mode.cc", "crypto/hpke/hpke.cc", "crypto/hrss/hrss.cc", "crypto/kyber/kyber.cc",
  "crypto/lhash/lhash.cc", "crypto/md4/md4.cc", "crypto/md5/md5.cc", "crypto/mem.cc",
  "crypto/mldsa/mldsa.cc", "crypto/mlkem/mlkem.cc", "crypto/obj/obj.cc", "crypto/obj/obj_xref.cc",
  "crypto/pem/pem_all.cc", "crypto/pem/pem_info.cc", "crypto/pem/pem_lib.cc",
  "crypto/pem/pem_oth.cc", "crypto/pem/pem_pk8.cc", "crypto/pem/pem_pkey.cc",
  "crypto/pem/pem_x509.cc", "crypto/pem/pem_xaux.cc", "crypto/pkcs7/pkcs7.cc",
  "crypto/pkcs7/pkcs7_x509.cc", "crypto/pkcs8/p5_pbev2.cc", "crypto/pkcs8/pkcs8.cc",
  "crypto/pkcs8/pkcs8_x509.cc", "crypto/poly1305/poly1305.cc", "crypto/poly1305/poly1305_arm.cc",
  "crypto/poly1305/poly1305_vec.cc", "crypto/pool/pool.cc", "crypto/rand/deterministic.cc",
  "crypto/rand/fork_detect.cc", "crypto/rand/forkunsafe.cc", "crypto/rand/getentropy.cc",
  "crypto/rand/ios.cc", "crypto/rand/passive.cc", "crypto/rand/rand.cc", "crypto/rand/trusty.cc",
  "crypto/rand/urandom.cc", "crypto/rand/windows.cc", "crypto/rc4/rc4.cc", "crypto/refcount.cc",
  "crypto/ripemd/ripemd.cc", "crypto/rsa/rsa_asn1.cc", "crypto/rsa/rsa_crypt.cc",
  "crypto/rsa/rsa_extra.cc", "crypto/rsa/rsa_print.cc", "crypto/sha/sha1.cc",
  "crypto/sha/sha256.cc", "crypto/sha/sha512.cc", "crypto/siphash/siphash.cc",
  "crypto/slhdsa/slhdsa.cc", "crypto/spake2plus/spake2plus.cc", "crypto/stack/stack.cc",
  "crypto/thread.cc", "crypto/thread_none.cc", "crypto/thread_pthread.cc", "crypto/thread_win.cc",
  "crypto/trust_token/pmbtoken.cc", "crypto/trust_token/trust_token.cc",
  "crypto/trust_token/voprf.cc", "crypto/x509/a_digest.cc", "crypto/x509/a_sign.cc",
  "crypto/x509/a_verify.cc", "crypto/x509/algorithm.cc", "crypto/x509/asn1_gen.cc",
  "crypto/x509/by_dir.cc", "crypto/x509/by_file.cc", "crypto/x509/i2d_pr.cc",
  "crypto/x509/name_print.cc", "crypto/x509/policy.cc", "crypto/x509/rsa_pss.cc",
  "crypto/x509/t_crl.cc", "crypto/x509/t_req.cc", "crypto/x509/t_x509.cc",
  "crypto/x509/t_x509a.cc", "crypto/x509/v3_akey.cc", "crypto/x509/v3_akeya.cc",
  "crypto/x509/v3_alt.cc", "crypto/x509/v3_bcons.cc", "crypto/x509/v3_bitst.cc",
  "crypto/x509/v3_conf.cc", "crypto/x509/v3_cpols.cc", "crypto/x509/v3_crld.cc",
  "crypto/x509/v3_enum.cc", "crypto/x509/v3_extku.cc", "crypto/x509/v3_genn.cc",
  "crypto/x509/v3_ia5.cc", "crypto/x509/v3_info.cc", "crypto/x509/v3_int.cc",
  "crypto/x509/v3_lib.cc", "crypto/x509/v3_ncons.cc", "crypto/x509/v3_ocsp.cc",
  "crypto/x509/v3_pcons.cc", "crypto/x509/v3_pmaps.cc", "crypto/x509/v3_prn.cc",
  "crypto/x509/v3_purp.cc", "crypto/x509/v3_skey.cc", "crypto/x509/v3_utl.cc",
  "crypto/x509/x509.cc", "crypto/x509/x509_att.cc", "crypto/x509/x509_cmp.cc",
  "crypto/x509/x509_d2.cc", "crypto/x509/x509_def.cc", "crypto/x509/x509_ext.cc",
  "crypto/x509/x509_lu.cc", "crypto/x509/x509_obj.cc", "crypto/x509/x509_req.cc",
  "crypto/x509/x509_set.cc", "crypto/x509/x509_trs.cc", "crypto/x509/x509_txt.cc",
  "crypto/x509/x509_v3.cc", "crypto/x509/x509_vfy.cc", "crypto/x509/x509_vpm.cc",
  "crypto/x509/x509cset.cc", "crypto/x509/x509name.cc", "crypto/x509/x509rset.cc",
  "crypto/x509/x509spki.cc", "crypto/x509/x_algor.cc", "crypto/x509/x_all.cc",
  "crypto/x509/x_attrib.cc", "crypto/x509/x_crl.cc", "crypto/x509/x_exten.cc",
  "crypto/x509/x_name.cc", "crypto/x509/x_pubkey.cc", "crypto/x509/x_req.cc",
  "crypto/x509/x_sig.cc", "crypto/x509/x_spki.cc", "crypto/x509/x_x509.cc",
  "crypto/x509/x_x509a.cc", "crypto/xwing/xwing.cc", "gen/crypto/err_data.cc",
];
// prettier-ignore
const SSL_SRCS = [
  "ssl/bio_ssl.cc", "ssl/d1_both.cc", "ssl/d1_lib.cc", "ssl/d1_pkt.cc", "ssl/d1_srtp.cc",
  "ssl/dtls_method.cc", "ssl/dtls_record.cc", "ssl/encrypted_client_hello.cc", "ssl/extensions.cc",
  "ssl/handoff.cc", "ssl/handshake.cc", "ssl/handshake_client.cc", "ssl/handshake_server.cc",
  "ssl/s3_both.cc", "ssl/s3_lib.cc", "ssl/s3_pkt.cc", "ssl/ssl_aead_ctx.cc", "ssl/ssl_asn1.cc",
  "ssl/ssl_buffer.cc", "ssl/ssl_cert.cc", "ssl/ssl_cipher.cc", "ssl/ssl_credential.cc",
  "ssl/ssl_file.cc", "ssl/ssl_key_share.cc", "ssl/ssl_lib.cc", "ssl/ssl_privkey.cc",
  "ssl/ssl_session.cc", "ssl/ssl_stat.cc", "ssl/ssl_transcript.cc", "ssl/ssl_versions.cc",
  "ssl/ssl_x509.cc", "ssl/t1_enc.cc", "ssl/tls13_both.cc", "ssl/tls13_client.cc",
  "ssl/tls13_enc.cc", "ssl/tls13_server.cc", "ssl/tls_method.cc", "ssl/tls_record.cc",
];
// prettier-ignore
const DECREPIT_SRCS = [
  "decrepit/bio/base64_bio.cc", "decrepit/blowfish/blowfish.cc", "decrepit/cast/cast.cc",
  "decrepit/cast/cast_tables.cc", "decrepit/cfb/cfb.cc", "decrepit/des/cfb64ede.cc",
  "decrepit/dh/dh_decrepit.cc", "decrepit/dsa/dsa_decrepit.cc", "decrepit/evp/dss1.cc",
  "decrepit/evp/evp_do_all.cc", "decrepit/obj/obj_decrepit.cc", "decrepit/rc4/rc4_decrepit.cc",
  "decrepit/rsa/rsa_decrepit.cc", "decrepit/ssl/ssl_decrepit.cc", "decrepit/x509/x509_decrepit.cc",
  "decrepit/xts/xts.cc",
];
// prettier-ignore
const ASM = [
  "gen/bcm/aes-gcm-avx2-x86_64-apple.S", "gen/bcm/aes-gcm-avx2-x86_64-linux.S",
  "gen/bcm/aes-gcm-avx512-x86_64-apple.S", "gen/bcm/aes-gcm-avx512-x86_64-linux.S",
  "gen/bcm/aesni-gcm-x86_64-apple.S", "gen/bcm/aesni-gcm-x86_64-linux.S",
  "gen/bcm/aesni-x86-apple.S", "gen/bcm/aesni-x86-linux.S", "gen/bcm/aesni-x86_64-apple.S",
  "gen/bcm/aesni-x86_64-linux.S", "gen/bcm/aesv8-armv7-linux.S", "gen/bcm/aesv8-armv8-apple.S",
  "gen/bcm/aesv8-armv8-linux.S", "gen/bcm/aesv8-armv8-win.S", "gen/bcm/aesv8-gcm-armv8-apple.S",
  "gen/bcm/aesv8-gcm-armv8-linux.S", "gen/bcm/aesv8-gcm-armv8-win.S", "gen/bcm/armv4-mont-linux.S",
  "gen/bcm/armv8-mont-apple.S", "gen/bcm/armv8-mont-linux.S", "gen/bcm/armv8-mont-win.S",
  "gen/bcm/bn-586-apple.S", "gen/bcm/bn-586-linux.S", "gen/bcm/bn-armv8-apple.S",
  "gen/bcm/bn-armv8-linux.S", "gen/bcm/bn-armv8-win.S", "gen/bcm/bsaes-armv7-linux.S",
  "gen/bcm/co-586-apple.S", "gen/bcm/co-586-linux.S", "gen/bcm/ghash-armv4-linux.S",
  "gen/bcm/ghash-neon-armv8-apple.S", "gen/bcm/ghash-neon-armv8-linux.S",
  "gen/bcm/ghash-neon-armv8-win.S", "gen/bcm/ghash-ssse3-x86-apple.S",
  "gen/bcm/ghash-ssse3-x86-linux.S", "gen/bcm/ghash-ssse3-x86_64-apple.S",
  "gen/bcm/ghash-ssse3-x86_64-linux.S", "gen/bcm/ghash-x86-apple.S", "gen/bcm/ghash-x86-linux.S",
  "gen/bcm/ghash-x86_64-apple.S", "gen/bcm/ghash-x86_64-linux.S", "gen/bcm/ghashv8-armv7-linux.S",
  "gen/bcm/ghashv8-armv8-apple.S", "gen/bcm/ghashv8-armv8-linux.S", "gen/bcm/ghashv8-armv8-win.S",
  "gen/bcm/p256-armv8-asm-apple.S", "gen/bcm/p256-armv8-asm-linux.S",
  "gen/bcm/p256-armv8-asm-win.S", "gen/bcm/p256-x86_64-asm-apple.S",
  "gen/bcm/p256-x86_64-asm-linux.S", "gen/bcm/p256_beeu-armv8-asm-apple.S",
  "gen/bcm/p256_beeu-armv8-asm-linux.S", "gen/bcm/p256_beeu-armv8-asm-win.S",
  "gen/bcm/p256_beeu-x86_64-asm-apple.S", "gen/bcm/p256_beeu-x86_64-asm-linux.S",
  "gen/bcm/rdrand-x86_64-apple.S", "gen/bcm/rdrand-x86_64-linux.S", "gen/bcm/rsaz-avx2-apple.S",
  "gen/bcm/rsaz-avx2-linux.S", "gen/bcm/sha1-586-apple.S", "gen/bcm/sha1-586-linux.S",
  "gen/bcm/sha1-armv4-large-linux.S", "gen/bcm/sha1-armv8-apple.S", "gen/bcm/sha1-armv8-linux.S",
  "gen/bcm/sha1-armv8-win.S", "gen/bcm/sha1-x86_64-apple.S", "gen/bcm/sha1-x86_64-linux.S",
  "gen/bcm/sha256-586-apple.S", "gen/bcm/sha256-586-linux.S", "gen/bcm/sha256-armv4-linux.S",
  "gen/bcm/sha256-armv8-apple.S", "gen/bcm/sha256-armv8-linux.S", "gen/bcm/sha256-armv8-win.S",
  "gen/bcm/sha256-x86_64-apple.S", "gen/bcm/sha256-x86_64-linux.S", "gen/bcm/sha512-586-apple.S",
  "gen/bcm/sha512-586-linux.S", "gen/bcm/sha512-armv4-linux.S", "gen/bcm/sha512-armv8-apple.S",
  "gen/bcm/sha512-armv8-linux.S", "gen/bcm/sha512-armv8-win.S", "gen/bcm/sha512-x86_64-apple.S",
  "gen/bcm/sha512-x86_64-linux.S", "gen/bcm/vpaes-armv7-linux.S", "gen/bcm/vpaes-armv8-apple.S",
  "gen/bcm/vpaes-armv8-linux.S", "gen/bcm/vpaes-armv8-win.S", "gen/bcm/vpaes-x86-apple.S",
  "gen/bcm/vpaes-x86-linux.S", "gen/bcm/vpaes-x86_64-apple.S", "gen/bcm/vpaes-x86_64-linux.S",
  "gen/bcm/x86-mont-apple.S", "gen/bcm/x86-mont-linux.S", "gen/bcm/x86_64-mont-apple.S",
  "gen/bcm/x86_64-mont-linux.S", "gen/bcm/x86_64-mont5-apple.S", "gen/bcm/x86_64-mont5-linux.S",
  "third_party/fiat/asm/fiat_p256_adx_mul.S", "third_party/fiat/asm/fiat_p256_adx_sqr.S",
  "crypto/curve25519/asm/x25519-asm-arm.S", "crypto/hrss/asm/poly_rq_mul.S",
  "crypto/poly1305/poly1305_arm_asm.S", "gen/crypto/aes128gcmsiv-x86_64-apple.S",
  "gen/crypto/aes128gcmsiv-x86_64-linux.S", "gen/crypto/chacha-armv4-linux.S",
  "gen/crypto/chacha-armv8-apple.S", "gen/crypto/chacha-armv8-linux.S",
  "gen/crypto/chacha-armv8-win.S", "gen/crypto/chacha-x86-apple.S",
  "gen/crypto/chacha-x86-linux.S", "gen/crypto/chacha-x86_64-apple.S",
  "gen/crypto/chacha-x86_64-linux.S", "gen/crypto/chacha20_poly1305_armv8-apple.S",
  "gen/crypto/chacha20_poly1305_armv8-linux.S", "gen/crypto/chacha20_poly1305_armv8-win.S",
  "gen/crypto/chacha20_poly1305_x86_64-apple.S", "gen/crypto/chacha20_poly1305_x86_64-linux.S",
  "gen/crypto/md5-586-apple.S", "gen/crypto/md5-586-linux.S", "gen/crypto/md5-x86_64-apple.S",
  "gen/crypto/md5-x86_64-linux.S", "third_party/fiat/asm/fiat_curve25519_adx_mul.S",
  "third_party/fiat/asm/fiat_curve25519_adx_square.S",
];
// prettier-ignore
const NASM = [
  "gen/bcm/aes-gcm-avx2-x86_64-win.asm", "gen/bcm/aes-gcm-avx512-x86_64-win.asm",
  "gen/bcm/aesni-gcm-x86_64-win.asm", "gen/bcm/aesni-x86-win.asm", "gen/bcm/aesni-x86_64-win.asm",
  "gen/bcm/bn-586-win.asm", "gen/bcm/co-586-win.asm", "gen/bcm/ghash-ssse3-x86-win.asm",
  "gen/bcm/ghash-ssse3-x86_64-win.asm", "gen/bcm/ghash-x86-win.asm",
  "gen/bcm/ghash-x86_64-win.asm", "gen/bcm/p256-x86_64-asm-win.asm",
  "gen/bcm/p256_beeu-x86_64-asm-win.asm", "gen/bcm/rdrand-x86_64-win.asm",
  "gen/bcm/rsaz-avx2-win.asm", "gen/bcm/sha1-586-win.asm", "gen/bcm/sha1-x86_64-win.asm",
  "gen/bcm/sha256-586-win.asm", "gen/bcm/sha256-x86_64-win.asm", "gen/bcm/sha512-586-win.asm",
  "gen/bcm/sha512-x86_64-win.asm", "gen/bcm/vpaes-x86-win.asm", "gen/bcm/vpaes-x86_64-win.asm",
  "gen/bcm/x86-mont-win.asm", "gen/bcm/x86_64-mont-win.asm", "gen/bcm/x86_64-mont5-win.asm",
  "gen/crypto/aes128gcmsiv-x86_64-win.asm", "gen/crypto/chacha-x86-win.asm",
  "gen/crypto/chacha-x86_64-win.asm", "gen/crypto/chacha20_poly1305_x86_64-win.asm",
  "gen/crypto/md5-586-win.asm", "gen/crypto/md5-x86_64-win.asm",
];
