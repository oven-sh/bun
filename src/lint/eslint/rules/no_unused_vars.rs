use bun_lint::prelude::*;
use bun_lint::utils::ts_scope::{
    get_rhs_node, has_rest_sibling, is_defined_in_array_pattern, is_read_for_itself,
    is_referenced_in_array_pattern,
};
use bun_lint::utils::{estree_span, get_node_by_range_index};

/// Disallow unused variables.
pub struct NoUnusedVars {
    vars: Vars,
    args: Args,
    ignore_rest_siblings: bool,
    checks_caught_errors: bool,
    ignore_class_with_static_init_block: bool,
    ignore_using_declarations: bool,
    report_used_ignore_pattern: bool,
    vars_ignore_pattern: Option<Pattern>,
    args_ignore_pattern: Option<Pattern>,
    caught_errors_ignore_pattern: Option<Pattern>,
    destructured_array_ignore_pattern: Option<Pattern>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Vars {
    All,
    Local,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Args {
    All,
    AfterUsed,
    None,
}

const UNUSED_VAR: Message = Message::new(
    "unusedVar",
    "'{{varName}}' is {{action}} but never used{{additional}}.",
);
const USED_IGNORED_VAR: Message = Message::new(
    "usedIgnoredVar",
    "'{{varName}}' is marked as ignored but is used{{additional}}.",
);
const REMOVE_VAR: Message = Message::new("removeVar", "Remove unused variable '{{varName}}'.");

// ───────────────────────────── options ─────────────────────────────

/// One of the `..IgnorePattern` options.
struct Pattern {
    regex: Regex,
    /// `String(regex)`
    text: String,
}

impl Pattern {
    fn new(options: Object, key: &str) -> Option<Pattern> {
        options.str(key).filter(|source| !source.is_empty())?;
        let regex = options.regex(key, "u")?;
        Some(Pattern {
            text: regex.to_string(),
            regex,
        })
    }

    fn test(&self, name: Name) -> bool {
        self.regex.test(name.bytes())
    }
}

/// What a message calls a variable, which decides the pattern that it names.
#[derive(Copy, Clone, PartialEq, Eq)]
enum VariableType {
    ArrayDestructure,
    CatchClause,
    Parameter,
    Variable,
}

// ───────────────────────────── variables ─────────────────────────────

/// ESLint's `Variable`.
#[derive(Copy, Clone)]
enum Variable<'a> {
    /// What the file declares.
    Declared {
        symbol: Symbol<'a>,
        /// One of the declarations is a class.
        is_class: bool,
    },
    /// What a `/* global name */` comment declares.
    Global { file: &'a File<'a>, name: &'a [u8] },
}

/// Whether `scope` is in a class that `symbol` is the name of. There the name is a second variable
/// in ESLint.
fn is_in_class_named<'a>(symbol: Symbol<'a>, scope: Scope<'a>) -> bool {
    symbol.declarations().any(|def| match def {
        Declaration::Class(class) => class.scope().is_some_and(|inner| inner.contains(scope)),
        _ => false,
    })
}

impl<'a> Variable<'a> {
    fn references(self) -> impl Iterator<Item = Reference<'a>> + 'a {
        let (declared, global) = match self {
            Variable::Declared { symbol, is_class } => {
                let is_outside =
                    move |it: &Reference<'a>| !is_class || !is_in_class_named(symbol, it.scope());
                (Some(symbol.references().filter(is_outside)), None)
            }
            Variable::Global { file, name } => (None, Some(file.unresolved_references_to(name))),
        };
        declared.into_iter().flatten().chain(global.into_iter().flatten())
    }
}

/// The `VarDecl` that the pattern `pat` is part of.
fn declarator(pat: Pat<'_>) -> Option<VarDecl<'_>> {
    Node::Pat(pat).ancestors().find_map(|it| match it {
        Node::VarDecl(declaration) => Some(declaration),
        _ => None,
    })
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

/// ESLint's `isSelfReference` with `getFunctionDefinitions`: `reference` is in a function that the
/// variable is the name of, or is initialized with.
fn is_self_reference<'a>(variable: Variable<'a>, reference: Reference<'a>) -> bool {
    let Variable::Declared { symbol, .. } = variable else {
        return false;
    };
    let function = |def: Declaration<'a>| match def {
        Declaration::Fn(func) => func.scope(),
        Declaration::Var(pat) => declarator(pat)?.init()?.as_fn()?.scope(),
        _ => None,
    };
    symbol.declarations().filter_map(function).any(|scope| scope.contains(reference.scope()))
}

/// ESLint's `isForInOfRef`.
fn is_for_in_of_ref(reference: Reference) -> bool {
    let target = match reference.node() {
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

/// ESLint's `isUsedVariable`, but for `eslintUsed`.
fn is_used_variable(variable: Variable) -> bool {
    let mut rhs = None;
    variable.references().any(|reference| {
        if is_for_in_of_ref(reference) {
            return true;
        }
        let is_for_itself = is_read_for_itself(reference, rhs);
        rhs = get_rhs_node(reference, rhs);
        reference.is_read() && !is_for_itself && !is_self_reference(variable, reference)
    })
}

/// Whether ESLint has `func` as the `value` of a `Property` or a `MethodDefinition` whose `kind` is
/// `"set"`. An abstract setter is a `TSAbstractMethodDefinition`, one of an interface or a type
/// literal a `TSMethodSignature`.
fn is_setter(func: Func) -> bool {
    func.kind() == FnKind::Setter
        && !matches!(
            func.owner(),
            Node::Member(it) if it.is_signature() || it.flags().contains(Flags::ABSTRACT)
        )
}

/// Whether `pat` is where the parameter `symbol` is written first: `function (a, b, a) {}`
fn is_first_parameter_named<'a>(symbol: Symbol<'a>, pat: Pat<'a>) -> bool {
    let first = symbol.declarations().find_map(|def| match def {
        Declaration::Param(it) => Some(it),
        _ => None,
    });
    first == Some(pat)
}

/// ESLint's `isAfterLastUsedArg`, for a parameter `symbol` of `func`.
fn is_after_last_used_arg<'a>(func: Func<'a>, symbol: Symbol<'a>) -> bool {
    let (mut is_after, mut is_last) = (false, true);
    for param in func.params_with_this() {
        param.pat().for_each_binding(&mut |pat| {
            let Some(it) = pat.symbol() else {
                return;
            };
            if it == symbol {
                is_after = true;
            } else if is_after
                && (it.references().next().is_some() || it.is_marked_used())
                && is_first_parameter_named(it, pat)
            {
                is_last = false;
            }
        });
    }
    is_last
}

// ───────────────────────────── suggestions ─────────────────────────────

/// What has a `...` or a default value.
#[derive(Copy, Clone)]
enum Holder<'a> {
    Prop(PatProp<'a>),
    Elem(PatElem<'a>),
    Param(Param<'a>),
}

/// A node of ESTree that is part of a binding pattern, or has one.
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

    /// The pattern that a `PatProp` or a `PatElem` with the parent `node` is in.
    fn of_owner(node: Node<'a>) -> Self {
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
                    Node::PatElem(it) => Estree::of_owner(it.parent()),
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
                Estree::of_owner(it.parent())
            }
            Estree::RestElement(Holder::Elem(it)) | Estree::AssignmentPattern(Holder::Elem(it)) => {
                Estree::of_owner(it.parent())
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
        PatKind::Array(elements) if elements.iter().filter(|it| it.pat().is_some()).count() == 1
    )
}

fn param_count(func: Func) -> usize {
    func.params().len() + usize::from(func.this_param().is_some())
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
                matches!(statement.kind(), StmtKind::Block(_) | StmtKind::Switch { .. })
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

    /// Removes a whole declaration, unless that could change how what is around it is parsed.
    fn remove_declaration(&self, at: Span) -> Option<Fix> {
        if self.is_not_safe_to_remove(self.after(at), self.before(at)) {
            return None;
        }
        Some(self.fixer.remove(at))
    }

    /// Removes one of the several declarators of `statement`.
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

    /// ESLint's `fixVariables`.
    fn fix_variables(&self, node: Estree<'a>) -> Option<Fix> {
        let parent = node.parent();
        if let Estree::VariableDeclarator(declarator) = parent {
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
            return self.remove_declarator(declarator, statement, is_last);
        }
        if self.is_before(node.span(), ":") && matches!(parent.parent(), Estree::ObjectPattern(_)) {
            return self.fix_object_with_value_separator(node);
        }
        self.fix_function_parameters(node)
    }

    /// ESLint's `fixNestedObjectVariable`.
    fn fix_nested_object_variable(&self, node: Estree<'a>) -> Option<Fix> {
        let property = node.parent();
        let object = property.parent();
        let Estree::ObjectPattern(pat) = object else {
            return None;
        };
        if property_count(pat) == 1 {
            return match object.parent().parent() {
                Estree::ObjectPattern(_) => self.fix_nested_object_variable(object),
                _ => self.fix_variables(object),
            };
        }
        let span = property.span();
        if self.is_before(span, "{") {
            return self.remove_with_next(span);
        }
        self.remove_with_previous(span)
    }

    /// ESLint's `fixNestedArrayVariable`.
    fn fix_nested_array_variable(&self, node: Estree<'a>) -> Option<Fix> {
        let parent = node.parent();
        let Estree::ArrayPattern(array) = parent else {
            return None;
        };
        if has_single_element(array) {
            return match parent.parent() {
                Estree::ArrayPattern(_) => self.fix_nested_array_variable(parent),
                _ if self.is_before(parent.span(), ":") => self.fix_variables(parent),
                rest @ Estree::RestElement(_) => self.fix_rest_in_pattern(rest),
                _ => self.fix_variables(parent),
            };
        }
        let span = node.span();
        if self.is_before(span, ",") && self.is_after(span, "]") {
            return self.remove_with_previous(span);
        }
        Some(self.fixer.remove(span))
    }

    /// ESLint's `fixObjectWithValueSeparator`.
    fn fix_object_with_value_separator(&self, node: Estree<'a>) -> Option<Fix> {
        let object = node.parent().parent();
        if let Estree::ObjectPattern(pat) = object
            && property_count(pat) == 1
            && matches!(object.parent(), Estree::ArrayPattern(_))
        {
            return self.fix_nested_array_variable(object);
        }
        self.fix_nested_object_variable(node)
    }

    /// ESLint's `fixRestInPattern`.
    fn fix_rest_in_pattern(&self, node: Estree<'a>) -> Option<Fix> {
        let span = node.span();
        match node.parent() {
            Estree::Function(func) if param_count(func) == 1 => Some(self.fixer.remove(span)),
            Estree::Function(_) => self.remove_with_previous(span),
            parent @ Estree::ArrayPattern(array) if has_single_element(array) => {
                match parent.parent() {
                    Estree::ArrayPattern(_) => self.fix_nested_array_variable(parent),
                    _ => self.fix_variables(parent),
                }
            }
            Estree::ArrayPattern(_) => self.remove_with_previous(span),
            _ => None,
        }
    }

    /// The identifier is the whole of what `declarator` declares: `var a = b`.
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
                    // It is in the head of the loop.
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

    /// What is left when nothing more specific applies to the identifier at `id`.
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

    /// The identifier `pat` of a variable declaration, a parameter or a `catch` clause.
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

/// `id`: the range of ESLint's `variable.identifiers[0]`.
fn handle_fixes<'a>(
    fixer: Fixer<'a>,
    variable: Variable<'a>,
    def: Declaration<'a>,
    id: Span,
) -> Option<Fix> {
    // Assignments would be left behind.
    if variable.references().any(|it| it.is_write() && it.span().start != id.start) {
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

// ───────────────────────────── the rule ─────────────────────────────

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

    /// Reports a variable whose name says that it is unused, if it is used.
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
        let additional = match self.description(kind) {
            (description, Some(pattern)) => {
                format!(". Used {description} must not match {}", pattern.text)
            }
            _ => String::new(),
        };
        cx.report(at, USED_IGNORED_VAR).data("varName", name).data("additional", additional);
    }

    /// ESLint's `hasRestSpreadSibling`.
    fn has_rest_spread_sibling(&self, variable: Variable) -> bool {
        if !self.ignore_rest_siblings {
            return false;
        }
        let is_defined_beside_rest = match variable {
            Variable::Declared { symbol, .. } => symbol.declarations().any(|def| match def {
                Declaration::Var(pat) | Declaration::Param(pat) => has_rest_sibling(Node::Pat(pat)),
                _ => false,
            }),
            Variable::Global { .. } => false,
        };
        is_defined_beside_rest || variable.references().any(|it| has_rest_sibling(it.node()))
    }

    fn check<'a>(&self, symbol: Symbol<'a>, cx: &mut Cx<'a, Self>) {
        let Some(def) = symbol.declarations().find(|it| !matches!(it, Declaration::Other)) else {
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
        let variable = Variable::Declared {
            symbol,
            is_class: symbol.declarations().any(|it| matches!(it, Declaration::Class(_))),
        };

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
            && class.members().iter().any(|it| it.kind() == MemberKind::StaticBlock)
        {
            return;
        }
        let function = match def {
            Declaration::Param(pat) => Node::Pat(pat).enclosing_function(),
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
        if self.description(kind).1.is_some_and(|pattern| pattern.test(name)) {
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
        let additional = match self.description(kind) {
            (description, Some(pattern)) => {
                format!(". Allowed unused {description} must match {}", pattern.text)
            }
            _ => String::new(),
        };
        cx.report(last_write.map_or(at, identifier_span), UNUSED_VAR)
            .data("varName", name)
            .data("action", if is_assigned { "assigned a value" } else { "defined" })
            .data("additional", additional)
            .suggest_with(REMOVE_VAR, &[("varName", name.bytes())], |fixer| {
                handle_fixes(fixer, variable, def, at)
            });
    }

    /// Reports the names in `/* global a, b */` comments that nothing refers to.
    fn check_global_comments<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        for global in file.globals_in_comments() {
            let name: &'a [u8] = &global.name;
            let Some(&comment) = global.comments.first() else {
                continue;
            };
            // What a script declares as well is checked as that.
            if global.setting == Global::Off
                || file.scope().get_bytes(name).is_some()
                || file.exported_in_comments().iter().any(|it| **it == *name)
            {
                continue;
            }
            let variable = Variable::Global { file, name };
            if is_used_variable(variable) || self.has_rest_spread_sibling(variable) {
                continue;
            }
            cx.report(file.name_in_global_comment(comment, name), UNUSED_VAR)
                .data("varName", name)
                .data("action", "defined")
                .data("additional", "");
        }
    }
}

impl Rule for NoUnusedVars {
    const META: Meta =
        Meta::eslint("no-unused-vars", Kind::Problem).has_suggestions().recommended();
    type State<'a> = ();

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

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.symbols(Self::check);
        if self.vars == Vars::All {
            on.finish(Self::check_global_comments);
        }
    }
}
