use bun_alloc::AllocError;
use bun_core::Error;

// fn isOomOnlyError(comptime ErrorUnionOrSet: type) bool
//
// Zig's `isOomOnlyError` is pure comptime `@typeInfo` reflection over an
// error set: it iterates the set's members and checks every name == "OutOfMemory".
// Rust has no error-set reflection. The equivalent is encoded structurally in
// the `HandleOom` trait impls below — the `AllocError` impls ARE the
// "OOM-only" arm (Output = T / Output = !), and the `bun_core::Error` impls
// ARE the "other errors possible" arm (Output = Result<T, E> / Output = E).
//
// TODO(port): @typeInfo reflection — no direct Rust equivalent; encoded as trait impls.

/// If `error_union_or_set` is `error.OutOfMemory`, calls `bun.outOfMemory`. Otherwise:
///
/// * If that was the only possible error, returns the non-error payload for error unions, or
///   `noreturn` for error sets.
/// * If other errors are possible, returns the same error union or set, but without
///   `error.OutOfMemory` in the error set.
///
/// Prefer this method over `catch bun.outOfMemory()`, since that could mistakenly catch
/// non-OOM-related errors.
///
/// There are two ways to use this function:
///
/// ```ignore
/// // option 1:
/// let thing = bun::handle_oom(allocate_thing());
/// // option 2:
/// let thing = match allocate_thing() { Ok(v) => v, Err(err) => bun::handle_oom(err) };
/// ```
///
/// PORT NOTE: In Rust, `Vec`/`Box` allocation already aborts on OOM via the
/// global allocator's `handle_alloc_error`. Per PORTING.md §Allocators,
/// callsites of `bun.handleOom(expr)` translate to bare `expr`. This function
/// remains for the residual cases where a `Result<T, AllocError>` is threaded
/// explicitly.
pub fn handle_oom<A: HandleOom>(error_union_or_set: A) -> A::Output {
    error_union_or_set.handle_oom()
}

/// Encodes Zig's comptime return-type block (`return_type: { ... }`) of
/// `handleOom`. The Zig branched on `@typeInfo(ArgType)` (error_union vs
/// error_set) and on `isOomOnlyError(ArgType)`; each impl below is one arm of
/// that comptime switch.
pub trait HandleOom {
    type Output;
    fn handle_oom(self) -> Self::Output;
}

// ── .error_union, isOomOnlyError == true → union_info.payload ────────────
impl<T> HandleOom for Result<T, AllocError> {
    type Output = T;
    fn handle_oom(self) -> T {
        match self {
            Ok(success) => success,
            Err(AllocError) => crate::out_of_memory(),
        }
    }
}

// ── .error_set, isOomOnlyError == true → noreturn ────────────────────────
// TODO(port): `!` as an associated type requires nightly `feature(never_type)`.
// Phase B: either enable the feature crate-wide or substitute
// `core::convert::Infallible` and have callers `match x {}`.
impl HandleOom for AllocError {
    type Output = !;
    fn handle_oom(self) -> ! {
        crate::out_of_memory()
    }
}

// ── .error_union, mixed error set → same union with OOM subtracted ───────
// Zig computed the narrowed type via
//   `@TypeOf(switch (err) { error.OutOfMemory => unreachable, else => |e| e })`.
// Rust error enums are nominal, not sets — there is no set subtraction. For
// the catch-all `bun_core::Error` we compare against the interned tag and
// return the same type. Per-crate `thiserror` enums that carry an
// `OutOfMemory` variant should add their own `HandleOom` impl in Phase B.
impl<T> HandleOom for Result<T, Error> {
    type Output = Result<T, Error>;
    fn handle_oom(self) -> Result<T, Error> {
        match self {
            Ok(success) => Ok(success),
            Err(err) if err == bun_core::err!("OutOfMemory") => crate::out_of_memory(),
            Err(other_error) => Err(other_error),
        }
    }
}

// ── .error_set, mixed → same set with OOM subtracted ─────────────────────
impl HandleOom for Error {
    type Output = Error;
    fn handle_oom(self) -> Error {
        if self == bun_core::err!("OutOfMemory") {
            crate::out_of_memory()
        } else {
            self
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/crash_handler/handle_oom.zig (66 lines)
//   confidence: medium
//   todos:      2
//   notes:      comptime @typeInfo error-set reflection reshaped into a HandleOom trait; `!` assoc type needs nightly or Infallible swap; most callsites should drop handle_oom entirely per §Allocators
// ──────────────────────────────────────────────────────────────────────────
