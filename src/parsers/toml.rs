use bun_collections::VecExt;
use core::cell::RefCell;

use bun_alloc::Arena as Bump;

use bun_ast::{self, self as js_ast, E, Expr, LexerLog as _};
use bun_core::{self, StackCheck};

#[path = "toml/lexer.rs"]
pub mod lexer;
pub use self::lexer::Lexer;
use self::lexer::T;

// Zig: `js_ast.E.Object.Rope`. The MOVE_DOWN landed it at
type Rope = js_ast::e::Rope;
use js_ast::e::SetError;
use js_ast::expr::Data as ExprData;

// ──────────────────────────────────────────────────────────────────────────
// E::Object extension — `set_rope` / `get_or_put_array`
//
// `bun_ast::E::Object` ships `get_or_put_object` but not the two
// siblings the TOML parser drives. Defining them here (T3) keeps the
// MOVE_DOWN'd T2 surface minimal; both are straight ports of
// `src/js_parser/ast/E.zig` `setRope` / `getOrPutArray`.
// ──────────────────────────────────────────────────────────────────────────

trait ObjectRopeExt {
    fn set_rope(&mut self, rope: &Rope, bump: &Bump, value: Expr) -> Result<(), SetError>;
    fn get_or_put_array(&mut self, rope: &Rope, bump: &Bump) -> Result<Expr, SetError>;
}

impl ObjectRopeExt for E::Object {
    fn set_rope(&mut self, rope: &Rope, bump: &Bump, value: Expr) -> Result<(), SetError> {
        let head_key = match rope.head.data.e_string() {
            Some(s) => s.data,
            None => return Err(SetError::Clobber),
        };
        if let Some(existing) = self.get(&head_key) {
            match existing.data {
                ExprData::EArray(mut array) => {
                    if rope.next.is_null() {
                        array.push(bump, value)?;
                        return Ok(());
                    }
                    if let Some(last) = array.items.last() {
                        let ExprData::EObject(mut obj) = last.data else {
                            return Err(SetError::Clobber);
                        };
                        // SAFETY: rope.next non-null (checked) and arena-owned.
                        return obj.set_rope(unsafe { &*rope.next }, bump, value);
                    }
                    array.push(bump, value)?;
                    return Ok(());
                }
                ExprData::EObject(mut object) => {
                    if !rope.next.is_null() {
                        // SAFETY: rope.next non-null and arena-owned.
                        return object.set_rope(unsafe { &*rope.next }, bump, value);
                    }
                    return Err(SetError::Clobber);
                }
                _ => return Err(SetError::Clobber),
            }
        }

        let mut value_ = value;
        if !rope.next.is_null() {
            let obj = Expr::init(E::Object::default(), rope.head.loc);
            // SAFETY: rope.next non-null and arena-owned.
            obj.data
                .e_object()
                .unwrap()
                .set_rope(unsafe { &*rope.next }, bump, value)?;
            value_ = obj;
        }

        VecExt::append(
            &mut self.properties,
            js_ast::G::Property {
                key: Some(rope.head),
                value: Some(value_),
                ..Default::default()
            },
        );
        Ok(())
    }

    fn get_or_put_array(&mut self, rope: &Rope, bump: &Bump) -> Result<Expr, SetError> {
        let head_key = match rope.head.data.e_string() {
            Some(s) => s.data,
            None => return Err(SetError::Clobber),
        };
        if let Some(existing) = self.get(&head_key) {
            match existing.data {
                ExprData::EArray(array) => {
                    if rope.next.is_null() {
                        return Ok(existing);
                    }
                    if let Some(last) = array.items.last() {
                        let ExprData::EObject(mut obj) = last.data else {
                            return Err(SetError::Clobber);
                        };
                        // SAFETY: rope.next non-null (checked) and arena-owned.
                        return obj.get_or_put_array(unsafe { &*rope.next }, bump);
                    }
                    return Err(SetError::Clobber);
                }
                ExprData::EObject(mut object) => {
                    if rope.next.is_null() {
                        return Err(SetError::Clobber);
                    }
                    // SAFETY: rope.next non-null and arena-owned.
                    return object.get_or_put_array(unsafe { &*rope.next }, bump);
                }
                _ => return Err(SetError::Clobber),
            }
        }

        if !rope.next.is_null() {
            let obj = Expr::init(E::Object::default(), rope.head.loc);
            // SAFETY: rope.next non-null and arena-owned.
            let out = obj
                .data
                .e_object()
                .unwrap()
                .get_or_put_array(unsafe { &*rope.next }, bump)?;
            VecExt::append(
                &mut self.properties,
                js_ast::G::Property {
                    key: Some(rope.head),
                    value: Some(obj),
                    ..Default::default()
                },
            );
            return Ok(out);
        }

        let out = Expr::init(E::Array::default(), rope.head.loc);
        VecExt::append(
            &mut self.properties,
            js_ast::G::Property {
                key: Some(rope.head),
                value: Some(out),
                ..Default::default()
            },
        );
        Ok(out)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// HashMapPool
// ──────────────────────────────────────────────────────────────────────────
//
// TODO(port): `HashMapPool` is private and unreferenced in this file (dead code
// in the Zig source). Ported for structural fidelity; verify and delete in
// Phase B if truly unused.
mod hash_map_pool {
    use super::*;
    use bun_collections::identity_context::IdentityContext;

    // std.HashMap(u64, void, IdentityContext, 80)
    // TODO(port): load-factor 80 and IdentityContext hasher need to be expressed
    // on bun_collections::HashMap; using the default wyhash map as placeholder.
    pub(super) type HashMap = bun_collections::HashMap<u64, ()>;

    // bun.deprecated.SinglyLinkedList(HashMap)
    // The Rust mapping is `bun_collections::pool::{SinglyLinkedList, Node}`, but
    // that stores `MaybeUninit<T>`; this freelist wants `data: T` directly, so it
    // keeps a local intrusive node with a raw `next` pointer to match shape.
    pub(super) struct Node {
        pub data: HashMap,
        pub next: *mut Node,
    }

    thread_local! {
        // Zig: `threadlocal var list: LinkedList = undefined;` + `threadlocal var loaded: bool = false;`
        // Folded into a single Option — None ≙ loaded == false.
        static LIST: RefCell<Option<*mut Node>> = const { RefCell::new(None) };
    }

    pub(super) fn get() -> *mut Node {
        let popped = LIST.with_borrow_mut(|list| {
            if let Some(first) = list {
                // SAFETY: `first` was produced by heap::alloc below and is non-null.
                let node = *first;
                unsafe {
                    *list = if (*node).next.is_null() {
                        None
                    } else {
                        Some((*node).next)
                    };
                    (*node).data.clear();
                }
                Some(node)
            } else {
                None
            }
        });
        if let Some(node) = popped {
            return node;
        }

        // default_allocator.create(LinkedList.Node) catch unreachable
        bun_core::heap::into_raw(Box::new(Node {
            data: HashMap::default(),
            next: core::ptr::null_mut(),
        }))
    }

    pub(super) fn release(node: *mut Node) {
        // Zig models this as a sticky `loaded: bool` + `list.prepend(node)`;
        // prepend always sets `node.next = list.first`. Folding into a single
        // `Option<*mut Node>` means we must rewrite `next` on BOTH arms — a
        // node coming back via `release` may carry a stale `next` from a prior
        // prepend, and `get()` would follow it and double-vend that node.
        LIST.with_borrow_mut(|list| {
            // SAFETY: `node` came from `get()` (heap::alloc) and is exclusively owned here.
            unsafe { (*node).next = list.unwrap_or(core::ptr::null_mut()) };
            *list = Some(node);
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TOML parser
// ──────────────────────────────────────────────────────────────────────────

pub struct TOML<'a> {
    pub lexer: Lexer<'a>,
    // PORT NOTE: Zig also stores `log: *logger.Log` on the parser, but it is
    // never read — all logging goes through `lexer.log`. Dropped here to avoid
    // a second `&mut Log` borrow overlapping `lexer.log`.
    pub bump: &'a Bump,
    pub stack_check: StackCheck,
}

impl<'a> TOML<'a> {
    pub fn init(
        bump: &'a Bump,
        source_: &'a bun_ast::Source,
        log: &'a mut bun_ast::Log,
        redact_logs: bool,
    ) -> Result<TOML<'a>, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(TOML {
            lexer: Lexer::init(log, source_, bump, redact_logs)?,
            bump,
            stack_check: StackCheck::init(),
        })
    }

    #[inline]
    pub fn source(&self) -> &'a bun_ast::Source {
        self.lexer.source
    }

    // Zig: `fn e(_: *TOML, t: anytype, loc: logger.Loc) Expr` with a
    // `@typeInfo(Type) == .pointer` auto-deref. In Rust the deref is implicit at
    // call sites, so this collapses to a single generic forwarding to Expr::init.
    pub fn e<D>(&self, t: D, loc: bun_ast::Loc) -> Expr
    where
        D: js_ast::ExprInit, // TODO(port): real trait bound for Expr::init payloads
    {
        Expr::init(t, loc)
    }

    pub fn parse(
        source_: &'a bun_ast::Source,
        log: &'a mut bun_ast::Log,
        bump: &'a Bump,
        redact_logs: bool,
    ) -> Result<Expr, bun_core::Error> {
        // TODO(port): narrow error set
        match source_.contents.len() {
            // This is to be consisntent with how disabled JS files are handled
            0 => {
                return Ok(Expr {
                    loc: bun_ast::Loc { start: 0 },
                    data: Expr::init(E::Object::default(), bun_ast::Loc::EMPTY).data,
                });
            }
            _ => {}
        }

        // PORT NOTE: Zig copies the `Source` by value (`source_.*`). The Rust
        // `Lexer` borrows it (`&'a Source`) so `identifier`/`string_literal_slice`
        // can point into `source.contents` for `'a` without a self-referential
        // struct — no copy needed.
        let mut parser = TOML::init(bump, source_, log, redact_logs)?;

        parser.run_parser()
    }

    pub fn parse_maybe_trailing_comma(&mut self, closer: T) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set
        self.lexer.expect(T::t_comma)?;

        if self.lexer.token == closer {
            return Ok(false);
        }

        Ok(true)
    }

    // ── AST-producing methods ──────────────────────────────────────────────

    pub fn parse_key_segment(&mut self) -> Result<Option<Expr>, bun_core::Error> {
        let loc = self.lexer.loc();

        match self.lexer.token {
            T::t_string_literal => {
                let str = self.lexer.to_string(loc);
                self.lexer.next()?;
                Ok(Some(str))
            }
            T::t_identifier => {
                let str = E::String::init(self.lexer.identifier);
                self.lexer.next()?;
                Ok(Some(self.e(str, loc)))
            }
            T::t_false => {
                self.lexer.next()?;
                Ok(Some(self.e(E::String::init(b"false"), loc)))
            }
            T::t_true => {
                self.lexer.next()?;
                Ok(Some(self.e(E::String::init(b"true"), loc)))
            }
            // what we see as a number here could actually be a string
            T::t_numeric_literal => {
                let literal = self.lexer.raw();
                self.lexer.next()?;
                Ok(Some(self.e(E::String::init(literal), loc)))
            }

            _ => Ok(None),
        }
    }

    pub fn parse_key(&mut self, bump: &'a Bump) -> Result<&'a mut Rope, bun_core::Error> {
        // TODO(port): lifetime — Zig returns `*Rope` allocated from `allocator`
        // (a stack-fallback arena reset per-iteration). Here we allocate from the
        // caller-provided bump and return `&mut Rope` borrowed from it.
        let rope: &mut Rope = bump.alloc(Rope {
            head: match self.parse_key_segment()? {
                Some(seg) => seg,
                None => {
                    self.lexer.expected_string(b"key")?;
                    return Err(bun_core::err!("SyntaxError"));
                }
            },
            next: core::ptr::null_mut(),
        });
        let head: *mut Rope = rope;
        let mut rope: *mut Rope = rope;

        while self.lexer.token == T::t_dot {
            self.lexer.next()?;

            let Some(seg) = self.parse_key_segment()? else {
                break;
            };
            // SAFETY: `rope` points into `bump` and is live for this call; we are
            // the sole mutator. Raw pointers used to avoid stacked &mut reborrows.
            // PORT NOTE: reshaped for borrowck
            unsafe {
                rope = (*rope).append(seg, bump)?;
            }
        }

        // SAFETY: `head` was just allocated from `bump` above and is non-null.
        Ok(unsafe { &mut *head })
    }

    fn run_parser(&mut self) -> Result<Expr, bun_core::Error> {
        let root = self.e(E::Object::default(), self.lexer.loc());
        let mut head: *mut E::Object = root
            .data
            .e_object()
            .expect("infallible: variant checked")
            .as_ptr();
        // TODO(port): `head` aliases into `root.data`; using raw pointer to mirror
        // the Zig `*E.Object` and sidestep overlapping &mut on `root`.

        // PERF(port): was stack-fallback (std.heap.stackFallback(@sizeOf(Rope)*6)) —
        // profile. Using the parser's bump directly.
        let key_allocator = self.bump;

        loop {
            let loc = self.lexer.loc();
            match self.lexer.token {
                T::t_end_of_file => {
                    return Ok(root);
                }
                // child table
                T::t_open_bracket => {
                    self.lexer.next()?;
                    let key = self.parse_key(key_allocator)?;

                    self.lexer.expect(T::t_close_bracket)?;
                    if !self.lexer.has_newline_before {
                        self.lexer.expected_string(b"line break")?;
                    }

                    let parent_object = match root
                        .data
                        .e_object()
                        .unwrap()
                        .get_or_put_object(key, self.bump)
                    {
                        Ok(v) => v,
                        Err(SetError::Clobber) => {
                            self.lexer.add_default_error(b"Table already defined")?;
                            return Err(bun_core::err!("SyntaxError"));
                        }
                        Err(e) => return Err(e.into()),
                    };
                    head = parent_object
                        .data
                        .e_object()
                        .expect("infallible: variant checked")
                        .as_ptr();
                    // PERF(port): was `stack.fixed_buffer_allocator.reset()` — profile
                }
                // child table array
                T::t_open_bracket_double => {
                    self.lexer.next()?;

                    let key = self.parse_key(key_allocator)?;

                    self.lexer.expect(T::t_close_bracket_double)?;
                    if !self.lexer.has_newline_before {
                        self.lexer.expected_string(b"line break")?;
                    }

                    let array = match root
                        .data
                        .e_object()
                        .unwrap()
                        .get_or_put_array(key, self.bump)
                    {
                        Ok(v) => v,
                        Err(SetError::Clobber) => {
                            self.lexer
                                .add_default_error(b"Cannot overwrite table array")?;
                            return Err(bun_core::err!("SyntaxError"));
                        }
                        Err(e) => return Err(e.into()),
                    };
                    let new_head = self.e(E::Object::default(), loc);
                    array
                        .data
                        .e_array()
                        .expect("infallible: variant checked")
                        .push(self.bump, new_head)?;
                    head = new_head
                        .data
                        .e_object()
                        .expect("infallible: variant checked")
                        .as_ptr();
                    // PERF(port): was `stack.fixed_buffer_allocator.reset()` — profile
                }
                _ => {
                    // SAFETY: `head` points to an E.Object inside `root` (or a
                    // descendant) allocated from the AST store; valid for this call.
                    unsafe {
                        self.parse_assignment(&mut *head, key_allocator)?;
                    }
                    // PERF(port): was `stack.fixed_buffer_allocator.reset()` — profile
                }
            }
        }
    }

    pub fn parse_assignment(
        &mut self,
        obj: &mut E::Object,
        bump: &'a Bump,
    ) -> Result<(), bun_core::Error> {
        self.lexer.allow_double_bracket = false;
        let rope = self.parse_key(bump)?;
        let rope_end = self.lexer.start;

        let is_array = self.lexer.token == T::t_empty_array;
        if is_array {
            self.lexer.next()?;
        }

        self.lexer.expect_assignment()?;
        if !is_array {
            let value = self.parse_value()?;
            match obj.set_rope(rope, self.bump, value) {
                Ok(()) => {}
                Err(SetError::Clobber) => {
                    let loc = rope.head.loc;
                    debug_assert!(loc.start > 0);
                    let start: u32 = u32::try_from(loc.start).expect("int cast");
                    // std.ascii.whitespace = { ' ', '\t', '\n', '\r', 0x0B, 0x0C }
                    // PORT NOTE: reshaped for borrowck — `self.source()` returns
                    // `&'a Source` (independent of `&self`), so bind it before
                    // the `&mut self.lexer` borrow below.
                    let src: &'a bun_ast::Source = self.source();
                    let key_name = bun_core::strings::trim_right(
                        &src.contents[start as usize..rope_end],
                        b" \t\n\r\x0B\x0C",
                    );
                    self.lexer.add_error(
                        start as usize,
                        format_args!("Cannot redefine key '{}'", bstr::BStr::new(key_name)),
                    );
                    return Err(bun_core::err!("SyntaxError"));
                }
                Err(e) => return Err(e.into()),
            }
        }
        self.lexer.allow_double_bracket = true;
        Ok(())
    }

    pub fn parse_value(&mut self) -> Result<Expr, bun_core::Error> {
        // Zig: `bun.throwStackOverflow()` guarded only by `StackCheck`. The
        // Rust port previously added a hard depth cap because release-mode
        // frames are smaller than Zig's (Zig didn't emit LLVM lifetime
        // annotations, so `parse_value`'s frame was the union of all locals
        // including the `stackFallback(@sizeOf(Rope)*6)` buffer; Rust's is
        // just the live set). The cap was an artificial limit on a feature —
        // the test's `depth = 25_000` was Zig-calibrated and is now bumped to
        // a value that exhausts the 18 MB stack regardless of frame size.
        if !self.stack_check.is_safe_to_recurse() {
            return Err(bun_core::err!("StackOverflow"));
        }
        self.parse_value_inner()
    }

    fn parse_value_inner(&mut self) -> Result<Expr, bun_core::Error> {
        let loc = self.lexer.loc();

        self.lexer.allow_double_bracket = true;

        match self.lexer.token {
            T::t_false => {
                self.lexer.next()?;

                Ok(self.e(E::Boolean { value: false }, loc))
            }
            T::t_true => {
                self.lexer.next()?;
                Ok(self.e(E::Boolean { value: true }, loc))
            }
            T::t_string_literal => {
                let result = self.lexer.to_string(loc);
                self.lexer.next()?;
                Ok(result)
            }
            T::t_identifier => {
                let str = E::String::init(self.lexer.identifier);

                self.lexer.next()?;
                Ok(self.e(str, loc))
            }
            T::t_numeric_literal => {
                let value = self.lexer.number;
                self.lexer.next()?;
                Ok(self.e(E::Number { value }, loc))
            }
            T::t_minus => {
                self.lexer.next()?;
                let value = self.lexer.number;

                self.lexer.expect(T::t_numeric_literal)?;
                Ok(self.e(E::Number { value: -value }, loc))
            }
            T::t_plus => {
                self.lexer.next()?;
                let value = self.lexer.number;

                self.lexer.expect(T::t_numeric_literal)?;
                Ok(self.e(E::Number { value }, loc))
            }
            T::t_open_brace => {
                self.lexer.next()?;
                let mut is_single_line = !self.lexer.has_newline_before;
                // PERF(port): was stack-fallback (std.heap.stackFallback(@sizeOf(Rope)*6)) —
                // profile
                let key_allocator = self.bump;
                let expr = self.e(E::Object::default(), loc);
                let obj: *mut E::Object = expr
                    .data
                    .e_object()
                    .expect("infallible: variant checked")
                    .as_ptr();
                // TODO(port): `obj` aliases into `expr.data`; raw pointer mirrors Zig.

                while self.lexer.token != T::t_close_brace {
                    // SAFETY: `obj` points into the AST store and is live here.
                    if unsafe { (*obj).properties.slice().len() } > 0 {
                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }
                        if !self.parse_maybe_trailing_comma(T::t_close_brace)? {
                            break;
                        }
                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }
                    }
                    // SAFETY: see above.
                    unsafe {
                        self.parse_assignment(&mut *obj, key_allocator)?;
                    }
                    self.lexer.allow_double_bracket = false;
                    // PERF(port): was `stack.fixed_buffer_allocator.reset()` — profile
                }

                if self.lexer.has_newline_before {
                    is_single_line = false;
                }
                let _ = is_single_line;
                self.lexer.allow_double_bracket = true;
                self.lexer.expect(T::t_close_brace)?;
                Ok(expr)
            }
            T::t_empty_array => {
                self.lexer.next()?;
                self.lexer.allow_double_bracket = true;
                Ok(self.e(E::Array::default(), loc))
            }
            T::t_open_bracket => {
                self.lexer.next()?;
                let mut is_single_line = !self.lexer.has_newline_before;
                let array_ = self.e(E::Array::default(), loc);
                let array: *mut E::Array = array_
                    .data
                    .e_array()
                    .expect("infallible: variant checked")
                    .as_ptr();
                // TODO(port): `array` aliases into `array_.data`; raw pointer mirrors Zig.
                let bump = self.bump;
                self.lexer.allow_double_bracket = false;

                while self.lexer.token != T::t_close_bracket {
                    // SAFETY: `array` points into the AST store and is live here.
                    if unsafe { (*array).items.slice().len() } > 0 {
                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }

                        if !self.parse_maybe_trailing_comma(T::t_close_bracket)? {
                            break;
                        }

                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }
                    }

                    let value = self.parse_value()?;
                    // SAFETY: see above.
                    unsafe {
                        (*array).push(bump, value).expect("unreachable");
                    }
                }

                if self.lexer.has_newline_before {
                    is_single_line = false;
                }
                let _ = is_single_line;
                self.lexer.allow_double_bracket = true;
                self.lexer.expect(T::t_close_bracket)?;
                Ok(array_)
            }
            _ => {
                self.lexer.unexpected()?;
                Err(bun_core::err!("SyntaxError"))
            }
        }
    }
}

// ported from: src/interchange/toml.zig
