use core::cell::RefCell;

use bumpalo::Bump;

use bun_core::{self, StackCheck};
use bun_logger as logger;
use bun_js_parser::{self as js_ast, E, Expr};

pub mod lexer;
pub use self::lexer::Lexer;
use self::lexer::T;

type Rope = <E::Object as js_ast::e::ObjectExt>::Rope;
// TODO(port): the line above guesses at how `js_ast::E::Object::Rope` is exposed in Rust;
// in Zig it is `js_ast.E.Object.Rope`. Adjust to the real path in Phase B.

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
    pub type HashMap = bun_collections::HashMap<u64, ()>;

    // bun.deprecated.SinglyLinkedList(HashMap)
    // TODO(port): `bun.deprecated.SinglyLinkedList` has no Rust mapping; using an
    // intrusive singly-linked node with raw `next` pointer to match shape.
    pub struct Node {
        pub data: HashMap,
        pub next: *mut Node,
    }

    thread_local! {
        // Zig: `threadlocal var list: LinkedList = undefined;` + `threadlocal var loaded: bool = false;`
        // Folded into a single Option — None ≙ loaded == false.
        static LIST: RefCell<Option<*mut Node>> = const { RefCell::new(None) };
    }

    pub fn get() -> *mut Node {
        let popped = LIST.with_borrow_mut(|list| {
            if let Some(first) = list {
                // SAFETY: `first` was produced by Box::into_raw below and is non-null.
                let node = *first;
                unsafe {
                    *list = if (*node).next.is_null() { None } else { Some((*node).next) };
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
        Box::into_raw(Box::new(Node {
            data: HashMap::default(),
            next: core::ptr::null_mut(),
        }))
    }

    pub fn release(node: *mut Node) {
        LIST.with_borrow_mut(|list| match list {
            Some(first) => {
                // SAFETY: `node` came from `get()` (Box::into_raw) and is exclusively owned here.
                unsafe { (*node).next = *first };
                *first = node;
            }
            None => {
                *list = Some(node);
            }
        });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// TOML parser
// ──────────────────────────────────────────────────────────────────────────

pub struct TOML<'a> {
    pub lexer: Lexer,
    pub log: &'a mut logger::Log,
    pub bump: &'a Bump,
    pub stack_check: StackCheck,
}

impl<'a> TOML<'a> {
    pub fn init(
        bump: &'a Bump,
        source_: logger::Source,
        log: &'a mut logger::Log,
        redact_logs: bool,
    ) -> Result<TOML<'a>, bun_core::Error> {
        // TODO(port): narrow error set
        Ok(TOML {
            lexer: Lexer::init(log, source_, bump, redact_logs)?,
            bump,
            log,
            stack_check: StackCheck::init(),
        })
    }

    #[inline]
    pub fn source(&self) -> &logger::Source {
        &self.lexer.source
    }

    // Zig: `fn e(_: *TOML, t: anytype, loc: logger.Loc) Expr` with a
    // `@typeInfo(Type) == .pointer` auto-deref. In Rust the deref is implicit at
    // call sites, so this collapses to a single generic forwarding to Expr::init.
    pub fn e<D>(&self, t: D, loc: logger::Loc) -> Expr
    where
        D: js_ast::ExprData, // TODO(port): real trait bound for Expr::init payloads
    {
        Expr::init(t, loc)
    }

    pub fn parse_key_segment(&mut self) -> Result<Option<Expr>, bun_core::Error> {
        let loc = self.lexer.loc();

        match self.lexer.token {
            T::TStringLiteral => {
                let str = self.lexer.to_string(loc);
                self.lexer.next()?;
                Ok(Some(str))
            }
            T::TIdentifier => {
                let str = E::String { data: self.lexer.identifier };
                self.lexer.next()?;
                Ok(Some(self.e(str, loc)))
            }
            T::TFalse => {
                self.lexer.next()?;
                Ok(Some(self.e(E::String { data: b"false" }, loc)))
            }
            T::TTrue => {
                self.lexer.next()?;
                Ok(Some(self.e(E::String { data: b"true" }, loc)))
            }
            // what we see as a number here could actually be a string
            T::TNumericLiteral => {
                let literal = self.lexer.raw();
                self.lexer.next()?;
                Ok(Some(self.e(E::String { data: literal }, loc)))
            }

            _ => Ok(None),
        }
    }

    pub fn parse_key(&mut self, bump: &Bump) -> Result<&mut Rope, bun_core::Error> {
        // TODO(port): lifetime — Zig returns `*Rope` allocated from `allocator`
        // (a stack-fallback arena reset per-iteration). Here we allocate from the
        // caller-provided bump and return `&mut Rope` borrowed from it.
        let rope: &mut Rope = bump.alloc(Rope {
            head: match self.parse_key_segment()? {
                Some(seg) => seg,
                None => {
                    self.lexer.expected_string("key")?;
                    return Err(bun_core::err!("SyntaxError"));
                }
            },
            next: None,
        });
        let head: *mut Rope = rope;
        let mut rope: *mut Rope = rope;

        while self.lexer.token == T::TDot {
            self.lexer.next()?;

            let Some(seg) = self.parse_key_segment()? else { break };
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

    pub fn parse(
        source_: &logger::Source,
        log: &'a mut logger::Log,
        bump: &'a Bump,
        redact_logs: bool,
    ) -> Result<Expr, bun_core::Error> {
        // TODO(port): narrow error set
        match source_.contents.len() {
            // This is to be consisntent with how disabled JS files are handled
            0 => {
                return Ok(Expr {
                    loc: logger::Loc { start: 0 },
                    data: Expr::init(E::Object::default(), logger::Loc::EMPTY).data,
                });
            }
            _ => {}
        }

        let mut parser = TOML::init(bump, source_.clone(), log, redact_logs)?;

        parser.run_parser()
    }

    fn run_parser(&mut self) -> Result<Expr, bun_core::Error> {
        let mut root = self.e(E::Object::default(), self.lexer.loc());
        let mut head: *mut E::Object = root.data.e_object();
        // TODO(port): `head` aliases into `root.data`; using raw pointer to mirror
        // the Zig `*E.Object` and sidestep overlapping &mut on `root`.

        // PERF(port): was stack-fallback (std.heap.stackFallback(@sizeOf(Rope)*6)) —
        // profile in Phase B. Using the parser's bump directly.
        let key_allocator = self.bump;

        loop {
            let loc = self.lexer.loc();
            match self.lexer.token {
                T::TEndOfFile => {
                    return Ok(root);
                }
                // child table
                T::TOpenBracket => {
                    self.lexer.next()?;
                    let key = self.parse_key(key_allocator)?;

                    self.lexer.expect(T::TCloseBracket)?;
                    if !self.lexer.has_newline_before {
                        self.lexer.expected_string("line break")?;
                    }

                    let parent_object = match root.data.e_object().get_or_put_object(key, self.bump)
                    {
                        Ok(v) => v,
                        Err(e) if e == bun_core::err!("Clobber") => {
                            self.lexer.add_default_error("Table already defined")?;
                            return Err(bun_core::err!("SyntaxError"));
                        }
                        Err(e) => return Err(e),
                    };
                    head = parent_object.data.e_object();
                    // PERF(port): was `stack.fixed_buffer_allocator.reset()` — profile in Phase B
                }
                // child table array
                T::TOpenBracketDouble => {
                    self.lexer.next()?;

                    let key = self.parse_key(key_allocator)?;

                    self.lexer.expect(T::TCloseBracketDouble)?;
                    if !self.lexer.has_newline_before {
                        self.lexer.expected_string("line break")?;
                    }

                    let array = match root.data.e_object().get_or_put_array(key, self.bump) {
                        Ok(v) => v,
                        Err(e) if e == bun_core::err!("Clobber") => {
                            self.lexer
                                .add_default_error("Cannot overwrite table array")?;
                            return Err(bun_core::err!("SyntaxError"));
                        }
                        Err(e) => return Err(e),
                    };
                    let new_head = self.e(E::Object::default(), loc);
                    array.data.e_array().push(self.bump, new_head)?;
                    head = new_head.data.e_object();
                    // PERF(port): was `stack.fixed_buffer_allocator.reset()` — profile in Phase B
                }
                _ => {
                    // SAFETY: `head` points to an E.Object inside `root` (or a
                    // descendant) allocated from the AST store; valid for this call.
                    unsafe {
                        self.parse_assignment(&mut *head, key_allocator)?;
                    }
                    // PERF(port): was `stack.fixed_buffer_allocator.reset()` — profile in Phase B
                }
            }
        }
    }

    pub fn parse_assignment(
        &mut self,
        obj: &mut E::Object,
        bump: &Bump,
    ) -> Result<(), bun_core::Error> {
        self.lexer.allow_double_bracket = false;
        let rope = self.parse_key(bump)?;
        let rope_end = self.lexer.start;

        let is_array = self.lexer.token == T::TEmptyArray;
        if is_array {
            self.lexer.next()?;
        }

        self.lexer.expect_assignment()?;
        if !is_array {
            let value = self.parse_value()?;
            match obj.set_rope(rope, self.bump, value) {
                Ok(()) => {}
                Err(e) if e == bun_core::err!("Clobber") => {
                    let loc = rope.head.loc;
                    debug_assert!(loc.start > 0);
                    let start: u32 = u32::try_from(loc.start).unwrap();
                    // std.ascii.whitespace = { ' ', '\t', '\n', '\r', 0x0B, 0x0C }
                    let key_name = bun_str::strings::trim_right(
                        &self.source().contents[start as usize..rope_end],
                        b" \t\n\r\x0B\x0C",
                    );
                    self.lexer.add_error(
                        start,
                        format_args!("Cannot redefine key '{}'", bstr::BStr::new(key_name)),
                    );
                    return Err(bun_core::err!("SyntaxError"));
                }
                Err(e) => return Err(e),
            }
        }
        self.lexer.allow_double_bracket = true;
        Ok(())
    }

    pub fn parse_value(&mut self) -> Result<Expr, bun_core::Error> {
        if !self.stack_check.is_safe_to_recurse() {
            bun_core::throw_stack_overflow()?;
        }

        let loc = self.lexer.loc();

        self.lexer.allow_double_bracket = true;

        match self.lexer.token {
            T::TFalse => {
                self.lexer.next()?;

                Ok(self.e(E::Boolean { value: false }, loc))
            }
            T::TTrue => {
                self.lexer.next()?;
                Ok(self.e(E::Boolean { value: true }, loc))
            }
            T::TStringLiteral => {
                let result = self.lexer.to_string(loc);
                self.lexer.next()?;
                Ok(result)
            }
            T::TIdentifier => {
                let str = E::String { data: self.lexer.identifier };

                self.lexer.next()?;
                Ok(self.e(str, loc))
            }
            T::TNumericLiteral => {
                let value = self.lexer.number;
                self.lexer.next()?;
                Ok(self.e(E::Number { value }, loc))
            }
            T::TMinus => {
                self.lexer.next()?;
                let value = self.lexer.number;

                self.lexer.expect(T::TNumericLiteral)?;
                Ok(self.e(E::Number { value: -value }, loc))
            }
            T::TPlus => {
                self.lexer.next()?;
                let value = self.lexer.number;

                self.lexer.expect(T::TNumericLiteral)?;
                Ok(self.e(E::Number { value }, loc))
            }
            T::TOpenBrace => {
                self.lexer.next()?;
                let mut is_single_line = !self.lexer.has_newline_before;
                // PERF(port): was stack-fallback (std.heap.stackFallback(@sizeOf(Rope)*6)) —
                // profile in Phase B
                let key_allocator = self.bump;
                let expr = self.e(E::Object::default(), loc);
                let obj: *mut E::Object = expr.data.e_object();
                // TODO(port): `obj` aliases into `expr.data`; raw pointer mirrors Zig.

                while self.lexer.token != T::TCloseBrace {
                    // SAFETY: `obj` points into the AST store and is live here.
                    if unsafe { (*obj).properties.len() } > 0 {
                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }
                        if !self.parse_maybe_trailing_comma(T::TCloseBrace)? {
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
                    // PERF(port): was `stack.fixed_buffer_allocator.reset()` — profile in Phase B
                }

                if self.lexer.has_newline_before {
                    is_single_line = false;
                }
                let _ = is_single_line;
                self.lexer.allow_double_bracket = true;
                self.lexer.expect(T::TCloseBrace)?;
                Ok(expr)
            }
            T::TEmptyArray => {
                self.lexer.next()?;
                self.lexer.allow_double_bracket = true;
                Ok(self.e(E::Array::default(), loc))
            }
            T::TOpenBracket => {
                self.lexer.next()?;
                let mut is_single_line = !self.lexer.has_newline_before;
                let array_ = self.e(E::Array::default(), loc);
                let array: *mut E::Array = array_.data.e_array();
                // TODO(port): `array` aliases into `array_.data`; raw pointer mirrors Zig.
                let bump = self.bump;
                self.lexer.allow_double_bracket = false;

                while self.lexer.token != T::TCloseBracket {
                    // SAFETY: `array` points into the AST store and is live here.
                    if unsafe { (*array).items.len() } > 0 {
                        if self.lexer.has_newline_before {
                            is_single_line = false;
                        }

                        if !self.parse_maybe_trailing_comma(T::TCloseBracket)? {
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
                self.lexer.expect(T::TCloseBracket)?;
                Ok(array_)
            }
            _ => {
                self.lexer.unexpected()?;
                Err(bun_core::err!("SyntaxError"))
            }
        }
    }

    pub fn parse_maybe_trailing_comma(&mut self, closer: T) -> Result<bool, bun_core::Error> {
        // TODO(port): narrow error set
        self.lexer.expect(T::TComma)?;

        if self.lexer.token == closer {
            return Ok(false);
        }

        Ok(true)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/interchange/toml.zig (392 lines)
//   confidence: medium
//   todos:      9
//   notes:      AST-arena crate; Expr.data accessor names (e_object/e_array), Rope path, and E::* struct shapes are guessed from bun_js_parser; HashMapPool is dead code; raw *mut used where Zig aliases into Expr.data.
// ──────────────────────────────────────────────────────────────────────────
