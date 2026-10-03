//! What the lowering builds the type checker's tree in: the tree itself, the names of the file, and what is still to be filled in.

use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::{self, *};

pub(crate) struct Builder<'a> {
    pub(crate) file: hir::File,
    pub(crate) atoms: &'a Interner,
    /// The short names this thread has interned, each at the place its spelling gives it. The last to come to a place has it.
    seen_names: Box<[std::cell::Cell<SeenName>]>,
    /// `File::keyword_identifier_positions`
    pub(crate) keyword_identifier_positions: std::cell::RefCell<Vec<u32>>,

    /// The TypeScript syntax nodes the parser built.
    pub(crate) ts: crate::sema::ts_syntax::Syntax,
    /// Parts of cloned nodes that the lowering still has to fill in.
    pub(crate) pending: Vec<super::clone_types::PendingPart>,
    /// The modifiers of the statements being lowered, those of the innermost last.
    pub(crate) statement_modifiers: Vec<Modifier>,
    /// How many classes what is being lowered is written in. While the file is parsed, whether what is being read is written in one.
    pub(crate) classes_around: u32,
    /// `IsInJSFile`
    pub(crate) is_js: bool,
    /// Where the first token of the statement being made is: a decorator, a modifier or its keyword.
    pub(crate) statement_start: u32,
}

/// A name of at most 16 bytes and its atom. The first bytes, the last bytes and the length say all there is to say of its spelling.
#[derive(Copy, Clone)]
struct SeenName {
    head: u64,
    tail: u64,
    /// 0 where there is no name.
    len_plus_one: u32,
    atom: Atom,
}

impl SeenName {
    const NONE: SeenName = SeenName {
        head: 0,
        tail: 0,
        len_plus_one: 0,
        atom: Atom(0),
    };
}

/// A power of two.
const SEEN_NAMES_LEN: usize = 1 << 14;

thread_local! {
    /// The vectors the tree of the last file was made in, empty: they have about the room the next needs.
    static ROOM: std::cell::RefCell<hir::File> = Default::default();
    /// `Builder::seen_names` between two files, and `Interner::number` of the interner they are of.
    static SEEN_NAMES: std::cell::Cell<(u64, Box<[std::cell::Cell<SeenName>]>)> = Default::default();
}

/// `ROOM` and `SEEN_NAMES`.
#[derive(Default)]
pub(crate) struct Room(hir::File, (u64, Box<[std::cell::Cell<SeenName>]>));

/// Replaces what the last file of this thread left for the next.
pub(crate) fn replace_room(room: Room) -> Room {
    Room(ROOM.replace(room.0), SEEN_NAMES.replace(room.1))
}

impl Drop for Builder<'_> {
    fn drop(&mut self) {
        SEEN_NAMES.set((self.atoms.number(), std::mem::take(&mut self.seen_names)));
    }
}

/// `file` is finished: it is fitted, and the vectors it was made in serve the next file of this thread.
pub(crate) fn leave_room(file: &mut hir::File) {
    ROOM.with_borrow_mut(|room| file.fit_leaving_room(room));
}

impl<'a> Builder<'a> {
    pub(crate) fn new(is_js: bool, atoms: &'a Interner) -> Self {
        let (of, mut seen_names) = SEEN_NAMES.take();
        if seen_names.is_empty() {
            let none = std::cell::Cell::new(SeenName::NONE);
            seen_names = vec![none; SEEN_NAMES_LEN].into_boxed_slice();
        } else if of != atoms.number() {
            seen_names.fill(std::cell::Cell::new(SeenName::NONE));
        }
        Builder {
            file: ROOM.take(),
            atoms,
            seen_names,
            keyword_identifier_positions: Default::default(),

            ts: Default::default(),
            pending: Vec::new(),
            statement_modifiers: Vec::new(),
            classes_around: 0,
            is_js,
            statement_start: 0,
        }
    }

    /// `atom`, of the text of an `Identifier` that is at `pos`, or is a child of the node that starts there. Not needed for what
    /// `IsIdentifierName` says yes to, nor in a JSDoc comment.
    #[inline]
    pub(crate) fn identifier(&self, text: &[u8], pos: u32) -> Atom {
        let atom = self.atom(text);
        if atom.is_keyword_identifier() {
            self.keyword_identifier_positions.borrow_mut().push(pos);
        }
        atom
    }

    pub(crate) fn atom(&self, text: &[u8]) -> Atom {
        let len = text.len();
        // The first bytes and the last, which may overlap.
        let (head, tail) = match len {
            0 => (0, 0),
            1..=3 => (
                u64::from(text[0]),
                u64::from(text[len / 2]) << 8 | u64::from(text[len - 1]),
            ),
            4..=7 => (
                u64::from(u32::from_le_bytes(text[..4].try_into().unwrap())),
                u64::from(u32::from_le_bytes(text[len - 4..].try_into().unwrap())),
            ),
            8..=16 => (
                u64::from_le_bytes(text[..8].try_into().unwrap()),
                u64::from_le_bytes(text[len - 8..].try_into().unwrap()),
            ),
            _ => return self.atoms.intern(text),
        };
        let hash = (head ^ tail.rotate_left(23) ^ len as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15);
        let place = &self.seen_names[(hash >> 40) as usize & (self.seen_names.len() - 1)];
        let seen = place.get();
        if seen.head == head && seen.tail == tail && seen.len_plus_one == len as u32 + 1 {
            return seen.atom;
        }
        self.intern_unseen(text, head, tail, place)
    }

    #[inline(never)]
    fn intern_unseen(
        &self,
        text: &[u8],
        head: u64,
        tail: u64,
        place: &std::cell::Cell<SeenName>,
    ) -> Atom {
        let atom = self.atoms.intern(text);
        place.set(SeenName {
            head,
            tail,
            len_plus_one: text.len() as u32 + 1,
            atom,
        });
        atom
    }

    /// What stands where a type was expected at `offset` and none could be made out.
    pub(crate) fn error_type(&mut self, offset: u32) -> TypeNodeId {
        if self.file.syntax_errors == 0 {
            self.file.error_pos = offset;
        }
        self.file.syntax_errors += 1;
        self.file.ty(TypeNodeKind::Error, offset, offset)
    }

    pub(crate) fn number_name(&self, n: f64) -> Atom {
        self.atom(&bun_sema::atom::number_to_string(n))
    }

    /// `["a"]` is `a`.
    pub(crate) fn computed_key(&mut self, expr: ExprId) -> PropKey {
        match self.file[expr].kind {
            ExprKind::String(name) => PropKey::Name(name),
            ExprKind::Number(n) => PropKey::Name(self.number_name(self.file.numbers[n as usize])),
            _ => PropKey::Computed(expr),
        }
    }

    /// `modifiers` as a `ModifierList`.
    /// `jsErrorAtRange`. An end of 0: that of the token at the start. `what`: `{0}`, if the message has one.
    pub(crate) fn js_error_at_range(&mut self, at: (u32, u32), code: u32, what: &'static [u8]) {
        if self.is_js {
            let args: &[&[u8]] = if what.is_empty() { &[] } else { &[what] };
            let diagnostic = Diagnostic::new(DiagnosticKind::Js, at, code, args);
            self.file.diagnostics.push(diagnostic);
        }
    }

    pub(crate) fn add_modifier_list(&mut self, modifiers: &[(Flags, u32)]) -> Span<ModifierId> {
        let start = self.file.modifiers.len() as u32;
        self.file
            .modifiers
            .extend(modifiers.iter().map(|&(flag, pos)| Modifier {
                kind: ModifierKind::Keyword(flag),
                pos,
            }));
        Span::new(start, modifiers.len() as u32)
    }

    /// `keywords` and `decorators`, each with where its `@` is, as one `ModifierList`.
    pub(crate) fn modifiers_with_decorators(
        &mut self,
        keywords: Span<ModifierId>,
        decorators: &[(ExprId, u32)],
    ) -> Span<ModifierId> {
        if decorators.is_empty() {
            return keywords;
        }
        let mut all = self.file.modifier_list(keywords).to_vec();
        all.extend(decorators.iter().map(|&(decorator, pos)| Modifier {
            kind: ModifierKind::Decorator(decorator),
            pos,
        }));
        // What a tag of a comment makes comes last.
        let is_reparsed = |it: &Modifier| matches!(it.kind, ModifierKind::Keyword(flag) if flag.contains(Flags::REPARSED));
        all.sort_by_key(|modifier| (is_reparsed(modifier), modifier.pos));
        self.file.add_modifiers(&all)
    }

    /// `statement` has the modifiers that were come upon since there were `base` of them. Its own `export` and `default` are none.
    pub(crate) fn take_statement_modifiers(&mut self, statement: StmtId, base: usize) {
        // The decorators of a class are lowered with the class (`Class::modifiers`). What was read of them here goes.
        let class = match self.file[statement].kind {
            StmtKind::Class(class) => Some(class),
            _ => None,
        };
        if let Some(class) = class {
            let is_keyword =
                |modifier: &Modifier| matches!(modifier.kind, ModifierKind::Keyword(_));
            let mut index = 0;
            self.statement_modifiers.retain(|modifier| {
                index += 1;
                index <= base || is_keyword(modifier)
            });
            let lowered = self.file.modifier_list(self.file[class].modifiers);
            self.statement_modifiers
                .extend(lowered.iter().filter(|modifier| !is_keyword(modifier)));
            self.statement_modifiers[base..].sort_by_key(|modifier| modifier.pos);
        }
        let own_keywords = match self.file[statement].kind {
            StmtKind::ExportDefault(_) => 2,
            StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_) => 1,
            _ => 0,
        };
        let end = self
            .statement_modifiers
            .len()
            .saturating_sub(own_keywords)
            .max(base);
        if end > base {
            let list = self
                .file
                .add_modifiers(&self.statement_modifiers[base..end]);
            self.file[statement].modifiers = list;
            if let Some(class) = class {
                self.file[class].modifiers = list;
            }
        }
        self.statement_modifiers.truncate(base);
    }
}
