//! What the lowering builds the type checker's tree in: the tree itself, the names of the file, and what is still to be filled in.

use bun_sema::atom::{Atom, Interner};
use bun_sema::hir::{self, *};

pub(crate) struct Builder<'a> {
    pub(crate) file: hir::File,
    pub(crate) atoms: &'a Interner,
    /// The short names that were interned for this file, each at the place its spelling gives it. The last to come to a place has it.
    seen_names: Box<[std::cell::Cell<SeenName>]>,

    /// The TypeScript syntax nodes the parser built.
    pub(crate) ts: bun_ast::ts_syntax::Syntax,
    /// Parts of cloned nodes that the lowering still has to fill in.
    pub(crate) pending: Vec<super::clone_types::PendingPart>,
    /// The modifiers of the statements being lowered, those of the innermost last.
    pub(crate) statement_modifiers: Vec<Modifier>,
    /// How many classes what is being lowered is written in.
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

impl<'a> Builder<'a> {
    pub(crate) fn new(source_len: usize, is_js: bool, atoms: &'a Interner) -> Self {
        // A power of two, and more than a file of this length has different names.
        let names = (source_len / 16).next_power_of_two().clamp(64, 2048);
        Builder {
            file: hir::File::default(),
            atoms,
            seen_names: vec![std::cell::Cell::new(SeenName::NONE); names].into_boxed_slice(),

            ts: Default::default(),
            pending: Vec::new(),
            statement_modifiers: Vec::new(),
            classes_around: 0,
            is_js,
            statement_start: 0,
        }
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
        self.file.ty(TypeNodeKind::Error, offset)
    }

    pub(crate) fn number_name(&self, n: f64) -> Atom {
        self.atom(bun_sema::atom::number_to_string(n).as_bytes())
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
