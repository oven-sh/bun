//! Creates a tagged union with variants corresponding to a list of types.
//! Variants are named `_0`, `_1`, `_2`, etc.
//!
//! In Zig this file exists because `@Type`-created unions can't contain decls,
//! so a `deinit` method had to be hand-stamped for each arity (1..=16). In Rust,
//! enums *are* tagged unions and drop their active variant automatically, so the
//! `deinitImpl` dispatch and the per-arity `deinit` methods collapse to nothing —
//! the compiler-generated `Drop` glue is exactly `deinitImpl`.

// PORT NOTE: `deinitImpl` is intentionally not ported as a function. Its body
// (`switch (activeTag) { inline else => |tag| bun.memory.deinit(&@field(...)) }`)
// is precisely what Rust's auto-generated enum Drop glue does: drop the active
// variant in place. There is no behavior to translate — every `TaggedUnion`
// produced below gets correct per-variant destruction for free.

/// Creates a tagged union (Rust `enum`) with variants corresponding to the given
/// field types. Variants are named `_0`, `_1`, `_2`, etc.
///
/// Zig: `TaggedUnion(&.{A, B, C})` → Rust: `tagged_union!(A, B, C)`
///
/// The Zig version stamped out a `pub fn deinit` on each arity that dispatched to
/// the active field's `deinit`. Rust enums drop their active variant automatically,
/// so no explicit `Drop` impl is emitted here.
// TODO(port): Zig's `TaggedUnion` returns an *anonymous* type usable inline as an
// expression. Rust macros can only mint named item-position types, so callers must
// supply a name: `tagged_union!(pub MyUnion; A, B, C);`. Adjust call sites in Phase B.
#[macro_export]
macro_rules! tagged_union {
    // 0 types — compile error, matching `@compileError("cannot create an empty tagged union")`
    ($vis:vis $name:ident;) => {
        compile_error!("cannot create an empty tagged union");
    };
    ($vis:vis $name:ident; $t0:ty) => {
        $vis enum $name { _0($t0) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty) => {
        $vis enum $name { _0($t0), _1($t1) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty, $t7:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6), _7($t7) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty, $t7:ty, $t8:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6), _7($t7), _8($t8) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty, $t7:ty, $t8:ty, $t9:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6), _7($t7), _8($t8), _9($t9) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty, $t7:ty, $t8:ty, $t9:ty, $t10:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6), _7($t7), _8($t8), _9($t9), _10($t10) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty, $t7:ty, $t8:ty, $t9:ty, $t10:ty, $t11:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6), _7($t7), _8($t8), _9($t9), _10($t10), _11($t11) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty, $t7:ty, $t8:ty, $t9:ty, $t10:ty, $t11:ty, $t12:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6), _7($t7), _8($t8), _9($t9), _10($t10), _11($t11), _12($t12) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty, $t7:ty, $t8:ty, $t9:ty, $t10:ty, $t11:ty, $t12:ty, $t13:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6), _7($t7), _8($t8), _9($t9), _10($t10), _11($t11), _12($t12), _13($t13) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty, $t7:ty, $t8:ty, $t9:ty, $t10:ty, $t11:ty, $t12:ty, $t13:ty, $t14:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6), _7($t7), _8($t8), _9($t9), _10($t10), _11($t11), _12($t12), _13($t13), _14($t14) }
    };
    ($vis:vis $name:ident; $t0:ty, $t1:ty, $t2:ty, $t3:ty, $t4:ty, $t5:ty, $t6:ty, $t7:ty, $t8:ty, $t9:ty, $t10:ty, $t11:ty, $t12:ty, $t13:ty, $t14:ty, $t15:ty) => {
        $vis enum $name { _0($t0), _1($t1), _2($t2), _3($t3), _4($t4), _5($t5), _6($t6), _7($t7), _8($t8), _9($t9), _10($t10), _11($t11), _12($t12), _13($t13), _14($t14), _15($t15) }
    };
    // >16 types — compile error, matching `else => @compileError("too many union fields")`
    ($vis:vis $name:ident; $($rest:ty),+) => {
        compile_error!("too many union fields");
    };
}

pub use tagged_union as TaggedUnion;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/meta/tagged_union.zig (236 lines)
//   confidence: medium
//   todos:      1
//   notes:      Zig returns anonymous type from comptime fn; Rust macro requires caller-supplied name. deinit → auto Drop glue (deleted). Phase B: audit call sites; this util may be entirely unnecessary in Rust.
// ──────────────────────────────────────────────────────────────────────────
