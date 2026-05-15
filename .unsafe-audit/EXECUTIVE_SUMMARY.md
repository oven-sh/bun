# Bun unsafe-code audit — Executive Summary

> A 5-pass application of [`/rust-unsafe-code-exorcist`](https://jeffreys-skills.md/skills/rust-unsafe-code-exorcist) against [oven-sh/bun](https://github.com/oven-sh/bun) — the JavaScript runtime that was recently ported from Zig to Rust.

## The headline

**6 ceiling-score supply-chain attack primitives** + **40 T1/T1-equivalent findings** (memory-safety plus explicitly-labelled non-UB security items; critical crash-reliability items are tracked separately) + **5 miri-backed UB witnesses**, distilled from **11,044 unsafe sites** across **108 workspace crates**, with major public-facing claims adversarially reviewed by Claude and Codex for maintainer-grade defensibility.

Two pull requests opened: [#30763](https://github.com/oven-sh/bun/pull/30763) (audit artifacts + agent-ergonomic guide) and [#30765](https://github.com/oven-sh/bun/pull/30765) (3 highest-confidence fixes, with isomorphism / semantic-repair evidence).

## What the audit supports

### 1. Bun's port to Rust ships with deliberate, structured unsafe-discipline

A blanket "Bun has too much unsafe" critique doesn't survive the audit. The work documents in painstaking detail that **most of Bun's unsafe is load-bearing**:

- **The `*mut Self` callback pattern** (~1,610 sites) is required by Rust's Stacked Borrows aliasing model when a C callback may free `self`. Bun's own `src/CLAUDE.md` documents it explicitly. The `impl_streaming_writer_parent!` macro encodes three legitimate modes (`mut`/`shared`/`ptr`). The stratified A-001 sample found no anti-pattern violation; two watchlist sites remain called out for targeted harnessing.
- **The core `bun_jsc::Strong/Weak` JS handle discipline** is thread-affinity-aware and audited as `!Send + !Sync` where the core handle contract requires it. Related JSC task / weak-reference wrapper findings remain tracked separately as unsafe-contract hazards; this is not a blanket clean bill for all JSC-adjacent types.
- **The `bun_core::atomic_cell.rs` discipline** (default to AcqRel, name-explicit opt-in to Relaxed) audited clean across 101 atomic sites — **zero too-weak orderings.**
- **The `bun_core::heap` lifecycle helpers** (`into_raw`/`take`/`destroy`) audited across the raw-pointer-lifecycle cluster without finding direct use-after-free, double-free, or mismatched-allocator bugs in that helper discipline. Separate dealloc-through-shared-provenance findings remain tracked outside this helper cluster.

### 2. Bun's maintainers have already removed thousands of unsafe blocks

The audit's [soundness archeology](audit/synthesis/PASS4-soundness-archeology.md) mined the project's commit history and found **2,989 unsafe blocks already removed** in tagged "unsafe -N: \<category\>" commits, plus **17+ commits in a 6-day window** fixing the exact `&mut self` × re-entrant-FFI noalias miscompile family the audit highlights. **Most major Tier-1 finding classes map to maintainer-authored fix classes, with exceptions explicitly noted in the archeology table** — the audit is the next batch of bugs in classes the project's own remediation campaign has already treated as real, not a pile of outsider hypotheticals.

A smoking-gun maintainer commit message: *"Zig has UB here; one SIMD scan is cheap, panic beats heap corruption."* The Zig parent had UB; the Rust port is strengthening, not faithfully replicating.

### 3. The audit found genuine bugs at every severity tier

#### Six ceiling-score supply-chain attack primitives

A malicious `bun.lockb` or `yarn.lock` planted in a repo reaches parser paths that the audit classifies as UB on `bun install`. The high-level attack shapes are reproducible from crafted lockfile inputs; the miri-backed witnesses are noted explicitly below.

- **PUB-INSTALL-1**: `Meta::has_install_script` — `#[repr(u8)]` enum with 3 valid values, read directly from disk bytes. Bytes 3-255 → niche-violating UB. **Miri-confirmed:** `enum value has invalid tag: 0x2a`
- **PUB-INSTALL-2**: `Meta::origin` — same shape, different enum
- **PUB-INSTALL-3**: yarn.rs forms `&mut [Dependency]` over uninitialized `Vec` capacity. **Miri-confirmed:** `reading uninitialized memory`
- **PUB-INSTALL-4**: `Tree.rs` `get_unchecked` over attacker-controlled dependency ID
- **F-NEW-1**: `bun_semver::String::slice` packed `(off, len)` from disk bytes → `get_unchecked` OOB up to ~6 GiB
- **F-NEW-2**: `bun_semver::String::eql` packed `(off, len)` from disk bytes → `get_unchecked` OOB up to ~6 GiB

#### Five miri-backed UB witnesses

The current index captures five distinct miri-backed error classes; four have dedicated detail files and one is summary-only:

| Bug | Miri output |
|-----|-------------|
| `linear_fifo::assume_init_slice<T>` for niche T | `reading uninitialized memory` |
| `linux_errno` `impl GetErrno for usize` transmute | `enum value has invalid tag: 0x0086` |
| PUB-INSTALL-1 supply-chain | `enum value has invalid tag: 0x2a` |
| `webcore/encoding.rs` `Vec<u8>→Vec<u16>` allocator-layout | `incorrect layout on deallocation: size 6 alignment 1, but gave size 6 alignment 2` |
| PUB-INSTALL-3 yarn.rs uninit slice | `reading uninitialized memory` |

These are not "the audit thinks this is UB" claims for the five listed witnesses: miri concretely flags the underlying Rust UB pattern. Four have dedicated sibling detail files; the PUB-INSTALL-3 yarn trace is currently summary-only in `verification/miri-confirmed-summary.md` and should get its own detail file before the miri corpus is used as a standalone public artifact.

#### Plus 30+ confirmed Tier-1 bugs across the codebase

Bundler parallel-callback aliasing (5 same-shape sites confirmed under Stacked / Tree Borrows), `picohttp` NUL-write through `SharedReadOnly` provenance, 8 dealloc-through-shared-provenance sites in HTTP/FS/JSC, signal-handler async-signal-safety violations in `crash_handler`, dirent-parser bugs on macOS/Linux/FreeBSD, a `fmt::Raw` UTF-8 invariant violation reachable from argv, and the `WebSocketClient::cancel` re-entry the maintainers fixed in the sibling type but missed in the original.

### 4. The strong-negative findings are themselves valuable

The audit's most distinctive output is the set of subsystems it explicitly
reviewed and found clean under this pass:

| Subsystem | T1 found | Audit verdict |
|-----------|---------:|---------------|
| `bun_shell_parser` (shell injection surface) | 0 | Security model verified holding |
| `bun_css` + `bun_js_parser` (language parsers) | 0 | Exceptionally clean |
| Config parsers (yaml/toml/json5/ini/dotenv) | 0 | TOML lexer + JSON5 parser have ZERO unsafe blocks |
| Cryptography (sha_hmac, csrf, secrets, password) | 0 | BoringSSL constant-time used; OS CSPRNG only; no userspace PRNG |
| `dyn Trait` + cross-crate Send/Sync | 0 | 162 dyn sites + 164 unsafe impls audited clean |
| PipeWriter parent-vtable discipline | 0 | All 5 callsite-modes match parent lifecycle |
| 537 raw_ptr_lifecycle sites | 0 UAFs / 0 double-frees / 0 mismatched-allocators | Discipline holds |
| 298 `slice::from_raw_parts` sites | 0 high-priority external buffer-overrun primitives found in this pass | Defense-in-depth holds |
| 101 atomic sites | 0 happens-before bugs | Discipline holds |
| `bun_jsc::Strong/Weak` thread affinity | confirmed `!Send + !Sync` | Architectural property holds |

A grep-based audit can't produce these. The depth of work needed to say "this
subsystem has been reviewed and no finding survived the pass" is exactly what
differentiates this from "find more unsafe."

## What the audit produced

**~38,000 lines** of audit content across **40 plan documents**, **19 synthesis documents**, **5 miri-backed UB witnesses** (4 dedicated detail files + 1 summary-only trace), **9 Rust test/proof fixtures** (rustfmt-clean, dirent regression test 14/14 pass), an **ast-grep rule** that fires on 2 real Bun sites with 0 false positives in its test corpus, a **dylint crate scaffold** for the same pattern, a **redacted draft SECURITY.md proposal**, and a **soundness-debt dashboard** with quantified risk-scoring per finding.

High-priority findings carry file:line citations. Miri-backed claims have runtime traces; remaining T1s that need Loom / scheduling / integration harnesses are called out as not yet miri-reproduced. The Codex adversarial review passes catalog demotions with evidence in `CODEX_PASS3_FINAL_REVIEW.md`. The Pass-4 risk-scoring document (`audit/synthesis/PASS4-risk-scoring.md`) gives the T1/T1-equivalent dashboard BLAST × LIKELIHOOD × DISCOVERABILITY scores: 24 P0-band entries account for 2,019 / 2,507 risk-points (81%).

## What's submitted

| PR | Branch | Content |
|----|--------|---------|
| [#30763](https://github.com/oven-sh/bun/pull/30763) | `claude/unsafe-exorcist-audit` | Audit artifacts + `GUIDE_TO_THE_EXORCISM_FINDINGS.md` agent-ergonomic navigator. Zero source changes. |
| [#30765](https://github.com/oven-sh/bun/pull/30765) | `claude/unsafe-exorcist-demo` | The 3 highest-confidence fixes (`StoreSlice<T>` Send/Sync bounds, `linux_errno` checked path, `GuardedLock` `!Send` marker). 29 additions, 6 deletions across 3 files. Focused cargo checks pass; 10/10 per-crate miri tests pass clean as regression coverage on the touched crates. |

The remaining ~40 fixes are documented in the audit's per-cluster plans for immediate follow-up PRs.

## Why this matters

Bun is a JavaScript runtime in production use by thousands of teams. Its supply-chain attack surface is non-trivial: every developer who clones a Bun project and runs `bun install` is implicitly trusting the lockfile bytes. The six ceiling-score P0s mean a malicious package author can plant crafted lockfile bytes that reach UB-class parser paths on `bun install`; additional lower-score install findings are tracked in the dashboard. Exploit development is not claimed here, but the bug class merits coordinated security triage.

The audit is the kind of work that's been historically only possible from a security firm engagement. This was produced by a coding agent applying a structured methodology — the audit is itself a demonstration of what skilled agentic work can do, where the skill is the IP and the audit is the case study.

## How to engage

- **Bun maintainers:** read `GUIDE_TO_THE_EXORCISM_FINDINGS.md` in PR #30763 first. The maintainer-empathy review (`REVIEWER_RESPONSES.md`) answers your likely pushback questions cluster-by-cluster.
- **Security researchers:** start at `.unsafe-audit/verification/miri-confirmed-summary.md`. Four witnesses have dedicated detail files; the PUB-INSTALL-3 yarn trace is currently summary-only and should be split out before standalone publication of the miri corpus.
- **Engineers running the same skill on their project:** the skill is at [jeffreys-skills.md/skills/rust-unsafe-code-exorcist](https://jeffreys-skills.md/skills/rust-unsafe-code-exorcist). The audit shows what its output looks like at scale.

The audit's 5 miri-backed traces are strong runtime evidence for the listed UB witnesses. If a maintainer reads the audit and concludes "this is overreaching," open the linked detail file or summary entry: the evidence includes the minimized Rust pattern and the verbatim miri error message.

Bun deserves this audit. The skill made it possible.
