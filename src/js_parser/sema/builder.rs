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
    /// The class whose members are being lowered is a declaration that says `abstract`.
    pub(crate) in_abstract_class: bool,
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

/// What modifiers are written on, as far as it matters to which are allowed.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum Modified {
    Property,
    Method,
    Accessor,
    Constructor,
    ClassIndexSignature,
    IndexSignature,
    PropertySignature,
    MethodSignature,
    Parameter,
}

/// `checkGrammarModifiers`, of TypeScript 7.0.2's grammarchecks.go, for the members of classes and types and for parameters:
/// the first thing that is wrong, where it is and the code it goes by.
pub(crate) fn modifier_error(
    modifiers: &[(Flags, u32)],
    on: Modified,
    in_abstract_class: bool,
    is_parent_ambient: bool,
    has_private_name: bool,
) -> Option<(u32, u32)> {
    const ACCESSIBILITY: Flags = Flags::PUBLIC.union(Flags::PRIVATE).union(Flags::PROTECTED);
    let mut seen = Flags::empty();
    let (mut last_static, mut last_override, mut last_async) = (0, 0, 0);
    let in_class = !matches!(
        on,
        Modified::IndexSignature
            | Modified::PropertySignature
            | Modified::MethodSignature
            | Modified::Parameter
    );
    for &(modifier, at) in modifiers {
        let error = |code: u32| Some((at, code));
        // One that is made from a JSDoc tag comes last wherever the tag is: nothing is said of the order.
        let is_written = !modifier.contains(Flags::REPARSED);
        let modifier = modifier.difference(Flags::REPARSED);
        if modifier != Flags::READONLY {
            if matches!(on, Modified::PropertySignature | Modified::MethodSignature) {
                return error(1070);
            }
            if on == Modified::IndexSignature
                || on == Modified::ClassIndexSignature && modifier != Flags::STATIC
            {
                return error(1071);
            }
        }
        if modifier == Flags::CONST {
            // Reported on the declaration: `check_modifiers` moves it to the name.
            return error(1248);
        } else if modifier == Flags::IN || modifier == Flags::OUT {
            return error(1274);
        } else if modifier == Flags::EXPORT {
            if seen.contains(Flags::EXPORT) {
                return error(1030);
            } else if seen.intersects(Flags::AMBIENT | Flags::ABSTRACT | Flags::ASYNC) {
                return error(1029);
            } else if in_class {
                return error(1031);
            } else if on == Modified::Parameter {
                return error(1090);
            }
        } else if modifier == Flags::OVERRIDE {
            if seen.contains(Flags::OVERRIDE) {
                return error(1030);
            } else if seen.contains(Flags::AMBIENT) {
                return error(1243);
            } else if is_written
                && seen.intersects(Flags::READONLY | Flags::ACCESSOR | Flags::ASYNC)
            {
                return error(1029);
            }
            last_override = at;
        } else if ACCESSIBILITY.contains(modifier) {
            if seen.intersects(ACCESSIBILITY) {
                return error(1028);
            } else if is_written
                && seen.intersects(
                    Flags::OVERRIDE
                        | Flags::STATIC
                        | Flags::ACCESSOR
                        | Flags::READONLY
                        | Flags::ASYNC,
                )
            {
                return error(1029);
            } else if seen.contains(Flags::ABSTRACT) {
                if modifier == Flags::PRIVATE {
                    return error(1243);
                } else if is_written {
                    return error(1029);
                }
            } else if has_private_name {
                return error(18010);
            }
        } else if modifier == Flags::STATIC {
            if seen.contains(Flags::STATIC) {
                return error(1030);
            } else if seen.intersects(Flags::READONLY | Flags::ASYNC | Flags::ACCESSOR) {
                return error(1029);
            } else if on == Modified::Parameter {
                return error(1090);
            } else if seen.contains(Flags::ABSTRACT) {
                return error(1243);
            } else if seen.contains(Flags::OVERRIDE) {
                return error(1029);
            }
            last_static = at;
        } else if modifier == Flags::ACCESSOR {
            if seen.contains(Flags::ACCESSOR) {
                return error(1030);
            } else if seen.intersects(Flags::READONLY | Flags::AMBIENT) {
                return error(1243);
            } else if on != Modified::Property {
                return error(1275);
            }
        } else if modifier == Flags::READONLY {
            if seen.contains(Flags::READONLY) {
                return error(1030);
            } else if matches!(
                on,
                Modified::Method
                    | Modified::Accessor
                    | Modified::Constructor
                    | Modified::MethodSignature
            ) {
                return error(1024);
            } else if seen.contains(Flags::ACCESSOR) {
                return error(1243);
            }
        } else if modifier == Flags::AMBIENT {
            if seen.contains(Flags::AMBIENT) {
                return error(1030);
            } else if seen.intersects(Flags::ASYNC | Flags::OVERRIDE) {
                return error(1040);
            } else if in_class && on != Modified::Property {
                return error(1031);
            } else if on == Modified::Parameter {
                return error(1090);
            } else if has_private_name {
                return error(18019);
            } else if seen.contains(Flags::ACCESSOR) {
                return error(1243);
            }
        } else if modifier == Flags::ABSTRACT {
            if seen.contains(Flags::ABSTRACT) {
                return error(1030);
            }
            if !matches!(
                on,
                Modified::Method | Modified::Property | Modified::Accessor
            ) {
                return error(1242);
            }
            if !in_abstract_class {
                return error(if on == Modified::Property { 1253 } else { 1244 });
            }
            if seen.intersects(Flags::STATIC | Flags::PRIVATE) {
                return error(1243);
            }
            if seen.contains(Flags::ASYNC) {
                return Some((last_async, 1243));
            }
            if seen.intersects(Flags::OVERRIDE | Flags::ACCESSOR) {
                return error(1029);
            }
            if has_private_name {
                return error(18019);
            }
        } else if modifier == Flags::ASYNC {
            if seen.contains(Flags::ASYNC) {
                return error(1030);
            } else if seen.contains(Flags::AMBIENT) || is_parent_ambient {
                return error(1040);
            } else if on == Modified::Parameter {
                return error(1090);
            }
            if seen.contains(Flags::ABSTRACT) {
                return error(1243);
            }
            last_async = at;
        }
        seen |= modifier;
    }
    if on == Modified::Constructor {
        return if seen.contains(Flags::STATIC) {
            Some((last_static, 1089))
        } else if seen.contains(Flags::OVERRIDE) {
            Some((last_override, 1089))
        } else if seen.contains(Flags::ASYNC) {
            Some((last_async, 1089))
        } else {
            None
        };
    }
    // `checkGrammarAsyncModifier`
    (seen.contains(Flags::ASYNC) && on != Modified::Method).then_some((last_async, 1042))
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
            in_abstract_class: false,
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
        all.sort_by_key(|modifier| modifier.pos);
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

    /// Says what is wrong with `modifiers`, if anything is. `name_pos`: where the name of what they are written on is.
    pub(crate) fn check_modifiers(
        &mut self,
        modifiers: &[(Flags, u32)],
        on: Modified,
        is_parent_ambient: bool,
        has_private_name: bool,
        name_pos: u32,
    ) {
        if let Some((at, code)) = modifier_error(
            modifiers,
            on,
            self.in_abstract_class,
            is_parent_ambient,
            has_private_name,
        ) {
            // 1248 is reported on the declaration, whose error span is its name.
            self.file
                .early_errors
                .push((if code == 1248 { name_pos } else { at }, code));
        }
    }
}
