# Pass 4 — Consolidated Findings Index

**Pass 4 standard:** Codex-grade defensibility. High-priority claims are source-verifiable; miri-backed bugs have concrete traces; findings that need scheduling, Loom, integration, or call-graph evidence are labelled accordingly.

## Pass-4 agents

| Agent | Topic | T1 | T2 | T3 | Outcome | Plan |
|-------|-------|---:|---:|---:|---------|------|
| P4-A | Adversarial parsers (resolver/url/picohttp/glob/semver/watcher) | **2 P0** (semver) | 3 | 20 | 6 ceiling-score supply-chain entry points with pass-3 PUB-INSTALL-1..4; additional lower-score install findings remain in the dashboard | [plan](audit/plans/PASS4-adversarial-parsers.md) |
| P4-B | bun_shell_parser | **0** | (audit-quality) | (audit-quality) | Security model verified holding; 15 adversarial template literals traced; 12 blocked by design | [plan](audit/plans/PASS4-bun-shell-parser.md) |
| P4-C | bun_css + bun_js_parser | **0** | 4 | 8 | Both surfaces exceptionally clean; arena-lifetime erasure + `Vec<_, AstAlloc>` POD reads + `NonNull<Log>` patterns all justified | [plan](audit/plans/PASS4-css-and-js-parsers.md) |
| P4-D | Config parsers (yaml/toml/json5/ini/dotenv/bunfig) | **0** | 1 | 31 | TOML lexer + JSON5 parser have ZERO unsafe; JS-exposed YAML/TOML/JSON5/JSONC routes through bounds-checked tokenizers | [plan](audit/plans/PASS4-config-parsers.md) |
| P4-E | PipeWriter + bun_threading | **1** (GuardedLock missing !Send) | 1 | 3 | PipeWriter discipline holds across all callsites; one threading-primitive bug | [plan](audit/plans/PASS4-pipewriter-and-threading.md) |
| P4-F | Cryptography | **0** | 6 | 7 | BoringSSL constant-time used; OS CSPRNG only; no userspace PRNG; password buffers zeroed via secure_zero | [plan](audit/plans/PASS4-cryptography-audit.md) |
| P4-G | dyn Trait + cross-crate Send/Sync | **0 new** | — | — | 162 dyn sites + 164 unsafe impl Send/Sync across 76 files audited; no new dyn-trait T1. Re-confirms the already-counted `StoreSlice<T>` T1 rather than demoting it. | [plan](audit/plans/PASS4-dyn-trait-cross-crate.md) |
| P4-H | Soundness archeology | (synthesis) | — | — | **2,989 unsafe blocks already removed by maintainers**; most major Tier-1 finding classes map to maintainer commit classes, with exceptions called out in the archeology table | [synthesis](audit/synthesis/PASS4-soundness-archeology.md) |
| P4-I | Audit-driven tests + clippy lints | (deliverables) | — | — | 9 Rust test/proof fixtures (rustfmt-clean, dirent 14/14 pass); ast-grep rule (fires on 2 real Bun U2 sites, 0 false positives); dylint scaffold | `audit/tests/` |
| P4-J | Risk scoring + SECURITY.md + soundness debt | (synthesis) | — | — | 40 current T1/T1-equivalent entries / 2,507 risk-pts / 24 risk-band P0 (81% of risk); top-6 remediation owners = 83% of risk; scrubbed SECURITY.md proposal | [risk-scoring](audit/synthesis/PASS4-risk-scoring.md), [dashboard](soundness-debt-dashboard.md), [SECURITY](SECURITY-public-ready.md) |
| P4-K | spawn + crash_handler + sql | **0 memory-safety T1** | 7 | 10 | Author's TODO identifies real crash-path async-signal-safety defects, but mutex/RefCell re-entry is tracked as critical crash-reliability debt, not counted in the memory-safety T1 risk table. `report()` fork/execve/_exit path verified async-signal-safe. | [plan](audit/plans/PASS4-spawn-crash-sql.md) |

## NEW Pass-4 P0 findings

These are new beyond Pass 3's PUB-INSTALL-1..4:

| ID | Location | Mechanism |
|----|----------|-----------|
| **F-NEW-1** | `bun_semver/lib.rs:613` `String::slice` | `(off, len)` decoded from `[u8; 8]` String repr loaded from `bun.lockb` → `buf.get_unchecked(off..off+len)`. OOB read up to ~6 GiB. Reachable: every `Dependency::name`, `Dependency::version`, `Package::name`, `Package::resolution` field in a malicious lockfile. |
| **F-NEW-2** | `bun_semver/lib.rs:536-537` `String::eql` | Same shape, two simultaneous OOB reads (a_off/a_len + b_off/b_len). |

**Ceiling-score supply-chain primitives:** 6 (PUB-INSTALL-1, 2, 3, 4 from Pass 3 + F-NEW-1, 2 from Pass 4). Additional install findings such as PUB-INSTALL-5/6/7 are tracked separately with lower risk scores.

## NEW Pass-4 T1 findings (non-P0)

| ID | Location | Class |
|----|----------|-------|
| **TH-1** | `threading/guarded.rs:132-134` | `GuardedLock<'_, V, Mutex>` is unconditionally `Send`. Missing `PhantomData<*const ()>` non-Send marker (sibling `Mutex.rs:114-120` has the correct pattern). |

## NEW Pass-4 critical signal-safety findings (not counted in T1 risk-points)

| ID | Location | Class |
|----|----------|-------|
| **CRASH-SIGNAL-1** | `crash_handler/lib.rs:904` | `PANIC_MUTEX.lock()` on the POSIX signal-handler path is not async-signal-safe. The author's TODO at line 588 explicitly admits the concern. This is a real crash-handler defect, but it is a deadlock/re-entry/signal-safety problem rather than Rust memory-safety T1. |
| **CRASH-SIGNAL-2** | `crash_handler/lib.rs:938` | `Output::flush()` routes through `SOURCE.with_borrow_mut` (`RefCell`) from the signal-handler path. Fault-during-print can panic/re-enter the crash path and lose the crash report. Serious reliability debt, not counted as memory-UB. |

## Miri-confirmed runtime UB (5 traces)

Pass 4 produced **5 concrete `cargo +nightly miri run` traces** for the audit's most important findings. Each captured verbatim in `verification/`:

| # | Bug | Miri error |
|---|-----|------------|
| 1 | `linear_fifo::assume_init_slice<T>` niche-T | `reading memory ... but memory is uninitialized` |
| 2 | `linux_errno` transmute | `enum value has invalid tag: 0x0086` |
| 3 | PUB-INSTALL-1 (`HasInstallScript`) | `enum value has invalid tag: 0x2a` |
| 4 | UB-RT-001 (`encoding.rs` Vec<u8>→Vec<u16>) | `incorrect layout on deallocation: size 6 alignment 1, but gave size 6 alignment 2` |
| 5 | PUB-INSTALL-3 (`yarn.rs` uninit Dependency slice) | `reading memory at alloc206[0x0..0x1], but memory is uninitialized` |

See [verification/miri-confirmed-summary.md](verification/miri-confirmed-summary.md) for the index. Four traces have dedicated sibling detail files; the `PUB-INSTALL-3` yarn trace is currently summary-only and should be split into its own detail file before relying on it as a standalone reproducer.

## Pass-4 NEGATIVE findings (clean audits)

These crates / clusters were investigated thoroughly and found CLEAN of new soundness bugs:

- **`bun_shell_parser`** — security model holds (15 adversarial template literals traced, 12 blocked by design)
- **TOML lexer + JSON5 parser** — ZERO unsafe blocks
- **`bun_url`, `bun_resolver`, `bun_glob`, `bun_watcher`** — 0 T1
- **`bun_picohttp` beyond H9** — 0 T1
- **Cryptography surface** — 0 T1 (BoringSSL constant-time, OS CSPRNG, no userspace PRNG, password buffers zeroed)
- **dyn Trait / cross-crate Send/Sync** — 0 T1 across 162 dyn sites + 164 unsafe impls
- **PipeWriter callsites** — all 5 (FileSink ptr, WindowsNamedPipe mut, StaticPipeWriter mut, ShellIOWriter shared, Terminal hand-roll) match their parent's lifecycle
- **`bun_threading` primitive ports** (Mutex, RwLock, Condition, Futex, ResetEvent, Semaphore, WaitGroup, ThreadPool, work-stealing buffer) — atomic orderings correct, no ABA
- **crash_handler `report()` fork/execve/_exit path** — verified async-signal-safe per syscall
- **Postgres/MySQL wire-protocol parsers** — bounds-checked end-to-end
- **bun_spawn argv/environ pointer-array NUL-termination + posix_spawn flags** — correct
- **`uv_alloc_cb` SAFETY comment in spawn/process.rs:2455-2473** — exemplary (avoids Stacked-Borrows trap)
- **Most major pass-1/2/3 Tier-1 finding classes map to maintainer commit classes** — the audit found the next batch of bugs in classes the maintainers were already actively fixing (2,989 unsafe blocks removed in tagged commits). The archeology table calls out rows where no exact prior commit was found.

## Cumulative audit T1 count (after Codex demotions + Pass 4)

| Source | T1 | P0 |
|--------|---:|---:|
| Pass 1 | 2 | 0 |
| Pass 2 (Claude + Codex P2/P3 review) | ~14 | 0 |
| Pass 3 (post-Codex final review) | ~17 | 4 |
| Pass 4 (this pass) | 3 new T1/T1-equivalent entries (F-NEW-1, F-NEW-2, TH-1) plus 2 critical signal-safety defects | 2 new P0 |
| **Cumulative** | **40 current T1/T1-equivalent entries** | **6 ceiling-score supply-chain entries** |

The 5 miri-confirmed traces cover: 2 of the 6 ceiling-score supply-chain entries (PUB-INSTALL-1, PUB-INSTALL-3), 1 latent-pub-API bug (linux_errno), 1 JS-reachable allocator-layout bug (UB-RT-001), 1 niche-T cluster (linear_fifo F-1).

## Total audit content

- **40 plan documents** across `audit/plans/` (`PASS2-*`, `PASS3-*`, `PASS4-*`, plus the original `C-001`, `C-002`, `C-003`, `A-001`, `A-003`, `B-001-and-B-002`, `bench-targets`, `CODEX-P2-*`, `CODEX-P3-*`)
- **19 synthesis documents** across `audit/synthesis/`
- **5 miri verification documents** in `verification/`
- **9 Rust test/proof fixtures + ast-grep lint + dylint scaffold** in `audit/tests/`
- **`AUDIT_SUMMARY.md`, `PASS2_FINDINGS_INDEX.md`, `PASS3_FINDINGS_INDEX.md`, `PASS4_FINDINGS_INDEX.md`** (this file)
- **`SECURITY-public-ready.md`, `soundness-debt-dashboard.md`, `beads-to-create.md`**
- Local audit history was maintained while producing the artifacts; this PR contains the current reviewable artifact set, not the nested audit repo's internal `.git` history.

## Pass-4 PR landing order recommendation

After the user's "I want defensible artifacts" critique + Codex's tight tier discipline, the landing order is:

1. **The 6 ceiling-score supply-chain fixes** (PUB-INSTALL-1..4 + F-NEW-1, F-NEW-2). One unified PR: replace `transmute<u8, Enum>` with `match`/`TryFrom`; fix yarn.rs uninit-Vec; fix Tree.rs `get_unchecked`; add bounds-check in semver `String::slice` / `String::eql`.
2. **CRASH-SIGNAL-1 + CRASH-SIGNAL-2** — already author-TODO'd; replace `Mutex` with an `AtomicBool` flag and avoid RefCell in signal handlers. Track outside the memory-safety T1 dashboard but keep near the front of the landing order because crash telemetry is production-critical.
3. **H9 picohttp NUL-write** — owning-mutable-buffer rewrite.
4. **TH-1 GuardedLock !Send marker** — 3-line PhantomData addition.
5. **The bundler B-1..B-5 Renamer cascade** — apply the `*mut LinkerContext` template from `doStep5.rs:43-58` across all 5 sites.
6. **The 8 U2 dealloc-through-SharedReadOnly sites** — replace `core::ptr::from_ref(slice).cast_mut()` with the original owning `*mut T`.
7. **fmt::Raw UTF-8 violation** — replace `from_utf8_unchecked` with `from_utf8_lossy`.
8. **encoding.rs Vec<u8>→Vec<u16> allocator-layout fix** — route through `bun_core::String` raw-bytes constructor (already TODO'd).
9. **linux_errno SystemErrno::from_raw fix** — `strum::FromRepr`.
10. **StoreSlice Send/Sync bounds** — add `<T: Send>`/`<T: Sync>` matching StoreRef pattern. Track `JsCell<T>` / `RacyCell<T>` in the Tier-2 contract-hardening tranche unless a concrete current bad caller is shown.

These 10 PRs, if landed, should close the current P0-band set and most of the P1 surface from the audit.
