use bun_lint::fix::Removal;
use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKinds;
use bun_lint::utils::oxlint::has_module_syntax;
use bun_lint::utils::ts_scope::{
    Walks, get_rhs_node, has_rest_sibling, is_defined_in_array_pattern, is_read_for_itself,
    is_referenced_in_array_pattern,
};
use bun_lint::utils::{estree_span, get_node_by_range_index};

/// Disallow unused variables.
pub struct NoUnusedVars {
    pub vars: Vars,
    pub args: Args,
    pub ignore_rest_siblings: bool,
    pub checks_caught_errors: bool,
    pub ignore_class_with_static_init_block: bool,
    pub ignore_using_declarations: bool,
    pub report_used_ignore_pattern: bool,
    pub vars_ignore_pattern: Option<Pattern>,
    pub args_ignore_pattern: Option<Pattern>,
    pub caught_errors_ignore_pattern: Option<Pattern>,
    pub destructured_array_ignore_pattern: Option<Pattern>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Vars {
    All,
    Local,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Args {
    All,
    AfterUsed,
    None,
}

pub const UNUSED_VAR: Message = Message::new(
    "unusedVar",
    "'{{varName}}' is {{action}} but never used{{additional}}.",
);
pub const USED_IGNORED_VAR: Message = Message::new(
    "usedIgnoredVar",
    "'{{varName}}' is marked as ignored but is used{{additional}}.",
);
const REMOVE_VAR: Message = Message::new("removeVar", "Remove unused variable '{{varName}}'.");

// ───────────────────────────── options ─────────────────────────────

/// One of the `..IgnorePattern` options.
pub struct Pattern {
    /// `None` means `^_`, the most common pattern and the default with no config file. It's matched without JavaScriptCore.
    regex: Option<Regex>,
    /// `String(regex)`
    text: String,
}

impl Pattern {
    fn new(options: Object, key: &str) -> Option<Pattern> {
        let source = options.str(key).filter(|source| !source.is_empty())?;
        if source == "^_" {
            return Some(Pattern {
                regex: None,
                text: "/^_/u".to_string(),
            });
        }
        let regex = options.regex(key, "u")?;
        Some(Pattern {
            text: regex.to_string(),
            regex: Some(regex),
        })
    }

    pub fn test(&self, name: Name) -> bool {
        match &self.regex {
            Some(regex) => regex.test(name.bytes()),
            None => name.bytes().starts_with(b"_"),
        }
    }

    /// The pattern as written in the config.
    pub fn source(&self) -> &str {
        self.text
            .strip_prefix('/')
            .and_then(|it| it.strip_suffix("/u"))
            .unwrap_or(&self.text)
    }
}

/// How a message describes a variable, which also decides which ignore pattern it mentions.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum VariableType {
    ArrayDestructure,
    CatchClause,
    Parameter,
    Variable,
}

// ───────────────────────────── variables ─────────────────────────────

/// Returns the `VarDecl` that the pattern `pat` is part of.
fn declarator(pat: Pat<'_>) -> Option<VarDecl<'_>> {
    if let Node::VarDecl(declaration) = pat.parent() {
        return Some(declaration);
    }
    match Declaration::Var(pat).node()? {
        Node::VarDecl(declaration) => Some(declaration),
        _ => None,
    }
}

/// The range of ESLint's `def.name`.
fn name_span(def: Declaration) -> Option<Span> {
    match def {
        Declaration::Var(pat) | Declaration::Param(pat) => Some(estree_span(Node::Pat(pat))),
        _ => def.name_span(),
    }
}

/// The range of ESLint's `reference.identifier`.
fn identifier_span(reference: Reference) -> Span {
    match reference.node() {
        Node::Pat(pat) => estree_span(Node::Pat(pat)),
        _ => reference.span(),
    }
}

/// ESLint's `isExported`.
fn is_exported(def: Declaration) -> bool {
    let statement = match def {
        Declaration::Var(pat) => declarator(pat).and_then(|it| it.parent().as_stmt()),
        Declaration::Fn(func) => func.owner().as_stmt(),
        Declaration::Class(class) => class.owner().as_stmt(),
        Declaration::Interface(it) => Some(it.stmt()),
        Declaration::TypeAlias(it) => Some(it.stmt()),
        Declaration::Enum(it) => Some(it.stmt()),
        Declaration::Module(it) => Some(it.stmt()),
        Declaration::ImportEquals(it) => Some(it.stmt()),
        _ => None,
    };
    statement.is_some_and(Stmt::is_exported)
}

/// ESLint's `usesExplicitResourceManagement`.
fn uses_explicit_resource_management(def: Declaration) -> bool {
    match def {
        Declaration::Var(pat) => declarator(pat)
            .is_some_and(|it| matches!(it.var_kind(), VarKind::Using | VarKind::AwaitUsing)),
        _ => false,
    }
}

/// ESLint's `isSelfReference` with `getFunctionDefinitions`: `reference` is in a function that the variable names, or
/// is initialized with.
fn is_self_reference<'a>(variable: Variable<'a>, reference: Reference<'a>) -> bool {
    let Some(symbol) = variable.symbol() else {
        return false;
    };
    let function = |def: Declaration<'a>| match def {
        Declaration::Fn(func) => func.scope(),
        Declaration::Var(pat) => declarator(pat)?.init()?.as_fn()?.scope(),
        _ => None,
    };
    symbol
        .declarations()
        .filter_map(function)
        .any(|scope| scope.contains(reference.scope()))
}

/// ESLint's `isForInOfRef`.
fn is_for_in_of_ref(reference: Reference) -> bool {
    let target = match reference
        .expr()
        .map_or_else(|| reference.node(), Node::Expr)
    {
        Node::Pat(pat) => match pat.parent() {
            Node::VarDecl(declaration) => declaration.parent().parent(),
            _ => return false,
        },
        Node::Expr(e) => e.parent(),
        _ => return false,
    };
    let Node::Stmt(mut target) = target else {
        return false;
    };
    if target.is_wrapper()
        && let Node::Stmt(statement) = target.parent()
    {
        target = statement;
    }
    let (StmtKind::ForIn { body, .. } | StmtKind::ForOf { body, .. }) = target.kind() else {
        return false;
    };
    let first = match body.kind() {
        StmtKind::Block(statements) => statements.first(),
        _ => Some(body),
    };
    first.is_some_and(|it| it.tag() == StmtTag::Return)
}

/// ESLint's `isUsedVariable`, except for the `eslintUsed` check.
fn is_used_variable(variable: Variable) -> bool {
    let (mut rhs, mut walks) = (None, None);
    variable.references().any(|reference| {
        if is_for_in_of_ref(reference) {
            return true;
        }
        // Only a write reference can be an assignment's left side or an update's operand, and without an earlier
        // assignment there's no right side to be in.
        let mut is_for_itself = false;
        if reference.is_write() || rhs.is_some() {
            let walks = walks.get_or_insert_with(Walks::default);
            is_for_itself = is_read_for_itself(reference, rhs, walks);
            rhs = get_rhs_node(reference, rhs, walks);
        }
        reference.is_read() && !is_for_itself && !is_self_reference(variable, reference)
    })
}

/// Fast path: true if the first reference that reads `symbol` is enough to prove [`is_used_variable`]. That's the case
/// for nearly every variable.
fn is_obviously_used(symbol: Symbol) -> bool {
    let kinds = symbol.declaration_kinds();
    // A variable that's never modified is never an assignment's left side, so it's never read just to update itself.
    if kinds.contains(DeclarationKinds::CLASS_NAME) || symbol.has_modifying_references() {
        return false;
    }
    // A reference directly in the function that declares the variable can't be inside a function the variable names.
    let names_functions =
        kinds.intersects(DeclarationKinds::VARIABLE | DeclarationKinds::FUNCTION_NAME);
    symbol
        .references()
        .find(|it| it.is_read())
        .is_some_and(|read| {
            !names_functions || read.scope().variable_scope() == symbol.scope().variable_scope()
        })
}

/// True if, in ESLint, `func` is the `value` of a `Property` or `MethodDefinition` whose `kind` is `"set"`. An abstract
/// setter is a `TSAbstractMethodDefinition`, and a setter in an interface or type literal is a `TSMethodSignature`.
fn is_setter(func: Func) -> bool {
    func.kind() == FnKind::Setter
        && !matches!(
            func.owner(),
            Node::Member(it) if it.is_signature() || it.flags().contains(Flags::ABSTRACT)
        )
}

/// True if `pat` is the first occurrence of the parameter `symbol`: `function (a, b, a) {}`
pub fn is_first_parameter_named<'a>(symbol: Symbol<'a>, pat: Pat<'a>) -> bool {
    let first = symbol.declarations().find_map(|def| match def {
        Declaration::Param(it) => Some(it),
        _ => None,
    });
    first == Some(pat)
}

/// Returns the start offset of `func`'s last used parameter (its first occurrence), or 0.
fn last_used_arg(func: Func) -> u32 {
    let mut last = 0;
    for param in func.params_with_this() {
        param.pat().for_each_binding(&mut |pat| {
            if let Some(it) = pat.symbol()
                && (it.references().next().is_some() || it.is_marked_used())
                && is_first_parameter_named(it, pat)
            {
                last = last.max(pat.span().start);
            }
        });
    }
    last
}

/// ESLint's `isAfterLastUsedArg`, for a parameter `symbol` of `func`.
fn is_after_last_used_arg<'a>(func: Func<'a>, symbol: Symbol<'a>) -> bool {
    let first = symbol.declarations().filter_map(|def| match def {
        Declaration::Param(pat) => Some(pat.span().start),
        _ => None,
    });
    first.min().is_none_or(|first| last_used_arg(func) <= first)
}

// ───────────────────────────── suggestions ─────────────────────────────

/// A node that can have a `...` or a default value.
#[derive(Copy, Clone)]
enum Holder<'a> {
    Prop(PatProp<'a>),
    Elem(PatElem<'a>),
    Param(Param<'a>),
}

/// An ESTree node that's part of a binding pattern, or has one.
#[derive(Copy, Clone)]
enum Estree<'a> {
    Identifier(Pat<'a>),
    ArrayPattern(Pat<'a>),
    ObjectPattern(Pat<'a>),
    /// In an `ObjectPattern`.
    Property(PatProp<'a>),
    RestElement(Holder<'a>),
    AssignmentPattern(Holder<'a>),
    VariableDeclarator(VarDecl<'a>),
    /// A `FunctionDeclaration`, a `FunctionExpression` or an `ArrowFunctionExpression`.
    Function(Func<'a>),
    CatchClause,
    Other,
}

impl<'a> Estree<'a> {
    fn of(pat: Pat<'a>) -> Self {
        match pat.kind() {
            PatKind::Object(_) => Estree::ObjectPattern(pat),
            PatKind::Array(_) => Estree::ArrayPattern(pat),
            PatKind::Ident(_) | PatKind::Missing => Estree::Identifier(pat),
        }
    }

    /// Returns the pattern that contains a `PatProp` or `PatElem` whose parent is `node`.
    fn from_owner(node: Node<'a>) -> Self {
        match node {
            Node::Pat(pat) => Estree::of(pat),
            _ => Estree::Other,
        }
    }

    fn above_param(param: Param<'a>) -> Self {
        match param.func() {
            Some(func)
                if !param.is_parameter_property() && ast_utils::is_function_with_body(func) =>
            {
                Estree::Function(func)
            }
            _ => Estree::Other,
        }
    }

    fn parent(self) -> Self {
        match self {
            Estree::Identifier(pat) | Estree::ArrayPattern(pat) | Estree::ObjectPattern(pat) => {
                match pat.parent() {
                    Node::PatProp(it) if it.is_rest() => Estree::RestElement(Holder::Prop(it)),
                    Node::PatProp(it) if it.default().is_some() => {
                        Estree::AssignmentPattern(Holder::Prop(it))
                    }
                    Node::PatProp(it) => Estree::Property(it),
                    Node::PatElem(it) if it.is_rest() => Estree::RestElement(Holder::Elem(it)),
                    Node::PatElem(it) if it.default().is_some() => {
                        Estree::AssignmentPattern(Holder::Elem(it))
                    }
                    Node::PatElem(it) => Estree::from_owner(it.parent()),
                    Node::Param(it) if it.is_rest() => Estree::RestElement(Holder::Param(it)),
                    Node::Param(it) if it.default().is_some() => {
                        Estree::AssignmentPattern(Holder::Param(it))
                    }
                    Node::Param(it) => Estree::above_param(it),
                    Node::VarDecl(_) if Declaration::Var(pat).is_catch_parameter() => {
                        Estree::CatchClause
                    }
                    Node::VarDecl(it) => Estree::VariableDeclarator(it),
                    _ => Estree::Other,
                }
            }
            Estree::AssignmentPattern(Holder::Prop(it)) => Estree::Property(it),
            Estree::Property(it) | Estree::RestElement(Holder::Prop(it)) => {
                Estree::from_owner(it.parent())
            }
            Estree::RestElement(Holder::Elem(it)) | Estree::AssignmentPattern(Holder::Elem(it)) => {
                Estree::from_owner(it.parent())
            }
            Estree::RestElement(Holder::Param(it))
            | Estree::AssignmentPattern(Holder::Param(it)) => Estree::above_param(it),
            Estree::VariableDeclarator(_)
            | Estree::Function(_)
            | Estree::CatchClause
            | Estree::Other => Estree::Other,
        }
    }

    fn span(self) -> Span {
        match self {
            Estree::Identifier(pat) | Estree::ArrayPattern(pat) | Estree::ObjectPattern(pat) => {
                estree_span(Node::Pat(pat))
            }
            Estree::Property(it) | Estree::RestElement(Holder::Prop(it)) => it.span(),
            Estree::AssignmentPattern(Holder::Prop(it)) => {
                Span::new(it.value().span().start, it.span().end)
            }
            Estree::RestElement(Holder::Elem(it)) | Estree::AssignmentPattern(Holder::Elem(it)) => {
                it.span()
            }
            Estree::RestElement(Holder::Param(it))
            | Estree::AssignmentPattern(Holder::Param(it)) => estree_span(Node::Param(it)),
            Estree::VariableDeclarator(it) => it.span(),
            Estree::Function(func) => estree_span(Node::Func(func)),
            Estree::CatchClause | Estree::Other => Span::default(),
        }
    }
}

fn property_count(object: Pat) -> usize {
    match object.kind() {
        PatKind::Object(props) => props.len(),
        _ => 0,
    }
}

/// ESLint's `hasSingleElement`.
fn has_single_element(array: Pat) -> bool {
    matches!(
        array.kind(),
        PatKind::Array(elements) if elements.iter().filter(|it| it.pat().is_some()).take(2).count() == 1
    )
}

fn param_count(func: Func) -> usize {
    func.params().len() + usize::from(func.this_param().is_some())
}

/// The ESLint function to run next, on a node further out. In ESLint they call each other, which takes a stack frame
/// per level of the pattern, and the parser accepts deeper patterns than the stack can handle.
enum Step<'a> {
    Done(Option<Fix>),
    Variables(Estree<'a>),
    NestedObjectVariable(Estree<'a>),
    NestedArrayVariable(Estree<'a>),
    RestInPattern(Estree<'a>),
}

/// ESLint's `handleFixes`.
struct Fixes<'a> {
    fixer: Fixer<'a>,
    file: &'a File<'a>,
}

impl<'a> Fixes<'a> {
    fn before(&self, at: Span) -> Option<Token<'a>> {
        self.file.tokens_before(at).next()
    }

    fn after(&self, at: Span) -> Option<Token<'a>> {
        self.file.tokens_after(at).next()
    }

    fn is_before(&self, at: Span, text: &str) -> bool {
        self.before(at).is_some_and(|token| token.is(text))
    }

    fn is_after(&self, at: Span, text: &str) -> bool {
        self.after(at).is_some_and(|token| token.is(text))
    }

    fn remove(&self, start: u32, end: u32) -> Option<Fix> {
        Some(self.fixer.remove(Span::new(start, end)))
    }

    /// Removes `at` and the token before it.
    fn remove_with_previous(&self, at: Span) -> Option<Fix> {
        self.remove(self.before(at)?.start(), at.end)
    }

    /// Removes `at` and the two tokens before it.
    fn remove_with_two_previous(&self, at: Span) -> Option<Fix> {
        self.remove(self.file.tokens_before(at).nth(1)?.start(), at.end)
    }

    /// Removes `at` and the token after it.
    fn remove_with_next(&self, at: Span) -> Option<Fix> {
        self.remove(at.start, self.after(at)?.end())
    }

    /// ESLint's `isClosingBraceOfBlock`.
    fn is_closing_brace_of_block(&self, token: Token<'a>) -> bool {
        if !ast_utils::is_closing_brace_token(&token) {
            return false;
        }
        match get_node_by_range_index(self.file, token.start()) {
            Node::Stmt(statement) => {
                matches!(
                    statement.kind(),
                    StmtKind::Block(_) | StmtKind::Switch { .. }
                )
            }
            Node::Func(func) => {
                func.kind() == FnKind::Decl
                    && func.body_span().is_some_and(|body| body.end == token.end())
            }
            Node::Class(class) => matches!(class.owner(), Node::Stmt(_)),
            _ => false,
        }
    }

    /// `next && isDeclarationNotSafeToRemove(next, previous)`
    fn is_not_safe_to_remove(&self, next: Option<Token<'a>>, previous: Option<Token<'a>>) -> bool {
        next.is_some_and(|next| {
            next.kind() == TokenKind::String
                || previous.is_some_and(|previous| {
                    !ast_utils::is_semicolon_token(&previous)
                        && !ast_utils::is_opening_brace_token(&previous)
                        && !self.is_closing_brace_of_block(previous)
                })
        })
    }

    /// Removes a whole declaration, unless that could change how the surrounding code parses.
    fn remove_declaration(&self, at: Span) -> Option<Fix> {
        if self.is_not_safe_to_remove(self.after(at), self.before(at)) {
            return None;
        }
        Some(self.fixer.remove(at))
    }

    /// Removes one of `statement`'s several declarators.
    fn remove_declarator(
        &self,
        declarator: VarDecl<'a>,
        statement: Stmt<'a>,
        is_last: bool,
    ) -> Option<Fix> {
        let span = declarator.span();
        let previous = self.before(span)?;
        if !previous.is(",") {
            return self.remove_with_next(span);
        }
        if is_last && statement.semicolon().is_none() {
            let next = self.after(statement.span());
            let last_remaining = self.file.tokens_before(span).nth(1);
            if self.is_not_safe_to_remove(next, last_remaining) {
                return None;
            }
        }
        self.remove(previous.start(), span.end)
    }

    /// ESLint's `fixFunctionParameters`.
    fn fix_function_parameters(&self, node: Estree<'a>) -> Option<Fix> {
        let Estree::Function(func) = node.parent() else {
            return None;
        };
        let span = node.span();
        if param_count(func) == 1 {
            return Some(self.fixer.remove(span));
        }
        if self.is_before(span, "(") && self.is_after(span, ",") {
            return self.remove_with_next(span);
        }
        self.remove_with_previous(span)
    }

    fn run_steps(&self, mut step: Step<'a>) -> Option<Fix> {
        loop {
            step = match step {
                Step::Done(fix) => return fix,
                Step::Variables(node) => self.variables(node),
                Step::NestedObjectVariable(node) => self.nested_object_variable(node),
                Step::NestedArrayVariable(node) => self.nested_array_variable(node),
                Step::RestInPattern(node) => self.rest_in_pattern(node),
            };
        }
    }

    fn fix_variables(&self, node: Estree<'a>) -> Option<Fix> {
        self.run_steps(Step::Variables(node))
    }

    fn fix_nested_array_variable(&self, node: Estree<'a>) -> Option<Fix> {
        self.run_steps(Step::NestedArrayVariable(node))
    }

    fn fix_rest_in_pattern(&self, node: Estree<'a>) -> Option<Fix> {
        self.run_steps(Step::RestInPattern(node))
    }

    /// The part of ESLint's `fixVariables` for a pattern that's the whole `id` of `declarator`.
    fn fix_whole_declarator(&self, declarator: VarDecl<'a>) -> Option<Fix> {
        let statement = declarator.parent().as_stmt()?;
        let StmtKind::Var(declarations) = statement.kind() else {
            return None;
        };
        if ast_utils::is_loop(statement.parent()) {
            return None;
        }
        if declarations.len() == 1 {
            return self.remove_declaration(statement.span_without_export());
        }
        let is_last = declarations.last() == Some(declarator);
        self.remove_declarator(declarator, statement, is_last)
    }

    /// ESLint's `fixVariables`.
    fn variables(&self, node: Estree<'a>) -> Step<'a> {
        let parent = node.parent();
        if let Estree::VariableDeclarator(declarator) = parent {
            return Step::Done(self.fix_whole_declarator(declarator));
        }
        if self.is_before(node.span(), ":") && matches!(parent.parent(), Estree::ObjectPattern(_)) {
            return self.object_with_value_separator(node);
        }
        Step::Done(self.fix_function_parameters(node))
    }

    /// ESLint's `fixNestedObjectVariable`.
    fn nested_object_variable(&self, node: Estree<'a>) -> Step<'a> {
        let property = node.parent();
        let object = property.parent();
        let Estree::ObjectPattern(pat) = object else {
            return Step::Done(None);
        };
        if property_count(pat) == 1 {
            return match object.parent().parent() {
                Estree::ObjectPattern(_) => Step::NestedObjectVariable(object),
                _ => Step::Variables(object),
            };
        }
        let span = property.span();
        if self.is_before(span, "{") {
            return Step::Done(self.remove_with_next(span));
        }
        Step::Done(self.remove_with_previous(span))
    }

    /// ESLint's `fixNestedArrayVariable`.
    fn nested_array_variable(&self, node: Estree<'a>) -> Step<'a> {
        let parent = node.parent();
        let Estree::ArrayPattern(array) = parent else {
            return Step::Done(None);
        };
        if has_single_element(array) {
            return match parent.parent() {
                Estree::ArrayPattern(_) => Step::NestedArrayVariable(parent),
                _ if self.is_before(parent.span(), ":") => Step::Variables(parent),
                rest @ Estree::RestElement(_) => Step::RestInPattern(rest),
                _ => Step::Variables(parent),
            };
        }
        let span = node.span();
        if self.is_before(span, ",") && self.is_after(span, "]") {
            return Step::Done(self.remove_with_previous(span));
        }
        Step::Done(Some(self.fixer.remove(span)))
    }

    /// ESLint's `fixObjectWithValueSeparator`.
    fn object_with_value_separator(&self, node: Estree<'a>) -> Step<'a> {
        let object = node.parent().parent();
        if let Estree::ObjectPattern(pat) = object
            && property_count(pat) == 1
            && matches!(object.parent(), Estree::ArrayPattern(_))
        {
            return Step::NestedArrayVariable(object);
        }
        Step::NestedObjectVariable(node)
    }

    /// ESLint's `fixRestInPattern`.
    fn rest_in_pattern(&self, node: Estree<'a>) -> Step<'a> {
        let span = node.span();
        match node.parent() {
            Estree::Function(func) if param_count(func) == 1 => {
                Step::Done(Some(self.fixer.remove(span)))
            }
            Estree::Function(_) => Step::Done(self.remove_with_previous(span)),
            parent @ Estree::ArrayPattern(array) if has_single_element(array) => {
                match parent.parent() {
                    Estree::ArrayPattern(_) => Step::NestedArrayVariable(parent),
                    _ => Step::Variables(parent),
                }
            }
            Estree::ArrayPattern(_) => Step::Done(self.remove_with_previous(span)),
            _ => Step::Done(None),
        }
    }

    /// The identifier is the whole `id` of `declarator`: `var a = b`.
    fn fix_declared_identifier(&self, declarator: VarDecl<'a>) -> Option<Fix> {
        let statement = declarator.parent().as_stmt()?;
        let StmtKind::Var(declarations) = statement.kind() else {
            return None;
        };
        if declarations.len() > 1 {
            let is_last = declarations.last() == Some(declarator);
            return self.remove_declarator(declarator, statement, is_last);
        }
        if let Node::Stmt(parent) = statement.parent() {
            let keeps_statement = match parent.kind() {
                StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. } => {
                    // It's in the loop's head.
                    if body != statement {
                        return None;
                    }
                    true
                }
                StmtKind::If { .. } => true,
                StmtKind::With { body, .. } => body == statement,
                _ => false,
            };
            if keeps_statement {
                return Some(self.fixer.replace(statement.span_without_export(), ";"));
            }
        }
        self.remove_declaration(statement.span_without_export())
    }

    /// The fallback when nothing more specific applies to the identifier at `id`.
    fn fix_identifier(&self, id: Span, parent: Estree<'a>) -> Option<Fix> {
        let (before, after) = (self.before(id), self.after(id));
        if let Some(before) = before
            && before.is(",")
        {
            return self.remove(before.start(), id.end);
        }
        if let Some(after) = after
            && after.is(",")
            && before.is_some_and(|before| before.is("(") || before.is("{"))
        {
            return self.remove(id.start, after.end());
        }
        if let Estree::Function(func) = parent
            && func.is_arrow()
            && param_count(func) == 1
            && !after.is_some_and(|after| after.is(")"))
        {
            return Some(self.fixer.replace(id, "()"));
        }
        Some(self.fixer.remove(id))
    }

    /// Fixes the identifier `pat` of a variable declaration, a parameter or a `catch` clause.
    fn fix_binding(&self, pat: Pat<'a>) -> Option<Fix> {
        let id = Estree::Identifier(pat);
        let span = id.span();
        let parent = id.parent();
        let grandparent = parent.parent();

        if let Estree::VariableDeclarator(declarator) = parent {
            return self.fix_declared_identifier(declarator);
        }

        if let Estree::ObjectPattern(object) = grandparent {
            if property_count(object) == 1 {
                return match grandparent.parent() {
                    rest @ Estree::RestElement(_) => self.fix_rest_in_pattern(rest),
                    Estree::ArrayPattern(_) => self.fix_nested_array_variable(grandparent),
                    _ => self.fix_variables(grandparent),
                };
            }
            if self.is_before(span, ":") {
                let property = parent.span();
                if self.is_before(property, "{") && self.is_after(property, ",") {
                    return self.remove_with_next(property);
                }
                return self.remove(self.before(property)?.start(), span.end);
            }
        }

        match (parent, grandparent) {
            (Estree::ArrayPattern(array), _) if has_single_element(array) => {
                return match grandparent {
                    Estree::RestElement(_) => self.fix_rest_in_pattern(grandparent),
                    Estree::ArrayPattern(_) => self.fix_nested_array_variable(parent),
                    _ => self.fix_variables(parent),
                };
            }
            (Estree::ArrayPattern(_), _) => {
                if self.is_before(span, ",") && self.is_after(span, ",") {
                    return Some(self.fixer.remove(span));
                }
            }
            (Estree::RestElement(_), Estree::ArrayPattern(array)) if has_single_element(array) => {
                return match grandparent.parent() {
                    Estree::ArrayPattern(_) => self.fix_nested_array_variable(grandparent),
                    _ => self.fix_variables(grandparent),
                };
            }
            (Estree::RestElement(_), Estree::ArrayPattern(_) | Estree::ObjectPattern(_)) => {
                return self.remove_with_two_previous(span);
            }
            (Estree::RestElement(_), Estree::Function(func)) => {
                if param_count(func) == 1 {
                    return Some(self.fixer.remove(parent.span()));
                }
                return self.remove_with_previous(parent.span());
            }
            (Estree::AssignmentPattern(_), Estree::ArrayPattern(_)) => {
                return self.fix_nested_array_variable(parent);
            }
            (Estree::AssignmentPattern(_), Estree::Property(_)) => {
                let object = grandparent.parent();
                if let Estree::ObjectPattern(pat) = object {
                    if property_count(pat) == 1 {
                        return match object.parent() {
                            Estree::ArrayPattern(_) => self.fix_nested_array_variable(object),
                            _ => self.fix_variables(object),
                        };
                    }
                    let property = grandparent.span();
                    if self.is_before(property, "{") && self.is_after(property, ",") {
                        return self.remove_with_next(property);
                    }
                    return self.remove_with_previous(property);
                }
            }
            (Estree::AssignmentPattern(_), Estree::Function(_)) => {
                return self.fix_function_parameters(parent);
            }
            (Estree::CatchClause, _) => return None,
            _ => {}
        }
        self.fix_identifier(span, parent)
    }

    fn fix_import_default(&self, import: Import<'a>, id: Span) -> Option<Fix> {
        if import.named().is_empty() && import.namespace().is_none() {
            return self.remove(id.start, import.stmt().module_specifier_span()?.start);
        }
        self.remove_with_next(id)
    }

    fn fix_import_specifier(&self, specifier: ImportSpec<'a>, id: Span) -> Option<Fix> {
        let (import, span) = (specifier.import(), specifier.span());
        if import.named().len() == 1 {
            if import.default().is_none() {
                return Some(self.fixer.remove(import.stmt().span()));
            }
            // From the `,` after the default import to the `}`.
            let comma = self.file.tokens_before(span).nth(1)?;
            return self.remove(comma.start(), self.after(id)?.end());
        }
        if self.is_before(span, "{") {
            return self.remove_with_next(span);
        }
        self.remove_with_previous(span)
    }

    fn fix_import_namespace(&self, import: Import<'a>) -> Option<Fix> {
        let span = import.namespace_span()?;
        if import.default().is_some() {
            return self.remove_with_previous(span);
        }
        self.remove(span.start, import.stmt().module_specifier_span()?.start)
    }
}

/// `id` is the range of ESLint's `variable.identifiers[0]`.
fn handle_fixes<'a>(
    fixer: Fixer<'a>,
    variable: Variable<'a>,
    def: Declaration<'a>,
    id: Span,
) -> Option<Fix> {
    // Assignments would be left behind.
    if variable
        .references()
        .any(|it| it.is_write() && it.span().start != id.start)
    {
        return None;
    }
    let fixes = Fixes {
        fixer,
        file: fixer.file(),
    };
    match def {
        Declaration::Var(pat) | Declaration::Param(pat) => fixes.fix_binding(pat),
        Declaration::Fn(func) if func.has_body() => {
            fixes.remove_declaration(estree_span(Node::Func(func)))
        }
        Declaration::Class(class) => fixes.remove_declaration(estree_span(Node::Class(class))),
        Declaration::ImportDefault(import) => fixes.fix_import_default(import, id),
        Declaration::ImportSpec(specifier) => fixes.fix_import_specifier(specifier, id),
        Declaration::ImportNamespace(import) => fixes.fix_import_namespace(import),
        _ => fixes.fix_identifier(id, Estree::Other),
    }
}

/// True if evaluating `e` runs no other code, so nothing is lost if it's deleted. Anything not listed here counts as
/// impure: calls, `new`, `await`, member access (it can run a getter), spread, tagged templates, JSX.
pub(crate) fn is_pure(e: Expr) -> bool {
    let mut rest = vec![e];
    while let Some(e) = rest.pop() {
        match e.kind() {
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::This
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex(_)
            | ExprKind::Fn(_) => {}
            ExprKind::Template(template) if template.exprs().is_empty() => {}
            ExprKind::Array(elements) => rest.extend(elements),
            ExprKind::Object(props) => {
                for prop in props {
                    if prop.kind() == PropKind::Spread || prop.has_computed_key() {
                        return false;
                    }
                    rest.extend(prop.value());
                }
            }
            ExprKind::Class(class) => {
                if !is_pure_class_definition(class, &mut rest) {
                    return false;
                }
            }
            ExprKind::Unary {
                op: UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof | UnOp::Void,
                operand,
            } => rest.push(operand),
            ExprKind::Binary { op, left, right }
                if !matches!(op, BinOp::In | BinOp::Instanceof) =>
            {
                rest.extend([left, right]);
            }
            ExprKind::Cond { test, yes, no } => rest.extend([test, yes, no]),
            _ => return false,
        }
    }
    true
}

/// True if defining `class` runs no other code, provided the expressions this adds to `evaluated` are [pure](is_pure).
fn is_pure_class_definition<'a>(class: Class<'a>, evaluated: &mut Vec<Expr<'a>>) -> bool {
    if class.decorators().next().is_some() {
        return false;
    }
    evaluated.extend(class.extends());
    class.members().iter().all(|member| {
        if member.flags().contains(Flags::STATIC) {
            evaluated.extend(member.init());
        }
        member.kind() != MemberKind::StaticBlock
            && !member.key().is_some_and(Key::is_computed)
            && member.decorators().next().is_none()
    })
}

/// True if the file is neither an ES module nor CommonJS, so a page's other `<script>`s and inline event handlers can
/// use its top-level declarations.
fn is_classic_script<'a>(file: &'a File<'a>) -> bool {
    !has_module_syntax(file) && !file.mentions_any(&["require", "module", "exports"])
}

/// True if deleting the declaration `def` of the unused `symbol` can't change what the program does.
/// `--fix-suggestions` applies every suggestion without review, so with no config file the rule only suggests a removal
/// that passes this.
///
/// A parameter is kept, because the number of parameters can matter: Express treats a function with four as an error
/// handler. So is a name in a destructuring pattern, which reads a property or runs an iterator.
///
/// Imports are the exception. An unused import is always removed. `import { a } from "b"` is removed entirely, even
/// though the module is then no longer loaded for its side effects, as in ESLint, oxlint and every "remove unused
/// imports" command. `import a from "b"` becomes `import "b"`.
fn is_safe_to_remove_without_review<'a>(symbol: Symbol<'a>, def: Declaration<'a>) -> bool {
    let file = symbol.file();
    if symbol.scope() == file.top_level_scope() && is_classic_script(file) {
        return false;
    }
    match def {
        Declaration::Var(pat) => match pat.parent() {
            Node::VarDecl(declarator) => {
                !matches!(declarator.var_kind(), VarKind::Using | VarKind::AwaitUsing)
                    && declarator.init().is_none_or(is_pure)
            }
            _ => false,
        },
        Declaration::Fn(_) => true,
        Declaration::Class(class) => {
            let mut evaluated = Vec::new();
            is_pure_class_definition(class, &mut evaluated) && evaluated.into_iter().all(is_pure)
        }
        Declaration::ImportDefault(_)
        | Declaration::ImportNamespace(_)
        | Declaration::ImportSpec(_) => true,
        _ => false,
    }
}

// ───────────────────────────── rule ─────────────────────────────

impl NoUnusedVars {
    /// ESLint's `getVariableDescription`.
    fn description(&self, kind: VariableType) -> (&'static str, Option<&Pattern>) {
        match kind {
            VariableType::ArrayDestructure => (
                "elements of array destructuring",
                self.destructured_array_ignore_pattern.as_ref(),
            ),
            VariableType::CatchClause => {
                ("caught errors", self.caught_errors_ignore_pattern.as_ref())
            }
            VariableType::Parameter => ("args", self.args_ignore_pattern.as_ref()),
            VariableType::Variable => ("vars", self.vars_ignore_pattern.as_ref()),
        }
    }

    /// `additional` in ESLint's `getDefinedMessageData` and `getAssignedMessageData`. Empty for `^_` when there's no config
    /// file, because it's the default there and [the hint](Self::hint) mentions it.
    pub fn unused_message_data(&self, kind: VariableType, file: &File) -> String {
        match self.description(kind) {
            (_, Some(pattern))
                if file.language().has_no_foreign_config && pattern.source() == "^_" =>
            {
                String::new()
            }
            (description, Some(pattern)) => {
                format!(". Allowed unused {description} must match {}", pattern.text)
            }
            _ => String::new(),
        }
    }

    /// The `additional` of `getUsedIgnoredMessageData`.
    pub fn used_ignored_message_data(&self, kind: VariableType) -> String {
        match self.description(kind) {
            (description, Some(pattern)) => {
                format!(". Used {description} must not match {}", pattern.text)
            }
            _ => String::new(),
        }
    }

    /// Reports a variable whose name matches an ignore pattern, if it's used.
    fn report_if_used<'a>(
        &self,
        cx: &Cx<'a, Self>,
        variable: Variable<'a>,
        is_marked_as_used: bool,
        (name, def): (Name<'a>, Declaration<'a>),
        kind: VariableType,
    ) {
        if !self.report_used_ignore_pattern || !(is_marked_as_used || is_used_variable(variable)) {
            return;
        }
        let Some(at) = name_span(def) else {
            return;
        };
        cx.report(at, USED_IGNORED_VAR)
            .data("varName", name)
            .data("additional", self.used_ignored_message_data(kind));
    }

    /// ESLint's `hasRestSpreadSibling`.
    fn has_rest_spread_sibling(&self, variable: Variable) -> bool {
        if !self.ignore_rest_siblings {
            return false;
        }
        let is_defined_next_to_rest = variable.declarations().any(|def| match def {
            Declaration::Var(pat) | Declaration::Param(pat) => has_rest_sibling(Node::Pat(pat)),
            _ => false,
        });
        is_defined_next_to_rest || variable.references().any(|it| has_rest_sibling(it.node()))
    }

    fn check<'a>(&self, symbol: Symbol<'a>, cx: &Cx<'a, Self>) {
        // Without `reportUsedIgnorePattern`, a used variable is never reported.
        if !self.report_used_ignore_pattern && is_obviously_used(symbol) {
            return;
        }
        let Some(def) = symbol
            .declarations()
            .find(|it| !matches!(it, Declaration::Other))
        else {
            return;
        };
        let mut kind = match def {
            Declaration::Param(_) => VariableType::Parameter,
            Declaration::Var(_) if def.is_catch_parameter() => VariableType::CatchClause,
            // The name of a function expression.
            Declaration::Fn(func) if func.kind() != FnKind::Decl => return,
            // The name of a class expression.
            Declaration::Class(class) if !matches!(class.owner(), Node::Stmt(_)) => return,
            Declaration::Module(module) if !matches!(module.name(), ModuleName::Ident(_)) => return,
            _ => VariableType::Variable,
        };
        let name = symbol.name();

        if self.vars == Vars::Local && symbol.scope().kind() == ScopeKind::Global {
            return;
        }
        let is_marked_as_used = symbol.is_marked_used();
        if is_marked_as_used && !self.report_used_ignore_pattern {
            return;
        }
        let variable = symbol.variable_in(symbol.scope());

        if let Some(pattern) = &self.destructured_array_ignore_pattern
            && pattern.test(name)
            && (is_defined_in_array_pattern(def)
                || variable.references().any(is_referenced_in_array_pattern))
        {
            let kind = VariableType::ArrayDestructure;
            return self.report_if_used(cx, variable, is_marked_as_used, (name, def), kind);
        }

        if self.ignore_class_with_static_init_block
            && let Declaration::Class(class) = def
            && class
                .members()
                .iter()
                .any(|it| it.kind() == MemberKind::StaticBlock)
        {
            return;
        }
        let function = match def {
            Declaration::Param(pat) => def
                .node()
                .and_then(Node::as_func)
                .or_else(|| Node::Pat(pat).enclosing_function()),
            _ => None,
        };
        match kind {
            VariableType::CatchClause if !self.checks_caught_errors => return,
            VariableType::Parameter
                if self.args == Args::None
                    || function.is_some_and(|func| {
                        is_setter(func) || func.kind() == FnKind::IndexSignature
                    }) =>
            {
                return;
            }
            _ => {}
        }
        if self
            .description(kind)
            .1
            .is_some_and(|pattern| pattern.test(name))
        {
            return self.report_if_used(cx, variable, is_marked_as_used, (name, def), kind);
        }
        if is_marked_as_used
            || is_used_variable(variable)
            || is_exported(def)
            || self.ignore_using_declarations && uses_explicit_resource_management(def)
            || self.has_rest_spread_sibling(variable)
        {
            return;
        }
        if self.args == Args::AfterUsed
            && let Declaration::Param(pat) = def
            && let Estree::Function(func) = Estree::Identifier(pat).parent()
            && !is_after_last_used_arg(func, symbol)
        {
            return;
        }
        let Some(at) = name_span(def) else {
            return;
        };

        // The last assignment in the function that declares the variable, if there is one.
        let scope = symbol.scope().variable_scope();
        let (mut is_assigned, mut last_write) = (false, None);
        for reference in variable.references().filter(|it| it.is_write()) {
            is_assigned = true;
            if reference.scope().variable_scope() == scope {
                last_write = Some(reference);
            }
        }
        if self.destructured_array_ignore_pattern.is_some() && is_defined_in_array_pattern(def) {
            kind = VariableType::ArrayDestructure;
        }
        cx.report(last_write.map_or(at, identifier_span), UNUSED_VAR)
            .data("varName", name)
            .data(
                "action",
                if is_assigned {
                    "assigned a value"
                } else {
                    "defined"
                },
            )
            .data("additional", self.unused_message_data(kind, cx.file()))
            .hint(self.hint(def, kind))
            .suggest_with(REMOVE_VAR, &[("varName", name.bytes())], |fixer| {
                if !cx.language().has_no_foreign_config {
                    return handle_fixes(fixer, variable, def, at);
                }
                let fix = handle_fixes(fixer, variable, def, at)
                    .filter(|_| is_safe_to_remove_without_review(symbol, def))?;
                if !fix.text.is_empty() {
                    return Some(fix);
                }
                // If the statement was the only thing on its lines, remove the lines too.
                Some(Fix {
                    span: Removal::of(cx.text(), fix.span).without_leftovers(),
                    ..fix
                })
            });
    }

    /// Reports the unreferenced names in `/* global a, b */` comments.
    fn check_global_comments<'a>(&self, cx: &Cx<'a, Self>) {
        let file = cx.file();
        for global in file.globals_in_comments() {
            let name: &'a [u8] = &global.name;
            let Some(&comment) = global.comments.first() else {
                continue;
            };
            // A name that the script also declares is checked as a declared variable.
            if global.setting == Global::Off
                || file.is_global_marked_used(name)
                || file.scope().get_bytes(name).is_some()
                || file.is_exported_in_comments(name)
            {
                continue;
            }
            let Some(variable) = file.global_variable(name) else {
                continue;
            };
            if is_used_variable(variable) || self.has_rest_spread_sibling(variable) {
                continue;
            }
            cx.report(file.name_in_global_comment(comment, name), UNUSED_VAR)
                .data("varName", name)
                .data("action", "defined")
                .data("additional", "");
        }
    }

    /// The hint for an unused variable. `def` is its first definition.
    pub fn hint(&self, def: Declaration, kind: VariableType) -> &'static str {
        match def {
            // If the handler throws, the caught error should be the `cause`, so don't suggest removing the parameter.
            Declaration::Var(pat)
                if def.is_catch_parameter() && matches!(pat.parent(), Node::VarDecl(_)) =>
            {
                let throws = matches!(pat.parent().parent(), Node::Stmt(it)
                    if matches!(it.kind(), StmtKind::Try { handler: Some(handler), .. }
                        if handler.as_block().is_some_and(|body| body.iter().any(|it| it.tag() == StmtTag::Throw))));
                if throws {
                    ""
                } else {
                    "A catch needs no parameter. Remove it and its parentheses."
                }
            }
            Declaration::Var(pat) | Declaration::Param(pat) if has_rest_sibling(Node::Pat(pat)) => {
                "To leave a property out this way, turn on the option ignoreRestSiblings."
            }
            Declaration::ImportDefault(_)
            | Declaration::ImportNamespace(_)
            | Declaration::ImportSpec(_)
            | Declaration::ImportEquals(_) => "",
            _ if self
                .description(kind)
                .1
                .is_some_and(|it| it.source() == "^_") =>
            {
                "Remove it, or start its name with _ to keep it."
            }
            _ => "",
        }
    }
}

impl Rule for NoUnusedVars {
    const META: Meta = Meta::eslint("no-unused-vars", Kind::Problem)
        .has_suggestions()
        .recommended()
        .reports_at_the_end()
        .hints();
    const ON: On = On::new().finish();
    no_state!();

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        NoUnusedVars {
            vars: match options.str(0).or_else(|| object.str("vars")) {
                Some("local") => Vars::Local,
                _ => Vars::All,
            },
            args: match object.str("args") {
                Some("all") => Args::All,
                Some("none") => Args::None,
                _ => Args::AfterUsed,
            },
            ignore_rest_siblings: object.bool_or("ignoreRestSiblings", false),
            checks_caught_errors: object.str("caughtErrors") != Some("none"),
            ignore_class_with_static_init_block: object
                .bool_or("ignoreClassWithStaticInitBlock", false),
            ignore_using_declarations: object.bool_or("ignoreUsingDeclarations", false),
            report_used_ignore_pattern: object.bool_or("reportUsedIgnorePattern", false),
            vars_ignore_pattern: Pattern::new(object, "varsIgnorePattern"),
            args_ignore_pattern: Pattern::new(object, "argsIgnorePattern"),
            caught_errors_ignore_pattern: Pattern::new(object, "caughtErrorsIgnorePattern"),
            destructured_array_ignore_pattern: Pattern::new(
                object,
                "destructuredArrayIgnorePattern",
            ),
        }
    }

    // Runs at the end, like upstream, because other rules mark variables as used while they run.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        for symbol in cx.file().symbols() {
            self.check(symbol, cx);
        }
        if self.vars == Vars::All {
            self.check_global_comments(cx);
        }
    }
}
