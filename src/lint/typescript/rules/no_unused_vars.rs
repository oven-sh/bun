use bun_lint::prelude::*;
use bun_lint::utils::ts_scope::{
    SymbolSet, UsedMarks, Variable, VariableAnalysis, collect_variables, has_rest_sibling,
    is_defined_in_array_pattern, is_referenced_in_array_pattern, is_type_only_reference,
    is_used_global_variable,
};
use bun_lint::utils::ts_utils::is_definition_file;

/// Disallow unused variables.
pub struct NoUnusedVars {
    vars: Vars,
    args: Args,
    ignore_rest_siblings: bool,
    ignore_using_declarations: bool,
    checks_caught_errors: bool,
    ignore_class_with_static_init_block: bool,
    report_used_ignore_pattern: bool,
    autofixes_imports: bool,
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

const REMOVE_UNUSED_IMPORT_DECLARATION: Message =
    Message::new("removeUnusedImportDeclaration", "Remove unused import declaration.");
const REMOVE_UNUSED_VAR: Message =
    Message::new("removeUnusedVar", "Remove unused variable \"{{varName}}\".");
const UNUSED_VAR: Message =
    Message::new("unusedVar", "'{{varName}}' is {{action}} but never used{{additional}}.");
const USED_IGNORED_VAR: Message = Message::new(
    "usedIgnoredVar",
    "'{{varName}}' is marked as ignored but is used{{additional}}.",
);
const USED_ONLY_AS_TYPE: Message = Message::new(
    "usedOnlyAsType",
    "'{{varName}}' is {{action}} but only used as a type{{additional}}.",
);

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
#[derive(Copy, Clone)]
enum VariableType {
    ArrayDestructure,
    CatchClause,
    Parameter,
    Variable,
}

pub struct State {
    is_definition_file: bool,
}

// ───────────────────────────── ambient declarations ─────────────────────────────

fn has_overriding_export_statement<'a>(body: List<'a, Stmt<'a>>) -> bool {
    body.iter().any(|statement| match statement.kind() {
        StmtKind::ExportNamed(_) | StmtKind::ExportStar { .. } | StmtKind::ExportAssign(_) => true,
        StmtKind::ExportDefault(declaration) => declaration.tag() == ExprTag::Ident,
        _ => false,
    })
}

/// Sets `variable.eslintUsed`, which other rules see as well: ESLint's own `no-unused-vars`.
fn mark_declaration_child_as_used(node: Stmt) {
    match node.kind() {
        // A `FunctionDeclaration` is not ambient, a `TSDeclareFunction` is.
        StmtKind::Fn(function) if function.has_body() => {}
        StmtKind::Fn(function) => function.symbol().into_iter().for_each(Symbol::mark_used),
        StmtKind::Class(class) => class.symbol().into_iter().for_each(Symbol::mark_used),
        StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::Var(_) => {
            Node::Stmt(node).declared_symbols().into_iter().for_each(Symbol::mark_used);
        }
        _ => {}
    }
}

/// Marks what the statements of a declaration file or of an ambient namespace declare, unless
/// something there says what is exported.
fn mark_ambient_declarations<'a>(body: List<'a, Stmt<'a>>) {
    if has_overriding_export_statement(body) {
        return;
    }
    for statement in body.iter().filter(|it| !it.is_exported()) {
        mark_declaration_child_as_used(statement);
    }
}

/// `TSModuleDeclaration[declare = true]`
fn is_declared_module(node: Node) -> bool {
    matches!(node, Node::Stmt(it) if it.tag() == StmtTag::Module && it.flags().contains(Flags::AMBIENT))
}

// ───────────────────────────── definitions and references ─────────────────────────────

/// `def.name.type === AST_NODE_TYPES.Identifier`
fn is_named_by_identifier(def: Declaration) -> bool {
    match def {
        Declaration::EnumMember(member) => matches!(member.key().map(Key::kind), Some(KeyKind::Ident(_))),
        _ => true,
    }
}

/// The function, if `isFunction(def.name.parent)`: the name is all of one of its parameters.
fn function_of_plain_parameter(def: Declaration<'_>) -> Option<Func<'_>> {
    let Declaration::Param(pat) = def else {
        return None;
    };
    let Node::Param(param) = pat.parent() else {
        return None;
    };
    if param.is_rest() || param.default().is_some() || param.is_parameter_property() {
        return None;
    }
    param.func().filter(|function| function.has_body())
}

/// Whether `pat` is where the parameter `symbol` is written first: `function (a, b, a) {}`
fn is_first_parameter_named<'a>(symbol: Symbol<'a>, pat: Pat<'a>) -> bool {
    let first = symbol.declarations().find_map(|def| match def {
        Declaration::Param(it) => Some(it),
        _ => None,
    });
    first == Some(pat)
}

/// Whether no parameter of `function` after `variable` is used.
fn is_after_last_used_arg<'a>(
    function: Func<'a>,
    variable: Symbol<'a>,
    analysis: &VariableAnalysis<'a>,
) -> bool {
    let (mut is_posterior, mut is_last) = (false, true);
    for param in function.params() {
        param.pat().for_each_binding(&mut |pat| {
            let Some(it) = pat.symbol() else {
                return;
            };
            if it == variable {
                is_posterior = true;
            } else if is_posterior
                && (it.references().next().is_some() || analysis.is_eslint_used(Variable::new(it)))
                && is_first_parameter_named(it, pat)
            {
                is_last = false;
            }
        });
    }
    is_last
}

// ───────────────────────────── fixes ─────────────────────────────

/// What removes an unused import.
#[derive(Copy, Clone)]
enum ImportFix<'a> {
    /// All of the `ImportDeclaration` or the `TSImportEqualsDeclaration`.
    Declaration(Span),
    /// `import Unused, { Used } from 'module'`
    Default(Import<'a>),
    /// One of several specifiers, of which some are used.
    Specifier(ImportSpec<'a>),
}

fn are_all_specifiers_unused(declaration: Import, reported: &SymbolSet) -> bool {
    Node::Stmt(declaration.stmt()).declared_symbols().into_iter().all(|it| reported.contains(it))
}

fn get_import_fixer<'a>(variable: Variable<'a>, reported: &SymbolSet) -> Option<ImportFix<'a>> {
    let mut defs = variable.defs();
    let def = defs.next()?;
    // All of several definitions would have to be removed.
    if defs.next().is_some() {
        return None;
    }
    let is_removed_entirely = |declaration: Import<'a>| {
        let specifiers = usize::from(declaration.default().is_some())
            + usize::from(declaration.namespace().is_some())
            + declaration.named().len();
        specifiers == 1 || are_all_specifiers_unused(declaration, reported)
    };
    Some(match def {
        Declaration::ImportEquals(declaration) => {
            ImportFix::Declaration(declaration.stmt().span_without_export())
        }
        Declaration::ImportNamespace(declaration) => ImportFix::Declaration(declaration.span()),
        Declaration::ImportDefault(declaration) if is_removed_entirely(declaration) => {
            ImportFix::Declaration(declaration.span())
        }
        Declaration::ImportDefault(declaration) => ImportFix::Default(declaration),
        Declaration::ImportSpec(specifier) if is_removed_entirely(specifier.import()) => {
            ImportFix::Declaration(specifier.import().span())
        }
        Declaration::ImportSpec(specifier) => ImportFix::Specifier(specifier),
        _ => return None,
    })
}

/// Removes `node`, with its lines if there is nothing else on them.
fn remove_node_with_trailing_newline(fixer: Fixer, node: Span) -> Fix {
    let file = fixer.file();
    let end_line = file.line_of(node.end);
    let line_range_start = file.line_span(file.line_of(node.start)).start;
    let line_range_end = match end_line < file.line_count() {
        true => file.line_span(end_line + 1).start,
        false => file.span().end,
    };
    let lines = Span::new(line_range_start, line_range_end);
    match file.slice(node) == text::trim(file.slice(lines)) {
        true => fixer.remove(lines),
        false => fixer.remove(node),
    }
}

/// Removes `node` and the `comma` next to it.
fn remove_with_comma(fixer: Fixer, node: Span, comma: Token) -> Fix {
    fixer.remove(Span::new(node.start.min(comma.start()), node.end.max(comma.end())))
}

fn fix_import_specifier<'a>(
    fixer: Fixer<'a>,
    specifier: ImportSpec<'a>,
    reported: &SymbolSet,
) -> Option<Fix> {
    let file = fixer.file();
    let declaration = specifier.import().stmt();
    let is_used_named_specifier = |it: Symbol<'a>| {
        !reported.contains(it) && matches!(it.declarations().next(), Some(Declaration::ImportSpec(_)))
    };
    if !Node::Stmt(declaration).declared_symbols().into_iter().any(is_used_named_specifier) {
        // `import Used, { Unused } from 'module'`: from the `,` to the `}`.
        let left_curly = file.tokens_in(declaration).find(|token| token.is_punctuator("{"))?;
        let left_token = file.token_before(left_curly).filter(|token| token.is_punctuator(","))?;
        let right_token = file.tokens_in(declaration).find(|token| token.is_punctuator("}"))?;
        return Some(fixer.remove(Span::new(left_token.start(), right_token.end())));
    }
    // The `,` before it makes for the nicer result. The first specifier has none.
    let node = specifier.span();
    let comma = file
        .token_before(node)
        .filter(|token| token.is_punctuator(","))
        .or_else(|| file.token_after(node).filter(|token| token.is_punctuator(",")))?;
    Some(remove_with_comma(fixer, node, comma))
}

fn fix_import<'a>(fixer: Fixer<'a>, fix: ImportFix<'a>, reported: &SymbolSet) -> Option<Fix> {
    match fix {
        ImportFix::Declaration(node) => Some(remove_node_with_trailing_newline(fixer, node)),
        ImportFix::Default(declaration) => {
            let node = declaration.default()?.span();
            let comma = fixer.file().token_after(node).filter(|token| token.is_punctuator(","))?;
            Some(remove_with_comma(fixer, node, comma))
        }
        ImportFix::Specifier(specifier) => fix_import_specifier(fixer, specifier, reported),
    }
}

// ───────────────────────────── the rule ─────────────────────────────

impl NoUnusedVars {
    fn def_to_variable_type(&self, def: Declaration) -> VariableType {
        if self.destructured_array_ignore_pattern.is_some() && is_defined_in_array_pattern(def) {
            return VariableType::ArrayDestructure;
        }
        match def.kind() {
            Some(DeclarationKind::CatchClause) => VariableType::CatchClause,
            Some(DeclarationKind::Parameter) => VariableType::Parameter,
            _ => VariableType::Variable,
        }
    }

    fn get_variable_description(&self, variable_type: VariableType) -> (Option<&Pattern>, &'static str) {
        match variable_type {
            VariableType::ArrayDestructure => {
                (self.destructured_array_ignore_pattern.as_ref(), "elements of array destructuring")
            }
            VariableType::CatchClause => (self.caught_errors_ignore_pattern.as_ref(), "caught errors"),
            VariableType::Parameter => (self.args_ignore_pattern.as_ref(), "args"),
            VariableType::Variable => (self.vars_ignore_pattern.as_ref(), "vars"),
        }
    }

    /// The `additional` of `getDefinedMessageData` and `getAssignedMessageData`.
    fn get_unused_message_data(&self, unused_var: Variable) -> String {
        let Some(def) = unused_var.defs().next() else {
            return String::new();
        };
        match self.get_variable_description(self.def_to_variable_type(def)) {
            (Some(pattern), description) => {
                format!(". Allowed unused {description} must match {}", pattern.text)
            }
            _ => String::new(),
        }
    }

    /// The `additional` of `getUsedIgnoredMessageData`.
    fn get_used_ignored_message_data(&self, variable_type: VariableType) -> String {
        match self.get_variable_description(variable_type) {
            (Some(pattern), description) => {
                format!(". Used {description} must not match {}", pattern.text)
            }
            _ => String::new(),
        }
    }

    fn report<'a>(
        &self,
        cx: &Cx<'a, Self>,
        reported: &mut SymbolSet,
        unused_var: Variable<'a>,
        message: Message,
        (action, additional): (&'static str, String),
    ) {
        reported.insert(unused_var.symbol());
        let reported = &*reported;

        // The last assignment in the function that declares the variable, or the first declaration.
        let scope = unused_var.scope().variable_scope();
        let last_write = unused_var
            .references()
            .filter(|it| it.is_write() && it.scope().variable_scope() == scope)
            .last();
        let id = match last_write {
            Some(reference) => Some(reference.span()),
            None => unused_var.defs().next().and_then(Declaration::name_span),
        };
        let Some(id) = id else {
            return;
        };
        let name = unused_var.name();
        // As many columns as the name is long, however it is written.
        let start = cx.position(id.start);
        let end = Position {
            line: start.line,
            column: start.column + text::utf16_len(name.bytes()),
        };
        let report = cx
            .report(id, message)
            .end_at(end)
            .data("varName", name)
            .data("action", action)
            .data("additional", additional);
        let Some(fix) = get_import_fixer(unused_var, reported) else {
            return;
        };
        if self.autofixes_imports {
            report.fix(|fixer| fix_import(fixer, fix, reported));
            return;
        }
        let suggestion = match fix {
            ImportFix::Declaration(_) => REMOVE_UNUSED_IMPORT_DECLARATION,
            ImportFix::Default(_) | ImportFix::Specifier(_) => REMOVE_UNUSED_VAR,
        };
        report.suggest_with(suggestion, &[("varName", name.bytes())], |fixer| {
            fix_import(fixer, fix, reported)
        });
    }

    fn has_rest_spread_sibling(&self, variable: Variable) -> bool {
        self.ignore_rest_siblings
            && (variable.defs().any(|def| match def {
                Declaration::Var(pat) | Declaration::Param(pat) => has_rest_sibling(Node::Pat(pat)),
                _ => false,
            }) || variable.references().any(|reference| has_rest_sibling(reference.node())))
    }

    /// One turn of the loop of upstream's `collectUnusedVariables`: whether `variable` is to be
    /// reported as unused. One that is used in spite of its name is reported here.
    fn is_unused_variable<'a>(
        &self,
        cx: &Cx<'a, Self>,
        analysis: &VariableAnalysis<'a>,
        reported: &mut SymbolSet,
        (used, variable): (bool, Variable<'a>),
    ) -> bool {
        let Some(def) = variable.defs().next() else {
            return false;
        };
        if self.vars == Vars::Local && variable.scope().kind() == ScopeKind::Global {
            return false;
        }
        let name = variable.name();
        let is_ignored = |pattern: &Option<Pattern>| {
            is_named_by_identifier(def) && pattern.as_ref().is_some_and(|it| it.test(name))
        };
        let mut report_if_used = |variable_type: VariableType| {
            if self.report_used_ignore_pattern && used {
                let additional = self.get_used_ignored_message_data(variable_type);
                self.report(cx, reported, variable, USED_IGNORED_VAR, ("", additional));
            }
        };

        if is_ignored(&self.destructured_array_ignore_pattern)
            && (is_defined_in_array_pattern(def) || variable.references().any(is_referenced_in_array_pattern))
        {
            report_if_used(VariableType::ArrayDestructure);
            return false;
        }

        if self.ignore_class_with_static_init_block
            && let Declaration::Class(class) = def
            && class.members().iter().any(|member| member.kind() == MemberKind::StaticBlock)
        {
            return false;
        }

        match def.kind() {
            Some(DeclarationKind::CatchClause) => {
                if !self.checks_caught_errors {
                    return false;
                }
                if is_ignored(&self.caught_errors_ignore_pattern) {
                    report_if_used(VariableType::CatchClause);
                    return false;
                }
            }
            Some(DeclarationKind::Parameter) => {
                if self.args == Args::None {
                    return false;
                }
                if is_ignored(&self.args_ignore_pattern) {
                    report_if_used(VariableType::Parameter);
                    return false;
                }
                if self.args == Args::AfterUsed
                    && let Some(function) = function_of_plain_parameter(def)
                    && !is_after_last_used_arg(function, variable.symbol(), analysis)
                {
                    return false;
                }
            }
            kind => {
                if is_ignored(&self.vars_ignore_pattern) {
                    // The members of an enum always count as used, whether they are or not.
                    if kind != Some(DeclarationKind::TsEnumMember) {
                        report_if_used(VariableType::Variable);
                    }
                    return false;
                }
            }
        }

        if self.ignore_using_declarations
            && def.kind() == Some(DeclarationKind::Variable)
            && matches!(
                def.node(),
                Some(Node::VarDecl(it)) if matches!(it.var_kind(), VarKind::Using | VarKind::AwaitUsing)
            )
        {
            return false;
        }

        !used && !self.has_rest_spread_sibling(variable) && !analysis.is_eslint_used(variable)
    }

    fn check_module<'a>(&self, node: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Module(module) = node.kind() else {
            return;
        };
        if cx.state.is_definition_file
            || is_declared_module(Node::Stmt(node))
            || Node::Stmt(node).ancestors().any(is_declared_module)
        {
            mark_ambient_declarations(module.innermost().body());
        }
    }

    /// Reports the names in `/* global a, b */` comments that nothing refers to.
    fn check_globals_in_comments<'a>(cx: &Cx<'a, Self>) {
        let file = cx.file();
        for it in file.globals_in_comments() {
            let name: &'a [u8] = &it.name;
            let Some(variable) = file.global(name) else {
                continue;
            };
            let Some(&directive_comment) = variable.comments.first() else {
                continue;
            };
            // What a script declares as well has definitions, and is checked as that.
            if variable.is_in_lib
                || variable.is_exported
                || file.scope().get_bytes(name).is_some()
                || is_used_global_variable(file, name)
            {
                continue;
            }
            cx.report(file.name_in_global_comment(directive_comment, name), UNUSED_VAR)
                .data("varName", name)
                .data("action", "defined")
                .data("additional", "");
        }
    }

    fn check_program<'a>(&self, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let analysis = collect_variables(file, UsedMarks::default());
        // Upstream's `collectVariables` sets `variable.eslintUsed`, for the rules that end after this one.
        for variable in analysis.used_variables() {
            if variable.class_scope().is_none() && analysis.is_eslint_used(*variable) {
                variable.symbol().mark_used();
            }
        }

        let mut reported = SymbolSet::default();
        let used_variables: &[Variable<'a>] = match self.report_used_ignore_pattern {
            true => analysis.used_variables(),
            false => &[],
        };
        let variables = (analysis.unused_variables().iter().map(|it| (false, *it)))
            .chain(used_variables.iter().map(|it| (true, *it)));
        let mut unused_vars = Vec::new();
        for variable in variables {
            if self.is_unused_variable(cx, &analysis, &mut reported, variable) {
                unused_vars.push(variable.1);
            }
        }

        for unused_var in unused_vars {
            let used_only_as_type =
                unused_var.references().any(|it| is_type_only_reference(unused_var.symbol(), it));
            if used_only_as_type
                && unused_var.defs().any(|def| def.kind() == Some(DeclarationKind::ImportBinding))
            {
                continue;
            }
            let action = match unused_var.references().any(Reference::is_write) {
                true => "assigned a value",
                false => "defined",
            };
            let message = if used_only_as_type { USED_ONLY_AS_TYPE } else { UNUSED_VAR };
            let additional = self.get_unused_message_data(unused_var);
            self.report(cx, &mut reported, unused_var, message, (action, additional));
        }

        Self::check_globals_in_comments(cx);
    }
}

impl Rule for NoUnusedVars {
    const META: Meta = Meta::typescript("no-unused-vars", Kind::Problem)
        .fixable(Fixable::Code)
        .has_suggestions()
        .recommended()
        .extends_base_rule("no-unused-vars");
    type State<'a> = State;

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
            ignore_using_declarations: object.bool_or("ignoreUsingDeclarations", false),
            checks_caught_errors: object.str("caughtErrors") != Some("none"),
            ignore_class_with_static_init_block: object.bool_or("ignoreClassWithStaticInitBlock", false),
            report_used_ignore_pattern: object.bool_or("reportUsedIgnorePattern", false),
            autofixes_imports: object.object("enableAutofixRemoval").bool_or("imports", false),
            vars_ignore_pattern: Pattern::new(object, "varsIgnorePattern"),
            args_ignore_pattern: Pattern::new(object, "argsIgnorePattern"),
            caught_errors_ignore_pattern: Pattern::new(object, "caughtErrorsIgnorePattern"),
            destructured_array_ignore_pattern: Pattern::new(object, "destructuredArrayIgnorePattern"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State {
        on.stmts([StmtTag::Module], Self::check_module);
        on.finish(Self::check_program);
        let is_definition_file = is_definition_file(file.path());
        if is_definition_file {
            mark_ambient_declarations(file.body());
        }
        State { is_definition_file }
    }
}
