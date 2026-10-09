use bun_core::strings;
use bun_lint::prelude::*;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Policy {
    Always,
    Never,
    PreferImport,
}

impl Policy {
    fn of(option: Option<&str>, default: Policy) -> Policy {
        match option {
            Some("always") => Policy::Always,
            Some("never") => Policy::Never,
            Some("prefer-import") => Policy::PreferImport,
            _ => default,
        }
    }
}

/// Disallow certain triple slash directives in favor of ES6-style import declarations.
pub struct TripleSlashReference {
    lib: Policy,
    path: Policy,
    types: Policy,
}

const TRIPLE_SLASH_REFERENCE: Message = Message::new(
    "tripleSlashReference",
    "Do not use a triple slash reference for {{module}}, use `import` style instead.",
);

/// A `/// <reference .. />` that is not simply allowed.
pub struct Directive<'a> {
    comment: Token<'a>,
    module: &'a [u8],
    policy: Policy,
}

#[derive(Default)]
pub struct State<'a> {
    directives: Vec<Directive<'a>>,
    /// If they are many: where those are that an import is preferred to, by their modules.
    by_module: FxHashMap<&'a [u8], SmallVec<[u32; 1]>>,
}

impl TripleSlashReference {
    /// `/^\/\s*<reference\s*(types|path|lib)\s*=\s*["|'](.*)["|']/`: what applies to the first
    /// group, and the second group.
    fn parse<'a>(&self, value: &'a [u8]) -> Option<(Policy, &'a [u8])> {
        let rest = strings::trim_js_whitespace_start(value.strip_prefix(b"/")?);
        let rest = strings::trim_js_whitespace_start(rest.strip_prefix(b"<reference")?);
        let (policy, rest) = if let Some(rest) = rest.strip_prefix(b"types") {
            (self.types, rest)
        } else if let Some(rest) = rest.strip_prefix(b"path") {
            (self.path, rest)
        } else {
            (self.lib, rest.strip_prefix(b"lib")?)
        };
        let rest = strings::trim_js_whitespace_start(strings::trim_js_whitespace_start(rest).strip_prefix(b"=")?);
        let (b'"' | b'|' | b'\'', rest) = rest.split_first()? else {
            return None;
        };
        Some((policy, rest.get(..strings::last_index_of_any(rest, b"\"|'")?)?))
    }

    fn check_import<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let source = match stmt.kind() {
            StmtKind::Import(import) => import.spec(),
            StmtKind::ImportEquals(import) => match import.target() {
                ImportEqualsTarget::Require(Some(source)) => source,
                _ => return,
            },
            _ => return,
        };
        // For oxlint an import in a `declare module` does not count.
        let is_passed_over = cx.language().is_oxlint && !matches!(stmt.parent(), Node::File(_));
        if is_passed_over || cx.has_reported_too_much() {
            return;
        }
        let report = |directive: &Directive<'a>| {
            cx.report(directive.comment, TRIPLE_SLASH_REFERENCE).data("module", directive.module);
        };
        let State { directives, by_module } = &cx.state;
        if by_module.is_empty() {
            directives.iter().filter(|it| it.policy == Policy::PreferImport && source == it.module).for_each(report);
        } else if let Some(positions) = by_module.get(source.bytes()) {
            positions.iter().filter_map(|at| directives.get(*at as usize)).for_each(report);
        }
    }
}

impl Rule for TripleSlashReference {
    const META: Meta = Meta::typescript("triple-slash-reference", Kind::Suggestion).recommended();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let object = options.object(0);
        TripleSlashReference {
            lib: Policy::of(object.str("lib"), Policy::Always),
            path: Policy::of(object.str("path"), Policy::Never),
            types: Policy::of(object.str("types"), Policy::PreferImport),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> State<'a> {
        let mut directives = Vec::new();
        let program = file.program_span();
        if !strings::contains(file.slice(Span::before(0, program)), b"<reference") {
            return State::default();
        }
        for comment in file.comments_before(program) {
            if comment.kind() == TokenKind::Line
                && let Some((policy, module)) = self.parse(comment.comment_value())
                && policy != Policy::Always
            {
                directives.push(Directive {
                    comment,
                    module,
                    policy,
                });
            }
        }
        if directives.iter().any(|it| it.policy == Policy::Never) {
            on.finish(|_, cx| {
                for directive in &cx.state.directives {
                    if directive.policy == Policy::Never {
                        cx.report(directive.comment, TRIPLE_SLASH_REFERENCE)
                            .data("module", directive.module);
                    }
                }
            });
        }
        if directives.iter().any(|it| it.policy == Policy::PreferImport) {
            on.stmts([StmtTag::Import, StmtTag::ImportEquals], Self::check_import);
        }
        let mut by_module: FxHashMap<&'a [u8], SmallVec<[u32; 1]>> = FxHashMap::default();
        if directives.len() > 8 {
            for (at, directive) in directives.iter().enumerate().filter(|it| it.1.policy == Policy::PreferImport) {
                by_module.entry(directive.module).or_default().push(at as u32);
            }
        }
        State { directives, by_module }
    }
}
