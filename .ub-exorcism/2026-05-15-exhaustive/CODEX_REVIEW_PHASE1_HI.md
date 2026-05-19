# Codex Review — Phase 1 Sections H/I

Reviewed after Sections D/U/G on current `claude/ub-exorcist-audit` (`origin/main`
base `4d443e5402`).

## Section H: runtime-shell

**Correction applied:** promoted `EnvStr::cast_slice` from prose-only open
question to **EXP-029**.

Current source:

- `src/runtime/shell/EnvStr.rs:76-80` stores borrowed slice pointers as masked
  low-48-bit integers in `EnvStr(u128)`.
- `src/runtime/shell/EnvStr.rs:188-194` reconstructs a `*const u8` with
  `self.ptr() as usize as *const u8` and then forms a slice.
- `src/runtime/shell/EnvStr.rs:197-200` does the same integer-to-pointer shape
  for the refcounted backing pointer.

I added `experiments/EXP-029`, which mirrors the `Tag::Slice` path. Default
Miri warns about the integer-to-pointer cast; strict-provenance Miri fails with:

```text
unsupported operation: integer-to-pointer casts and `ptr::with_exposed_provenance`
are not supported with `-Zmiri-strict-provenance`
```

The original Section H note suggested `core::ptr::with_exposed_provenance` as a
possible fix. That is not a strict-provenance-clean fix. It can be used to make
the current dependency explicit, but `-Zmiri-strict-provenance` rejects it too.
The defensible fix is to stop storing pointers as integer payloads and carry a
typed raw pointer / `NonNull` / enum representation with provenance.

**No correction needed:** the IOWriter/IOReader and rm-task Send/Sync notes
match source. The `ShellRmTask`/`DirTask` shared SAFETY comment remains a
documentation-hardening item, not a new confirmed bug from this review.

## Section I: runtime-dns-jsc

No patch applied. The artifact's main claims survived spot-check:

- `SendPtr<T>` and `GlobalCache` are the only local `unsafe impl Send` rows.
- `CAresLinked` is a real unsafe trait with 5 macro-stamped implementations.
- The `PendingCacheKey` `ptr::read` sites really assume POD/no-Drop behavior;
  a static assertion remains a good Phase-2 hardening item.
- The macOS `mach_port -> i32` bitcast question is correctly framed as an open
  portability/contract question, not confirmed Rust UB.

