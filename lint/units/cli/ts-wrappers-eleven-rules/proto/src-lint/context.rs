//! What a rule handler is given: the text, the names, the reports, and what the side table of the parse knows of a node.

use core::cell::RefCell;
use std::borrow::Cow;
use std::collections::BTreeMap;

use bun_ast::lexer_tables::T;
use bun_ast::{E, Expr, ExprData, G, Loc, Log, OpCode, Ref, S, Source, StmtData};
use bun_core::StackCheck;
use bun_js_parser::parse::attached::ModuleExportName;
use bun_js_parser::parse::erased::{ErasedFlags, ErasedMemberData};
use bun_js_parser::parse::generics::TypeArgumentsOf;
use bun_js_parser::parse::parse_entry::ParsedForLint;
use bun_js_parser::parse::wrappers::{ExprId, WrapperData};

use crate::FileId;
use crate::diagnostic::{Category, Code, Diagnostic};
use crate::rule::Rule;
use crate::tokens::{self, Token, Tokens};

/// The global names that a report can depend on.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct Globals(u8);

impl Globals {
    pub(crate) const NONE: Globals = Globals(0);
    pub(crate) const NAN: Globals = Globals(1);
    pub(crate) const NUMBER: Globals = Globals(2);
    pub(crate) const UNDEFINED: Globals = Globals(4);

    pub(crate) const fn or(self, other: Globals) -> Globals {
        Globals(self.0 | other.0)
    }

    pub(crate) const fn is_none(self) -> bool {
        self.0 == 0
    }

    fn named(name: &[u8]) -> Globals {
        match name {
            b"NaN" => Globals::NAN,
            b"Number" => Globals::NUMBER,
            b"undefined" => Globals::UNDEFINED,
            _ => Globals::NONE,
        }
    }
}

/// The TypeScript node that ESLint has where the tree holds its operand.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum TsWrapper {
    /// `operand as T`.
    As,
    /// `operand satisfies T`.
    Satisfies,
    /// `operand!`.
    NonNull,
    /// `<T>operand`.
    TypeAssertion,
    /// `operand<T>` that no call, `new` or template takes as its type arguments.
    Instantiation,
}

/// One piece of syntax around a node that leaves no node: `kind` is `None` for parentheses.
#[derive(Clone, Copy)]
struct Around {
    kind: Option<TsWrapper>,
    /// Offset of its first own token: `(`, `<`, `as`, `satisfies` or `!`.
    op: u32,
    /// Offset after its last own token. Of `<T>operand` that is the `>`.
    end: u32,
}

impl Around {
    /// `(` and `<T>` stand before all they hold.
    fn opens(&self) -> bool {
        matches!(self.kind, None | Some(TsWrapper::TypeAssertion))
    }
}

/// `ExprId` as a key that has an order.
type ExprKey = (i32, u8, usize);

fn key_of(expr: &Expr) -> ExprKey {
    let id = ExprId::of(expr);
    (id.loc, id.tag as u8, id.payload)
}

/// The places in a list of records of the entries of `index` with `key`, in the order of the list.
fn entries(index: &[(ExprKey, u32)], key: ExprKey) -> impl Iterator<Item = usize> + '_ {
    let from = index.partition_point(|(other, _)| *other < key);
    index
        .get(from..)
        .unwrap_or(&[])
        .iter()
        .take_while(move |(other, _)| *other == key)
        .map(|(_, at)| *at as usize)
}

fn loc_at(offset: u32) -> Loc {
    Loc {
        start: i32::try_from(offset).unwrap_or(i32::MAX),
    }
}

fn offset_of(loc: Loc) -> Option<u32> {
    u32::try_from(loc.start).ok()
}

/// What the text of `expr` starts with when that is another expression.
fn first_operand(expr: &Expr) -> Option<&Expr> {
    match &expr.data {
        ExprData::EBinary(binary) => Some(&binary.left),
        ExprData::EDot(dot) => Some(&dot.target),
        ExprData::EIndex(index) => Some(&index.target),
        ExprData::ECall(call) => Some(&call.target),
        ExprData::EIf(conditional) => Some(&conditional.test),
        ExprData::ETemplate(template) => template.tag.as_ref(),
        ExprData::EUnary(unary) if matches!(unary.op, OpCode::UnPostDec | OpCode::UnPostInc) => {
            Some(&unary.value)
        }
        _ => None,
    }
}

/// Where the first own token of `expr` is, the one after its first operand: it grows from a node to the node around it.
fn own_token(expr: &Expr) -> Option<u32> {
    match &expr.data {
        ExprData::EBinary(binary) => offset_of(binary.right.loc),
        ExprData::EDot(dot) => offset_of(dot.name_loc),
        ExprData::EIndex(index) => offset_of(index.index.loc),
        ExprData::ECall(call) => offset_of(call.close_paren_loc),
        ExprData::EIf(conditional) => offset_of(conditional.yes.loc),
        _ => None,
    }
}

pub(crate) struct Context<'p, 'a> {
    /// The file of every diagnostic that is reported here.
    file: FileId,
    parsed: &'p ParsedForLint<'p, 'a>,
    source: &'a Source,
    /// The file is TypeScript: a rule that typescript-eslint has its own text of answers as that text does.
    typescript: bool,
    pub(crate) stack_check: StackCheck,
    reports: Vec<Diagnostic>,
    /// Reports that hold only when one of their names is not declared in the file.
    held: Vec<(Diagnostic, Globals)>,
    declared: Globals,
    cut: bool,
    /// The wrapper records by their operand: those of one operand keep their order, an inner one first.
    wrappers: Vec<(ExprKey, u32)>,
    /// The type arguments after an expression by their operand, in the order of their `<`.
    type_arguments: Vec<(ExprKey, u32)>,
    /// The class members that leave no node and are fields with `declare`, by the body of their class.
    declared_fields: Vec<(u32, u32)>,
    /// By the first token of a chain of first operands: a start, and the nodes of the chain that have it, those whose own token is after the first offset and not after the second.
    chain_starts: RefCell<BTreeMap<i32, (u32, u32, Loc)>>,
}

impl<'p, 'a> Context<'p, 'a> {
    pub(crate) fn new(
        file: FileId,
        parsed: &'p ParsedForLint<'p, 'a>,
        source: &'a Source,
        typescript: bool,
    ) -> Self {
        let sidecar = parsed.sidecar;
        let mut wrappers: Vec<(ExprKey, u32)> = sidecar
            .wrappers
            .records
            .iter()
            .enumerate()
            .map(|(at, record)| (key_of(&record.operand), at as u32))
            .collect();
        wrappers.sort_unstable();
        let mut type_arguments: Vec<(ExprKey, u32)> = sidecar
            .generics
            .type_arguments
            .iter()
            .enumerate()
            .filter(|(_, record)| record.of == TypeArgumentsOf::Expression)
            .map(|(at, record)| (key_of(&record.operand), at as u32))
            .collect();
        type_arguments.sort_unstable();
        let mut declared_fields: Vec<(u32, u32)> = sidecar
            .erased
            .members
            .iter()
            .enumerate()
            .filter(|(_, member)| {
                matches!(member.data, ErasedMemberData::Property(_))
                    && member.flags.contains(ErasedFlags::DECLARE)
                    && !member
                        .flags
                        .intersects(ErasedFlags::ABSTRACT.union(ErasedFlags::NO_BODY))
            })
            .map(|(at, member)| (member.class_body, at as u32))
            .collect();
        declared_fields.sort_unstable();
        Context {
            file,
            parsed,
            source,
            typescript,
            stack_check: StackCheck::init(),
            reports: Vec::new(),
            held: Vec::new(),
            declared: Globals::NONE,
            cut: false,
            wrappers,
            type_arguments,
            declared_fields,
            chain_starts: RefCell::new(BTreeMap::new()),
        }
    }

    #[inline]
    pub(crate) fn text(&self) -> &'a [u8] {
        &self.source.contents
    }

    /// Whether the file is TypeScript.
    #[inline]
    pub(crate) fn is_typescript(&self) -> bool {
        self.typescript
    }

    /// The spelling of an identifier or of a binding. Empty for a reference that names nothing.
    pub(crate) fn name_of(&self, r#ref: Ref) -> &'a [u8] {
        if r#ref.is_valid() {
            self.parsed.name_of(r#ref)
        } else {
            b""
        }
    }

    /// A declaration of `ref` is somewhere in the file.
    pub(crate) fn declare(&mut self, r#ref: Ref) {
        self.declare_name(self.name_of(r#ref));
    }

    /// A declaration of `name` is somewhere in the file.
    pub(crate) fn declare_name(&mut self, name: &[u8]) {
        self.declared = self.declared.or(Globals::named(name));
    }

    /// The names with `type` in the clause of the import statement that starts at `statement` leave no item: ESLint has them declared.
    pub(crate) fn declare_type_only_names(&mut self, statement: u32) {
        let Ok(start) = i32::try_from(statement) else {
            return;
        };
        for record in self.parsed.sidecar.attached.specifiers_of(Loc { start }) {
            if let ModuleExportName::Identifier(name) = &record.specifier.name {
                self.declared = self.declared.or(Globals::named(name.text.slice()));
            }
        }
    }

    /// A diagnostic of `rule` at the token that starts at `at`. Its length is that token.
    pub(crate) fn report(
        &mut self,
        rule: &'static Rule,
        at: Loc,
        text: impl Into<Cow<'static, [u8]>>,
    ) {
        self.report_if_global(rule, at, text, Globals::NONE);
    }

    /// Held until the walk ends; dropped when the file declares every name of `names`.
    pub(crate) fn report_if_global(
        &mut self,
        rule: &'static Rule,
        at: Loc,
        text: impl Into<Cow<'static, [u8]>>,
        names: Globals,
    ) {
        let (Some(category), Ok(start)) = (rule.default_level(), u32::try_from(at.start)) else {
            return;
        };
        let diagnostic = Diagnostic {
            file: Some(self.file),
            start,
            length: self.token_len(start),
            category,
            code: Code::Name(rule.name),
            text: text.into(),
            chain: Vec::new(),
            related: Vec::new(),
        };
        if names.is_none() {
            self.reports.push(diagnostic);
        } else {
            self.held.push((diagnostic, names));
        }
    }

    /// The walk stops going deeper at `loc`. Said once.
    pub(crate) fn too_deep(&mut self, loc: Loc) {
        if !core::mem::replace(&mut self.cut, true) {
            self.reports.push(Diagnostic {
                file: Some(self.file),
                start: u32::try_from(loc.start).unwrap_or(0),
                length: 0,
                category: Category::Error,
                code: Code::INTERNAL_ERROR,
                text: Cow::Borrowed(b"This file is nested too deeply to check all of it."),
                chain: Vec::new(),
                related: Vec::new(),
            });
        }
    }

    /// Every report of the file, in the order of the walk, then the held ones that hold.
    pub(crate) fn finish(mut self) -> Vec<Diagnostic> {
        // A walk that was cut has not seen every declaration: what depends on one is not said.
        if !self.cut {
            let declared = self.declared;
            for (diagnostic, names) in self.held {
                if names.0 & !declared.0 != 0 {
                    self.reports.push(diagnostic);
                }
            }
        }
        self.reports
    }

    /// What stands around `expr` in its place and leaves no node, an inner piece first.
    fn around(&self, expr: &Expr) -> Vec<Around> {
        if self.wrappers.is_empty() && self.type_arguments.is_empty() {
            return Vec::new();
        }
        let key = key_of(expr);
        let sidecar = self.parsed.sidecar;
        let mut around: Vec<Around> = entries(&self.wrappers, key)
            .filter_map(|at| sidecar.wrappers.records.get(at))
            .map(|record| Around {
                kind: match record.data {
                    WrapperData::As(_) => Some(TsWrapper::As),
                    WrapperData::Satisfies(_) => Some(TsWrapper::Satisfies),
                    WrapperData::NonNull => Some(TsWrapper::NonNull),
                    WrapperData::TypeAssertion(_) => Some(TsWrapper::TypeAssertion),
                    WrapperData::Parenthesized => None,
                },
                op: record.op,
                end: record.end,
            })
            .collect();
        for at in entries(&self.type_arguments, key) {
            let Some(record) = sidecar.generics.type_arguments.get(at) else {
                continue;
            };
            // Before the arguments of a call and before a template they are those of the call: no node of their own.
            if matches!(
                self.next_token(record.end),
                Some(Token {
                    t: T::TOpenParen | T::TNoSubstitutionTemplateLiteral | T::TTemplateHead,
                    ..
                })
            ) {
                continue;
            }
            // They stand after what ends before their `<`: a `!`, other type arguments, or parentheses that close there.
            let inside = around
                .iter()
                .rposition(|piece| match piece.kind {
                    None => piece.end <= record.lt,
                    Some(TsWrapper::NonNull | TsWrapper::Instantiation) => piece.op < record.lt,
                    Some(_) => false,
                })
                .map_or(0, |at| at + 1);
            around.insert(
                inside,
                Around {
                    kind: Some(TsWrapper::Instantiation),
                    op: record.lt,
                    end: record.end,
                },
            );
        }
        around
    }

    /// After the type arguments of `expr` whose `<` is at `at` or after it, which a `new` or a template takes; `at` without them.
    fn after_type_arguments(&self, expr: &Expr, at: u32) -> u32 {
        entries(&self.type_arguments, key_of(expr))
            .filter_map(|index| self.parsed.sidecar.generics.type_arguments.get(index))
            .find(|record| record.lt >= at)
            .map_or(at, |record| record.end)
    }

    /// The TypeScript node that ESLint has in the place of `expr`: the outermost `as`, `satisfies`, `!`, `<T>` or instantiation on it. Parentheses are no node.
    pub(crate) fn ts_wrapper(&self, expr: &Expr) -> Option<TsWrapper> {
        self.around(expr).iter().rev().find_map(|piece| piece.kind)
    }

    /// How many pairs of parentheses stand directly around what ESLint has in the place of `expr`.
    pub(crate) fn paren_count(&self, expr: &Expr) -> u32 {
        let count = self
            .around(expr)
            .iter()
            .rev()
            .take_while(|piece| piece.kind.is_none())
            .count();
        u32::try_from(count).unwrap_or(u32::MAX)
    }

    /// Whether parentheses or a TypeScript node stand around `expr` in its place: a literal there is no pattern.
    pub(crate) fn is_wrapped(&self, expr: &Expr) -> bool {
        !self.around(expr).is_empty()
    }

    /// Where the node that ESLint has in the place of `expr` starts: at the `(` or `<` of its first operand. Parentheses around the node itself are no part of it.
    pub(crate) fn node_start(&self, expr: &Expr) -> Loc {
        let around = self.around(expr);
        let outermost = around.iter().rposition(|piece| piece.kind.is_some());
        let open = outermost
            .and_then(|outermost| around.get(..=outermost))
            .and_then(|inside| inside.iter().rev().find(|piece| piece.opens()));
        match open {
            Some(piece) => loc_at(piece.op),
            None => self.own_start(expr),
        }
    }

    /// Where the binary expression `node` starts, whose first own token is at `own`: `node_start` for a node that a handler has without its `Expr`.
    pub(crate) fn binary_start(&self, node: &E::Binary, own: Loc) -> Loc {
        self.chain_start(&node.left, own, offset_of(node.right.loc))
    }

    /// Where the text in the place of `expr` starts, every `(` and `<T>` around it included.
    fn full_start(&self, expr: &Expr) -> Loc {
        match self.around(expr).iter().rev().find(|piece| piece.opens()) {
            Some(piece) => loc_at(piece.op),
            None => self.own_start(expr),
        }
    }

    /// Where `expr` itself starts: where its first operand does, else at its first own token.
    fn own_start(&self, expr: &Expr) -> Loc {
        match first_operand(expr) {
            Some(first) => self.chain_start(first, expr.loc, own_token(expr)),
            None => self.leaf_start(expr),
        }
    }

    /// `full_start` of `first`, the first operand of a node whose first token is at `own` and whose own token is at `token`. What is found is kept for the nodes of the chain inside that node: a long chain is gone down once.
    fn chain_start(&self, first: &Expr, own: Loc, token: Option<u32>) -> Loc {
        if let (Some(token), Some((below, upto, start))) =
            (token, self.chain_starts.borrow().get(&own.start).copied())
            && below < token
            && token <= upto
        {
            return start;
        }
        let mut expr = first;
        let (below, start) = loop {
            if let Some(piece) = self.around(expr).iter().rev().find(|piece| piece.opens()) {
                // A node without a token of its own is not told from the nodes inside it: nothing is kept then.
                let below = match first_operand(expr) {
                    Some(_) => own_token(expr),
                    None => Some(0),
                };
                break (below, loc_at(piece.op));
            }
            match first_operand(expr) {
                Some(next) => expr = next,
                None => break (Some(0), self.leaf_start(expr)),
            }
        };
        if let (Some(below), Some(upto)) = (below, token) {
            self.chain_starts
                .borrow_mut()
                .insert(own.start, (below, upto, start));
        }
        start
    }

    /// Where a node without a first operand starts: at its first token, which for a class is the `@` of its first decorator.
    fn leaf_start(&self, expr: &Expr) -> Loc {
        let ExprData::EClass(class) = &expr.data else {
            return expr.loc;
        };
        let Some(decorator) = class.ts_decorators.first() else {
            return expr.loc;
        };
        if !self.stack_check.is_safe_to_recurse() {
            return expr.loc;
        }
        let Some(named) = offset_of(self.full_start(decorator)) else {
            return expr.loc;
        };
        let mut at = named as usize;
        while at > 0 && matches!(self.text().get(at - 1), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            at -= 1;
        }
        if at > 0 && self.text().get(at - 1) == Some(&b'@') {
            return loc_at(u32::try_from(at - 1).unwrap_or(named));
        }
        expr.loc
    }

    /// After the last token of the node that ESLint has in the place of `expr`. `None`: the tree and the text do not say where.
    pub(crate) fn node_end(&self, expr: &Expr) -> Option<u32> {
        let own = self.own_end(expr)?;
        let around = self.around(expr);
        let Some(outermost) = around.iter().rposition(|piece| piece.kind.is_some()) else {
            return Some(own);
        };
        Some(
            around
                .get(..=outermost)?
                .iter()
                .filter(|piece| piece.kind != Some(TsWrapper::TypeAssertion))
                .fold(own, |end, piece| end.max(piece.end)),
        )
    }

    /// After the last token of the text in the place of `expr`, everything around it included.
    fn full_end(&self, expr: &Expr) -> Option<u32> {
        let own = self.own_end(expr)?;
        Some(
            self.around(expr)
                .iter()
                .filter(|piece| piece.kind != Some(TsWrapper::TypeAssertion))
                .fold(own, |end, piece| end.max(piece.end)),
        )
    }

    /// After the last token of `expr` itself: after its last operand, or after the token that closes it.
    fn own_end(&self, expr: &Expr) -> Option<u32> {
        if !self.stack_check.is_safe_to_recurse() {
            return None;
        }
        let after = |loc: Loc| offset_of(loc)?.checked_add(1);
        match &expr.data {
            ExprData::EBinary(binary) => self.full_end(&binary.right),
            ExprData::EIf(conditional) => self.full_end(&conditional.no),
            ExprData::EUnary(unary) => {
                let value = self.full_end(&unary.value)?;
                if matches!(unary.op, OpCode::UnPostDec | OpCode::UnPostInc) {
                    Some(self.next_token(value)?.end)
                } else {
                    Some(value)
                }
            }
            ExprData::ESpread(spread) => self.full_end(&spread.value),
            ExprData::EAwait(awaited) => self.full_end(&awaited.value),
            ExprData::EYield(yielded) => match &yielded.value {
                Some(value) => self.full_end(value),
                None => self.token_end(expr.loc),
            },
            ExprData::EDot(dot) => self.token_end(dot.name_loc),
            ExprData::EIndex(index) => {
                if matches!(index.index.data, ExprData::EPrivateIdentifier(_)) {
                    return self.token_end(index.index.loc);
                }
                let close = self.next_token(self.full_end(&index.index)?)?;
                (close.t == T::TCloseBracket).then_some(close.end)
            }
            ExprData::ECall(call) => after(call.close_paren_loc),
            ExprData::ENew(new) => {
                if new.close_parens_loc.start >= 0 {
                    after(new.close_parens_loc)
                } else {
                    Some(self.after_type_arguments(&new.target, self.full_end(&new.target)?))
                }
            }
            ExprData::EArray(array) => after(array.close_bracket_loc),
            ExprData::EObject(object) => after(object.close_brace_loc),
            ExprData::EClass(class) => after(class.close_brace_loc),
            ExprData::EFunction(function) => self.body_end(&function.func.body),
            ExprData::EArrow(arrow) => {
                if !arrow.prefer_expr {
                    return self.body_end(&arrow.body);
                }
                match arrow.body.stmts.slice() {
                    [stmt] => match &stmt.data {
                        StmtData::SReturn(returned) => self.full_end(returned.value.as_ref()?),
                        _ => None,
                    },
                    _ => None,
                }
            }
            ExprData::ETemplate(template) => match template.parts().last() {
                Some(part) => {
                    let tail = usize::try_from(part.tail_loc.start).ok()?.checked_add(1)?;
                    match tokens::template_text_end(self.text(), tail)? {
                        (end, false) => Some(end),
                        (_, true) => None,
                    }
                }
                None => {
                    let tag = template.tag.as_ref()?;
                    let text =
                        self.next_token(self.after_type_arguments(tag, self.full_end(tag)?))?;
                    (text.t == T::TNoSubstitutionTemplateLiteral).then_some(text.end)
                }
            },
            ExprData::EJsxElement(element) => tokens::jsx_end(
                self.text(),
                usize::try_from(element.close_tag_loc.start).ok()?,
            ),
            ExprData::ERegExp(reg_exp) => {
                offset_of(expr.loc)?.checked_add(u32::try_from(reg_exp.value.slice().len()).ok()?)
            }
            ExprData::EImport(import) => {
                let last = if matches!(import.options.data, ExprData::EMissing(_)) {
                    &import.expr
                } else {
                    &import.options
                };
                let mut close = self.next_token(self.full_end(last)?)?;
                if close.t == T::TComma {
                    close = self.next_token(close.end)?;
                }
                (close.t == T::TCloseParen).then_some(close.end)
            }
            ExprData::ENewTarget(target) => {
                let len = u32::try_from(target.range.len).ok()?;
                offset_of(target.range.loc)?.checked_add(len)
            }
            ExprData::EImportMeta(_) => {
                let dot = self.next_token(self.token_end(expr.loc)?)?;
                Some(self.next_token(dot.end)?.end)
            }
            ExprData::EIdentifier(_)
            | ExprData::EPrivateIdentifier(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_)
            | ExprData::EBoolean(_)
            | ExprData::ENull(_)
            | ExprData::EUndefined(_)
            | ExprData::EThis(_)
            | ExprData::ESuper(_) => self.token_end(expr.loc),
            _ => None,
        }
    }

    /// After the `}` of the body of a function or of an arrow function.
    fn body_end(&self, body: &G::FnBody) -> Option<u32> {
        let from = offset_of(body.loc)?;
        let spans = tokens::spans_under_stmts(self.text(), body.stmts.slice(), self.stack_check)?;
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.parsed.arena, &spans, from);
        tokens::matching_close(&mut tokens)
    }

    /// What ESLint compares of the node in the place of `expr`: its tokens, as bytes. `None`: its end is not known, or its text does not read as the tree says.
    pub(crate) fn tokens_of(&self, expr: &Expr) -> Option<Vec<u8>> {
        let start = offset_of(self.node_start(expr))?;
        let end = self.node_end(expr)?;
        let spans = tokens::spans_under(self.text(), &[expr], self.stack_check)?;
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.parsed.arena, &spans, start);
        // ESLint's own parser has a word as what it spells; typescript-eslint has its text.
        tokens::key_until(&mut tokens, self.text(), end, !self.typescript)
    }

    /// Where the clause at `index` of `node` starts: at its `case`. Where no `case` is found, at the first token of its test.
    pub(crate) fn case_start(&self, node: &S::Switch, index: usize) -> Loc {
        let cases = node.cases.slice();
        let Some(case) = cases.get(index) else {
            return Loc::EMPTY;
        };
        if case.loc.start >= 0 {
            return case.loc;
        }
        let Some(test) = &case.value else {
            return Loc::EMPTY;
        };
        let Some(target) = offset_of(self.full_start(test)) else {
            return test.loc;
        };
        // The token before the test is read from a place before it: the last statement of a clause before, else its test, else the `{` of the statement.
        let mut from = offset_of(node.body_loc);
        let mut spans = Some(Vec::new());
        for earlier in cases.get(..index).unwrap_or(&[]).iter().rev() {
            if let Some(last) = earlier.body.slice().last() {
                from = offset_of(last.loc);
                spans = tokens::spans_under_stmts(
                    self.text(),
                    core::slice::from_ref(last),
                    self.stack_check,
                );
                break;
            }
            if let Some(value) = &earlier.value {
                from = offset_of(self.full_start(value));
                spans = tokens::spans_under(self.text(), &[value], self.stack_check);
                break;
            }
        }
        if let (Some(from), Some(spans)) = (from, spans) {
            let mut log = Log::init();
            let mut tokens = Tokens::new(&mut log, self.source, self.parsed.arena, &spans, from);
            if let Some(before) = tokens::last_before(&mut tokens, target)
                && before.t == T::TCase
            {
                return loc_at(before.start);
            }
        }
        match tokens::case_before(self.text(), target) {
            Some(start) => loc_at(start),
            None => test.loc,
        }
    }

    /// The fields with `declare` of `class` that leave no node, each with how many members of `class.properties` stand before it.
    pub(crate) fn declared_fields(
        &self,
        class: &G::Class,
    ) -> impl Iterator<Item = (u32, &'p G::Property)> + '_ {
        let body = offset_of(class.body_loc).unwrap_or(u32::MAX);
        let members = &self.parsed.sidecar.erased.members;
        let from = self
            .declared_fields
            .partition_point(|(other, _)| *other < body);
        self.declared_fields
            .get(from..)
            .unwrap_or(&[])
            .iter()
            .take_while(move |(other, _)| *other == body)
            .filter_map(move |(_, at)| {
                let member = members.get(*at as usize)?;
                match &member.data {
                    ErasedMemberData::Property(property) => Some((member.index, &**property)),
                    ErasedMemberData::IndexSignature => None,
                }
            })
    }

    /// After the token that starts at `at`. `None` when the text there does not read.
    pub(crate) fn token_end(&self, at: Loc) -> Option<u32> {
        let at = u32::try_from(at.start).ok()?;
        match self.token_len(at) {
            0 => None,
            len => at.checked_add(len),
        }
    }

    /// The token after the offset `after`, with blanks and comments between them at most.
    fn next_token(&self, after: u32) -> Option<Token> {
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.parsed.arena, &[], after);
        tokens.next()
    }

    /// The length of the token that starts at `at`, read without the tree. 0 when the text there does not read.
    fn token_len(&self, at: u32) -> u32 {
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.parsed.arena, &[], at);
        match tokens.next() {
            Some(token) if token.start == at => token.end.saturating_sub(token.start),
            _ => 0,
        }
    }
}
