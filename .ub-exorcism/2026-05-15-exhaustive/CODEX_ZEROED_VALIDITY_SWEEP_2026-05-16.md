# Codex Zeroed-Validity Sweep — 2026-05-16

## Scope

Follow-up on Bucket 4 / Bucket 5 claims around `core::mem::zeroed`,
`MaybeUninit::zeroed`, and Bun's `bun_core::ffi::Zeroable` wrapper. The goal was
not to find more by treating every zero-init as suspicious; it was to prevent the
report from overclaiming false positives while still checking the high-risk
direct `mem::zeroed` sites.

Commands used:

```sh
rg -n "core::mem::zeroed\(|std::mem::zeroed\(|mem::zeroed\(" src packages -g '*.rs'
rg -n "unsafe impl .*Zeroable|impl .*Zeroable|trait Zeroable|pub unsafe fn zeroed|pub fn zeroed" src packages -g '*.rs'
```

## Result

No new UB experiment was added. The current direct zero-init sites are either:

1. audited wrappers (`bun_core::ffi::{zeroed, zeroed_unchecked, conjure_zst}` and
   the windows-shim local `Zeroable` equivalent), or
2. C ABI POD / out-parameter storage with nullable raw pointers and integer
   fields, immediately initialized by the foreign API before semantic use.

The one prior misconception already corrected elsewhere remains important:
`MaybeUninit::uninit().assume_init()` for primitive arrays is not the same as
zero-initialization. That is EXP-089 and remains confirmed UB. This sweep only
addresses all-zero initialization.

## Direct Sites Re-read

| site | type | verdict |
|---|---|---|
| `src/runtime/test_runner/harness/recover.rs:59,84` | `Context = CONTEXT` / `ucontext_t` / local musl `jmp_buf` | Sound as zeroed C-context storage immediately passed to `get_context`; the musl fallback is `[u64; 32]` storage, not a niche-bearing Rust type. |
| `src/runtime/image/codec_webp.rs:199` | `WebPChunkIterator` | Sound as libwebp out-param storage: `#[repr(C)]` ints + raw pointer fields; `WebPDemuxGetChunk` initializes it before `WebPDemuxReleaseChunkIterator`. |
| `src/jsc/btjs.rs:288` | Windows `MemoryBasicInformation` | Sound as `VirtualQuery` out-param storage: raw pointers + integer fields. |
| `src/sys_jsc/error_jsc.rs:155` | `Sigaction` struct-update tail | Sound for the zeroed trailing C fields; optional hardening is to route through `bun_core::ffi::zeroed::<Sigaction>()` instead of open-coding `core::mem::zeroed()`. |
| `src/install/windows-shim/main.rs:267` | `T: Zeroable` | Sound by the local marker-trait contract, same shape as `bun_core::ffi::zeroed`. |
| `src/bun_core/lib.rs:2840,2871,3037` | audited wrapper bodies | Sound at the wrapper boundary: `Zeroable` / caller contract / ZST size check is the relevant proof obligation. |

## BoringSSL Clarification

`src/boringssl_sys/boringssl.rs:160-168` implements `Zeroable` for
`EVP_MD_CTX`. The current Rust definition is all-zero-valid as a Rust value:
a byte-array union plus raw pointers. The concern in `F-10-5` is therefore not
"zeroed `EVP_MD_CTX` is immediate UB." It is layout drift: Bun hand-mirrors a
BoringSSL struct and should eventually add the same C-side layout reflector used
by EXP-054/EXP-063 for N-API.

Conclusion: keep F-10-5 under EXP-063 layout-lock hardening. Do not count it as
a live zero-validity bug without a concrete C/Rust layout mismatch.

## Artifact Corrections Made

- `phase2_findings_04_validity.md`: added this follow-up note after the
  `mem::zeroed` table.
- `phase4_unified_findings.md`: F-10-4 / F-10-5 status corrected from `OPEN` to
  `DEFERRED` because EXP-063 already owns them as remediation-design hardening
  work, not unresolved UB proof obligations.
- `FINAL_UB_REPORT.md`: stale live-total paragraph corrected from 85/13 to
  86/14 and late-addition wording extended to include EXP-090.
