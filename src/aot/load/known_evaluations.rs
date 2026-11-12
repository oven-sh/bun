mod evaluator;
mod strings;
mod values;

use std::cmp::Reverse;
use std::rc::Rc;

use bun_core::strings::{contains, index_of_any, split};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::hir::{
    CallId, Chain, ExprId, ExprKind, File, FileBuilder, FnBody, FnId, FnKind, Keyword,
    KnownEvaluation, TypeNodeKind,
};
use bun_sema::resolve::TreeChange;
use bun_sema::session::Arena;
use bun_sema_parser::{AppendedExpression, parse_appended_expressions};
use rustc_hash::FxHashSet;

use self::evaluator::Evaluator;
use crate::load::import_functions::declares;
use crate::load::react_compiler::module_items::finish_file;

struct EvaluatingCall {
    call: CallId,
    is_of_function: bool,
    functions: Vec<FnId>,
}

fn find_evaluating_calls(hir: &File<'_>) -> Vec<EvaluatingCall> {
    let mut found: Vec<(u32, CallId, bool)> = Vec::new();
    for expression in hir.exprs.iter() {
        let (call, is_new) = match expression.kind {
            ExprKind::Call(call) => (call, false),
            ExprKind::New(call) => (call, true),
            _ => continue,
        };
        if hir[call].chain != Chain::No || hir[call].args.is_empty() {
            continue;
        }
        let callee = hir.skip_type_assertions(hir[call].callee);
        match hir[callee].kind {
            ExprKind::Ident(known::eval) if !is_new => found.push((expression.pos, call, false)),
            ExprKind::Ident(known::Function) if hir[call].args.len() > 1 => {
                found.push((expression.pos, call, true));
            }
            _ => {}
        }
    }
    if found.iter().any(|it| it.2) && declares(hir, known::Function) {
        found.retain(|it| !it.2);
    }
    if found.is_empty() {
        return Vec::new();
    }
    found.sort_unstable();
    let functions = (0..hir.fns.len() as u32).map(FnId);
    let with_end = functions.filter_map(|it| Some((hir[it].start, end_of_body(hir, it)?, it)));
    let mut ranges: Vec<(u32, u32, FnId)> = with_end.collect();
    ranges.sort_unstable_by_key(|range| (range.0, Reverse(range.1)));
    let mut ranges = ranges.into_iter().peekable();
    let mut open: Vec<(u32, FnId)> = Vec::new();
    let calls = found.into_iter().map(|(pos, call, is_of_function)| {
        while let Some((start, end, function)) = ranges.next_if(|range| range.0 <= pos) {
            open.retain(|outer| outer.0 > start);
            open.push((end, function));
        }
        open.retain(|around| around.0 > pos);
        EvaluatingCall {
            call,
            is_of_function,
            functions: open.iter().map(|around| around.1).collect(),
        }
    });
    calls.collect()
}

fn end_of_body(hir: &File<'_>, function: FnId) -> Option<u32> {
    match hir[function].body {
        FnBody::None => None,
        FnBody::Expr(expression) => Some(hir[expression].end),
        FnBody::Block(statements) => {
            let last = hir.ids(statements).next_back()?;
            Some(hir[last].loc.end)
        }
    }
}

fn begins_with_parenthesis(text: &[u8]) -> bool {
    let mut rest = text;
    loop {
        rest = rest.trim_ascii_start();
        if let Some(comment) = rest.strip_prefix(b"//") {
            let Some(end) = index_of_any(comment, b"\n\r") else {
                return false;
            };
            rest = &comment[end..];
        } else if let Some(comment) = rest.strip_prefix(b"/*") {
            let Some(end) = bun_core::strings::index_of(comment, b"*/") else {
                return false;
            };
            rest = &comment[end + 2..];
        } else {
            return rest.first() == Some(&b'(');
        }
    }
}

fn names_parameters(text: &[u8]) -> bool {
    let is_part = |&byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$');
    split(text, b",").all(|name| {
        let name = name.trim_ascii();
        name.first().is_some_and(|first| !first.is_ascii_digit()) && name.iter().all(is_part)
    })
}

fn text_of_function(arguments: &[Rc<[u8]>]) -> Option<Vec<u8>> {
    let (body, parameters) = arguments.split_last()?;
    if !parameters.iter().all(|it| names_parameters(it)) {
        return None;
    }
    let parameters = parameters.join(&b","[..]);
    Some(
        [
            b"function anonymous(",
            &parameters[..],
            b"\n) {\n",
            body,
            b"\n}",
        ]
        .concat(),
    )
}

struct EvaluatedText {
    call: CallId,
    arguments: Vec<Rc<[u8]>>,
    text: Vec<u8>,
    is_in_global_scope: bool,
}

fn is_function_to_compile(
    file: &FileBuilder,
    expressions_before: usize,
    root: ExprId,
    other_names: [Atom; 2],
) -> bool {
    let ExprKind::Fn(function) = file[root].kind else {
        return false;
    };
    let is_arrow = file[function].kind == FnKind::Arrow;
    let mut expressions = file.exprs[expressions_before..].iter();
    expressions.all(|it| match it.kind {
        ExprKind::Ident(known::eval) => false,
        ExprKind::Ident(known::require | known::module | known::exports) => false,
        ExprKind::Ident(name) if other_names.contains(&name) => false,
        ExprKind::Ident(known::arguments) => !is_arrow,
        ExprKind::This | ExprKind::NewTarget(_) => !is_arrow,
        ExprKind::Super => false,
        _ => true,
    })
}

pub(crate) fn write_known_evaluations<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    hir: &mut File<'s>,
    is_module: bool,
) -> TreeChange {
    if !hir.known_evaluations.is_empty()
        || hir.has_errors
        || hir.ran_out_of_stack
        || !(contains(&hir.text, b"eval") || contains(&hir.text, b"Function"))
    {
        return TreeChange::Unchanged;
    }
    let calls = find_evaluating_calls(hir);
    if calls.is_empty() {
        return TreeChange::Unchanged;
    }
    let is_strict_file = hir.is_strict || is_module;
    let strict_evals: FxHashSet<CallId> = calls
        .iter()
        .filter(|it| {
            let innermost = it.functions.last();
            is_strict_file || innermost.is_some_and(|&function| hir[function].is_strict)
        })
        .filter(|it| !it.is_of_function)
        .map(|it| it.call)
        .collect();
    let of_functions = calls.iter().filter(|it| it.is_of_function);
    let of_functions: FxHashSet<CallId> = of_functions.map(|it| it.call).collect();
    let mut texts: Vec<EvaluatedText> = Vec::new();
    for (call, arguments) in Evaluator::new(hir, atoms, &calls).find_texts(&calls) {
        let is_in_global_scope = of_functions.contains(&call);
        let text = match is_in_global_scope {
            true => text_of_function(&arguments),
            false => Some(arguments[0].to_vec()).filter(|text| begins_with_parenthesis(text)),
        };
        let Some(text) = text else {
            continue;
        };
        let is_break = |byte: &&u8| matches!(byte, b'\n' | b'\r' | 0xE2);
        let line_breaks = text.iter().filter(is_break).count();
        let has_numbers = texts.len() < 1 << 14 && line_breaks + 1 < 1 << 16;
        let has_html_comment = contains(&text, b"<!--") || contains(&text, b"-->");
        if has_numbers && !has_html_comment && std::str::from_utf8(&text).is_ok() {
            texts.push(EvaluatedText {
                call,
                arguments,
                text,
                is_in_global_scope,
            });
        }
    }
    if texts.is_empty() {
        return TreeChange::Unchanged;
    }
    texts.sort_by_key(|it| it.call);
    let mut file = FileBuilder::from_file(hir);
    let written_end = file.text.len();
    let source = file.text.to_mut();
    let expressions: Vec<AppendedExpression> = texts
        .iter()
        .map(|it| {
            source.push(b'\n');
            let start = source.len() as u32;
            source.extend_from_slice(&it.text);
            AppendedExpression {
                start,
                end: source.len() as u32,
                is_strict: strict_evals.contains(&it.call),
            }
        })
        .collect();
    source.push(b'\n');
    let other_names = [atoms.intern(b"Worker"), atoms.intern(b"anonymous")];
    let is_wanted = move |file: &FileBuilder, expressions_before: usize, root: ExprId| {
        is_function_to_compile(file, expressions_before, root, other_names)
    };
    let (mut file, parsed) = parse_appended_expressions(file, &expressions, atoms, &is_wanted);
    let mut known: Vec<KnownEvaluation> = Vec::new();
    for ((evaluated, place), found) in texts.iter().zip(&expressions).zip(parsed) {
        let Some((first_expression, mut function)) = found else {
            continue;
        };
        if evaluated.is_in_global_scope && file[function].end != place.end {
            continue;
        }
        if !file.is_js {
            let (pos, end) = (file[function].pos, file[function].end);
            let ty = file.ty(TypeNodeKind::Keyword(Keyword::Any), pos, end);
            let kind = ExprKind::As { expr: function, ty };
            function = file.expr(kind, pos, end);
        }
        let arguments = evaluated.arguments.iter().map(|it| atoms.intern(it));
        let arguments: Vec<Atom> = arguments.collect();
        known.push(KnownEvaluation {
            call: evaluated.call,
            function,
            first_expression,
            arguments: file.list(&arguments),
            start: place.start,
            end: place.end,
            is_in_global_scope: evaluated.is_in_global_scope,
        });
    }
    if known.is_empty() {
        return TreeChange::Unchanged;
    }
    for group in known.chunk_by(|a, b| a.call == b.call) {
        let call = group[0].call;
        let mut args: Vec<ExprId> = file.ids(file[call].args).collect();
        args.extend(group.iter().map(|it| it.function));
        file[call].args = file.list(&args);
    }
    file.known_evaluations = known;
    file.source_len = written_end as u32;
    *hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}
