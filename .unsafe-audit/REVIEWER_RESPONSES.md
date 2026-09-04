# Phase 10 — Maintainer-Empathy Review

Reading the audit cold, on a fresh checkout of `main`. The goal here is the
"would I land this PR?" question, answered cluster-by-cluster, with the same
skepticism I would bring to any external contributor's drive-by refactor of
the unsafe surface.

Bottom line up front: the audit is unusually well-targeted. The two latent-UB
findings are real and the patches are small enough to land tomorrow. The
mechanical-refactor clusters are mostly correct but need some idiom adjustments
before they survive review. The big (A) plans (A-001) are valuable as
documentation but should never appear in a PR as code changes — only as the
SAFETY-comment hardening pass and the one isolated `pe.rs` win.

---

## C-001 — `NonNull::new_unchecked` → safe constructors

**Verdict:** Yes-with-changes.

**Strengths.** This is the strongest cluster in the audit. The plan splits the
40 sites into three subclasses (C-NULLABLE / C-CHECKED / A) with concrete
rewrites, exact site IDs, and a property-test sketch. The per-site analysis
of S-001064 (`multi_array_list::deallocate`) is the kind of finding I want
from an audit — it lifts the existing `if let Some(layout)` guard so the only
remaining `unsafe` is the `Allocator::deallocate` trait call itself, which is
genuinely an `unsafe fn`. That is a real soundness improvement, not just a
syntactic one.

The PR split (PR-1 C-NULLABLE / PR-2 C-CHECKED / PR-3 optional (A) style
pass) is sized correctly. PR-1's 10 sites across 4 crates is the right shape
for a first landing.

**Concerns.**

1. **`NonNull::from` is not const-stable on the pinned toolchain.** The
   primary worked example — S-000286, `StoreRef::from_static` at
   `src/ast/nodes.rs:82` — is inside a `pub const fn`. Rewriting it to
   `StoreRef(NonNull::from(r))` fails to compile without
   `#![feature(const_trait_impl)]` because `From` is not yet a const trait.
   The pinned nightly (`nightly-2026-05-06`) can opt in via the feature gate,
   but the plan never mentions this. A reviewer would catch it on first
   compile.

   Fix the worked example or pick a non-const site as the headline. The
   plan's S-001 site (S-000286) is also one of the few places where the
   existing SAFETY comment is genuinely load-bearing ("`DerefMut` on a
   `StoreRef` produced here is UB") — removing the `unsafe` block also
   removes the warning-shaped reminder. Worth keeping a `// LIE: DerefMut
   here would be UB; only Deref is audited` comment.

2. **Subclass A's "optional polish" should be cut from the demo PR.** PR-3
   touches 17 sites in `bun_ptr` plus refcount lock-free internals
   (`ThreadPool` steal hot path) and the plan itself flags the
   `unchecked_and_unsafe_init` naming as a porter signal of "don't add
   overhead here." Bundling that into the demo PR is exactly the kind of
   scope creep that gets a "split this up please" comment from Jarred. Land
   PR-1 + PR-2, defer PR-3 to a separate uniform-stance proposal.

3. **The property test is identity-only and verifies nothing useful.** A
   10-case proptest that asserts `lhs.as_ptr() == rhs.as_ptr()` for both
   forms doesn't surface a soundness bug; either both compile to the same
   address or both don't. The real verification is `cargo miri test -p
   bun_<crate>` on the rewritten paths. I'd drop the proptest sketch from
   the PR and just add a single-line comment naming Miri as the oracle.

**Demo-PR readiness.** PR-1 alone (10 C-NULLABLE sites, 4 crates) is a clean
demo. Skip PR-3. Total reviewable surface: ~10 lines changed, mechanical,
zero new dependencies. Approved with the const-fn fix.

---

## C-002 — `mem::transmute<int, enum>` → checked constructors

**Verdict:** Yes-with-changes (and the soundness fix lands as its own PR
immediately).

**Strengths.** The detailed reachability audit of `SystemErrno::from_raw` —
seven live call sites, all walked and proven in-contract — is exactly the
kind of work that justifies the "C-CALLER-TRUST, don't classify as UB" call.
The audit resists the temptation to declare every untyped `u16 → enum`
transmute as latent UB and instead does the work to show the contract holds
today. That credibility is what lets me trust the **one** site
(`linux_errno.rs:175-188`) that the plan does call out as a real bug.

Exhibit F's earlier observation that `PropertyIdTag`'s SAFETY comment names
its own removal path ("replace this transmute with `from_repr` once
`bun_css` exposes it") is the kind of detail that makes me trust the plan
— this isn't an external auditor proposing migrations the maintainers
haven't already approved; it's an external auditor executing migrations the
maintainers explicitly signposted.

**Concerns.**

1. **`num_enum` is one dependency too many.** The plan adds `num_enum =
   "0.7"` to two `*_sys` crates while reusing `strum::FromRepr` elsewhere.
   Pick one. `strum` is already in the workspace and is already used on
   `SystemErrno`; `num_enum` is a fresh transitive surface for two crates
   that touch FFI and need to stay lean. The compile-time and binary-size
   diff is marginal but the consistency win is real. Recommend
   `strum::FromRepr` across the board — same idiom, one fewer crate.

2. **`uv_guess_handle` rewrite changes the fallback semantics.** The plan
   replaces:

   ```rust
   if (Unknown..=File).contains(&raw) { transmute(raw) } else { Unknown }
   ```

   with:

   ```rust
   HandleType::try_from(raw).unwrap_or(HandleType::Unknown)
   ```

   Functionally equivalent today, but `try_from`'s "not in discriminant set"
   judgment is generated from the enum, not from the literal `Unknown..=File`
   range. If a future libuv adds `HandleType::Stream2` (discriminant 18) and
   we bump the enum without re-checking this function, the safe-form returns
   the new variant where the existing code returns `Unknown`. That's
   probably an improvement, but it's a behavior change worth calling out
   explicitly in the commit message.

3. **The SystemErrno `from_raw` → `from_raw_unchecked` rename touches seven
   call sites.** That's fine, but the plan should explicitly note that the
   `pub const fn` signature is preserved at the new name — otherwise
   downstream `bun_runtime` callers that use `from_raw` in const contexts
   regress. A quick `rg 'from_raw' src/errno src/sys src/spawn src/runtime`
   pre-PR sanity check would catch this.

**Demo-PR readiness.** The latent-UB fix (PR #2 in the plan's ordering — 6
LoC in `linux_errno.rs`) should land **first, as its own commit**, with a
title like `errno: fix usize → SystemErrno transmute (latent UB)`. It is a
real bug, the patch is minimal, and pulling it into a multi-site refactor
dilutes its blast radius. The three `num_enum`/`strum` migrations
(`PropertyIdTag`, `cares::Error`, `uv_guess_handle`) can land together as a
follow-up.

---

## C-003 — `unsafe impl Send` / `Sync`

**Verdict:** Yes-with-changes — but only PRs #1, #2, and #5. The structural
refactors (PR #3, #4) need more soak time.

**Strengths.** The classification ratio (46 of 157 manual impls
refactorable, 73 documented as A-CUSTOM-INVARIANT, 38 as A-RAW-PTR-TO-C-STATE)
is consistent with what I'd expect from a careful audit. The `StoreSlice<T>`
soundness fix is real — I verified directly: `src/ast/nodes.rs:339-340`
declares unconditional `Send`/`Sync` while `StoreRef<T>` at lines 39-40 is
correctly `<T: Send>` / `<T: Sync>` and explains its own bound at length in
the prose comment above. This is a one-character typo at the impl level and
an unbounded laundering channel for `!Send` types. Patch is two characters
plus a comment. **Land this tomorrow.**

The `SendPtr` duplication finding is also confirmed: I see three independent
generic `struct SendPtr<T>(*mut T)` declarations in `BundleThread.rs`,
`dns_jsc/dns.rs`, and `jsc/web_worker.rs` (the last is a non-generic
specialization to `WebWorker`), plus `SendVmPtr` in `Debugger.rs`. Three of
four declare `unsafe impl<T> Send` without a `T: Send` bound — same bug
class as `StoreSlice<T>` though without an observed exploit path. The
consolidation into `bun_ptr::SendPtr<T>` is the right call.

**Concerns.**

1. **PR #4's `*mut T` → `NonNull<T> + PhantomData<T>` retrofit understates
   the call-site churn.** `MultiArrayList` and `RawSlice` are deep
   collections types; every constructor and every method that touches the
   `*mut u8` field has to change. The plan claims "~16 unsafe impl lines
   removed" but doesn't account for the cascade: callers stop being able to
   pass `std::ptr::null_mut()` (need `NonNull::dangling()`), arithmetic
   becomes `.as_ptr()` + cast, and any `MaybeUninit` integration loses its
   ergonomics. I want to see one full diff for `MultiArrayList` before
   approving a PR that touches the AST representation crate. It's not
   wrong, but it's not "low-risk" the way the plan claims.

2. **The C-USE-ASSERTIONS pattern is good but the placement matters.** A
   `const _: () = { use static_assertions::assert_impl_all; ... };` block
   is the right shape, but `static_assertions::assert_impl_all!` is itself a
   macro that generates a trait-bound check at the module level. Putting it
   inside a `const _ = {}` works; putting it bare also works. The plan
   doesn't pick a house style. Look at existing usage in the workspace
   (`rg 'assert_impl_all' src/`) before settling — consistency matters more
   than the choice.

3. **A-CUSTOM-INVARIANT sites (73!) get one paragraph.** This is the
   highest-volume cluster of manual impls and the most dangerous if
   future maintainers misread the impl as a free pass. The plan punts to
   "a separate audit pass" for SAFETY-comment quality on these. I'd want
   that pass scoped explicitly into PR #5 or PR #6 — the audit names the
   risk ("future maintainers misreading the impl as a free pass") but
   then defers the mitigation. The 73 sites are where the next typo-shaped
   `StoreSlice` bug will appear.

4. **`bytemuck` `derive` migration is mentioned but not planned.** The
   "188 `unsafe impl Trait`" tally includes ~117 `Zeroable`/`Pod`/`NoUninit`
   sites that the plan says are `derive` candidates. That's a ~60-line
   per-PR win across maybe a dozen crates. Either commit to it in this
   cluster or pull it out as C-004; leaving "~60 sites under bytemuck"
   floating is the kind of half-promise that becomes audit cruft.

**Demo-PR readiness.** PR #1 (`bun_ptr::SendPtr` helper) + PR #2
(`StoreSlice` bound fix) + PR #5 (C-USE-ASSERTIONS sweep) is the right
demo cut. PR #3 (SendPtr migration) waits for #1 to land and review the
call-site shape. PR #4 (collection retrofit) needs a separate proposal
with a full `MultiArrayList` diff.

---

## A-001 — Zig-port `*mut Self` at FFI callbacks

**Verdict:** Yes for the documentation deliverable. No for any
refactor-shaped PR.

**Strengths.** This is the audit's intellectual centerpiece, and it's right.
The stratified sample (122 sites across 33 crates, seed 42, committed to
`cluster_a001_samples.jsonl`) is reproducible methodology. The eight
subclasses (A-FFI-FREE-CALLBACK, A-FFI-NO-FREE, A-REENTRANT,
A-LIFETIME-ERASURE, A-INTRUSIVE, A-PROCESS-LIFETIME, A-OPAQUE-FFI-HANDLE,
C-PURE-RUST) are the right taxonomy. The per-subclass SAFETY-comment
template is the highest-leverage improvement in the entire audit: half the
current SAFETY strings say "BACKREF" or "see fn doc" and naming the actual
proof obligation is exactly what the next on-call reviewer needs.

The finding that **no sampled site exhibits the I-001 anti-pattern** is a
load-bearing positive result. It tells me the port was meticulous about
this specific failure mode, and it tells future critics that "thousands of
`&mut *this` blocks" is not the same as "thousands of UB sites."

The `bun_exe_format::pe.rs` rewrite is the lone (C) win and it's clean —
`view_at_mut` returning `Result<&mut T, _>` via `bytemuck::from_bytes_mut`
removes the unsafe at every caller and at the helper itself, with no
codegen change. Ship that.

**Concerns.**

1. **The two watchlist sites are not closed out.** `h2_frame_parser.rs:3429`
   (HashMap-stored `*mut Stream` aliasing) and `WindowsNamedPipe.rs:1432`
   (`borrow = mut` macro mode choice) are flagged as "deserve a targeted
   miri run" but the plan doesn't commit to running it. If the audit's
   adversarial-classification step found these, the audit's verification
   step should resolve them — or explicitly punt to a follow-up bead with
   a named owner. A loose watchlist is how regressions ship.

2. **The `bytemuck::AnyBitPattern` derive on `PEHeader`/`OptionalHeader64`
   needs a const-padding audit.** Adding `AnyBitPattern` to a `#[repr(C,
   packed)]` struct is sound only if every field is itself
   `AnyBitPattern` AND there are no padding bytes. `packed` removes
   padding so this should be fine, but the rewrite proposal should run
   `bytemuck::AnyBitPattern`'s derive against each of the four named types
   in a scratch build before claiming the win.

3. **A `cluster_a001_safety_walk.md` reference doc is a great idea — but
   the plan stops short of saying who maintains it.** If this doc lands
   under `.unsafe-audit/` it's an external artifact; if it lands under
   `docs/` or `src/io/SAFETY.md` it becomes a project document with a
   maintainer. I'd ask the audit to commit to placement before the demo
   PR opens.

**Demo-PR readiness.** The proposed scope (pe.rs sweep + PipeWriter
SAFETY-comment hardening + the safety-walk reference doc + the
PackageManager::wake_raw SAFETY-comment polish) is roughly the right
size, but I'd cut the safety-walk doc to a separate PR. Each of the four
items can land independently; bundling them invites a "this PR has too
many goals" comment.

The bigger question for A-001: do not attempt a refactor PR. The cluster's
value is in the documentation, not in code change. Any PR that proposes
to refactor a `*mut Self` callback shim is in scope for the "wrong, this
upholds I-001" rejection.

---

## B-001 / B-002 — PERF_ONLY

**Verdict:** Yes-with-changes. The methodology is right; the demo PR scope is
slightly wrong.

**Strengths.** The hypothesis is correctly framed and explicitly
falsifiable: most (B) sites should compile to bit-identical machine code
under `-Copt-level=3 + fat LTO + codegen-units = 1`, and the sites that
regress will be the ones whose bounds proof is opaque to LLVM (cross-Vec
indexing, pointer-projection slices, multi-array_list column slicing). The
`unreachable_unchecked_perf!` macro is good — collapses 12 recurring sites
into a one-liner each while keeping the "why" inline as the safe-mode panic
message.

The per-site disposition is appropriately humble. Of 17 B-001 sites: 2
mis-tagged as (A-FFI) and pulled out (`secure_zero` `black_box`,
`crash_handler_jsc.rs:92` deliberate SIGSEGV); 4 (`bun_jsc/generated.rs`
bindgen-tag arms) graduate to unconditional `unreachable!()` because the
safe form catches bindgen drift instead of UB'ing on it. That last call is
the strongest single finding in the perf cluster — these guards exist to
catch a C++/Rust contract drift, and "panic loudly on drift" beats "UB on
drift" at zero meaningful cost.

The `slice_from_raw` sample work (298 sites split A/B/C with per-crate
rationale) is bonus value the plan didn't have to deliver. The CLI parser
sub-cluster (`bunx_command`, `run_command`, `create_command`) yielding ~28
straight (C-COLD) refactors is a separate quick win.

**Concerns.**

1. **The `safe-only` Cargo feature crosses 14 crates.** That's a lot of
   `[features] safe-only = []` boilerplate, and every crate that
   conditionally compiles based on it adds a CI permutation to track. The
   plan correctly proposes a CI lane that runs `safe-only` against the
   workspace, but adding 14 feature declarations in one PR is a Big Diff
   no matter how mechanical each line is. **Cut the demo to 2 crates**
   (the plan says `bun_install + bun_semver` — that's correct), prove the
   pattern, then scale incrementally per cluster's measured deltas.

2. **The expected-delta hypothesis needs measurement BEFORE the
   workspace-wide feature ships.** The plan correctly identifies which
   sites should be wash and which should regress, but the falsification
   plan ("we measure and find out") needs to run on the demo crates before
   the workspace-level feature plumbing lands. Otherwise we ship the
   feature, never run the benchmark, and the unsafe sites stay forever.
   PR #1 must include the `safe-only` CI lane output for `bun_install` and
   `bun_semver` with both forms.

3. **The bindgen-drift `unreachable!()` upgrade should be its own PR, not
   gated on `safe-only`.** Per the plan's own logic, these four sites
   (`generated.rs:{409,464,494,622}`) trade UB-on-drift for
   panic-on-drift at zero cost. There's no reason to put a feature flag
   around that — make it the default. Land as a small standalone PR
   before the workspace `safe-only` lane exists.

**Demo-PR readiness.** Proposed scope (two crates, ~7 sites, <100 LoC + CI
lane) is right. Pull the bindgen-drift fix into a separate prerequisite PR
that doesn't depend on the feature flag.

---

## Latent UB findings — verified

I verified both findings against the live source on `main` (current
HEAD: `428f61eb34`).

### S-001781 — `impl GetErrno for usize` in `src/errno/linux_errno.rs:175-188`

**Analysis correct.** The function transmutes
`int as u16 → SystemErrno` where `int ∈ {0} ∪ [1, 4095]` per the body,
but `SystemErrno::MAX = 134` (line 151) and the enum has 134 dense
discriminants `0..=133`. Any value in `[134, 4095]` reaches the
`transmute` and produces an enum bit-pattern with no valid discriminant
— UB under Rust's enum-validity invariant.

The SAFETY comment ("int is in [0, 4096); E is #[repr] over the kernel
errno range") is **factually wrong** about the second clause. The kernel
errno range stops at `EHWPOISON = 133`; `[134, 4095]` is the kernel's
reserved-for-future-use band, not part of `SystemErrno`. No live caller
reaches this today (Bun's syscall layer uses `rustix` returning
`Result<T, i32>`), but the function is `pub` and the Zig porting
playbook explicitly tells engineers to read the `.zig` sibling for
intended semantics — a future port path will reintroduce the bug.

**Proposed fix correct.** Replace with
`E::from_repr(raw).unwrap_or(E::SUCCESS)` after adding
`strum::FromRepr` derive (already used on the Windows `SystemErrno`).
6-line patch. Zero release-build cost. **Priority: P1.** Not P0 only
because no live caller reaches it; the `pub` surface is the upgrade
risk.

### S-000292/3 — `unsafe impl<T> Send/Sync for StoreSlice<T>` in `src/ast/nodes.rs:339-340`

**Analysis correct and is the most important finding in the audit.**
Direct comparison against the sister type at lines 39-40 of the same
file: `StoreRef<T>` has correctly-bounded `<T: Send>` / `<T: Sync>` and a
nine-line prose comment explaining exactly why the bound is necessary
("Bounded on `T` so `StoreRef` cannot launder a `!Send`/`!Sync`
payload"). `StoreSlice<T>` immediately below has identical raw-pointer
shape, mirror-image semantics (it's the `[T]` form of the same
arena-borrow pattern), and a SAFETY comment that says "same rationale as
`StoreStr`" — but the impls are unbounded. The fix is two
character-level edits (`<T>` → `<T: Send>` / `<T>` → `<T: Sync>`).

This is unambiguously a typo. The audit's hypothesis ("one of two
adjacent impls was correctly bounded; the other was not") matches the
prose comment style precisely — the comment for `StoreSlice` even
truncates ("same rationale as `StoreStr`") instead of restating the
laundering argument that the bound is supposed to prevent. The author
clearly intended the bounded form.

**Proposed fix correct.** **Priority: P0.** This is a soundness bug in
the AST representation, reachable from any code that builds an `EString`
or similar through the standard parser path. The fact that no caller
exploits it today is a function of the rest of the codebase not having
any `Cell<u32>`-shaped AST payloads — change one type in
`bun_ast::nodes`, and the laundering channel opens. **Land this as a
standalone two-character PR.**

---

## Overall verdict

Would I let this audit land as a series of PRs? **Yes, with the ordering
below.** The audit is doing real work that a grep-based critique cannot:
the per-cluster classification distinguishes load-bearing-unsafe from
mechanical-unsafe with named subclasses, falsifiable justifications, and
adversarial-question coverage. The two soundness fixes are real bugs, the
patches are minimal, and the methodology behind the (A) classification is
the work I would want from anyone who proposed to "clean up" Bun's unsafe.

My recommended PR landing order (vs. the audit's own proposal):

1. **`ast: fix StoreSlice<T> Send/Sync bounds (pre-existing UB)`** — 2
   character changes. P0. Standalone.
2. **`errno: replace unchecked usize → E transmute with from_repr lookup
   (pre-existing UB)`** — 6 LoC. P1. Standalone.
3. **`jsc: switch bindgen-tag unreachable_unchecked to unreachable!() for
   drift safety`** — 4 sites in `bun_jsc/generated.rs`. Standalone, no
   feature flag.
4. **C-001 PR-1 + PR-2 combined** — 10 + 13 sites of `NonNull::new_unchecked`
   → safe forms across 4-7 crates. Fix the const-fn issue at the
   `StoreRef::from_static` site before merging.
5. **C-002 num_enum / strum migrations** — `PropertyIdTag`, `cares::Error`,
   `uv_guess_handle`. Pick `strum::FromRepr` uniformly; drop `num_enum`.
6. **C-003 PR-1 + PR-2** — `bun_ptr::SendPtr<T>` helper + C-USE-ASSERTIONS
   sweep. Defer the structural collection retrofit (PR-4) to a separate
   proposal.
7. **A-001 SAFETY-comment hardening + pe.rs sweep** — documentation
   deliverable plus the one isolated (C) win. The reference doc lands in
   `src/io/SAFETY.md` or `docs/SAFETY.md`, not in `.unsafe-audit/`.
8. **B-001/B-002 `safe-only` feature** — demo crates only
   (`bun_install` + `bun_semver`), with measured deltas in the PR body.
   Scale per-cluster after measurement.

The audit's own ordering (C-001 + C-002 latent-UB as the first demo PR)
under-emphasizes the StoreSlice fix. That two-character patch is the
single most landed-tomorrow item in the audit. Pull it out first; the
demo PR's value goes up, not down.

**Concerns about the audit's methodology that I'd raise to the author:**

1. **`cargo expand` was skipped.** Per the AUDIT_SUMMARY's own "what
   this audit does NOT claim" section, macro-emitted unsafe (from
   `pin-project-lite`, `bytemuck-derive`, the bun_*_macros family) is
   invisible. The 11,044 site count is therefore a lower bound. For a
   Bun-internal review this is fine; for an external marketing claim it
   needs to be foregrounded, not buried in section 6.

2. **The (A) sites that lack SAFETY comments (~20% of (A) per the
   summary) are not enumerated.** The audit promises "per-crate hardening
   templates" but doesn't list the specific sites. The next step has to
   be a per-crate list of "SAFETY-comment missing" sites — otherwise the
   hardening pass is unmeasurable.

3. **Phase 6 adversarial reclassification was not run end-to-end.**
   `master-classification.md` says Phase 6 "will run in a subsequent
   audit pass (or via the user's multi-harness comparison run, which is
   itself a form of adversarial reclassification)." A single-pass audit
   that defers its own adversarial step is half the methodology. Either
   commit to a Phase 6 pass under the same authorship or note it as
   pending more visibly.

4. **No miri runs against the demo refactors.** The verify.sh harness
   exists but the audit doesn't show a successful miri run against any of
   the proposed PRs. Before the demo PR opens, run `cargo +nightly miri
   test -p bun_ast` (after the StoreSlice fix) and `cargo +nightly miri
   test -p bun_errno` (after the `from_repr` fix) and attach the output
   to the PR body. Maintainers will ask.

5. **The audit's marketing framing risks overclaiming.** The headline
   ratio "98% justified, 2% refactorable" is defensible per the
   classification methodology, but the inventory's 11,044 count is
   inflated by every `unsafe { &mut *this }` reborrow that appears
   inside a single function — the same provenance discipline counted
   site-by-site. A maintainer reading the count cold may push back. The
   counter is "the count is per-site by design because each site is the
   reborrow that must satisfy I-001," which is correct but worth saying
   in the headline rather than the body.

These are constructive notes for the next pass, not blockers. The audit
as it stands is closer to landable than most external unsafe-cleanup
proposals I've reviewed.
