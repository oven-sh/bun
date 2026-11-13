mod evaluator;
mod scripts;
mod settled;
mod strings;
mod values;

use std::cmp::Reverse;
use std::rc::Rc;

use bun_core::strings::{contains, index_of_any, split};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::hir::{
    BinOp, CallId, Chain, ExprId, ExprKind, File, FileBuilder, FnBody, FnId, FnKind, Keyword,
    KnownEvaluation, PatKind, StmtKind, TypeNodeKind, UnOp,
};
use bun_sema::resolve::TreeChange;
use bun_sema::session::Arena;
use bun_sema_parser::{AppendedExpression, parse_appended_expressions};
use rustc_hash::{FxHashMap, FxHashSet};

use self::evaluator::{Evaluator, TEXT_PER_SOURCE};
use self::scripts::{Script, rename_commonjs_names};
pub(crate) use self::settled::find_settled_evals;
use crate::engine::describe_regexp_syntax_error;
use crate::load::import_functions::declares;
use crate::load::react_compiler::module_items::finish_file;

const MAX_NESTED_TEXTS: u32 = 8;

pub(crate) fn may_need_scope_around(code: &[u8]) -> bool {
    contains(code, b"#") || contains(code, b"eval")
}

pub(crate) struct CodeBeside<'a> {
    pub path: &'a [u8],
    pub read_file: &'a dyn Fn(&[u8]) -> Option<Vec<u8>>,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum EvaluatingKind {
    DirectEval,
    Function,
    IndirectEval,
}

struct EvaluatingCall {
    call: CallId,
    kind: EvaluatingKind,
    functions: Vec<FnId>,
}

fn find_names_of_eval(hir: &File<'_>) -> FxHashSet<Atom> {
    let mut names: FxHashSet<Atom> = FxHashSet::default();
    for decl in hir.var_decls.iter().filter(|it| it.init.is_some()) {
        if let PatKind::Ident(name) = hir[decl.pat].kind
            && is_eval_itself(hir, decl.init)
        {
            names.insert(name);
        }
    }
    for expression in hir.exprs.iter() {
        if let ExprKind::Assign {
            op: None,
            target,
            value,
        } = expression.kind
            && let ExprKind::Ident(name) = hir[target].kind
            && is_eval_itself(hir, value)
        {
            names.insert(name);
        }
    }
    names.remove(&known::eval);
    names
}

fn is_eval_itself(hir: &File<'_>, expression: ExprId) -> bool {
    let expression = hir.skip_type_assertions(expression);
    matches!(hir[expression].kind, ExprKind::Ident(known::eval))
        || is_indirect_eval(hir, expression)
}

fn is_indirect_eval(hir: &File<'_>, callee: ExprId) -> bool {
    match hir[callee].kind {
        ExprKind::Binary {
            op: BinOp::Comma,
            right,
            ..
        } => is_eval_itself(hir, right),
        ExprKind::Dot {
            obj,
            name: known::eval,
            chain: Chain::No,
            ..
        } => matches!(
            hir[hir.skip_type_assertions(obj)].kind,
            ExprKind::Ident(known::globalThis)
        ),
        _ => false,
    }
}

fn find_evaluating_calls(hir: &File<'_>) -> Vec<EvaluatingCall> {
    let mut found: Vec<(u32, CallId, EvaluatingKind)> = Vec::new();
    let names_of_eval = find_names_of_eval(hir);
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
            ExprKind::Ident(known::eval) if !is_new => {
                found.push((expression.pos, call, EvaluatingKind::DirectEval));
            }
            ExprKind::Ident(known::Function) => {
                found.push((expression.pos, call, EvaluatingKind::Function));
            }
            ExprKind::Ident(name) if !is_new && names_of_eval.contains(&name) => {
                found.push((expression.pos, call, EvaluatingKind::IndirectEval));
            }
            _ if !is_new && is_indirect_eval(hir, callee) => {
                found.push((expression.pos, call, EvaluatingKind::IndirectEval));
            }
            _ => {}
        }
    }
    let is_of_function = |it: &(u32, CallId, EvaluatingKind)| it.2 == EvaluatingKind::Function;
    if found.iter().any(is_of_function) && declares(hir, known::Function) {
        found.retain(|it| !is_of_function(it));
    }
    if found.is_empty() {
        return Vec::new();
    }
    found.sort_unstable();
    let functions = (0..hir.fns.len() as u32).map(FnId);
    let with_end =
        functions.filter_map(|it| Some((start_of_code(hir, it), end_of_body(hir, it)?, it)));
    let mut ranges: Vec<(u32, u32, FnId)> = with_end.collect();
    ranges.sort_unstable_by_key(|range| (range.0, Reverse(range.1)));
    let mut ranges = ranges.into_iter().peekable();
    let mut open: Vec<(u32, FnId)> = Vec::new();
    let calls = found.into_iter().map(|(pos, call, kind)| {
        while let Some((start, end, function)) = ranges.next_if(|range| range.0 <= pos) {
            open.retain(|outer| outer.0 > start);
            open.push((end, function));
        }
        open.retain(|around| around.0 > pos);
        EvaluatingCall {
            call,
            kind,
            functions: open.iter().map(|around| around.1).collect(),
        }
    });
    calls.collect()
}

fn find_ranges_of_classes(hir: &File<'_>) -> Vec<(u32, u32)> {
    let statements = hir.stmts.iter().filter_map(|it| match it.kind {
        StmtKind::Class(class) => Some((hir[class].text_start, it.loc.end)),
        _ => None,
    });
    let expressions = hir.exprs.iter().filter_map(|it| match it.kind {
        ExprKind::Class(class) => Some((hir[class].text_start, it.end)),
        _ => None,
    });
    let mut ranges: Vec<(u32, u32)> = statements.chain(expressions).collect();
    ranges.sort_unstable();
    ranges.dedup_by(|inner, outer| inner.1 <= outer.1);
    ranges
}

fn is_within(ranges: &[(u32, u32)], pos: u32) -> bool {
    let after = ranges.partition_point(|it| it.0 <= pos);
    after > 0 && pos < ranges[after - 1].1
}

fn start_of_code(hir: &File<'_>, function: FnId) -> u32 {
    match hir[function].kind {
        FnKind::Arrow => hir[function].start,
        _ => hir[function].anchor.max(hir[function].start),
    }
}

fn end_of_body(hir: &File<'_>, function: FnId) -> Option<u32> {
    match hir[function].body {
        FnBody::None => None,
        FnBody::Expr(expression) => Some(hir[expression].end),
        FnBody::Block(statements) => match hir.ids(statements).next_back() {
            Some(last) => Some(hir[last].loc.end),
            None => end_of_parameters(hir, function),
        },
    }
}

fn end_of_parameters(hir: &File<'_>, function: FnId) -> Option<u32> {
    let last = hir[function].params.iter().last()?;
    if hir[function].kind == FnKind::Arrow {
        return Some(hir[function].anchor);
    }
    let default = hir[last].default.some();
    Some(default.map_or(0, |it| hir[it].end).max(hir[last].loc.end))
}

fn text_of_expression(text: &[u8]) -> Option<&[u8]> {
    let is_part = |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$');
    let length = text.iter().position(|it| !is_part(it))?;
    if length == 0 || text[0].is_ascii_digit() || !matches!(text[length], b'.' | b'(') {
        return None;
    }
    if &text[..length] == b"function" {
        return None;
    }
    let is_behind = |byte: &u8| *byte == b';' || byte.is_ascii_whitespace();
    let end = text.iter().rposition(|it| !is_behind(it))?;
    Some(&text[..=end])
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
    if parameters.is_empty() && !contains(body, b"function") && !contains(body, b"=>") {
        return None;
    }
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
    kind: EvaluatingKind,
    arguments: Vec<Rc<[u8]>>,
    text: Vec<u8>,
    is_call: bool,
}

const FUNCTION_OF_SCRIPT: (&[u8], &[u8]) = (b"function () {", b"\n}");
const FUNCTION_OF_CALL: &[u8] = b"()=>";

fn may_name_source(text: &[u8]) -> bool {
    contains(text, b"sourceURL=") && (contains(text, b"//#") || contains(text, b"//@"))
}

fn may_have_html_comment(text: &[u8]) -> bool {
    let lines = text.split(|it| matches!(it, b'\n' | b'\r' | 0xA8 | 0xA9));
    contains(text, b"-->")
        && lines.into_iter().any(|line| {
            let line = line.trim_ascii_start();
            line.starts_with(b"-->") || contains(line, b"*/") && contains(line, b"-->")
        })
}

fn is_function_to_compile(
    file: &FileBuilder,
    atoms: &Interner<'_>,
    expressions_before: usize,
    root: ExprId,
    is_call: bool,
    other_names: [Atom; 2],
) -> bool {
    let function = match file[root].kind {
        ExprKind::Fn(function) if is_call => match file[function].body {
            FnBody::Expr(body) if matches!(file[body].kind, ExprKind::Call(_)) => function,
            _ => return false,
        },
        _ if is_call => return false,
        ExprKind::Fn(function) => function,
        ExprKind::Assign {
            op: None,
            target,
            value,
        } => {
            let mut holder = target;
            let mut names = 0;
            while let ExprKind::Dot { obj, .. } = file[holder].kind {
                (holder, names) = (obj, names + 1);
            }
            let is_place = names > 0 && matches!(file[holder].kind, ExprKind::Ident(_));
            match file[value].kind {
                ExprKind::Fn(function) if is_place => function,
                _ => return false,
            }
        }
        _ => return false,
    };
    let is_arrow = file[function].kind == FnKind::Arrow;
    let is_parameter = |name: Atom| {
        let mut params = file[function].params.iter();
        params.any(|it| matches!(file[file[it].pat].kind, PatKind::Ident(own) if own == name))
    };
    let is_call_target = |target: ExprId| matches!(file[target].kind, ExprKind::Call(_));
    let (first, last) = (file[root].pos, file[root].end);
    let own_statements = file.stmts.iter().rev().take_while(|it| it.start >= first);
    let has_call_target = own_statements
        .filter(|it| it.start < last)
        .any(|it| match it.kind {
            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => {
                matches!(file[left].kind, StmtKind::Expr(target) if is_call_target(target))
            }
            _ => false,
        });
    if has_call_target {
        return false;
    }
    let mut expressions = file.exprs[expressions_before..].iter();
    expressions.all(|it| match it.kind {
        ExprKind::Assign { target, .. } if is_call_target(target) => false,
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
            operand,
        } if is_call_target(operand) => false,
        ExprKind::Ident(known::eval) => false,
        ExprKind::Ident(name @ (known::require | known::module | known::exports)) => {
            is_parameter(name)
        }
        ExprKind::Ident(name) if other_names.contains(&name) => false,
        ExprKind::Regex { pattern, flags } => {
            describe_regexp_syntax_error(atoms.bytes(pattern), atoms.bytes(flags)).is_none()
        }
        ExprKind::Ident(known::arguments) => !is_arrow,
        ExprKind::This | ExprKind::NewTarget(_) => !is_arrow,
        ExprKind::Super => false,
        _ => true,
    })
}

fn find_used_results(file: &FileBuilder, calls: &[EvaluatingCall]) -> FxHashSet<CallId> {
    let evals = calls
        .iter()
        .filter(|it| it.kind == EvaluatingKind::IndirectEval);
    let mut used: FxHashSet<CallId> = evals.map(|it| it.call).collect();
    if used.is_empty() {
        return used;
    }
    for statement in file.stmts.iter() {
        if let StmtKind::Expr(expression) = statement.kind
            && let ExprKind::Call(call) = file[expression].kind
        {
            used.remove(&call);
        }
    }
    used
}

fn return_last_value(file: &mut FileBuilder, function: ExprId) {
    let Some(last) = scripts::last_statement(file, function) else {
        return;
    };
    if let StmtKind::Expr(value) = file[last].kind {
        file[last].kind = StmtKind::Return(value);
    }
}

pub(crate) fn write_known_evaluations<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    hir: &mut File<'s>,
    is_module: bool,
    beside: &CodeBeside<'_>,
) -> TreeChange {
    if !hir.known_evaluations.is_empty()
        || hir.has_errors
        || hir.ran_out_of_stack
        || !(contains(&hir.text, b"eval") || contains(&hir.text, b"Function"))
    {
        return TreeChange::Unchanged;
    }
    let mut first_call = CallId(0);
    let mut text_allowance = hir.text.len() * TEXT_PER_SOURCE;
    let mut change = TreeChange::Unchanged;
    for _ in 0..MAX_NESTED_TEXTS {
        let calls = find_evaluating_calls(hir);
        if calls.iter().all(|it| it.call.0 < first_call.0) {
            return change;
        }
        let next_call = CallId(hir.calls.len() as u32);
        let evaluator = Evaluator::new(hir, atoms, beside, &calls, first_call, text_allowance);
        let (found, left) = evaluator.find_texts(&calls);
        if append_texts(arena, atoms, hir, is_module, &calls, found) == TreeChange::Unchanged {
            return change;
        }
        change = TreeChange::Changed;
        (first_call, text_allowance) = (next_call, left);
    }
    change
}

fn append_texts<'s>(
    arena: &'s Arena,
    atoms: &Interner<'s>,
    hir: &mut File<'s>,
    is_module: bool,
    calls: &[EvaluatingCall],
    found: Vec<(CallId, Vec<Rc<[u8]>>)>,
) -> TreeChange {
    let is_strict_file = hir.is_strict || is_module;
    let classes = find_ranges_of_classes(hir);
    let strict_evals: FxHashSet<CallId> = calls
        .iter()
        .filter(|it| {
            let innermost = it.functions.last();
            is_strict_file
                || innermost.is_some_and(|&function| hir[function].is_strict)
                || is_within(&classes, hir[hir[it.call].callee].pos)
        })
        .filter(|it| it.kind == EvaluatingKind::DirectEval)
        .map(|it| it.call)
        .collect();
    let kinds: FxHashMap<CallId, EvaluatingKind> =
        calls.iter().map(|it| (it.call, it.kind)).collect();
    let mut texts: Vec<EvaluatedText> = Vec::new();
    for (call, arguments) in found {
        let kind = kinds[&call];
        let text = match kind {
            EvaluatingKind::Function => text_of_function(&arguments),
            EvaluatingKind::DirectEval if begins_with_parenthesis(&arguments[0]) => {
                Some(arguments[0].to_vec())
            }
            EvaluatingKind::DirectEval => text_of_expression(&arguments[0]).map(<[u8]>::to_vec),
            EvaluatingKind::IndirectEval => Some(arguments[0].to_vec()),
        };
        let Some(text) = text else {
            continue;
        };
        let is_call = kind == EvaluatingKind::DirectEval
            && !begins_with_parenthesis(&text)
            && text.ends_with(b")");
        let is_break = |byte: &&u8| matches!(byte, b'\n' | b'\r' | 0xE2);
        let line_breaks = text.iter().filter(is_break).count();
        let number = hir.known_evaluations.len() + texts.len();
        let has_numbers = number < 1 << 14 && line_breaks + 1 < 1 << 16;
        let is_plain = !may_have_html_comment(&text) && !may_name_source(&text);
        if has_numbers && is_plain && std::str::from_utf8(&text).is_ok() {
            texts.push(EvaluatedText {
                call,
                kind,
                arguments,
                text,
                is_call,
            });
        }
    }
    if texts.is_empty() {
        return TreeChange::Unchanged;
    }
    texts.sort_by_key(|it| it.call);
    let mut file = FileBuilder::from_file(hir);
    let written_end = hir.written_text_end();
    let source = file.text.to_mut();
    let mut places: Vec<(u32, u32)> = Vec::new();
    let expressions: Vec<AppendedExpression> = texts
        .iter()
        .map(|it| {
            let (before, after) = match it.kind {
                EvaluatingKind::IndirectEval => FUNCTION_OF_SCRIPT,
                EvaluatingKind::DirectEval if it.is_call => (FUNCTION_OF_CALL, &[][..]),
                EvaluatingKind::DirectEval | EvaluatingKind::Function => (&[][..], &[][..]),
            };
            source.push(b'\n');
            let start = source.len() as u32;
            source.extend_from_slice(before);
            let start_of_text = source.len() as u32;
            source.extend_from_slice(&it.text);
            places.push((start_of_text, source.len() as u32));
            source.extend_from_slice(after);
            AppendedExpression {
                start,
                end: source.len() as u32,
                is_strict: strict_evals.contains(&it.call),
                is_in_global_scope: it.kind == EvaluatingKind::IndirectEval,
            }
        })
        .collect();
    source.push(b'\n');
    let used = find_used_results(&file, calls);
    let other_names = [atoms.intern(b"Worker"), atoms.intern(b"anonymous")];
    let is_wanted = |file: &FileBuilder, expressions_before: usize, root: ExprId| {
        let index = expressions.partition_point(|it| it.start <= file[root].pos);
        let Some(index) = index.checked_sub(1) else {
            return false;
        };
        match texts[index].kind {
            EvaluatingKind::IndirectEval => {
                let is_result_used = used.contains(&texts[index].call);
                Script::find(file, expressions_before, root).is_some_and(|script| {
                    expressions[index].end == file[root].end
                        && script.is_to_compile(file, atoms, is_result_used)
                })
            }
            EvaluatingKind::DirectEval | EvaluatingKind::Function => {
                let is_call = texts[index].is_call;
                is_function_to_compile(file, atoms, expressions_before, root, is_call, other_names)
            }
        }
    };
    let (mut file, parsed) = parse_appended_expressions(file, &expressions, atoms, &is_wanted);
    let mut known: Vec<KnownEvaluation> = Vec::new();
    let found = texts.iter().zip(&expressions).zip(&places).zip(parsed);
    for (((evaluated, place), &(text_start, end)), found) in found {
        let Some((first_expression, mut function)) = found else {
            continue;
        };
        let is_in_global_scope = evaluated.kind != EvaluatingKind::DirectEval;
        if is_in_global_scope && file[function].end != place.end {
            continue;
        }
        let is_script = evaluated.kind == EvaluatingKind::IndirectEval;
        if is_script {
            rename_commonjs_names(&mut file, atoms, first_expression, function);
            if used.contains(&evaluated.call) {
                return_last_value(&mut file, function);
            }
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
            start: match evaluated.is_call {
                true => place.start,
                false => text_start,
            },
            end,
            text_start,
            is_in_global_scope,
            is_script,
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
    file.known_evaluations.extend(known);
    file.source_len = written_end;
    *hir = finish_file(file, arena, atoms);
    TreeChange::Changed
}
