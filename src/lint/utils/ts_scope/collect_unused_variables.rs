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
use super::{
    is_type_definition, is_type_import, is_type_only_reference, is_variable_declarator_definition,
    is_variable_definition,
};
use crate::ast::{
    BinOp, Class, Expr, ExprKind, ExprTag, File, Flags, FnKind, Func, Handle, Key, KeyKind, Module,
    ModuleName, Name, Node, Pat, PatKind, PatProp, PropKind, Stmt, StmtKind, StmtTag, TypeKind,
    TypeTag, UnOp,
};
use crate::semantic::{Declaration, Reference, Scope, ScopeKind, SymFlags, Symbol};
use crate::span::Span;
use crate::tokens::TokenKind;
use crate::utils::directives::match_directives_pattern;
use crate::utils::estree_compat::is_assignment_target;
use crate::utils::text::{code_points, is_js_whitespace, trim};
use bun_core::strings;
use bun_sema::hir;
use smallvec::SmallVec;

// ───────────────────────────── eslintUsed ─────────────────────────────

/// Some of the symbols of one file: a bit for each.
#[derive(Clone, Debug, Default)]
pub struct SymbolSet {
    words: Vec<u64>,
}

impl SymbolSet {
    pub fn insert(&mut self, symbol: Symbol) {
        let at = symbol.id().idx();
        if self.words.len() <= at / 64 {
            self.words.resize(at / 64 + 1, 0);
        }
        if let Some(word) = self.words.get_mut(at / 64) {
            *word |= 1 << (at % 64);
        }
    }

    pub fn contains(&self, symbol: Symbol) -> bool {
        let at = symbol.id().idx();
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
    /// `variable.eslintUsed = true`
    #[inline]
    pub fn mark(&mut self, symbol: Symbol) {
        self.marked.insert(symbol);
    }

    /// `variable.eslintUsed`
    #[inline]
    pub fn contains(&self, symbol: Symbol) -> bool {
        self.marked.contains(symbol)
    }

    /// ESLint's `sourceCode.markVariableAsUsed(name, node)`: marks what `name` means at `node`.
    /// `false` if the file declares nothing of that name there.
    pub fn mark_variable_as_used<'a>(&mut self, name: &str, node: impl Into<Node<'a>>) -> bool {
        let symbol = node.into().scope().resolve(name);
        if let Some(symbol) = symbol {
            self.mark(symbol);
        }
        symbol.is_some()
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
            let directive = trim(without_justification(comment.comment_value()));
            if match_directives_pattern(directive) != Some("exported") {
                continue;
            }
            let list = directive.get("exported".len()..).unwrap_or_default();
            for item in strings::split(list, b",") {
                let name = without_quotes(trim(item));
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
    for (at, c) in code_points(value) {
        if is_js_whitespace(c) {
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

/// Whether what is written at `span` is in the scope of `class`: after its name.
fn is_in_class_scope(class: Class, span: Span) -> bool {
    let whole = class.span();
    let after_name = class.name().map_or(whole.start, |name| name.span().end);
    after_name <= span.start && span.end <= whole.end
}

/// The `A` or the `B` of `namespace A.B {}`, which declare nothing in scope-manager.
fn is_part_of_qualified_name(module: Module) -> bool {
    module.nested().is_some()
        || matches!(
            module.stmt().parent().as_stmt().map(Stmt::kind),
            Some(StmtKind::Module(outer)) if outer.nested() == Some(module)
        )
}

/// Whether scope-manager has a definition for `declaration` in the scope around it.
fn is_definition(declaration: Declaration) -> bool {
    match declaration {
        Declaration::Fn(func) => func.kind() == FnKind::Decl && func.name().is_some(),
        Declaration::Class(class) => {
            class.name().is_some() && matches!(class.owner(), Node::Stmt(_))
        }
        Declaration::Module(module) => {
            matches!(module.name(), ModuleName::Ident(_)) && !is_part_of_qualified_name(module)
        }
        Declaration::Param(pat) => !matches!(
            pat.parent(),
            Node::Param(param) if param.func().is_some_and(|it| it.kind() == FnKind::IndexSignature)
        ),
        Declaration::Other => false,
        _ => true,
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

    /// The variable that the name of `class` is inside the class. `None` if it has no name.
    pub fn in_class_scope(class: Class<'a>) -> Option<Self> {
        class.name()?;
        Some(Variable {
            symbol: class.symbol()?,
            class: Some(class),
        })
    }

    #[inline]
    pub fn symbol(self) -> Symbol<'a> {
        self.symbol
    }

    /// The class, if this is the variable that its name is inside it.
    #[inline]
    pub fn class_scope(self) -> Option<Class<'a>> {
        self.class
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
        let is_class = self.symbol.flags().contains(SymFlags::CLASS);
        self.symbol
            .references()
            .filter(move |it| !is_class || self.has_reference_at(it.span()))
    }

    fn has_reference_at(self, span: Span) -> bool {
        match self.class {
            Some(class) => is_in_class_scope(class, span),
            None => !self.symbol.declarations().any(
                |it| matches!(it, Declaration::Class(class) if is_in_class_scope(class, span)),
            ),
        }
    }

    /// `variable.isTypeVariable`
    pub fn is_type_variable(self) -> bool {
        self.defs().any(is_type_definition)
    }

    /// `variable.isValueVariable`
    pub fn is_value_variable(self) -> bool {
        self.defs().any(is_variable_definition)
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

/// Whether `pat` is the first name that the head of such a loop declares.
fn is_declared_by_loop_that_only_returns<'a>(pat: Pat<'a>, declaration: Declaration<'a>) -> bool {
    let Some(Node::VarDecl(declarator)) = declaration.node() else {
        return false;
    };
    let Node::Stmt(head) = declarator.parent() else {
        return false;
    };
    if head
        .parent()
        .as_stmt()
        .and_then(head_of_loop_that_only_returns)
        != Some(head)
    {
        return false;
    }
    let mut first = None;
    declarator.pat().for_each_binding(&mut |binding| {
        first.get_or_insert(binding);
    });
    first == Some(pat)
}

/// What `UnusedVarsVisitor` marks because of how it is declared: enum members, the key of a mapped
/// type, parameter properties, `this` parameters, and the variable of a loop that only returns.
fn is_declaration_marked_as_used(declaration: Declaration) -> bool {
    match declaration {
        Declaration::EnumMember(_) => true,
        Declaration::TypeParam(param) => {
            matches!(param.parent(), Node::Type(ty) if ty.tag() == TypeTag::Mapped)
        }
        Declaration::Param(pat) => {
            matches!(pat.parent(), Node::Param(param) if param.is_parameter_property())
                || pat.as_ident().is_some_and(|name| name.is("this"))
        }
        Declaration::Var(pat) => is_declared_by_loop_that_only_returns(pat, declaration),
        _ => false,
    }
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

fn is_marked_as_used(variable: Variable) -> bool {
    variable.defs().any(is_declaration_marked_as_used)
        || variable
            .references()
            .any(is_assigned_by_loop_that_only_returns)
}

/// `declare global {}` marks what `global` means around it.
fn mark_global_augmentations<'a>(file: &'a File<'a>, marks: &mut UsedMarks) {
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

fn mark_identifier<'a>(name: Name<'a>, holder: Node<'a>, marks: &mut UsedMarks) {
    // Inside a class its name is the other variable, which counts as used anyway.
    if let Some(symbol) = holder.scope().resolve_name(name)
        && (!symbol.flags().contains(SymFlags::CLASS)
            || Variable::new(symbol).has_reference_at(holder.span()))
    {
        marks.mark(symbol);
    }
}

fn mark_key<'a>(key: Option<Key<'a>>, holder: Node<'a>, marks: &mut UsedMarks) {
    if let Some(KeyKind::Ident(name)) = key.map(Key::kind) {
        mark_identifier(name, holder, marks);
    }
}

/// Marks what the name of every `Identifier` of ESTree in `node` means where it is written, whether
/// it refers to that or not: the `b` of `a.b`, a key, a label.
fn mark_identifiers<'a>(node: Node<'a>, marks: &mut UsedMarks) {
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
                jsx.type_args()
                    .iter()
                    .for_each(|it| mark_identifiers(Node::Type(it), marks));
                jsx.attrs()
                    .iter()
                    .for_each(|it| mark_identifiers(Node::Prop(it), marks));
                jsx.children()
                    .iter()
                    .for_each(|it| mark_identifiers(Node::Expr(it), marks));
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
                        mark_identifiers(child, marks);
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
    node.for_each_child(|child| mark_identifiers(child, marks));
}

/// Upstream's `visitFunctionTypeSignature` and `visitSetter`. They mean to mark the parameters, and
/// visit each with a `PatternVisitor` that, with the option `visitChildrenEvenIfSelectorExists` of
/// the visitor around it, goes on into type annotations and default values.
fn mark_identifiers_in_parameters<'a>(file: &'a File<'a>, marks: &mut UsedMarks) {
    for id in 0..file.hir.fns.len() {
        let func = Func::new(file, hir::FnId(id as u32));
        if has_marked_parameters(func)
            && !matches!(func.owner(), Node::File(_))
            && !func.is_synthetic()
        {
            for param in func.this_param().into_iter().chain(func.params()) {
                mark_identifiers(Node::Param(param), marks);
            }
        }
    }
}

// ───────────────────────────── exports ─────────────────────────────

/// The statement of `declaration`, if ESTree has an `ExportNamedDeclaration` or an
/// `ExportDefaultDeclaration` around it.
fn exported_statement(declaration: Declaration<'_>) -> Option<Stmt<'_>> {
    let statement = match declaration {
        Declaration::Var(_) => declaration.node()?.parent(),
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
fn is_merged_type_declaration(variable: Variable, declaration: Declaration) -> bool {
    matches!(
        declaration,
        Declaration::Interface(_) | Declaration::TypeAlias(_)
    ) && variable.is_type_variable()
        && variable.is_value_variable()
}

/// typescript-eslint's `isExported` of `collectUnusedVariables`: one of the declarations starts
/// with `export`. `export { a }` is a reference instead.
pub fn is_exported(variable: Variable) -> bool {
    variable
        .defs()
        .any(|it| exported_statement(it).is_some() && !is_merged_type_declaration(variable, it))
}

/// typescript-eslint's `isMergeableExported` (`isMergableExported`): the first declaration that is
/// an exported class, function, interface, namespace or type alias, or is exported by default,
/// decides. It holds for nothing that [`is_exported`] does not hold for.
pub fn is_mergeable_exported(variable: Variable) -> bool {
    let is_mergeable = |it: Declaration| match it {
        Declaration::Fn(func) => func.has_body(),
        Declaration::Class(_)
        | Declaration::Interface(_)
        | Declaration::Module(_)
        | Declaration::TypeAlias(_) => true,
        _ => false,
    };
    let decides = |it: &Declaration| {
        !matches!(it, Declaration::Var(_))
            && exported_statement(*it).is_some_and(|statement| {
                is_mergeable(*it) || statement.flags().contains(Flags::DEFAULT)
            })
    };
    variable
        .defs()
        .find(decides)
        .is_some_and(|it| !is_merged_type_declaration(variable, it))
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

/// ESLint's `isInLoop`: there is a loop around `node` in its function.
fn is_in_loop(node: Node) -> bool {
    for ancestor in node.ancestors() {
        match ancestor {
            Node::Stmt(statement) if statement.is_loop() => return true,
            _ if as_estree_function(ancestor).is_some() => return false,
            _ => {}
        }
    }
    false
}

/// ESLint's and typescript-eslint's `getRhsNode`. If `reference` is the left side of an assignment
/// whose value is not used, in the function that declares the variable and in no loop: the right
/// side. If it is inside `prev_rhs_node`: that.
pub fn get_rhs_node<'a>(
    reference: Reference<'a>,
    prev_rhs_node: Option<Expr<'a>>,
) -> Option<Expr<'a>> {
    if let Some(previous) = prev_rhs_node
        && previous.span().contains(reference.span())
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
    (is_in_scope_of_variable && !is_in_loop(Node::Expr(id))).then_some(value)
}

/// ESLint's and typescript-eslint's `isStorableFunction`: the function `func_node`, which is inside
/// `rhs_node`, can be called later. It is assigned, passed to a call, or in a statement.
pub fn is_storable_function<'a>(func_node: Func<'a>, rhs_node: Expr<'a>) -> bool {
    let within = rhs_node.span();
    let mut node = func_node.owner();
    loop {
        let parent = node.parent();
        if matches!(parent, Node::File(_)) || !within.contains(parent.span()) {
            return false;
        }
        match parent {
            Node::Stmt(_) => return true,
            // ESTree has the `BlockStatement` of the body between the two.
            Node::Func(body_of) if matches!(node, Node::Stmt(_)) => {
                if body_of.kind() != FnKind::StaticBlock {
                    return true;
                }
            }
            Node::Expr(e) => match e.kind() {
                ExprKind::Binary {
                    op: BinOp::Comma,
                    right,
                    ..
                } if Node::Expr(right) != node => return false,
                ExprKind::Call(call) | ExprKind::New(call) => {
                    return Node::Expr(call.callee()) != node;
                }
                ExprKind::Assign { .. } if !is_assignment_target(e) => return true,
                ExprKind::TaggedTemplate(_) | ExprKind::Yield { .. } => return true,
                _ => {}
            },
            _ => {}
        }
        node = parent;
    }
}

/// ESLint's and typescript-eslint's `isInsideOfStorableFunction`: `id` is in a function inside
/// `rhs_node` that can be called later.
pub fn is_inside_of_storable_function<'a>(id: Node<'a>, rhs_node: Expr<'a>) -> bool {
    id.ancestors()
        .find_map(as_estree_function)
        .is_some_and(|func| {
            rhs_node.span().contains(func.owner().span()) && is_storable_function(func, rhs_node)
        })
}

/// ESLint's and typescript-eslint's `isReadForItself`: the variable is read only to compute its
/// own next value. `a += 1` and `a++` whose value is not used, and the `a` on the right of
/// `a = a + 1`, for which `rhs_node` is what [`get_rhs_node`] returned for the reference before.
pub fn is_read_for_itself<'a>(reference: Reference<'a>, rhs_node: Option<Expr<'a>>) -> bool {
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
            rhs.span().contains(reference.span())
                && !is_inside_of_storable_function(reference.node(), rhs)
        })
}

/// Whether one of `references`, those to one variable in source order, is a read that is not for
/// the variable itself and that `counts`.
fn has_use<'a>(
    references: impl Iterator<Item = Reference<'a>>,
    counts: impl Fn(Reference<'a>) -> bool,
) -> bool {
    let mut rhs_node = None;
    for reference in references {
        let is_for_itself = is_read_for_itself(reference, rhs_node);
        rhs_node = get_rhs_node(reference, rhs_node);
        if reference.is_read() && !is_for_itself && counts(reference) {
            return true;
        }
    }
    false
}

/// typescript-eslint's `isSelfReference` and `isInsideOneOf`, for what `isUsedVariable` passes to
/// them: the ranges in which a reference to `variable` is one from its own declaration. Those are
/// its function declarations, the functions that it is initialized with, its interfaces, type
/// aliases, namespaces and enums.
pub fn get_self_reference_ranges(variable: Variable) -> SmallVec<[Span; 2]> {
    let mut ranges = SmallVec::new();
    for declaration in variable.defs() {
        match declaration {
            Declaration::Fn(func) => ranges.push(func.span()),
            Declaration::Var(_) if is_variable_declarator_definition(declaration) => {
                if let Some(Node::VarDecl(declarator)) = declaration.node()
                    && let Some(init) = declarator.init()
                    && init.tag() == ExprTag::Fn
                {
                    ranges.push(init.span());
                }
            }
            Declaration::Interface(_)
            | Declaration::TypeAlias(_)
            | Declaration::Module(_)
            | Declaration::Enum(_) => ranges.extend(declaration.node().map(Node::span)),
            _ => {}
        }
    }
    ranges
}

/// typescript-eslint's `isUsedVariable`: something reads the variable, other than to update it,
/// from outside of its own declaration, and for more than its type unless it is a type.
pub fn is_used_variable(variable: Variable) -> bool {
    let own = get_self_reference_ranges(variable);
    let is_imported_as_type = variable.defs().all(is_type_import);
    has_use(variable.references(), |reference| {
        // It is written where the name is declared, and is in the scope around that.
        reference.is_jsx_pragma()
            || (is_imported_as_type || !is_type_only_reference(variable.symbol(), reference))
                && !own.iter().any(|range| range.contains(reference.span()))
    })
}

/// typescript-eslint's `isUsedVariable` for a variable of the global scope that the file does not
/// declare, which is no [`Symbol`]: one that a `/* global name */` comment or the configuration
/// defines.
pub fn is_used_global_variable<'a>(file: &'a File<'a>, name: &[u8]) -> bool {
    has_use(
        file.unresolved_references()
            .filter(|reference| reference.name() == name),
        |_| true,
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
    /// also if the class is among the unused.
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
    let mut analysis = VariableAnalysis {
        eslint_used,
        ..VariableAnalysis::default()
    };
    analysis.eslint_used.mark_exported_variables(file);
    mark_global_augmentations(file, &mut analysis.eslint_used);
    mark_identifiers_in_parameters(file, &mut analysis.eslint_used);
    let declares_globals = file.scope().symbols().len() != 0;
    for symbol in file.symbols() {
        if symbol.flags().contains(SymFlags::CLASS) {
            let classes = symbol.declarations().filter_map(|it| match it {
                Declaration::Class(class) => Variable::in_class_scope(class),
                _ => None,
            });
            analysis.used_variables.extend(classes);
        }
        let variable = Variable::new(symbol);
        if variable.defs().next().is_none() {
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
        if !analysis.eslint_used.contains(symbol)
            && (symbol.is_marked_used() || is_marked_as_used(variable))
        {
            analysis.eslint_used.mark(symbol);
        }
        if analysis.eslint_used.contains(symbol)
            || is_exported(variable)
            || is_used_variable(variable)
        {
            analysis.used_variables.push(variable);
        } else {
            analysis.unused_variables.push(variable);
            analysis.unused.insert(symbol);
        }
    }
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
            Node::Expr(parent) if parent.tag() == ExprTag::Array && is_assignment_target(parent)
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
                        && is_assignment_target(object)
                }
                _ => false,
            }
        }
        _ => false,
    }
}
