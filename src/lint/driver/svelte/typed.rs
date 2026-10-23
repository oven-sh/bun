//! A component's type-checked program: the TypeScript that svelte-eslint-parser 1.9 passes to typescript-eslint
//! (`parseTypeScriptInSvelte`), byte for byte except for the component's `export default` at the end, which no import
//! here sees. It's built in two steps, as there:
//!
//! - [`Lets`] is `ScriptsSourceCode` plus what `ScriptLetContext` adds for the markup (`context/script-let.ts` and the
//!   converters in `parser/converts`): the scripts' code in place, the rest of the component as whitespace, then the
//!   markup's code in conversion order, with the types svelte-eslint-parser gives to event handlers, to component
//!   attribute values and to `let:` declarations, then the top-level snippets and the type parameters of `generics`.
//! - [`Analysis`] of a first parse of that, and [`analyzed`] (`analyzeTypeScriptInSvelte`): the declarations of stores,
//!   `$$props` and the runes before the scripts, the `$:` statements and `$derived` arguments in separate functions,
//!   and the markup in a function.
//!
//! A component whose `lang` is JavaScript is checked as JavaScript (`getJavaScriptParserOptions`), with types from
//! JSDoc.
//!
//! Each piece of code appears once, but not in component order and not on its original line: a report is mapped back by
//! offset ([`Virtual::to_original`]), and the component's code is linked to its nodes by the pieces of its range
//! ([`View`](bun_lint::ast::view::View)). Synthesized code is glue, which rules don't see. The other rules see the
//! program from [`lower`](super::lower), which is neither.
//!
//! Only the rules that [run where types are](bun_lint::rule::Meta::runs_where_types_are) run on it. Their reports are
//! merged with the other rules' reports on the `lower` program before the component's comments are applied
//! ([`TypedOutcome::Reports`]), for each text a fix produces from the component. If typescript-eslint would throw,
//! ESLint runs them ([`TypedOutcome::Refused`]).
//!
//! Ports parts of svelte-eslint-parser, Copyright (c) 2021 Yosuke Ota, under the MIT License: see LICENSE.md.

use super::{Dialect, Parsed, Virtual};
use crate::lint::{Context, How};
use crate::typed::{ComponentResult, ProjectsOf};
use bun_core::strings;
use bun_format::svelte::ast::{
    self, DirectiveKind, ElementKind, Expression, ExpressionKind, Id, Kind, Tree, Value,
};
use bun_lint::ast::svelte::{Lowered, RUNES, SVELTE_GLOBALS};
use bun_lint::ast::view::{Piece, View};
use bun_lint::ast::{ExprKind, File, Node, StmtKind};
use bun_lint::context::Severity;
use bun_lint::linter::{LintMessage, LintOptions, ResolvedConfig, RuleId, parse_error};
use bun_lint::options::Json;
use bun_lint::source::Places;
use bun_lint::span::Span;
use bun_sema::resolve::ScriptKind;
use std::sync::Arc;

/// The outcome of a component's typed program.
pub(crate) enum TypedOutcome {
    /// The reports of the rules that run there, in component positions, before the comments are applied.
    Reports(Vec<LintMessage>),
    /// A rule threw: the ordinary component failure path ends the run with this error.
    Thrown(Vec<u8>),
    /// There's no native program: the config names its own programs, or one the checker rejects, a project that doesn't
    /// include the component, or no `extraFileExtensions` for components. ESLint runs those rules, and fails the way
    /// typescript-eslint fails.
    Refused,
}

/// The inputs of a typed program, before it's checked.
pub(crate) enum Prepared {
    /// The config creates no program, or none of the rules that need one is on.
    Nothing,
    Refused,
    Program(Box<Program>),
}

pub(crate) struct Program {
    path: Vec<u8>,
    /// The component.
    text: Vec<u8>,
    /// Its config, and the program's config, with the native rules.
    base: Arc<ResolvedConfig>,
    config: Arc<ResolvedConfig>,
    summary: bun_lint::ast::svelte::Component,
    scopes: Lowered,
    lowered: Virtual,
    view: View,
    is_javascript: bool,
    projects: ProjectsOf,
}

impl Context<'_, '_> {
    /// The [`TypedOutcome`] for the component `text` at `path`, whose config is `base`: from
    /// [`Context::prefill_types_of`] if that checked it, otherwise from a program built and checked now. `None` if
    /// there's no program, so the rules that run where types are run on the program the other rules see.
    pub(crate) fn typed_of(
        &self,
        path: &[u8],
        text: &[u8],
        base: &Arc<ResolvedConfig>,
    ) -> Option<Arc<TypedOutcome>> {
        // Without a program there's nothing to check, and no copy of the text to keep.
        if !base.language.wants_types {
            return None;
        }
        if let Some(found) = self.svelte.typed_found(path, text) {
            return found;
        }
        let prepared = self.prepare_types(path, text, base);
        let outcome = self.check_types(&[prepared]).pop().flatten();
        self.svelte.note_typed(path, text, outcome.clone());
        outcome
    }

    /// Builds the typed programs of the natively linted components in `targets` whose config asks for types (per
    /// `wants_types`), checks them together, and keeps the outcomes for [`Context::typed_of`]. `for_each` calls the
    /// work with each index below a count, on the threads. Returns the paths of the rejected ones, which ESLint lints
    /// with types.
    pub(crate) fn prefill_types_of(
        &self,
        targets: &[crate::discover::Target],
        wants_types: &(dyn Fn(&crate::discover::Target, &Arc<ResolvedConfig>) -> bool + Sync),
        for_each: &dyn Fn(usize, &(dyn Fn(usize) + Sync)),
    ) -> Vec<Vec<u8>> {
        let candidates: Vec<(&crate::discover::Target, &Arc<ResolvedConfig>)> = (targets.iter())
            .filter_map(|it| match &it.status {
                crate::discover::Status::Matched(config) => Some((it, config)),
                _ => None,
            })
            .filter(|(it, config)| {
                super::is_native(&it.path, config)
                    && config.language.wants_types
                    && wants_types(it, config)
            })
            .collect();
        if candidates.is_empty() {
            return Vec::new();
        }
        let prepared = bun_threading::Guarded::new(Vec::new());
        for_each(candidates.len(), &|at| {
            let Some(&(target, config)) = candidates.get(at) else {
                return;
            };
            let Ok(text) = crate::fs::read(&target.path) else {
                return;
            };
            if !super::is_reproduced(&text) {
                return;
            }
            let it = self.prepare_types(&target.path, &text, config);
            prepared.lock().push((at, target.path.clone(), text, it));
        });
        let mut prepared = std::mem::take(&mut *prepared.lock());
        // In file order, whichever thread finished first.
        bun_lint::utils::sort::sort_by_key(&mut prepared, |it| it.0);
        let prepared = prepared
            .into_iter()
            .map(|(_, path, text, it)| (path, text, it));
        self.prefill_types(prepared.collect())
    }

    /// Checks the typed programs of all of `prepared`, each with its component's path and text, together, and keeps the
    /// outcomes for [`Context::typed_of`]. Returns the paths of the rejected ones.
    fn prefill_types(&self, prepared: Vec<(Vec<u8>, Vec<u8>, Prepared)>) -> Vec<Vec<u8>> {
        let (keys, prepared): (Vec<(Vec<u8>, Vec<u8>)>, Vec<Prepared>) = prepared
            .into_iter()
            .map(|(path, text, it)| ((path, text), it))
            .unzip();
        let outcomes = self.check_types(&prepared);
        let mut refused = Vec::new();
        for ((path, text), outcome) in keys.into_iter().zip(outcomes) {
            if matches!(outcome.as_deref(), Some(TypedOutcome::Refused)) {
                refused.push(path.clone());
            }
            self.svelte.note_typed(&path, &text, outcome);
        }
        refused
    }

    /// What the component `text` at `path` with `base` needs to be checked.
    pub(crate) fn prepare_types(
        &self,
        path: &[u8],
        text: &[u8],
        base: &Arc<ResolvedConfig>,
    ) -> Prepared {
        let options = &base.language.parser_options;
        if !base.language.wants_types {
            return Prepared::Nothing;
        }
        let (natives, _) = self.svelte.with_natives(base);
        let is_turned_on = || {
            let typed = bun_lint_svelte::RULES
                .iter()
                .filter(|it| it.meta.runs_where_types_are());
            typed
                .into_iter()
                .any(|it| strings::contains(text, it.meta.name.as_bytes()))
        };
        if !natives.has_enabled(|it| it.runs_where_types_are()) && !is_turned_on() {
            return Prepared::Nothing;
        }
        let contexts = &self.svelte.contexts;
        let Ok(svelte_config) = contexts.svelte_config(path, options, self.cwd) else {
            return Prepared::Nothing;
        };
        let parsed = super::as_parsed(text);
        let tree = bun_format::svelte::parse_tree(
            &parsed.text,
            crate::fmt::parse_parts,
            crate::fmt::parse_javascript,
        );
        let Ok(tree) = tree else {
            return Prepared::Nothing;
        };
        let dialect = Dialect::of(
            (&tree, parsed.lang),
            (text, &svelte_config),
            &base.language,
            &base.parser_names,
        );
        if !dialect.is_typescript || dialect.is_handed_off {
            return Prepared::Nothing;
        }
        let names_svelte = |it: &Json| matches!(it, Json::String(it) if it == b".svelte");
        let extensions = options.get(b"extraFileExtensions");
        let has_extension =
            matches!(extensions, Some(Json::Array(it)) if it.iter().any(names_svelte));
        if options.get(b"programs").is_some_and(Json::is_truthy) || !has_extension {
            return Prepared::Refused;
        }
        let Some(projects) = crate::typed::projects_of(options, path, self.cwd) else {
            return Prepared::Refused;
        };
        if projects == ProjectsOf::Service
            && crate::typed::may_be_default_project(options, path, self.cwd)
        {
            return Prepared::Refused;
        }
        // Then the component itself is rejected.
        let Some(mut summary) = crate::svelte_summary::summarize(
            text,
            &parsed.text,
            &tree,
            super::generics_of(&tree, &dialect),
        ) else {
            return Prepared::Nothing;
        };
        let runes = (&*svelte_config, dialect.configured_runes);
        (summary.component).set_context(contexts.context_of(path, &natives, runes, self.cwd));
        let config = self.svelte.config_for(&natives, true, dialect.runes);
        let is_svelte_5 = summary.component.context().svelte_version.as_deref() != Some("3/4");
        let Some(code) = Lets::code(text, &parsed, &tree, &dialect, is_svelte_5) else {
            return Prepared::Nothing;
        };
        // The code's undeclared references: svelte-eslint-parser first parses the program once without them.
        let mut analysis = None;
        let how = How::parsed_as(ScriptKind::Ts);
        self.parse(path, &code.text.text, &config, &how, &mut |file| {
            let file = file.filter(|it| parse_error(it).is_none());
            analysis = file.map(|file| Analysis::of(file, &code, &dialect));
        });
        let Some(analysis) = analysis else {
            return Prepared::Refused;
        };
        // `getJavaScriptParserOptions`: without a TypeScript `lang`, the program is JavaScript.
        let is_javascript = matches!(parsed.lang, None | Some(b"" | b"js" | b"javascript"));
        let lowered = analyzed(&code, &analysis, &dialect, is_javascript);
        Prepared::Program(Box::new(Program {
            path: path.to_vec(),
            text: text.to_vec(),
            base: Arc::clone(base),
            config,
            summary: summary.component,
            scopes: Lowered::default(),
            view: View::new(text, lowered.segments.clone()),
            lowered,
            is_javascript,
            projects,
        }))
    }

    /// Checks the programs of `prepared` together, and lints each one.
    fn check_types(&self, prepared: &[Prepared]) -> Vec<Option<Arc<TypedOutcome>>> {
        let programs: Vec<&Program> = (prepared.iter())
            .filter_map(|it| match it {
                Prepared::Program(program) => Some(&**program),
                _ => None,
            })
            .collect();
        let lints: Vec<_> = (programs.iter())
            .map(|&program| for_files(move |file| self.lint_types(program, file)))
            .collect();
        let components: Vec<crate::typed::Component> = (programs.iter().zip(&lints))
            .map(|(program, lint)| crate::typed::Component {
                path: &program.path,
                config: &program.base,
                language: &program.config.language,
                program: &program.lowered.text,
                is_javascript: program.is_javascript,
                projects: &program.projects,
                component_program: bun_lint::types::ComponentProgram {
                    view: &program.view,
                    component: &program.summary,
                    lowered: &program.scopes,
                },
                lint,
            })
            .collect();
        let mut checked = match components.is_empty() {
            true => Vec::new(),
            false => crate::typed::check_components(self, self.environment, &components),
        }
        .into_iter();
        (prepared.iter())
            .map(|it| match it {
                Prepared::Nothing => None,
                Prepared::Refused => Some(Arc::new(TypedOutcome::Refused)),
                Prepared::Program(_) => Some(Arc::new(match checked.next().flatten() {
                    Some(Ok(reports)) => TypedOutcome::Reports(reports),
                    Some(Err(thrown)) => TypedOutcome::Thrown(thrown),
                    None => TypedOutcome::Refused,
                })),
            })
            .collect()
    }

    /// Lints `file`, the typed program of `program`, with the rules that run where types are, and maps their reports to
    /// component positions. That's before the comments are applied, which happens once the other rules' reports are
    /// merged.
    fn lint_types<'f>(&self, program: &Program, file: &'f File<'f>) -> ComponentResult {
        let base = self.lint_options();
        let runs_here = |id: &RuleId| matches!(id, RuleId::Known(meta) | RuleId::Named(meta, _) if meta.runs_where_types_are());
        let filter = |id: &RuleId, severity: Severity| {
            runs_here(id) && base.rule_filter.is_none_or(|it| it(id, severity))
        };
        let is_synthetic = |span: Span| program.lowered.is_synthetic(span);
        let options = LintOptions {
            rule_filter: Some(&filter),
            report_unused_disable_directives: Some(Severity::Off),
            js_plugins: None,
            is_synthetic: Some(&is_synthetic),
            ..base
        };
        let result = self.linter.lint(file, &program.config, &options);
        if let Some(thrown) = result.thrown {
            return Err(thrown);
        }
        let places = Places::new(&program.text);
        let all = result.messages.into_iter().chain(result.suppressed);
        let mut messages: Vec<LintMessage> = all
            .filter(|it| it.rule_id.as_ref().is_some_and(runs_here))
            .map(|mut it| {
                it.suppressions = Vec::new();
                program.lowered.to_original(&mut it, file, &places);
                it
            })
            .collect();
        LintMessage::sort(&mut messages);
        Ok(messages)
    }
}

/// svelte-eslint-parser's `UniqueIdGenerator`: `$_` plus the base with a `_` for each UTF-16 unit that isn't a word
/// character, plus a number that grows with each name, until the name is in none of the texts.
#[derive(Default)]
struct Unique {
    seq: u32,
    used: bun_sema::util::FxHashSet<Vec<u8>>,
}

impl Unique {
    /// `is_in_texts` is true if a name is in the texts.
    fn generate(&mut self, base: &[u8], is_in_texts: &dyn Fn(&[u8]) -> bool) -> Vec<u8> {
        let mut stem = b"$_".to_vec();
        let mut at = 0;
        while let Some(&byte) = base.get(at) {
            let length = utf8_length(byte);
            match byte.is_ascii_alphanumeric() || byte == b'_' {
                true => stem.push(byte),
                false => stem.extend(std::iter::repeat_n(b'_', usize::from(length == 4) + 1)),
            }
            at += length;
        }
        loop {
            self.seq += 1;
            let candidate = [&stem[..], self.seq.to_string().as_bytes()].concat();
            let is_taken = self.used.contains(&candidate) || is_in_texts(&candidate);
            if !is_taken {
                self.used.insert(candidate.clone());
                return candidate;
            }
        }
    }
}

/// True if `needle` is in the concatenation of `pieces`, without building it.
fn is_in_pieces(pieces: &[&[u8]], needle: &[u8]) -> bool {
    if pieces.iter().any(|it| strings::contains(it, needle)) {
        return true;
    }
    // A match that crosses the end of a piece lies in the bytes around that end.
    let reach = needle.len().saturating_sub(1);
    if reach == 0 {
        return false;
    }
    let mut end = 0;
    for piece in pieces.iter().take(pieces.len().saturating_sub(1)) {
        end += piece.len();
        let (from, to) = (end.saturating_sub(reach), end + reach);
        let mut around = Vec::with_capacity(2 * reach);
        let mut offset = 0;
        for it in pieces {
            let (a, b) = (from.max(offset), to.min(offset + it.len()));
            if let Some(part) = it.get(a.saturating_sub(offset)..b.saturating_sub(offset)) {
                around.extend_from_slice(part);
            }
            offset += it.len();
        }
        if strings::contains(&around, needle) {
            return true;
        }
    }
    false
}

/// The length of the UTF-8 character that starts with `byte`. A byte that doesn't start a character counts as one.
fn utf8_length(byte: u8) -> usize {
    match byte {
        0xF0..=0xF7 => 4,
        0xE0..=0xEF => 3,
        0xC0..=0xDF => 2,
        _ => 1,
    }
}

/// The text of the scripts and markup that svelte-eslint-parser analyzes (`getCurrentVirtualCodeInfo`): `script`, then
/// `render`, then `rootScope`, with their lengths.
pub(crate) struct Code {
    text: Virtual,
    script: u32,
    render: u32,
    /// The types of the `<slot>` elements' names, in conversion order. `None` for `"default"`.
    slots: Vec<Option<Vec<u8>>>,
}

/// The svelte-eslint-parser string that `ScriptsSourceCode.addLet` writes to.
#[derive(Copy, Clone, PartialEq, Eq)]
enum LetKind {
    Render,
    Snippet,
    Generics,
}

/// The maximum nesting depth of elements and blocks: [`super::DEEPEST`].
const DEEPEST: u32 = super::DEEPEST;

/// An element's kind to svelte-eslint-parser: a `SvelteElement`'s `kind`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Of {
    Html,
    Component,
    Special,
}

impl Of {
    fn element(kind: ElementKind) -> Of {
        match kind {
            ElementKind::RegularElement | ElementKind::TitleElement | ElementKind::SlotElement => {
                Of::Html
            }
            ElementKind::Component => Of::Component,
            _ => Of::Special,
        }
    }
}

/// svelte-eslint-parser's `ScriptsSourceCode` and `ScriptLetContext`, for a component it treats as TypeScript.
struct Lets<'t, 'a> {
    text: &'t [u8],
    /// The text the tree's names point into.
    parsed: &'t [u8],
    tree: &'t Tree<'a>,
    /// `svelteVersion.gte(5)`
    is_svelte_5: bool,
    /// `raw`: the scripts' code in place, and the rest as whitespace.
    raw: Virtual,
    /// The length of `trimmedRaw`.
    trimmed: u32,
    /// `_appendScriptLets`: `beforeSpaces`, `render`, `snippet`, `generics`, once a script-let is written.
    appended: Option<[Virtual; 4]>,
    kind: LetKind,
    /// What `closeScope` writes, the kind it writes to, and the enclosing kind.
    closers: Vec<(&'static [u8], LetKind, LetKind)>,
    unique: Unique,
    /// The elements enclosing what's being converted, innermost last.
    elements: Vec<(Of, &'a [u8])>,
    /// `ctx.slots`: the types of the `<slot>` elements' names, in conversion order.
    slots: Vec<Option<Vec<u8>>>,
    depth: u32,
    stack: bun_core::StackCheck,
    is_broken: bool,
}

impl<'t, 'a> Lets<'t, 'a> {
    /// The code of the component `text`, which svelte-eslint-parser reads with TypeScript's parser. `None` if it's
    /// nested too deeply.
    fn code(
        text: &'t [u8],
        parsed: &'t Parsed<'_>,
        tree: &'t Tree<'a>,
        dialect: &Dialect,
        is_svelte_5: bool,
    ) -> Option<Code> {
        let raw = raw_scripts(text, parsed, tree);
        let trimmed = strings::trim_js_whitespace_end(&raw.text).len() as u32;
        let mut lets = Lets {
            text,
            parsed: &parsed.text,
            tree,
            is_svelte_5,
            raw,
            trimmed,
            appended: None,
            kind: LetKind::Render,
            closers: Vec::new(),
            unique: Unique::default(),
            elements: Vec::new(),
            slots: Vec::new(),
            depth: 0,
            stack: bun_core::StackCheck::init(),
            is_broken: false,
        };
        lets.root(dialect);
        if lets.is_broken {
            return None;
        }
        let Lets {
            raw,
            appended,
            slots,
            ..
        } = lets;
        let original_len = text.len() as u32;
        let mut code = Virtual {
            original_len,
            ..Virtual::default()
        };
        let Some([before_spaces, render, snippet, generics]) = appended else {
            let script = raw.text.len() as u32;
            code.append(raw);
            return Some(Code {
                text: code,
                script,
                render: 0,
                slots,
            });
        };
        raw.copy_into(0, trimmed, &mut code);
        code.push(Piece::Glue, b"\n;", raw.end_of(trimmed));
        let script = code.text.len() as u32;
        code.append(before_spaces);
        code.append(render);
        let render = code.text.len() as u32 - script;
        code.append(snippet);
        code.append(generics);
        Some(Code {
            text: code,
            script,
            render,
            slots,
        })
    }

    /// The text of the script-lets of `kind`, created where the first one is written (`addLet`).
    fn lets_of(&mut self, kind: LetKind) -> &mut Virtual {
        if self.appended.is_none() {
            let original_len = self.text.len() as u32;
            let empty = || Virtual {
                original_len,
                ..Virtual::default()
            };
            let mut before_spaces = empty();
            // `raw.slice(trimmedRaw.length + 2)`: two UTF-16 units after the code.
            let mut at = self.trimmed as usize;
            for _ in 0..2 {
                at += self.raw.text.get(at).map_or(0, |it| utf8_length(*it));
            }
            let end = self.raw.text.len() as u32;
            self.raw
                .copy_into((at as u32).min(end), end, &mut before_spaces);
            self.appended = Some([before_spaces, empty(), empty(), empty()]);
        }
        let [_, render, snippet, generics] = self.appended.get_or_insert_with(Default::default);
        match kind {
            LetKind::Render => render,
            LetKind::Snippet => snippet,
            LetKind::Generics => generics,
        }
    }

    fn glue(&mut self, code: &[u8], at: u32) {
        let kind = self.kind;
        self.lets_of(kind).push(Piece::Glue, code, at);
    }

    fn original(&mut self, start: u32, end: u32) {
        let bytes = self
            .text
            .get(start as usize..end as usize)
            .unwrap_or_default();
        let kind = self.kind;
        self.lets_of(kind).push(Piece::Original, bytes, start);
    }

    /// `generateUniqueId` over the component and `getCurrentVirtualCode`, whose pieces are searched one by one.
    fn unique_id(&mut self, base: &[u8]) -> Vec<u8> {
        let raw = &self.raw.text[..];
        let current: [&[u8]; 6] = match &self.appended {
            None => [raw, &[], &[], &[], &[], &[]],
            Some([a, b, c, d]) => {
                let trimmed = raw.get(..self.trimmed as usize).unwrap_or_default();
                [trimmed, b"\n;", &a.text, &b.text, &c.text, &d.text]
            }
        };
        let text = self.text;
        let is_in_texts = |it: &[u8]| strings::contains(text, it) || is_in_pieces(&current, it);
        self.unique.generate(base, &is_in_texts)
    }

    /// `pushScope`
    fn push_scope(&mut self, closer: &'static [u8], kind: LetKind) {
        self.closers.push((closer, kind, self.kind));
        self.kind = kind;
    }

    /// `closeScope`
    fn close_scope(&mut self, at: u32) {
        if let Some((closer, kind, upper)) = self.closers.pop() {
            self.lets_of(kind).push(Piece::Glue, closer, at);
            self.kind = upper;
        }
    }

    /// `addExpression`: `(e);`, or `(e)as (typing);`.
    fn expression(&mut self, e: Expression, typing: Option<&[u8]>) {
        let (start, end) = self.range(e);
        self.code_of(start, end, typing);
    }

    /// `getNodeRange` of a markup expression: including its leading comments and the comments after it, which Svelte
    /// attaches to a tag's expression. After a parenthesis the range is just the expression.
    fn range(&self, e: Expression) -> (u32, u32) {
        let behind = self
            .text
            .get(e.span.end as usize..e.outer.end as usize)
            .unwrap_or_default();
        let has_comments =
            behind.trim_ascii_start().starts_with(b"/") && !strings::contains_char(behind, b')');
        (
            e.from(),
            if has_comments {
                e.outer.end
            } else {
                e.span.end
            },
        )
    }

    /// `addExpressionFromRange`
    fn code_of(&mut self, start: u32, end: u32, typing: Option<&[u8]>) {
        self.glue(b"(", start);
        self.original(start, end);
        match typing {
            Some(typing) => self.glue(&[b")as (", typing, b");"].concat(), end),
            None => self.glue(b");", end),
        }
    }

    /// `(name);` for a markup name.
    fn name(&mut self, name: &[u8]) {
        if let Some(span) = ast::span_in(self.parsed, name) {
            self.code_of(span.start, span.end, None);
        }
    }

    /// `nestBlock`: `{`, or a function whose parameters are `params`, each with its range and type.
    fn nest_block(&mut self, mut params: Vec<(u32, u32, Vec<u8>)>, at: u32) {
        if params.is_empty() {
            self.glue(b"{", at);
            self.push_scope(b"}", self.kind);
            return;
        }
        bun_lint::utils::sort::sort_by_key(&mut params, |it| it.0);
        for (index, (start, end, typing)) in params.iter().enumerate() {
            self.glue(if index == 0 { b"(" } else { b"," }, *start);
            self.original(*start, *end);
            self.glue(&[b": (", &typing[..], b")"].concat(), *end);
        }
        self.glue(b")=>{", at);
        self.push_scope(b"};", self.kind);
    }

    fn root(&mut self, dialect: &Dialect) {
        let tree = self.tree;
        let mut children: Vec<Id> = tree.fragment(tree.fragment).to_vec();
        if let Some(options) = tree.options {
            let end = tree[options].end;
            let at = children.iter().position(|&it| end <= tree[it].start);
            children.insert(at.unwrap_or(children.len()), options);
        }
        let is_snippet = |it: &Id| matches!(tree[*it].kind, Kind::SnippetBlock { .. });
        let (snippets, others): (Vec<Id>, Vec<Id>) = children.into_iter().partition(is_snippet);
        for id in others {
            self.node(id, false);
        }
        for id in snippets {
            self.node(id, true);
        }
        if let Some(generics) = &dialect.generics {
            self.generics(generics);
        }
    }

    /// `addGenericTypeAliasDeclaration` for each type parameter of `generics` (`getTypeParameterRanges`), as written.
    fn generics(&mut self, generics: &super::GenericsSyntax) {
        let text = self.text;
        for parameter in &generics.parameters {
            let has_more = parameter.constraint.is_some() || parameter.default.is_some();
            let mut id = (
                parameter.span.start,
                if has_more {
                    parameter.declared.end
                } else {
                    parameter.span.end
                },
            );
            let mut constraint = parameter.constraint.map(|it| {
                let end = match parameter.default {
                    Some(_) => it.end,
                    None => parameter.span.end,
                };
                (it.start, end)
            });
            if let Some(range) = &mut constraint
                && let Some(at) = token_index(text, b"extends", id.1, range.0)
            {
                id.1 = at;
                range.0 = at + 7;
            }
            let mut default = parameter.default.map(|it| (it.start, parameter.span.end));
            if let Some(range) = &mut default {
                let from = constraint.map_or(id.1, |it| it.1);
                if let Some(at) = token_index(text, b"=", from, range.0) {
                    match &mut constraint {
                        Some(constraint) => constraint.1 = at,
                        None => id.1 = at,
                    }
                    range.0 = at + 1;
                }
            }
            let kind = self.kind;
            self.kind = LetKind::Generics;
            self.glue(b"type ", id.0);
            self.original(id.0, id.1);
            match constraint {
                Some(range) => {
                    self.glue(b" =     ", range.0);
                    self.original(range.0, range.1);
                    self.glue(b";", range.1);
                }
                None => self.glue(b" = unknown;", id.1),
            }
            if let Some(range) = default {
                let from = constraint.map_or(id.1, |it| it.1);
                let written = text
                    .get(from as usize..range.1 as usize)
                    .unwrap_or_default();
                let alias = self.unique_id(written);
                self.glue(&[b"type ", &alias[..], written, b";"].concat(), from);
            }
            self.kind = kind;
        }
    }

    /// `at_top` is true for a node at the component's top level.
    fn node(&mut self, id: Id, at_top: bool) {
        let nests = matches!(
            self.tree[id].kind,
            Kind::Element(_)
                | Kind::IfBlock { .. }
                | Kind::EachBlock { .. }
                | Kind::AwaitBlock { .. }
                | Kind::KeyBlock { .. }
                | Kind::SnippetBlock { .. }
        );
        self.depth += u32::from(nests);
        if self.depth > DEEPEST || !self.stack.is_safe_to_recurse() {
            self.is_broken = true;
        } else {
            self.convert(id, at_top);
        }
        self.depth -= u32::from(nests);
    }

    fn fragment(&mut self, fragment: ast::FragmentId) {
        for &id in self.tree.fragment(fragment) {
            self.node(id, false);
        }
    }

    /// `convertChildren` for one node.
    fn convert(&mut self, id: Id, at_top: bool) {
        let tree = self.tree;
        let start = tree[id].start;
        match &tree[id].kind {
            Kind::Text { .. }
            | Kind::Comment { .. }
            | Kind::StyleSheet { .. }
            | Kind::Script { .. }
            | Kind::Attribute { .. }
            | Kind::SpreadAttribute(_)
            | Kind::AttachTag(_)
            | Kind::Directive { .. }
            | Kind::StyleDirective { .. } => {}
            Kind::Element(element) => self.element(element),
            Kind::ExpressionTag(e) | Kind::HtmlTag(e) => self.expression(*e, None),
            Kind::RenderTag(e) => self.code_of(e.span.start, e.span.end, None),
            Kind::ConstTag(declarator, init) => {
                self.glue(b"const ", declarator.start);
                self.original(declarator.start, init.span.end);
                self.glue(b";", init.span.end);
            }
            Kind::DeclarationTag(declaration) => {
                self.original(declaration.start, declaration.end);
                self.glue(b";", declaration.end);
            }
            Kind::DebugTag(names) => {
                for name in names {
                    self.code_of(name.start, name.end, None);
                }
            }
            Kind::IfBlock {
                test,
                consequent,
                alternate,
                ..
            } => self.if_block(*test, *consequent, *alternate, start),
            Kind::EachBlock {
                expression,
                context,
                index,
                key,
                body,
                fallback,
            } => {
                let (expression_start, expression_end) = (expression.from(), expression.span.end);
                self.glue(b"Array.from(", expression_start);
                self.original(expression_start, expression_end);
                self.glue(b").forEach((", expression_end);
                match context {
                    Some(context) => {
                        let span = context.with_annotation();
                        self.original(span.start, span.end);
                    }
                    None => self.glue(b"__$ctx__", start),
                }
                if let Some(index) = index.and_then(|it| ast::span_in(self.parsed, it)) {
                    self.glue(b",", index.start);
                    self.original(index.start, index.end);
                }
                self.glue(b")=>{", start);
                self.push_scope(b"});", self.kind);
                if let Some(key) = key {
                    self.expression(*key, None);
                }
                self.fragment(*body);
                self.close_scope(start);
                if let Some(fallback) = fallback {
                    self.nest_block(Vec::new(), start);
                    self.fragment(*fallback);
                    self.close_scope(start);
                }
            }
            Kind::AwaitBlock {
                expression,
                value,
                error,
                pending,
                then,
                catch,
            } => {
                self.expression(*expression, None);
                if let Some(pending) = pending {
                    self.nest_block(Vec::new(), start);
                    self.fragment(*pending);
                    self.close_scope(start);
                }
                if let Some(then) = then {
                    let params = match value {
                        Some(value) => {
                            let span = value.with_annotation();
                            let typing = self.await_value(*expression, span);
                            vec![(span.start, span.end, typing)]
                        }
                        None => Vec::new(),
                    };
                    self.nest_block(params, start);
                    self.fragment(*then);
                    self.close_scope(start);
                }
                if let Some(catch) = catch {
                    let params = match error {
                        Some(error) => {
                            let span = error.with_annotation();
                            vec![(span.start, span.end, b"Error".to_vec())]
                        }
                        None => Vec::new(),
                    };
                    self.nest_block(params, start);
                    self.fragment(*catch);
                    self.close_scope(start);
                }
            }
            Kind::KeyBlock {
                expression,
                fragment,
            } => {
                self.expression(*expression, None);
                self.nest_block(Vec::new(), start);
                self.fragment(*fragment);
                self.close_scope(start);
            }
            Kind::SnippetBlock {
                expression: name,
                end_of_parameters,
                body,
            } => {
                let kind = if at_top { LetKind::Snippet } else { self.kind };
                let upper = self.kind;
                self.kind = kind;
                self.glue(b"function ", name.start);
                self.original(name.start, *end_of_parameters);
                self.glue(b"{", *end_of_parameters);
                self.kind = upper;
                self.push_scope(b"}", kind);
                self.fragment(*body);
                self.close_scope(*end_of_parameters);
            }
        }
    }

    /// `convertIfBlock`: `if(test){..}`, and `else ` with the alternate's block or the `{:else if}` inside it.
    fn if_block(
        &mut self,
        test: Expression,
        consequent: ast::FragmentId,
        alternate: Option<ast::FragmentId>,
        at: u32,
    ) {
        let tree = self.tree;
        let (start, end) = (test.from(), test.span.end);
        self.glue(b"if(", start);
        self.original(start, end);
        self.glue(b"){", end);
        self.push_scope(b"}", self.kind);
        self.fragment(consequent);
        let Some(alternate) = alternate else {
            self.close_scope(at);
            return;
        };
        // `beginElse`
        self.close_scope(at);
        self.glue(b"else ", at);
        self.push_scope(b"", self.kind);
        match tree.fragment(alternate) {
            [only]
                if matches!(
                    tree[*only].kind,
                    Kind::IfBlock {
                        is_else_if: true,
                        ..
                    }
                ) =>
            {
                self.node(*only, false);
            }
            _ => {
                self.nest_block(Vec::new(), at);
                self.fragment(alternate);
                self.close_scope(at);
            }
        }
        self.close_scope(at);
    }

    /// The type of the value of an `{:then}` for `expression`, whose pattern is at `pattern`: the literal itself, or
    /// what a promise of the expression's type resolves to, using a copy of the expression if it isn't a name or the
    /// pattern has that name. The declarations the type needs are written first.
    fn await_value(&mut self, expression: Expression, pattern: ast::Span) -> Vec<u8> {
        let written = expression.span.of(self.text).to_vec();
        if matches!(
            expression.kind,
            ExpressionKind::StringLiteral | ExpressionKind::OtherLiteral
        ) {
            return written;
        }
        let value = self.unique_id(b"AwaitThenValue");
        let declared = [
            b"type ",
            &value[..],
            b"<T> = T extends null | undefined\n    ? T\n    : T extends { then(value: infer F): any }\n    ? F extends (value: infer V, ...args: any) => any\n        ? ",
            &value,
            b"<V>\n        : never\n        : T;",
        ]
        .concat();
        let at = expression.span.start;
        if expression.kind == ExpressionKind::Identifier
            && !has_name(pattern.of(self.text), &written)
        {
            self.glue(&declared, at);
            return [&value[..], b"<(typeof ", &written, b")>"].concat();
        }
        let copy = self.unique_id(&written);
        self.glue(&[b"const ", &copy[..], b" = ", &written, b";"].concat(), at);
        self.glue(&declared, at);
        [&value[..], b"<(typeof ", &copy, b")>"].concat()
    }

    /// `convertHTMLElement`, `convertComponentElement` and `convertSpecialElement`.
    fn element(&mut self, element: &ast::Element<'a>) {
        let tree = self.tree;
        let of = Of::element(element.kind);
        let is_let = |it: &&Id| {
            matches!(
                tree[**it].kind,
                Kind::Directive {
                    kind: DirectiveKind::Let,
                    ..
                }
            )
        };
        let params: Vec<(u32, u32, Vec<u8>)> = (element.attributes.iter())
            .filter(is_let)
            .filter_map(|&it| {
                let Kind::Directive {
                    name, expression, ..
                } = &tree[it].kind
                else {
                    return None;
                };
                let typing = self.let_type(element, name);
                match expression {
                    Some(pattern) => Some((pattern.from(), pattern.span.end, typing)),
                    None => ast::span_in(self.parsed, name).map(|it| (it.start, it.end, typing)),
                }
            })
            .collect();
        let children = tree.fragment(element.fragment);
        let needs_scope = children.iter().any(|&it| {
            matches!(
                tree[it].kind,
                Kind::ConstTag(..) | Kind::DeclarationTag(_) | Kind::SnippetBlock { .. }
            )
        });
        let at = element.start_tag_end;
        let has_scope = !params.is_empty() || needs_scope;
        if has_scope {
            self.nest_block(params, at);
        }
        self.elements.push((of, element.name));
        for &attribute in element.attributes.iter().filter(|it| !is_let(it)) {
            self.attribute(attribute, of, element.name);
        }
        for &child in children {
            self.node(child, false);
        }
        self.elements.pop();
        if has_scope {
            self.close_scope(at);
        }
        if element.kind == ElementKind::SlotElement {
            let name = self.slot_name(element);
            self.slots.push(name);
        }
        if of == Of::Special
            && let Some(this) = element.this_definition
        {
            self.this(this);
        }
        if of == Of::Component {
            let first = strings::split(element.name, b".")
                .next()
                .unwrap_or_default();
            if let Some(span) = ast::span_in(self.parsed, first) {
                self.code_of(span.start, span.end, None);
            }
        }
    }

    /// `processThisAttribute`: the expression of `this`, unless it's a string without braces.
    fn this(&mut self, this: Id) {
        let tree = self.tree;
        let Kind::Attribute { value, .. } = &tree[this].kind else {
            return;
        };
        let [part] = value.parts() else {
            return;
        };
        if let Kind::ExpressionTag(e) = &tree[*part].kind {
            let is_text =
                e.kind == ExpressionKind::StringLiteral && !matches!(value, Value::Tag(_));
            if !is_text {
                self.expression(*e, None);
            }
        }
    }

    /// The type of the name that the `<slot>` `element` contributes to `$$slots`, as `analyzeDollarDollarVariables`
    /// writes it. `None` for `"default"`.
    fn slot_name(&self, element: &ast::Element<'a>) -> Option<Vec<u8>> {
        let tree = self.tree;
        let value = element
            .attributes
            .iter()
            .find_map(|&it| match &tree[it].kind {
                Kind::Attribute {
                    name: b"name",
                    value,
                } => Some(value),
                _ => None,
            })?;
        let parts: Vec<Id> = (value.parts().iter().copied())
            .filter(|&it| {
                !matches!(tree[it].kind, Kind::Text { .. }) || tree[it].start < tree[it].end
            })
            .collect();
        match &parts[..] {
            [] => None,
            [only] => match &tree[*only].kind {
                Kind::Text { raw } => {
                    let mut quoted = Vec::new();
                    bun_core::printer::json_stringify(
                        &bun_lint::ast::svelte::decode_character_references(raw, true),
                        &mut quoted,
                    );
                    Some(quoted)
                }
                _ => Some(b"string".to_vec()),
            },
            parts => {
                let mut template = b"`".to_vec();
                for &part in parts {
                    match &tree[part].kind {
                        Kind::Text { raw } => {
                            for &byte in
                                bun_lint::ast::svelte::decode_character_references(raw, true).iter()
                            {
                                if matches!(byte, b'$' | b'`') {
                                    template.push(b'\\');
                                }
                                template.push(byte);
                            }
                        }
                        _ => template.extend_from_slice(b"${string}"),
                    }
                }
                template.push(b'`');
                Some(template)
            }
        }
    }

    /// `buildLetDirectiveType` for `let:name` on `element`.
    fn let_type(&self, element: &ast::Element<'a>, name: &[u8]) -> Vec<u8> {
        let tree = self.tree;
        let any = || b"any".to_vec();
        let parent_component = || match self.elements.last() {
            Some((Of::Component, name)) => Some(*name),
            _ => None,
        };
        let slot = element
            .attributes
            .iter()
            .find_map(|&it| match &tree[it].kind {
                Kind::Attribute {
                    name: b"slot",
                    value,
                } => Some(value),
                _ => None,
            });
        let (slot, component) = match slot {
            Some(value) => {
                let [part] = value.parts() else {
                    return any();
                };
                let Kind::Text { raw } = &tree[*part].kind else {
                    return any();
                };
                let Some(component) = parent_component() else {
                    return any();
                };
                (
                    bun_lint::ast::svelte::decode_character_references(raw, true).into_owned(),
                    component,
                )
            }
            None => match Of::element(element.kind) {
                Of::Component => (b"default".to_vec(), element.name),
                _ => match parent_component() {
                    Some(component) => (b"default".to_vec(), component),
                    None => return any(),
                },
            },
        };
        let mut typing = [component, b"['$$slot_def']["].concat();
        bun_core::printer::json_stringify(&slot, &mut typing);
        typing.extend_from_slice(b"][");
        bun_core::printer::json_stringify(name, &mut typing);
        typing.push(b']');
        typing
    }

    /// `convertAttributes` for one attribute of an element named `element`, whose svelte-eslint-parser kind is `of`.
    fn attribute(&mut self, id: Id, of: Of, element: &[u8]) {
        let tree = self.tree;
        let node = &tree[id];
        match &node.kind {
            Kind::Attribute { name, value } => {
                let is_shorthand = matches!(value, Value::Tag(_))
                    && self.text.get(node.start as usize) == Some(&b'{')
                    && self.text.get(node.end.saturating_sub(1) as usize) == Some(&b'}');
                // `addObjectShorthandProperty` writes `({a});`. The name alone has the same type, and is what the
                // component's key and value link to.
                if is_shorthand {
                    if let Some(key) = ast::span_in(self.parsed, name) {
                        self.code_of(key.start, key.end, None);
                    }
                    return;
                }
                let parts: Vec<Id> = (value.parts().iter().copied())
                    .filter(|&it| {
                        !matches!(tree[it].kind, Kind::Text { .. }) || tree[it].start < tree[it].end
                    })
                    .collect();
                if let [only] = parts[..]
                    && let Kind::ExpressionTag(e) = &tree[only].kind
                {
                    let typing = self.attribute_type(of, element, name);
                    let typing = typing.filter(|_| !e.has_type_info);
                    self.expression(*e, typing.as_deref());
                    return;
                }
                for part in parts {
                    if let Kind::ExpressionTag(e) = &tree[part].kind {
                        self.expression(*e, None);
                    }
                }
            }
            Kind::SpreadAttribute(e) | Kind::AttachTag(e) => self.expression(*e, None),
            Kind::Directive {
                kind,
                name,
                expression,
                ..
            } => {
                let is_shorthand = expression.is_some_and(|it| {
                    it.kind == ExpressionKind::Identifier
                        && Some(it.span) == ast::span_in(self.parsed, name)
                });
                match kind {
                    DirectiveKind::Bind | DirectiveKind::Class => {
                        if let Some(e) = expression {
                            self.expression(*e, None);
                        }
                    }
                    DirectiveKind::On => {
                        if let Some(e) = expression {
                            let typing = (!e.has_type_info)
                                .then(|| self.event_handler_type(of, element, name));
                            self.expression(*e, typing.as_deref());
                        }
                    }
                    DirectiveKind::Use => {
                        if let Some(e) = expression {
                            let typing = [b"Parameters<typeof ", *name, b">[1]"].concat();
                            let typing = (!e.has_type_info).then_some(typing);
                            self.expression(*e, typing.as_deref());
                        }
                        if !is_shorthand {
                            self.name(name);
                        }
                    }
                    DirectiveKind::Animate | DirectiveKind::Transition(..) => {
                        if let Some(e) = expression {
                            self.expression(*e, None);
                        }
                        if !is_shorthand {
                            self.name(name);
                        }
                    }
                    DirectiveKind::Let => {}
                }
            }
            Kind::StyleDirective { name, value, .. } => match value {
                Value::True => self.name(name),
                _ => {
                    for &part in value.parts() {
                        if let Kind::ExpressionTag(e) = &tree[part].kind {
                            self.expression(*e, None);
                        }
                    }
                }
            },
            _ => {}
        }
    }

    /// `buildAttributeType`: the type of the value of `name` on an element.
    fn attribute_type(&self, of: Of, element: &[u8], name: &[u8]) -> Option<Vec<u8>> {
        if self.is_svelte_5
            && of == Of::Html
            && let Some(event) = name.strip_prefix(b"on")
        {
            return Some(self.event_handler_type(of, element, event));
        }
        if of != Of::Component {
            return None;
        }
        let props = match self.is_svelte_5 {
            true => [b"import('svelte').ComponentProps<typeof ", element, b">"].concat(),
            false => [
                b"(typeof ",
                element,
                b" extends new (...args: any[]) => (infer C extends import('svelte').SvelteComponent) ? import('svelte').ComponentProps<C> : never)",
            ]
            .concat(),
        };
        let property = conditional(
            b"PROP",
            &[b"keyof ", &props[..]].concat(),
            &[&props[..], b"[PROP]"].concat(),
            b"never",
        );
        Some(conditional(
            &[b"'", name, b"'"].concat(),
            b"infer PROP",
            &property,
            b"never",
        ))
    }

    /// `buildEventHandlerType`: the type of a handler for `event` on an element.
    fn event_handler_type(&self, of: Of, element: &[u8], event: &[u8]) -> Vec<u8> {
        let quoted = [b"'", event, b"'"].concat();
        let native_event = conditional(
            &quoted,
            b"infer EVT",
            &conditional(
                b"EVT",
                b"keyof HTMLElementEventMap",
                b"HTMLElementEventMap[EVT]",
                b"CustomEvent<any>",
            ),
            b"never",
        );
        let native = [b"(e:", &native_event[..], b")=>void"].concat();
        match of {
            Of::Component => {
                let events = [b"import('svelte').ComponentEvents<", element, b">"].concat();
                let exact = conditional(
                    &quoted,
                    b"infer EVT",
                    &conditional(
                        b"EVT",
                        &[b"keyof ", &events[..]].concat(),
                        &[&events[..], b"[EVT]"].concat(),
                        b"CustomEvent<any>",
                    ),
                    b"never",
                );
                let event = conditional(
                    b"0",
                    &[b"(1 & ", &events[..], b")"].concat(),
                    b"CustomEvent<any>",
                    &exact,
                );
                [b"(e:", &event[..], b")=>void"].concat()
            }
            Of::Special if element == b"svelte:component" => b"(e:CustomEvent<any>)=>void".to_vec(),
            Of::Special => native,
            Of::Html => {
                let elements = b"import('svelte/elements').SvelteHTMLElements";
                let attribute = [b"'on:", event, b"'"].concat();
                let by_attribute = conditional(
                    b"ATTR",
                    &[b"keyof ", &elements[..], b"[EL]"].concat(),
                    &[&elements[..], b"[EL][ATTR]"].concat(),
                    &native,
                );
                let by_element = conditional(
                    b"EL",
                    &[b"keyof ", &elements[..]].concat(),
                    &conditional(&attribute, b"infer ATTR", &by_attribute, b"never"),
                    &native,
                );
                conditional(
                    &[b"'", element, b"'"].concat(),
                    b"infer EL",
                    &by_element,
                    b"never",
                )
            }
        }
    }
}

/// `C extends E?(T):(F)`
fn conditional(check: &[u8], extends: &[u8], yes: &[u8], no: &[u8]) -> Vec<u8> {
    [check, b" extends ", extends, b"?(", yes, b"):(", no, b")"].concat()
}

/// `getTokenIndex`: the position of `token` from `start` on, before `end`, outside comments.
fn token_index(text: &[u8], token: &[u8], start: u32, end: u32) -> Option<u32> {
    let mut at = start as usize;
    while at < end as usize {
        let rest = text.get(at..)?;
        if rest.starts_with(token) {
            return Some(at as u32);
        }
        if rest.starts_with(b"//") {
            at += strings::index_of_char_usize(rest, b'\n')? + 1;
            continue;
        }
        if rest.starts_with(b"/*") {
            at += strings::index_of(rest, b"*/")? + 2;
            continue;
        }
        at += 1;
    }
    None
}

/// `ScriptsSourceCode.raw`: the top-level scripts' code in place, and every other character of `text` as one space per
/// UTF-16 unit, except line breaks.
fn raw_scripts(text: &[u8], parsed: &Parsed<'_>, tree: &Tree<'_>) -> Virtual {
    let mut raw = Virtual {
        original_len: text.len() as u32,
        ..Virtual::default()
    };
    let mut scripts: Vec<(u32, u32)> = Vec::new();
    for script in super::top_level_scripts(tree) {
        if let Kind::Script { content, .. } = &tree[script].kind
            && parsed
                .scripts
                .contains(&(content.start as usize, content.end as usize))
        {
            scripts.push((content.start, content.end));
        }
    }
    let mut at = 0;
    let blank = |raw: &mut Virtual, start: u32, end: u32| {
        let bytes = text.get(start as usize..end as usize).unwrap_or_default();
        let mut spaces = Vec::with_capacity(bytes.len());
        let mut index = 0;
        while let Some(&byte) = bytes.get(index) {
            let length = utf8_length(byte);
            match byte {
                b'\n' | b'\r' => spaces.push(byte),
                _ => spaces.extend(std::iter::repeat_n(b' ', usize::from(length == 4) + 1)),
            }
            index += length;
        }
        raw.push(Piece::Glue, &spaces, start);
    };
    for (start, end) in scripts {
        blank(&mut raw, at, start);
        raw.push(
            Piece::Original,
            text.get(start as usize..end as usize).unwrap_or_default(),
            start,
        );
        at = end;
    }
    blank(&mut raw, at, text.len() as u32);
    raw
}

impl Virtual {
    /// Appends `other`.
    fn append(&mut self, other: Virtual) {
        let base = self.text.len() as u32;
        self.text.extend_from_slice(&other.text);
        self.segments
            .extend(other.segments.into_iter().map(|mut it| {
                it.at += base;
                it
            }));
    }

    /// Appends the text from `start` to `end` to `out`, with each piece's source.
    fn copy_into(&self, start: u32, end: u32, out: &mut Virtual) {
        let first = self.segments.partition_point(|it| it.end() <= start);
        for segment in self.segments.get(first..).unwrap_or_default() {
            if segment.at >= end {
                break;
            }
            let (from, to) = (segment.at.max(start), segment.end().min(end));
            let bytes = self
                .text
                .get(from as usize..to as usize)
                .unwrap_or_default();
            out.push(segment.piece, bytes, segment.place_of(from));
        }
    }
}

/// What svelte-eslint-parser finds in a first parse of the [`Code`], and declares or rewrites for it
/// (`analyzeTypeScriptInSvelte`). Positions are in the code.
pub(crate) struct Analysis {
    /// The length of the whitespace the scripts' code starts with, after which the declarations are written.
    leading: u32,
    /// Undeclared `$x` names, in order of first reference: `analyzeStoreReferenceNames`.
    stores: Vec<Vec<u8>>,
    /// The ones among `$$slots`, `$$props`, `$$restProps` and the runes that the code references and nothing declares.
    globals: Vec<&'static str>,
    /// The top-level `$:` statements, and the `$derived` calls.
    transforms: Vec<Transform>,
    /// True if a top-level statement is an `ExportNamedDeclaration` or an `ExportDefaultDeclaration`.
    has_export: bool,
}

/// A rewrite by `analyzeReactiveScopes` or `analyzeDollarDerivedScopes`.
#[derive(Clone)]
enum Transform {
    /// `$: left = right`, where `left` names an undeclared variable: `transformForDeclareReactiveVar`.
    Declares {
        statement: Span,
        expression: Span,
        left: Span,
        right: Span,
        /// The `(` before the expression, the `=`, and the `)` after it.
        opening: Vec<u32>,
        equals: Option<u32>,
        closing: Vec<u32>,
    },
    /// Any other `$:` statement, whose body becomes a function: `transformForReactiveStatement`.
    Wraps { statement: Span, body: Span },
    /// `$derived(argument)`: `transformForDollarDerived`.
    Derived { call: Span, argument: Span },
}

impl Transform {
    fn node(&self) -> Span {
        match self {
            Transform::Declares { statement, .. } | Transform::Wraps { statement, .. } => {
                *statement
            }
            Transform::Derived { call, .. } => *call,
        }
    }
}

/// svelte-eslint-parser's declarations for each of [`SVELTE_GLOBALS`] except `$$slots`, in its order.
const SVELTE_GLOBAL_DECLARATIONS: [&str; 3] = [
    "",
    "declare let $$props: { [index: string]: any };",
    "declare let $$restProps: { [index: string]: any };",
];

/// svelte-eslint-parser's declarations for each of [`RUNES`], in its order.
const RUNE_DECLARATIONS: [&str; 7] = [
    "declare function $state<T>(initial: T): T;declare function $state<T>(): T | undefined;declare namespace $state { export function eager<T>(value: T): T }declare namespace $state { export function raw<T>(initial: T): T; }declare namespace $state { export function raw<T>(): T | undefined; }declare namespace $state { export function snapshot<T>(state: T): T; }",
    "declare function $derived<T>(expression: T): T;declare namespace $derived { export function by<T>(fn: () => T): T; }",
    "declare function $effect(fn: () => void | (() => void)): void;declare namespace $effect { export function pre(fn: () => void | (() => void)): void; }declare namespace $effect { export function pending(): number; }declare namespace $effect { export function tracking(): boolean; }declare namespace $effect { export function root(fn: () => void | (() => void)): () => void; }",
    "declare function $props<T>(): T;declare namespace $props { export function id(): string; }",
    "declare function $bindable<T>(fallback?: T): T;",
    "declare function $inspect<T extends any[]>(...values: T): { with: (fn: (type: 'init' | 'update', ...values: T) => void) => void };declare namespace $inspect { export function trace(name?: string): void; }",
    "declare function $host<El extends HTMLElement = HTMLElement>(): El;",
];

impl Analysis {
    /// The analysis of `file`, the first parse of `code`.
    fn of<'f>(file: &'f File<'f>, code: &Code, dialect: &Dialect) -> Analysis {
        let text = &code.text.text;
        let script = text.get(..code.script as usize).unwrap_or_default();
        let leading = (script.len() - strings::trim_js_whitespace_start(script).len()) as u32;
        let mut analysis = Analysis {
            leading,
            stores: Vec::new(),
            globals: Vec::new(),
            transforms: Vec::new(),
            has_export: false,
        };
        let all = SVELTE_GLOBALS.into_iter().chain(RUNES);
        let globals: Vec<&'static str> = match dialect.runes {
            true => all.collect(),
            false => all.take(SVELTE_GLOBALS.len()).collect(),
        };
        let top = file.top_level_scope();
        let mut through = Vec::new();
        for reference in file.unresolved_references() {
            let name = reference.name().bytes();
            through.push(reference.span());
            if !name.starts_with(b"$") {
                continue;
            }
            if let Some(global) = globals.iter().find(|it| it.as_bytes() == name) {
                if !analysis.globals.contains(global) {
                    analysis.globals.push(*global);
                }
                continue;
            }
            if top.get_bytes(name).is_none() && !analysis.stores.iter().any(|it| *it == name) {
                analysis.stores.push(name.to_vec());
            }
        }
        for statement in file.body().with_hidden() {
            analysis.has_export |= match statement.kind() {
                StmtKind::ExportNamed(_) | StmtKind::ExportDefault(_) => true,
                _ => statement.is_exported(),
            };
            let StmtKind::Labeled { label, body } = statement.kind() else {
                continue;
            };
            if !label.is("$") {
                continue;
            }
            let assigned = match body.kind() {
                StmtKind::Expr(e) => e.as_assign().map(|it| (e, it)),
                _ => None,
            };
            let declares = assigned.and_then(|(e, (op, left, right))| {
                let is_pattern = matches!(
                    left.kind(),
                    ExprKind::Ident(_) | ExprKind::Array(_) | ExprKind::Object(_)
                );
                let at = left.span();
                let names_new = through
                    .iter()
                    .any(|it| at.start <= it.start && it.end <= at.end);
                let statement = statement.span();
                (op.is_none() && is_pattern && names_new).then(|| {
                    let (expression, right) = (e.span(), right.span());
                    Transform::Declares {
                        statement,
                        expression,
                        left: at,
                        right,
                        opening: positions_of(text, b'(', body.span().start, expression.start),
                        equals: positions_of(text, b'=', at.end, right.start)
                            .first()
                            .copied(),
                        closing: positions_of(text, b')', expression.end, statement.end),
                    }
                })
            });
            analysis
                .transforms
                .push(declares.unwrap_or_else(|| Transform::Wraps {
                    statement: statement.span(),
                    body: body.span(),
                }));
        }
        if dialect.runes {
            for reference in file.unresolved_references_to(b"$derived") {
                let Some(e) = reference.expr() else {
                    continue;
                };
                let Node::Expr(parent) = Node::Expr(e).parent() else {
                    continue;
                };
                let Some(call) = parent.as_call().filter(|it| it.callee() == e) else {
                    continue;
                };
                let first = call.args().first();
                if let Some(argument) = first.filter(|it| !matches!(it.kind(), ExprKind::Spread(_)))
                {
                    analysis.transforms.push(Transform::Derived {
                        call: parent.span(),
                        argument: argument.span(),
                    });
                }
            }
        }
        analysis
    }
}

/// The positions of each `byte` from `start` to `end` in `text`, outside comments: the parentheses and the `=` around
/// an assignment, which is all there is besides whitespace and comments.
fn positions_of(text: &[u8], byte: u8, start: u32, end: u32) -> Vec<u32> {
    let mut found = Vec::new();
    let mut at = start as usize;
    while at < (end as usize).min(text.len()) {
        let rest = &text[at..];
        if rest.starts_with(b"//") {
            at += strings::index_of_char_usize(rest, b'\n').map_or(rest.len(), |it| it + 1);
            continue;
        }
        if rest.starts_with(b"/*") {
            at += strings::index_of(rest, b"*/").map_or(rest.len(), |it| it + 2);
            continue;
        }
        if rest[0] == byte {
            found.push(at as u32);
        }
        at += 1;
    }
    found
}

/// `VirtualTypeScriptContext`: the program built from the [`Code`], piece by piece.
struct Ts<'c> {
    code: &'c Virtual,
    out: Virtual,
    consumed: u32,
    unique: Unique,
}

impl Ts<'_> {
    /// `appendOriginal`
    fn original(&mut self, index: u32) {
        if self.consumed >= index {
            return;
        }
        self.code.copy_into(self.consumed, index, &mut self.out);
        self.consumed = index;
    }

    /// `appendVirtualScript`
    fn glue(&mut self, code: &[u8]) {
        let at = self.code.start_of(self.consumed);
        self.out.push(Piece::Glue, code, at);
    }

    /// `generateUniqueId`
    fn unique_id(&mut self, base: &[u8]) -> Vec<u8> {
        let (code, out) = (&self.code.text[..], &self.out.text[..]);
        let is_in_texts = |it: &[u8]| strings::contains(code, it) || strings::contains(out, it);
        self.unique.generate(base, &is_in_texts)
    }

    /// `applyTransforms`: in code order, skipping any that starts before the previous one ends.
    fn apply(&mut self, mut transforms: Vec<Transform>) {
        bun_lint::utils::sort::sort_by_key(&mut transforms, |it| it.node().start);
        let mut offset = 0;
        for transform in transforms {
            let node = transform.node();
            if offset <= node.start {
                self.transform(transform);
            }
            offset = node.end;
        }
    }

    fn transform(&mut self, transform: Transform) {
        match transform {
            Transform::Declares {
                statement,
                expression,
                left,
                right,
                opening,
                equals,
                closing,
            } => {
                let function = self.unique_id(b"reactiveVariableScopeFunction");
                let temporary = self.unique_id(b"tmpVar");
                for at in opening {
                    self.original(at);
                    self.consumed += 1;
                }
                self.original(expression.start);
                self.consumed = self.consumed.max(left.start);
                self.glue(b"let ");
                self.original(equals.map_or(right.start, |it| it + 1));
                let call = [
                    &function[..],
                    b"();\nfunction ",
                    &function,
                    b"(){let ",
                    &temporary,
                    b";return (",
                    &temporary,
                    b" = ",
                ];
                self.glue(&call.concat());
                self.original(right.end);
                self.glue(b")");
                for at in closing {
                    self.original(at);
                    self.consumed += 1;
                }
                self.original(statement.end);
                self.glue(b"}");
            }
            Transform::Wraps { statement, body } => {
                let function = self.unique_id(b"reactiveStatementScopeFunction");
                self.original(body.start);
                self.glue(&[b"export function ", &function[..], b"(){"].concat());
                self.original(body.end);
                self.glue(b"}");
                self.original(statement.end);
            }
            Transform::Derived { argument, .. } => {
                let function = self.unique_id(b"$derivedArgument");
                let this = self.unique_id(b"$This");
                self.original(argument.start);
                let head = [
                    b"(()=>{type ",
                    &this[..],
                    b" = typeof this; return ",
                    &function,
                    b"();function ",
                    &function,
                    b"(this: ",
                    &this,
                    b"){return ",
                ];
                self.glue(&head.concat());
                self.original(argument.end);
                self.glue(b"}})()");
            }
        }
    }
}

/// The program for `code` with the changes `analysis` asks for (`analyzeTypeScriptInSvelte`), without the component's
/// `export default`. `is_javascript` is true if the scripts' `lang` is JavaScript.
fn analyzed(code: &Code, analysis: &Analysis, dialect: &Dialect, is_javascript: bool) -> Virtual {
    let mut ts = Ts {
        code: &code.text,
        out: Virtual {
            original_len: code.text.original_len,
            ..Virtual::default()
        },
        consumed: 0,
        unique: Unique::default(),
    };
    ts.original(analysis.leading);
    if !analysis.stores.is_empty() {
        let value = ts.unique_id(b"StoreValueType");
        let declared = [
            b"type ",
            &value[..],
            b"<T> = T extends null | undefined\n? T\n: T extends object & { subscribe(run: infer F, ...args: any): any }\n? F extends (value: infer V, ...args: any) => any\n? V\n: never\n: T;",
        ];
        ts.glue(&declared.concat());
        for name in &analysis.stores {
            let real = name.get(1..).unwrap_or_default();
            let declared = [
                b"declare let ",
                &name[..],
                b": ",
                &value,
                b"<typeof ",
                real,
                b">;",
            ];
            ts.glue(&declared.concat());
        }
    }
    for (name, declaration) in SVELTE_GLOBALS.into_iter().zip(SVELTE_GLOBAL_DECLARATIONS) {
        if !analysis.globals.contains(&name) {
            continue;
        }
        match name {
            "$$slots" => {
                let declared = format!(
                    "declare let $$slots: Record<{}, boolean>;",
                    slot_names(&code.slots)
                );
                ts.glue(declared.as_bytes());
            }
            _ => ts.glue(declaration.as_bytes()),
        }
    }
    if dialect.runes {
        for (name, declarations) in RUNES.into_iter().zip(RUNE_DECLARATIONS) {
            if analysis.globals.contains(&name) {
                ts.glue(declarations.as_bytes());
            }
        }
    }
    if is_javascript {
        // Leading JSDoc stays with the declaration it's written on.
        ts.glue(b"\n");
    }
    let (script, render) = (code.script, code.script + code.render);
    let (mut in_script, mut in_render, mut in_root) = (Vec::new(), Vec::new(), Vec::new());
    for transform in &analysis.transforms {
        let start = transform.node().start;
        match transform {
            Transform::Declares { .. } | Transform::Wraps { .. } => {
                in_script.push(transform.clone())
            }
            Transform::Derived { .. } if start < script => in_script.push(transform.clone()),
            Transform::Derived { .. } if start < render => in_render.push(transform.clone()),
            Transform::Derived { .. } => in_root.push(transform.clone()),
        }
    }
    ts.apply(in_script);
    ts.original(script);
    let function = ts.unique_id(b"render");
    ts.glue(&[b"export function ", &function[..], b"(){"].concat());
    ts.apply(in_render);
    ts.original(render);
    ts.glue(b"}");
    if !analysis.has_export {
        ts.glue(b"export namespace SvelteEslintParserModuleMarker {}");
    }
    ts.apply(in_root);
    ts.original(code.text.text.len() as u32);
    ts.out
}

/// The type of the `$$slots` names: one per `<slot name>`, in markup order.
fn slot_names(names: &[Option<Vec<u8>>]) -> bstr::BString {
    let mut all: Vec<Vec<u8>> = Vec::new();
    for name in names {
        let name = name.clone().unwrap_or_else(|| b"\"default\"".to_vec());
        if !all.contains(&name) {
            all.push(name);
        }
    }
    match all.is_empty() {
        true => "any".into(),
        false => all.join(&b" | "[..]).into(),
    }
}

/// True if the pattern `text` declares `name` (`hasIdentifierFor`), as far as its words tell.
fn has_name(text: &[u8], name: &[u8]) -> bool {
    let is_part =
        |byte: u8| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'$') || byte >= 0x80;
    let mut from = 0;
    while let Some(at) = strings::index_of(text.get(from..).unwrap_or_default(), name) {
        let start = from + at;
        let end = start + name.len();
        let before = start
            .checked_sub(1)
            .and_then(|it| text.get(it))
            .is_some_and(|it| is_part(*it));
        let after = text.get(end).is_some_and(|it| is_part(*it));
        if !before && !after {
            return true;
        }
        from = start + 1;
    }
    false
}

/// Returns `lint` typed as a function that lints any file of a program.
fn for_files<F: for<'f> Fn(&'f File<'f>) -> ComponentResult>(lint: F) -> F {
    lint
}
