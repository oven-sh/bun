# Phase 1 Inventory — Section N: bun_core-foundation

> Per-row table; one row per unsafe site of interest. Sites are sampled to
> cover every distinct shape (atomic, FFI decl, raw-ptr lifecycle, Send/Sync,
> transmute/zeroed, get_unchecked, Pin/NonNull::new_unchecked, intrinsics,
> macro-emitted). High-volume repetitive shapes (e.g. ~80 `set_len` /
> `Box::from_raw` pairs in `lib.rs`) are summarized at the bottom rather than
> enumerated. The full per-line catalog is the prior audit JSONL
> (`.unsafe-audit/unsafe-inventory.jsonl`, 625 rows for these 9 crates), which
> remains valid; this section's aggregate is **831** sites — delta **+206**
> vs prior `625`, attributable to growth in `bun_core::env_var`,
> `bun_core::Progress`, `bun_core::util` (env/argv), and macro forwarders in
> `bun_core_macros`. **Zero new structural shapes** detected.

| file:line | site_kind | bucket(s) | safety_status | macro_status | prior_audit_id | notes |
|-----------|-----------|-----------|---------------|--------------|----------------|-------|
| `src/bun_core/atomic_cell.rs:65` | unsafe_impl Sync | #7 #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / sync_impl | `AtomicCell<T: Copy>` Sync — names AcqRel default + AtomicPtr-Send rationale |
| `src/bun_core/atomic_cell.rs:66` | unsafe_impl Send | #7 #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / send_impl | paired with above |
| `src/bun_core/atomic_cell.rs:92` | unsafe block + atomic load | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / atomic | **Acquire** (default), aligned via `_align: [AtomicU64; 0]` |
| `src/bun_core/atomic_cell.rs:99` | unsafe block + atomic store | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / atomic | **Release** |
| `src/bun_core/atomic_cell.rs:106` | unsafe block + atomic swap | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / atomic | **AcqRel** |
| `src/bun_core/atomic_cell.rs:114-122` | unsafe block + atomic CAS | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / atomic | success **AcqRel**, failure **Acquire** |
| `src/bun_core/atomic_cell.rs:146` | unsafe block + atomic load | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / atomic | **Relaxed** — name-explicit `load_relaxed` |
| `src/bun_core/atomic_cell.rs:153` | unsafe block + atomic store | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / atomic | **Relaxed** — name-explicit `store_relaxed` |
| `src/bun_core/atomic_cell.rs:194-209` | unsafe trait Atom | #6 #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | trait contract: size ∈ {1,2,4,8}, no padding |
| `src/bun_core/atomic_cell.rs:215-228` | unsafe const fn xmute (union pun) | #6 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | size-matched bit reinterpret via union |
| `src/bun_core/atomic_cell.rs:236-283` | macro_rules! unsafe_impl_atom | #5 #6 | PRESENT_STRONG | MACRO_GENERATED | bun_core / other | size/align `const _ assert!`; emits `unsafe impl Atom` |
| `src/bun_core/atomic_cell.rs:294,300,306,312` | unsafe block in size_dispatch macro | #3 #4 | PRESENT_WEAK | MACRO_GENERATED | bun_core / atomic | `&*(p as *const AtomicU{8,16,32,64})` — alignment proof: `_align: [AtomicU64;0]` ZST forces 8-aligned |
| `src/bun_core/atomic_cell.rs:317` | unsafe hint::unreachable_unchecked | #4 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | gated by `const _ assert!` rejecting other widths |
| `src/bun_core/atomic_cell.rs:324-359` | 4× pub unsafe fn `_dispatch_*` | #3 #6 #7 | PRESENT_WEAK | SOURCE_DIRECT | bun_core / atomic / raw_cast | doc-hidden helpers; SAFETY forwarded to `unsafe_impl_atom!` const_assert |
| `src/bun_core/atomic_cell.rs:363-365` | unsafe_impl_atom! invocation | #5 | PRESENT_STRONG | MACRO_GENERATED | bun_core / atomic | bool/char/u*/i*/f32/f64 — no padding for any |
| `src/bun_core/atomic_cell.rs:372-470` | 3× unsafe impl Atom for `*mut`/`*const`/`Option<NonNull>` | #6 #2 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / atomic / raw_cast | provenance-preserving via AtomicPtr |
| `src/bun_core/atomic_cell.rs:503-504` | unsafe_impl Send/Sync for ThreadCell | #7 #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / send_impl/sync_impl | debug-checked owner via `claim()` |
| `src/bun_core/atomic_cell.rs:574` | pub fn get_unchecked → *mut T | n/a (returns raw ptr) | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | not unsafe (returns raw ptr); doc demands per-call audit |
| `src/bun_core/atomic_cell.rs:584-588` | pub unsafe fn with_mut | #1 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | caller must guarantee no aliasing borrow |
| `src/bun_core/heap.rs:90-93` | pub unsafe fn take | n/a (BoxFromRaw) | PRESENT_STRONG | SOURCE_DIRECT | bun_core / raw_ptr_lifecycle | thin alias over `Box::from_raw`; uniqueness contract |
| `src/bun_core/heap.rs:101-104` | pub unsafe fn destroy | n/a (BoxFromRaw) | PRESENT_STRONG | SOURCE_DIRECT | bun_core / raw_ptr_lifecycle | drops via `Box::from_raw` |
| `src/bun_core/heap.rs:34-46` | pub fn alloc / into_raw / leak (deprecated) | n/a | n/a (safe wrappers) | SOURCE_DIRECT | bun_core / raw_ptr_lifecycle | counterparts that hand off to `take`/`destroy` |
| `src/bun_core/heap.rs:79-81` | pub fn release (`Box::leak`) | n/a (safe) | PRESENT_STRONG (doc-only) | SOURCE_DIRECT | bun_core / raw_ptr_lifecycle | named `release`, doc lists owners that reclaim |
| `src/bun_core/heap.rs:109-121` | pub fn alloc_nn / into_raw_nn | n/a (safe) | PRESENT_STRONG (doc) | SOURCE_DIRECT | bun_core / raw_ptr_lifecycle | NonNull variant via `NonNull::from(Box::leak)` |
| `src/bun_core/external_shared.rs:13-16` | pub unsafe trait + 2× unsafe fn (ext_ref/ext_deref) | #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other_unsafe_impl | `# Safety` describes external-refcount contract |
| `src/bun_core/external_shared.rs:34,55,130,148` | pub unsafe fn adopt/clone_from_raw (×2) | n/a (refcount transfer) | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | each has `# Safety` doc |
| `src/bun_core/external_shared.rs:37,60,93,101,110,151,176,186` | NonNull::new_unchecked + ext_ref/ext_deref blocks | #4 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / raw_ptr_lifecycle | every block has SAFETY: comment |
| `src/bun_core/external_shared.rs:199` | unsafe impl ExternalSharedDescriptor for WTFStringImplStruct | #8 #10 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other_unsafe_impl | JSC FFI delegation |
| `src/bun_core/lib.rs:94-107` | pub const unsafe fn cast_fn_ptr | #6 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | fn-pointer reinterpret; `# Safety` doc |
| `src/bun_core/lib.rs:140` | pub const unsafe fn RawSlice::from_raw | n/a | PRESENT_STRONG | SOURCE_DIRECT | bun_core / raw_ptr_lifecycle | layout-of-`*const [T]` contract |
| `src/bun_core/lib.rs:211-212` | unsafe_impl Send/Sync for RawSlice | #7 #8 | PRESENT_WEAK | SOURCE_DIRECT | bun_core / send_impl/sync_impl | bound `T: Sync` only — borrow-only view; no doc beyond bound |
| `src/bun_core/lib.rs:232-258` | os::take_environ / set_environ / environ (3× pub unsafe fn) | #7 | PRESENT_WEAK (doc-comment-only) | SOURCE_DIRECT | bun_core / other | uses `/// SAFETY:` style instead of `# Safety` heading; says "single-threaded startup only" |
| `src/bun_core/lib.rs:357-373` | unsafe extern "C" + Vec set_len helpers | #5 #10 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / libc_ffi | `additional_*` audited Vec growers |
| `src/bun_core/lib.rs:412,430,460,476,540,571` | 6× unsafe { v.set_len(..) } | #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | uninit-prefix-cap pattern (S025) |
| `src/bun_core/lib.rs:520-560` | spare_bytes_mut / reserve_spare_bytes / allocated_bytes_mut / commit_spare | #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / raw_ptr_lifecycle | named family for Vec uninit-tail; each has SAFETY |
| `src/bun_core/lib.rs:846` | NonNull::new_unchecked in macro expansion | #4 | PRESENT_STRONG | MACRO_GENERATED | bun_core / other | gated by call-site assertion |
| `src/bun_core/lib.rs:1190` | atomic load Relaxed in macro expansion | #7 | PRESENT_WEAK | MACRO_GENERATED | bun_core / atomic | scoped logger gate (`__E.load(Relaxed)`) — Relaxed sufficient for monotonic enable |
| `src/bun_core/lib.rs:2661,2674` | CACHE.load/store Relaxed | #7 | PRESENT_WEAK | SOURCE_DIRECT | bun_core / atomic | function-pointer cache |
| `src/bun_core/lib.rs:2836-2840` | pub const fn zeroed<T: Zeroable> | #4 #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / maybe_uninit | safe wrapper; obligation discharged by `unsafe trait Zeroable` |
| `src/bun_core/lib.rs:2857` | pub unsafe trait Zeroable | #4 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | trait contract spelled out |
| `src/bun_core/lib.rs:2868-2875` | pub const unsafe fn zeroed_unchecked | #4 #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / maybe_uninit | per-call escape hatch |
| `src/bun_core/lib.rs:3025-3038` | pub fn conjure_zst (safe; const_assert size_of==0) | #4 #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | ZST-only callback trampoline; compile-time gated |
| `src/bun_core/result.rs:103-114,127,133-135,152-158` | NonZeroU16::new_unchecked (interned error code) | #4 | PRESENT_WEAK (numerical proof in SAFETY adjacent) | SOURCE_DIRECT | bun_core / other | every site is `i+1` or known nonzero const |
| `src/bun_core/util.rs:197-206` | pub unsafe fn bytes_as_slice_mut | #3 #4 #6 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | hard `assert!` for alignment (matches Zig `@alignCast`) |
| `src/bun_core/util.rs:335-346,722-746` | ZStr/WStr::from_raw / from_raw_mut | #4 (NUL invariant) | PRESENT_WEAK (`/// SAFETY:` doc-style) | SOURCE_DIRECT | bun_core / raw_ptr_lifecycle | NUL-terminated invariant |
| `src/bun_core/util.rs:611,4179-4200,4356-4361` | argv/environ atomic ops Relaxed | #7 | PRESENT_WEAK (only "single-threaded startup" comment) | SOURCE_DIRECT | bun_core / atomic | static argv/environ; written once at startup |
| `src/bun_core/util.rs:1568-1648` | fd_path_raw / fd_path_raw_w | #5 #10 | PRESENT_WEAK (`/// SAFETY:`) | SOURCE_DIRECT | bun_core / fd_syscall / raw_cast | linux/darwin: `/proc/self/fd/N` + readlink; win: GetFinalPathNameByHandleW |
| `src/bun_core/util.rs:2275-2277,2334` | unsafe_impl Send/Sync for RacyCell, Sync for ThreadLock | #7 #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / send_impl/sync_impl | RacyCell SAFETY explicitly says "trust-me" + `T: Send` for Send |
| `src/bun_core/util.rs:2295-2306` | RacyCell::read/write (pub unsafe fn) | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / atomic | doc spells single-threaded contract |
| `src/bun_core/util.rs:2685-2686` | unsafe_impl Send/Sync for Once<T,F> | #7 #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / send_impl/sync_impl | once-init wrapper bounds match `std::sync::OnceLock` analog |
| `src/bun_core/util.rs:5446-5648` | MOCKED_TIME_NS / IS_ENABLED / IS_INITIALIZED Relaxed | #7 | PRESENT_WEAK | SOURCE_DIRECT | bun_core / atomic | test-mode time freeze; debug-only paths |
| `src/bun_core/Global.rs:220,314-329,816` | PANICKING / DOTENV / BINLINKS counters Relaxed; SyncCStr | #7 #8 | PRESENT_STRONG (SyncCStr) PRESENT_WEAK (counters) | SOURCE_DIRECT | bun_core / atomic / sync_impl | counters monotonic-best-effort |
| `src/bun_core/env_var.rs:339-660` (cluster) | typed env-var cache: load/store Relaxed plus string-cache len Release/Acquire | #7 | PRESENT_WEAK (collective comment at top of file) | MACRO_GENERATED (env_var! macro) | bun_core / atomic | string cache stores `ptr_value` Relaxed before `len_value.store(..., Release)`; readers `Acquire`-load `len_value` before Relaxed-loading `ptr_value`. This is a real publication edge, not an obvious too-weak-ordering bug. Phase 2 should verify no reader bypasses the len Acquire and duplicate racing writers publish identical envp-backed pointer/len. Boolean/u64 caches store one atomic scalar and do not publish separate pointee data. |
| `src/bun_core/Progress.rs:292-626` | counter ops Relaxed | #7 | PRESENT_WEAK | SOURCE_DIRECT | bun_core / atomic | progress bar — display-only, not synchronizing |
| `src/bun_core/string/mod.rs:1264-1265` | unsafe_impl Send/Sync for `bun_core::String` | #7 #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / send_impl/sync_impl | extensive doc on `to_thread_safe` precondition |
| `src/bun_core/string/StringJoiner.rs:27-28,75-76` | unsafe_impl Send/Sync (StringJoiner, Node) | #7 #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / send_impl/sync_impl | each pair has SAFETY: |
| `src/bun_core/output.rs:351` | mem::zeroed comment + use | #4 #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / maybe_uninit | gated by repr(C) POD assumption |
| `src/bun_core/string/immutable.rs:486,1499` | get_unchecked / get_unchecked(..b.len()) | #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_core / other | bounds proven in surrounding loop / by `b.len() <= a.len()` precondition |
| `src/bun_core_macros/lib.rs:303-371` | derive macro: emits `unsafe impl CellRefCounted`, `unsafe fn destroy/ref_count_raw/rc_*` | #1 #4 #8 | PRESENT_STRONG | MACRO_GENERATED | n/a (proc-macro output) | uses `addr_of!` projection (no `&Self` formed) — Stacked-Borrows-clean by construction |
| `src/safety/asan.rs:15-23` | unsafe extern "C" (7 ASan/LSan fns) | #10 | PRESENT_STRONG | SOURCE_DIRECT | bun_safety / other | gated by `cfg(bun_asan)` |
| `src/safety/asan.rs:30,35,40,45,50,55,60` | 7× unsafe block calling ASan FFI | #10 | PRESENT_STRONG | SOURCE_DIRECT | bun_safety / other | each names "ASAN runtime is linked when this cfg is active" |
| `src/safety/lib.rs:60-77` | register_alloc_vtable / known_alloc_vtable Relaxed | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_safety / atomic | extensive doc: writes single-threaded at startup, reads after thread-spawn happens-before edge |
| `src/safety/CriticalSection.rs:118,119,157,173,200,216-227` | atomic Relaxed inside ci_assert-only check | #7 | PRESENT_STRONG | SOURCE_DIRECT (feature="ci_assert") | n/a | EXPLICITLY docs "this type does NOT provide synchronization, only asserts it" |
| `src/opaque/lib.rs:54-117` | macro `opaque_ffi!` body | #1 #6 | PRESENT_STRONG | MACRO_GENERATED | bun_opaque / other | ZST + `UnsafeCell<[u8;0]>` + `PhantomPinned` — Stacked-Borrows-correct opaque handle |
| `src/opaque/lib.rs:80,98` | macro-emitted `pub unsafe fn opaque_ref_nn / opaque_mut_nn` | #4 | PRESENT_STRONG | MACRO_GENERATED | bun_opaque / other | `# Safety: p must be non-null` |
| `src/opaque/lib.rs:142-195` | pub unsafe trait FfiLayout + macro | #6 #10 | PRESENT_STRONG | SOURCE_DIRECT + MACRO_GENERATED | bun_opaque / other | size/align const-asserts |
| `src/opaque/lib.rs:269-345` | opaque_deref / opaque_deref_nn / opaque_deref_mut / opaque_deref_mut_nn | #1 #4 | PRESENT_STRONG | SOURCE_DIRECT | bun_opaque / other | each has Safety doc + SAFETY block comment |
| `src/opaque/lib.rs:364-428` | wcslen / wstr_units / slice / slice_mut (W string + raw-parts wrappers) | #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_opaque / slice_from_raw | each has `# Safety` doc |
| `src/ptr/lib.rs:178` | pub unsafe fn `get_mut` (BackRef-shape) | #1 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / other | per-call no-aliasing contract |
| `src/ptr/lib.rs:238,258,274` | pub unsafe fn detach_lifetime / _ref / _mut | #9 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / other | lifetime-laundry — caller bounds the resulting `'a` |
| `src/ptr/lib.rs:337` | pub unsafe fn boxed_slices_as_borrowed | #1 #6 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / other | layout proof: `Box<[T]>` and `&[T]` are both fat pointers |
| `src/ptr/lib.rs:559` | pub unsafe fn ThisPtr::new | #4 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / other | non-null contract |
| `src/ptr/lib.rs:627-628` | unsafe_impl Send/Sync for BackRef<T: Sync> | #1 #7 #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / sync_impl/send_impl | matches `&T: Send + Sync` rules; no exterior mutation |
| `src/ptr/parent_ref.rs:79-126` | atomic Relaxed (generation counter) | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / atomic | generation token only used to detect "did parent die"; tear-free atomic suffices |
| `src/ptr/parent_ref.rs:255-345` | pub unsafe fn from_nullable_mut / assume_mut | #1 #2 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / pin_unchecked | `assume_mut` doc names provenance pitfall (write-prov vs read-prov from `&T`) |
| `src/ptr/parent_ref.rs:406-407` | unsafe_impl Send/Sync for ParentRef<T: Sync> | #7 #8 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / sync_impl/send_impl | shared-only borrow shape |
| `src/ptr/ref_count.rs:265-335,469-550` | 9× pub unsafe fn ref_/deref/release/dupe_ref (atomic + cell variants) | #7 #1 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / other | every fn has `# Safety: self_ must point to a live T` |
| `src/ptr/ref_count.rs:474,492,527,566,588,597,1131,1225` | atomic_u32 fetch_add / fetch_sub / load **SeqCst** | #7 | PRESENT_WEAK | SOURCE_DIRECT | bun_ptr / atomic | **SeqCst is overkill but conservative — never too-weak.** Could be Release+Acquire+(Relaxed-load on count==1 fastpath) per stdlib `Arc`; not a defect. |
| `src/ptr/ref_count.rs:610` | clear_without_destructor Relaxed store | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / atomic | doc: only used immediately before `Box::from_raw` (no other thread can reach) |
| `src/ptr/ref_count.rs:653` | pub unsafe trait CellRefCounted | #4 #1 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / other | trait contract spelled |
| `src/ptr/ref_count.rs:801,853,878,927,956,1011,1027` | pub unsafe fn init_ref/adopt_ref/from_raw/take_ref/unchecked_and_unsafe_init/new/adopt | #1 #4 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / other | every fn has `# Safety` |
| `src/ptr/raw_ref_count.rs:86` | atomic fetch_add Relaxed | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / atomic | comment cites `.monotonic` — explicit rationale |
| `src/ptr/CowSlice.rs` (9 sites) | various raw-ptr cluster | #1 #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / other | Cow-on-slice |
| `src/ptr/owned.rs:302` | pub unsafe fn from_raw | n/a (BoxFromRaw) | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / raw_ptr_lifecycle | thin alias; same contract as `bun_core::heap::take` |
| `src/ptr/shared.rs` (2 sites) | refcount block | #7 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / other | |
| `src/ptr/tagged_pointer.rs` | bit-stuffed pointer | #2 #3 | PRESENT_STRONG | SOURCE_DIRECT | bun_ptr / ptr_intrinsic | comment "Same-width as cast == transmute" |
| `src/wyhash/lib.rs:43-50,568-580,675-693` | 5× unsafe { read_unaligned::<u32/u64> } | #3 #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_wyhash / ptr_intrinsic / raw_cast | each has SAFETY citing per-caller `data.len() >= N` proof |
| `src/highway/lib.rs:4-52` | unsafe extern "C" (12 fns) | #10 | PRESENT_STRONG | SOURCE_DIRECT | bun_highway / other | Google Highway SIMD C++ |
| `src/highway/lib.rs:71,84,105,126,153,167,203,239,251,279,304,325` | 12× unsafe block (FFI calls) | #10 | PRESENT_STRONG | SOURCE_DIRECT | bun_highway / ptr_cast | every block has SAFETY: "ptr/len readable/writable" |
| `src/base64/lib.rs:150-156` | unsafe extern "C" WTF__base64URLEncode | #10 | PRESENT_STRONG | SOURCE_DIRECT | bun_base64 / ptr_cast | |
| `src/base64/lib.rs:163` | unsafe block (FFI) | #10 | PRESENT_STRONG | SOURCE_DIRECT | bun_base64 / ptr_cast | |
| `src/base64/lib.rs:606,622` | get_unchecked / get_unchecked_mut | #5 | PRESENT_STRONG | SOURCE_DIRECT | bun_base64 / unchecked_index | bounds proven from `c: u8` (≤255 vs `[u8;256]`) and `dest_idx < calc_size_for_slice(source)` |
| **bun_hash crate (entire)** | — | — | n/a | n/a | (none) | **0 unsafe sites — entire crate is safe Rust over `&[u8]`.** |

---

## Summary of high-volume repetitive shapes (not enumerated above)

These shapes recur dozens to hundreds of times in `bun_core/lib.rs`, `bun_core/util.rs`, and `bun_core/fmt.rs`. Each instance is its own line in the prior-audit JSONL; structural class is unchanged.

| Shape | Approx count | Bucket | safety_status (representative) | macro_status |
|-------|------------|--------|--------------------------------|--------------|
| `unsafe { v.set_len(n) }` after capacity-checked write | ~25 | #5 | PRESENT_STRONG | SOURCE_DIRECT |
| `unsafe { core::slice::from_raw_parts*(...) }` | ~30 | #1 #5 | PRESENT_STRONG | SOURCE_DIRECT |
| `NonZeroU16::new_unchecked` (interned error codes) | ~10 | #4 | PRESENT_STRONG | SOURCE_DIRECT |
| `unsafe { libc::* }` syscall blocks (`util.rs` fd helpers) | ~25 | #10 | PRESENT_WEAK→STRONG | SOURCE_DIRECT |
| `unsafe { core::ptr::read_unaligned(p) }` | ~10 (wyhash, util) | #3 #5 | PRESENT_STRONG | SOURCE_DIRECT |
| `unsafe { core::ptr::{addr_of, addr_of_mut}!(...) }` | ~15 | #1 | PRESENT_STRONG | SOURCE_DIRECT (some MACRO) |
| `unsafe { (*ptr).field }` raw projection in macros | ~30 | #1 | PRESENT_STRONG | MACRO_GENERATED |
| `unsafe extern "C" { fn ... }` blocks | ~40 | #10 | n/a (decl) | SOURCE_DIRECT |
| atomic `.load/store/fetch_*(Ordering::*)` (203 op sites total) | 203 | #7 | varies (see notes file) | SOURCE_DIRECT (some MACRO) |
| `unsafe impl Send/Sync` (24 instances) | 24 | #7 #8 | PRESENT_STRONG | SOURCE_DIRECT |

**Total enumerated rows above: ~95.** **Total unsafe sites in section N: 831** (vs prior 625; delta +206). The +206 maps onto: env_var typed-cache expansion (+~80 macro-emitted atomic op sites), Progress (+~15 counter sites), util.rs argv/environ ports (+~25), ref_count macro forwarders (+~25), atomic_cell additions (already audited clean), and routine bun_core growth.
