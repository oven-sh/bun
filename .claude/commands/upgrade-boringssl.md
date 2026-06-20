---
description: Upgrade Bun's BoringSSL fork (oven-sh/boringssl) to the latest upstream google/boringssl
---

Bun pins BoringSSL by **commit SHA** in `scripts/build/deps/boringssl.ts` (`BORINGSSL_COMMIT`). The build downloads a tarball from `oven-sh/boringssl` at that SHA — there is no submodule and `vendor/boringssl/` is git-ignored.

The fork carries a small patch set on top of upstream (see "Preserved patches" below). Upgrading means: merge `google/boringssl` into `oven-sh/boringssl@master`, push, then bump the SHA + regenerate source lists in Bun.

## Steps

### 1. Clone the fork and merge upstream

```sh
git clone https://github.com/oven-sh/boringssl.git /tmp/boringssl
cd /tmp/boringssl
git remote add upstream https://github.com/google/boringssl.git
git fetch upstream
git log --oneline $(git merge-base HEAD upstream/main)..HEAD   # our patches
git merge upstream/main
```

Resolve conflicts **preserving the fork's additions**. Most conflicts are upstream's periodic `|...|` → `` `...` `` doc-comment restyle landing adjacent to a line we added — keep our line + upstream's comment style. For `include/openssl/nid.h`, keep upstream's new NIDs **and** ours (our NID numbers are from OpenSSL's range and don't collide with BoringSSL's sequential allocation).

### 2. Verify the merged tree builds

```sh
cmake -B build -GNinja -DCMAKE_BUILD_TYPE=Release
ninja -C build crypto ssl decrepit
```

This catches mis-resolved conflicts before they reach Bun's CI.

### 3. Push to the fork

The default branch is **`master`** (not `main`).

```sh
git push origin HEAD:master
NEW_SHA=$(git rev-parse HEAD)
```

### 4. Bump Bun

In the bun repo:

- `scripts/build/deps/boringssl.ts` — set `BORINGSSL_COMMIT` to `$NEW_SHA`.
- `test/js/node/process/process.test.js` — update the `boringssl:` entry in `expectedVersions` to `$NEW_SHA`.
- Regenerate the source lists (the file's header comment has the exact one-liner). Only `gen/sources.json` is authoritative — diff old vs new and apply the delta:

  ```sh
  rm -rf vendor/boringssl   # force re-fetch on next build
  bun bd --target=clone-boringssl
  bun -e 'const j=require("./vendor/boringssl/gen/sources.json");
          const f=l=>l.map(JSON.stringify).join(", ");
          for(const k of ["bcm","crypto","ssl","decrepit"]) console.log(k,"\n",f(j[k].srcs));
          console.log("asm\n",f([...j.bcm.asm,...j.crypto.asm]));
          console.log("nasm\n",f([...j.bcm.nasm,...j.crypto.nasm]))'
  ```

### 5. Build and test locally

```sh
rm -rf vendor/boringssl
bun bd -p 'require("crypto").createHash("sha3-256").update("hi").digest("hex")'
bun bd test test/js/node/crypto/ test/js/bun/crypto/
bun bd test test/js/node/tls/ test/js/web/fetch/fetch.tls.test.ts
```

### 6. Open the Bun PR

```sh
git checkout -b claude/boringssl-<upstream-short-sha>
git commit -am "deps: upgrade BoringSSL to <upstream-short-sha>"
git push -u origin HEAD
gh pr create
```

Then `bun run ci:watch` and fix anything that turns up.

## Preserved patches (what conflicts to expect)

`git diff $(git merge-base HEAD upstream/main)..HEAD --stat` — currently ~35 files, ~550 insertions:

- **SHA-512/224** — `crypto/fipsmodule/sha/sha512.cc.inc`, `crypto/sha/sha512.cc`, `include/openssl/{sha2,nid,digest}.h`
- **SHA3-224/256/384/512 as `EVP_MD`** — `crypto/digest/digest_extra.cc`, `crypto/fipsmodule/{digest/digests.cc.inc,keccak/*}`, `include/openssl/{digest,nid}.h`
- **HMAC-SHA3** — `crypto/hmac/hmac_test*.{cc,txt}`
- **BLAKE2b-512** — `crypto/blake2/blake2.cc`, `include/openssl/blake2.h`
- **RIPEMD160 in `crypto/` (not `decrepit/`) + `EVP_ripemd160` lookup** — `crypto/ripemd/ripemd.cc` (moved), `crypto/digest/digest_extra.cc`, `include/openssl/digest.h`, `gen/sources.*`, `build.json`
- **`EVP_PBE_validate_scrypt_params`** — `crypto/evp/scrypt.cc`, `include/openssl/evp.h`
- **Electron `SSL_want` / `EVP_CIPHER_do_all_sorted`** — `ssl/ssl_lib.cc` (return `rwstate` directly), `ssl/ssl_test.cc` (drops the corresponding test block), `decrepit/evp/evp_do_all.cc`, `crypto/cipher/get_cipher.cc`, `include/openssl/cipher.h`
- **MLDSA stack-frame pragma** — `crypto/fipsmodule/mldsa/mldsa.cc.inc`

If upstream upstreams any of these (check `git grep` on `upstream/main` before re-applying), drop the fork's copy.

## Things that have broken before

- **`SSL_CTX` / `SSL_ECH_KEYS` / `SSL_CREDENTIAL` made opaque** — Bun's Rust FFI (`src/boringssl_sys/boringssl.rs`) treats them as opaque already, so this is fine, but check `packages/bun-usockets/src/crypto/openssl.c` for any direct field access.
- **`BIO_read`/`BIO_write` error-value narrowing** — can change `SSL_read` error paths over memory BIOs (`SSLWrapper` for TLS-over-duplex). If `node-tls-connect.test.ts` crashes in `flush_pending_events`, see `src/runtime/socket/UpgradedDuplex.rs::teardown` and `WindowsNamedPipe.rs`'s `WRAPPER_BUSY` for the re-entrant-drop guard.
- **Per-handshake allocation churn (PQ key shares)** grows under ASAN quarantine; RSS-delta tests like `tls-connect-socket-churn.test.ts` may need their `isASAN` bound raised. The `sslCtxLiveCount` check is the real regression guard there — if that passes and LSAN is clean, raise the RSS bound.
- **`asn1_string_st` / `GENERAL_NAME_st` layout** — Bun mirrors these in `src/boringssl_sys/boringssl.rs`; diff `include/openssl/{asn1,x509v3}.h` for field changes.
