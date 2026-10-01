//! What a rule handler is given: the text, the names, the reports, the wrapper records of the parse, and the services that read the text again.

use std::borrow::Cow;
use std::collections::BTreeMap;

use bun_ast::lexer_tables::T;
use bun_ast::{Binding, Case, E, Expr, ExprData, G, Loc, Log, OpCode, Ref, S, Source, StmtData};
use bun_core::StackCheck;
use bun_js_parser::parse::attached::ModuleExportName;
use bun_js_parser::parse::erased::{
    ErasedData, ErasedFlags, ErasedMember, ErasedMemberData, ImportClause, ModuleName,
};
use bun_js_parser::parse::generics::{TypeArguments, TypeArgumentsOf};
use bun_js_parser::parse::parse_entry::ParsedForLint;
use bun_js_parser::parse::wrappers::{ExprId, Wrapper, WrapperData};

use crate::FileId;
use crate::diagnostic::{Category, Code, Diagnostic};
use crate::rule::Rule;
use crate::tokens::{self, Tokens};

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

/// The TypeScript node that ESLint has in a slot where the tree has the operand.
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
    /// `operand<T>` that no call, `new` or template takes.
    Instantiation,
}

/// A node of the tree as a key that orders: where it starts, its kind, the address of its payload.
type Key = (i32, u8, usize);

fn key_of(id: ExprId) -> Key {
    (id.loc, id.tag as u8, id.payload)
}

/// What the records say of the slot of one operand.
#[derive(Clone, Copy, Default)]
struct Slot {
    /// The outermost wrapper that is no pair of parentheses.
    ts: Option<TsWrapper>,
    /// How many pairs of parentheses stand around the node of the slot.
    parens: u32,
    /// The first `(` or `<` of all that stands around the operand.
    open: Option<u32>,
    /// The first `(` or `<` of the node of the slot: the parentheses around that node are not part of it.
    node_open: Option<u32>,
}

pub(crate) struct Context<'p, 'a> {
    /// The file of every diagnostic that is reported here.
    file: FileId,
    parsed: &'p ParsedForLint<'p, 'a>,
    source: &'a Source,
    arena: &'a bun_alloc::Arena,
    /// The file has the syntax of TypeScript.
    typescript: bool,
    pub(crate) stack_check: StackCheck,
    reports: Vec<Diagnostic>,
    /// Reports that hold only when one of their names is not declared in the file.
    held: Vec<(Diagnostic, Globals)>,
    declared: Globals,
    cut: bool,
    /// The wrapper records by their operand: those of one operand keep the order of the parse, an inner one first.
    wrappers: Vec<(Key, u32)>,
    /// The type arguments after an expression by their operand, those of one operand by where they are.
    type_arguments: Vec<(Key, u32)>,
    /// The members that the tree leaves out, by the body of their class and then in the order of the source.
    erased_members: Vec<(u32, u32)>,
    /// Where each return type of the file starts, sorted.
    return_types: Vec<u32>,
    /// Where a binary expression starts, by its address: what `binary_start` found for the links of a chain.
    binary_starts: BTreeMap<usize, Loc>,
}

impl<'p, 'a> Context<'p, 'a> {
    pub(crate) fn new(
        file: FileId,
        parsed: &'p ParsedForLint<'p, 'a>,
        source: &'a Source,
        typescript: bool,
    ) -> Self {
        let sidecar = parsed.sidecar;
        let mut wrappers: Vec<(Key, u32)> = sidecar
            .wrappers
            .records
            .iter()
            .zip(0u32..)
            .map(|(record, index)| (key_of(ExprId::of(&record.operand)), index))
            .collect();
        wrappers.sort_unstable();
        let mut type_arguments: Vec<(Key, u32)> = sidecar
            .generics
            .type_arguments
            .iter()
            .zip(0u32..)
            .filter(|(record, _)| record.of == TypeArgumentsOf::Expression)
            .map(|(record, index)| (key_of(ExprId::of(&record.operand)), index))
            .collect();
        type_arguments.sort_unstable();
        let mut erased_members: Vec<(u32, u32)> = sidecar
            .erased
            .members
            .iter()
            .zip(0u32..)
            .map(|(member, index)| (member.class_body, index))
            .collect();
        erased_members.sort_unstable();
        let mut return_types: Vec<u32> = sidecar
            .attached
            .return_types
            .iter()
            .map(|record| record.type_node.start)
            .collect();
        return_types.sort_unstable();
        Context {
            file,
            parsed,
            source,
            arena: parsed.arena,
            typescript,
            stack_check: StackCheck::init(),
            reports: Vec::new(),
            held: Vec::new(),
            declared: Globals::NONE,
            cut: false,
            wrappers,
            type_arguments,
            erased_members,
            return_types,
            binary_starts: BTreeMap::new(),
        }
    }

    #[inline]
    pub(crate) fn text(&self) -> &'a [u8] {
        &self.source.contents
    }

    /// Whether the file is TypeScript: a rule whose answer typescript-eslint changes asks.
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
        self.declared = self.declared.or(Globals::named(self.name_of(r#ref)));
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

    /// The names that a declaration outside the tree binds as a value: `declare`, an import of types, a namespace without statements.
    pub(crate) fn declare_erased(&mut self) {
        let sidecar = self.parsed.sidecar;
        for erased in &sidecar.erased.statements {
            // The inner part of a dotted namespace name binds nothing.
            if erased.flags.contains(ErasedFlags::NESTED) {
                continue;
            }
            match &erased.data {
                ErasedData::Declaration(stmt) => match &stmt.data {
                    StmtData::SFunction(function) => {
                        if let Some(name) = &function.func.name {
                            self.declare(name.ref_);
                        }
                    }
                    StmtData::SClass(class) => {
                        if let Some(name) = &class.class.class_name {
                            self.declare(name.ref_);
                        }
                    }
                    StmtData::SEnum(declaration) => self.declare(declaration.name.ref_),
                    StmtData::SLocal(local) => {
                        for decl in local.decls.iter() {
                            self.declare_binding(&decl.binding);
                        }
                    }
                    _ => {}
                },
                ErasedData::Module(module) => {
                    if let ModuleName::Identifier(name) = &module.name {
                        self.declare_name(name.text.slice());
                    }
                }
                ErasedData::Import(import) => match &import.clause {
                    ImportClause::Default(name) | ImportClause::Namespace(name) => {
                        self.declare_name(name.text.slice());
                    }
                    ImportClause::Named(items) => {
                        for item in items.slice() {
                            self.declare_name(item.original_name.slice());
                        }
                    }
                },
                ErasedData::ImportEquals(import) => self.declare_name(import.name.text.slice()),
                _ => {}
            }
        }
        for record in &sidecar.attached.specifiers {
            if let ModuleExportName::Identifier(name) = &record.specifier.name {
                self.declare_name(name.text.slice());
            }
        }
    }

    /// Every name that `binding` binds.
    fn declare_binding(&mut self, binding: &Binding) {
        if !self.stack_check.is_safe_to_recurse() {
            return;
        }
        match &binding.data {
            bun_ast::b::B::BIdentifier(name) => self.declare(name.r#ref),
            bun_ast::b::B::BArray(array) => {
                for item in array.items.slice() {
                    self.declare_binding(&item.binding);
                }
            }
            bun_ast::b::B::BObject(object) => {
                for property in object.properties.slice() {
                    self.declare_binding(&property.value);
                }
            }
            bun_ast::b::B::BMissing(_) => {}
        }
    }

    fn declare_name(&mut self, name: &[u8]) {
        self.declared = self.declared.or(Globals::named(name));
    }

    /// The statements and the members that the tree leaves out and the parse pass built: a walk of them reaches what they hold.
    pub(crate) fn erased_roots(&self) -> &'p bun_js_parser::parse::erased::ErasedTables {
        &self.parsed.sidecar.erased
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

    /// The records whose operand is `expr`, an inner one first.
    fn wrappers_of<'s>(&'s self, expr: &Expr) -> impl Iterator<Item = &'p Wrapper> + 's {
        let key = key_of(ExprId::of(expr));
        let records: &'p [Wrapper] = &self.parsed.sidecar.wrappers.records;
        let from = self.wrappers.partition_point(|(other, _)| *other < key);
        self.wrappers
            .get(from..)
            .unwrap_or(&[])
            .iter()
            .take_while(move |(other, _)| *other == key)
            .filter_map(move |(_, index)| records.get(*index as usize))
    }

    /// The outermost type arguments that stand after `expr` and before no optional call.
    fn type_arguments_of(&self, expr: &Expr) -> Option<&'p TypeArguments> {
        if self.type_arguments.is_empty() {
            return None;
        }
        let key = key_of(ExprId::of(expr));
        let records: &'p [TypeArguments] = &self.parsed.sidecar.generics.type_arguments;
        let to = self.type_arguments.partition_point(|(other, _)| *other <= key);
        let (other, index) = self.type_arguments.get(to.checked_sub(1)?)?;
        if *other != key {
            return None;
        }
        records.get(*index as usize)
    }

    /// What stands around `expr` where the tree has it.
    fn slot(&self, expr: &Expr) -> Slot {
        let mut slot = Slot::default();
        if self.wrappers.is_empty() && self.type_arguments.is_empty() {
            return slot;
        }
        let type_arguments = self.type_arguments_of(expr);
        // The type arguments stand around every record that ends before their `<`, and around a `<T>` before such a record.
        let inside = type_arguments.map_or(0, |list| {
            self.wrappers_of(expr)
                .zip(1usize..)
                .filter(|(record, _)| {
                    !matches!(record.data, WrapperData::TypeAssertion(_)) && record.end <= list.lt
                })
                .map(|(_, count)| count)
                .last()
                .unwrap_or(0)
        });
        let mut pending = type_arguments.is_some();
        for (record, index) in self.wrappers_of(expr).zip(0usize..) {
            if pending && index == inside {
                pending = false;
                slot.wrapped(TsWrapper::Instantiation);
            }
            match record.data {
                WrapperData::Parenthesized => {
                    slot.parens += 1;
                    slot.opened(record.op);
                }
                WrapperData::TypeAssertion(_) => {
                    slot.opened(record.op);
                    slot.wrapped(TsWrapper::TypeAssertion);
                }
                WrapperData::As(_) => slot.wrapped(TsWrapper::As),
                WrapperData::Satisfies(_) => slot.wrapped(TsWrapper::Satisfies),
                WrapperData::NonNull => slot.wrapped(TsWrapper::NonNull),
            }
        }
        if pending {
            slot.wrapped(TsWrapper::Instantiation);
        }
        slot
    }

    /// The TypeScript node that ESLint has where the tree has `expr`: the outermost `as`, `satisfies`, `!`, `<T>` or type argument list around it. Not for the target of a call, of `new` or of a template, whose type arguments are its own.
    pub(crate) fn ts_wrapper(&self, expr: &Expr) -> Option<TsWrapper> {
        self.slot(expr).ts
    }

    /// How many pairs of parentheses stand around the node that ESLint has where the tree has `expr`.
    pub(crate) fn paren_count(&self, expr: &Expr) -> u32 {
        self.slot(expr).parens
    }

    /// Whether anything stands around `expr` that leaves no node: such a literal is no pattern for typescript-eslint.
    pub(crate) fn is_wrapped(&self, expr: &Expr) -> bool {
        let slot = self.slot(expr);
        slot.parens > 0 || slot.ts.is_some()
    }

    /// Where `first` starts as the first operand of a node: at the first `(` or `<` around it.
    fn operand_start(&self, first: &Expr) -> Loc {
        match self.slot(first).open {
            Some(open) => loc_at(open).unwrap_or(first.loc),
            None => self.node_start(first),
        }
    }

    /// Where ESTree starts the node `expr`, what stands around it aside: at the first `(` or `<` of its first operand.
    pub(crate) fn node_start(&self, expr: &Expr) -> Loc {
        let mut node = expr;
        loop {
            let first = match &node.data {
                ExprData::EBinary(binary) => &binary.left,
                ExprData::EDot(dot) => &dot.target,
                ExprData::EIndex(index) => &index.target,
                ExprData::ECall(call) => &call.target,
                ExprData::EIf(conditional) => &conditional.test,
                ExprData::ETemplate(template) => match &template.tag {
                    Some(tag) => tag,
                    None => return node.loc,
                },
                ExprData::EUnary(unary)
                    if matches!(unary.op, OpCode::UnPostDec | OpCode::UnPostInc) =>
                {
                    &unary.value
                }
                ExprData::EClass(class) => return self.class_start(class, node.loc),
                _ => return node.loc,
            };
            if let Some(open) = self.slot(first).open {
                return loc_at(open).unwrap_or(first.loc);
            }
            node = first;
        }
    }

    /// Where a binary expression starts: where its left operand does. Every link of a chain that the way down passes starts there too, and is kept: a long chain is gone down once.
    pub(crate) fn binary_start(&mut self, node: &E::Binary) -> Loc {
        let address = core::ptr::from_ref(node).addr();
        if let Some(start) = self.binary_starts.get(&address) {
            return *start;
        }
        let mut passed = vec![address];
        let mut first = &node.left;
        let start = loop {
            if let Some(open) = self.slot(first).open {
                break loc_at(open).unwrap_or(first.loc);
            }
            let ExprData::EBinary(inner) = &first.data else {
                break self.node_start(first);
            };
            let address = core::ptr::from_ref::<E::Binary>(inner).addr();
            if let Some(start) = self.binary_starts.get(&address) {
                break *start;
            }
            passed.push(address);
            first = &inner.left;
        };
        for address in passed {
            self.binary_starts.insert(address, start);
        }
        start
    }

    /// Where a class expression starts: at the `@` of its first decorator, which the text before that decorator shows.
    fn class_start(&self, class: &G::Class, keyword: Loc) -> Loc {
        let Some(first) = class.ts_decorators.first() else {
            return keyword;
        };
        u32::try_from(self.operand_start(first).start)
            .ok()
            .and_then(|start| tokens::at_before(self.text(), start))
            .and_then(loc_at)
            .unwrap_or(keyword)
    }

    /// Where the node that ESLint has where the tree has `expr` starts: a `<T>` or a `(` inside the outermost TypeScript wrapper is part of it.
    fn wrapped_start(&self, expr: &Expr) -> Loc {
        match self.slot(expr).node_open {
            Some(open) => loc_at(open).unwrap_or(expr.loc),
            None => self.node_start(expr),
        }
    }

    /// Where ESTree ends the node `expr`, what stands around it aside. `None`: the kind of node has no end here, or its text does not read.
    pub(crate) fn node_end(&self, expr: &Expr) -> Option<u32> {
        match &expr.data {
            ExprData::EDot(dot) => self.token_end(dot.name_loc),
            ExprData::EIndex(index) => {
                if matches!(index.index.data, ExprData::EPrivateIdentifier(_)) {
                    self.token_end(index.index.loc)
                } else {
                    self.close_bracket(&index.index)?.checked_add(1)
                }
            }
            ExprData::ERegExp(reg_exp) => u32::try_from(expr.loc.start)
                .ok()?
                .checked_add(u32::try_from(reg_exp.value.slice().len()).ok()?),
            ExprData::EIdentifier(_)
            | ExprData::EPrivateIdentifier(_)
            | ExprData::EThis(_)
            | ExprData::ESuper(_)
            | ExprData::ENull(_)
            | ExprData::EBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_) => self.token_end(expr.loc),
            _ => None,
        }
    }

    /// What ESLint compares of the test of a `case`: the tokens of the node it has there, to the `:` of the clause. `None`: the text does not read.
    pub(crate) fn tokens_of(&self, value: &Expr) -> Option<Vec<u8>> {
        let from = u32::try_from(self.wrapped_start(value).start).ok()?;
        let spans = tokens::spans_under(self.text(), &[value], self.stack_check)?;
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.arena, &spans, from);
        // ESLint's own parser has a word as what it spells; typescript-eslint has its text.
        tokens::case_key(&mut tokens, self.text(), &self.return_types, !self.typescript)
    }

    /// Where the clause at `index` of `node` starts, which has a test: where the parser says, else at the `case` that is the token before the test, else at the test.
    pub(crate) fn case_start(&self, node: &S::Switch, index: usize) -> Loc {
        let cases = node.cases.slice();
        let Some((case, earlier)) = cases.get(..=index).and_then(<[Case]>::split_last) else {
            return Loc::EMPTY;
        };
        if case.loc.start >= 0 {
            return case.loc;
        }
        let Some(value) = &case.value else {
            return Loc::EMPTY;
        };
        let test = self.operand_start(value);
        self.case_keyword(node, earlier, test).unwrap_or(test)
    }

    /// The `case` that is the token before `test`: the tokens are read from the nearest place before it that the tree knows.
    fn case_keyword(&self, node: &S::Switch, earlier: &[Case], test: Loc) -> Option<Loc> {
        let test = u32::try_from(test.start).ok()?;
        // The last statement of a clause before, else the test of that clause, else the `{` of the statement.
        let mut from = node.body_loc;
        let mut spans = Some(Vec::new());
        for case in earlier.iter().rev() {
            if let Some(last) = case.body.slice().last() {
                from = last.loc;
                spans = tokens::spans_under_stmts(
                    self.text(),
                    core::slice::from_ref(last),
                    self.stack_check,
                );
                break;
            }
            if let Some(value) = &case.value {
                from = value.loc;
                spans = tokens::spans_under(self.text(), &[value], self.stack_check);
                break;
            }
        }
        let from = u32::try_from(from.start).ok()?;
        let spans = spans?;
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.arena, &spans, from);
        let before = tokens::last_before(&mut tokens, test)?;
        if before.t != T::TCase {
            return None;
        }
        loc_at(before.start)
    }

    /// The members of the class whose body is at `body` that the tree leaves out, in the order of the source.
    pub(crate) fn erased_members_of<'s>(
        &'s self,
        body: Loc,
    ) -> impl Iterator<Item = &'p ErasedMember> + 's {
        let members: &'p [ErasedMember] = &self.parsed.sidecar.erased.members;
        let body = u32::try_from(body.start).unwrap_or(u32::MAX);
        let from = self
            .erased_members
            .partition_point(|(other, _)| *other < body);
        self.erased_members
            .get(from..)
            .unwrap_or(&[])
            .iter()
            .take_while(move |(other, _)| *other == body)
            .filter_map(move |(_, index)| members.get(*index as usize))
    }

    /// The `]` after the index expression of a member.
    fn close_bracket(&self, index: &Expr) -> Option<u32> {
        let from = u32::try_from(index.loc.start).ok()?;
        let spans = tokens::spans_under(self.text(), &[index], self.stack_check)?;
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.arena, &spans, from);
        tokens::close_bracket(&mut tokens)
    }

    /// After the token that starts at `at`. `None` when the text there does not read.
    fn token_end(&self, at: Loc) -> Option<u32> {
        let at = u32::try_from(at.start).ok()?;
        match self.token_len(at) {
            0 => None,
            len => at.checked_add(len),
        }
    }

    /// The length of the token that starts at `at`, read without the tree. 0 when the text there does not read.
    fn token_len(&self, at: u32) -> u32 {
        let mut log = Log::init();
        let mut tokens = Tokens::new(&mut log, self.source, self.arena, &[], at);
        match tokens.next() {
            Some(token) if token.start == at => token.end.saturating_sub(token.start),
            _ => 0,
        }
    }
}

impl Slot {
    /// A `(` or a `<` at `op` stands around what the slot had so far.
    fn opened(&mut self, op: u32) {
        self.open = Some(self.open.map_or(op, |open| open.min(op)));
    }

    /// A wrapper that is no pair of parentheses stands around what the slot had so far.
    fn wrapped(&mut self, wrapper: TsWrapper) {
        self.ts = Some(wrapper);
        self.parens = 0;
        self.node_open = self.open;
    }
}

/// An erased member that ESLint has as a field: `declare name`, with no body and not abstract.
pub(crate) fn declared_field(member: &ErasedMember) -> Option<&G::Property> {
    if !member.flags.contains(ErasedFlags::DECLARE)
        || member
            .flags
            .intersects(ErasedFlags::ABSTRACT | ErasedFlags::NO_BODY)
    {
        return None;
    }
    match &member.data {
        ErasedMemberData::Property(property)
            if !property.flags.contains(bun_ast::flags::Property::IsMethod) =>
        {
            Some(&**property)
        }
        _ => None,
    }
}

fn loc_at(offset: u32) -> Option<Loc> {
    i32::try_from(offset).ok().map(|start| Loc { start })
}
