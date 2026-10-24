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
    let has_wrapper_reference = hir.rare_syntax & rare::NEW_TARGET != 0
        || (bound.function_flags(function)).contains(FunctionFlags::USES_ARGUMENTS);
    let is_global_code = analysis.module_format == ModuleFormat::CommonJs
        && analysis.import_sites.is_empty()
        && bound.runtime.eval_scopes().is_empty()
        && !has_outer_scope_reference(hir, bound, function)
        && !has_replaced_expression(hir, &analysis.decisions)
        && !(is_script_wrapper && has_wrapper_reference);
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
    let text = [&b"(function () {\nreturn (\n"[..], source, b"\n);\n})"].concat();
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
    let mut diagnostics = hir.diagnostics.iter();
    if hir.has_errors
        || hir.ran_out_of_stack
        || diagnostics.any(|diagnostic| diagnostic.class == DiagnosticClass::EarlyError)
        || has_unsupported_syntax(&hir)
    {
        return None;
    }
    hir.text = Cow::Borrowed(text);
    let bind_options = BindOptions {
        runtime: Some(RuntimeBindOptions::default()),
        ..BindOptions::default()
    };
    let bound = bind(&hir, bind_options, &atoms, arena);
    if bound.ran_out_of_stack
        || !bound.runtime.early_redeclarations().is_empty()
        || (0..bound.redeclarations.len()).any(|index| bound.is_early_error_redeclaration(index))
    {
        return None;
    }
    Some(match find_only_expression(&hir) {
        Some(it) if matches!(hir[it].kind, ExprKind::Fn(_)) => ParsedShape::OneFunctionExpression,
        Some(_) => ParsedShape::OneExpression,
        None => ParsedShape::Other,
    })
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

// Each of the first four is legal in sloppy code and an early error in strict code, or the other way round by where it stands.
fn has_unsupported_syntax(hir: &File<'_>) -> bool {
    hir.rare_syntax & SYNTAX_THAT_MAY_BE_AN_ERROR != 0
        || has_yield_as_name(hir)
        || has_function_as_body(hir)
        || declares_function_twice_in_block(hir)
        || !hir.decorators.is_empty()
        || (hir.members.iter()).any(|member| member.flags.contains(Flags::ACCESSOR))
        || (hir.exprs.iter()).any(|expression| !is_supported_expression(expression.kind))
}

fn is_supported_expression(kind: ExprKind) -> bool {
    !matches!(
        kind,
        ExprKind::Regex { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Jsx(_)
            | ExprKind::ImportMeta
            | ExprKind::JsxText(_)
    )
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

#[cfg(test)]
mod tests {
    use bstr::BStr;

    use super::*;
    use crate::builtins::{BuiltinId, BuiltinPath, Mutability};
    use crate::compile::testing::with_project_view;
    use crate::ir::generated::Module;
    use crate::link::testing::link_sources;

    const IMPORTER: &[u8] = b"/project/a.js";

    fn create_function_call(atoms: &Interner<'_>, call: ExprId, body: &[u8]) -> EvaluatedText {
        EvaluatedText {
            call,
            form: EvaluatedTextForm::FunctionBody,
            callee: BuiltinPath {
                id: BuiltinId::Function,
                mutability: Mutability::ConstantUnlessWritten,
            },
            texts: [atoms.intern(body)].into_iter().collect(),
        }
    }

    fn assert_bodies_rejected(bodies: &[&[u8]]) {
        for &body in bodies {
            let text = try_create_function_text(&[body]);
            assert!(text.is_none(), "{} is taken", BStr::new(body));
        }
    }

    fn count_compiled_texts(source: &str) -> usize {
        with_project_view(&[("main.js", source)], |view| {
            let main = view.sources.entry_points()[0].file;
            view.sources.evaluated_functions_of(main).len()
        })
    }

    #[test]
    fn function_text_follows_create_dynamic_function() {
        let text = try_create_function_text(&[b"a", b"b = 1", b"return a + b"]);
        let expected = b"(function anonymous(a,b = 1\n) {\nreturn a + b\n})";
        assert_eq!(text.as_deref(), Some(&expected[..]));

        let empty = try_create_function_text(&[]);
        assert_eq!(
            empty.as_deref(),
            Some(&b"(function anonymous(\n) {\n\n})"[..])
        );

        assert!(try_create_function_text(&[b"a //", b"return a"]).is_some());
    }

    #[test]
    fn parameters_that_close_the_list_are_rejected() {
        assert!(try_create_function_text(&[b"/*", b"*/){"]).is_none());
        assert!(try_create_function_text(&[b"a) { if (a", b"return 1 }"]).is_none());
        assert!(try_create_function_text(&[b"a) {} + function (b", b""]).is_none());
    }

    #[test]
    fn body_with_syntax_error_is_rejected() {
        assert_bodies_rejected(&[b"return (", b"}) + (function () {", b"}, function () {"]);
    }

    #[test]
    fn redeclaration_is_rejected() {
        assert_bodies_rejected(&[b"let a; let a;", b"let a; var a;"]);
        assert!(try_create_function_text(&[b"a", b"let a;"]).is_none());
        assert!(try_create_function_text(&[b"a", b"var a;"]).is_some());
    }

    #[test]
    fn syntax_that_strict_code_forbids_is_left_to_the_run_time() {
        assert_bodies_rejected(&[
            b"'use strict'; 010",
            b"010",
            b"'use strict'; 08",
            b"'use strict'; 09.5",
            b"'use strict'; 00",
            b"'use strict'; -010",
            b"function f() { 'use strict'; 010 }",
            b"class A { m() { 010 } }",
            b"'use strict'; \"\\1\"",
            b"'use strict'; \"\\07\"",
            b"'use strict'; \"\\8\"",
            b"'use strict'; \"\\00\"",
            b"\"\\08\"; 'use strict'",
            b"function f() { \"\\1\"; 'use strict' }",
            b"'use strict'; if (1) function f() {}",
            b"if (1) function f() {}",
            b"'use strict'; if (1) ; else function f() {}",
            b"'use strict'; label: function f() {}",
            b"(function* () { (x = yield) => 1 })",
            b"function* g() { ({ a = yield }) => 1 }",
            b"function* g() { ([a = yield]) => 1 }",
            b"function* g() { async (a = yield) => 1 }",
            b"return yield",
            b"'use strict'; for (var a = 1 in b) ;",
            b"'use strict'; { function f() {} function f() {} }",
            b"'use strict'; switch (1) { case 1: function f() {} case 2: function f() {} }",
        ]);
        let taken: [&[u8]; 17] = [
            b"return '2024-01-08'",
            b"return \"at 10:08\" + ' 010 '",
            b"return 1 // 010",
            b"return 1 /* \\1 */",
            b"return 'a\\\\1'",
            b"return 10.05 + 105 + 1e05 + 0.5 + 0",
            b"return a0 + a.b0 + $0 + _01",
            b"return '\\n\\0' + '\\x01' + '\\u0001'",
            b"return 0x01 + 0o01 + 0b01 + 0n",
            b"if (a) var b = 1; return b",
            b"if (a) { function f() {} }",
            b"label: { function f() {} }",
            b"function f() {} function f() {}",
            b"{ function f() {} } { function f() {} }",
            b"{ function f() {} function g() {} }",
            b"for (var a in b) ; for (var c of d) ;",
            b"return function* () { yield (a => a); }",
        ];
        for body in taken {
            assert!(
                try_create_function_text(&[body]).is_some(),
                "{} is rejected",
                BStr::new(body)
            );
        }
    }

    fn count_linked_texts(source: &str) -> usize {
        let linked = link_sources(&[("main.js", source)]).expect("the program links");
        let program = linked.program;
        let directory = [HOST_ROOT, VIRTUAL_DIRECTORY].concat();
        let is_text = |module: &&Module| program.strings.get(module.path).starts_with(&directory);
        program.modules.iter().filter(is_text).count()
    }

    fn count_linked_function_bodies(body: &str) -> usize {
        count_linked_texts(&format!(
            "export const create = () => new Function({body:?});\n"
        ))
    }

    #[test]
    fn early_error_outside_parser_and_binder_leaves_the_text_out() {
        let bodies = [
            "break;",
            "continue;",
            "for (;;) { (function () { break; }); }",
            "a: for (;;) { break b; }",
            "a: a: ;",
            "super.x;",
            "'use strict'; delete a;",
        ];
        for body in bodies {
            assert!(
                try_create_function_text(&[body.as_bytes()]).is_some(),
                "{body}"
            );
            assert_eq!(count_linked_function_bodies(body), 0, "{body}");
        }
        let script = "export const read = () => (0, eval)(\"super.x\");\n";
        assert_eq!(count_linked_texts(script), 0);
    }

    #[test]
    fn early_error_in_one_text_leaves_the_others_in() {
        let source = "
            export const failing = () => new Function(\"break;\");
            export const valid = () => new Function(\"return 1;\");
        ";
        assert_eq!(count_compiled_texts(source), 2);
        assert_eq!(count_linked_texts(source), 1);
    }

    #[test]
    fn jump_inside_its_statement_is_compiled() {
        for body in [
            "for (;;) { break; }",
            "a: for (;;) { continue a; }",
            "delete a;",
        ] {
            assert_eq!(count_linked_function_bodies(body), 1, "{body}");
        }
    }

    fn is_function_strict(text: &[u8], keeps_function_directives: bool) -> bool {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let parse_options = CompileParseOptions {
            path: STANDALONE_PATH,
            script_kind: None,
            experimental_decorators: false,
            every_file_is_a_module: false,
            reads_jsdoc: false,
            keeps_function_directives,
        };
        let hir = parse_for_compile(session.arena(), &parse_options, text, &atoms);
        let ExprKind::Fn(function) = hir[find_only_expression(&hir).unwrap()].kind else {
            panic!("{} is not a function expression", BStr::new(text));
        };
        hir[function].is_strict
    }

    fn strictness_of_compiled_texts(source: &str) -> Vec<bool> {
        with_project_view(&[("main.js", source)], |view| {
            let main = view.sources.entry_points()[0].file;
            let files = view.files();
            view.sources
                .evaluated_functions_of(main)
                .iter()
                .map(|text| files.hir(text.1.file)[text.1.function].is_strict)
                .collect()
        })
    }

    #[test]
    fn directive_of_text_makes_its_function_strict() {
        let text = try_create_function_text(&[b"'use strict'; return this;"]).unwrap();
        assert!(is_function_strict(&text, true));
        assert!(!is_function_strict(&text, false));
        let without_directive = try_create_function_text(&[b"return this;"]).unwrap();
        assert!(!is_function_strict(&without_directive, true));

        let strict = r#"Function("'use strict'; return this;");"#;
        assert_eq!(strictness_of_compiled_texts(strict), [true]);
        assert_eq!(
            strictness_of_compiled_texts(r#"Function("return this;");"#),
            [false]
        );
        assert_eq!(
            count_linked_function_bodies("'use strict'; return this;"),
            1
        );
    }

    #[test]
    fn directive_after_parameter_default_leaves_the_text_out() {
        let count_linked = |parameter: &str, body: &str| {
            let call = format!("new Function({parameter:?}, {body:?})");
            count_linked_texts(&format!("export const create = () => {call};\n"))
        };
        assert!(try_create_function_text(&[b"a = 1", b"'use strict'; return a;"]).is_some());
        assert_eq!(count_linked("a = 1", "'use strict'; return a;"), 0);
        assert_eq!(count_linked("a = 1", "return a;"), 1);
        assert_eq!(count_linked("a", "'use strict'; return a;"), 1);
    }

    #[test]
    fn unsupported_syntax_is_rejected() {
        assert_bodies_rejected(&[
            b"return /a/",
            b"return tag`a`",
            b"return import.meta",
            b"return <a />",
            b"return a as any",
            b"return class { accessor a }",
            b"return @decorator class {}",
            b"return \"\xED\xA0\x80\"",
        ]);
        assert!(try_create_function_text(&[b"return `a${1}`"]).is_some());
    }

    #[test]
    fn expression_script_is_taken() {
        let text = try_create_script_text(b"this");
        let expected = b"(function () {\nreturn (\nthis\n);\n})";
        assert_eq!(text.as_deref(), Some(&expected[..]));

        let sources: [&[u8]; 3] = [b"1 + 1", b"(function () {})", b"a = 1 // comment"];
        for source in sources {
            let text = try_create_script_text(source);
            assert!(text.is_some(), "{} is rejected", BStr::new(source));
        }
    }

    #[test]
    fn block_and_declaration_scripts_are_rejected() {
        let sources: [&[u8]; 9] = [
            b"{}",
            b"function f() {}",
            b"var x = 1",
            b"a; b",
            b"1;",
            b"",
            b"\"use strict\"",
            b"await a",
            b"#!a\n1",
        ];
        for source in sources {
            let text = try_create_script_text(source);
            assert!(text.is_none(), "{} is taken", BStr::new(source));
        }
    }

    #[test]
    fn paths_differ_by_importer_and_call() {
        let path = create_virtual_path(IMPORTER, ExprId(7));
        assert_eq!(path, b"/$bun/text/%2fproject%2fa.js/7.cjs");
        assert_ne!(path, create_virtual_path(b"/project/b.js", ExprId(7)));
        assert_ne!(path, create_virtual_path(IMPORTER, ExprId(8)));
    }

    #[test]
    fn equal_text_is_added_once() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let texts = EvaluatedTexts::new();
        let text = create_function_call(&atoms, ExprId(3), b"return this");

        let path = texts.add(IMPORTER, &text, &atoms).unwrap();

        assert_eq!(texts.add(IMPORTER, &text, &atoms).as_ref(), Some(&path));
        assert_eq!(texts.files.entries(), 1);
        assert!(texts.contains(&path));
        let expected = b"(function anonymous(\n) {\nreturn this\n})";
        assert_eq!(texts.read(&path).as_deref(), Some(&expected[..]));
    }

    #[test]
    fn conflicting_text_is_rejected() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let texts = EvaluatedTexts::new();
        let first = create_function_call(&atoms, ExprId(3), b"return 1");
        let second = create_function_call(&atoms, ExprId(3), b"return 2");

        assert!(texts.add(IMPORTER, &first, &atoms).is_some());
        assert_eq!(texts.add(IMPORTER, &second, &atoms), None);
    }

    #[test]
    fn rejected_text_is_not_served() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let texts = EvaluatedTexts::new();
        let text = create_function_call(&atoms, ExprId(3), b"return (");

        assert_eq!(texts.add(IMPORTER, &text, &atoms), None);

        let path = create_virtual_path(IMPORTER, ExprId(3));
        assert!(!texts.contains(&path));
        assert_eq!(texts.read(&path), None);
    }

    #[test]
    fn only_text_that_reads_nothing_around_it_is_compiled() {
        let rows = [
            (r#"Function("return require");"#, 0),
            (r#"Function("require", "return require");"#, 1),
            (r#"Function("return import('./b.js')");"#, 0),
            (r#"(0, eval)("this");"#, 1),
            (r#"(0, eval)("arguments");"#, 0),
            (r#"(0, eval)("() => arguments");"#, 0),
            (r#"(0, eval)("new.target");"#, 0),
            (r#"Function("return this")();"#, 1),
            (r#"new Function("a", "b", "return a + b");"#, 1),
            (r#"Function("return new.target");"#, 1),
            (r#"Function("a", "return a === undefined");"#, 1),
            (r#"Function("return NaN");"#, 1),
            (r#"Function("return -Infinity");"#, 1),
            (r#"(0, eval)("undefined");"#, 1),
            (r#"Function("return anonymous");"#, 0),
            (r#"Function("anonymous", "return anonymous");"#, 1),
            (r#"Function("return eval('1')");"#, 0),
        ];
        for (source, count) in rows {
            assert_eq!(count_compiled_texts(source), count, "{source}");
        }
        let globals = "return [undefined, NaN, Infinity];";
        assert_eq!(count_linked_function_bodies(globals), 1);
    }
}
