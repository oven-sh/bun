//! The two syntax trees, compared in one walk from the root.
//!
//! Every field of every node that can be reached is compared, but for ids and positions. So all that
//! is not in the tree is free to change: white space, parentheses that mean nothing, semicolons,
//! the comma after the last element of a list, the separators of the members of a type, the
//! parentheses around the parameter of an arrow function. Parentheses that mean something make
//! another tree.
//!
//! What the formatter changes in the tree is allowed where it is compared, each next to a comment
//! that starts with "Allowed".
//!
//! The parser numbers the nodes of a list in the order of the source. So two trees of the same shape
//! have the same ids, and most trees have the same shape before and after. That is tried first
//! (`Walk::by_id`): the nodes with the same id are compared one after the other, and in place of a walk
//! down to a child its ids are compared. If all are the same, so are the trees. If not, nothing is known,
//! and the trees are walked.

use super::Difference;
use crate::js::utils::number::format_trimmed_number;
use crate::options::FormatOptions;
use bun_lint::ast::{Expr as ExprHandle, File, Handle};
use bun_lint::tokens::skip_trivia;
use bun_sema::atom::{Atom, Intern};
use bun_sema::hir::*;

macro_rules! lists {
    ($($field:ident: $ty:ty,)*) => {
        /// A program: the lists of its `FileIn`, wherever they are stored, and its names.
        pub struct Program<'a> {
            $($field: &'a [$ty],)*
            text: &'a [u8],
            body: IdList<StmtId>,
            atoms: &'a dyn Intern,
            has_syntax_errors: bool,
        }

        impl<'a> Program<'a> {
            /// `text`: what `hir` has been parsed from. `atoms`: what the atoms in `hir` are of.
            pub fn new<S: Storage>(hir: &'a FileIn<S>, text: &'a [u8], atoms: &'a dyn Intern) -> Self {
                Program {
                    $($field: &hir.$field[..],)*
                    text,
                    body: hir.body,
                    atoms,
                    has_syntax_errors: hir.has_errors || hir.has_parse_diagnostics,
                }
            }
        }
    };
}

lists! {
    ids: u32,
    numbers: f64,
    exprs: Expr,
    stmts: Stmt,
    types: TypeNode,
    pats: Pat,
    pat_props: PatProp,
    pat_elems: PatElem,
    fns: Func,
    params: Param,
    type_params: TypeParam,
    classes: Class,
    interfaces: Interface,
    aliases: Alias,
    enums: Enum,
    enum_members: EnumMember,
    modules: Module,
    members: Member,
    props: Prop,
    var_decls: VarDecl,
    calls: Call,
    cases: Case,
    jsx: Jsx,
    imports: Import,
    import_specs: ImportSpec,
    import_equals: ImportEquals,
    exports: Export,
    export_specs: ExportSpec,
    tuple_elems: TupleElem,
    mapped: Mapped,
    modifiers: Modifier,
    names: Name,
    parens: (ExprId, u32, u32),
    non_null_ends: (ExprId, u32),
    jsx_expressions: (ExprId, u32, u32),
    modifiers_of_params: Span<ModifierId>,
    modifiers_of_props: (PropId, Span<ModifierId>),
    with_bodies: (u32, u32),
    import_attributes: (u32, ExprId),
    deferred_import_calls: (ExprId, u32),
    import_call_type_args: (ExprId, IdList<TypeNodeId>),
    comments: (u32, u32),
    diagnostics: Diagnostic,
    specifier_uses: SpecifierUse,
}

impl<'a> Program<'a> {
    #[inline]
    fn ids_of<T>(&self, list: IdList<T>) -> &'a [u32] {
        self.ids.get(list.range()).unwrap_or_default()
    }

    #[inline]
    fn slice(&self, start: u32, end: u32) -> &'a [u8] {
        self.text
            .get(start as usize..end.max(start) as usize)
            .unwrap_or_default()
    }

    fn from(&self, start: u32) -> &'a [u8] {
        self.text.get(start as usize..).unwrap_or_default()
    }

    fn is_parenthesized(&self, e: ExprId) -> bool {
        self.parens.binary_search_by_key(&e.0, |it| it.0.0).is_ok()
    }

    /// Whether `e` is all there is between the braces of a `{e}` in JSX.
    fn is_in_braces(&self, e: ExprId) -> bool {
        self.jsx_expressions
            .binary_search_by_key(&e.0, |it| it.0.0)
            .is_ok()
    }

    /// The end of `e` with the parentheses around it.
    fn outer_end(&self, e: ExprId) -> u32 {
        let after = self.parens.partition_point(|it| it.0.0 <= e.0);
        match after.checked_sub(1).and_then(|last| self.parens.get(last)) {
            Some(outermost) if outermost.0 == e => outermost.2,
            _ => self.exprs.get(e.idx()).map_or(0, |it| it.end),
        }
    }

    fn end_of_last(&self, types: IdList<TypeNodeId>) -> Option<u32> {
        Some(self.types.get(*self.ids_of(types).last()? as usize)?.end)
    }

    /// Where `extends A<B>` ends.
    fn end_of_extends(&self, class: &Class) -> Option<u32> {
        match self.end_of_last(class.extends_args) {
            Some(end) => Some(skip_trivia(self.text, end) + 1),
            None => class.extends.some().map(|it| self.outer_end(it)),
        }
    }

    fn param_modifiers(&self, param: ParamId) -> Span<ModifierId> {
        self.modifiers_of_params
            .get(param.idx())
            .copied()
            .unwrap_or(Span::EMPTY)
    }

    fn prop_modifiers(&self, prop: PropId) -> Span<ModifierId> {
        if self.modifiers_of_props.is_empty() {
            return Span::EMPTY;
        }
        let found = self
            .modifiers_of_props
            .binary_search_by_key(&prop.0, |it| it.0.0);
        found
            .ok()
            .and_then(|at| self.modifiers_of_props.get(at))
            .map_or(Span::EMPTY, |it| it.1)
    }

    fn is_empty_statement(&self, id: u32) -> bool {
        matches!(
            self.stmts.get(id as usize),
            Some(Stmt {
                kind: StmtKind::Empty,
                ..
            })
        )
    }

    /// Whether the statement is a string that is not in parentheses.
    fn is_directive(&self, id: u32) -> bool {
        matches!(self.stmts.get(id as usize), Some(Stmt { kind: StmtKind::Expr(e), .. })
            if matches!(self.exprs.get(e.idx()), Some(Expr { kind: ExprKind::String(_), pos, .. })
                if self.text.get(*pos as usize) != Some(&b'`') && !self.is_parenthesized(*e)))
    }

    fn is_import(&self, id: u32) -> bool {
        matches!(
            self.stmts.get(id as usize),
            Some(Stmt {
                kind: StmtKind::Import(_),
                ..
            })
        )
    }

    /// The operator of `e`, if that is `&&`, `||` or `??`.
    #[inline]
    fn logical_operator(&self, e: ExprId) -> Option<BinOp> {
        match self.exprs.get(e.idx())?.kind {
            ExprKind::Binary {
                op: op @ (BinOp::And | BinOp::Or | BinOp::Nullish),
                ..
            } => Some(op),
            _ => None,
        }
    }

    /// Appends the operands of the chain of `op` that `e` is to `out`, in order: those of
    /// `(a && b) && (c && d)` are `a`, `b`, `c` and `d`.
    fn operands_of_chain(&self, e: ExprId, op: BinOp, out: &mut Vec<ExprId>) {
        // What is not taken apart yet, the last first.
        let mut rest = vec![e];
        while let Some(next) = rest.pop() {
            match self.exprs.get(next.idx()).map(|it| it.kind) {
                Some(ExprKind::Binary {
                    op: it,
                    left,
                    right,
                }) if it == op => rest.extend([right, left]),
                _ => out.push(next),
            }
        }
    }

    /// `ty`, or if that is a union or an intersection of one type, that type.
    fn without_lone_operator(&self, mut ty: TypeNodeId) -> TypeNodeId {
        while let Some(TypeNode {
            kind: TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types),
            ..
        }) = self.types.get(ty.idx())
            && let &[only] = self.ids_of(*types)
        {
            ty = TypeNodeId(only);
        }
        ty
    }
}

/// What is allocated to compare two programs, and used again for the next two.
#[derive(Default)]
pub struct Scratch {
    /// By atom of the program before, the atom of the program after that has the same text.
    atoms: Vec<u32>,
    operands: (Vec<ExprId>, Vec<ExprId>),
    imports: (Vec<u32>, Vec<u32>),
}

/// No atom has been found for it yet.
const UNKNOWN: u32 = u32::MAX - 1;
/// Atoms from here on are compared by their texts every time. The atoms of a file of its own are
/// numbered from 0.
const MOST_ATOMS: usize = 1 << 22;

/// `Err`: a difference has been found, and the walk is over.
type Same = Result<(), ()>;

struct Walk<'a, 'f> {
    /// An expression, a statement, a type or a pattern is the same as the one with the same id, and as no other.
    by_id: bool,
    a: &'a Program<'a>,
    b: &'a Program<'a>,
    /// The program before, for questions about where a node is.
    before: &'f File<'f>,
    scratch: &'a mut Scratch,
    stack: bun_core::StackCheck,
    /// The formatter sorts imports.
    imports_can_move: bool,
    /// The formatter sorts the classes of Tailwind CSS.
    classes_can_move: bool,
    difference: Option<(&'static str, u32, u32)>,
}

/// Whether the same words are in `a` and in `b`, in whatever order and however often.
#[cold]
fn has_same_words(a: &[u8], b: &[u8]) -> bool {
    let words = |text: &[u8]| -> Vec<Vec<u8>> {
        let mut words: Vec<Vec<u8>> = (text.split(u8::is_ascii_whitespace))
            .filter(|word| !word.is_empty())
            .map(<[u8]>::to_vec)
            .collect();
        crate::sort::sort(&mut words[..]);
        words.dedup();
        words
    };
    words(a) == words(b)
}

/// Whether `after`, which is what formatting with `options` has made of `before`, is the same program.
/// `file`: `before`.
pub fn compare<'f>(
    file: &'f File<'f>,
    before: &Program<'_>,
    after: &Program<'_>,
    options: &FormatOptions,
    scratch: &mut Scratch,
) -> Result<(), Difference> {
    if after.has_syntax_errors {
        let at = after.diagnostics.first().map_or(0, |it| it.start);
        return Err(Difference::new(
            "a syntax error",
            (before.text, 0),
            (after.text, at),
        ));
    }
    let imports_can_move = options
        .sort_imports
        .as_deref()
        .is_some_and(|it| it.is_applied_by_format());
    let classes_can_move = options.tailwind.is_some();
    scratch.atoms.clear();
    scratch.operands.0.clear();
    scratch.operands.1.clear();
    scratch.imports.0.clear();
    scratch.imports.1.clear();
    let stack = bun_core::StackCheck::init();
    let mut by_id = Walk {
        by_id: true,
        a: before,
        b: after,
        before: file,
        scratch,
        stack,
        imports_can_move,
        classes_can_move,
        difference: None,
    };
    let is_same_by_id =
        !imports_can_move && by_id.program().and_then(|()| by_id.all_nodes()).is_ok();
    let mut walk = Walk {
        by_id: false,
        a: before,
        b: after,
        before: file,
        scratch,
        stack,
        imports_can_move,
        classes_can_move,
        difference: None,
    };
    match if is_same_by_id {
        Ok(())
    } else {
        walk.program()
    } {
        Ok(()) => super::comments::compare(
            file,
            (before.text, before.comments),
            (after.text, after.comments),
            options.jsdoc.is_some(),
        ),
        Err(()) => {
            let (what, at_before, at_after) =
                walk.difference.unwrap_or(("the programs differ", 0, 0));
            Err(Difference::new(
                what,
                (before.text, at_before),
                (after.text, at_after),
            ))
        }
    }
}

macro_rules! both {
    // The two nodes, if both are there. Returns from the function if neither is, or only one.
    ($self:ident, $list:ident, $a:expr, $b:expr, $what:literal) => {
        match ($self.a.$list.get($a.idx()), $self.b.$list.get($b.idx())) {
            (Some(x), Some(y)) => (*x, *y),
            (None, None) => return Ok(()),
            _ => return $self.differ_somewhere($what),
        }
    };
}

impl Walk<'_, '_> {
    /// Compares each expression, statement, type and pattern with the one that has the same id. With `by_id` only.
    fn all_nodes(&mut self) -> Same {
        let (a, b) = (self.a, self.b);
        let lengths = |it: &Program<'_>| {
            [
                it.exprs.len(),
                it.stmts.len(),
                it.types.len(),
                it.pats.len(),
            ]
        };
        self.check(lengths(a) == lengths(b) && a.ids == b.ids, "")?;
        for (id, (x, y)) in (0..).map(ExprId).zip(a.exprs.iter().zip(b.exprs)) {
            self.expr_kind((id, x), (id, y))?;
        }
        for (x, y) in a.stmts.iter().zip(b.stmts) {
            self.modifiers(x.modifiers, y.modifiers)?;
            self.stmt_kind(x.kind, y.kind)?;
        }
        for (id, (x, y)) in (0..).map(TypeNodeId).zip(a.types.iter().zip(b.types)) {
            self.type_kind((id, x.kind), (id, y.kind))?;
        }
        a.pats
            .iter()
            .zip(b.pats)
            .try_for_each(|(x, y)| self.pat_kind(x.kind, y.kind))
    }
}

impl Walk<'_, '_> {
    #[cold]
    fn differ(&mut self, what: &'static str, before: u32, after: u32) -> Same {
        self.difference = Some((what, before, after));
        Err(())
    }

    #[inline]
    fn is_same_id(a: u32, b: u32) -> Same {
        if a == b { Ok(()) } else { Err(()) }
    }

    /// `Program::ids` are the same.
    #[inline]
    fn is_same_list<T>(a: IdList<T>, b: IdList<T>) -> Same {
        if a.len == b.len && (a.start == b.start || a.len == 0) {
            Ok(())
        } else {
            Err(())
        }
    }

    /// For a difference whose place is not known. The caller that knows one fills it in.
    #[cold]
    fn differ_somewhere(&mut self, what: &'static str) -> Same {
        self.differ(what, u32::MAX, u32::MAX)
    }

    /// `result`, with a place for a difference that has none yet.
    #[inline]
    fn at(&mut self, result: Same, before: u32, after: u32) -> Same {
        if result.is_err() {
            self.set_place(before, after);
        }
        result
    }

    #[cold]
    fn set_place(&mut self, before: u32, after: u32) {
        if let Some(difference) = &mut self.difference {
            if difference.1 == u32::MAX {
                difference.1 = before;
            }
            if difference.2 == u32::MAX {
                difference.2 = after;
            }
        }
    }

    #[inline]
    fn check(&mut self, is_same: bool, what: &'static str) -> Same {
        match is_same {
            true => Ok(()),
            false => self.differ_somewhere(what),
        }
    }

    // ───────────────────────────── names ─────────────────────────────

    /// Each interner has one atom for a text. So the texts of two atoms are compared once.
    #[inline]
    fn is_same_atom(&mut self, a: Atom, b: Atom) -> bool {
        match self.scratch.atoms.get(a.0 as usize) {
            Some(&known) if known == b.0 => true,
            _ => self.is_same_atom_by_text(a, b),
        }
    }

    #[cold]
    #[inline(never)]
    fn is_same_atom_by_text(&mut self, a: Atom, b: Atom) -> bool {
        if a.is_none() || b.is_none() {
            return a == b;
        }
        let (text, text2) = (self.a.atoms.bytes(a), self.b.atoms.bytes(b));
        let is_same = text == text2;
        // Allowed: classes are sorted, and one that is there twice is there once.
        if !is_same && self.classes_can_move {
            return has_same_words(text, text2);
        }
        let (at, known) = (a.0 as usize, &mut self.scratch.atoms);
        if is_same && at < MOST_ATOMS {
            if known.len() <= at {
                known.resize(at + 1, UNKNOWN);
            }
            known[at] = b.0;
        }
        is_same
    }

    /// Whether `b` can be what sorting classes has made of `a`. They have passed for the same.
    #[inline]
    fn is_sorted(&self, a: Atom, b: Atom) -> bool {
        let has_white_space = |text: &[u8]| text.iter().any(u8::is_ascii_whitespace);
        self.classes_can_move
            && (has_white_space(self.a.atoms.bytes(a)) || has_white_space(self.b.atoms.bytes(b)))
    }

    #[inline]
    fn atom(&mut self, a: Atom, b: Atom, what: &'static str) -> Same {
        match self.is_same_atom(a, b) {
            true => Ok(()),
            false => self.differ_somewhere(what),
        }
    }

    fn entity_name(&mut self, a: Span<NameId>, b: Span<NameId>) -> Same {
        let (xs, ys) = (
            self.a.names.get(a.range()).unwrap_or_default(),
            self.b.names.get(b.range()).unwrap_or_default(),
        );
        self.check(xs.len() == ys.len(), "the number of names")?;
        for (x, y) in xs.iter().zip(ys) {
            if !self.is_same_atom(x.text, y.text) {
                return self.differ("a name", x.pos(), y.pos());
            }
        }
        Ok(())
    }

    /// Allowed: a name gets or loses its quotes, and a number is written in another way. The text of
    /// the name is the same then.
    fn name_kind(&mut self, a: NameKind, b: NameKind) -> Same {
        let is_plain = |it| {
            matches!(
                it,
                NameKind::Identifier | NameKind::StringLiteral | NameKind::NumericLiteral
            )
        };
        self.check(a == b || (is_plain(a) && is_plain(b)), "the kind of a name")
    }

    /// `at`: where the keys are.
    fn key(&mut self, a: PropKey, b: PropKey, at: (u32, u32)) -> Same {
        match (a, b) {
            // The tree has no name for a `bigint`.
            (PropKey::None, PropKey::None) => {
                fn word(text: &[u8]) -> &[u8] {
                    let len = text
                        .iter()
                        .take_while(|it| it.is_ascii_alphanumeric() || **it == b'_')
                        .count();
                    text.get(..len).unwrap_or_default()
                }
                let (x, y) = (self.a.from(at.0), self.b.from(at.1));
                let is_number = |text: &[u8]| text.first().is_some_and(u8::is_ascii_digit);
                self.check(
                    (!is_number(x) && !is_number(y)) || word(x).eq_ignore_ascii_case(word(y)),
                    "a key",
                )
            }
            (PropKey::Name(x), PropKey::Name(y)) => {
                self.atom(x, y, "a key")?;
                match self.is_sorted(x, y) {
                    true => Ok(()),
                    false => self.name_as_written(at),
                }
            }
            (PropKey::Private(x), PropKey::Private(y)) => self.atom(x, y, "a key"),
            (PropKey::Computed(x), PropKey::Computed(y)) => self.expr(x, y),
            _ => self.differ_somewhere("the kind of a key"),
        }
    }

    /// Two names with the same text, which can be strings or numbers, at `at`: they are written in the same way,
    /// but for what is allowed for a string and for a number. Allowed: a string without escapes gets or loses
    /// its quotes.
    #[inline]
    fn name_as_written(&mut self, at: (u32, u32)) -> Same {
        let is_plain = |program: &Program<'_>, at: u32| {
            program
                .text
                .get(at as usize)
                .is_some_and(|it| it.is_ascii_alphabetic() || matches!(it, b'_' | b'$'))
        };
        match is_plain(self.a, at.0) && is_plain(self.b, at.1) {
            true => Ok(()),
            false => self.check(
                is_literal_name_same((self.a, at.0), (self.b, at.1)),
                "how a key is written",
            ),
        }
    }

    /// Allowed: the keywords that are next to each other are put in order, but for `export`, `default`,
    /// `async` and `accessor`, which stay where they are, as decorators do.
    fn modifiers(&mut self, a: Span<ModifierId>, b: Span<ModifierId>) -> Same {
        if a.is_empty() && b.is_empty() {
            return Ok(());
        }
        const STAY: Flags = Flags::EXPORT
            .union(Flags::DEFAULT)
            .union(Flags::ASYNC)
            .union(Flags::ACCESSOR);
        /// Takes the keywords that `list` starts with and that can be put in order.
        fn take_keywords(list: &mut &[Modifier]) -> Flags {
            let mut all = Flags::empty();
            while let [
                Modifier {
                    kind: ModifierKind::Keyword(keyword),
                    ..
                },
                rest @ ..,
            ] = list
                && !keyword.intersects(STAY)
            {
                all |= *keyword;
                *list = rest;
            }
            all
        }
        let mut xs = self.a.modifiers.get(a.range()).unwrap_or_default();
        let mut ys = self.b.modifiers.get(b.range()).unwrap_or_default();
        self.check(xs.len() == ys.len(), "the number of modifiers")?;
        loop {
            self.check(
                take_keywords(&mut xs) == take_keywords(&mut ys),
                "the modifiers",
            )?;
            match (xs.split_first(), ys.split_first()) {
                (Some((x, rest)), Some((y, rest2))) => {
                    match (x.kind, y.kind) {
                        (ModifierKind::Decorator(x), ModifierKind::Decorator(y)) => {
                            self.expr(x, y)?
                        }
                        (x, y) => self.check(x == y, "the modifiers")?,
                    }
                    (xs, ys) = (rest, rest2);
                }
                (None, None) => return Ok(()),
                _ => return self.differ_somewhere("the modifiers"),
            }
        }
    }

    // ───────────────────────────── the program ─────────────────────────────

    fn program(&mut self) -> Same {
        let (a, b) = (self.a, self.b);
        self.diagnostics()?;
        self.body(a.body, b.body)?;
        self.check(
            a.with_bodies.len() == b.with_bodies.len(),
            "the number of `with` statements",
        )?;
        self.module_specifiers()?;
        if self.imports_can_move {
            return self.moved_imports();
        }
        self.check(
            a.import_attributes.len() == b.import_attributes.len(),
            "the number of import attributes",
        )?;
        for (x, y) in a.import_attributes.iter().zip(b.import_attributes) {
            self.import_attributes(*x, *y)?;
        }
        Ok(())
    }

    /// What the parser accepts and has something to say about, like the comma in `f<A,>()`, is not in the
    /// tree. Allowed: there is less of it.
    fn diagnostics(&mut self) -> Same {
        if self.b.diagnostics.is_empty() {
            return Ok(());
        }
        const TRAILING_COMMA_NOT_ALLOWED: u32 = 1009;
        // Allowed: a comma after the last element of a list in brackets. Flow has it where TypeScript does not.
        let is_before_closing_bracket = |comma: u32| {
            matches!(
                self.b
                    .text
                    .get(skip_trivia(self.b.text, comma + 1) as usize),
                Some(b')' | b']' | b'}' | b'>')
            )
        };
        let mut before: Vec<u32> = self.a.diagnostics.iter().map(|it| it.code).collect();
        for diagnostic in self.b.diagnostics {
            match before.iter().position(|&code| code == diagnostic.code) {
                Some(at) => _ = before.swap_remove(at),
                None if diagnostic.code == TRAILING_COMMA_NOT_ALLOWED
                    && is_before_closing_bracket(diagnostic.start) => {}
                None => return self.differ("what the parser says", 0, diagnostic.start),
            }
        }
        Ok(())
    }

    /// The values of module specifiers are in the tree. Here they are compared as they are written.
    fn module_specifiers(&mut self) -> Same {
        if self.imports_can_move {
            return Ok(());
        }
        // What the parser reads twice is listed twice, and not where it is.
        let places = |program: &Program<'_>| {
            let mut places: Vec<u32> = program.specifier_uses.iter().map(|it| it.pos).collect();
            crate::sort::sort(&mut places[..]);
            places.dedup();
            places
        };
        for (x, y) in places(self.a).into_iter().zip(places(self.b)) {
            if let (Some(p), Some(q)) = (
                string_at_start(self.a.from(x)),
                string_at_start(self.b.from(y)),
            ) && !is_same_string(p, q)
            {
                return self.differ("how a string is written", x, y);
            }
        }
        Ok(())
    }

    /// `with { .. }`, `assert { .. }`
    fn import_attributes(&mut self, a: (u32, ExprId), b: (u32, ExprId)) -> Same {
        fn keyword(text: &[u8]) -> &[u8] {
            text.get(
                ..text
                    .iter()
                    .take_while(|it| it.is_ascii_alphabetic())
                    .count(),
            )
            .unwrap_or_default()
        }
        if keyword(self.a.from(a.0)) != keyword(self.b.from(b.0)) {
            return self.differ("the keyword of import attributes", a.0, b.0);
        }
        self.expr(a.1, b.1)
    }

    /// Allowed, if the formatter sorts imports: they, and the names in them, are in another order.
    fn moved_imports(&mut self) -> Same {
        let sorted = |program: &Program<'_>, ids: &[u32]| {
            let mut all: Vec<_> = ids.iter().map(|&id| import_as_text(program, id)).collect();
            crate::sort::sort_by(&mut all[..], |x, y| x.0.cmp(&y.0));
            all
        };
        let (xs, ys) = (
            sorted(self.a, &self.scratch.imports.0),
            sorted(self.b, &self.scratch.imports.1),
        );
        if !xs.iter().map(|it| &it.0).eq(ys.iter().map(|it| &it.0)) {
            return self.differ("the imports", 0, 0);
        }
        // The attributes of exports and of import types stay where they are.
        let others = |program: &Program<'_>,
                      imports: &[(Vec<u8>, Option<(u32, ExprId)>)]|
         -> Vec<Option<(u32, ExprId)>> {
            (program.import_attributes.iter().map(|&it| Some(it)))
                .filter(|it| !imports.iter().any(|import| import.1 == *it))
                .collect()
        };
        let (more, more2) = (others(self.a, &xs), others(self.b, &ys));
        self.check(more.len() == more2.len(), "the number of import attributes")?;
        for pair in xs
            .iter()
            .map(|it| it.1)
            .zip(ys.iter().map(|it| it.1))
            .chain(more.into_iter().zip(more2))
        {
            match pair {
                (Some(x), Some(y)) => self.import_attributes(x, y)?,
                (None, None) => {}
                _ => return self.differ("the attributes of an import", 0, 0),
            }
        }
        Ok(())
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// The statements of a program or of a function, which start with its directives.
    fn body(&mut self, a: IdList<StmtId>, b: IdList<StmtId>) -> Same {
        let directives = |program: &Program<'_>, list| {
            program
                .ids_of(list)
                .iter()
                .take_while(|&&it| program.is_directive(it))
                .count()
        };
        self.check(
            directives(self.a, a) == directives(self.b, b),
            "the number of directives",
        )?;
        self.stmt_list(a, b)
    }

    /// Allowed: empty statements in a list are left out.
    #[inline]
    fn stmt_list(&mut self, a: IdList<StmtId>, b: IdList<StmtId>) -> Same {
        match self.by_id {
            true => Self::is_same_list(a, b),
            false => self.stmt_list_in_depth(a, b),
        }
    }

    fn stmt_list_in_depth(&mut self, a: IdList<StmtId>, b: IdList<StmtId>) -> Same {
        let (xs, ys) = (self.a.ids_of(a), self.b.ids_of(b));
        let (mut i, mut j) = (0, 0);
        loop {
            while let Some(&x) = xs.get(i)
                && (self.a.is_empty_statement(x) || (self.imports_can_move && self.a.is_import(x)))
            {
                if self.a.is_import(x) {
                    self.scratch.imports.0.push(x);
                }
                i += 1;
            }
            while let Some(&y) = ys.get(j)
                && (self.b.is_empty_statement(y) || (self.imports_can_move && self.b.is_import(y)))
            {
                if self.b.is_import(y) {
                    self.scratch.imports.1.push(y);
                }
                j += 1;
            }
            match (xs.get(i), ys.get(j)) {
                (Some(&x), Some(&y)) => self.stmt(StmtId(x), StmtId(y))?,
                (None, None) => return Ok(()),
                (x, y) => {
                    let start = |program: &Program<'_>, id: Option<&u32>| {
                        id.and_then(|&id| program.stmts.get(id as usize))
                            .map_or(program.text.len() as u32, |it| it.start)
                    };
                    let (before, after) = (start(self.a, x), start(self.b, y));
                    return self.differ("the number of statements", before, after);
                }
            }
            i += 1;
            j += 1;
        }
    }

    #[inline]
    fn stmt(&mut self, a: StmtId, b: StmtId) -> Same {
        match self.by_id {
            true => Self::is_same_id(a.0, b.0),
            false => self.stmt_in_depth(a, b),
        }
    }

    fn stmt_in_depth(&mut self, a: StmtId, b: StmtId) -> Same {
        let (x, y) = both!(self, stmts, a, b, "a statement is missing");
        if !self.stack.is_safe_to_recurse() {
            return self.differ(
                "the code is nested too deeply to compare it",
                x.start,
                y.start,
            );
        }
        let result = self
            .modifiers(x.modifiers, y.modifiers)
            .and_then(|()| self.stmt_kind(x.kind, y.kind));
        self.at(result, x.start, y.start)
    }

    fn stmt_kind(&mut self, x: StmtKind, y: StmtKind) -> Same {
        use StmtKind::*;
        match (x, y) {
            (Empty, Empty) | (Debugger, Debugger) => Ok(()),
            (Expr(x), Expr(y))
            | (Return(x), Return(y))
            | (Throw(x), Throw(y))
            | (ExportDefault(x), ExportDefault(y))
            | (ExportAssign(x), ExportAssign(y)) => self.expr(x, y),
            (Var(x), Var(y)) => {
                self.check(x.len() == y.len(), "the number of declarations")?;
                // The keyword is a property of what is declared.
                self.check(!x.is_empty(), "a declaration of nothing")?;
                x.iter()
                    .zip(y.iter())
                    .try_for_each(|(x, y)| self.var_decl(x, y))?;
                let last = y
                    .iter()
                    .next_back()
                    .and_then(|last| self.b.var_decls.get(last.idx()));
                self.no_comma_follows(last.map(|it| it.loc.end))
            }
            (Fn(x), Fn(y)) => self.func(x, y),
            (Class(x), Class(y)) => self.class(x, y),
            (Interface(x), Interface(y)) => {
                let (i, j) = both!(self, interfaces, x, y, "an interface is missing");
                self.atom(i.name, j.name, "the name of an interface")?;
                self.check(i.flags == j.flags, "the modifiers of an interface")?;
                self.type_params(i.type_params, j.type_params)?;
                self.type_list(i.extends, j.extends)?;
                self.type_list(i.other_heritage, j.other_heritage)?;
                self.no_comma_follows(self.b.end_of_last(j.extends))?;
                self.members(i.members, j.members)
            }
            (TypeAlias(x), TypeAlias(y)) => {
                let (i, j) = both!(self, aliases, x, y, "a type alias is missing");
                self.atom(i.name, j.name, "the name of a type alias")?;
                self.check(i.flags == j.flags, "the modifiers of a type alias")?;
                self.type_params(i.type_params, j.type_params)?;
                self.ty(i.ty, j.ty)
            }
            (Enum(x), Enum(y)) => {
                let (i, j) = both!(self, enums, x, y, "an enum is missing");
                self.atom(i.name, j.name, "the name of an enum")?;
                self.check(i.flags == j.flags, "the modifiers of an enum")?;
                self.check(
                    i.members.len() == j.members.len(),
                    "the number of members of an enum",
                )?;
                for (m, n) in i.members.iter().zip(j.members.iter()) {
                    let (m, n) = both!(self, enum_members, m, n, "a member of an enum is missing");
                    let result = (self.atom(m.name, n.name, "the name of a member of an enum"))
                        .and_then(|()| self.name_as_written((m.pos, n.pos)))
                        .and_then(|()| self.name_kind(m.name_kind, n.name_kind))
                        .and_then(|()| self.expr(m.computed_name, n.computed_name))
                        .and_then(|()| self.expr(m.init, n.init));
                    self.at(result, m.pos, n.pos)?;
                }
                Ok(())
            }
            (Module(x), Module(y)) => {
                let (i, j) = both!(self, modules, x, y, "a namespace is missing");
                match (i.name, j.name) {
                    (ModuleName::Ident(x), ModuleName::Ident(y))
                    | (ModuleName::String(x), ModuleName::String(y)) => {
                        self.atom(x, y, "the name of a namespace")?;
                        self.name_as_written((i.name_pos, j.name_pos))?;
                    }
                    (ModuleName::Global, ModuleName::Global) => {}
                    _ => return self.differ_somewhere("the kind of a namespace"),
                }
                let is_same = (i.flags, i.has_body, i.specifies_module)
                    == (j.flags, j.has_body, j.specifies_module);
                self.check(is_same, "the keywords of a namespace")?;
                self.stmt_list(i.body, j.body)
            }
            (
                If { test, yes, no },
                If {
                    test: test2,
                    yes: yes2,
                    no: no2,
                },
            ) => {
                self.expr(test, test2)?;
                self.stmt(yes, yes2)?;
                self.stmt(no, no2)
            }
            (
                For {
                    init,
                    test,
                    update,
                    body,
                },
                For {
                    init: init2,
                    test: test2,
                    update: update2,
                    body: body2,
                },
            ) => {
                self.stmt(init, init2)?;
                self.expr(test, test2)?;
                self.expr(update, update2)?;
                self.stmt(body, body2)
            }
            (
                ForIn { left, expr, body },
                ForIn {
                    left: left2,
                    expr: expr2,
                    body: body2,
                },
            ) => {
                self.stmt(left, left2)?;
                self.expr(expr, expr2)?;
                self.stmt(body, body2)
            }
            (
                ForOf {
                    left,
                    expr,
                    body,
                    is_await,
                },
                ForOf {
                    left: left2,
                    expr: expr2,
                    body: body2,
                    is_await: is_await2,
                },
            ) => {
                self.check(is_await == is_await2, "`await` after `for`")?;
                // The parser says nothing about `for (async of a)`, which takes parentheses around the name.
                let is_bare_async = matches!(self.b.stmts.get(left2.idx()), Some(Stmt { kind: Expr(e), .. })
                    if matches!(self.b.exprs.get(e.idx()), Some(it) if self.b.slice(it.pos, it.end) == b"async") && !self.b.is_parenthesized(*e));
                self.check(
                    is_await2 || !is_bare_async,
                    "the parentheses around `async`",
                )?;
                self.stmt(left, left2)?;
                self.expr(expr, expr2)?;
                self.stmt(body, body2)
            }
            (
                While { test, body },
                While {
                    test: test2,
                    body: body2,
                },
            )
            | (
                DoWhile { test, body },
                DoWhile {
                    test: test2,
                    body: body2,
                },
            ) => {
                self.expr(test, test2)?;
                self.stmt(body, body2)
            }
            (Block(x), Block(y)) => self.stmt_list(x, y),
            (
                Switch { expr, cases },
                Switch {
                    expr: expr2,
                    cases: cases2,
                },
            ) => {
                self.expr(expr, expr2)?;
                self.check(cases.len() == cases2.len(), "the number of cases")?;
                for (c, d) in cases.iter().zip(cases2.iter()) {
                    let (c, d) = both!(self, cases, c, d, "a case is missing");
                    let result = self
                        .expr(c.test, d.test)
                        .and_then(|()| self.stmt_list(c.body, d.body));
                    self.at(result, c.pos, d.pos)?;
                }
                Ok(())
            }
            (
                Try {
                    block,
                    param,
                    handler,
                    finalizer,
                },
                Try {
                    block: block2,
                    param: param2,
                    handler: handler2,
                    finalizer: finalizer2,
                },
            ) => {
                self.stmt(block, block2)?;
                self.var_decl(param, param2)?;
                self.stmt(handler, handler2)?;
                self.stmt(finalizer, finalizer2)
            }
            (Break(x), Break(y)) | (Continue(x), Continue(y)) => self.atom(x, y, "a label"),
            (ExportAsNamespace(x), ExportAsNamespace(y)) => {
                self.atom(x, y, "the name of a namespace")
            }
            (
                Labeled { label, body },
                Labeled {
                    label: label2,
                    body: body2,
                },
            ) => {
                self.atom(label, label2, "a label")?;
                self.stmt(body, body2)
            }
            (Import(x), Import(y)) => {
                let (i, j) = both!(self, imports, x, y, "an import is missing");
                self.atom(i.spec, j.spec, "a module specifier")?;
                self.atom(i.default, j.default, "the name of a default import")?;
                self.atom(i.namespace, j.namespace, "the name of a namespace import")?;
                let is_same =
                    (i.type_only, i.is_deferred, i.mode) == (j.type_only, j.is_deferred, j.mode);
                self.check(is_same, "the keywords of an import")?;
                // Allowed: `import a, {} from "a"` is `import a from "a"`.
                let has_braces = |it: &bun_sema::hir::Import| {
                    it.has_named_imports
                        && !(it.named.is_empty()
                            && (it.default.is_some() || it.namespace.is_some()))
                };
                self.check(has_braces(&i) == has_braces(&j), "the braces of an import")?;
                self.check(
                    i.named.len() == j.named.len(),
                    "the number of names of an import",
                )?;
                for (s, t) in i.named.iter().zip(j.named.iter()) {
                    let (s, t) = both!(self, import_specs, s, t, "a name of an import is missing");
                    let is_same = self.is_same_atom(s.imported, t.imported)
                        && self.is_same_atom(s.local, t.local)
                        && s.type_only == t.type_only;
                    if !is_same {
                        return self.differ("a name of an import", s.start, t.start);
                    }
                    self.name_as_written((s.imported_pos, t.imported_pos))?;
                }
                Ok(())
            }
            (ImportEquals(x), ImportEquals(y)) => {
                let (i, j) = both!(self, import_equals, x, y, "an import is missing");
                self.atom(i.name, j.name, "the name of an import")?;
                self.check(i.flags == j.flags, "the modifiers of an import")?;
                self.expr(i.expression, j.expression)?;
                match (i.target, j.target) {
                    (ImportEqualsTarget::Require(x), ImportEqualsTarget::Require(y)) => {
                        self.atom(x, y, "a module specifier")
                    }
                    (ImportEqualsTarget::Entity(x), ImportEqualsTarget::Entity(y)) => {
                        self.entity_name(x, y)
                    }
                    _ => self.differ_somewhere("what is imported"),
                }
            }
            (ExportNamed(x), ExportNamed(y)) => {
                let (i, j) = both!(self, exports, x, y, "an export is missing");
                self.atom(i.spec, j.spec, "a module specifier")?;
                let is_same = (i.has_module_specifier, i.type_only, i.mode)
                    == (j.has_module_specifier, j.type_only, j.mode);
                self.check(is_same, "the keywords of an export")?;
                self.check(
                    i.items.len() == j.items.len(),
                    "the number of names of an export",
                )?;
                for (s, t) in i.items.iter().zip(j.items.iter()) {
                    let (s, t) = both!(self, export_specs, s, t, "a name of an export is missing");
                    let is_same = self.is_same_atom(s.local, t.local)
                        && self.is_same_atom(s.exported, t.exported)
                        && s.type_only == t.type_only;
                    if !is_same {
                        return self.differ("a name of an export", s.start, t.start);
                    }
                    self.name_as_written((s.local_pos, t.local_pos))?;
                    self.name_as_written((s.pos, t.pos))?;
                }
                Ok(())
            }
            (
                ExportStar {
                    spec,
                    alias,
                    type_only,
                    mode,
                    alias_pos,
                    ..
                },
                ExportStar {
                    spec: spec2,
                    alias: alias2,
                    type_only: type_only2,
                    mode: mode2,
                    alias_pos: alias_pos2,
                    ..
                },
            ) => {
                self.atom(spec, spec2, "a module specifier")?;
                self.atom(alias, alias2, "the name of an export")?;
                if alias.is_some() {
                    self.name_as_written((alias_pos, alias_pos2))?;
                }
                self.check(
                    (type_only, mode) == (type_only2, mode2),
                    "the keywords of an export",
                )
            }
            _ => self.differ_somewhere("the kind of a statement"),
        }
    }

    /// The parser says nothing about a comma after the last element of a list that must not end with
    /// one: `let a,`, `class A extends B, {}`. `end`: where the last element ends in the program after.
    fn no_comma_follows(&mut self, end: Option<u32>) -> Same {
        match end.map(|end| skip_trivia(self.b.text, end)) {
            Some(next) if self.b.text.get(next as usize) == Some(&b',') => {
                self.differ("a comma", u32::MAX, next)
            }
            _ => Ok(()),
        }
    }

    fn var_decl(&mut self, a: VarDeclId, b: VarDeclId) -> Same {
        let (x, y) = both!(self, var_decls, a, b, "a declaration is missing");
        self.check(
            (x.kind, x.flags) == (y.kind, y.flags),
            "the keyword of a declaration",
        )?;
        self.pat(x.pat, y.pat)?;
        self.ty(x.ty, y.ty)?;
        self.expr(x.init, y.init)
    }

    // ───────────────────────────── patterns ─────────────────────────────

    #[inline]
    fn pat(&mut self, a: PatId, b: PatId) -> Same {
        match self.by_id {
            true => Self::is_same_id(a.0, b.0),
            false => self.pat_in_depth(a, b),
        }
    }

    fn pat_in_depth(&mut self, a: PatId, b: PatId) -> Same {
        let (x, y) = both!(self, pats, a, b, "a pattern is missing");
        let result = self.pat_kind(x.kind, y.kind);
        self.at(result, x.pos, y.pos)
    }

    fn pat_kind(&mut self, x: PatKind, y: PatKind) -> Same {
        match (x, y) {
            (PatKind::Missing, PatKind::Missing) => Ok(()),
            (PatKind::Ident(x), PatKind::Ident(y)) => self.atom(x, y, "a name"),
            (PatKind::Object(x), PatKind::Object(y)) => self.pat_props(x, y),
            (PatKind::Array(x), PatKind::Array(y)) => self.pat_elems(x, y),
            _ => self.differ_somewhere("the kind of a pattern"),
        }
    }

    fn pat_props(&mut self, a: Span<PatPropId>, b: Span<PatPropId>) -> Same {
        self.check(a.len() == b.len(), "the number of properties of a pattern")?;
        for (p, q) in a.iter().zip(b.iter()) {
            let (p, q) = both!(self, pat_props, p, q, "a property of a pattern is missing");
            // `{ a }` and `{ a: a }` are the same tree.
            let is_shorthand = |program: &Program<'_>, it: &PatProp| {
                program
                    .pats
                    .get(it.value.idx())
                    .is_some_and(|value| value.pos == it.key_pos)
            };
            let is_same =
                p.is_rest == q.is_rest && is_shorthand(self.a, &p) == is_shorthand(self.b, &q);
            let result = (self.check(is_same, "the form of a property of a pattern"))
                .and_then(|()| self.name_kind(p.name_kind, q.name_kind))
                .and_then(|()| self.key(p.key, q.key, (p.key_pos, q.key_pos)))
                .and_then(|()| self.pat(p.value, q.value))
                .and_then(|()| self.expr(p.default, q.default));
            self.at(result, p.pos, q.pos)?;
        }
        Ok(())
    }

    fn pat_elems(&mut self, a: Span<PatElemId>, b: Span<PatElemId>) -> Same {
        self.check(a.len() == b.len(), "the number of elements of a pattern")?;
        for (p, q) in a.iter().zip(b.iter()) {
            let (p, q) = both!(self, pat_elems, p, q, "an element of a pattern is missing");
            self.check(
                p.is_rest == q.is_rest,
                "the `...` of an element of a pattern",
            )?;
            self.pat(p.pat, q.pat)?;
            self.expr(p.default, q.default)?;
        }
        Ok(())
    }

    // ───────────────────────────── functions and classes ─────────────────────────────

    fn type_params(&mut self, a: Span<TypeParamId>, b: Span<TypeParamId>) -> Same {
        self.check(a.len() == b.len(), "the number of type parameters")?;
        a.iter()
            .zip(b.iter())
            .try_for_each(|(x, y)| self.type_param(x, y))
    }

    fn type_param(&mut self, a: TypeParamId, b: TypeParamId) -> Same {
        let (x, y) = both!(self, type_params, a, b, "a type parameter is missing");
        let result = (self.atom(x.name, y.name, "the name of a type parameter"))
            .and_then(|()| self.check(x.flags == y.flags, "the modifiers of a type parameter"))
            .and_then(|()| self.modifiers(x.modifiers, y.modifiers))
            .and_then(|()| self.ty(x.constraint, y.constraint))
            .and_then(|()| self.ty(x.default, y.default));
        self.at(result, x.start, y.start)
    }

    fn param(&mut self, a: ParamId, b: ParamId) -> Same {
        let (x, y) = both!(self, params, a, b, "a parameter is missing");
        let result = (self.check(x.flags == y.flags, "the modifiers of a parameter"))
            .and_then(|()| self.modifiers(self.a.param_modifiers(a), self.b.param_modifiers(b)))
            .and_then(|()| self.pat(x.pat, y.pat))
            .and_then(|()| self.ty(x.ty, y.ty))
            .and_then(|()| self.expr(x.default, y.default));
        self.at(result, x.pos, y.pos)
    }

    fn func(&mut self, a: FnId, b: FnId) -> Same {
        let (x, y) = both!(self, fns, a, b, "a function is missing");
        let result = self.func_parts(&x, &y);
        self.at(result, x.start, y.start)
    }

    fn func_parts(&mut self, x: &Func, y: &Func) -> Same {
        self.check(
            (function_kind(x), without_name_kind(x.flags))
                == (function_kind(y), without_name_kind(y.flags)),
            "the kind of a function",
        )?;
        self.atom(x.name, y.name, "the name of a function")?;
        self.type_params(x.type_params, y.type_params)?;
        self.param(x.this_param, y.this_param)?;
        self.check(x.params.len() == y.params.len(), "the number of parameters")?;
        (x.params.iter().zip(y.params.iter())).try_for_each(|(x, y)| self.param(x, y))?;
        self.ty(x.ret, y.ret)?;
        match (x.body, y.body) {
            (FnBody::None, FnBody::None) => Ok(()),
            (FnBody::Block(x), FnBody::Block(y)) => self.body(x, y),
            (FnBody::Expr(x), FnBody::Expr(y)) => self.expr(x, y),
            _ => self.differ_somewhere("the kind of the body of a function"),
        }
    }

    fn members(&mut self, a: Span<MemberId>, b: Span<MemberId>) -> Same {
        self.check(a.len() == b.len(), "the number of members")?;
        a.iter()
            .zip(b.iter())
            .try_for_each(|(x, y)| self.member(x, y))
    }

    fn member(&mut self, a: MemberId, b: MemberId) -> Same {
        let (x, y) = both!(self, members, a, b, "a member is missing");
        let form = |it: &Member, program: &Program<'_>| {
            let is_constructor = it.kind == MemberKind::Constructor
                || (it.kind == MemberKind::Method
                    && program
                        .fns
                        .get(it.func.idx())
                        .is_some_and(|it| function_kind(it) == FnKind::Constructor));
            (
                if is_constructor {
                    MemberKind::Constructor
                } else {
                    it.kind
                },
                without_name_kind(it.flags),
            )
        };
        let result = (self.check(form(&x, self.a) == form(&y, self.b), "the kind of a member"))
            .and_then(|()| self.key(x.key, y.key, (x.name_pos, y.name_pos)))
            .and_then(|()| self.modifiers(x.modifiers, y.modifiers))
            .and_then(|()| self.func(x.func, y.func))
            // That of an index signature is the return type of its function.
            .and_then(|()| match x.kind {
                MemberKind::IndexSignature => Ok(()),
                _ => self.ty(x.ty, y.ty),
            })
            .and_then(|()| self.expr(x.init, y.init));
        self.at(result, x.start, y.start)
    }

    fn class(&mut self, a: ClassId, b: ClassId) -> Same {
        let (x, y) = both!(self, classes, a, b, "a class is missing");
        let result = (self.atom(x.name, y.name, "the name of a class"))
            .and_then(|()| self.check(x.flags == y.flags, "the modifiers of a class"))
            .and_then(|()| self.modifiers(x.modifiers, y.modifiers))
            .and_then(|()| self.type_params(x.type_params, y.type_params))
            .and_then(|()| self.expr(x.extends, y.extends))
            .and_then(|()| self.type_list(x.extends_args, y.extends_args))
            .and_then(|()| self.expr_list(x.other_extends, y.other_extends))
            .and_then(|()| self.type_list(x.implements, y.implements))
            .and_then(|()| self.type_list(x.other_implements, y.other_implements))
            .and_then(|()| self.no_comma_follows(self.b.end_of_last(y.implements)))
            .and_then(|()| self.no_comma_follows(self.b.end_of_extends(&y)))
            .and_then(|()| self.members(x.members, y.members))
            .and_then(|()| self.no_member_ends_with_a_comma(y.members));
        self.at(result, x.start, y.start)
    }

    /// The parser says nothing about `[a: string]: B,` in a class either. `members`: those of a class in the
    /// program after.
    fn no_member_ends_with_a_comma(&mut self, members: Span<MemberId>) -> Same {
        let ends_with_a_comma = |it: &&Member| {
            it.kind == MemberKind::IndexSignature
                && it
                    .loc
                    .end
                    .checked_sub(1)
                    .and_then(|last| self.b.text.get(last as usize))
                    == Some(&b',')
        };
        match self
            .b
            .members
            .get(members.range())
            .unwrap_or_default()
            .iter()
            .find(ends_with_a_comma)
        {
            Some(member) => self.differ("a comma", u32::MAX, member.loc.end - 1),
            None => Ok(()),
        }
    }

    // ───────────────────────────── expressions ─────────────────────────────

    #[inline]
    fn expr_list(&mut self, a: IdList<ExprId>, b: IdList<ExprId>) -> Same {
        match self.by_id {
            true => Self::is_same_list(a, b),
            false => self.expr_list_in_depth(a, b),
        }
    }

    fn expr_list_in_depth(&mut self, a: IdList<ExprId>, b: IdList<ExprId>) -> Same {
        let (xs, ys) = (self.a.ids_of(a), self.b.ids_of(b));
        self.check(xs.len() == ys.len(), "the number of expressions in a list")?;
        xs.iter()
            .zip(ys)
            .try_for_each(|(&x, &y)| self.expr(ExprId(x), ExprId(y)))
    }

    fn props(&mut self, a: Span<PropId>, b: Span<PropId>) -> Same {
        self.check(a.len() == b.len(), "the number of properties")?;
        for (p, q) in a.iter().zip(b.iter()) {
            let (x, y) = both!(self, props, p, q, "a property is missing");
            let is_same = x.kind == y.kind && (x.postfix_token == 0) == (y.postfix_token == 0);
            let result = (self.check(is_same, "the kind of a property"))
                .and_then(|()| self.name_kind(x.name_kind, y.name_kind))
                .and_then(|()| match x.kind {
                    PropKind::Spread => Ok(()),
                    _ => self.key(x.key, y.key, (x.pos, y.pos)),
                })
                .and_then(|()| self.modifiers(self.a.prop_modifiers(p), self.b.prop_modifiers(q)))
                .and_then(|()| match x.name_kind {
                    NameKind::Jsx => self.jsx_attribute_value(x.value, y.value),
                    _ => self.expr(x.value, y.value),
                });
            self.at(result, x.start, y.start)?;
        }
        Ok(())
    }

    fn call(&mut self, a: CallId, b: CallId) -> Same {
        let (x, y) = both!(self, calls, a, b, "a call is missing");
        self.check(x.chain == y.chain, "the `?.` of a call")?;
        self.expr(x.callee, y.callee)?;
        self.type_list(x.type_args, y.type_args)?;
        // Allowed: `new A` is `new A()`.
        self.expr_list(x.args, y.args)
    }

    #[inline]
    fn expr(&mut self, a: ExprId, b: ExprId) -> Same {
        match self.by_id {
            true => Self::is_same_id(a.0, b.0),
            false => self.expr_in_depth(a, b),
        }
    }

    fn expr_in_depth(&mut self, a: ExprId, b: ExprId) -> Same {
        let (x, y) = both!(self, exprs, a, b, "an expression is missing");
        let result = self.expr_kind((a, &x), (b, &y));
        self.at(result, x.pos, y.pos)
    }

    #[inline]
    fn expr_kind(&mut self, (a, x): (ExprId, &Expr), (b, y): (ExprId, &Expr)) -> Same {
        use ExprKind::*;
        match (x.kind, y.kind) {
            (Ident(x), Ident(y))
            | (PrivateIdentifier(x), PrivateIdentifier(y))
            | (NewTarget(x), NewTarget(y)) => self.atom(x, y, "a name"),
            (
                Dot {
                    obj, name, chain, ..
                },
                Dot {
                    obj: obj2,
                    name: name2,
                    chain: chain2,
                    ..
                },
            ) => {
                self.check(chain == chain2, "the `?.` of a member access")?;
                self.atom(name, name2, "the name of a member")?;
                self.nested(obj, obj2)
            }
            (Call(x), Call(y)) | (New(x), New(y)) => {
                self.has_stack_left()?;
                self.call(x, y)
            }
            (Missing, Missing)
            | (This, This)
            | (Super, Super)
            | (Null, Null)
            | (True, True)
            | (False, False)
            | (ImportMeta, ImportMeta) => Ok(()),
            // Allowed: see `is_same_string`.
            (String(p), String(q)) => {
                let is_template =
                    |program: &Program<'_>, at: u32| program.text.get(at as usize) == Some(&b'`');
                let is_a_template = is_template(self.a, x.pos);
                self.check(
                    is_a_template == is_template(self.b, y.pos),
                    "the quotes of a template",
                )?;
                match is_a_template {
                    // It can be text in JSX that starts with a `` ` ``.
                    true if self.by_id => self
                        .atom(p, q, "a string")
                        .and_then(|()| self.template((a, x, IdList::EMPTY), (y, IdList::EMPTY))),
                    true => self.template((a, x, IdList::EMPTY), (y, IdList::EMPTY)),
                    false => {
                        self.atom(p, q, "a string")?;
                        self.check(
                            is_same_string(self.a.slice(x.pos, x.end), self.b.slice(y.pos, y.end))
                                || self.is_sorted(p, q),
                            "how a string is written",
                        )
                    }
                }
            }
            // Allowed: see `is_same_number`.
            (Number(p), Number(q)) => {
                self.number(p, q)?;
                self.check(
                    is_same_number(self.a.slice(x.pos, x.end), self.b.slice(y.pos, y.end)),
                    "how a number is written",
                )
            }
            // Allowed: lower case.
            (BigInt(x), BigInt(y)) => self.bigint(x, y),
            (Regex, Regex) => self.regex(self.a.slice(x.pos, x.end), self.b.slice(y.pos, y.end)),
            (Template { exprs: p }, Template { exprs: q }) => self.template((a, x, p), (y, q)),
            (TaggedTemplate(x), TaggedTemplate(y)) => {
                let (x, y) = both!(self, calls, x, y, "a call is missing");
                self.expr(x.callee, y.callee)?;
                self.type_list(x.type_args, y.type_args)?;
                // Its substitutions are the arguments.
                self.expr(x.template, y.template)
            }
            (Array(x), Array(y)) => {
                self.has_stack_left()?;
                self.expr_list(x, y)
            }
            (Object(x), Object(y)) => {
                self.has_stack_left()?;
                self.props(x, y)
            }
            (Fn(x), Fn(y)) => self.func(x, y),
            (Class(x), Class(y)) => self.class(x, y),
            (
                Index { obj, index, chain },
                Index {
                    obj: obj2,
                    index: index2,
                    chain: chain2,
                },
            ) => {
                self.check(chain == chain2, "the `?.` of a member access")?;
                self.nested(obj, obj2)?;
                self.expr(index, index2)
            }
            (
                Unary { op, operand },
                Unary {
                    op: op2,
                    operand: operand2,
                },
            ) => {
                self.check(op == op2, "an operator")?;
                self.nested(operand, operand2)
            }
            (
                Binary { op, left, right },
                Binary {
                    op: op2,
                    left: left2,
                    right: right2,
                },
            ) => {
                self.check(op == op2, "an operator")?;
                if !self.by_id
                    && (self.a.logical_operator(right) == Some(op)
                        || self.b.logical_operator(right2) == Some(op))
                {
                    return self.logical_chain(a, b, op);
                }
                self.nested(left, left2)?;
                self.expr(right, right2)
            }
            (
                Assign { op, target, value },
                Assign {
                    op: op2,
                    target: target2,
                    value: value2,
                },
            ) => {
                self.check(op == op2, "an operator")?;
                self.expr(target, target2)?;
                self.nested(value, value2)
            }
            (
                Cond { test, yes, no },
                Cond {
                    test: test2,
                    yes: yes2,
                    no: no2,
                },
            ) => {
                self.expr(test, test2)?;
                self.expr(yes, yes2)?;
                self.nested(no, no2)
            }
            (Spread(x), Spread(y)) | (Await(x), Await(y)) | (AsConst(x), AsConst(y)) => {
                self.nested(x, y)
            }
            (NonNull(x), NonNull(y)) => {
                if !self.a.non_null_ends.is_empty() || !self.b.non_null_ends.is_empty() {
                    let count = |list: &[(ExprId, u32)], e: ExprId| {
                        list.iter().filter(|it| it.0 == e).count()
                    };
                    self.check(
                        count(self.a.non_null_ends, a) == count(self.b.non_null_ends, b),
                        "the number of `!`",
                    )?;
                }
                self.nested(x, y)
            }
            (
                Yield { value, star },
                Yield {
                    value: value2,
                    star: star2,
                },
            ) => {
                self.check(star == star2, "the `*` of `yield`")?;
                self.nested(value, value2)
            }
            (
                As { expr, ty },
                As {
                    expr: expr2,
                    ty: ty2,
                },
            )
            | (
                Satisfies { expr, ty },
                Satisfies {
                    expr: expr2,
                    ty: ty2,
                },
            ) => {
                self.nested(expr, expr2)?;
                self.ty(ty, ty2)
            }
            (
                Instantiation { expr, type_args },
                Instantiation {
                    expr: expr2,
                    type_args: type_args2,
                },
            ) => {
                self.nested(expr, expr2)?;
                self.type_list(type_args, type_args2)
            }
            (Jsx(x), Jsx(y)) => {
                self.has_stack_left()?;
                self.jsx(x, y)
            }
            (ImportCall { args: p }, ImportCall { args: q }) => {
                let first = |program: &Program<'_>, list: IdList<ExprId>| {
                    program.ids_of(list).first().map(|&it| ExprId(it))
                };
                let (specifier, specifier2) = (first(self.a, p), first(self.b, q));
                let is_deferred = |program: &Program<'_>, e| {
                    program
                        .deferred_import_calls
                        .iter()
                        .any(|it| Some(it.0) == e)
                };
                self.check(
                    is_deferred(self.a, specifier) == is_deferred(self.b, specifier2),
                    "the phase of an import",
                )?;
                let type_args = |program: &Program<'_>, e| {
                    program
                        .import_call_type_args
                        .iter()
                        .find(|it| Some(it.0) == e)
                        .map_or(IdList::EMPTY, |it| it.1)
                };
                self.type_list(type_args(self.a, specifier), type_args(self.b, specifier2))?;
                self.expr_list(p, q)
            }
            _ => self.differ_somewhere("the kind of an expression"),
        }
    }

    #[inline]
    fn has_stack_left(&mut self) -> Same {
        match self.by_id || self.stack.is_safe_to_recurse() {
            true => Ok(()),
            false => self.differ_somewhere("the code is nested too deeply to compare it"),
        }
    }

    /// [`Walk::expr`] where code can be nested without end.
    #[inline]
    fn nested(&mut self, a: ExprId, b: ExprId) -> Same {
        self.has_stack_left()?;
        self.expr(a, b)
    }

    /// Allowed: `a && (b && c)` is `a && b && c`, and the same for `||` and `??`.
    #[cold]
    fn logical_chain(&mut self, a: ExprId, b: ExprId, op: BinOp) -> Same {
        self.has_stack_left()?;
        let (first, first2) = (self.scratch.operands.0.len(), self.scratch.operands.1.len());
        self.a
            .operands_of_chain(a, op, &mut self.scratch.operands.0);
        self.b
            .operands_of_chain(b, op, &mut self.scratch.operands.1);
        let count = self.scratch.operands.0.len() - first;
        let mut result = self.check(
            count == self.scratch.operands.1.len() - first2,
            "the number of operands",
        );
        for i in 0..count {
            let (Some(&x), Some(&y)) = (
                self.scratch.operands.0.get(first + i),
                self.scratch.operands.1.get(first2 + i),
            ) else {
                break;
            };
            result = result.and_then(|()| self.expr(x, y));
        }
        self.scratch.operands.0.truncate(first);
        self.scratch.operands.1.truncate(first2);
        result
    }

    fn number(&mut self, a: u32, b: u32) -> Same {
        let bits = |program: &Program<'_>, at: u32| {
            program.numbers.get(at as usize).map(|it| it.to_bits())
        };
        self.check(bits(self.a, a) == bits(self.b, b), "a number")
    }

    fn bigint(&mut self, a: Atom, b: Atom) -> Same {
        let is_same = self.is_same_atom(a, b)
            || (a.is_some()
                && b.is_some()
                && self
                    .a
                    .atoms
                    .bytes(a)
                    .eq_ignore_ascii_case(self.b.atoms.bytes(b)));
        self.check(is_same, "a bigint")
    }

    /// Allowed: the flags are sorted.
    fn regex(&mut self, a: &[u8], b: &[u8]) -> Same {
        if a == b {
            return Ok(());
        }
        let parts = |text: &[u8]| {
            let (pattern, flags) = text.split_at(
                bun_core::strings::last_index_of_char(text, b'/').map_or(text.len(), |it| it + 1),
            );
            let mut flags = flags.to_vec();
            crate::sort::sort(&mut flags[..]);
            (pattern.to_vec(), flags)
        };
        self.check(parts(a) == parts(b), "a regular expression")
    }

    // ───────────────────────────── templates ─────────────────────────────

    /// The source of each piece of text of the template at `start` whose substitutions are `exprs`.
    fn template_texts<'p>(
        program: &'p Program<'p>,
        start: u32,
        exprs: &'p [u32],
    ) -> impl Iterator<Item = &'p [u8]> {
        let mut at = start + 1;
        (0..=exprs.len()).map(move |index| {
            let rest = program.from(at);
            let mut len = 0;
            while let Some(&byte) = rest.get(len) {
                match byte {
                    b'`' => break,
                    b'$' if rest.get(len + 1) == Some(&b'{') => break,
                    b'\\' => len += 2,
                    _ => len += 1,
                }
            }
            // Past the substitution and its `}`.
            if let Some(&next) = exprs.get(index) {
                at = skip_trivia(program.text, program.outer_end(ExprId(next))) + 1;
            }
            rest.get(..len).unwrap_or(rest)
        })
    }

    fn template(
        &mut self,
        (a, x, p): (ExprId, &Expr, IdList<ExprId>),
        (y, q): (&Expr, IdList<ExprId>),
    ) -> Same {
        self.has_stack_left()?;
        self.expr_list(p, q)?;
        let (program, program2) = (self.a, self.b);
        let texts = || Self::template_texts(program, x.pos, program.ids_of(p));
        let texts2 = || Self::template_texts(program2, y.pos, program2.ids_of(q));
        if texts().eq(texts2()) {
            return Ok(());
        }
        // Allowed: other line breaks. In a template, all of them stand for `\n`.
        fn with_one_kind_of_line_break(text: &[u8]) -> impl Iterator<Item = u8> {
            (text.iter().zip(text.iter().skip(1).map(Some).chain([None]))).filter_map(
                |(&byte, next)| match (byte, next) {
                    (b'\r', Some(b'\n')) => None,
                    (b'\r', _) => Some(b'\n'),
                    _ => Some(byte),
                },
            )
        }
        if texts()
            .zip(texts2())
            .all(|(x, y)| with_one_kind_of_line_break(x).eq(with_one_kind_of_line_break(y)))
        {
            return Ok(());
        }
        // Allowed: classes are sorted.
        if self.classes_can_move && texts().zip(texts2()).all(|(x, y)| has_same_words(x, y)) {
            return Ok(());
        }
        self.check(
            !self.by_id && self.can_template_change(a, texts(), texts2()),
            "the text of a template",
        )
    }

    /// Whether the formatter may make `after` of `before`, the texts of the template `e`.
    #[cold]
    fn can_template_change<'t>(
        &self,
        e: ExprId,
        before: impl Iterator<Item = &'t [u8]>,
        after: impl Iterator<Item = &'t [u8]>,
    ) -> bool {
        let template = ExprHandle::from_raw(self.before, e.0);
        // Allowed: the text is in another language, which is formatted too.
        if super::is_in_another_language(template) {
            return true;
        }
        // Allowed: the columns of the table of a `` describe.each`..` `` are lined up.
        let without_white_space =
            |text: &'t [u8]| text.iter().copied().filter(|it| !it.is_ascii_whitespace());
        super::is_table(template)
            && before
                .flat_map(without_white_space)
                .eq(after.flat_map(without_white_space))
    }

    // ───────────────────────────── JSX ─────────────────────────────

    fn jsx(&mut self, a: JsxId, b: JsxId) -> Same {
        let (x, y) = both!(self, jsx, a, b, "an element is missing");
        self.check(
            (x.close_pos == u32::MAX) == (y.close_pos == u32::MAX),
            "the closing tag of an element",
        )?;
        self.expr(x.tag, y.tag)?;
        self.expr(x.close_tag, y.close_tag)?;
        self.type_list(x.type_args, y.type_args)?;
        self.props(x.attrs, y.attrs)?;
        self.jsx_children(&x, &y)
    }

    fn jsx_attribute_value(&mut self, a: ExprId, b: ExprId) -> Same {
        let (Some(x), Some(y)) = (jsx_string(self.a, a), jsx_string(self.b, b)) else {
            self.check(
                self.a.is_in_braces(a) == self.b.is_in_braces(b),
                "the braces of the value of an attribute",
            )?;
            return self.expr(a, b);
        };
        if x == y {
            return Ok(());
        }
        // Allowed: other quotes, what has to be escaped with them, and other line breaks.
        let value = |text: &[u8]| {
            let content = text
                .get(1..text.len().saturating_sub(1))
                .unwrap_or_default();
            let content = bun_core::strings::replace_owned(content, b"&apos;", b"'");
            let content = bun_core::strings::replace_owned(&content, b"\r\n", b"\n");
            let content = bun_core::strings::replace_owned(&content, b"\r", b"\n");
            bun_core::strings::replace_owned(&content, b"&quot;", b"\"")
        };
        let (x, y) = (value(x), value(y));
        // Allowed: classes are sorted.
        self.check(
            x == y || (self.classes_can_move && has_same_words(&x, &y)),
            "the value of an attribute",
        )
    }

    /// Allowed: the white space in JSX text, and `{" "}`. The words are the same.
    fn jsx_children(&mut self, a: &Jsx, b: &Jsx) -> Same {
        let (mut xs, mut ys) = (JsxChildren::new(self.a, a), JsxChildren::new(self.b, b));
        loop {
            match (xs.next(), ys.next()) {
                (Some(JsxChild::Word(x)), Some(JsxChild::Word(y))) => {
                    self.check(x == y, "a word of the text of an element")?
                }
                (Some(JsxChild::Node(x)), Some(JsxChild::Node(y))) => {
                    self.check(
                        self.a.is_in_braces(x) == self.b.is_in_braces(y),
                        "the braces of a child of an element",
                    )?;
                    self.expr(x, y)?;
                }
                (None, None) => return Ok(()),
                _ => return self.differ_somewhere("the children of an element"),
            }
        }
    }

    // ───────────────────────────── types ─────────────────────────────

    #[inline]
    fn type_list(&mut self, a: IdList<TypeNodeId>, b: IdList<TypeNodeId>) -> Same {
        match self.by_id {
            true => Self::is_same_list(a, b),
            false => self.type_list_in_depth(a, b),
        }
    }

    fn type_list_in_depth(&mut self, a: IdList<TypeNodeId>, b: IdList<TypeNodeId>) -> Same {
        let (xs, ys) = (self.a.ids_of(a), self.b.ids_of(b));
        self.check(xs.len() == ys.len(), "the number of types in a list")?;
        xs.iter()
            .zip(ys)
            .try_for_each(|(&x, &y)| self.ty(TypeNodeId(x), TypeNodeId(y)))
    }

    #[inline]
    fn ty(&mut self, a: TypeNodeId, b: TypeNodeId) -> Same {
        match self.by_id {
            true => Self::is_same_id(a.0, b.0),
            false => self.ty_in_depth(a, b),
        }
    }

    fn ty_in_depth(&mut self, a: TypeNodeId, b: TypeNodeId) -> Same {
        let (x, y) = both!(self, types, a, b, "a type is missing");
        let result = self.type_kind((a, x.kind), (b, y.kind));
        self.at(result, x.pos, y.pos)
    }

    fn type_kind(
        &mut self,
        (a, x): (TypeNodeId, TypeNodeKind),
        (b, y): (TypeNodeId, TypeNodeKind),
    ) -> Same {
        use TypeNodeKind::*;
        match (x, y) {
            (Keyword(x), Keyword(y)) => self.check(x == y, "a type"),
            (
                Ref { name, args },
                Ref {
                    name: name2,
                    args: args2,
                },
            ) => {
                self.entity_name(name, name2)?;
                self.type_list(args, args2)
            }
            (Error, Error) | (UniqueSymbol, UniqueSymbol) => Ok(()),
            (StringLit(x), StringLit(y)) => {
                self.atom(x, y, "a string")?;
                let (x, y) = both!(self, types, a, b, "a type is missing");
                self.check(
                    is_same_string(self.a.slice(x.pos, x.end), self.b.slice(y.pos, y.end)),
                    "how a string is written",
                )
            }
            (BoolLit(x), BoolLit(y)) => self.check(x == y, "a type"),
            (NumberLit(x), NumberLit(y)) => {
                self.number(x, y)?;
                let (x, y) = both!(self, types, a, b, "a type is missing");
                let digits = |text: &'_ [u8]| -> Vec<u8> {
                    text.iter()
                        .copied()
                        .filter(|it| *it != b'-' && !it.is_ascii_whitespace())
                        .collect()
                };
                let (x, y) = (self.a.slice(x.pos, x.end), self.b.slice(y.pos, y.end));
                self.check(
                    x == y || is_same_number(&digits(x), &digits(y)),
                    "how a number is written",
                )
            }
            (
                BigIntLit { text, negative },
                BigIntLit {
                    text: text2,
                    negative: negative2,
                },
            ) => {
                self.check(negative == negative2, "the sign of a bigint")?;
                self.bigint(text, text2)
            }
            (
                Heritage { expr, args },
                Heritage {
                    expr: expr2,
                    args: args2,
                },
            ) => {
                self.expr(expr, expr2)?;
                self.type_list(args, args2)
            }
            (
                Template { types, texts },
                Template {
                    types: types2,
                    texts: texts2,
                },
            ) => {
                self.type_list(types, types2)?;
                let (xs, ys) = (self.a.ids_of(texts), self.b.ids_of(texts2));
                self.check(xs.len() == ys.len(), "the text of a template")?;
                xs.iter()
                    .zip(ys)
                    .try_for_each(|(&x, &y)| self.atom(Atom(x), Atom(y), "the text of a template"))
            }
            (Array(x), Array(y))
            | (Keyof(x), Keyof(y))
            | (Readonly(x), Readonly(y))
            | (Unique(x), Unique(y)) => {
                self.has_stack_left()?;
                self.ty(x, y)
            }
            (Tuple(x), Tuple(y)) => {
                self.has_stack_left()?;
                self.check(x.len() == y.len(), "the number of elements of a tuple")?;
                for (e, g) in x.iter().zip(y.iter()) {
                    let (e, g) = both!(self, tuple_elems, e, g, "an element of a tuple is missing");
                    let form = |it: &TupleElem| {
                        (
                            it.member_type,
                            it.optional,
                            it.rest,
                            it.has_dots,
                            it.written == it.ty,
                        )
                    };
                    self.check(form(&e) == form(&g), "the form of an element of a tuple")?;
                    self.atom(e.name, g.name, "the name of an element of a tuple")?;
                    self.ty(e.written, g.written)?;
                }
                Ok(())
            }
            (Union(p), Union(q)) | (Intersection(p), Intersection(q)) if p.len() == q.len() => {
                self.has_stack_left()?;
                self.type_list(p, q)
            }
            (Fn(x), Fn(y)) => {
                self.has_stack_left()?;
                self.func(x, y)
            }
            (Object(x), Object(y)) => {
                self.has_stack_left()?;
                self.members(x, y)
            }
            (
                Cond {
                    check,
                    extends,
                    yes,
                    no,
                },
                Cond {
                    check: check2,
                    extends: extends2,
                    yes: yes2,
                    no: no2,
                },
            ) => {
                self.has_stack_left()?;
                self.ty(check, check2)?;
                self.ty(extends, extends2)?;
                self.ty(yes, yes2)?;
                self.ty(no, no2)
            }
            (Infer(x), Infer(y)) => self.type_param(x, y),
            (Mapped(x), Mapped(y)) => {
                let (i, j) = both!(self, mapped, x, y, "a mapped type is missing");
                let marks = |it: &bun_sema::hir::Mapped| {
                    (
                        it.readonly,
                        it.optional,
                        it.is_readonly_with_plus,
                        it.is_optional_with_plus,
                    )
                };
                self.check(marks(&i) == marks(&j), "the modifiers of a mapped type")?;
                self.type_param(i.param, j.param)?;
                self.ty(i.name_ty, j.name_ty)?;
                self.ty(i.ty, j.ty)?;
                self.members(i.members, j.members)
            }
            (
                IndexedAccess { obj, index },
                IndexedAccess {
                    obj: obj2,
                    index: index2,
                },
            ) => {
                self.has_stack_left()?;
                self.ty(obj, obj2)?;
                self.ty(index, index2)
            }
            (
                JSDoc {
                    ty,
                    kind,
                    is_postfix,
                },
                JSDoc {
                    ty: ty2,
                    kind: kind2,
                    is_postfix: is_postfix2,
                },
            ) => {
                self.check(
                    (kind, is_postfix) == (kind2, is_postfix2),
                    "the kind of a type",
                )?;
                self.has_stack_left()?;
                self.ty(ty, ty2)
            }
            (
                Typeof {
                    args,
                    has_type_arguments,
                    expr,
                    ..
                },
                Typeof {
                    args: args2,
                    has_type_arguments: has_type_arguments2,
                    expr: expr2,
                    ..
                },
            ) => {
                self.check(
                    has_type_arguments == has_type_arguments2,
                    "the type arguments of `typeof`",
                )?;
                self.type_list(args, args2)?;
                self.expr(expr, expr2)
            }
            (
                Import {
                    spec,
                    name,
                    args,
                    is_typeof,
                    mode,
                    attributes,
                },
                Import {
                    spec: spec2,
                    name: name2,
                    args: args2,
                    is_typeof: is_typeof2,
                    mode: mode2,
                    attributes: attributes2,
                },
            ) => {
                self.check(
                    (is_typeof, mode, attributes) == (is_typeof2, mode2, attributes2),
                    "the form of an import type",
                )?;
                self.atom(spec, spec2, "a module specifier")?;
                self.entity_name(name, name2)?;
                self.type_list(args, args2)
            }
            (
                Predicate { param, ty, asserts },
                Predicate {
                    param: param2,
                    ty: ty2,
                    asserts: asserts2,
                },
            ) => {
                self.check(asserts == asserts2, "`asserts`")?;
                self.atom(param, param2, "the name in a type predicate")?;
                self.ty(ty, ty2)
            }
            _ => {
                // Allowed: no `|` or `&` before a type that is alone.
                let (inner, inner2) = (
                    self.a.without_lone_operator(a),
                    self.b.without_lone_operator(b),
                );
                match self.by_id || (inner, inner2) == (a, b) {
                    true => self.differ_somewhere("the kind of a type"),
                    false => self.ty(inner, inner2),
                }
            }
        }
    }
}

/// Whether the keys that are not plain names, each in a program at a position, are written the same.
fn is_literal_name_same(a: (&Program<'_>, u32), b: (&Program<'_>, u32)) -> bool {
    // `["a"]`
    let inside = |program: &Program<'_>, at: u32| match program.text.get(at as usize) {
        Some(b'[') => skip_trivia(program.text, at + 1),
        _ => at,
    };
    let (x, y) = (a.0.from(inside(a.0, a.1)), b.0.from(inside(b.0, b.1)));
    // What is between the quotes is what is written without them. Allowed: `.5` is `"0.5"`.
    let is_without_quotes = |string: &[u8], other: &[u8]| {
        let content = string.get(1..string.len() - 1).unwrap_or_default();
        if let Some(number) = number_at_start(other) {
            return *content == *format_trimmed_number(number);
        }
        let is_part = |it: &u8| {
            it.is_ascii_alphanumeric() || matches!(it, b'_' | b'$' | b'.') || !it.is_ascii()
        };
        other
            .strip_prefix(content)
            .is_some_and(|rest| !rest.first().is_some_and(is_part))
    };
    match (string_at_start(x), string_at_start(y)) {
        (Some(x), Some(y)) => is_same_string(x, y),
        (Some(string), None) => is_without_quotes(string, y),
        (None, Some(string)) => is_without_quotes(string, x),
        (None, None) => match (number_at_start(x), number_at_start(y)) {
            (Some(x), Some(y)) => is_same_number(x, y),
            _ => true,
        },
    }
}

/// Everything about the import `id` that is compared, in a form that does not depend on the order
/// of its names, but for its attributes, which come with it.
fn import_as_text(program: &Program<'_>, id: u32) -> (Vec<u8>, Option<(u32, ExprId)>) {
    let mut out = Vec::new();
    let Some(Stmt {
        kind: StmtKind::Import(import),
        start,
        loc,
        ..
    }) = program.stmts.get(id as usize)
    else {
        return (out, None);
    };
    let Some(import) = program.imports.get(import.idx()) else {
        return (out, None);
    };
    let text = |atom: Atom| {
        if atom.is_none() {
            &b"\x01"[..]
        } else {
            program.atoms.bytes(atom)
        }
    };
    for part in [
        text(import.spec),
        text(import.default),
        text(import.namespace),
    ] {
        out.extend_from_slice(part);
        out.push(0);
    }
    out.extend([
        u8::from(import.type_only),
        u8::from(import.is_deferred),
        import.mode as u8,
    ]);
    let mut names: Vec<Vec<u8>> = (program
        .import_specs
        .get(import.named.range())
        .unwrap_or_default()
        .iter())
    .map(|it| {
        [
            text(it.imported),
            b"\0",
            text(it.local),
            b"\0",
            &[u8::from(it.type_only)],
        ]
        .concat()
    })
    .collect();
    crate::sort::sort(&mut names[..]);
    out.extend(names.concat());
    (
        out,
        program
            .import_attributes
            .iter()
            .find(|it| (*start..loc.end).contains(&it.0))
            .copied(),
    )
}

/// The text of the string `e`, if that is not between braces: JSX text, or the value of an
/// attribute with its quotes.
fn jsx_string<'p>(program: &'p Program<'p>, e: ExprId) -> Option<&'p [u8]> {
    match program.exprs.get(e.idx()) {
        Some(Expr {
            kind: ExprKind::String(_),
            pos,
            end,
        }) if !program.is_in_braces(e) => Some(program.slice(*pos, *end)),
        _ => None,
    }
}

/// The string that `text` starts with, with its quotes.
fn string_at_start(text: &[u8]) -> Option<&[u8]> {
    let quote = *text.first().filter(|it| matches!(it, b'"' | b'\''))?;
    let mut len = 1;
    while let Some(&byte) = text.get(len) {
        len += if byte == b'\\' { 2 } else { 1 };
        if byte == quote {
            return text.get(..len);
        }
    }
    None
}

/// The number that `text` starts with.
fn number_at_start(text: &[u8]) -> Option<&[u8]> {
    text.first()
        .filter(|it| it.is_ascii_digit() || **it == b'.')?;
    let is_hexadecimal = matches!(text, [b'0', b'x' | b'X', ..]);
    let is_part = |at: usize, byte: u8| {
        byte.is_ascii_alphanumeric()
            || matches!(byte, b'.' | b'_')
            || (matches!(byte, b'+' | b'-')
                && !is_hexadecimal
                && matches!(text.get(at.wrapping_sub(1)), Some(b'e' | b'E')))
    };
    text.get(
        ..text
            .iter()
            .enumerate()
            .take_while(|&(at, &byte)| is_part(at, byte))
            .count(),
    )
}

/// Whether two strings, with their quotes, are written in the same way. Allowed: other quotes, a `\` before
/// a quote, and another line break after a `\`.
#[inline]
fn is_same_string(a: &[u8], b: &[u8]) -> bool {
    a == b || is_same_string_but_for_quotes(a, b)
}

fn is_same_string_but_for_quotes(a: &[u8], b: &[u8]) -> bool {
    fn content(text: &[u8]) -> Option<&[u8]> {
        match text {
            [b'"' | b'\'', content @ .., b'"' | b'\''] => Some(content),
            _ => None,
        }
    }
    fn without_quote_escapes(content: &[u8]) -> Vec<u8> {
        let mut out = Vec::with_capacity(content.len());
        let mut bytes = content.iter().copied().peekable();
        while let Some(byte) = bytes.next() {
            match (byte, bytes.peek()) {
                (b'\\', Some(b'"' | b'\'')) | (b'\r', Some(b'\n')) => {}
                (b'\\', Some(&next)) if next != b'\r' => {
                    out.extend([byte, next]);
                    bytes.next();
                }
                (b'\r', _) => out.push(b'\n'),
                _ => out.push(byte),
            }
        }
        out
    }
    match (content(a), content(b)) {
        (Some(x), Some(y)) => x == y || without_quote_escapes(x) == without_quote_escapes(y),
        // A name in JSX. Allowed: `a : b` is `a:b`.
        (None, None) => {
            let without_white_space = |text: &'_ [u8]| -> Vec<u8> {
                text.iter()
                    .copied()
                    .filter(|it| !it.is_ascii_whitespace())
                    .collect()
            };
            without_white_space(a) == without_white_space(b)
        }
        _ => false,
    }
}

/// Whether two numbers are written in the same way. Allowed: what the formatter does to a number: `0XAB`, `1.0`,
/// `.5`, `1E5`.
#[inline]
fn is_same_number(a: &[u8], b: &[u8]) -> bool {
    a == b || format_trimmed_number(a) == format_trimmed_number(b)
}

/// Allowed: see `Walk::name_kind`.
fn without_name_kind(flags: Flags) -> Flags {
    flags - (Flags::LITERAL_NAME | Flags::STRING_NAME)
}

/// Allowed: `"constructor"() {}` in a class is `constructor() {}`, which is what it means.
fn function_kind(function: &Func) -> FnKind {
    match function.kind {
        FnKind::Method
            if function.name == bun_sema::atom::known::constructor
                && !function.flags.intersects(NOT_OF_A_CONSTRUCTOR) =>
        {
            FnKind::Constructor
        }
        kind => kind,
    }
}

const NOT_OF_A_CONSTRUCTOR: Flags = Flags::STATIC
    .union(Flags::COMPUTED_NAME)
    .union(Flags::ASYNC)
    .union(Flags::GENERATOR);

enum JsxChild<'p> {
    /// A run of what is not white space in JSX text.
    Word(&'p [u8]),
    /// An element, or what is between braces.
    Node(ExprId),
}

/// The children of an element, without the white space between them.
struct JsxChildren<'p> {
    program: &'p Program<'p>,
    children: std::slice::Iter<'p, u32>,
    /// What is left of the text that is being taken apart.
    text: &'p [u8],
    /// The child after that text.
    next: Option<ExprId>,
    /// Where the last child ends, and where the closing tag starts.
    rest: (u32, u32),
}

impl<'p> JsxChildren<'p> {
    fn new(program: &'p Program<'p>, element: &Jsx) -> Self {
        JsxChildren {
            program,
            children: program.ids_of(element.children).iter(),
            text: &[],
            next: None,
            rest: (
                element.opening_end,
                if element.close_pos == u32::MAX {
                    element.opening_end
                } else {
                    element.close_pos
                },
            ),
        }
    }
}

impl<'p> Iterator for JsxChildren<'p> {
    type Item = JsxChild<'p>;

    fn next(&mut self) -> Option<JsxChild<'p>> {
        loop {
            self.text = self.text.trim_ascii_start();
            if !self.text.is_empty() {
                let len = self
                    .text
                    .iter()
                    .take_while(|it| !it.is_ascii_whitespace())
                    .count();
                let (word, rest) = self.text.split_at(len);
                self.text = rest;
                return Some(JsxChild::Word(word));
            }
            let Some(child) = self.next.take() else {
                // Text that is white space to the parser and has a line break in it is not among the children. A no-break
                // space is white space to it.
                let next = self.children.next().map(|&it| ExprId(it));
                let span = match next {
                    Some(child) => match self
                        .program
                        .jsx_expressions
                        .binary_search_by_key(&child.0, |it| it.0.0)
                    {
                        Ok(at) => self
                            .program
                            .jsx_expressions
                            .get(at)
                            .map_or((0, 0), |it| (it.1, it.2)),
                        Err(_) => self
                            .program
                            .exprs
                            .get(child.idx())
                            .map_or((0, 0), |it| (it.pos, it.end)),
                    },
                    None if self.rest.0 < self.rest.1 => (self.rest.1, self.rest.1),
                    None => return None,
                };
                self.text = self.program.slice(self.rest.0, span.0);
                (self.next, self.rest.0) = (next, span.1);
                continue;
            };
            match self.program.exprs.get(child.idx()) {
                Some(Expr {
                    kind: ExprKind::String(value),
                    pos,
                    end,
                }) => match self.program.is_in_braces(child) {
                    false => self.text = self.program.slice(*pos, *end),
                    true if *end == *pos + 3 && self.program.atoms.bytes(*value) == b" " => {}
                    true => return Some(JsxChild::Node(child)),
                },
                _ => return Some(JsxChild::Node(child)),
            }
        }
    }
}
