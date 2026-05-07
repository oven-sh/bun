//! `bun_logger::js_ast` — value-shaped JS expression AST.
//!
//! MOVE_DOWN from `bun_js_parser::ast` (T4→T2, CYCLEBREAK §interchange).
//!
//! `bun_interchange::{json,json5,toml,yaml}`, `bun_ini` and `bun_bunfig` parse
//! config files into a JS expression tree but cannot depend on `bun_js_parser`
//! (T4) without a back-edge. The *value-shaped* AST nodes — `Expr`, the
//! literal `E::*` payloads, `G::Property`, `Rope` — live here so those crates
//! can build/match `Expr` trees while `bun_js_parser` re-exports the leaf
//! types and keeps its own *full* `expr::Data` (which adds `EUnary`/`ECall`/
//! `EDot`/etc.). Zig source: `src/js_parser/ast/{E,G,Expr}.zig`.
//!
//! **Unification note (b2-ast-unify):** `bun_js_parser::ast::expr::Data` is a
//! *separate* enum — it stores `StoreRef<E::Unary>` payloads that name
//! parser-only structs. Rust enums are closed, so the full variant set cannot
//! live at T2 without dragging `Op`/`Stmt`/`Binding`/`Scope` down too. The
//! leaf scalar `E::*` structs and `StoreRef` ARE shared (re-exported by
//! `bun_js_parser::ast::e`). The deep-convert bridge lives at T4:
//! `impl From<bun_logger::js_ast::Expr> for bun_js_parser::ast::Expr` (see
//! `src/js_parser/ast/Expr.rs`). Downstream T4+ code that receives a T2 tree
//! (e.g. `bun_ini` consuming `bun_interchange::json`) lifts via `Expr::from`.

#![allow(non_snake_case, dead_code)]

use core::ops::{Deref, DerefMut};
use core::ptr::NonNull;

use bun_alloc::{AllocError, Arena as Bump};
use bun_collections::BabyList;
use bun_string::strings;

use super::Loc;

// In Zig: `const string = []const u8;`. AST string fields are arena-owned
// (bulk-freed via Store/arena reset; never individually freed). Phase A keeps
// node types lifetime-free; Phase B threads `'bump`.
// TODO(port): arena-owned slice lifetime — revisit in Phase B.
type Str = &'static [u8];

// ───────────────────────────────────────────────────────────────────────────
// StoreRef — arena-owned pointer into a node Store / bump arena.
//
// Moved verbatim from `bun_js_parser::ast` (mod.rs); `bun_js_parser` now
// re-exports this. Thin `NonNull<T>` newtype — `Copy`, `Deref`/`DerefMut`.
// The pointee lives until the owning Store/arena is `reset()`; callers must
// not hold a `StoreRef` across that boundary. Matches Zig's `*T` payloads in
// `Expr.Data`.
// ───────────────────────────────────────────────────────────────────────────

#[repr(transparent)]
pub struct StoreRef<T>(NonNull<T>);

// SAFETY: `StoreRef` is a thin pointer into a single-threaded bump arena (Zig
// `*T`). We assert Send/Sync so payload types embedding `Option<StoreRef<T>>`
// (e.g. `E::EString::next`) can sit in `static` tables — matches Zig where raw
// pointers carry no thread-affinity. Callers are responsible for not actually
// sharing a Store across threads (same contract as the Zig original).
unsafe impl<T> Send for StoreRef<T> {}
unsafe impl<T> Sync for StoreRef<T> {}

impl<T> StoreRef<T> {
    #[inline]
    pub const fn from_non_null(p: NonNull<T>) -> Self {
        StoreRef(p)
    }
    /// SAFETY: `p` must be non-null, aligned, and outlive the next Store reset.
    #[inline]
    pub const unsafe fn from_raw(p: *mut T) -> Self {
        // SAFETY: caller contract.
        StoreRef(unsafe { NonNull::new_unchecked(p) })
    }
    /// Wrap a `bumpalo::Bump::alloc` result.
    #[inline]
    pub fn from_bump(r: &mut T) -> Self {
        StoreRef(NonNull::from(r))
    }
    #[inline]
    pub const fn as_ptr(self) -> *mut T {
        self.0.as_ptr()
    }
    /// Wrap a `&'static T` (compile-time/global singleton — e.g. Prefill
    /// constants). Mutation through the resulting `StoreRef` is UB.
    #[inline]
    pub const fn from_static(r: &'static T) -> Self {
        // SAFETY: `r` is a non-null, aligned, dereferenceable `'static`
        // reference, so `new_unchecked` is sound. Provenance is shared/read-
        // only: this mirrors Zig `@constCast` on the `Expr.Data.e_string`
        // prefill tables (see `src/bundler/defines.zig:102`), where a `*const
        // E.String` is widened to `*E.String` solely to fit the payload slot
        // type. The pointee is *never* written through — `DerefMut` /
        // `as_ptr().write()` on a `StoreRef` produced here is UB and callers
        // must not do so (audited: only `Deref`/`get()` reads occur on
        // prefill-backed refs).
        StoreRef(unsafe { NonNull::new_unchecked(core::ptr::from_ref(r).cast_mut()) })
    }
    /// Borrow the pointee (explicit form of `Deref`).
    #[inline]
    pub fn get(&self) -> &T {
        // SAFETY: StoreRef invariant — points into a live Store/arena block.
        unsafe { self.0.as_ref() }
    }
}
impl<T> Clone for StoreRef<T> {
    #[inline]
    fn clone(&self) -> Self {
        *self
    }
}
impl<T> Copy for StoreRef<T> {}
impl<T> Deref for StoreRef<T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        // SAFETY: StoreRef invariant — points into a live Store/arena block.
        unsafe { self.0.as_ref() }
    }
}
impl<T> DerefMut for StoreRef<T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        // SAFETY: StoreRef invariant. AST nodes are mutated in-place during
        // visiting; Zig held `*T` and freely mutated. No two `StoreRef` to the
        // same node are deref'd `&mut` simultaneously in single-threaded
        // parser/visitor passes — same as the Zig contract.
        unsafe { self.0.as_mut() }
    }
}
impl<T> From<NonNull<T>> for StoreRef<T> {
    #[inline]
    fn from(p: NonNull<T>) -> Self {
        StoreRef(p)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// E — expression payload structs.
//
// Source: `src/js_parser/ast/E.zig`. Only the value-shaped subset (the nodes
// JSON/TOML/YAML/INI produce and `bunfig`/`install` consume) is defined here.
// `bun_js_parser::ast::e` re-exports the leaf scalars and `EString` and adds
// the parser-only payloads (`Unary`/`Binary`/`Call`/`Dot`/...).
// ───────────────────────────────────────────────────────────────────────────

#[allow(non_snake_case)]
pub mod E {
    use super::*;

    #[derive(Clone, Copy)]
    pub struct Number {
        pub value: f64,
    }

    #[derive(Clone, Copy)]
    pub struct Boolean {
        pub value: bool,
    }

    #[derive(Clone, Copy, Default)]
    pub struct Null;
    #[derive(Clone, Copy, Default)]
    pub struct Undefined;
    #[derive(Clone, Copy, Default)]
    pub struct Missing;
    #[derive(Clone, Copy, Default)]
    pub struct This;
    #[derive(Clone, Copy, Default)]
    pub struct Super;
    #[derive(Clone, Copy, Default)]
    pub struct ImportMeta;

    #[derive(Clone, Copy, Default)]
    pub struct ImportMetaMain {
        /// If true, print `!import.meta.main` (or `require.main != module`).
        pub inverted: bool,
    }

    #[derive(Clone, Copy)]
    pub struct NewTarget {
        pub range: super::super::Range,
    }

    // ── EString ───────────────────────────────────────────────────────────

    /// JavaScript string literal. Stores either UTF-8 bytes or (when
    /// `is_utf16`) a `*const u16` reinterpreted into `data` with element-count
    /// length. `next`/`end`/`rope_len` form a simple rope for string folding.
    pub struct EString {
        // TODO(port): arena-owned slice lifetime — see `Str` alias note.
        pub data: Str,
        pub prefer_template: bool,
        pub next: Option<StoreRef<EString>>,
        pub end: Option<StoreRef<EString>>,
        pub rope_len: u32,
        pub is_utf16: bool,
    }
    /// Export under the Zig name `String` as well; `EString` avoids colliding
    /// with `bun_string::String`.
    pub use EString as String;

    impl Default for EString {
        fn default() -> Self {
            Self {
                data: b"",
                prefer_template: false,
                next: None,
                end: None,
                rope_len: 0,
                is_utf16: false,
            }
        }
    }

    impl EString {
        pub const EMPTY: EString = EString::from_static(b"");

        #[inline]
        pub const fn is_utf8(&self) -> bool {
            !self.is_utf16
        }
        #[inline]
        pub fn slice8(&self) -> &[u8] {
            debug_assert!(!self.is_utf16);
            self.data
        }
        #[inline]
        pub fn slice16(&self) -> &[u16] {
            debug_assert!(self.is_utf16);
            // SAFETY: when is_utf16, `data.ptr` was originally a `*const u16` and
            // `data.len` is the u16 element count (see `init_utf16`).
            unsafe {
                core::slice::from_raw_parts(self.data.as_ptr().cast::<u16>(), self.data.len())
            }
        }
        /// Const constructor for `'static` literals.
        pub const fn from_static(data: &'static [u8]) -> Self {
            Self {
                data,
                prefer_template: false,
                next: None,
                end: None,
                rope_len: 0,
                is_utf16: false,
            }
        }
        /// `data` is arena-owned (source text or bump arena) and bulk-freed;
        /// per the Phase-A `Str` convention the lifetime is erased.
        pub fn init(data: &[u8]) -> Self {
            // SAFETY: arena-owned slice; lifetime erased pending Phase-B `'bump`.
            let data: &'static [u8] = unsafe { core::mem::transmute(data) };
            Self { data, ..Default::default() }
        }
        /// Construct from a UTF-16 slice (arena-owned). `data.len()` stores the
        /// **u16 element count** (not byte count); ptr reinterpreted to `*u8`.
        pub fn init_utf16(data: &[u16]) -> Self {
            // SAFETY: store element count + reinterpreted ptr; consumers check
            // `is_utf16` and re-slice via `slice16`.
            let bytes =
                unsafe { core::slice::from_raw_parts(data.as_ptr().cast::<u8>(), data.len()) };
            let bytes_static: &'static [u8] = unsafe { core::mem::transmute(bytes) };
            Self { data: bytes_static, is_utf16: true, ..Default::default() }
        }
        #[inline]
        pub fn len(&self) -> usize {
            if self.rope_len > 0 { self.rope_len as usize } else { self.data.len() }
        }
        #[inline]
        pub fn is_blank(&self) -> bool {
            self.len() == 0
        }
        /// Shallow field-copy (Zig copies the struct bytes; `EString` is not
        /// `Clone` because the rope `next` ptr would alias).
        #[inline]
        pub fn shallow_clone(&self) -> Self {
            Self {
                data: self.data,
                prefer_template: self.prefer_template,
                next: self.next,
                end: self.end,
                rope_len: self.rope_len,
                is_utf16: self.is_utf16,
            }
        }
        pub fn eql_bytes(&self, other: &[u8]) -> bool {
            if self.is_utf8() {
                strings::eql_long(self.data, other, true)
            } else {
                strings::utf16_eql_string(self.slice16(), other)
            }
        }
        pub fn eql_comptime(&self, value: &'static [u8]) -> bool {
            if !self.is_utf8() {
                return strings::eql_comptime_utf16(self.slice16(), value);
            }
            if self.next.is_none() {
                return self.data == value;
            }
            // rope path
            if self.rope_len as usize != value.len() {
                return false;
            }
            let mut i = 0usize;
            let mut next: Option<&EString> = Some(self);
            while let Some(cur) = next {
                if !strings::eql_long(cur.data, &value[i..i + cur.data.len()], false) {
                    return false;
                }
                i += cur.data.len();
                next = cur.next.as_ref().map(|r| r.get());
            }
            true
        }
        /// Zig `toUTF8(allocator)` — in-place transcode `data` to UTF-8 if it
        /// is currently UTF-16. No-op when already UTF-8.
        pub fn to_utf8(&mut self, bump: &Bump) -> Result<(), AllocError> {
            if !self.is_utf16 {
                return Ok(());
            }
            let v = strings::to_utf8_alloc(self.slice16());
            let buf = bump.alloc_slice_copy(&v);
            // SAFETY: arena-owned slice; lifetime erased per Phase-A `Str`
            // alias (`&'static [u8]` standing in for arena lifetime).
            self.data = unsafe { core::mem::transmute::<&[u8], &'static [u8]>(buf) };
            self.is_utf16 = false;
            Ok(())
        }
        /// Zig `string(allocator)` — return UTF-8 bytes, transcoding if UTF-16.
        pub fn string<'b>(&self, bump: &'b Bump) -> Result<&'b [u8], AllocError> {
            if self.is_utf8() {
                // SAFETY: `self.data` is arena-owned with the same lifetime as
                // `bump` (Zig invariant); reborrowed under `'b`.
                Ok(unsafe { core::mem::transmute::<&[u8], &'b [u8]>(self.data) })
            } else {
                let v = strings::to_utf8_alloc(self.slice16());
                Ok(bump.alloc_slice_copy(&v))
            }
        }
        /// Zig `stringZ(allocator)` — like `string()` but NUL-terminated.
        pub fn string_z<'b>(&self, bump: &'b Bump) -> Result<&'b bun_string::ZStr, AllocError> {
            let s = self.string(bump)?;
            // Append a NUL into a fresh bump slice; ZStr borrows the [..len] bytes
            // and guarantees `ptr.add(len) == 0`.
            let buf = bump.alloc_slice_fill_copy(s.len() + 1, 0u8);
            buf[..s.len()].copy_from_slice(s);
            // SAFETY: `buf` is a bump-owned `len+1` byte slice with `buf[len] == 0`.
            Ok(unsafe { bun_string::ZStr::from_raw(buf.as_ptr(), s.len()) })
        }
        pub fn string_cloned<'b>(&self, bump: &'b Bump) -> Result<&'b [u8], AllocError> {
            if self.is_utf8() {
                Ok(bump.alloc_slice_copy(self.data))
            } else {
                let v = strings::to_utf8_alloc(self.slice16());
                Ok(bump.alloc_slice_copy(&v))
            }
        }
        /// Zig `slice(allocator)` — flatten rope and return UTF-8.
        pub fn slice<'b>(&mut self, bump: &'b Bump) -> &'b [u8] {
            self.resolve_rope_if_needed(bump);
            self.string(bump).expect("OOM")
        }
        pub fn resolve_rope_if_needed(&mut self, bump: &Bump) {
            if self.next.is_none() || !self.is_utf8() {
                return;
            }
            let mut bytes =
                bun_alloc::ArenaVec::<u8>::with_capacity_in(self.rope_len as usize, bump);
            bytes.extend_from_slice(self.data);
            let mut str_ = self.next;
            while let Some(part) = str_ {
                bytes.extend_from_slice(part.get().data);
                str_ = part.get().next;
            }
            // SAFETY: arena-owned slice; lifetime erased per Phase-A `Str`.
            self.data = unsafe {
                core::mem::transmute::<&[u8], &'static [u8]>(bytes.into_bump_slice())
            };
            self.next = None;
        }
        pub fn hash(&self) -> u64 {
            if self.is_blank() {
                return 0;
            }
            if self.is_utf8() {
                bun_wyhash::hash(self.data)
            } else {
                let s16 = self.slice16();
                // SAFETY: reinterpreting &[u16] as &[u8] of double length for hashing.
                let bytes = unsafe {
                    core::slice::from_raw_parts(s16.as_ptr() as *const u8, s16.len() * 2)
                };
                bun_wyhash::hash(bytes)
            }
        }
    }

    // ── Array / Object ────────────────────────────────────────────────────

    pub struct Array {
        pub items: ExprNodeList,
        pub comma_after_spread: Option<Loc>,
        pub is_single_line: bool,
        pub is_parenthesized: bool,
        pub was_originally_macro: bool,
        pub close_bracket_loc: Loc,
    }
    impl Default for Array {
        fn default() -> Self {
            Self {
                items: ExprNodeList::default(),
                comma_after_spread: None,
                is_single_line: false,
                is_parenthesized: false,
                was_originally_macro: false,
                close_bracket_loc: Loc::EMPTY,
            }
        }
    }
    impl Array {
        pub const EMPTY: Array = Array {
            items: BabyList::EMPTY,
            comma_after_spread: None,
            is_single_line: false,
            is_parenthesized: false,
            was_originally_macro: false,
            close_bracket_loc: Loc::EMPTY,
        };
        #[inline]
        pub fn slice(&self) -> &[Expr] {
            self.items.slice()
        }
        pub fn push(&mut self, _bump: &Bump, item: Expr) -> Result<(), AllocError> {
            self.items.append(item)
        }
    }

    pub struct Object {
        pub properties: super::G::PropertyList,
        pub comma_after_spread: Option<Loc>,
        pub is_single_line: bool,
        pub is_parenthesized: bool,
        pub was_originally_macro: bool,
        pub close_brace_loc: Loc,
    }
    impl Default for Object {
        fn default() -> Self {
            Self {
                properties: super::G::PropertyList::default(),
                comma_after_spread: None,
                is_single_line: false,
                is_parenthesized: false,
                was_originally_macro: false,
                close_brace_loc: Loc::EMPTY,
            }
        }
    }
    impl Object {
        pub const EMPTY: Object = Object {
            properties: BabyList::EMPTY,
            comma_after_spread: None,
            is_single_line: false,
            is_parenthesized: false,
            was_originally_macro: false,
            close_brace_loc: Loc::EMPTY,
        };

        pub fn get(&self, key: &[u8]) -> Option<Expr> {
            self.as_property(key).map(|q| q.expr)
        }
        pub fn as_property(&self, name: &[u8]) -> Option<super::expr::Query> {
            for (i, prop) in self.properties.slice().iter().enumerate() {
                let Some(value) = prop.value else { continue };
                let Some(key) = &prop.key else { continue };
                let super::expr::Data::EString(key_str) = &key.data else { continue };
                if key_str.eql_bytes(name) {
                    return Some(super::expr::Query { expr: value, loc: key.loc, i: i as u32 });
                }
            }
            None
        }
        pub fn has_property(&self, name: &[u8]) -> bool {
            // Zig `E.Object.hasProperty` checks only `prop.key` — it does NOT
            // skip entries whose `value` is None (unlike `asProperty`).
            for prop in self.properties.slice() {
                let Some(key) = &prop.key else { continue };
                let super::expr::Data::EString(key_str) = &key.data else { continue };
                if key_str.eql_bytes(name) {
                    return true;
                }
            }
            false
        }
        pub fn put(&mut self, _bump: &Bump, key: &[u8], expr: Expr) -> Result<(), AllocError> {
            if let Some(q) = self.as_property(key) {
                self.properties.slice_mut()[q.i as usize].value = Some(expr);
            } else {
                self.properties.append(super::G::Property {
                    key: Some(Expr::init(EString::init(key), expr.loc)),
                    value: Some(expr),
                    ..Default::default()
                })?;
            }
            Ok(())
        }
        /// Zig: `E.Object.putString` — `put(key, Expr.init(E.String, value, Loc.Empty))`.
        pub fn put_string(
            &mut self,
            bump: &Bump,
            key: &[u8],
            value: &[u8],
        ) -> Result<(), AllocError> {
            self.put(bump, key, Expr::init(EString::init(value), Loc::EMPTY))
        }

        /// Walks `rope` segments, creating nested objects as needed, and
        /// returns the leaf `E.Object` expression (Zig: `getOrPutObject`).
        pub fn get_or_put_object(
            &mut self,
            rope: &Rope,
            bump: &Bump,
        ) -> Result<Expr, SetError> {
            let head_key = match rope.head.data.e_string() {
                Some(s) => s.data,
                None => return Err(SetError::Clobber),
            };
            if let Some(existing) = self.get(head_key) {
                match existing.data {
                    super::expr::Data::EArray(mut array) => {
                        if rope.next.is_null() {
                            return Err(SetError::Clobber);
                        }
                        if let Some(last) = array.items.last() {
                            if let super::expr::Data::EObject(mut obj) = last.data {
                                // SAFETY: rope.next non-null (checked) and arena-owned.
                                return obj.get_or_put_object(unsafe { &*rope.next }, bump);
                            }
                        }
                        return Err(SetError::Clobber);
                    }
                    super::expr::Data::EObject(mut object) => {
                        if !rope.next.is_null() {
                            // SAFETY: rope.next non-null and arena-owned.
                            return object.get_or_put_object(unsafe { &*rope.next }, bump);
                        }
                        return Ok(existing);
                    }
                    _ => return Err(SetError::Clobber),
                }
            }
            if !rope.next.is_null() {
                let obj = Expr::init(Object::default(), rope.head.loc);
                let out = match obj.data {
                    super::expr::Data::EObject(mut o) => {
                        // SAFETY: rope.next non-null and arena-owned.
                        o.get_or_put_object(unsafe { &*rope.next }, bump)?
                    }
                    _ => unreachable!(),
                };
                self.properties.append(super::G::Property {
                    key: Some(rope.head),
                    value: Some(obj),
                    ..Default::default()
                })?;
                return Ok(out);
            }
            let out = Expr::init(Object::default(), rope.head.loc);
            self.properties.append(super::G::Property {
                key: Some(rope.head),
                value: Some(out),
                ..Default::default()
            })?;
            Ok(out)
        }
    }

    /// `E.Object.Rope` — linked-list builder for nested-key paths during
    /// TOML/INI parsing. `next` is a raw `*mut Rope` into the bump arena
    /// (Zig: `next: ?*Rope`); segments are bulk-freed at arena reset.
    pub struct Rope {
        pub head: Expr,
        pub next: *mut Rope,
    }
    impl Default for Rope {
        fn default() -> Self {
            Self { head: Expr::EMPTY, next: core::ptr::null_mut() }
        }
    }
    impl Rope {
        pub fn append(&mut self, expr: Expr, bump: &Bump) -> Result<*mut Rope, AllocError> {
            if let Some(next) = NonNull::new(self.next) {
                // SAFETY: arena-allocated Rope nodes are uniquely owned by the
                // chain at this point in TOML/INI parsing; Zig mutates freely.
                return unsafe { &mut *next.as_ptr() }.append(expr, bump);
            }
            let rope: *mut Rope = bump.alloc(Rope { head: expr, next: core::ptr::null_mut() });
            self.next = rope;
            Ok(rope)
        }
    }

    #[derive(Debug, strum::IntoStaticStr)]
    pub enum SetError {
        OutOfMemory,
        Clobber,
    }
    impl From<AllocError> for SetError {
        fn from(_: AllocError) -> Self {
            SetError::OutOfMemory
        }
    }
    impl From<SetError> for bun_core::Error {
        fn from(e: SetError) -> Self {
            match e {
                SetError::OutOfMemory => bun_core::err!(OutOfMemory),
                SetError::Clobber => bun_core::err!(Clobber),
            }
        }
    }

    /// Module-style alias so callers can address `e::object::Rope` (the Zig
    /// path was `E.Object.Rope` — a nested struct).
    pub mod object {
        pub use super::{Object, Rope, SetError};
    }
}

/// Lowercase `e::*` path some Phase-A drafts use (`js_ast::e::object::Rope`).
pub use E as e;

// ───────────────────────────────────────────────────────────────────────────
// G — grouped/shared sub-structs (Property only at T2).
//
// Source: `src/js_parser/ast/G.zig:Property`. The T2 shape omits the
// parser-only fields (`class_static_block: *ClassStaticBlock`,
// `ts_decorators: ExprNodeList`, `ts_metadata: TypeScript.Metadata`) — those
// reference `Stmt`/`Binding`/`TypeScript` and stay in `bun_js_parser::ast::g`.
// Interchange/ini only ever construct `{ key, value, kind }` and read back
// `key`/`value`, so the field subset is sufficient. `bun_js_parser`'s full
// `G::Property` is a distinct (wider) struct; see the unification note above.
// ───────────────────────────────────────────────────────────────────────────

#[allow(non_snake_case)]
pub mod G {
    use super::*;

    #[derive(Clone, Copy)]
    pub struct Property {
        /// `[a = 1] = []` / `class Foo { a = 1 }` initializer.
        pub initializer: Option<Expr>,
        pub kind: PropertyKind,
        pub flags: PropertyFlags,
        /// Key is optional for spread.
        pub key: Option<Expr>,
        /// Omitted for class fields.
        pub value: Option<Expr>,
    }

    impl Default for Property {
        fn default() -> Self {
            Self {
                initializer: None,
                kind: PropertyKind::Normal,
                flags: PropertyFlags::empty(),
                key: None,
                value: None,
            }
        }
    }

    /// Zig: `enum(u3)` — Rust has no `u3`, use `u8`.
    #[repr(u8)]
    #[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
    #[strum(serialize_all = "snake_case")]
    pub enum PropertyKind {
        Normal,
        Get,
        Set,
        Spread,
        Declare,
        Abstract,
        ClassStaticBlock,
        AutoAccessor,
    }

    bitflags::bitflags! {
        /// Zig: `Flags.Property.Set` (`packed struct` of bools). T2 keeps the
        /// flag set local; `bun_js_parser::flags::PropertySet` is the
        /// `enumset::EnumSet` form used by the full parser `G::Property`.
        #[derive(Clone, Copy, Default, PartialEq, Eq)]
        pub struct PropertyFlags: u8 {
            const IS_COMPUTED   = 1 << 0;
            const IS_METHOD     = 1 << 1;
            const IS_STATIC     = 1 << 2;
            const WAS_SHORTHAND = 1 << 3;
            const IS_SPREAD     = 1 << 4;
        }
    }

    /// Zig: `pub const List = BabyList(Property);`.
    pub type PropertyList = BabyList<Property>;

    /// Lowercase path for `G::property::Kind` (json.rs:351).
    pub mod property {
        pub use super::{Property, PropertyKind as Kind, PropertyList as List};
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Expr / Data
// ───────────────────────────────────────────────────────────────────────────

/// `js_ast.ExprNodeList` (Zig: `BabyList(Expr)`).
pub type ExprNodeList = BabyList<Expr>;

#[derive(Clone, Copy)]
pub struct Expr {
    pub loc: Loc,
    pub data: expr::Data,
}

impl Default for Expr {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl Expr {
    pub const EMPTY: Expr = Expr { loc: Loc::EMPTY, data: expr::Data::EMissing(E::Missing) };

    /// Zig: `Expr.init(Type, payload, loc)`. The `comptime Type` param is
    /// inferred from `T` in Rust, so the call shape is `Expr::init(payload,
    /// loc)`. yaml.rs's 3-arg form (`Expr::init(E::Null, E::Null {}, loc)`)
    /// passes the type marker by *value* — covered by `init3` below.
    #[inline]
    pub fn init<T: IntoExprData>(st: T, loc: Loc) -> Expr {
        Expr { loc, data: st.into_data_store() }
    }

    /// 3-arg overload for callers that translated Zig's
    /// `Expr.init(E.Null, E.Null{}, loc)` literally (the first arg was a
    /// `comptime type` marker). The marker is discarded; `T` carries the type.
    #[inline]
    pub fn init3<M, T: IntoExprData>(_type_marker: M, st: T, loc: Loc) -> Expr {
        Expr { loc, data: st.into_data_store() }
    }

    /// Zig: `Expr.allocate(allocator, Type, payload, loc)` — store the boxed
    /// payload in a caller-supplied bump arena instead of the thread-local
    /// Store. Be careful to free the arena (or use one that does it for you).
    #[inline]
    pub fn allocate<T: IntoExprData>(bump: &Bump, st: T, loc: Loc) -> Expr {
        Expr { loc, data: st.into_data_alloc(bump) }
    }

    #[inline]
    pub fn is_missing(&self) -> bool {
        matches!(self.data, expr::Data::EMissing(_))
    }
    #[inline]
    pub fn is_object(&self) -> bool {
        matches!(self.data, expr::Data::EObject(_))
    }

    /// Zig: `Expr.get(key)` — if `self` is an object literal, look up the
    /// property whose key string equals `key` and return its value. Returns
    /// `None` if not an object or the key is absent.
    pub fn get(&self, key: &[u8]) -> Option<Expr> {
        match &self.data {
            expr::Data::EObject(obj) => obj.get().get(key),
            _ => None,
        }
    }
    /// Zig: `Expr.asProperty(name)`.
    pub fn as_property(&self, name: &[u8]) -> Option<expr::Query> {
        match &self.data {
            expr::Data::EObject(obj) => obj.get().as_property(name),
            _ => None,
        }
    }
    #[inline]
    pub fn is_array(&self) -> bool {
        matches!(self.data, expr::Data::EArray(_))
    }

    /// Zig: `Expr.asArray()` (src/js_parser/ast/Expr.zig). Returns an iterator
    /// over an `e_array` payload's items, or `None` for non-array data *and*
    /// for an empty array (matching the Zig `if (array.items.len == 0) return
    /// null` short-circuit).
    pub fn as_array(&self) -> Option<ArrayIterator<'_>> {
        match &self.data {
            expr::Data::EArray(array) => {
                if array.items.len == 0 {
                    return None;
                }
                // SAFETY: `StoreRef` points into a live Store/bump arena; widen
                // to a raw deref so the iterator borrow is decoupled from the
                // local `StoreRef` temporary (same pattern as the T4 parser
                // `Expr::as_array`).
                Some(ArrayIterator { array: unsafe { &*array.as_ptr() }, index: 0 })
            }
            _ => None,
        }
    }

    #[inline]
    pub fn is_string(&self) -> bool {
        matches!(self.data, expr::Data::EString(_))
    }

    /// Zig: `Expr.asString(allocator)` — `Some(utf8)` when `data` is
    /// `e_string`, transcoding UTF-16 into `bump` if necessary.
    #[inline]
    pub fn as_string<'b>(&self, bump: &'b Bump) -> Option<&'b [u8]> {
        match &self.data {
            expr::Data::EString(s) => Some(s.get().string(bump).expect("OOM")),
            _ => None,
        }
    }

    /// Zig: `Expr.asStringZ(allocator)` — `Some(utf8, NUL-terminated)` when
    /// `data` is `e_string`, transcoding UTF-16 into `bump` if necessary.
    /// Moved down from `bun_js_parser::Expr` so install-tier callers that
    /// hold the T2 JSON `Expr` (e.g. `WorkspaceMap::process_names_array`)
    /// don't need a T4 dep just for the sentinel variant.
    #[inline]
    pub fn as_string_z<'b>(
        &self,
        bump: &'b Bump,
    ) -> Result<Option<&'b bun_string::ZStr>, AllocError> {
        match &self.data {
            expr::Data::EString(s) => Ok(Some(s.get().string_z(bump)?)),
            _ => Ok(None),
        }
    }

    /// Zig: `Expr.asString(allocator)` — `Some(utf8)` when `data` is `e_string`.
    pub fn as_utf8_string_literal(&self) -> Option<&[u8]> {
        if let expr::Data::EString(s) = &self.data {
            if s.is_utf8() {
                return Some(s.data);
            }
        }
        None
    }

    /// Zig: `Expr.asStringHash(allocator, hasher)` — when `data` is `e_string`,
    /// hash the UTF-8 bytes via the supplied `hasher` and return the digest.
    /// Returns `Ok(None)` for non-string data; the outer `Result` matches the
    /// Zig `OOM!?u64` shape (allocator-free here, so always `Ok`).
    #[inline]
    pub fn as_string_hash(
        &self,
        hasher: impl FnOnce(&[u8]) -> u64,
    ) -> Result<Option<u64>, AllocError> {
        Ok(self.as_utf8_string_literal().map(hasher))
    }

    /// Zig: `Expr.getObject(name)` — `get(name)` but only returns the value if
    /// it is itself an object literal.
    pub fn get_object(&self, name: &[u8]) -> Option<Expr> {
        match self.get(name) {
            Some(e) if e.is_object() => Some(e),
            _ => None,
        }
    }

    /// Zig: `Expr.asBool()`.
    #[inline]
    pub fn as_bool(&self) -> Option<bool> {
        if let expr::Data::EBoolean(b) = self.data { Some(b.value) } else { None }
    }

    /// Zig: `Expr.asStringCloned(allocator)`.
    #[inline]
    pub fn as_string_cloned<'b>(
        &self,
        bump: &'b Bump,
    ) -> Result<Option<&'b [u8]>, AllocError> {
        match &self.data {
            expr::Data::EString(s) => Ok(Some(s.string_cloned(bump)?)),
            _ => Ok(None),
        }
    }

    /// Zig: `Expr.deepClone(allocator)` (src/js_parser/ast/Expr.zig). Recursively
    /// copies the tree into fresh allocations so the result outlives the
    /// arena/store the source was parsed into.
    ///
    /// PORT NOTE: Zig allocates clones into the supplied `std.mem.Allocator`
    /// (usually `bun.default_allocator`). The T2 `Expr` boxes its payloads
    /// behind `StoreRef` into the thread-local `DATA_STORE` bump (see
    /// `into_data_store`); that store is *not* reset by
    /// `bun_install::initialize_store()` (which targets the T4
    /// `bun_js_parser` slab), so re-allocating into `DATA_STORE` here gives
    /// the same survives-across-parses guarantee the Zig callers rely on.
    /// `BabyList` buffers (items / properties) are heap-backed and owned by
    /// the boxed payload, matching Zig's per-clone `allocator.alloc`.
    pub fn deep_clone(&self) -> Result<Expr, AllocError> {
        Ok(Expr { loc: self.loc, data: self.data.deep_clone()? })
    }

    /// `Expr.Data.Store.assert()` — debug-only re-entrancy guard. No-op until
    /// the typed Store lands (boxed payloads currently leak; see PERF note).
    #[inline]
    pub fn data_store_assert() {}
    #[inline]
    pub fn data_store_create() {}
    #[inline]
    pub fn data_store_reset() {
        // T2 boxed payloads (`EString`/`EArray`/`EObject`) are bump-allocated
        // into the thread-local `DATA_STORE` arena via `into_data_store`. The
        // full `NewStore` slab lives in `bun_js_parser`; once `Data` is
        // unified, this calls through to it.
        DATA_STORE.with(|s| s.borrow_mut().reset());
    }
}

/// Zig: `js_ast.ArrayIterator` (src/js_parser/ast/Expr.zig). Produced by
/// `Expr::as_array`; `next()` walks `array.items` by index.
pub struct ArrayIterator<'a> {
    pub array: &'a E::Array,
    pub index: u32,
}

impl ArrayIterator<'_> {
    pub fn next(&mut self) -> Option<Expr> {
        if self.index >= self.array.items.len {
            return None;
        }
        let result = self.array.items.slice()[self.index as usize];
        self.index += 1;
        Some(result)
    }
}

/// `js_ast.Expr.Data` lives in a `js_ast::expr` submodule so callers can
/// address it as both `js_ast::ExprData` and `js_ast::expr::Data` (json.rs
/// uses the latter path).
pub mod expr {
    use super::*;

    /// Value-shaped subset of `js_ast.Expr.Data`. Pointer variants are
    /// arena-allocated `StoreRef<E::*>`; inline variants are stored by value.
    /// `StoreRef` is `Copy` + `Deref`, so `Data` is `Copy` and
    /// `let Data::EObject(o) = data; o.properties` works (matching Zig's
    /// `data.e_object.properties`). Parser-only variants (`EUnary`/`ECall`/
    /// `EDot`/etc.) live in `bun_js_parser::ast::expr::Data`.
    #[derive(Clone, Copy)]
    pub enum Data {
        EArray(StoreRef<E::Array>),
        EObject(StoreRef<E::Object>),
        EString(StoreRef<E::EString>),

        EBoolean(E::Boolean),
        ENumber(E::Number),
        ENull(E::Null),
        EUndefined(E::Undefined),
        EMissing(E::Missing),
    }

    impl Data {
        #[inline]
        pub fn e_string(&self) -> Option<StoreRef<E::EString>> {
            if let Data::EString(s) = *self { Some(s) } else { None }
        }
        #[inline]
        pub fn e_object(&self) -> Option<StoreRef<E::Object>> {
            if let Data::EObject(o) = *self { Some(o) } else { None }
        }
        #[inline]
        pub fn e_array(&self) -> Option<StoreRef<E::Array>> {
            if let Data::EArray(a) = *self { Some(a) } else { None }
        }
        #[inline]
        pub fn e_object_mut(&mut self) -> Option<&mut E::Object> {
            if let Data::EObject(o) = self { Some(&mut **o) } else { None }
        }
        #[inline]
        pub fn e_array_mut(&mut self) -> Option<&mut E::Array> {
            if let Data::EArray(a) = self { Some(&mut **a) } else { None }
        }
        #[inline]
        pub fn as_e_string(&self) -> Option<StoreRef<E::EString>> {
            self.e_string()
        }
        #[inline]
        pub fn as_e_array(&self) -> Option<StoreRef<E::Array>> {
            self.e_array()
        }
        #[inline]
        pub fn as_e_object(&self) -> Option<StoreRef<E::Object>> {
            self.e_object()
        }
        #[inline]
        pub fn as_e_number(&self) -> Option<E::Number> {
            if let Data::ENumber(n) = *self { Some(n) } else { None }
        }
        /// `std.meta.activeTag(self)` — discriminant as `ExprTag`.
        #[inline]
        pub fn tag(&self) -> super::ExprTag {
            use super::ExprTag;
            match self {
                Data::EArray(_) => ExprTag::EArray,
                Data::EObject(_) => ExprTag::EObject,
                Data::EString(_) => ExprTag::EString,
                Data::EBoolean(_) => ExprTag::EBoolean,
                Data::ENumber(_) => ExprTag::ENumber,
                Data::ENull(_) => ExprTag::ENull,
                Data::EUndefined(_) => ExprTag::EUndefined,
                Data::EMissing(_) => ExprTag::EMissing,
            }
        }
        /// Zig `Expr.Data.deepClone` — recursively re-allocate boxed payloads
        /// into the thread-local `DATA_STORE` so the result outlives a
        /// `data_store_reset()`. Inline scalar variants are `Copy` and pass
        /// through unchanged.
        pub fn deep_clone(&self) -> Result<Data, AllocError> {
            use super::IntoExprData;
            Ok(match *self {
                Data::EArray(a) => {
                    let mut items = ExprNodeList::default();
                    for item in a.slice() {
                        items.append(item.deep_clone()?)?;
                    }
                    E::Array { items, ..*a }.into_data_store()
                }
                Data::EObject(o) => {
                    let mut properties = super::G::PropertyList::default();
                    for prop in o.properties.slice() {
                        properties.append(super::G::Property {
                            initializer: match &prop.initializer {
                                Some(e) => Some(e.deep_clone()?),
                                None => None,
                            },
                            kind: prop.kind,
                            flags: prop.flags,
                            key: match &prop.key {
                                Some(e) => Some(e.deep_clone()?),
                                None => None,
                            },
                            value: match &prop.value {
                                Some(e) => Some(e.deep_clone()?),
                                None => None,
                            },
                        })?;
                    }
                    E::Object { properties, ..*o }.into_data_store()
                }
                Data::EString(s) => s.shallow_clone().into_data_store(),
                // Inline `Copy` payloads — no heap to clone.
                d @ (Data::EBoolean(_)
                | Data::ENumber(_)
                | Data::ENull(_)
                | Data::EUndefined(_)
                | Data::EMissing(_)) => d,
            })
        }

        #[inline]
        pub fn is_e_string(&self) -> bool { matches!(self, Data::EString(_)) }
        #[inline]
        pub fn is_e_number(&self) -> bool { matches!(self, Data::ENumber(_)) }
        #[inline]
        pub fn is_e_array(&self) -> bool { matches!(self, Data::EArray(_)) }
        #[inline]
        pub fn is_e_object(&self) -> bool { matches!(self, Data::EObject(_)) }
    }

    /// `Expr.asProperty` result.
    pub struct Query {
        pub expr: super::Expr,
        pub loc: Loc,
        pub i: u32,
    }
}

pub use expr::Data as ExprData;

/// `std.meta.Tag(Expr.Data)` — value subset.
#[derive(Clone, Copy, PartialEq, Eq, Debug, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
#[repr(u8)]
pub enum ExprTag {
    EArray,
    EObject,
    EString,
    EBoolean,
    ENumber,
    ENull,
    EUndefined,
    EMissing,
}

// ───────────────────────────────────────────────────────────────────────────
// IntoExprData — replaces Zig's `comptime Type: type` switch in `Expr.init`.
// ───────────────────────────────────────────────────────────────────────────

/// Marker + conversion trait for `Expr::init` payloads. Downstream crates
/// (toml.rs, json.rs) bound generics on this as `D: js_ast::ExprInit`.
pub trait IntoExprData: Sized {
    /// Construct `Data` using the thread-local Store (Zig: `Expr.init`).
    fn into_data_store(self) -> expr::Data;
    /// Construct `Data` using a caller-supplied arena (Zig: `Expr.allocate`).
    fn into_data_alloc(self, bump: &Bump) -> expr::Data;
}
/// Legacy alias from the B-1 stub (toml.rs:129, json.rs:64).
pub use IntoExprData as ExprInit;

macro_rules! impl_into_expr_data_inline {
    ($($ty:ident => $variant:ident),* $(,)?) => {$(
        impl IntoExprData for E::$ty {
            #[inline]
            fn into_data_store(self) -> expr::Data { expr::Data::$variant(self) }
            #[inline]
            fn into_data_alloc(self, _bump: &Bump) -> expr::Data { expr::Data::$variant(self) }
        }
    )*};
}
// Thread-local bump arena backing `into_data_store` for boxed payloads.
// Mirrors Zig's thread-local `Expr.Data.Store` slab; bulk-freed via
// `Expr::data_store_reset()`. PORTING.md §Forbidden — no `Box::leak`.
std::thread_local! {
    static DATA_STORE: core::cell::RefCell<Bump> =
        core::cell::RefCell::new(Bump::new());
}

/// Copy `bytes` into the thread-local `DATA_STORE` arena so the slice shares
/// the same lifetime as the `StoreRef`-backed `Expr` nodes that will reference
/// it (bulk-freed on `Expr::data_store_reset`). Mirrors Zig call sites that
/// write `Expr.init(E.String, .{ .data = try allocator.dupe(u8, …) }, …)` with
/// the long-lived default allocator: callers that build an `EString` from a
/// scratch buffer must intern the bytes here, not into a function-local
/// `bumpalo::Bump`, or the resulting `EString.data` dangles once that bump
/// drops. The lifetime is erased per the Phase-A `Str` convention used by
/// `EString::init` — this is arena ownership, not a leak.
pub fn data_store_dupe_str(bytes: &[u8]) -> &'static [u8] {
    DATA_STORE.with(|s| {
        let store = s.borrow();
        let copied: &[u8] = store.alloc_slice_copy(bytes);
        // SAFETY: `copied` lives in `DATA_STORE` until `data_store_reset`;
        // erase to match `EString::init`'s `&'static [u8]` field.
        unsafe { core::mem::transmute::<&[u8], &'static [u8]>(copied) }
    })
}

macro_rules! impl_into_expr_data_boxed {
    ($($ty:ident => $variant:ident),* $(,)?) => {$(
        impl IntoExprData for E::$ty {
            fn into_data_store(self) -> expr::Data {
                // Zig interns into the thread-local `Expr.Data.Store` slab.
                // T2 routes through `DATA_STORE` (a `bumpalo::Bump`); pointees
                // live until `Expr::data_store_reset()`. `bun_js_parser`'s
                // `IntoExprData` impls go through `data::Store::append`. Unify
                // with the Store when `Data` is unified.
                DATA_STORE.with(|s| {
                    expr::Data::$variant(StoreRef::from_bump(s.borrow().alloc(self)))
                })
            }
            fn into_data_alloc(self, bump: &Bump) -> expr::Data {
                expr::Data::$variant(StoreRef::from_bump(bump.alloc(self)))
            }
        }
    )*};
}

impl_into_expr_data_inline! {
    Boolean   => EBoolean,
    Number    => ENumber,
    Null      => ENull,
    Undefined => EUndefined,
    Missing   => EMissing,
}
impl_into_expr_data_boxed! {
    Array   => EArray,
    Object  => EObject,
    EString => EString,
}

// `&E::EString` — Zig allows passing a pointer to copy from.
impl IntoExprData for &E::EString {
    fn into_data_store(self) -> expr::Data {
        self.shallow_clone().into_data_store()
    }
    fn into_data_alloc(self, bump: &Bump) -> expr::Data {
        self.shallow_clone().into_data_alloc(bump)
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Stmt — placeholder. Only `Stmt::data_store_assert()` is referenced from T3
// (json parser init). The real `Stmt` stays in `bun_js_parser::ast::stmt`.
// ───────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Default)]
pub struct Stmt(());
impl Stmt {
    #[inline]
    pub fn data_store_assert() {}
    #[inline]
    pub fn data_store_reset() {}
}

/// RAII scope for the thread-local AST data stores.
///
/// Zig: `Expr.Data.Store.reset(); Stmt.Data.Store.reset(); defer { ...reset() }`.
/// Construct at the top of a parse scope; resets both stores on entry and again
/// on every exit path (including `?`/early return). Replaces the
/// `scopeguard::guard((), |_| ...)` pattern banned by docs/PORTING.md.
#[must_use = "dropping immediately resets the AST data stores; bind to `let _scope = ...`"]
pub struct DataStoreScope(());
impl DataStoreScope {
    #[inline]
    pub fn new() -> Self {
        Expr::data_store_reset();
        Stmt::data_store_reset();
        Self(())
    }
}
impl Drop for DataStoreScope {
    #[inline]
    fn drop(&mut self) {
        Expr::data_store_reset();
        Stmt::data_store_reset();
    }
}
