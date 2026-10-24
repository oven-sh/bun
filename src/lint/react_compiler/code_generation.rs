use crate::compile::Flavor;
use crate::convert::{ConvertError, Converted, Root, convert};
use crate::suppression::find_program_suppressions;
use bun_alloc::Arena;
use bun_ast::{
    ASTMemoryAllocator, Expr as JsExpr, G, ImportKind, ImportRecord, Loc, Ref, RefTag, S, Scope,
    Stmt as JsStmt, StoreSlice, StoreStr, Symbol, flags,
};
use bun_lint::ast::walk::{Visitor, walk_node};
use bun_lint::ast::{Expr, ExprKind, File, Func, Ident, List, Name, Node, Stmt, StmtKind};
use bun_lint::span::Span;
use bun_react_compiler::{
    CompileOutput, Host, JsxImportKind, PendingCompile, ReactCompilerOptions, ReactCompilerState,
    finish, maybe_compile_pending,
};
use std::fmt;

const SUPPRESSION_RULES: [&str; 2] = ["react-hooks/exhaustive-deps", "react-hooks/rules-of-hooks"];
const REACT_WRAPPERS: [&str; 2] = ["forwardRef", "memo"];

pub struct GenerationOptions {
    pub is_development: bool,
    pub is_server: bool,
    pub uses_classic_jsx: bool,
}

pub struct Candidate<'a> {
    pub function: Func<'a>,
    pub name: Option<Name<'a>>,
    pub is_in_react_wrapper: bool,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum SymbolOrigin {
    Source,
    Local,
    Outlined,
    JsxImport(JsxImportKind),
    ClassicFactory,
    ClassicFragment,
    MemoCacheSentinel,
    EarlyReturnSentinel,
    ImportItem,
    ImportNamespace,
}

impl fmt::Debug for SymbolOrigin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name = match *self {
            SymbolOrigin::JsxImport(kind) => {
                return write!(f, "JsxImport({})", jsx_import_name(kind));
            }
            SymbolOrigin::Source => "Source",
            SymbolOrigin::Local => "Local",
            SymbolOrigin::Outlined => "Outlined",
            SymbolOrigin::ClassicFactory => "ClassicFactory",
            SymbolOrigin::ClassicFragment => "ClassicFragment",
            SymbolOrigin::MemoCacheSentinel => "MemoCacheSentinel",
            SymbolOrigin::EarlyReturnSentinel => "EarlyReturnSentinel",
            SymbolOrigin::ImportItem => "ImportItem",
            SymbolOrigin::ImportNamespace => "ImportNamespace",
        };
        f.write_str(name)
    }
}

pub struct GeneratedSymbol {
    pub name: Box<[u8]>,
    pub origin: SymbolOrigin,
    /// A `Source` symbol that is bound outside the function, or not bound at all.
    pub is_outside: bool,
}

pub struct GeneratedFunction<'g> {
    pub parameters: &'g [G::Arg],
    pub flags: flags::FunctionSet,
    pub body: &'g [JsStmt],
    /// An `S::Import` per module that the function needs, then an `S::Function` per outlined function.
    pub module_statements: &'g [JsStmt],
    /// By `Ref::inner_index()`.
    pub symbols: &'g [GeneratedSymbol],
    /// By `S::Import::import_record_index`.
    pub import_paths: &'g [Box<[u8]>],
    /// By `Loc::start`. A `Loc` outside the list, such as `Loc::EMPTY`, has no source position.
    pub spans: &'g [Span],
}

#[derive(Debug)]
pub struct GenerationError {
    pub text: String,
}

pub fn has_module_scope_opt_out<'a>(file: &'a File<'a>) -> bool {
    let has_prologue = (file.body().first()).is_some_and(|it| it.directive().is_some());
    has_prologue
        && with_ast_arena(|_| {
            bun_react_compiler::has_module_scope_opt_out(&directive_prologue(file.body()))
        })
}

pub fn find_candidates<'a>(file: &'a File<'a>) -> Vec<Candidate<'a>> {
    let mut candidates = Vec::new();
    for statement in file.body() {
        collect_candidates(statement, &mut candidates);
    }
    if candidates.is_empty() {
        return candidates;
    }
    with_ast_arena(|_| {
        // No member of `GenerationOptions` changes the answer of `may_compile`.
        let options = ReactCompilerOptions {
            enabled: true,
            ..ReactCompilerOptions::default()
        };
        let state = ReactCompilerState::new(options, false, Default::default());
        candidates.retain(|candidate| {
            let statements = candidate.function.body_statements();
            state.may_compile(
                candidate.name.map(Name::bytes),
                candidate.is_in_react_wrapper,
                false,
                &statements.map_or_else(Vec::new, directive_prologue),
            )
        });
    });
    if candidates.is_empty() {
        return candidates;
    }
    let suppressions = find_program_suppressions(file, &SUPPRESSION_RULES);
    candidates.retain(|candidate| {
        let span = candidate.function.estree_span();
        suppressions
            .filter_suppressions_that_affect_function(span.start, span.end)
            .is_empty()
            && !has_ambiguous_jsx_tag(candidate.function)
    });
    candidates
}

pub fn generate_function<'a, R>(
    file: &'a File<'a>,
    candidate: &Candidate<'a>,
    options: &GenerationOptions,
    then: impl FnOnce(&GeneratedFunction<'_>) -> R,
) -> Result<Option<R>, GenerationError> {
    with_ast_arena(|arena| {
        let mut converted = match convert(file, arena, candidate.function, Flavor::Eslint) {
            Ok(converted) => converted,
            Err(ConvertError::TooDeep | ConvertError::ThisParameter | ConvertError::Using) => {
                return Ok(None);
            }
        };
        let import_bindings = std::mem::take(&mut converted.import_bindings);
        let symbols = std::mem::take(&mut converted.symbols);
        let mut state = ReactCompilerState::new(
            compiler_options(options),
            false,
            import_bindings.into_iter().collect(),
        );
        let mut host = GenerationHost::new(&converted, symbols, arena, file.text(), options);
        let (pending, body) = pending_compile(&converted.root, candidate.is_in_react_wrapper);
        let compiled = maybe_compile_pending(
            &mut state,
            &mut host,
            &pending,
            body.slice_mut(),
            candidate.name.map(Name::bytes),
        );
        let mut module_statements = Vec::new();
        match finish(state, &mut host, &mut module_statements) {
            CompileOutput::Error { error, .. } => {
                return Err(GenerationError {
                    text: error.to_string(),
                });
            }
            CompileOutput::Unchanged | CompileOutput::Changed { .. } => {}
        }
        let Some((body, result)) = compiled else {
            return Ok(None);
        };
        let symbols = host.generated_symbols();
        Ok(Some(then(&GeneratedFunction {
            parameters: result.args.slice(),
            flags: result.flags,
            body: &body,
            module_statements: &module_statements,
            symbols: &symbols,
            import_paths: &host.import_paths,
            spans: &converted.spans,
        })))
    })
}

fn with_ast_arena<R>(then: impl FnOnce(&Arena) -> R) -> R {
    let arena = Arena::new();
    let mut allocator = ASTMemoryAllocator::borrowing(&arena);
    let _scope = allocator.enter();
    then(&arena)
}

fn directive_prologue<'a>(statements: List<'a, Stmt<'a>>) -> Vec<JsStmt> {
    let directive = |value: &[u8]| {
        let value = StoreStr::new(value);
        JsStmt::alloc(S::Directive { value }, Loc::EMPTY)
    };
    (statements.iter().map_while(Stmt::directive))
        .map(directive)
        .collect()
}

fn collect_candidates<'a>(statement: Stmt<'a>, candidates: &mut Vec<Candidate<'a>>) {
    match statement.kind() {
        StmtKind::Fn(function) => candidates.extend(function_candidate(function, None, false)),
        StmtKind::ExportDefault(expression) | StmtKind::Expr(expression) => {
            candidates.extend(expression_candidate(expression, None));
        }
        StmtKind::Var(declarations) => {
            for declaration in declarations {
                if let (Some(name), Some(value)) =
                    (declaration.pat().as_ident(), declaration.init())
                {
                    candidates.extend(expression_candidate(value, Some(name)));
                }
            }
        }
        StmtKind::Empty
        | StmtKind::Debugger
        | StmtKind::Class(_)
        | StmtKind::Interface(_)
        | StmtKind::TypeAlias(_)
        | StmtKind::Enum(_)
        | StmtKind::Module(_)
        | StmtKind::Return(_)
        | StmtKind::If { .. }
        | StmtKind::For { .. }
        | StmtKind::ForIn { .. }
        | StmtKind::ForOf { .. }
        | StmtKind::While { .. }
        | StmtKind::DoWhile { .. }
        | StmtKind::Block(_)
        | StmtKind::With { .. }
        | StmtKind::Switch { .. }
        | StmtKind::Try { .. }
        | StmtKind::Throw(_)
        | StmtKind::Break(_)
        | StmtKind::Continue(_)
        | StmtKind::Labeled { .. }
        | StmtKind::Import(_)
        | StmtKind::ImportEquals(_)
        | StmtKind::ExportNamed(_)
        | StmtKind::ExportStar { .. }
        | StmtKind::ExportAssign(_)
        | StmtKind::ExportAsNamespace(_) => {}
    }
}

fn expression_candidate<'a>(
    expression: Expr<'a>,
    declared_name: Option<Name<'a>>,
) -> Option<Candidate<'a>> {
    let expression = expression.skip_type_wrappers();
    if let Some(function) = expression.as_fn() {
        return function_candidate(function, declared_name, false);
    }
    let call = expression.as_call()?;
    let argument = call.args().first()?.skip_type_wrappers();
    match is_react_wrapper(call.callee()) {
        true => function_candidate(argument.as_fn()?, declared_name, true),
        false => None,
    }
}

fn function_candidate<'a>(
    function: Func<'a>,
    declared_name: Option<Name<'a>>,
    is_in_react_wrapper: bool,
) -> Option<Candidate<'a>> {
    function.has_body().then(|| Candidate {
        function,
        name: function.name().map(Ident::name).or(declared_name),
        is_in_react_wrapper,
    })
}

fn is_react_wrapper(callee: Expr<'_>) -> bool {
    let callee = callee.skip_type_wrappers();
    match callee.as_dot() {
        Some((object, name, _)) => {
            object.skip_type_wrappers().is_ident("React") && name.name().is_any(&REACT_WRAPPERS)
        }
        None => (callee.as_ident()).is_some_and(|name| name.is_any(&REACT_WRAPPERS)),
    }
}

struct AmbiguousTagSearch {
    is_found: bool,
}

impl<'a> Visitor<'a> for AmbiguousTagSearch {
    fn enter(&mut self, node: Node<'a>) {
        if let Some(ExprKind::Jsx(jsx)) = node.as_expr().map(Expr::kind)
            && let Some(name) = jsx.tag().and_then(Expr::as_ident)
        {
            self.is_found |= !name.bytes().first().is_some_and(u8::is_ascii_alphabetic);
        }
    }
    fn exit(&mut self, _: Node<'a>) {}
}

// `<_a />` and `<$a />` name variables. `convert` makes host elements of them, as upstream's lowering does.
fn has_ambiguous_jsx_tag(function: Func<'_>) -> bool {
    let mut search = AmbiguousTagSearch { is_found: false };
    walk_node(Node::Func(function), &mut search);
    search.is_found
}

fn compiler_options(options: &GenerationOptions) -> ReactCompilerOptions {
    ReactCompilerOptions {
        enabled: true,
        is_dev: options.is_development,
        output_mode: options.is_server.then(|| "ssr".to_owned()),
        ..ReactCompilerOptions::default()
    }
}

fn pending_compile(root: &Root, in_react_hoc: bool) -> (PendingCompile, StoreSlice<JsStmt>) {
    match root {
        Root::Function(function) => (
            PendingCompile {
                args: function.args,
                flags: function.flags,
                body_loc: function.body.loc,
                args_loc: function.open_parens_loc,
                binding: None,
                in_react_hoc,
            },
            function.body.stmts,
        ),
        Root::Arrow(arrow) => {
            let mut flags = flags::FUNCTION_NONE;
            if arrow.is_async {
                flags |= flags::Function::IsAsync;
            }
            if arrow.has_rest_arg {
                flags |= flags::Function::HasRestArg;
            }
            (
                PendingCompile {
                    args: arrow.args,
                    flags,
                    body_loc: arrow.body.loc,
                    args_loc: arrow.body.loc,
                    binding: None,
                    in_react_hoc,
                },
                arrow.body.stmts,
            )
        }
    }
}

fn jsx_import_name(kind: JsxImportKind) -> &'static str {
    match kind {
        JsxImportKind::Jsx => "jsx",
        JsxImportKind::Jsxs => "jsxs",
        JsxImportKind::JsxDEV => "jsxDEV",
        JsxImportKind::Fragment => "Fragment",
        JsxImportKind::CreateElement => "createElement",
    }
}

struct GenerationHost<'c> {
    converted: &'c Converted,
    arena: &'c Arena,
    source: &'c [u8],
    module_scope: Scope,
    options: &'c GenerationOptions,
    symbols: Vec<Symbol>,
    origins: Vec<SymbolOrigin>,
    import_paths: Vec<Box<[u8]>>,
}

impl<'c> GenerationHost<'c> {
    fn new(
        converted: &'c Converted,
        symbols: Vec<Symbol>,
        arena: &'c Arena,
        source: &'c [u8],
        options: &'c GenerationOptions,
    ) -> Self {
        let mut origins = vec![SymbolOrigin::Source; symbols.len()];
        if let Some(origin) = origins.get_mut(converted.fragment.inner_index() as usize) {
            *origin = match options.uses_classic_jsx {
                true => SymbolOrigin::ClassicFragment,
                false => SymbolOrigin::JsxImport(JsxImportKind::Fragment),
            };
        }
        GenerationHost {
            converted,
            arena,
            source,
            module_scope: Scope::EMPTY,
            options,
            symbols,
            origins,
            import_paths: Vec::new(),
        }
    }

    fn new_symbol(&mut self, name: &[u8], origin: SymbolOrigin) -> Ref {
        let index = self.symbols.len() as u32;
        self.symbols.push(Symbol {
            original_name: StoreStr::new(self.arena.alloc_slice_copy(name)),
            ..Symbol::default()
        });
        self.origins.push(origin);
        Ref::new(index, 0, RefTag::Symbol)
    }

    fn shared_symbol(&mut self, origin: SymbolOrigin, name: &[u8]) -> Ref {
        match self.origins.iter().position(|it| *it == origin) {
            Some(index) => Ref::new(index as u32, 0, RefTag::Symbol),
            None => self.new_symbol(name, origin),
        }
    }

    fn generated_symbols(&self) -> Vec<GeneratedSymbol> {
        let generated = |(index, (symbol, &origin)): (usize, (&Symbol, &SymbolOrigin))| {
            let is_outside = self
                .converted
                .is_outside
                .get(index)
                .copied()
                .unwrap_or(true);
            GeneratedSymbol {
                name: symbol.original_name.slice().into(),
                origin,
                is_outside: origin == SymbolOrigin::Source && is_outside,
            }
        };
        (self.symbols.iter().zip(&self.origins).enumerate())
            .map(generated)
            .collect()
    }
}

impl Host for GenerationHost<'_> {
    fn symbols(&self) -> &[Symbol] {
        &self.symbols
    }
    fn module_scope(&self) -> &Scope {
        &self.module_scope
    }
    // The state has the imports of the file as bindings, and nothing reads a record after `finish` adds it.
    fn import_records(&self) -> &[ImportRecord] {
        &[]
    }
    fn type_casts(&self) -> &[(Loc, Loc)] {
        &self.converted.casts
    }
    fn targets_with_defaults(&self) -> &[(Loc, Loc)] {
        &self.converted.defaults
    }
    fn parentheses(&self) -> &[(Loc, Loc)] {
        &self.converted.parentheses
    }
    fn is_module_level(&self, ref_: Ref) -> bool {
        let is_outside = self.converted.is_outside.get(ref_.inner_index() as usize);
        is_outside.copied().unwrap_or(true)
    }
    fn source(&self) -> &[u8] {
        self.source
    }
    fn arena(&self) -> &Arena {
        self.arena
    }
    fn ref_name(&self, ref_: Ref) -> &[u8] {
        let symbol = self.symbols.get(ref_.inner_index() as usize);
        symbol.map_or(b"", |it| it.original_name.slice())
    }
    fn scope_for_loc(&self, _: Loc) -> Option<&Scope> {
        None
    }
    fn jsx_import(&mut self, kind: JsxImportKind) -> Ref {
        self.shared_symbol(
            SymbolOrigin::JsxImport(kind),
            jsx_import_name(kind).as_bytes(),
        )
    }
    fn jsx_import_kind(&self, ref_: Ref) -> Option<JsxImportKind> {
        match *self.origins.get(ref_.inner_index() as usize)? {
            SymbolOrigin::JsxImport(kind) => Some(kind),
            SymbolOrigin::Source
            | SymbolOrigin::Local
            | SymbolOrigin::Outlined
            | SymbolOrigin::ClassicFactory
            | SymbolOrigin::ClassicFragment
            | SymbolOrigin::MemoCacheSentinel
            | SymbolOrigin::EarlyReturnSentinel
            | SymbolOrigin::ImportItem
            | SymbolOrigin::ImportNamespace => None,
        }
    }
    fn is_jsx_dev(&self) -> bool {
        self.options.is_development
    }
    fn is_jsx_classic(&self) -> bool {
        self.options.uses_classic_jsx
    }
    fn jsx_classic_factory(&mut self, loc: Loc) -> JsExpr {
        JsExpr::init_identifier(
            self.shared_symbol(SymbolOrigin::ClassicFactory, b"jsxFactory"),
            loc,
        )
    }
    fn new_generated(&mut self, name: &[u8]) -> Ref {
        self.new_symbol(name, SymbolOrigin::Outlined)
    }
    fn new_local(&mut self, name: &[u8]) -> Ref {
        self.new_symbol(name, SymbolOrigin::Local)
    }
    fn new_import_item(&mut self, name: &[u8]) -> Ref {
        self.new_symbol(name, SymbolOrigin::ImportItem)
    }
    fn runtime_sentinel(&mut self, early: bool) -> Ref {
        match early {
            true => self.shared_symbol(
                SymbolOrigin::EarlyReturnSentinel,
                b"__EARLY_RETURN_SENTINEL",
            ),
            false => self.shared_symbol(SymbolOrigin::MemoCacheSentinel, b"__MEMO_CACHE_SENTINEL"),
        }
    }
    fn global_ref(&mut self, name: &[u8]) -> Ref {
        self.new_symbol(name, SymbolOrigin::Source)
    }
    fn record_usage(&mut self, _: Ref) {}
    fn add_import_record(&mut self, path: &[u8], _: ImportKind) -> (u32, Ref) {
        let index = self.import_paths.len() as u32;
        self.import_paths.push(path.into());
        (index, self.new_symbol(path, SymbolOrigin::ImportNamespace))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use bun_ast::{B, ExprData, StmtData};
    use bun_lint::language::LanguageOptions;
    use bun_sema::atom::Interner;
    use bun_sema::bind::{BindOptions, Recycled, bind_for_lint_in};
    use bun_sema::session::Session;
    use bun_sema_standalone as _;
    use std::borrow::Cow;

    const AUTOMATIC: GenerationOptions = GenerationOptions {
        is_development: false,
        is_server: false,
        uses_classic_jsx: false,
    };
    const CLASSIC: GenerationOptions = GenerationOptions {
        is_development: false,
        is_server: false,
        uses_classic_jsx: true,
    };
    const COMPONENT: &str = "function A(props) { return <div>{props.a}</div>; }";
    const FRAGMENT: &str = "function A(props) { return <>{props.a}</>; }";

    fn with_file<R>(text: &str, then: impl for<'a> FnOnce(&'a File<'a>) -> R) -> R {
        let path = b"/a.tsx";
        let language = LanguageOptions::default();
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let arena = session.arena();
        let mut tree =
            bun_sema_parser::summarize(arena, path, None, text.as_bytes(), &atoms, false, true);
        tree.text = Cow::Borrowed(text.as_bytes());
        let mut recycled = Recycled::for_current_thread();
        let bound = bind_for_lint_in(&tree, BindOptions::default(), &atoms, &mut recycled);
        let file = File::new(path, &tree, bound, &atoms, &language, None);
        then(&file)
    }

    fn describe_candidates(text: &str) -> String {
        with_file(text, |file| {
            let describe = |it: &Candidate<'_>| {
                let name = it
                    .name
                    .map_or_else(|| "?".to_owned(), |name| name.to_string());
                match it.is_in_react_wrapper {
                    true => format!("wrapped {name}"),
                    false => name,
                }
            };
            let all: Vec<String> = find_candidates(file).iter().map(describe).collect();
            all.join(", ")
        })
    }

    fn generate<R>(
        text: &str,
        options: &GenerationOptions,
        then: impl FnOnce(&File<'_>, &GeneratedFunction<'_>) -> R,
    ) -> Option<R> {
        with_file(text, |file| {
            let candidates = find_candidates(file);
            let [candidate] = &candidates[..] else {
                panic!("expected one candidate");
            };
            generate_function(file, candidate, options, |generated| then(file, generated))
                .expect("the configuration is valid")
        })
    }

    fn generated_origins(text: &str, options: &GenerationOptions) -> Vec<SymbolOrigin> {
        generate(text, options, |_, generated| {
            generated.symbols.iter().map(|it| it.origin).collect()
        })
        .expect("the function is compiled")
    }

    // The statements of a scope come out as one expression: `(t0 = new Date(), $[0] = t0)`.
    fn holds_new_expression(value: JsExpr) -> bool {
        match &value.data {
            ExprData::ENew(_) => true,
            ExprData::EBinary(binary) => {
                holds_new_expression(binary.left) || holds_new_expression(binary.right)
            }
            _ => false,
        }
    }

    fn has_new_expression(statements: &[JsStmt]) -> bool {
        let is_new = |value: Option<JsExpr>| value.is_some_and(holds_new_expression);
        statements.iter().any(|statement| match &statement.data {
            StmtData::SBlock(block) => has_new_expression(block.stmts.slice()),
            StmtData::SIf(branch) => has_new_expression(&[branch.yes]),
            StmtData::SLocal(local) => local.decls.iter().any(|it| is_new(it.value)),
            StmtData::SReturn(returned) => is_new(returned.value),
            StmtData::SExpr(expression) => holds_new_expression(expression.value),
            _ => false,
        })
    }

    fn describe_statements(statements: &[JsStmt]) -> String {
        let of_value = |value: Option<JsExpr>| value.map_or("-", |it| it.data.tag_name());
        let described = statements.iter().map(|statement| match &statement.data {
            StmtData::SBlock(block) => {
                format!("{{ {} }}", describe_statements(block.stmts.slice()))
            }
            StmtData::SIf(branch) => {
                let no = branch.no.map(|no| describe_statements(&[no]));
                let yes = describe_statements(&[branch.yes]);
                format!("if {yes} else {}", no.unwrap_or_default())
            }
            StmtData::SLocal(local) => {
                let values: Vec<&str> = local.decls.iter().map(|it| of_value(it.value)).collect();
                format!("local {}", values.join(", "))
            }
            StmtData::SReturn(returned) => format!("return {}", of_value(returned.value)),
            StmtData::SExpr(expression) => match &expression.value.data {
                ExprData::EBinary(binary) => {
                    format!(
                        "{} op {}",
                        binary.left.data.tag_name(),
                        binary.right.data.tag_name()
                    )
                }
                other => other.tag_name().to_owned(),
            },
            other => <&'static str>::from(other.tag()).to_owned(),
        });
        described.collect::<Vec<String>>().join("; ")
    }

    #[test]
    fn top_level_shapes_are_candidates() {
        let text = "function A() {}
            export function B() {}
            const C = () => null, D = function () {};
            memo(function E() {});
            (function F() {});
            export default function G() {}";
        assert_eq!(describe_candidates(text), "A, B, C, D, wrapped E, F, G");
        assert_eq!(
            describe_candidates("export default memo(() => null);"),
            "wrapped ?"
        );
        assert_eq!(describe_candidates("export default function () {}"), "");
        assert_eq!(describe_candidates("const [A] = [() => null];"), "");
    }

    #[test]
    fn nested_function_is_no_candidate() {
        let text = "function Outer() { function A() {} const B = () => null; }
            if (true) { function C() {} }";
        assert_eq!(describe_candidates(text), "Outer");
    }

    #[test]
    fn wrapper_is_recognized_with_and_without_react() {
        let text = "const a = memo(() => null);
            const b = forwardRef(() => null);
            const c = React.memo(() => null);
            const d = React.forwardRef(() => null);
            const e = Preact.memo(() => null);
            const f = observer(() => null);
            const g = memo(Inner);";
        assert_eq!(
            describe_candidates(text),
            "wrapped a, wrapped b, wrapped c, wrapped d"
        );
    }

    #[test]
    fn type_wrappers_are_skipped() {
        let text = "const A = (() => null) as Component;
            const b = memo((() => null) satisfies Component)!;";
        assert_eq!(describe_candidates(text), "A, wrapped b");
    }

    #[test]
    fn overload_signature_is_skipped() {
        let text = "function A(a: string): void;
            function A(a: number): void;
            function A(a: unknown) {}
            declare function B(): void;";
        assert_eq!(describe_candidates(text), "A");
    }

    #[test]
    fn component_gets_a_cache() {
        let compiled = generate(COMPONENT, &AUTOMATIC, |_, generated| {
            let StmtData::SLocal(cache) = &generated.body[0].data else {
                panic!("expected a declaration");
            };
            let [declaration] = &cache.decls[..] else {
                panic!("expected one declarator");
            };
            let B::B::BIdentifier(binding) = &declaration.binding.data else {
                panic!("expected an identifier");
            };
            let Some(ExprData::ECall(call)) = declaration.value.map(|it| it.data) else {
                panic!("expected a call");
            };
            let ExprData::EImportIdentifier(callee) = &call.target.data else {
                panic!("expected an import");
            };
            let symbol = |reference: Ref| &generated.symbols[reference.inner_index() as usize];
            assert_eq!(&*symbol(binding.r#ref).name, b"$");
            assert_eq!(symbol(binding.r#ref).origin, SymbolOrigin::Local);
            assert_eq!(symbol(callee.ref_).origin, SymbolOrigin::ImportItem);
            let paths: Vec<&[u8]> = generated.import_paths.iter().map(|it| &**it).collect();
            assert_eq!(paths, [b"react/compiler-runtime".as_slice()]);
            assert!(matches!(
                generated.module_statements[0].data,
                StmtData::SImport(_)
            ));
        });
        assert!(compiled.is_some());
    }

    #[test]
    fn plain_function_is_not_compiled() {
        let text = "function helper() { return <div />; }";
        assert_eq!(describe_candidates(text), "");
        let text = "function Plain() { return 1; }";
        assert!(generate(text, &AUTOMATIC, |_, _| ()).is_none());
    }

    #[test]
    fn opt_out_directive_is_respected() {
        let text = "function A() { 'use no memo'; return <div />; }";
        assert_eq!(describe_candidates(text), "");
        let text = "function A() { 'use strict'; 'use no forget'; return <div />; }";
        assert_eq!(describe_candidates(text), "");
        let text = "function A() { 'use strict'; return <div />; }";
        assert_eq!(describe_candidates(text), "A");
        let opts_out = |text: &str| with_file(text, has_module_scope_opt_out);
        assert!(opts_out("'use client';\n'use no memo';\nfunction A() {}"));
        assert!(!opts_out("'use client';\nfunction A() {}"));
        assert!(!opts_out("function A() { 'use no memo'; }"));
    }

    #[test]
    fn suppressed_function_is_not_compiled() {
        let with_comment = |rule: &str| {
            format!("function A() {{\n// eslint-disable-next-line {rule}\nreturn <div />;\n}}")
        };
        let text = with_comment("react-hooks/rules-of-hooks");
        assert_eq!(describe_candidates(&text), "");
        let text = with_comment("react-hooks/exhaustive-deps");
        assert_eq!(describe_candidates(&text), "");
        assert_eq!(describe_candidates(&with_comment("no-console")), "A");
        let text = "/* eslint-disable react-hooks/rules-of-hooks */\nfunction A() {}";
        assert_eq!(describe_candidates(text), "");
    }

    #[test]
    fn tag_without_leading_letter_is_not_compiled() {
        let text = "function A() { return <_B />; }";
        assert_eq!(describe_candidates(text), "");
        let text = "function A() { return <div><$B /></div>; }";
        assert_eq!(describe_candidates(text), "");
        let text = "function A() { return <B><b /><c.d /><e-f /></B>; }";
        assert_eq!(describe_candidates(text), "A");
    }

    #[test]
    fn locs_index_spans() {
        let compiled = generate(COMPONENT, &AUTOMATIC, |file, generated| {
            assert_eq!(generated.body[0].loc, Loc::EMPTY);
            let returned = generated.body.last().expect("the body has statements");
            let span = generated.spans[returned.loc.start as usize];
            assert_eq!(file.slice(span), b"return <div>{props.a}</div>;");
        });
        assert!(compiled.is_some());
    }

    #[test]
    fn new_date_is_kept() {
        let text = "function useNow() { useState(0); return new Date(); }";
        let found = generate(text, &AUTOMATIC, |_, generated| {
            (
                has_new_expression(generated.body),
                describe_statements(generated.body),
            )
        });
        let (has_new, shape) = found.expect("the function is compiled");
        assert!(has_new, "{shape}");
    }

    #[test]
    fn automatic_fragment_is_imported() {
        let origins = generated_origins(FRAGMENT, &AUTOMATIC);
        assert!(origins.contains(&SymbolOrigin::JsxImport(JsxImportKind::Fragment)));
        assert!(origins.contains(&SymbolOrigin::JsxImport(JsxImportKind::Jsx)));
        assert!(!origins.contains(&SymbolOrigin::ClassicFragment));
        assert!(!origins.contains(&SymbolOrigin::ClassicFactory));
    }

    #[test]
    fn classic_fragment_is_plain_tag() {
        let origins = generated_origins(FRAGMENT, &CLASSIC);
        assert!(origins.contains(&SymbolOrigin::ClassicFragment));
        assert!(origins.contains(&SymbolOrigin::ClassicFactory));
        let is_import = |it: &SymbolOrigin| matches!(it, SymbolOrigin::JsxImport(_));
        assert!(!origins.iter().any(is_import));
    }
}
