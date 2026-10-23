use std::borrow::Cow;

use bun_core::strings::is_valid_utf8;
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{BindOptions, Binding, Bound, Decl, FunctionFlags, RuntimeBindOptions, bind};
use bun_sema::fold::{Constant, Decision, Decisions};
use bun_sema::hir::{DiagnosticClass, ExprId, ExprKind, File, Flags, FnId, StmtId, StmtKind, rare};
use bun_sema::module_format::ModuleFormat;
use bun_sema::resolve::FinishedFile;
use bun_sema::session::Session;
use bun_sema::util::ShardedMap;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use crate::builtins::{EvaluatedText, EvaluatedTextForm};
use crate::load::HOST_ROOT;
use crate::load::plugin_modules::append_encoded_segment;

const VIRTUAL_DIRECTORY: &[u8] = b"text/";
const VIRTUAL_EXTENSION: &[u8] = b".cjs";
const STANDALONE_PATH: &[u8] = b"/text.cjs";

pub(crate) struct EvaluatedTexts {
    files: ShardedMap<Vec<u8>, Box<[u8]>>,
}

impl EvaluatedTexts {
    pub(crate) fn new() -> EvaluatedTexts {
        EvaluatedTexts {
            files: ShardedMap::default(),
        }
    }

    pub(crate) fn add(
        &self,
        importer: &[u8],
        text: &EvaluatedText,
        atoms: &Interner<'_>,
    ) -> Option<Vec<u8>> {
        let texts: Vec<&[u8]> = text.texts.iter().map(|&part| atoms.bytes(part)).collect();
        let source = match text.form {
            EvaluatedTextForm::FunctionBody => try_create_function_text(&texts)?,
            EvaluatedTextForm::Script => try_create_script_text(texts.first()?)?,
        };
        let path = create_virtual_path(importer, text.call);
        let stored = self
            .files
            .insert_ref(path.clone(), source.clone().into_boxed_slice());
        (**stored == *source).then_some(path)
    }

    pub(crate) fn contains(&self, path: &[u8]) -> bool {
        self.files.get_ref(path).is_some()
    }

    pub(crate) fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        let text = self.files.get_ref(path)?;
        Some(Cow::Owned(text.to_vec()))
    }
}

pub(crate) fn find_evaluated_function(request: &FinishedFile<'_, '_>) -> Option<FnId> {
    let (hir, bound, analysis) = (request.hir, request.bound, request.analysis);
    let ExprKind::Fn(function) = hir[find_only_expression(hir)?].kind else {
        return None;
    };
    let is_script_wrapper = hir[function].name.is_none();
    let is_global_code = analysis.module_format == ModuleFormat::CommonJs
        && analysis.import_sites.is_empty()
        && bound.runtime.eval_scopes().is_empty()
        && !has_outer_scope_reference(hir, bound, function)
        && !has_replaced_expression(hir, &analysis.decisions)
        && !(is_script_wrapper && has_wrapper_reference(hir, bound, function));
    is_global_code.then_some(function)
}

fn expression_ids(hir: &File<'_>) -> impl Iterator<Item = ExprId> {
    (0..hir.exprs.len() as u32).map(ExprId)
}

fn has_outer_scope_reference(hir: &File<'_>, bound: &Bound<'_>, function: FnId) -> bool {
    let own_name = bound.declared_symbol(Decl::Fn(function));
    expression_ids(hir)
        .filter(|&expression| bound.is_evaluated_ident(expression))
        .any(|identifier| match bound.binding(identifier) {
            Binding::CommonJs(_) => true,
            Binding::Symbol(symbol) => symbol == own_name,
            Binding::Arguments(_) | Binding::Free => false,
        })
}

// No program can change these three globals, so evaluated text reads the same values.
fn is_constant_global(name: Atom, value: Constant) -> bool {
    match value {
        Constant::Undefined => name == known::undefined,
        Constant::Number(number) if number.is_nan() => name == known::NaN,
        Constant::Number(number) => name == known::Infinity && number == f64::INFINITY,
        Constant::Null | Constant::Boolean(_) | Constant::String(_) | Constant::BigInt(_) => false,
    }
}

fn has_replaced_expression(hir: &File<'_>, decisions: &Decisions<'_>) -> bool {
    expression_ids(hir).any(|expression| match decisions.decision(expression) {
        Decision::Unknown => false,
        Decision::Constant(value) => match hir[expression].kind {
            ExprKind::Ident(name) => !is_constant_global(name, value),
            _ => true,
        },
        Decision::GlobalPath(_) | Decision::Data(_) | Decision::DeferredData => true,
    })
}

fn has_wrapper_reference(hir: &File<'_>, bound: &Bound<'_>, wrapper: FnId) -> bool {
    let flags = bound.function_flags(wrapper);
    flags.contains(FunctionFlags::USES_ARGUMENTS) || hir.rare_syntax & rare::NEW_TARGET != 0
}

fn create_virtual_path(importer: &[u8], call: ExprId) -> Vec<u8> {
    let mut path = [HOST_ROOT, VIRTUAL_DIRECTORY].concat();
    append_encoded_segment(&mut path, importer);
    path.push(b'/');
    path.extend_from_slice(call.0.to_string().as_bytes());
    path.extend_from_slice(VIRTUAL_EXTENSION);
    path
}

fn try_create_function_text(texts: &[&[u8]]) -> Option<Vec<u8>> {
    let body: &[u8] = texts.last().copied().unwrap_or_default();
    let parameters = &texts[..texts.len().saturating_sub(1)];
    let is_function = |text: &[u8]| parses_alone(text) == Some(ParsedShape::OneFunctionExpression);
    let text = create_function_text(parameters, body);
    let parts_parse_apart = parameters.is_empty()
        || (is_function(&create_function_text(&[], body))
            && is_function(&create_function_text(parameters, b"")));
    (parts_parse_apart && is_function(&text)).then_some(text)
}

fn try_create_script_text(source: &[u8]) -> Option<Vec<u8>> {
    match parses_alone(source)? {
        ParsedShape::OneFunctionExpression | ParsedShape::OneExpression => {}
        ParsedShape::Other => return None,
    }
    let text = create_script_text(source);
    (parses_alone(&text) == Some(ParsedShape::OneFunctionExpression)).then_some(text)
}

fn create_function_text(parameters: &[&[u8]], body: &[u8]) -> Vec<u8> {
    let parameter_list = parameters.join(&b","[..]);
    [
        &b"(function anonymous("[..],
        &parameter_list,
        b"\n) {\n",
        body,
        b"\n})",
    ]
    .concat()
}

fn create_script_text(source: &[u8]) -> Vec<u8> {
    [&b"(function () {\nreturn (\n"[..], source, b"\n);\n})"].concat()
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ParsedShape {
    OneFunctionExpression,
    OneExpression,
    Other,
}

fn parses_alone(text: &[u8]) -> Option<ParsedShape> {
    if !is_valid_utf8(text) {
        return None;
    }
    let session = Session::new();
    let atoms = Interner::new_in(&session);
    let arena = session.arena();
    let parse_options = CompileParseOptions {
        path: STANDALONE_PATH,
        script_kind: None,
        experimental_decorators: false,
        every_file_is_a_module: false,
        reads_jsdoc: false,
        keeps_function_directives: true,
    };
    let mut hir = parse_for_compile(arena, &parse_options, text, &atoms);
    if has_syntax_error(&hir) || has_unsupported_syntax(&hir) {
        return None;
    }
    hir.text = Cow::Borrowed(text);
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let bound = bind(&hir, bind_options, &atoms, arena);
    if bound.ran_out_of_stack || has_early_redeclaration(&bound) {
        return None;
    }
    Some(classify_shape(&hir))
}

fn has_syntax_error(hir: &File<'_>) -> bool {
    let mut diagnostics = hir.diagnostics.iter();
    hir.has_errors
        || hir.ran_out_of_stack
        || diagnostics.any(|diagnostic| diagnostic.class == DiagnosticClass::EarlyError)
}

// `await` or `yield` in a list of parameters, `for (var a = 1 in b)`, and `010`.
const SYNTAX_THAT_MAY_BE_AN_ERROR: u32 =
    rare::SUSPENDS_IN_PARAMETERS | rare::ODD_LOOP_HEAD | rare::LEGACY_OCTAL;

// The parameters of an arrow function are read as if no generator stood around them: `(a = yield) => 1` has a name there, where the language has the operator, which is an error.
fn has_yield_as_name(hir: &File<'_>) -> bool {
    hir.exprs.iter().any(
        |expression| matches!(expression.kind, ExprKind::Ident(name) if name == known::r#yield),
    )
}

fn has_function_as_body(hir: &File<'_>) -> bool {
    let is_function = |body: StmtId| !body.is_none() && matches!(hir[body].kind, StmtKind::Fn(_));
    hir.stmts.iter().any(|statement| match statement.kind {
        StmtKind::If { yes, no, .. } => is_function(yes) || is_function(no),
        StmtKind::Labeled { body, .. } => is_function(body),
        _ => false,
    })
}

fn has_name_twice(hir: &File<'_>, statements: impl Iterator<Item = StmtId>) -> bool {
    let names: Vec<Atom> = statements
        .filter_map(|statement| match hir[statement].kind {
            StmtKind::Fn(function) => Some(hir[function].name),
            _ => None,
        })
        .collect();
    names
        .iter()
        .enumerate()
        .any(|(index, name)| names[..index].contains(name))
}

fn declares_function_twice_in_block(hir: &File<'_>) -> bool {
    hir.stmts.iter().any(|statement| match statement.kind {
        StmtKind::Block(statements) => has_name_twice(hir, hir.ids(statements)),
        StmtKind::Switch { cases, .. } => {
            has_name_twice(hir, cases.iter().flat_map(|case| hir.ids(hir[case].body)))
        }
        _ => false,
    })
}

// Each is legal in sloppy code and an early error in strict code, or the other way round by where it stands.
fn has_syntax_that_strict_code_forbids(hir: &File<'_>) -> bool {
    hir.rare_syntax & SYNTAX_THAT_MAY_BE_AN_ERROR != 0
        || has_yield_as_name(hir)
        || has_function_as_body(hir)
        || declares_function_twice_in_block(hir)
}

fn has_unsupported_syntax(hir: &File<'_>) -> bool {
    has_syntax_that_strict_code_forbids(hir)
        || !hir.decorators.is_empty()
        || (hir.members.iter()).any(|member| member.flags.contains(Flags::ACCESSOR))
        || (hir.exprs.iter()).any(|expression| !is_supported_expression(expression.kind))
}

fn is_supported_expression(kind: ExprKind) -> bool {
    match kind {
        ExprKind::Regex { .. }
        | ExprKind::TaggedTemplate(_)
        | ExprKind::As { .. }
        | ExprKind::Satisfies { .. }
        | ExprKind::AsConst(_)
        | ExprKind::NonNull(_)
        | ExprKind::Instantiation { .. }
        | ExprKind::Jsx(_)
        | ExprKind::ImportMeta
        | ExprKind::JsxText(_) => false,
        _ => true,
    }
}

fn has_early_redeclaration(bound: &Bound<'_>) -> bool {
    !bound.runtime.early_redeclarations().is_empty()
        || (0..bound.redeclarations.len()).any(|index| bound.is_early_error_redeclaration(index))
}

fn classify_shape(hir: &File<'_>) -> ParsedShape {
    let Some(expression) = find_only_expression(hir) else {
        return ParsedShape::Other;
    };
    match matches!(hir[expression].kind, ExprKind::Fn(_)) {
        true => ParsedShape::OneFunctionExpression,
        false => ParsedShape::OneExpression,
    }
}

fn find_only_expression(hir: &File<'_>) -> Option<ExprId> {
    let mut statements = hir.ids(hir.body);
    let (Some(statement), None) = (statements.next(), statements.next()) else {
        return None;
    };
    let StmtKind::Expr(expression) = hir[statement].kind else {
        return None;
    };
    Some(expression)
}
