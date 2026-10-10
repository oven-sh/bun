use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use smallvec::SmallVec;
use std::cell::OnceCell;
use std::cmp::Ordering;

/// Ensure all imports appear before other statements.
pub struct First {
    absolute_first: bool,
}

const IN_BODY: Message = Message::new("", "Import in body of module; reorder to top.");
const ABSOLUTE_AFTER_RELATIVE: Message = Message::new("", "Absolute imports should come before relative imports.");
const FIRST: Message = Message::new("", "Import statements must come first");
const ABSOLUTE_FIRST: Message = Message::new("", "Relative imports before absolute imports are prohibited");

fn is_relative_path(path: &[u8]) -> bool {
    path.starts_with(b"./") || path.starts_with(b"../") || path.starts_with(b"/")
}

/// An import after something else.
struct ErrorInfo<'a> {
    node: Stmt<'a>,
    /// From the end of the statement before it.
    range: Span,
}

impl Rule for First {
    const META: Meta = Meta::plugin(Plugin::Import, "first", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        First { absolute_first: options.str(0) == Some("absolute-first") }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        file.has_stmts([StmtTag::Import, StmtTag::ImportEquals]).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        self.check(cx.file(), &|at, message| cx.report(at, message));
    }
}

impl First {
    /// Also for `imports-first`, the name that the rule had before.
    pub(super) fn check<'a>(&self, file: &'a File<'a>, report: &dyn Fn(Span, Message) -> Report<'a>) {
        let is_oxlint = file.language().is_oxlint;
        let (mut any_expressions, mut has_non_import, mut any_relative) = (false, false, false);
        let (mut last_legal_imp, mut previous) = (None, Span::default());
        let mut error_infos: SmallVec<[ErrorInfo; 4]> = SmallVec::new();
        for stmt in file.body() {
            let range = Span::after(std::mem::replace(&mut previous, stmt.span()), stmt.span().end);
            let source = match stmt.kind() {
                StmtKind::Import(import) => Some(import.spec()),
                StmtKind::ImportEquals(import) if !stmt.is_exported() => match import.target() {
                    ImportEqualsTarget::Require(Some(source)) => Some(source),
                    _ => None,
                },
                // For oxlint a string in parentheses is no directive.
                StmtKind::Expr(e)
                    if !any_expressions && e.as_string().is_some() && !(is_oxlint && e.is_parenthesized()) =>
                {
                    continue;
                }
                _ => {
                    (any_expressions, has_non_import) = (true, true);
                    continue;
                }
            };
            any_expressions = true;
            // oxlint passes over `import a = b.c`.
            if is_oxlint && source.is_none() {
                continue;
            }
            if self.absolute_first && let Some(source) = source {
                // For oxlint `.a` is absolute and `/a` relative.
                let source = source.bytes();
                let is_relative = if is_oxlint { is_relative_path(source) } else { source.starts_with(b".") };
                // oxlint points at the string in `require("a")` too.
                let place = || match stmt.kind() {
                    StmtKind::ImportEquals(import) if !is_oxlint => import.require_span(),
                    _ => stmt.module_specifier_span(),
                };
                if is_relative {
                    any_relative = true;
                } else if any_relative && let Some(span) = place() {
                    report(span, if is_oxlint { ABSOLUTE_FIRST } else { ABSOLUTE_AFTER_RELATIVE });
                }
            }
            if has_non_import {
                error_infos.push(ErrorInfo { node: stmt, range });
            } else {
                last_legal_imp = Some(stmt);
            }
        }
        let last_sort_nodes_index = OnceCell::new();
        for (index, info) in error_infos.iter().enumerate() {
            // oxlint has no fix.
            if is_oxlint {
                report(info.node.span(), FIRST);
                continue;
            }
            report(info.node.span(), IN_BODY).fix(|fixer| {
                let last = *last_sort_nodes_index.get_or_init(|| ErrorInfo::last_to_sort(&error_infos));
                match index.cmp(&last) {
                    Ordering::Less => Some(fixer.insert_after(info.node, "")),
                    Ordering::Equal => Some(ErrorInfo::sort(error_infos.get(..=last)?, last_legal_imp, fixer)),
                    Ordering::Greater => None,
                }
            });
        }
    }
}

impl<'a> ErrorInfo<'a> {
    /// Something that it declares is referred to before its end.
    fn is_used_before(&self) -> bool {
        let is_before = |it: Reference| it.ident().start() < self.range.end;
        Node::Stmt(self.node).declared_symbols().iter().any(|it| it.references().any(is_before))
    }

    /// `lastSortNodesIndex`: the last before the first that cannot be moved. The first of all is moved whatever it is.
    fn last_to_sort(error_infos: &[ErrorInfo]) -> usize {
        error_infos.iter().take_while(|it| !it.is_used_before()).count().saturating_sub(1)
    }

    /// Moves all of `sort_nodes` behind the last import that is where it belongs, or before the first statement.
    #[cold]
    #[inline(never)]
    fn sort(sort_nodes: &[ErrorInfo<'a>], last_legal_imp: Option<Stmt<'a>>, fixer: Fixer<'a>) -> Fix {
        let file = fixer.file();
        let mut insert_source_code = Vec::new();
        for info in sort_nodes {
            let node_source_code = file.slice(info.range);
            if strings::js_whitespace_len(node_source_code) == 0 {
                insert_source_code.push(b'\n');
            }
            insert_source_code.extend_from_slice(node_source_code);
        }
        let insert_at = match (last_legal_imp, file.body().first()) {
            (Some(import), _) => import.span().end,
            (None, first) => {
                let without_start = strings::trim_js_whitespace_start(&insert_source_code);
                let start_len = insert_source_code.len() - without_start.len();
                let end_len = without_start.len() - strings::trim_js_whitespace_end(without_start).len();
                insert_source_code.truncate(insert_source_code.len() - end_len);
                insert_source_code.rotate_left(start_len);
                first.map_or(0, |it| it.export_span().unwrap_or_else(|| it.span()).start)
            }
        };
        let start_of_text = if file.has_bom() { 3 } else { 0 };
        let mut replace_source_code = file.slice(Span::new(start_of_text, insert_at)).to_vec();
        replace_source_code.append(&mut insert_source_code);
        let mut kept_from = insert_at;
        for info in sort_nodes {
            replace_source_code.extend_from_slice(file.slice(Span::before(kept_from, info.range)));
            kept_from = info.range.end;
        }
        fixer.replace(Span::new(start_of_text, kept_from), replace_source_code)
    }
}
