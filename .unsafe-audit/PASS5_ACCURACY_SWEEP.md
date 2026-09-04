# Pass 5 — Final Accuracy Sweep

**Date:** 2026-05-15
**Scope:** Re-verify every defensible T1 finding (post-Codex P3 final review + P4 corrections) against the current `claude/unsafe-exorcist-audit` branch.
**Method:** For each finding, read the cited file:line in the current tree (not the audit-time snapshot), confirm: (a) file still exists, (b) the cited line still contains the bug shape described, (c) the SAFETY comment hasn't been changed to mitigate, (d) no fix has been merged on this branch.
**Editorial discipline:** evidence cited per finding is the current-source line content, not hearsay.

## Important context

- Three findings (`pre-existing-ub-001`, `pre-existing-ub-002`, `TH-1`) are listed in the audit notes as "already fixed in PR #30765". The fix commits exist on a **different** branch (`claude/unsafe-exorcist-demo`):
  - `3c1323386c fix(bun_threading): mark GuardedLock !Send via PhantomData<*const ()>`
  - `b1a16e0b7c fix(bun_ast): bound StoreSlice<T> Send/Sync on T`
  - (linux_errno fix from the same series)
  - These commits are **NOT** present on the audit branch (`claude/unsafe-exorcist-audit`). On `git HEAD` of this branch, the bugs are still live. Tracked here as **VERIFIED-STILL-LIVE-ON-AUDIT-BRANCH** so this artifact is honest about the working tree under audit.

- `git log --since='2026-05-10'` for the relevant source files shows only one cosmetic touch (`fe2635b460` cargo fmt). This is the dominant cause of the small line-number drifts noted below.

---

## Per-finding verification table

| # | ID | Audit cited location | Current location | Status | Evidence |
|---|------|---------------------|------------------|--------|----------|
| 1 | PUB-INSTALL-1 | `src/install/lockfile/Package/Meta.rs:38-46` | `Meta.rs:39-46` (declaration), `Meta.rs:84-86` (`needs_update`) | VERIFIED | `#[repr(u8)] pub enum HasInstallScript { Old = 0, False, True }` still has 3 valid discriminants; deserialization paths (`Package.rs:3472 unsafe { sliced.items_mut::<"meta", Meta>() }`) still form typed `&[Meta]` over untrusted lockfile bytes. `needs_update()` at L84-86 reads the field. |
| 2 | PUB-INSTALL-2 | `src/install/lib.rs:1128` | `src/install/lib.rs:1128-1135` | VERIFIED | `#[repr(u8)] pub enum Origin { Local = 0, Npm = 1, Tarball = 2 }`. Same shape: 3 valid discriminants; embedded inside `Meta` which is deserialized from lockfile. |
| 3 | PUB-INSTALL-3 | `src/install/yarn.rs:918-925` | `src/install/yarn.rs:916-925` | VERIFIED | Lines 918-925 form `&mut [Dependency]` over Vec capacity beyond `len`: `bun_core::ffi::slice_mut(dependencies_base_ptr, num_deps as usize)`. `slice_mut` in `src/opaque/lib.rs:422` is `core::slice::from_raw_parts_mut(ptr, len)` with no init check; `Dependency` contains `DependencyVersionTag` (closed `#[repr(u8)]` enum), so this is niche-T uninit, not all-bytes-valid. Miri trace captured under verification/miri-confirmed-summary.md confirms `reading memory at alloc206[0x0..0x1], but memory is uninitialized`. |
| 4 | PUB-INSTALL-4 | `src/install/lockfile/Tree.rs:1020` | `src/install/lockfile/Tree.rs:1020` | VERIFIED | `let dep = unsafe { deps.get_unchecked(dep_id as usize) };` where `dep_id` was read at line 1017 from `this_deps_ptr` (lockfile-resident bytes); SAFETY comment at 1018-1019 confirms it trusts attacker-controlled values. |
| 5 | F-NEW-1 | `src/semver/lib.rs:613` `String::slice` | `src/semver/lib.rs:613` | VERIFIED | `unsafe { buf.get_unchecked(off..off + len) }` where `(off, len) = (ptr_.off as usize, ptr_.len as usize)` decoded from `[u8; 8]` String repr loaded out of `bun.lockb`. SAFETY comment at L609-611 acknowledges it mirrors Zig ReleaseFast (no bounds check). |
| 6 | F-NEW-2 | `src/semver/lib.rs:536-537` `String::eql` | `src/semver/lib.rs:535-538` | VERIFIED | `strings::eql(unsafe { this_buf.get_unchecked(a_off..a_off + a_len) }, unsafe { that_buf.get_unchecked(b_off..b_off + b_len) })` — two simultaneous unchecked subslices, both decoded from lockfile bytes. Same SAFETY rationale as F-NEW-1. |
| 7 | H9 | `src/picohttp/lib.rs:383` | `src/picohttp/lib.rs:383` | VERIFIED | `unsafe { path_ptr.cast_mut().add(path_len).write(0) };` inside `parse(buf: &'a [u8], src: &'a mut [Header])`. `buf` is a shared `&[u8]`; `path_ptr` is derived from it; `cast_mut()` does NOT confer write provenance. SAFETY comment at L380-382 acknowledges "Zig casts away const here too" — still UB under Stacked/Tree Borrows. |
| 8 | H5 | `src/http/lib.rs:631, 2218` | `src/http/lib.rs:631, 2213-2219` | VERIFIED-WITH-CAVEAT (request-smuggling primitive, NOT memory-UB) | `pub request_content_len_buf: [u8; b"-4294967295".len()]` at L631 = 11 bytes; `buf_print` at L2213-2219 returns `Err` on overflow (verified in `bun_core/fmt.rs:765-777` — `buf_print` uses `SliceCursor` which returns `fmt::Error` when `end > buf.len()`). On overflow the code falls back to `b"0"` (L2219), so the impact is **wire-protocol corruption / request smuggling on >10^10-byte bodies**, not Rust memory UB. The audit's own write-up (`PASS3-http-stack-deep-dive.md:940-958`) correctly classifies this as medium severity, request-smuggling-class, not UB. Keep it only in a separately labelled security-priority list. |
| 9 | bundler-B1 | `src/bundler/Chunk.rs:130-132` | `src/bundler/Chunk.rs:130-132` | VERIFIED | `// TODO(ub-audit): Renamer<'r> still borrows &'r mut {Number,Minify}Renamer, so the per-chunk renamer is reborrowed mutably from each part-range task; the printer never writes through it, but the borrow should become &'r.` Author has self-flagged the cascade. |
| 10a | bundler-B2 | `LinkerContext.rs:1657` (`ctx.c()` calls `assume_mut`), invoked from `postProcessJSChunk.rs:53` | same | VERIFIED | `pub fn c(&self) -> &mut LinkerContext<'a> { unsafe { self.c.assume_mut() } }` at L1657-1663; called from `postProcessJSChunk.rs:53` as `let c: &mut LinkerContext = ctx.c();` — every worker materializes the same `&mut`. The driver `each_ptr(chunk_contexts[0], LinkerContext::generate_chunk, chunks_to_do)` is at `generateChunksInParallel.rs:330-334`. |
| 10b | bundler-B3 | `generateCompileResultForJSChunk.rs:61` (`c_mut = &mut *c_ptr`) | same | VERIFIED | Line 61: `let c_mut: &mut LinkerContext = unsafe { &mut *c_ptr };` inside the per-part-range worker callback. SAFETY comment at L54-59 admits "peer tasks still hold their own &mut views into the same LinkerContext/Chunk for read-only printer use — see TODO(ub-audit) on `unsafe impl Sync for Chunk`." This is the bug, self-disclosed. |
| 10c | bundler-B4 | `generateCompileResultForJSChunk.rs:62`, `generateCompileResultForCssChunk.rs:46` | same | VERIFIED | JS path L62: `let chunk_mut: &mut Chunk = unsafe { &mut *chunk_ptr };`. CSS path L46: identical. Multiple `PendingPartRange` tasks belonging to one chunk can run in parallel; the disjoint write target (`compile_results_for_chunk[i]`) is plumbed correctly *afterwards* via `Chunk::write_compile_result_slot`, but the inner impl call holds `&mut Chunk` aliased. |
| 10d | bundler-B5 | `prepareCssAstsForChunk.rs:76-80` | same | VERIFIED | `prepare_css_asts_for_chunk_impl(unsafe { &mut *linker }, unsafe { &mut *chunk }, worker.arena())` — multiple CSS chunk tasks reborrow the same linker mutably in parallel. |
| 11.1 | U2 dealloc-thru-Shared #1 | `http/AsyncHTTP.rs:117` | `http/AsyncHTTP.rs:117` | VERIFIED | `unsafe { bun_core::heap::destroy(core::ptr::from_ref(href).cast_mut()) };` where `href: &[u8]`. |
| 11.2 | U2 #2 | `http/lib.rs:176` | `http/lib.rs:176` | VERIFIED | `unsafe { bun_core::heap::destroy(core::ptr::from_ref(list).cast_mut()) };` where `list: &[Header]`. |
| 11.3 | U2 #3 | `runtime/node/node_fs.rs:2397` | `runtime/node/node_fs.rs:2397` | VERIFIED | `drop(Box::<[u8]>::from_raw(core::ptr::slice_from_raw_parts_mut(bytes.as_ptr().cast_mut(), bytes.len() + 1)))` where `bytes: &[u8]` (`as_ptr` carries `SharedReadOnly`). |
| 11.4 | U2 #4 | `bun_alloc/lib.rs:3267` | `bun_alloc/lib.rs:3267-3273` | VERIFIED | `mimalloc::mi_free(existing_slice.as_ptr().cast_mut().cast::<c_void>())` where `existing_slice` was loaded from `self.key_list_overflow[idx]` and is borrowed shared. |
| 11.5 | U2 #5 | `bun_core/string/mod.rs:1765` | `bun_core/string/mod.rs:1763-1770` (the `mi_free` is at 1766-1768) | VERIFIED (minor line drift — the `unsafe` block opens at 1765, the `mi_free` call is at 1766) | `bun_alloc::mimalloc::mi_free(self.slice().as_ptr().cast_mut().cast::<core::ffi::c_void>())` inside `deinit_global(&self)`. `self.slice()` is `&[u8]` from `&self`. |
| 11.6 | U2 #6 | `jsc/lib.rs:2013` | `jsc/lib.rs:2022-2027` | **DRIFTED** | The bug pattern still exists — `bun_alloc::mimalloc::mi_free(self.byte_slice().as_ptr().cast_mut().cast::<core::ffi::c_void>())` — but the `mi_free` call now opens at line 2022 (the audit cited 2013, which currently is just `fn to_atomic_value`). Cause: cosmetic shift from `cargo fmt`. Bug intact; line number needs updating to 2022. |
| 11.7 | U2 #7 | `jsc/ZigString.rs:70` | `jsc/ZigString.rs:70` | VERIFIED-WITH-CAVEAT | Line 70: `unsafe { bun_alloc::mimalloc::mi_free(ptr.cast_mut().cast::<core::ffi::c_void>()) }` inside `to_external_u16(ptr: *const u16, len: usize, ...)`. Caveat: `ptr` is a raw `*const u16` parameter here, not derived from a Rust `&T` at *this* site. The `cast_mut()` warning pattern is in place, but realizing UB at this site requires the caller to have passed a `*const u16` originally derived from `&[u16]`. SAFETY contract at L62-64 says `ptr` must come from the global mimalloc allocator, which is a stronger condition; if all callers honor that contract then no `&T`-provenance ptr ever reaches this point. Keep on the list as a hardening item, but it is **weaker** than U2 #1-#5 / #8 which all derive in-frame from `&T`. |
| 11.8 | U2 #8 | `jsc/ZigString.rs:102` | `jsc/ZigString.rs:102` | VERIFIED | Line 102: `unsafe { bun_alloc::mimalloc::mi_free(ptr.cast_mut().cast::<c_void>()) }` where `ptr = ZigString::init(s).slice().as_ptr()` (line 96). `.slice()` returns `&[u8]` from `&ZigString`. Same shape as U2 #1-#5. Verified. |
| 12 | U1 | `src/runtime/cli/pack_command.rs:3009` | `pack_command.rs:3009` | VERIFIED | `let command_ctx = unsafe { &mut *std::ptr::from_ref(ctx.command_ctx).cast_mut() };` — forms `&mut` by casting away const from a shared borrow. SAFETY comment at L3007-3008 admits "no concurrent &mut exists while a lifecycle script runs (single-threaded CLI dispatch)" — design hazard, not necessarily current production UB, but the pattern matches the U1 bug class. |
| 13 | pre-existing-ub-002 (StoreSlice) | `src/ast/nodes.rs:339-340` | same | VERIFIED-STILL-LIVE-ON-AUDIT-BRANCH | `unsafe impl<T> Send for StoreSlice<T> {} / unsafe impl<T> Sync for StoreSlice<T> {}` — no `T: Send` / `T: Sync` bound. Fix commit `b1a16e0b7c` is on branch `claude/unsafe-exorcist-demo`, **not** in HEAD of `claude/unsafe-exorcist-audit`. So on the audit branch, the bug is live. Note: per `git branch --contains b1a16e0b7c`, that commit only exists on the demo branch. |
| 14 | pre-existing-ub-001 (linux_errno) | `src/errno/linux_errno.rs:175-188` | `src/errno/linux_errno.rs:181-193` (actual `transmute` at L192) | VERIFIED-STILL-LIVE-ON-AUDIT-BRANCH | `unsafe { core::mem::transmute::<u16, E>(int as u16) }` at L192, with `int` derived from a `usize` errno return. The `E` enum is `#[repr]`-narrow over the kernel errno range; arbitrary `int` values can produce invalid discriminants. Fix from PR #30765 series is not on this branch. Miri trace: `enum value has invalid tag: 0x0086`. |
| 15 | TH-1 (GuardedLock !Send) | `src/threading/guarded.rs:138-145` | actual `struct GuardedLock` at L132-134 | VERIFIED-STILL-LIVE-ON-AUDIT-BRANCH | `pub struct GuardedLock<'a, Value, M: RawMutex> { guarded: &'a GuardedBy<Value, M> }` — no `PhantomData<*const ()>` field. Because this module re-asserts `Sync` for `GuardedBy<Value, M>` under `Value: Send, M: RawMutex + Sync`, `GuardedLock` can auto-derive `Send` in the exact cases where a guard should stay on the locking thread. That would allow moving a held guard across threads and running `Drop` there. Fix commit `3c1323386c` is on `claude/unsafe-exorcist-demo`, not on this branch. Audit cited line 138-145; actual struct decl is at 132-134 — **line drift** from cargo fmt. Bug intact. |
| 16 | UB-RT-001 (Vec<u8>→Vec<u16>) | `src/runtime/webcore/encoding.rs:303-310` | same | VERIFIED | `Vec::from_raw_parts(input.as_mut_ptr().cast::<u16>(), usable_len / 2, input.capacity() / 2)` where `input: Vec<u8>` (alignment 1) is reinterpreted as `Vec<u16>` (requires alignment 2). On drop, the Vec<u16> calls `dealloc` with `Layout::array::<u16>(cap).unwrap()` (alignment 2), but mimalloc was given the original allocation with alignment 1. Miri confirms: `incorrect layout on deallocation: size 6 alignment 1, but gave size 6 alignment 2`. TODO comment at L298-301 explicitly acknowledges the bug. |
| 17 | F-1 (linear_fifo niche-T) | `src/collections/linear_fifo.rs:67-71` | same | VERIFIED | `fn assume_init_slice<T>(s: &[MaybeUninit<T>]) -> &[T] { unsafe { &*(ptr::from_ref::<[MaybeUninit<T>]>(s) as *const [T]) } }` — no bound on `T`. For niche-T (e.g., `bool`, `char`, `NonNull`, enums), reading uninitialized bytes as `T` is immediate reference UB. SAFETY doc at L62-66 admits soundness only for "byte buffers". Miri confirms: `reading memory ... but memory is uninitialized`. |
| 18a | P3-BC-001 (fmt::Raw) | `src/bun_core/fmt.rs:725-732` | same | VERIFIED | `unsafe { core::str::from_utf8_unchecked(self.0) }` inside safe `Display::fmt` — caller-supplied non-UTF-8 byte slice forms an invalid `&str`. SAFETY comment at L728-729 admits "in practice ASCII" — not a contract. |
| 18b | P3-BC-002 (StringBuilder::move_to_slice) | `src/bun_core/string/StringBuilder.rs:315-332` | same | VERIFIED | Line 331: `unsafe { crate::heap::take(slice::from_raw_parts_mut(ptr.as_ptr(), cap)) }` — returns `Box<[u8]>` of length `cap`, but only `len` bytes were initialised. TODO at L330 explicitly admits "if not fully written this reads uninit bytes — Zig didn't care." Safe API exposing deferred UB. |
| 18c | P3-BC-003 (BoundedArray::resize + slice) | `src/bun_core/bounded_array.rs:93-114` | same | VERIFIED | `fn resize(&mut self, len: usize) -> Result<(), OverflowError>` at L108-114 grows logical length without initialising; safe `slice(&mut self)` / `const_slice(&self)` at L93-104 then expose uninit `T`. For niche-bearing `T` this is reference UB. |
| 18d | P3-BC-004 (MutableString::to_owned_slice_length) | `src/bun_core/string/MutableString.rs:416-420` | same | VERIFIED | Line 416-420: `pub fn to_owned_slice_length(&mut self, length: usize) -> Box<[u8]> { unsafe { self.list.set_len(length) }; self.to_owned_slice() }` — caller-supplied `length > capacity` exposes uninit `u8` and OOB; safe API. SAFETY comment names the obligation but it lives only in the comment. |
| 18e | P3-BC-005 (MutableString::inflate + safe slice) | `src/bun_core/string/MutableString.rs:311-320` | same | VERIFIED | `pub fn inflate(&mut self, amount: usize) -> Result<(), AllocError>` at L311-320 reserves + `set_len(amount)` leaving the new tail uninit. Safe `pub fn slice(&mut self) -> &mut [u8]` then exposes those uninit bytes to any reader. |
| 19 | CRASH-T1-1 (PANIC_MUTEX) | `src/crash_handler/lib.rs:904, 1850` | same | VERIFIED | Line 904: `let _panic_guard = PANIC_MUTEX.lock();` on the POSIX signal-handler path. Line 1850: same call on the Rust panic path. Mutex lock is not async-signal-safe. Author's TODO at line ~588 already acknowledges this. **Not memory-UB; tracked as signal-safety crash-reliability defect** per PASS4 corrections. |
| 20 | CRASH-T1-2 (Output::flush) | `src/crash_handler/lib.rs:938, 1866` | same | VERIFIED | Line 938 (signal path) and line 1866 (panic path): both call `Output::flush();` which routes through `SOURCE.with_borrow_mut` (`RefCell`). Fault-during-print can panic/re-enter the crash path. Same severity-class as CRASH-T1-1. |
| 21a | sys-T1 Linux getdents64 | `src/sys/lib.rs:373` | same | VERIFIED | `let name_field = &buf[base + 19..base + reclen];` — if a buggy FUSE filesystem or fabricated seccomp reply returns `reclen < 19`, this panics; debug_assert at L365 only checks `base + reclen <= end_index`, not `reclen >= 19`. Hardening, not full memory UB. |
| 21b | sys-T1 macOS namlen=0 | `src/sys/lib.rs:498` | same | VERIFIED | `let name = &buf[base + 21..base + 21 + namlen];` — if `namlen == 0` and `base + 21 == end_index`, the zero-length slice's one-past-end pointer is at the end of the filled region; the `Name::borrow` debug_assert at line 204 dereferences `*s.as_ptr().add(s.len())` for a NUL probe, reading past the kernel-filled prefix. Debug-only contract gap, but real if a non-Darwin kernel surface (or FUSE) ever emits zero-namlen records. |
| 21c | sys-T1 Windows UNICODE_STRING (open_dir) | `src/sys/lib.rs:6485-6489` | `src/sys/lib.rs:6485-6489` | VERIFIED | `Buffer: p.as_ptr().cast_mut().cast::<u16>()` storing a `*const u16` derived from `&[u16]` into `UNICODE_STRING::Buffer: *mut u16`. NtCreateFile treats ObjectName as read-only by API contract, so no actual write through the pointer happens; however, the provenance footgun (deriving `*mut` from a shared borrow and handing it to NT) is the same one Pass 1 flagged elsewhere. |
| 21d | sys-T1 Windows UNICODE_STRING (open_file) | `src/sys/lib.rs:6553-6557` | same | VERIFIED | Same shape, sibling function `open_file_at_windows_nt_path` at L6556. |

---

## Summary

| Class | Count |
|-------|------:|
| VERIFIED (still real, line still accurate) | 31 |
| VERIFIED (minor non-substantive line drift, bug shape unchanged) | 1 |
| VERIFIED-STILL-LIVE-ON-AUDIT-BRANCH (fix exists on a different branch only) | 3 |
| VERIFIED-WITH-CAVEAT (verified but with weakened claim / severity) | 2 |
| DRIFTED (bug intact, line shifted) | 1 |
| FIXED-UPSTREAM | 0 |
| FALSE-POSITIVE | 0 |

**Total findings re-verified: 38 individual entries** covering the 21-numbered group from PASS4_FINDINGS_INDEX.md (PUB-INSTALL-1..4, F-NEW-1/2, H9, H5, bundler-B1..B5, U2.x8, U1, the three "PR #30765 series" findings, UB-RT-001, F-1, P3-BC-001..005, CRASH-T1-1/2, sys-T1 family of 4).

**Net adjustment:** the audit's core finding list holds up, but two entries need presentation discipline: H5 is security/request-smuggling rather than Rust memory UB, and U2 #7 is weaker contract-reliance hardening rather than the same-strength in-frame `&T` provenance bug as the other U2 entries.

---

## DRIFTED findings

### D-1: U2 #6 (jsc/lib.rs `to_external_value` mi_free)

- **Audit cited:** `src/jsc/lib.rs:2013`
- **Current location:** `src/jsc/lib.rs:2022` (the `mi_free` call is in lines 2022-2027, inside the `if self.len > bun_core::String::max_length()` arm of `fn to_external_value`)
- **Cause of drift:** `fe2635b460 ci: replace zig fmt with cargo fmt --all in the format workflow` — global cargo fmt pass that landed on main after the audit snapshot.
- **Impact:** None on validity of the finding; only the citation line needs updating.
- **Action:** update `PASS4_FINDINGS_INDEX.md` and `audit/plans/*` to read `jsc/lib.rs:2022` (or, more durably, cite the enclosing function `to_external_value` and the SAFETY anchor at line 2020).

### Minor line drifts (kept under VERIFIED, called out for completeness)

- `bun_core/string/mod.rs`: audit said 1765 for `deinit_global`; the `unsafe` block opens at 1765 and the `mi_free` call is at 1766–1768. Audit citation acceptable as-is.
- `errno/linux_errno.rs`: audit said 175-188 for `GetErrno`; actual is L181-193, with `transmute` at L192. Same cargo fmt cause.
- `threading/guarded.rs`: audit said 138-145 for `GuardedLock`; actual `struct` decl is at L132-134. Cargo fmt + comment additions.

None of these line drifts changes the bug shape; all of these have intact SAFETY context confirming the audit's claim.

---

## VERIFIED-WITH-CAVEAT (weakened claim)

### C-1: H5 (`request_content_len_buf`) is security-T1, not memory-UB

- **Audit cited:** `src/http/lib.rs:631, 2218`
- **Current status:** request-smuggling / wire-protocol corruption primitive for oversized bodies, not Rust memory UB.
- **Classification:** keep on a security-priority list if the audit tracks non-UB security defects, but do not count it in "memory-safety T1" totals.

### C-2: U2 #7 (jsc/ZigString.rs `to_external_u16` mi_free at L70)

- **Audit cited:** `src/jsc/ZigString.rs:70`
- **Current line content:** `unsafe { bun_alloc::mimalloc::mi_free(ptr.cast_mut().cast::<core::ffi::c_void>()) };`
- **Function signature:** `pub fn to_external_u16(ptr: *const u16, len: usize, global: &JSGlobalObject) -> JSValue`
- **Caveat:** at this exact line, `ptr` is a raw `*const u16` parameter; no `&T` is materialized at this site. The `cast_mut()` warning pattern is present, but realising UB here requires a caller to have passed a `*const u16` originally derived from a shared reference. The SAFETY contract at L62-64 demands that `ptr` come from the global mimalloc allocator, which (if honoured) eliminates the `&T`-provenance scenario.
- **Comparable site:** `jsc/ZigString.rs:102` (`ZigString__free`) — there `ptr = ZigString::init(s).slice().as_ptr()` is derived in-frame from `&[u8]`, so the U2 shape is genuine.
- **Classification:** keep as a hardening / contract-reliance item, but do not count it at the same strength as U2 #1, #2, #3, #4, #5, #8 which all derive in-frame from `&T`.

---

## VERIFIED-STILL-LIVE-ON-AUDIT-BRANCH

These three are listed in the audit notes as "already fixed in PR #30765 — the
audit author's own remediation". On the current audit branch
(`claude/unsafe-exorcist-audit`), the fixes are **not** merged in; they live on
`claude/unsafe-exorcist-demo`.

| ID | Branch with fix | Fix commit |
|----|-----------------|------------|
| StoreSlice<T> Send/Sync bound | `claude/unsafe-exorcist-demo` only | `b1a16e0b7c fix(bun_ast): bound StoreSlice<T> Send/Sync on T` |
| GuardedLock !Send marker | `claude/unsafe-exorcist-demo` only | `3c1323386c fix(bun_threading): mark GuardedLock !Send via PhantomData<*const ()>` |
| linux_errno transmute → FromRepr | (companion commit in same series) | (associated with the same `unsafe-exorcist-demo` series) |

On the current audit branch they are **VERIFIED bugs in live form** — this matters because anyone consuming `PASS5_ACCURACY_SWEEP.md` against the audit branch will see the bugs in the source code. If/when the demo branch is merged or its commits cherry-picked, these three should flip to FIXED-UPSTREAM.

---

## FIXED-UPSTREAM

**None.** No T1 finding from the defensible list has been independently fixed by an upstream maintainer commit since the audit ran.

(The maintainers' broader `unsafe`-removal work — 2,989 blocks per PASS4 archaeology — represents a *trajectory* match with audit findings, but none of those landed commits closes one of the specific T1 findings on this list.)

---

## FALSE-POSITIVE

**None.** Every defensible T1 finding from PASS4_FINDINGS_INDEX.md + CODEX_PASS3_FINAL_REVIEW.md still has an intact bug shape at the cited (or drifted) location.

The Codex P3 final review and P4 corrections already pulled the audit's claim
list down to a defensible set; this Pass-5 sweep found no fully-invalidated
findings, plus the presentation/severity corrections above.

---

## Editorial notes for downstream artifacts

1. **Update `PASS4_FINDINGS_INDEX.md`** to cite `jsc/lib.rs:2022` instead of `jsc/lib.rs:2013` for U2 #6.
2. **Add a "fix branch" annotation** to the StoreSlice/GuardedLock/linux_errno entries clarifying that the fixes live on `claude/unsafe-exorcist-demo`, not on the audit branch, so that anyone running `git checkout claude/unsafe-exorcist-audit && grep ...` and expecting the fix to be applied is not surprised.
3. **Re-tier H5** if the editorial rule from CODEX_PASS3_FINAL_REVIEW.md item 2 is followed strictly: H5 is a request-smuggling primitive, not a Rust memory-safety bug. Keep H5 on the security-T1 list only if it is explicitly separated from memory-UB counts.
4. **Weaken U2 #7** (`jsc/ZigString.rs:70`) to a "contract-reliance hardening" item rather than dashboard-counted T1, since at the exact site no `&T` is materialized.

---

## Final verified priority count

**38 distinct entries verified as real findings or real hardening/security items.** Breakdown by category:

- 6 ceiling-score supply-chain entries (PUB-INSTALL-1..4, F-NEW-1, F-NEW-2)
- 1 HTTP request-smuggling primitive (H5) — non-UB
- 1 picohttp shared-slice NUL-write (H9)
- 5 bundler aliased-&mut sites (B-1..B-5)
- 8 U2 dealloc-through-shared sites (with U2 #7 noted as weaker; U2 #6 with drifted line)
- 1 &mut-from-& cast (U1)
- 3 "fix-on-demo-branch" entries (StoreSlice, linux_errno, GuardedLock)
- 1 allocator-layout (UB-RT-001)
- 1 niche-T (F-1)
- 5 bun_core safe-API uninit/UTF-8 (P3-BC-001..005)
- 4 sys-T1 family (Linux reclen, macOS namlen=0, Windows ×2)
- 2 crash-signal-safety (CRASH-T1-1, CRASH-T1-2) — not memory UB, but on the consolidated T1-equivalent list

**Zero fully-invalidated entries in this sweep. Zero fixed-upstream. One drifted line (U2 #6 → jsc/lib.rs:2022). Three "still live on audit branch" entries (fixes exist on demo branch only). Two presentation/severity corrections required before using this as a headline count: H5 is non-memory-UB security, and U2 #7 is weaker hardening.**

The audit is publishable only if downstream summaries carry the presentation
and severity caveats above. The list survives a fourth independent
re-verification against current source.
