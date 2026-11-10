use bun_core::strings::index_of_char_usize;
use bun_sema::atom::Interner;
use bun_sema::erasure::{ReplacedText, TypeRanges};
use bun_sema::fold::Decisions;
use bun_sema::hir::{
    Branches, ExprId, ExprKind, File, FileKind, Flags, MemberId, StmtId, StmtKind, UnOp,
    end_of_expr, start_of,
};
use bun_sema::node::{Node, NodeData};
use bun_sema::resolve::ScriptKind;
use bun_sema::session::Session;
use bun_sema_parser::{CompileParseOptions, parse_for_compile};

use crate::load::test_runner_names::{skip_to_written_use, written_name_of_local};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum What {
    Directive,
    Call,
    Construction,
    TaggedTemplate,
    Import,
    Assignment,
    Step,
    Deletion,
    Await,
    Yield,
    Throw,
    Name,
    Type,
    Member,
}

impl What {
    fn describe(self) -> &'static str {
        match self {
            What::Directive => "the directive",
            What::Call => "a call of",
            What::Construction => "a construction of",
            What::TaggedTemplate => "a template tagged by",
            What::Import => "an import()",
            What::Assignment => "an assignment to",
            What::Step => "a step of",
            What::Deletion => "a deletion of",
            What::Await => "an await",
            What::Yield => "a yield",
            What::Throw => "a throw",
            What::Name => "the name",
            What::Type => "a type",
            What::Member => "the member",
        }
    }
}

struct Part<'t> {
    what: What,
    name: &'t [u8],
    start: u32,
    end: u32,
    depth: Option<usize>,
}

#[derive(Default)]
pub(super) struct ChangesOfText {
    written_anew: Vec<(u32, u32)>,
    written_behind: Vec<u32>,
    left_out: Vec<(u32, u32)>,
    dead: Vec<(u32, u32)>,
    decided: Vec<(u32, u32)>,
}

impl ChangesOfText {
    pub(super) fn new(
        hir: &File<'_>,
        decisions: &Decisions<'_>,
        replaced: &[ReplacedText],
    ) -> ChangesOfText {
        let statements = decisions
            .dead_stmts()
            .map(|it| (hir[it].start, hir[it].loc.end));
        let expressions = decisions
            .dead_exprs()
            .map(|it| (start_of(hir, it), end_of_expr(hir, it)));
        let tests_with_dead_branch = hir.exprs.iter().filter_map(|it| match it.kind {
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = hir.branches(branches);
                (decisions.is_dead_expr(yes) || decisions.is_dead_expr(no)).then_some(test)
            }
            _ => None,
        });
        let folded = decisions.decided().iter().map(|&(it, _)| it);
        ChangesOfText {
            dead: statements.chain(expressions).collect(),
            decided: folded
                .chain(tests_with_dead_branch)
                .map(|it| (start_of(hir, it), end_of_expr(hir, it)))
                .collect(),
            ..ChangesOfText::of_replaced(replaced)
        }
    }

    pub(super) fn written_anew_at(mut self, mut stretches: Vec<(u32, u32)>) -> ChangesOfText {
        self.written_anew.append(&mut stretches);
        self
    }

    pub(super) fn not_evaluated_by_text_at(
        mut self,
        mut stretches: Vec<(u32, u32)>,
    ) -> ChangesOfText {
        self.dead.append(&mut stretches);
        self
    }

    fn of_replaced(replaced: &[ReplacedText]) -> ChangesOfText {
        let mut changes = ChangesOfText::default();
        for part in replaced {
            match &*part.text {
                b"" | b"(" | b")" | b"0, " | b";" | b" " => {
                    changes.left_out.push((part.start, part.end));
                }
                _ if part.start == part.end => changes.written_behind.push(part.start),
                _ => changes.written_anew.push((part.start, part.end)),
            }
        }
        changes
    }
}

pub(super) struct Difference {
    pub start: u32,
    pub end: u32,
    pub message: Vec<u8>,
}

struct Stretches(Vec<(u32, u32)>);

impl Stretches {
    fn new(mut all: Vec<(u32, u32)>) -> Stretches {
        all.retain(|stretch| stretch.0 < stretch.1);
        all.sort_unstable();
        let mut merged: Vec<(u32, u32)> = Vec::with_capacity(all.len());
        for (start, end) in all {
            match merged.last_mut() {
                Some(last) if start < last.1 => last.1 = last.1.max(end),
                _ => merged.push((start, end)),
            }
        }
        Stretches(merged)
    }

    fn find(&self, at: u32) -> Option<(u32, u32)> {
        let next = self.0.partition_point(|stretch| stretch.1 <= at);
        self.0.get(next).copied().filter(|stretch| stretch.0 <= at)
    }

    fn hold(&self, at: u32) -> bool {
        self.find(at).is_some()
    }
}

fn name_as_written(name: &[u8]) -> &[u8] {
    let Some(mark) = index_of_char_usize(name, b'#') else {
        return name;
    };
    let name = &name[mark..];
    &name[..index_of_char_usize(name, b'@').unwrap_or(name.len())]
}

fn find_operand_under_types(file: &File<'_>, mut expression: ExprId) -> ExprId {
    while let ExprKind::As { expr, .. }
    | ExprKind::Satisfies { expr, .. }
    | ExprKind::Instantiation { expr, .. }
    | ExprKind::AsConst(expr)
    | ExprKind::NonNull(expr) = file[expression].kind
    {
        expression = expr;
    }
    expression
}

fn find_name<'t>(file: &File<'_>, atoms: &'t Interner<'_>, expression: ExprId) -> &'t [u8] {
    match file[find_operand_under_types(file, expression)].kind {
        ExprKind::Ident(name) | ExprKind::Dot { name, .. } => name_as_written(atoms.bytes(name)),
        _ => b"",
    }
}

fn asks_for_type_of_name(file: &File<'_>, expression: ExprId) -> bool {
    let ExprKind::Unary {
        op: UnOp::Typeof,
        operand,
    } = file[expression].kind
    else {
        return false;
    };
    let operand = find_operand_under_types(file, operand);
    matches!(file[operand].kind, ExprKind::Ident(_))
}

fn describe_expression<'t>(
    file: &File<'_>,
    atoms: &'t Interner<'_>,
    expression: ExprId,
) -> Option<Part<'t>> {
    let (what, named) = match file[expression].kind {
        ExprKind::Call(call) => (What::Call, Some(file[call].callee)),
        ExprKind::New(call) => (What::Construction, Some(file[call].callee)),
        ExprKind::TaggedTemplate(call) => (What::TaggedTemplate, Some(file[call].callee)),
        ExprKind::ImportCall { .. } => (What::Import, None),
        ExprKind::Assign { target, .. } => (What::Assignment, Some(target)),
        ExprKind::Unary { op, operand } => match op {
            UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                (What::Step, Some(operand))
            }
            UnOp::Delete => (What::Deletion, Some(operand)),
            _ => return None,
        },
        ExprKind::Await(_) => (What::Await, None),
        ExprKind::Ident(_) => (What::Name, Some(expression)),
        ExprKind::Yield { .. } => (What::Yield, None),
        _ => return None,
    };
    Some(Part {
        what,
        name: named.map_or(&b""[..], |named| find_name(file, atoms, named)),
        start: file[expression].pos,
        end: file[expression].end,
        depth: None,
    })
}

fn describe_statement<'t>(
    file: &File<'_>,
    atoms: &'t Interner<'_>,
    statement: StmtId,
) -> Option<Part<'t>> {
    let (what, name) = match file[statement].kind {
        StmtKind::Directive { raw, .. } => (What::Directive, atoms.bytes(raw)),
        StmtKind::Throw(_) => (What::Throw, &b""[..]),
        _ => return None,
    };
    Some(Part {
        what,
        name,
        start: file[statement].start,
        end: file[statement].loc.end,
        depth: None,
    })
}

fn describe_member<'t>(file: &File<'_>, atoms: &'t Interner<'_>, member: MemberId) -> Part<'t> {
    let name = file[member].key.name();
    Part {
        what: What::Member,
        name: name.map_or(&b""[..], |name| name_as_written(atoms.bytes(name))),
        start: file[member].name_pos,
        end: file[member].loc.end,
        depth: None,
    }
}

fn find_parts<'t>(file: &File<'_>, atoms: &'t Interner<'_>, texts: &Stretches) -> Vec<Part<'t>> {
    let mut parts = Vec::new();
    let mut open = vec![(Node::FILE, 0)];
    let mut starts_around: Vec<u32> = Vec::new();
    while let Some((node, count_around)) = open.pop() {
        starts_around.truncate(count_around);
        let (part, start_of_level) = match file.data(node) {
            NodeData::Type(written) => {
                parts.push(Part {
                    what: What::Type,
                    name: b"",
                    start: file[written].pos,
                    end: file[written].end,
                    depth: None,
                });
                continue;
            }
            NodeData::Expr(expression) if asks_for_type_of_name(file, expression) => continue,
            NodeData::Expr(expression)
                if matches!(file[expression].kind, ExprKind::Cond { .. }) =>
            {
                let written = skip_to_written_use(file, |name| atoms.bytes(name), expression);
                if written != expression {
                    open.push((file.node(written), starts_around.len()));
                    continue;
                }
                (None, None)
            }
            NodeData::Expr(expression) => (describe_expression(file, atoms, expression), None),
            NodeData::Stmt(statement) => {
                let start = file[statement].start;
                (describe_statement(file, atoms, statement), Some(start))
            }
            NodeData::Member(member) => {
                let start = file[member].start;
                (Some(describe_member(file, atoms, member)), Some(start))
            }
            _ => (None, None),
        };
        if let Some(part) = part
            && let Some((start_of_text, _)) = texts.find(part.start)
        {
            let outside = starts_around.partition_point(|&start| start <= start_of_text);
            parts.push(Part {
                depth: Some(starts_around.len() - outside),
                ..part
            });
        }
        starts_around.extend(start_of_level);
        let first = open.len();
        file.for_each_child(node, &mut |child| {
            open.push((child, starts_around.len()));
            false
        });
        open[first..].reverse();
    }
    parts.sort_by_key(|part| part.start);
    parts
}

fn find_part_that_lacks<'a, 't: 'a>(
    wanted: impl Iterator<Item = &'a Part<'t>>,
    mut among: impl Iterator<Item = &'a Part<'t>>,
) -> Option<&'a Part<'t>> {
    let mut wanted = wanted;
    wanted.find(|part| {
        !among.any(|other| {
            let is_named_alike =
                part.name.is_empty() || other.name.is_empty() || part.name == other.name;
            let is_as_deep =
                part.depth.is_none() || other.depth.is_none() || part.depth == other.depth;
            other.what == part.what && is_named_alike && is_as_deep
        })
    })
}

fn say(part: &Part<'_>, rest: &str) -> Vec<u8> {
    let name: &[u8] = if part.name.is_empty() { b"" } else { b" " };
    [
        part.what.describe().as_bytes(),
        name,
        part.name,
        rest.as_bytes(),
    ]
    .concat()
}

type Wrapper = (&'static [u8], &'static [u8]);

const WRAPPERS: [Wrapper; 3] = [(b"(", b"\n)"), (b"({", b"\n})"), (b"(class {", b"\n})")];

struct Reader<'r, 's> {
    session: &'s Session,
    atoms: &'r Interner<'s>,
    options: CompileParseOptions<'r>,
}

impl<'s> Reader<'_, 's> {
    fn read_in(&self, text: &[u8], (open, close): Wrapper) -> Result<File<'s>, usize> {
        let wrapped = [open, text, close].concat();
        let file = parse_for_compile(self.session.arena(), &self.options, &wrapped, self.atoms);
        let error = file
            .syntax_errors()
            .next()
            .map(|error| error.start as usize);
        match error {
            Some(at) => Err(at.saturating_sub(open.len()).min(text.len())),
            None => Ok(file),
        }
    }

    fn read(&self, text: &[u8]) -> Option<(File<'s>, Wrapper)> {
        let mut wrappers = WRAPPERS.into_iter();
        wrappers.find_map(|wrapper| Some((self.read_in(text, wrapper).ok()?, wrapper)))
    }
}

pub(super) fn find_difference_in_kept_texts(
    hir: &File<'_>,
    atoms: &Interner<'_>,
    ranges: &TypeRanges,
    texts: Vec<(u32, u32)>,
    changes: ChangesOfText,
    path: &[u8],
    count_read_back: &mut u64,
) -> Option<Difference> {
    let packed = ranges.pack();
    let mut kept = vec![0; packed.kept_len(hir.text.len())];
    packed.remove_from(&hir.text, &mut kept);
    let session = Session::new();
    let atoms_of_kept = Interner::new_in(&session);
    let read_as = |script_kind| Reader {
        session: &session,
        atoms: &atoms_of_kept,
        options: CompileParseOptions {
            path,
            script_kind: Some(script_kind),
            experimental_decorators: hir.legacy_decorators,
            every_file_is_a_module: hir.is_forced_module,
            reads_jsdoc: false,
            ignores_pure_comments: false,
        },
    };
    let (reader_of_file, reader) = match (hir.is_js, hir.kind) {
        (true, FileKind::Tsx) => (read_as(ScriptKind::Jsx), read_as(ScriptKind::Js)),
        (true, _) => (read_as(ScriptKind::Js), read_as(ScriptKind::Js)),
        (false, FileKind::Tsx) => (read_as(ScriptKind::Tsx), read_as(ScriptKind::Js)),
        (false, _) => (read_as(ScriptKind::Ts), read_as(ScriptKind::Js)),
    };
    let dead = Stretches::new(changes.dead);
    let written = Stretches::new(ranges.texts_written_over().collect());
    let written_anew = Stretches::new(changes.written_anew);
    let left_out = Stretches::new(changes.left_out);
    let decided = Stretches::new(changes.decided);
    let mut written_behind = changes.written_behind;
    written_behind.sort_unstable();
    let is_wanted = |part: &Part<'_>| {
        let is_kept = !ranges.removes(part.start);
        let is_name_that_may_go = part.what == What::Name
            && (written_anew.hold(part.start)
                || decided.hold(part.start)
                || written_behind.binary_search(&part.end).is_ok());
        !dead.hold(part.start) && !is_name_that_may_go && (is_kept || left_out.hold(part.start))
    };
    let texts = Stretches::new(texts);
    let rewritten = hir
        .fns
        .iter()
        .filter(|it| it.flags.contains(Flags::REPLACED_BODY));
    let rewritten: Vec<u32> = rewritten.map(|function| function.anchor).collect();
    let of_tree = find_parts(hir, atoms, &texts).into_iter();
    let (directives, mut of_tree): (Vec<Part<'_>>, Vec<Part<'_>>) =
        of_tree.partition(|part| part.what == What::Directive);
    of_tree.retain(|part| part.what != What::Type);
    for part in &mut of_tree {
        part.name = written_name_of_local(part.name);
        let is_name =
            |byte: &u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$' | 0x80..);
        if part.what == What::Name
            && part.name.first() == Some(&b'%')
            && let Some(written) = hir.text.get(part.start as usize..part.end as usize)
            && written.iter().all(is_name)
        {
            part.name = written;
        }
    }
    for part in of_tree
        .iter_mut()
        .filter(|part| written_anew.hold(part.start))
    {
        part.depth = None;
    }

    texts.0.iter().find_map(|&(start, end)| {
        let differs = |message: Vec<u8>| {
            Some(Difference {
                start,
                end,
                message,
            })
        };
        let original = &hir.text[start as usize..end as usize];
        let kept_start = ranges.map_start(start);
        let text = &kept[kept_start as usize..ranges.map_end(end) as usize];
        if rewritten.iter().any(|&at| start <= at && at < end) {
            return None;
        }
        let mut directives = directives.iter();
        if text == original
            && let Some(kept) = directives.find(|part| start <= part.start && part.start < end)
        {
            return differs(say(kept, " stands in the text"));
        }
        let Some((read_back, wrapper)) = reader.read(text) else {
            let (_, wrapper) = reader_of_file.read(original)?;
            let at = reader.read_in(text, wrapper).err()?;
            let shown = &text[at.saturating_sub(24)..text.len().min(at + 8)];
            return differs([b"it does not parse: ", shown].concat());
        };
        *count_read_back += 1;
        let shift = wrapper.0.len() as u32;
        let whole = Stretches(vec![(shift, u32::MAX)]);
        let of_text = find_parts(&read_back, &atoms_of_kept, &whole);
        let first = of_tree.partition_point(|part| part.start < start);
        let of_tree =
            &of_tree[first..][..of_tree[first..].partition_point(|part| part.start < end)];
        let of_tree = || of_tree.iter().filter(|part| part.end <= end);
        let names_await = of_tree().any(|part| part.name == b"await");
        let alive = of_tree().filter(|part| is_wanted(part) && part.name != b"await");
        if let Some(lost) = find_part_that_lacks(alive, of_text.iter()) {
            return Some(Difference {
                start: lost.start,
                end: lost.end,
                message: say(lost, " is not in the text"),
            });
        }
        let copied = of_text.iter().filter(|part| {
            (part.what == What::Type || !written.hold(part.start - shift + kept_start))
                && !(names_await && part.what == What::Await)
        });
        let made = find_part_that_lacks(copied, of_tree())?;
        differs(say(made, " stands in the text and not in the tree"))
    })
}

#[cfg(test)]
mod tests {
    use bun_sema::erasure::find_type_ranges_beside;

    use super::*;

    fn read_back(path: &str, text: &str, replaced: &[(&str, &str)]) -> Option<String> {
        read_back_beside_tree_of(path, text, text, 0, replaced)
    }

    fn read_back_behind(
        path: &str,
        text: &str,
        first: &str,
        replaced: &[(&str, &str)],
    ) -> Option<String> {
        let start = text.find(first).expect("the text holds its first word") as u32;
        read_back_beside_tree_of(path, text, text, start, replaced)
    }

    fn read_back_beside_tree_of(
        path: &str,
        text_of_tree: &str,
        text: &str,
        start: u32,
        replaced: &[(&str, &str)],
    ) -> Option<String> {
        assert_eq!(text_of_tree.len(), text.len());
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let options = CompileParseOptions {
            path: path.as_bytes(),
            script_kind: None,
            experimental_decorators: false,
            every_file_is_a_module: false,
            reads_jsdoc: false,
            ignores_pure_comments: false,
        };
        let mut hir = parse_for_compile(session.arena(), &options, text_of_tree.as_bytes(), &atoms);
        assert!(hir.syntax_errors().next().is_none());
        hir.text = text.as_bytes().into();
        let replace = |(old, new): &(&str, &str)| {
            let start = text.find(old).expect("the text holds what is replaced") as u32;
            ReplacedText {
                start,
                end: start + old.len() as u32,
                text: new.as_bytes().into(),
            }
        };
        let replaced: Vec<ReplacedText> = replaced.iter().map(replace).collect();
        let changes = ChangesOfText::of_replaced(&replaced);
        let ranges = find_type_ranges_beside(&hir, replaced);
        let texts = vec![(start, text.len() as u32)];
        let path = path.as_bytes();
        find_difference_in_kept_texts(&hir, &atoms, &ranges, texts, changes, path, &mut 0)
            .map(|difference| String::from_utf8(difference.message).unwrap())
    }

    #[test]
    fn text_less_its_types_is_its_tree() {
        let text = "function double(this: unknown, value: number): number {\n  \
            type Gone = number;\n  return twice<Gone>(value!) as number;\n}";
        assert_eq!(read_back("a.ts", text, &[]), None);
        let text = "function level(o) { return o.take(Level.High); }";
        assert_eq!(read_back("a.js", text, &[("Level.High", "2")]), None);
        let text = "function asked(a: unknown) { return typeof<any>a; }";
        assert_eq!(read_back("a.ts", text, &[]), None);
        let text =
            "class Held { gone?(): void; kept!: number; constructor(public given: number) {} }";
        assert_eq!(read_back("a.ts", text, &[]), None);
    }

    #[test]
    fn tree_that_was_written_anew_beside_a_text_kept_as_written_is_found() {
        let text = "function found(o) { return o.asked(1); }";
        assert_eq!(read_back("a.js", text, &[]), None);
        let tree = "function found(o) { return o.given(1); }";
        let missed = read_back_beside_tree_of("a.js", tree, text, 0, &[]);
        assert_eq!(
            missed.as_deref(),
            Some("a call of given is not in the text")
        );
        let tree = "function found(o) { throw  o.asked(1); }";
        let missed = read_back_beside_tree_of("a.js", tree, text, 0, &[]);
        assert_eq!(missed.as_deref(), Some("a throw is not in the text"));
    }

    #[test]
    fn await_that_is_a_name_in_a_script_is_not_held_against_the_operator() {
        let text = "var await = one; class Held { [await (one())]() { return 1; } }";
        assert_eq!(read_back_behind("a.cjs", text, "class", &[]), None);
        let missed = read_back_behind("a.cjs", text, "class", &[("one())", "1)")]);
        assert_eq!(missed.as_deref(), Some("a call of one is not in the text"));
    }

    #[test]
    fn effect_that_is_left_out_is_missed() {
        let text = "function first(o) { o.a(); return o.b; }";
        let missed = read_back("a.js", text, &[("o.a();", "")]);
        assert_eq!(missed.as_deref(), Some("a call of a is not in the text"));
        let text = "function counted(box, yes, no) { return (box.calls++, true) ? yes : no; }";
        let missed = read_back(
            "a.js",
            text,
            &[("(box.calls++, true) ? ", ""), (" : no", "")],
        );
        assert_eq!(
            missed.as_deref(),
            Some("a step of calls is not in the text")
        );
    }

    #[test]
    fn name_of_a_test_that_is_left_out_is_missed() {
        let text = "function chosen(flag, yes, no) { return flag ? yes : no; }";
        let missed = read_back("a.js", text, &[("flag ? ", ""), (" : no", "")]);
        assert_eq!(missed.as_deref(), Some("the name flag is not in the text"));
        let text = "function asked(yes, no) { return typeof flag < \"u\" ? yes : no; }";
        let replaced = [("typeof flag < \"u\" ? ", ""), (" : no", "")];
        let missed = read_back("a.js", text, &replaced);
        assert_eq!(missed.as_deref(), Some("the name no is not in the text"));
    }

    #[test]
    fn part_that_comes_to_stand_elsewhere_is_missed() {
        let text = "function counted(flag, calls) { if (flag) ; calls++; return calls; }";
        let missed = read_back("a.js", text, &[(";", " ")]);
        assert_eq!(
            missed.as_deref(),
            Some("a step of calls is not in the text")
        );
        let text = "class Quiet { first = table;[key] }";
        let missed = read_back("a.js", text, &[(";", " ")]);
        assert_eq!(missed.as_deref(), Some("the member is not in the text"));
    }

    #[test]
    fn directive_that_erasure_makes_is_found() {
        let text = "function sloppy(this: unknown) { \"use strict\" as string; return this; }";
        let found = read_back("a.ts", text, &[]);
        let expected = "the directive use strict stands in the text and not in the tree";
        assert_eq!(found.as_deref(), Some(expected));
        assert_eq!(read_back("a.ts", text, &[("\"use", ";\"use")]), None);
        let text = "function strict() { \"use strict\"; return this; }";
        let found = read_back("a.js", text, &[]);
        let expected = "the directive use strict stands in the text";
        assert_eq!(found.as_deref(), Some(expected));
    }

    #[test]
    fn text_that_is_no_javascript_is_found() {
        let text = "function nothing(list) { if (false) var [] = list; return 1; }";
        let found = read_back("a.js", text, &[("[] = list", "")]);
        let expected = "it does not parse: (list) { if (false) var ; return";
        assert_eq!(found.as_deref(), Some(expected));
        let text = "function typed(value) { return value; }";
        let found = read_back("a.ts", text, &[("(value)", "(value: number)")]);
        let expected = "a type stands in the text and not in the tree";
        assert_eq!(found.as_deref(), Some(expected));
    }
}
