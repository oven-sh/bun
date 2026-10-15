//! typescript-eslint's `util/collectUnusedVariables.ts`.
//!
//! Upstream walks the tree once to set `variable.eslintUsed` on what is never to be reported, and
//! then asks each variable of each scope whether it is exported or used. Here only the parameters
//! of signatures and setters are walked. What else the visitor marks follows from the declarations
//! and the references of a symbol.
//!
//! The helpers of `isUsedVariable` are the same as those of ESLint's own `no-unused-vars`, and are
//! public for it.

use super::estree::is_expression_statement;
use super::is_type_only_reference;
use crate::ast::{
    BinOp, Class, Expr, ExprKind, ExprTag, File, FnKind, Func, Handle, Key, KeyKind, Module,
    ModuleName, Name, Node, Param, Pat, PatKind, PatProp, PropKind, Stmt, StmtKind, StmtTag,
    TypeKind, TypeTag, UnOp, VarDecl,
};
use crate::semantic::{
    Declaration, DeclarationKinds, Reference, ReferenceFlags, Scope, ScopeKind, Symbol,
};
use crate::span::Span;
use crate::tokens::TokenKind;
use crate::utils::ancestor_memo::AncestorMemo;
use crate::utils::directives::match_directives_pattern;
use crate::utils::estree_compat::is_assignment_target;
use crate::utils::ts_utils::is_type_import;
use bun_core::strings;
use bun_sema::atom::known;
use bun_sema::bind::PatParent;
use bun_sema::hir;
use smallvec::{SmallVec, smallvec};

// ───────────────────────────── eslintUsed ─────────────────────────────

/// Some of the symbols of one file: a bit for each.
#[derive(Clone, Debug, Default)]
pub struct SymbolSet {
    words: Vec<u64>,
}

impl SymbolSet {
    pub fn insert(&mut self, symbol: Symbol) {
        let at = symbol.key();
        if self.words.len() <= at / 64 {
            self.words.resize(at / 64 + 1, 0);
        }
        if let Some(word) = self.words.get_mut(at / 64) {
            *word |= 1 << (at % 64);
        }
    }

    #[inline]
    pub fn contains(&self, symbol: Symbol) -> bool {
        let at = symbol.key();
        self.words
            .get(at / 64)
            .is_some_and(|word| word & (1 << (at % 64)) != 0)
    }
}

/// ESLint's `variable.eslintUsed`, for the symbols of one file.
#[derive(Clone, Debug, Default)]
pub struct UsedMarks {
    marked: SymbolSet,
}

impl UsedMarks {
    /// `variable.eslintUsed = true`. Other rules see it: [`Symbol::is_marked_used`].
    #[inline]
    pub fn mark(&mut self, symbol: Symbol) {
        self.marked.insert(symbol);
        symbol.mark_used();
    }

    /// `variable.eslintUsed`
    #[inline]
    pub fn contains(&self, symbol: Symbol) -> bool {
        self.marked.contains(symbol)
    }

    /// ESLint's `markExportedVariables`: marks what the `/* exported a, b */` comments of a script
    /// name. In a module nothing is in the global scope, and they have no effect.
    pub fn mark_exported_variables<'a>(&mut self, file: &'a File<'a>) {
        let global = file.scope();
        if global.symbols().len() == 0 || !strings::contains(file.text(), b"exported") {
            return;
        }
        for comment in file.comments() {
            if comment.kind() != TokenKind::Block {
                continue;
            }
            let directive =
                strings::trim_js_whitespace(without_justification(comment.comment_value()));
            if match_directives_pattern(directive) != Some("exported") {
                continue;
            }
            let list = directive.get("exported".len()..).unwrap_or_default();
            for item in strings::split(list, b",") {
                let name = without_quotes(strings::trim_js_whitespace(item));
                if let Some(symbol) = global.symbols().find(|symbol| symbol.name() == name) {
                    self.mark(symbol);
                }
            }
        }
    }
}

/// What is before the first `/\s-{2,}\s/u` of the value of a directive comment.
fn without_justification(value: &[u8]) -> &[u8] {
    let (mut space, mut dashes) = (None, 0);
    for (at, c) in strings::wtf8_codepoints(value) {
        if strings::is_js_whitespace(c) {
            if dashes >= 2
                && let Some(end) = space
            {
                return value.get(..end).unwrap_or_default();
            }
            (space, dashes) = (Some(at), 0);
        } else if c == u32::from(b'-') && space.is_some() {
            dashes += 1;
        } else {
            (space, dashes) = (None, 0);
        }
    }
    value
}

fn without_quotes(name: &[u8]) -> &[u8] {
    match name {
        [b'"', inner @ .., b'"'] | [b'\'', inner @ .., b'\''] => inner,
        _ => name,
    }
}

// ───────────────────────────── variables ─────────────────────────────

/// scope-manager's `Variable`, where it is not the same as a [`Symbol`].
///
/// - The name of a class is two variables: one in the scope around a class declaration, and one in
///   the scope of the class itself, which is what the name means inside the class. Both have the
///   symbol of the class. [`Variable::references`] has only those of the one.
/// - [`Variable::defs`] has no declaration that scope-manager has no definition for.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub struct Variable<'a> {
    symbol: Symbol<'a>,
    /// For the variable in the scope of a class.
    class: Option<Class<'a>>,
}

/// Whether the name that is written at `start` is in the scope of `class`: after its name.
fn is_in_class_scope(class: Class, start: u32) -> bool {
    class_scope_range(class).contains_offset(start)
}

/// From the end of the name of `class` to its end.
fn class_scope_range(class: Class) -> Span {
    let whole = class.span();
    Span::new(
        class.name().map_or(whole.start, |name| name.span().end),
        whole.end,
    )
}

/// The `A` or the `B` of `namespace A.B {}`, which declare nothing in scope-manager.
fn is_part_of_qualified_name(module: Module) -> bool {
    module.nested().is_some() || module.outermost() != module
}

/// Whether scope-manager has a definition for `declaration` in the scope around it.
#[inline]
fn is_definition(declaration: Declaration) -> bool {
    Facts::of_declaration(declaration) & Facts::DEFINED != 0
}

/// Whether one of the declarations of `symbol` is a class. The flags do not tell if the class is in
/// conflict with an earlier declaration.
fn is_class(symbol: Symbol) -> bool {
    symbol
        .declarations()
        .any(|it| matches!(it, Declaration::Class(_)))
}

/// The `VarDecl` that `pat`, which a `var`, `let`, `const`, `using` or `catch` binds, is part of.
fn declarator_of(pat: Pat<'_>) -> Option<VarDecl<'_>> {
    let file = pat.file();
    if let Some(&PatParent::Var(declarator)) = file.bound.pat_parent.get(pat.id().idx()) {
        return Some(VarDecl::new(file, declarator));
    }
    match Declaration::Var(pat).node()? {
        Node::VarDecl(declarator) => Some(declarator),
        _ => None,
    }
}

/// What the declarations of a variable say about it, from one pass over them.
#[derive(Copy, Clone)]
struct Facts(u16);

impl Facts {
    /// [`Variable::defs`] is not empty.
    const DEFINED: u16 = 1 << 0;
    /// A declaration is a class: the references are those of two variables.
    const CLASS: u16 = 1 << 1;
    /// `UnusedVarsVisitor` marks it because of how it is declared: an enum member, the key of a mapped
    /// type, a parameter property, a `this` parameter.
    const MARKED: u16 = 1 << 2;
    /// [`self_reference_range`] can be something for a definition.
    const HAS_RANGES: u16 = 1 << 3;
    /// [`is_type_import`] does not hold for a definition.
    const NOT_IMPORTED_AS_TYPE: u16 = 1 << 4;
    /// `variable.isTypeVariable`
    const TYPE: u16 = 1 << 5;
    /// `variable.isValueVariable`
    const VALUE: u16 = 1 << 6;
    /// A definition is of a kind that can start with `export`.
    const EXPORTABLE: u16 = 1 << 7;
    /// Of the variable that the name of a class is inside it. Its only definition is the class, also
    /// if that is an expression.
    const IN_CLASS_SCOPE: u16 = Self::DEFINED
        | Self::CLASS
        | Self::NOT_IMPORTED_AS_TYPE
        | Self::TYPE
        | Self::VALUE
        | Self::EXPORTABLE;

    /// Of what `var`, `let`, `const`, `using` or `catch` binds.
    const OF_VARIABLE: u16 = Self::DEFINED
        | Self::NOT_IMPORTED_AS_TYPE
        | Self::VALUE
        | Self::HAS_RANGES
        | Self::EXPORTABLE;

    #[inline]
    fn has(self, fact: u16) -> bool {
        self.0 & fact != 0
    }

    /// 0 for a declaration that scope-manager has no definition for in the scope around it.
    #[inline]
    fn of_declaration(declaration: Declaration) -> u16 {
        match declaration {
            Declaration::Var(_) => Self::OF_VARIABLE,
            _ => Self::of_what_is_no_variable(declaration),
        }
    }

    fn of_what_is_no_variable(declaration: Declaration) -> u16 {
        let declared = Self::DEFINED | Self::NOT_IMPORTED_AS_TYPE;
        let both = Self::TYPE | Self::VALUE;
        match declaration {
            Declaration::Param(pat) => {
                let file = pat.file();
                let param = match file.bound.pat_parent.get(pat.id().idx()) {
                    Some(&PatParent::Param(param)) => Some(Param::new(file, param)),
                    _ => None,
                };
                let is_this = pat
                    .as_ident()
                    .is_some_and(|name| name.atom() == known::this);
                match param.and_then(Param::func).map(Func::kind) {
                    Some(FnKind::IndexSignature) => 0,
                    _ if is_this || param.is_some_and(Param::is_parameter_property) => {
                        declared | Self::VALUE | Self::MARKED
                    }
                    _ => declared | Self::VALUE,
                }
            }
            Declaration::Fn(func) => match func.kind() == FnKind::Decl && func.name().is_some() {
                true => declared | Self::VALUE | Self::HAS_RANGES | Self::EXPORTABLE,
                false => 0,
            },
            Declaration::Class(class) => {
                match class.name().is_some() && matches!(class.owner(), Node::Stmt(_)) {
                    true => declared | Self::CLASS | both | Self::EXPORTABLE,
                    false => Self::CLASS,
                }
            }
            Declaration::Interface(_) | Declaration::TypeAlias(_) => {
                declared | Self::TYPE | Self::HAS_RANGES | Self::EXPORTABLE
            }
            Declaration::Enum(_) => declared | both | Self::HAS_RANGES | Self::EXPORTABLE,
            Declaration::Module(module) => {
                match matches!(module.name(), ModuleName::Ident(_))
                    && !is_part_of_qualified_name(module)
                {
                    true => declared | both | Self::HAS_RANGES | Self::EXPORTABLE,
                    false => 0,
                }
            }
            Declaration::EnumMember(_) => declared | both | Self::MARKED,
            // Few files have a mapped type, and those that do have few.
            Declaration::TypeParam(param) => {
                let mapped = &param.file().hir.mapped;
                let is_of_mapped_type = match mapped.len() {
                    0..=8 => mapped.iter().any(|it| it.param == param.id()),
                    _ => matches!(param.parent(), Node::Type(ty) if ty.tag() == TypeTag::Mapped),
                };
                match is_of_mapped_type {
                    true => declared | Self::TYPE | Self::MARKED,
                    false => declared | Self::TYPE,
                }
            }
            Declaration::ImportDefault(_)
            | Declaration::ImportNamespace(_)
            | Declaration::ImportSpec(_) => match is_type_import(declaration) {
                true => Self::DEFINED | both,
                false => declared | both,
            },
            Declaration::ImportEquals(_) => match is_type_import(declaration) {
                true => Self::DEFINED | both | Self::EXPORTABLE,
                false => declared | both | Self::EXPORTABLE,
            },
            Declaration::Var(_) | Declaration::Other => 0,
        }
    }

    fn of(variable: Variable) -> Facts {
        if variable.class.is_some() {
            return Facts(Self::IN_CLASS_SCOPE);
        }
        let kinds = variable.symbol.declaration_kinds();
        if !kinds.is_empty()
            && (DeclarationKinds::VARIABLE | DeclarationKinds::CATCH_CLAUSE).contains(kinds)
        {
            return Facts(Self::OF_VARIABLE);
        }
        let declarations = variable.symbol.declarations();
        Facts(declarations.fold(0, |facts, it| facts | Self::of_declaration(it)))
    }
}

impl<'a> Variable<'a> {
    /// The variable that `symbol` is in the scope it is declared in.
    #[inline]
    pub fn new(symbol: Symbol<'a>) -> Self {
        Variable {
            symbol,
            class: None,
        }
    }

    #[inline]
    pub fn symbol(self) -> Symbol<'a> {
        self.symbol
    }

    #[inline]
    pub fn name(self) -> Name<'a> {
        self.symbol.name()
    }

    /// `variable.scope`
    pub fn scope(self) -> Scope<'a> {
        match self.class {
            Some(class) => Node::Class(class).scope(),
            None => self.symbol.scope(),
        }
    }

    /// `variable.defs`
    pub fn defs(self) -> impl Iterator<Item = Declaration<'a>> + 'a {
        let own = self.class.map(Declaration::Class);
        let declarations = own.is_none().then(|| self.symbol.declarations());
        own.into_iter().chain(
            declarations
                .into_iter()
                .flatten()
                .filter(|it| is_definition(*it)),
        )
    }

    /// `variable.references`
    pub fn references(self) -> impl Iterator<Item = Reference<'a>> + 'a {
        let is_class = is_class(self.symbol);
        self.symbol
            .references()
            .filter(move |it| !is_class || self.has_reference_at(it.ident().start()))
    }

    /// Whether a reference to the symbol that is written at `start` is one to this variable.
    fn has_reference_at(self, start: u32) -> bool {
        match self.class {
            Some(class) => is_in_class_scope(class, start),
            None => !self.symbol.declarations().any(
                |it| matches!(it, Declaration::Class(class) if is_in_class_scope(class, start)),
            ),
        }
    }
}

// ───────────────────────────── what the visitor marks ─────────────────────────────

/// The head of `for (x in y) return;` or `for (x of y) { return; }`, if `statement` is such a loop.
fn head_of_loop_that_only_returns(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    let (StmtKind::ForIn { left, body, .. } | StmtKind::ForOf { left, body, .. }) =
        statement.kind()
    else {
        return None;
    };
    let only = match body.as_block() {
        Some(statements) if statements.len() == 1 => statements.first(),
        Some(_) => None,
        None => Some(body),
    };
    only.is_some_and(|it| it.tag() == StmtTag::Return)
        .then_some(left)
}

/// Upstream's `visitForInForOf`: the first name that the head of such a loop declares, or the
/// variable that it assigns to.
fn variables_of_loops_that_only_return<'a>(file: &'a File<'a>) -> SymbolSet {
    let mut variables = SymbolSet::default();
    let loops = (file.stmts_of_kind(StmtTag::ForIn)).chain(file.stmts_of_kind(StmtTag::ForOf));
    for head in loops.filter_map(head_of_loop_that_only_returns) {
        let symbol = match head.kind() {
            StmtKind::Var(declarators) => {
                let mut first = None;
                if let Some(declarator) = declarators.first() {
                    declarator.pat().for_each_binding(&mut |binding| {
                        first.get_or_insert(binding);
                    });
                }
                first.and_then(Pat::symbol)
            }
            StmtKind::Expr(target) => target
                .reference()
                .filter(|it| is_assigned_by_loop_that_only_returns(*it))
                .and_then(|it| Some((it.symbol()?, it.ident().start())))
                .filter(|&(symbol, start)| Variable::new(symbol).has_reference_at(start))
                .map(|it| it.0),
            _ => None,
        };
        if let Some(symbol) = symbol {
            variables.insert(symbol);
        }
    }
    variables
}

/// The `x` of `for (x in y) return;`
fn is_assigned_by_loop_that_only_returns(reference: Reference) -> bool {
    if !reference.is_write() {
        return false;
    }
    let Some(id) = reference.expr() else {
        return false;
    };
    let head = id
        .parent()
        .as_stmt()
        .and_then(head_of_loop_that_only_returns);
    matches!(head.map(Stmt::kind), Some(StmtKind::Expr(target)) if target == id)
}

/// [`UsedMarks`] that other rules see only at the end: as long as nothing is marked for them,
/// [`Symbol::is_marked_used`] costs nothing.
struct Marker<'a> {
    marks: UsedMarks,
    unshared: Vec<Symbol<'a>>,
    /// [`scope_of_parameters`] of the function whose parameters are looked at.
    scope: Option<Scope<'a>>,
}

impl<'a> Marker<'a> {
    #[inline]
    fn contains(&self, symbol: Symbol<'a>) -> bool {
        self.marks.contains(symbol)
    }

    #[inline]
    fn mark(&mut self, symbol: Symbol<'a>) {
        self.marks.marked.insert(symbol);
        self.unshared.push(symbol);
    }

    fn mark_variable_as_used(&mut self, name: &str, node: Node<'a>) {
        if let Some(symbol) = node.scope().resolve(name) {
            self.mark(symbol);
        }
    }

    fn share(self) -> UsedMarks {
        self.unshared.into_iter().for_each(Symbol::mark_used);
        self.marks
    }
}

/// `declare global {}` marks what `global` means around it.
fn mark_global_augmentations<'a>(file: &'a File<'a>, marks: &mut Marker<'a>) {
    for id in 0..file.hir.modules.len() {
        let module = Module::new(file, hir::ModuleId(id as u32));
        if matches!(module.name(), ModuleName::Global) {
            marks.mark_variable_as_used("global", module.stmt().parent());
        }
    }
}

/// Whether it is a function of `visitFunctionTypeSignature` or `visitSetter`: a signature, a
/// function type, an overload, an ambient or abstract declaration, or a setter.
fn has_marked_parameters(func: Func) -> bool {
    match func.kind() {
        FnKind::IndexSignature | FnKind::StaticBlock => false,
        FnKind::Setter => true,
        _ => !func.has_body(),
    }
}

fn mark_identifier<'a>(name: Name<'a>, holder: Node<'a>, marks: &mut Marker<'a>) {
    // Inside a class its name is the other variable, which counts as used anyway.
    if let Some(symbol) = (marks.scope.unwrap_or_else(|| holder.scope())).resolve_name(name)
        && !marks.contains(symbol)
        && Variable::new(symbol).has_reference_at(holder.span().start)
    {
        marks.mark(symbol);
    }
}

fn mark_key<'a>(key: Option<Key<'a>>, holder: Node<'a>, marks: &mut Marker<'a>) {
    if let Some(KeyKind::Ident(name)) = key.map(Key::kind) {
        mark_identifier(name, holder, marks);
    }
}

/// Marks what the name of every `Identifier` of ESTree in `node` means where it is written, whether
/// it refers to that or not: the `b` of `a.b`, a key, a label.
fn mark_identifiers<'a>(node: Node<'a>, marks: &mut Marker<'a>) {
    // Not by recursion: `T[][][]..` is as deep as it is long.
    let mut pending: SmallVec<[Node<'a>; 16]> = smallvec![node];
    while let Some(node) = pending.pop() {
        mark_identifiers_of(node, marks, &mut pending);
    }
}

/// Adds the children of `node` that are to be looked at to `pending`.
fn mark_identifiers_of<'a>(
    node: Node<'a>,
    marks: &mut Marker<'a>,
    pending: &mut SmallVec<[Node<'a>; 16]>,
) {
    match node {
        Node::Expr(e) => match e.kind() {
            ExprKind::Ident(name) => mark_identifier(name, node, marks),
            ExprKind::Dot { name, .. } if !name.bytes().starts_with(b"#") => {
                mark_identifier(name.name(), node, marks);
            }
            ExprKind::ImportMeta => {
                marks.mark_variable_as_used("meta", node);
            }
            ExprKind::NewTarget => {
                marks.mark_variable_as_used("target", node);
            }
            // The names of the tags are `JSXIdentifier`s.
            ExprKind::Jsx(jsx) => {
                pending.extend(jsx.type_args().iter().map(Node::Type));
                pending.extend(jsx.attrs().iter().map(Node::Prop));
                pending.extend(jsx.children().iter().map(Node::Expr));
                return;
            }
            _ => {}
        },
        Node::Pat(pat) => {
            if let Some(name) = pat.as_ident() {
                mark_identifier(name, node, marks);
            }
        }
        Node::PatProp(prop) => mark_key(prop.key(), node, marks),
        Node::Prop(prop) if !prop.is_jsx_attribute() => mark_key(prop.key(), node, marks),
        Node::Member(member) => mark_key(member.key(), node, marks),
        Node::EnumMember(member) => mark_key(member.key(), node, marks),
        Node::TypeParam(param) => mark_identifier(param.name().name(), node, marks),
        Node::TupleElem(element) => {
            if let Some(name) = element.name() {
                mark_identifier(name.name(), node, marks);
            }
        }
        Node::Func(func) => {
            if let Some(name) = func.name() {
                mark_identifier(name.name(), node, marks);
            }
            // Its parameters have their own turn.
            if has_marked_parameters(func) {
                node.for_each_child(|child| {
                    if !matches!(child, Node::Param(_)) {
                        pending.push(child);
                    }
                });
                return;
            }
        }
        Node::Type(ty) => match ty.kind() {
            TypeKind::Ref { name, .. } | TypeKind::Import { name, .. } => {
                name.parts()
                    .for_each(|part| mark_identifier(part.name(), node, marks));
            }
            TypeKind::Predicate { param, .. } if !param.is("this") => {
                mark_identifier(param, node, marks);
            }
            _ => {}
        },
        Node::Stmt(statement) => {
            let name = match statement.kind() {
                StmtKind::Labeled { label, .. } => Some(label),
                StmtKind::Break(label) | StmtKind::Continue(label) => label,
                StmtKind::Interface(it) => Some(it.name().name()),
                StmtKind::TypeAlias(it) => Some(it.name().name()),
                StmtKind::Enum(it) => Some(it.name().name()),
                _ => None,
            };
            if let Some(name) = name {
                mark_identifier(name, node, marks);
            }
        }
        _ => {}
    }
    node.for_each_child(|child| pending.push(child));
}

/// What [`Node::scope`] says for everything in the parameters of `func`, where that is plain: its scope, if no scope starts
/// before they end. The decorators of the parameters of a method are in the scope of the class.
fn scope_of_parameters(func: Func<'_>) -> Option<Scope<'_>> {
    let scope = func.scope()?;
    let end = func
        .params()
        .last()
        .or_else(|| func.this_param())?
        .span()
        .end;
    let is_plain = scope
        .children()
        .next()
        .is_none_or(|it| it.span().start >= end)
        && (!func.has_body() || func.params().iter().all(|it| it.modifiers().is_empty()));
    is_plain.then_some(scope)
}

/// Upstream's `visitFunctionTypeSignature` and `visitSetter`. They mean to mark the parameters, and
/// visit each with a `PatternVisitor` that, with the option `visitChildrenEvenIfSelectorExists` of
/// the visitor around it, goes on into type annotations and default values.
fn mark_identifiers_in_parameters<'a>(file: &'a File<'a>, marks: &mut Marker<'a>) {
    for id in 0..file.hir.fns.len() {
        let func = Func::new(file, hir::FnId(id as u32));
        if has_marked_parameters(func)
            && !matches!(func.owner(), Node::File(_))
            && !func.is_synthetic()
        {
            marks.scope = scope_of_parameters(func);
            for param in func.this_param().into_iter().chain(func.params()) {
                // oxlint leaves the parameters alone, and nothing that has the name of a key or a label in their types.
                if file.language().is_oxlint {
                    param.pat().for_each_binding(&mut |pat| {
                        if let Some(name) = pat.as_ident() {
                            mark_identifier(name, Node::Pat(pat), marks);
                        }
                    });
                    continue;
                }
                mark_identifiers(Node::Param(param), marks);
            }
            marks.scope = None;
        }
    }
}

// ───────────────────────────── exports ─────────────────────────────

/// The statement of `declaration`, if ESTree has an `ExportNamedDeclaration` or an
/// `ExportDefaultDeclaration` around it.
fn exported_statement(declaration: Declaration<'_>) -> Option<Stmt<'_>> {
    let statement = match declaration {
        Declaration::Var(pat) => {
            let statement = *pat
                .file()
                .bound
                .var_stmt
                .get(declarator_of(pat)?.id().idx())?;
            Node::Stmt(Stmt::some(pat.file(), statement)?)
        }
        Declaration::Fn(func) => func.owner(),
        Declaration::Class(class) => class.owner(),
        Declaration::Interface(_)
        | Declaration::TypeAlias(_)
        | Declaration::Enum(_)
        | Declaration::Module(_)
        | Declaration::ImportEquals(_) => declaration.node()?,
        _ => return None,
    };
    statement
        .as_stmt()
        .filter(|statement| statement.is_exported())
}

/// typescript-eslint's `isMergedTypeDeclaration`: an interface or a type alias whose name is also
/// that of a value.
fn is_merged_type_declaration(facts: Facts, declaration: Declaration) -> bool {
    matches!(
        declaration,
        Declaration::Interface(_) | Declaration::TypeAlias(_)
    ) && facts.has(Facts::TYPE)
        && facts.has(Facts::VALUE)
}

/// typescript-eslint's `isExported` of `collectUnusedVariables`: one of the declarations starts
/// with `export`. `export { a }` is a reference instead.
fn is_exported_with(variable: Variable, facts: Facts) -> bool {
    if !facts.has(Facts::EXPORTABLE) {
        return false;
    }
    match variable.class {
        Some(class) => exported_statement(Declaration::Class(class)).is_some(),
        None => variable.symbol.declarations().any(|it| {
            exported_statement(it).is_some()
                && is_definition(it)
                && !is_merged_type_declaration(facts, it)
        }),
    }
}

// ───────────────────────────── uses ─────────────────────────────

/// ESLint's and typescript-eslint's `isUnusedExpression`: nothing takes the value of `e`. It is an
/// expression statement, or an operand of a comma operator of which that holds or that is not the
/// last.
pub fn is_unused_expression(mut e: Expr) -> bool {
    loop {
        match e.parent() {
            Node::Stmt(statement) => return is_expression_statement(statement),
            Node::Expr(parent) => match parent.kind() {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } if right == e => e = parent,
                ExprKind::Binary {
                    op: BinOp::Comma, ..
                } => return true,
                _ => return false,
            },
            _ => return false,
        }
    }
}

/// ESTree's `ArrowFunctionExpression`, `FunctionExpression` and `FunctionDeclaration`. A static
/// block is none.
fn as_estree_function(node: Node<'_>) -> Option<Func<'_>> {
    node.as_func()
        .filter(|func| func.has_body() && func.kind() != FnKind::StaticBlock)
}

/// What the walks up from the references to a variable have found, for those that start far below:
/// the operands of `a = a + a + ..`, of `a = 1, a = 2, ..`.
#[derive(Default)]
pub struct Walks<'a> {
    /// The function around a node.
    functions: AncestorMemo<'a, Func<'a>>,
    /// `is_in_loop`
    loops: AncestorMemo<'a, bool>,
    /// `is_storable_function`, for the functions inside this `rhs_node`.
    storable: (Option<Expr<'a>>, AncestorMemo<'a, bool>),
}

/// ESLint's `isInLoop`: there is a loop around `node` in its function.
fn is_in_loop<'a>(node: Node<'a>, walks: &mut Walks<'a>) -> bool {
    let found = walks.loops.find(node, |_, ancestor| match ancestor {
        Node::Stmt(statement) if statement.is_loop() => Some(true),
        _ => as_estree_function(ancestor).map(|_| false),
    });
    found == Some(true)
}

/// ESLint's and typescript-eslint's `getRhsNode`. If `reference` is the left side of an assignment
/// whose value is not used, in the function that declares the variable and in no loop: the right
/// side. If it is inside `prev_rhs_node`: that.
pub fn get_rhs_node<'a>(
    reference: Reference<'a>,
    prev_rhs_node: Option<Expr<'a>>,
    walks: &mut Walks<'a>,
) -> Option<Expr<'a>> {
    if let Some(previous) = prev_rhs_node
        && previous.span().contains_offset(reference.ident().start())
    {
        return prev_rhs_node;
    }
    let id = reference.expr()?;
    let parent = id.parent().as_expr()?;
    let ExprKind::Assign { target, value, .. } = parent.kind() else {
        return None;
    };
    if target != id || !is_unused_expression(parent) {
        return None;
    }
    let scope = reference.scope().variable_scope();
    let is_in_scope_of_variable = match reference.symbol() {
        Some(symbol) => symbol.scope().variable_scope() == scope,
        None => scope.kind() == ScopeKind::Global,
    };
    (is_in_scope_of_variable && !is_in_loop(Node::Expr(id), walks)).then_some(value)
}

/// ESLint's and typescript-eslint's `isStorableFunction`: the function `func_node`, which is inside
/// `rhs_node`, can be called later. It is assigned, passed to a call, or in a statement.
pub fn is_storable_function<'a>(
    func_node: Func<'a>,
    rhs_node: Expr<'a>,
    walks: &mut Walks<'a>,
) -> bool {
    let within = rhs_node.span();
    if walks.storable.0 != Some(rhs_node) {
        walks.storable = (Some(rhs_node), AncestorMemo::default());
    }
    let found = walks.storable.1.find(func_node.owner(), |node, parent| {
        if matches!(parent, Node::File(_)) || !within.contains(parent.span()) {
            return Some(false);
        }
        match parent {
            Node::Stmt(_) => Some(true),
            // ESTree has the `BlockStatement` of the body between the two.
            Node::Func(body_of) if matches!(node, Node::Stmt(_)) => {
                (body_of.kind() != FnKind::StaticBlock).then_some(true)
            }
            Node::Expr(e) => match e.kind() {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } if Node::Expr(right) != node => Some(false),
                ExprKind::Call(call) | ExprKind::New(call) => {
                    Some(Node::Expr(call.callee()) != node)
                }
                ExprKind::Assign { .. } if !is_assignment_target(e) => Some(true),
                ExprKind::TaggedTemplate(_) | ExprKind::Yield { .. } => Some(true),
                _ => None,
            },
            _ => None,
        }
    });
    found == Some(true)
}

/// ESLint's and typescript-eslint's `isInsideOfStorableFunction`: `id` is in a function inside
/// `rhs_node` that can be called later.
pub fn is_inside_of_storable_function<'a>(
    id: Node<'a>,
    rhs_node: Expr<'a>,
    walks: &mut Walks<'a>,
) -> bool {
    let function = (walks.functions).find(id, |_, ancestor| as_estree_function(ancestor));
    function.is_some_and(|func| {
        rhs_node.span().contains(func.owner().span()) && is_storable_function(func, rhs_node, walks)
    })
}

/// ESLint's and typescript-eslint's `isReadForItself`: the variable is read only to compute its
/// own next value. `a += 1` and `a++` whose value is not used, and the `a` on the right of
/// `a = a + 1`, for which `rhs_node` is what [`get_rhs_node`] returned for the reference before.
pub fn is_read_for_itself<'a>(
    reference: Reference<'a>,
    rhs_node: Option<Expr<'a>>,
    walks: &mut Walks<'a>,
) -> bool {
    if !reference.is_read() {
        return false;
    }
    let parent = reference
        .expr()
        .and_then(|id| Some((id, id.parent().as_expr()?)));
    let is_self_update = parent.is_some_and(|(id, parent)| match parent.kind() {
        ExprKind::Assign { op, target, .. } => {
            target == id
                && !matches!(op, Some(BinOp::And | BinOp::Or | BinOp::Nullish))
                && is_unused_expression(parent)
        }
        ExprKind::Unary { op, .. } => {
            matches!(
                op,
                UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec
            ) && is_unused_expression(parent)
        }
        _ => false,
    });
    is_self_update
        || rhs_node.is_some_and(|rhs| {
            rhs.span().contains_offset(reference.ident().start())
                && !is_inside_of_storable_function(reference.node(), rhs, walks)
        })
}

/// Whether one of `references`, those to one variable in source order, is a read that is not for
/// the variable itself and that `counts`.
#[inline]
fn has_use<'a>(
    references: impl Iterator<Item = Reference<'a>>,
    counts: impl Fn(Reference<'a>) -> bool,
    walks: &mut Walks<'a>,
) -> bool {
    let mut rhs_node = None;
    for reference in references {
        let flags = reference.flags();
        // Only what is written to is on the left of an assignment or the operand of an update, and
        // without an assignment before there is no right side to be in.
        // Nor is the name of a declaration.
        if rhs_node.is_some() || flags.contains(ReferenceFlags::WRITE) && reference.expr().is_some()
        {
            let is_for_itself = is_read_for_itself(reference, rhs_node, walks);
            rhs_node = get_rhs_node(reference, rhs_node, walks);
            if is_for_itself {
                continue;
            }
        }
        if flags.contains(ReferenceFlags::READ) && counts(reference) {
            return true;
        }
    }
    false
}

/// typescript-eslint's `isSelfReference` and `isInsideOneOf`, for what `isUsedVariable` passes to
/// them: the range in which a reference to what `definition` defines is one from its own
/// declaration. That is a function declaration, the function that a variable is initialized with, an
/// interface, a type alias, a namespace, an enum.
fn self_reference_range(definition: Declaration) -> Option<Span> {
    match definition {
        Declaration::Fn(func) => Some(func.span()),
        // The parameter of a `catch` has no initializer.
        Declaration::Var(pat) => {
            let init = declarator_of(pat)?.init()?;
            init.as_fn().map(|_| init.span())
        }
        Declaration::Interface(_)
        | Declaration::TypeAlias(_)
        | Declaration::Module(_)
        | Declaration::Enum(_) => definition.node().map(Node::span),
        _ => None,
    }
}

/// typescript-eslint's `isUsedVariable`: something reads the variable, other than to update it,
/// from outside of its own declaration, and for more than its type unless it is a type.
fn is_used_variable_with<'a>(variable: Variable<'a>, facts: Facts, walks: &mut Walks<'a>) -> bool {
    if !variable.symbol.has_reads() {
        return false;
    }
    // oxc has no reference to `React` for an element of JSX.
    let is_oxlint = variable.symbol.file().language().is_oxlint;
    let is_split = facts.has(Facts::CLASS);
    let references = variable
        .symbol
        .references()
        .filter(|it| !(is_oxlint && it.is_jsx_pragma()))
        .filter(|it| !is_split || variable.has_reference_at(it.ident().start()));
    let counts = |reference: Reference<'a>| {
        let is_from_outside = || {
            let start = reference.ident().start();
            !variable.symbol.declarations().any(|it| {
                self_reference_range(it).is_some_and(|range| range.contains_offset(start))
                    && is_definition(it)
            })
        };
        (!facts.has(Facts::NOT_IMPORTED_AS_TYPE)
            || !is_type_only_reference(variable.symbol, reference))
            && (!facts.has(Facts::HAS_RANGES) || is_from_outside())
            // It is written where the name is declared, and is in the scope around that.
            || reference.is_jsx_pragma()
    };
    has_use(references, counts, walks)
}

/// Whether a look at the first reference that reads `symbol` tells that [`is_used_variable_with`] holds for it, if it has
/// a definition at all, and its declarations that [`Facts::MARKED`] does not. Nearly every variable is such.
///
/// `properties`: [`parameter_properties`]
#[inline]
fn is_plainly_used(symbol: Symbol, properties: &SymbolSet) -> bool {
    let kinds = symbol.declaration_kinds();
    let plain = DeclarationKinds::VARIABLE
        | DeclarationKinds::CATCH_CLAUSE
        | DeclarationKinds::PARAMETER
        | DeclarationKinds::FUNCTION_NAME
        | DeclarationKinds::IMPORT_BINDING;
    // What nothing modifies is on the left of no assignment, and is not read for itself.
    if symbol.has_modifying_references() {
        return false;
    }
    if kinds == DeclarationKinds::TYPE {
        return is_plainly_used_type(symbol);
    }
    if kinds.is_empty() || !plain.contains(kinds) {
        return false;
    }
    if kinds.contains(DeclarationKinds::PARAMETER)
        && (symbol.name().atom() == known::this || properties.contains(symbol))
    {
        return false;
    }
    let is_oxlint = symbol.file().language().is_oxlint;
    let is_use = |it: &Reference| it.is_read() && !(is_oxlint && it.is_jsx_pragma());
    let Some(read) = symbol.references().find(is_use) else {
        return false;
    };
    // The ranges of `self_reference_range` are those of functions here.
    let has_ranges = kinds.intersects(DeclarationKinds::VARIABLE | DeclarationKinds::FUNCTION_NAME);
    !is_type_only_reference(symbol, read)
        && (!has_ranges
            || read.scope() == symbol.scope()
            || read.scope().variable_scope() == symbol.scope().variable_scope())
}

/// [`is_plainly_used`] for what only interfaces, type aliases and type parameters declare.
fn is_plainly_used_type(symbol: Symbol) -> bool {
    if symbol.declaration_count() != 1 {
        return false;
    }
    // `self_reference_range`
    let range = match symbol.declarations().next() {
        Some(Declaration::TypeParam(it)) if it.file().hir.mapped.is_empty() => None,
        Some(Declaration::Interface(it)) => Some(it.stmt().span()),
        Some(Declaration::TypeAlias(it)) => Some(it.stmt().span()),
        _ => return false,
    };
    symbol
        .references()
        .find(|it| it.is_read())
        .is_some_and(|read| {
            !is_type_only_reference(symbol, read)
                && range.is_none_or(|it| !it.contains_offset(read.ident().start()))
        })
}

/// Whether the kinds of its declarations tell that [`Facts::MARKED`] holds for `symbol`.
#[inline]
fn is_plainly_marked(symbol: Symbol, properties: &SymbolSet) -> bool {
    let kinds = symbol.declaration_kinds();
    kinds == DeclarationKinds::TS_ENUM_MEMBER
        || kinds == DeclarationKinds::PARAMETER && properties.contains(symbol)
}

/// What the parameter properties of the file declare.
fn parameter_properties<'a>(file: &'a File<'a>) -> SymbolSet {
    let mut properties = SymbolSet::default();
    for id in 0..file.hir.params.len() {
        let param = Param::new(file, hir::ParamId(id as u32));
        if param.is_parameter_property()
            && param.func().map(Func::kind) != Some(FnKind::IndexSignature)
            && let Some(symbol) = param.pat().symbol()
        {
            properties.insert(symbol);
        }
    }
    properties
}

/// typescript-eslint's `isUsedVariable` for a variable of the global scope that the file does not
/// declare, which is no [`Symbol`]: one that a `/* global name */` comment or the configuration
/// defines.
pub fn is_used_global_variable<'a>(file: &'a File<'a>, name: &[u8]) -> bool {
    file.unresolved_references_to(name)
        .any(is_assigned_by_loop_that_only_returns)
        || has_use(
            file.unresolved_references_to(name),
            |_| true,
            &mut Walks::default(),
        )
}

// ───────────────────────────── the analysis ─────────────────────────────

/// typescript-eslint's `VariableAnalysis`.
#[derive(Debug, Default)]
pub struct VariableAnalysis<'a> {
    unused_variables: Vec<Variable<'a>>,
    used_variables: Vec<Variable<'a>>,
    unused: SymbolSet,
    eslint_used: UsedMarks,
}

impl<'a> VariableAnalysis<'a> {
    /// `unusedVariables`
    #[inline]
    pub fn unused_variables(&self) -> &[Variable<'a>] {
        &self.unused_variables
    }

    /// `usedVariables`. The variable that the name of a class is inside the class is always here,
    /// also if the class is among the unused. Empty after [`collect_unused_variables`].
    #[inline]
    pub fn used_variables(&self) -> &[Variable<'a>] {
        &self.used_variables
    }

    /// `unusedVariables.has(variable)`, for the variable that `symbol` is in the scope it is
    /// declared in.
    #[inline]
    pub fn is_unused(&self, symbol: Symbol<'a>) -> bool {
        self.unused.contains(symbol)
    }

    /// `variable.eslintUsed` after the analysis.
    #[inline]
    pub fn is_eslint_used(&self, variable: Variable<'a>) -> bool {
        variable.class.is_some() || self.eslint_used.contains(variable.symbol)
    }
}

/// typescript-eslint's `collectVariables`: every variable of the file, as used or unused.
///
/// What has `variable.eslintUsed` set before is what is in `eslint_used`, and what
/// [`Symbol::is_marked_used`] holds for. `/* exported */` comments are applied here.
///
/// Not among the variables, as upstream: the names of function expressions, and what a script
/// declares at its top level under a name that a library of TypeScript defines. And the globals
/// that the file does not declare, which are no [`Symbol`]s: see [`is_used_global_variable`].
pub fn collect_variables<'a>(file: &'a File<'a>, eslint_used: UsedMarks) -> VariableAnalysis<'a> {
    collect(file, eslint_used, true)
}

/// [`collect_variables`] for who does not ask for [`VariableAnalysis::used_variables`].
pub fn collect_unused_variables<'a>(
    file: &'a File<'a>,
    eslint_used: UsedMarks,
) -> VariableAnalysis<'a> {
    collect(file, eslint_used, false)
}

fn collect<'a>(
    file: &'a File<'a>,
    eslint_used: UsedMarks,
    keeps_used: bool,
) -> VariableAnalysis<'a> {
    let mut analysis = VariableAnalysis::default();
    if keeps_used {
        analysis
            .used_variables
            .reserve(file.symbols().size_hint().1.unwrap_or(0));
    }
    let mut marks = Marker {
        marks: eslint_used,
        unshared: Vec::new(),
        scope: None,
    };
    marks.marks.mark_exported_variables(file);
    mark_global_augmentations(file, &mut marks);
    mark_identifiers_in_parameters(file, &mut marks);
    let marked_by_loops = variables_of_loops_that_only_return(file);
    let declares_globals = file.scope().symbols().len() != 0;
    let mut walks = Walks::default();
    let properties = parameter_properties(file);
    for symbol in file.symbols() {
        if !keeps_used && !declares_globals {
            // What is marked is used, if it has a definition.
            if marks.contains(symbol)
                || is_plainly_used(symbol, &properties)
                    && !marked_by_loops.contains(symbol)
                    && !symbol.is_marked_used()
            {
                continue;
            }
            if is_plainly_marked(symbol, &properties) {
                marks.mark(symbol);
                continue;
            }
        }
        let variable = Variable::new(symbol);
        let facts = Facts::of(variable);
        if keeps_used && facts.has(Facts::CLASS) {
            let classes = symbol.declarations().filter_map(|it| match it {
                Declaration::Class(class) if class.name().is_some() => Some(Variable {
                    symbol,
                    class: Some(class),
                }),
                _ => None,
            });
            analysis.used_variables.extend(classes);
        }
        if !facts.has(Facts::DEFINED) {
            continue;
        }
        // In a script, `var Array` is one more definition of an `ImplicitLibVariable`.
        if declares_globals
            && symbol.scope().kind() == ScopeKind::Global
            && file
                .global(symbol.name().bytes())
                .is_some_and(|it| it.is_in_lib)
        {
            continue;
        }
        let mut is_marked = marks.contains(symbol);
        if !is_marked
            && (facts.has(Facts::MARKED)
                || marked_by_loops.contains(symbol)
                || symbol.is_marked_used())
        {
            marks.mark(symbol);
            is_marked = true;
        }
        if is_marked
            || is_used_variable_with(variable, facts, &mut walks)
            || is_exported_with(variable, facts)
        {
            if keeps_used {
                analysis.used_variables.push(variable);
            }
        } else {
            analysis.unused_variables.push(variable);
            analysis.unused.insert(symbol);
        }
    }
    analysis.eslint_used = marks.share();
    analysis
}

// ───────────────────────────── where an identifier is in a pattern ─────────────────────────────

/// Whether the parent of the identifier `pat` is an `ArrayPattern`.
fn is_array_pattern_element(pat: Pat<'_>) -> bool {
    matches!(pat.parent(), Node::PatElem(it) if !it.is_rest() && it.default().is_none())
}

/// `no-unused-vars`' `def.name.parent.type === "ArrayPattern"`.
pub fn is_defined_in_array_pattern(def: Declaration<'_>) -> bool {
    match def {
        Declaration::Var(pat) | Declaration::Param(pat) => is_array_pattern_element(pat),
        _ => false,
    }
}

/// `no-unused-vars`' `ref.identifier.parent.type === "ArrayPattern"`.
pub fn is_referenced_in_array_pattern(reference: Reference<'_>) -> bool {
    match reference.node() {
        Node::Pat(pat) => is_array_pattern_element(pat),
        Node::Expr(id) => matches!(
            id.parent(),
            Node::Expr(parent) if parent.tag() == ExprTag::Array && parent.is_assignment_target()
        ),
        _ => false,
    }
}

/// Whether the last property of the object pattern that `property` is in is a rest element.
fn is_followed_by_rest(property: PatProp<'_>) -> bool {
    matches!(
        property.parent(),
        Node::Pat(object) if matches!(
            object.kind(),
            PatKind::Object(properties) if properties.last().is_some_and(PatProp::is_rest)
        )
    )
}

/// `no-unused-vars`' `hasRestSibling(id.parent)`, for the identifier of a definition (a `Node::Pat`)
/// or of a reference (`reference.node()`): it is a property of an object pattern that ends with a
/// rest element.
pub fn has_rest_sibling(id: Node<'_>) -> bool {
    match (id, id.parent()) {
        (Node::Pat(_), Node::PatProp(property)) => {
            !property.is_rest() && property.default().is_none() && is_followed_by_rest(property)
        }
        // A computed key.
        (Node::Expr(key), Node::PatProp(property)) => {
            property.default() != Some(key) && is_followed_by_rest(property)
        }
        (Node::Expr(_), Node::Prop(property)) if property.kind() != PropKind::Spread => {
            match property
                .parent()
                .as_expr()
                .map(|object| (object, object.kind()))
            {
                Some((object, ExprKind::Object(properties))) => {
                    properties
                        .last()
                        .is_some_and(|last| last.kind() == PropKind::Spread)
                        && object.is_assignment_target()
                }
                _ => false,
            }
        }
        _ => false,
    }
}
