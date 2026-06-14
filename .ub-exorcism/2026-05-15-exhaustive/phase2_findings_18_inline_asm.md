# Phase 2 Findings — Bucket 18: Inline Assembly UB

**Run:** `2026-05-15-exhaustive`
**Sweeper:** static-bucket-sweeper for Bucket 18 (Inline Assembly UB)
**Scope:** every `asm!` / `naked_asm!` / `global_asm!` site in `src/` (Rust-only).
**Verdict:** **CLEAN.** No UB findings. 11 sites total; all classifications N/A.

---

## 1. Site inventory

`rg -n '\basm!|global_asm!|naked_asm!' --type rust src/` returns 11 inline-asm sites across 5 files:

| # | File | Line | Form | Instruction | Arch gate |
|---|------|------|------|-------------|-----------|
| 1 | `src/perf/hw_timer.rs` | 37 | `asm!` | `mrs {ret}, CNTVCT_EL0` | `aarch64` |
| 2 | `src/perf/hw_timer.rs` | 51 | `asm!` | `rdtsc` | `x86_64` |
| 3 | `src/perf/hw_timer.rs` | 154 | `asm!` | `mrs {ret}, CNTFRQ_EL0` | `aarch64` |
| 4 | `src/jsc/btjs.rs` | 108 | `asm!` | `mov {}, rbp` | `x86_64` |
| 5 | `src/jsc/btjs.rs` | 117 | `asm!` | `mov {}, x29` | `aarch64` |
| 6 | `src/bun_core/util.rs` | 2569 | `asm!` | `mov {}, rsp` | `x86_64` |
| 7 | `src/bun_core/util.rs` | 2578 | `asm!` | `mov {}, sp` | `aarch64` |
| 8 | `src/windows_sys/externs.rs` | 1574 | `asm!` | `mov {}, gs:[0x30]` | windows x64 |
| 9 | `src/windows_sys/externs.rs` | 1582 | `asm!` | `mov {}, x18` | windows arm64 |
| 10 | `src/windows_sys/externs.rs` | 1600 | `asm!` | `mov {}, gs:[0x60]` | windows x64 |
| 11a/b | `src/install/windows-shim/main.rs` | 87, 115 | `naked_asm!` | `__chkstk` MS-x64 / aarch64 | windows |

The mission scoped 3 hw_timer + 3 Windows TEB/PEB sites (= 6). The remaining 5 sites (`btjs.rs` ×2, `util.rs` ×2, `windows-shim/main.rs` ×2) are in-scope by the bucket charter ("every `asm!` site") and audited below for completeness.

---

## 2. Per-site verdict (Bucket-18 checklist)

Checklist per site: (a) clobber list omits a clobbered register; (b) `in("rN")` read before init; (c) `nomem` claimed when asm touches memory; (d) `nostack` claimed when asm pushes/pops; (e) cross-block jumps missing `noreturn`.

### Sites 1, 3 — `CNTVCT_EL0`, `CNTFRQ_EL0` (aarch64 system register reads)
- Single `mrs Xd, Sreg` instruction. Writes one out-`reg` only; no implicit clobbers per ARM ARM v8 §C5.2.
- No memory access → `nomem` correct.
- No stack touch → `nostack` correct.
- Reads no condition flags, writes none → `preserves_flags` correct.
- No `in` operand; no jumps.
- **Verdict: N/A (correct).**

### Site 2 — `rdtsc` (x86_64)
- Per Intel SDM Vol. 2B `RDTSC`: writes EDX:EAX, **clobbers no other regs**, no memory access, no flag effects.
- Out-registers explicitly bound: `out("eax") lo, out("edx") hi`. Both clobbered regs are declared as outputs (compiler treats `out` as clobber + value-capture). No missing clobbers.
- `nomem` correct (no memory operands or implicit memory). `nostack` correct. `preserves_flags` correct (RDTSC does not modify RFLAGS).
- No `in` operand.
- **Verdict: N/A (correct).**

### Sites 4, 5 — `mov rbp` / `mov x29` (frame-pointer reads, `btjs.rs`)
- Single `mov` from a named reg into an out-`reg`. The named source (`rbp`/`x29`) is read-only inside the asm; no clobber declaration needed for source-only named regs.
- `nomem`/`nostack`/`preserves_flags` all correct (pure reg-to-reg mov).
- Caveat noted in comment: Rust release builds may omit frame pointers, so `rbp`/`x29` may not actually be a frame pointer — but that is a *semantic* concern (used only by best-effort backtrace walking), not UB. The asm itself is sound.
- **Verdict: N/A (correct).**

### Sites 6, 7 — `mov rsp` / `mov sp` (stack-pointer reads, `bun_core/util.rs`)
- Same shape as 4/5; reading SP into a GPR. `mov` reg ← SP is encodable on both arches.
- All three options correct.
- **Verdict: N/A (correct).**

### Sites 8, 10 — `mov gs:[0x30]` / `mov gs:[0x60]` (Windows x64 TEB/PEB)
- Read of segment-relative memory: GS-prefixed loads from KUSER/TEB. Uses `options(nostack, pure, readonly)` — **not** `nomem`, which is correct because the instruction *does* read memory. `readonly` is the right option (memory read with no writes), and `pure` is sound because the read is observationally constant per thread for the lifetimes involved (the TEB self-pointer at offset 0x30 and the PEB pointer at offset 0x60 are set once by the kernel before the thread runs user code and never change).
- No clobbers beyond the declared out-`reg`. `nostack` correct.
- No `preserves_flags` declared — `mov` does not modify flags, so adding it would be valid but its absence is not UB (it just disables an optimization).
- **Verdict: N/A (correct).** Pre-existing audit comment at site 8 already calls out that `&'static PEB` would be UB and that callers must use raw-pointer deref; consistent with our aliasing rules.

### Site 9 — `mov x18` (Windows arm64 TEB)
- `x18` is reserved by the Windows arm64 ABI as the TEB pointer. Same `nostack, pure, readonly` choices; the load is a register-to-register `mov`, so `readonly` is conservative but harmless (no memory is actually touched — `pure` alone would also be sound).
- **Verdict: N/A (correct).** Minor nit: `readonly` is overspecified for a pure `mov x_, x18`; `options(nomem, nostack, pure, preserves_flags)` would be tighter. Not a soundness issue — `readonly` is a strict superset of `nomem` in what the compiler may assume about *writes*, just less precise about reads. **No action.**

### Sites 11a, 11b — `__chkstk` (`naked_asm!`, windows-shim)
- Naked functions: `naked_asm!` body **is** the entire function; clobber/options syntax is not used (and would be rejected). The contract is the function's own ABI declaration plus the verbatim instruction sequence.
- Both bodies are copied verbatim from Rust's upstream `compiler_builtins` chkstk sources (the local tree only carries `scripts/verify-baseline-static/src/aarch64.rs`, not those upstream source files), which are themselves derived from LLVM `compiler-rt`. The MS x64 contract (bytes in `rax`, preserve all but `rax`/`r10`/`r11`) and the arm64 contract (bytes/16 in `x15`, preserves all but `x16`/`x17`) are honored by the sequences — verified by inspection: the x64 body only touches `rax`, `rcx` (push/pop balanced), and stack memory it probes; the arm64 body only touches `x16`, `x17`, and the probe addresses.
- The single caller is the compiler-inserted prologue probe; no Rust call-site obligations to discharge.
- **Verdict: N/A (correct).**

---

## 3. Cross-cutting checks

- **(a) Missing clobbers:** none found. RDTSC's EDX/EAX are declared as outs; every other site is a single `mov`/`mrs` writing exactly the declared out-reg.
- **(b) `in("rN")` read-before-init:** zero `in("...")` operands across all 11 sites. N/A by absence.
- **(c) `nomem` falsely claimed:** the only sites that *do* touch memory (`gs:[0x30]`, `gs:[0x60]`) correctly use `readonly` instead of `nomem`. All `nomem` claims are on pure reg-to-reg or non-memory instructions (`mrs`, `rdtsc`, `mov reg, reg`).
- **(d) `nostack` falsely claimed:** the only site that pushes/pops (`__chkstk` MS-x64) is a `naked_asm!`, which does not take options. All `nostack` claims are on non-stack-touching instructions.
- **(e) Cross-block jumps missing `noreturn`:** no asm site in `src/` performs a non-returning jump out of the asm block. The chkstk bodies branch internally (labels `1:`, `2:`, `3:`) and `ret` to the caller via the C ABI — correct for a naked fn.

---

## 4. Findings to file

**None.** No beads, no patches.

The hw_timer audit comment block already documents the side-effect-free nature of `CNTVCT_EL0`/`CNTFRQ_EL0`/`rdtsc` and the calibration's `Once` happens-before. The TEB/PEB sites already carry a comment block explaining why `*mut TEB` / `*const PEB` (not `&'static`) is required for aliasing soundness. The chkstk port already cites its upstream provenance.

---

## 5. Deliverable summary (≤300 words)

**Total asm sites:** 11 (`rg '\basm!|global_asm!|naked_asm!' --type rust src/`), spanning `src/perf/hw_timer.rs` (3), `src/windows_sys/externs.rs` (3), `src/jsc/btjs.rs` (2), `src/bun_core/util.rs` (2), `src/install/windows-shim/main.rs` (2). No `global_asm!` sites.

**Per-site clobber verdict:**
- hw_timer × 3 (`mrs CNTVCT_EL0`, `mrs CNTFRQ_EL0`, `rdtsc`): clean. RDTSC's EDX/EAX both declared `out("...")`; `mrs` reads write only the declared out-`reg` per ARM ARM v8. `nomem, nostack, preserves_flags` all valid.
- btjs/util frame & stack pointer reads × 4 (`mov rbp`, `mov x29`, `mov rsp`, `mov sp`): clean. Reg-to-reg `mov`s; named source reg used read-only needs no clobber declaration.
- windows TEB/PEB × 3 (`gs:[0x30]`, `x18`, `gs:[0x60]`): clean. Uses `nostack, pure, readonly` — correctly **not** claiming `nomem` for the segment-prefixed memory loads. x18 site overspecs `readonly` for a pure reg-to-reg mov; harmless.
- `__chkstk` naked × 2 (x64 + arm64): clean. Verbatim copies of `compiler_builtins` (upstream LLVM `compiler-rt`); honor MS-x64 and Windows-arm64 ABIs.

**N/A or finds:** **all N/A.** Zero clobber-list defects, zero `in("rN")` read-before-init (no `in` operands exist), zero falsely claimed `nomem`/`nostack`, zero missing `noreturn` (no non-returning asm). No beads filed. The bucket charter's expectation ("Very few sites; mostly N/A") matches exactly — this code was clearly written by someone who consulted the architecture manuals (ARM ARM v8 / Intel SDM) and Rust's inline-asm option semantics carefully.

**Files referenced (absolute):**
- `/data/projects/bun/src/perf/hw_timer.rs:37,51,154`
- `/data/projects/bun/src/windows_sys/externs.rs:1574,1582,1600`
- `/data/projects/bun/src/jsc/btjs.rs:108,117`
- `/data/projects/bun/src/bun_core/util.rs:2569,2578`
- `/data/projects/bun/src/install/windows-shim/main.rs:87,115`
