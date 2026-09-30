//! Type arguments after an expression and the type parameters of an interface or of a type alias, kept for a lint parse.

use bun_ast::op::Level;
use bun_ast::ts;
use bun_ast::{Expr, ExprData, Loc};

use crate::Error;
use crate::lexer::{LexerSnapshot, T};
use crate::p::P;
use crate::parse::attached::Owner;
use crate::parse::erased;
use crate::parse::wrappers::ExprId;
use crate::parser::SkipTypeParameterResult;

/// Where type arguments stand after an expression.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TypeArgumentsOf {
    /// `operand<T>`: before the arguments of a call, before a template, after the target of `new`, or alone as an instantiation expression.
    Expression,
    /// `operand?.<T>(...)`: the type arguments of the call.
    OptionalCall,
}

/// Type arguments after an expression: the tree holds `operand` where the source has `operand<T>`.
#[derive(Clone, Copy)]
pub struct TypeArguments {
    /// What the type arguments follow, as the tree holds it: the target of a call or of `new`, the tag of a template, or the expression itself.
    pub operand: Expr,
    /// Offset of `<`.
    pub lt: u32,
    /// Offset after `>`.
    pub end: u32,
    pub list: ts::List<ts::Type>,
    pub of: TypeArgumentsOf,
}

/// The type parameters of an interface or of a type alias, which leave no statement.
#[derive(Clone, Copy)]
pub struct DeclarationTypeParameters {
    /// Offset after the name of the declaration: `erased::Name::end` of its record.
    pub name_end: u32,
    /// Offset of `<`.
    pub lt: u32,
    /// Offset after `>`.
    pub end: u32,
    pub list: ts::List<ts::TypeParameter>,
}

/// The type arguments and the type parameters that a lint parse reads and no other list of the side table holds.
#[derive(Default)]
pub struct Generics {
    /// By where the `<` is.
    pub type_arguments: Vec<TypeArguments>,
    /// By where the `<` is.
    pub type_parameters: Vec<DeclarationTypeParameters>,
}

/// What a lint parse builds of the `<T>` after `async` before it knows what follows: type parameters for an arrow function, type arguments for a call.
pub(crate) struct AsyncTypeLists {
    /// Where the `<` is.
    less_than: Loc,
    type_parameters: Option<(ts::List<ts::TypeParameter>, u32)>,
    type_arguments: Option<(ts::List<ts::Type>, u32)>,
}

impl TypeArguments {
    /// Whether `expr` is the node that the type arguments follow.
    pub fn follows(&self, expr: &Expr) -> bool {
        ExprId::of(&self.operand) == ExprId::of(expr)
    }
}

impl Generics {
    /// Drops the records of what the parser read from `position` on: it goes back there.
    #[cold]
    pub(crate) fn rewind_to(&mut self, position: usize) {
        let kept = self
            .type_arguments
            .partition_point(|record| (record.lt as usize) < position);
        self.type_arguments.truncate(kept);
        let kept = self
            .type_parameters
            .partition_point(|record| (record.lt as usize) < position);
        self.type_parameters.truncate(kept);
    }

    /// How many records the lists hold.
    pub fn record_count(&self) -> usize {
        self.type_arguments.len() + self.type_parameters.len()
    }

    /// The type arguments after `operand`, by where their `<` is.
    pub fn type_arguments_after<'s>(
        &'s self,
        operand: &'s Expr,
    ) -> impl Iterator<Item = &'s TypeArguments> {
        self.type_arguments
            .iter()
            .filter(move |record| record.follows(operand))
    }

    /// The type parameters of the interface or of the type alias whose record has the name `name`.
    pub fn type_parameters_of(&self, name: &erased::Name) -> Option<&DeclarationTypeParameters> {
        let at = self
            .type_parameters
            .binary_search_by_key(&name.end, |record| record.name_end)
            .ok()?;
        self.type_parameters.get(at)
    }

    /// Records the type arguments after `operand`: `less_than` is where the `<` is, `end` the offset after the `>`.
    #[cold]
    #[inline(never)]
    pub(crate) fn type_argument_list(
        &mut self,
        operand: Expr,
        less_than: Loc,
        end: u32,
        list: ts::List<ts::Type>,
        of: TypeArgumentsOf,
    ) {
        let lt = offset(less_than);
        // The arguments of a call of `async` are recorded after what its parentheses hold.
        let at = self.type_arguments.partition_point(|record| record.lt < lt);
        self.type_arguments.insert(
            at,
            TypeArguments {
                operand,
                lt,
                end,
                list,
                of,
            },
        );
    }

    /// Records the type parameters of the interface or of the type alias whose name ends at `name_end`.
    #[cold]
    #[inline(never)]
    pub(crate) fn declaration_type_parameter_list(
        &mut self,
        name_end: u32,
        less_than: Loc,
        end: u32,
        list: ts::List<ts::TypeParameter>,
    ) {
        let lt = offset(less_than);
        let at = self
            .type_parameters
            .partition_point(|record| record.lt < lt);
        self.type_parameters.insert(
            at,
            DeclarationTypeParameters {
                name_end,
                lt,
                end,
                list,
            },
        );
    }
}

/// What a site of a lint parse calls where a parse without lint skips type arguments or type parameters: they are built and recorded.
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// The lexer is on the `<` after `operand`. True where type arguments and a token that may follow them stand there: they are read and recorded.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_type_arguments_in_expression(&mut self, operand: Expr) -> bool {
        let less_than = self.lexer.loc();
        let Some((list, end)) = self.try_build_type_script_type_arguments_with_backtracking()
        else {
            return false;
        };
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.generics.type_argument_list(
                operand,
                less_than,
                end,
                list,
                TypeArgumentsOf::Expression,
            );
        }
        true
    }

    /// Type arguments after `operand`, if `<` starts them here: they are read and recorded, and nothing goes back.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_type_arguments_after(
        &mut self,
        operand: Expr,
        of: TypeArgumentsOf,
    ) -> Result<bool, Error> {
        let less_than = self.lexer.loc();
        let Some((list, end)) = self.build_type_script_type_arguments::<false, false>()? else {
            return Ok(false);
        };
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts
                .generics
                .type_argument_list(operand, less_than, end, list, of);
        }
        Ok(true)
    }

    /// Reads `<T>` as type parameters again from the "<" of `less_than`, up to the "(" at `open`, where the lexer ends: the list and the offset after its ">", where they can be built.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_type_parameters_before_paren(
        &mut self,
        less_than: &LexerSnapshot<'a>,
        open: Loc,
    ) -> Option<(ts::List<ts::TypeParameter>, u32)> {
        let logged = self.lint_logged();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.restore(less_than);
        self.lexer.is_log_disabled = true;
        let read = self.build_type_script_type_parameters();
        self.lexer.is_log_disabled = old_log_disabled;
        if let Ok(Some(type_parameters)) = read
            && self.lexer.loc() == open
            && self.log().errors == logged.1
        {
            return Some(type_parameters);
        }
        self.lint_skip_type_parameters_again(less_than, logged);
        None
    }

    /// Reads `<T>` as type arguments again from the "<" of `less_than`, up to the "(" at `open`, where the lexer ends: the list and the offset after its ">", where they can be built.
    #[cold]
    #[inline(never)]
    fn lint_type_arguments_before_paren(
        &mut self,
        less_than: &LexerSnapshot<'a>,
        open: Loc,
    ) -> Option<(ts::List<ts::Type>, u32)> {
        let logged = self.lint_logged();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.restore(less_than);
        self.lexer.is_log_disabled = true;
        let read = self.build_type_script_type_arguments::<false, true>();
        self.lexer.is_log_disabled = old_log_disabled;
        if let Ok(Some(type_arguments)) = read
            && self.lexer.loc() == open
            && self.log().errors == logged.1
        {
            return Some(type_arguments);
        }
        self.lint_skip_type_parameters_again(less_than, logged);
        None
    }

    /// How many messages, errors and warnings the log holds.
    fn lint_logged(&self) -> (usize, u32, u32) {
        let log = self.log();
        (log.msgs.len(), log.errors, log.warnings)
    }

    /// Goes back to the "<" of `less_than` and skips the type parameters up to the "(" as before: what was logged since `logged` goes.
    fn lint_skip_type_parameters_again(
        &mut self,
        less_than: &LexerSnapshot<'a>,
        logged: (usize, u32, u32),
    ) {
        self.lexer.restore(less_than);
        let _ = self.try_skip_type_script_type_parameters_then_open_paren_with_backtracking();
        let log = self.log();
        log.msgs.truncate(logged.0);
        log.errors = logged.1;
        log.warnings = logged.2;
    }

    /// Records `type_parameters`, whose `<` is at `less_than`, for the arrow function at `arrow`.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_arrow_type_parameters(
        &mut self,
        arrow: Loc,
        less_than: Loc,
        type_parameters: Option<(ts::List<ts::TypeParameter>, u32)>,
    ) {
        if let Some((list, end)) = type_parameters
            && let Some(starts) = &mut self.starts_for_parse_only
        {
            starts
                .attached
                .type_parameter_list(Owner::arrow(arrow), less_than, end, list);
        }
    }

    /// `try_skip_type_script_type_parameters_then_open_paren_with_backtracking` of a lint parse, at the `<` after `async`: what is skipped is built too and goes to `lists`, for `lint_async_type_lists`.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_try_async_type_parameters(
        &mut self,
        lists: &mut Option<Box<AsyncTypeLists>>,
    ) -> Result<SkipTypeParameterResult, Error> {
        let less_than = self.lexer.snapshot();
        let less_than_loc = self.lexer.loc();
        let result = self.try_skip_type_script_type_parameters_then_open_paren_with_backtracking();
        if result == SkipTypeParameterResult::DidNotSkipAnything {
            return Ok(result);
        }
        let open = self.lexer.loc();
        let mut type_arguments = None;
        let type_parameters = if result == SkipTypeParameterResult::DefinitelyTypeParameters {
            // The type parameters of an arrow function are read again, as the ones that are kept.
            self.lexer.restore(&less_than);
            let type_parameters = self.build_type_script_type_parameters()?;
            if self.lexer.loc() != open {
                self.lexer.expected(T::TOpenParen)?;
                return Err(Error::SyntaxError);
            }
            type_parameters
        } else {
            type_arguments = self.lint_type_arguments_before_paren(&less_than, open);
            self.lint_type_parameters_before_paren(&less_than, open)
        };
        *lists = Some(Box::new(AsyncTypeLists {
            less_than: less_than_loc,
            type_parameters,
            type_arguments,
        }));
        Ok(result)
    }

    /// Records what `lint_try_async_type_parameters` built: `value` is what was read after it, the arrow function at `async_loc` or a call of `async`.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_async_type_lists(
        &mut self,
        async_loc: Loc,
        value: Expr,
        lists: Option<Box<AsyncTypeLists>>,
    ) {
        let Some(lists) = lists else {
            return;
        };
        match value.data {
            ExprData::EArrow(_) => {
                self.lint_arrow_type_parameters(async_loc, lists.less_than, lists.type_parameters);
            }
            ExprData::ECall(call) => {
                if let Some((list, end)) = lists.type_arguments
                    && let Some(starts) = &mut self.starts_for_parse_only
                {
                    starts.generics.type_argument_list(
                        call.target,
                        lists.less_than,
                        end,
                        list,
                        TypeArgumentsOf::Expression,
                    );
                }
            }
            _ => {}
        }
    }

    /// The lexer is on the `implements` of the class whose keyword is at `class_keyword`: reads the entries and records the clause.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_class_implements(&mut self, class_keyword: Loc) -> Result<(), Error> {
        let keyword = offset_of(self.lexer.start);
        self.lexer.next()?;
        let start = offset_of(self.lexer.start);
        let mut entries: Vec<ts::Type> = Vec::new();
        let end;
        loop {
            let entry = self.lint_class_implements_entry()?;
            entries.push(entry);
            if self.lexer.token != T::TComma {
                end = entry.end;
                break;
            }
            self.lexer.next()?;
        }
        let clause = ts::HeritageClause {
            start: keyword,
            end,
            token: ts::HeritageToken::Implements,
            types: ts::List::from_slice(self.arena, &entries, start, end),
        };
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.attached.heritage_clause(class_keyword, clause);
        }
        Ok(())
    }

    /// An entry of `implements`: a type reference where one stands there, else an expression with its type arguments.
    fn lint_class_implements_entry(&mut self) -> Result<ts::Type, Error> {
        let start = self.lexer.snapshot();
        let logged = self.lint_logged();
        self.lexer.is_log_disabled = true;
        let as_type = self.build_type_script_type(Level::Lowest);
        self.lexer.is_log_disabled = start.is_log_disabled;
        match as_type {
            Ok(type_node)
                if matches!(type_node.data, ts::TypeData::TypeReference(_))
                    && self.log().errors == logged.1
                    && matches!(self.lexer.token, T::TComma | T::TOpenBrace) =>
            {
                return Ok(type_node);
            }
            Err(err @ (Error::StackOverflow | Error::Alloc(_))) => return Err(err),
            _ => {}
        }

        // No type reference stands there: what the reading logged goes, and the entry is read as the reference reads it.
        self.lexer.restore(&start);
        let log = self.log();
        log.msgs.truncate(logged.0);
        log.errors = logged.1;
        log.warnings = logged.2;
        let expression_start = offset_of(self.lexer.start);
        let (expression, mut end) = self.lint_expression_of_heritage_entry()?;
        let mut type_arguments = None;
        if let Some((list, close_end)) = self.build_type_script_type_arguments::<false, false>()? {
            type_arguments = Some(list);
            end = close_end;
        }
        let payload = ts::ExpressionWithTypeArguments {
            expression,
            type_arguments,
        };
        Ok(ts::Type::alloc(self.arena, payload, expression_start, end))
    }

    /// Reads the expression of an entry of `implements` and keeps it and the offset after it: what it declared goes away, as where a parse without lint drops it.
    fn lint_expression_of_heritage_entry(&mut self) -> Result<(Expr, u32), Error> {
        let errors = self.log().errors;
        let msgs_len = self.log().msgs.len();
        let has_import_meta = self.has_import_meta;
        let has_with_scope = self.has_with_scope;
        let has_es_module_syntax = self.has_es_module_syntax;
        let needs_jsx_import = self.needs_jsx_import;
        let top_level_await_keyword = self.top_level_await_keyword;
        // A name in what is read here is no use of an import.
        let parse_pass_symbol_uses = self.parse_pass_symbol_uses.take();
        let names_len = self.allocated_names.len();
        let comments_len = self.lexer.all_comments.len();
        let is_log_disabled = self.lexer.is_log_disabled;
        let snapshot = self.parser_snapshot();

        self.allow_in = true;
        self.allow_private_identifiers = true;
        self.fn_or_arrow_data_parse.allow_super_call = true;
        self.fn_or_arrow_data_parse.allow_super_property = true;
        let result = self.parse_expr(Level::New);

        let has_failed = result.is_err() || self.log().errors != errors;
        let mut end = self.lexer.snapshot();
        let names: Vec<&'a [u8]> = self
            .allocated_names
            .iter()
            .skip(names_len)
            .copied()
            .collect();
        let comments: Vec<bun_ast::Range> = self
            .lexer
            .all_comments
            .iter()
            .skip(comments_len)
            .copied()
            .collect();
        let log = self.log();
        let (errors_after, warnings_after) = (log.errors, log.warnings);
        let logged: Vec<bun_ast::Msg> = if has_failed && log.msgs.len() > msgs_len {
            log.msgs.drain(msgs_len..).collect()
        } else {
            Vec::new()
        };

        self.restore_parser_snapshot(snapshot);
        self.parse_pass_symbol_uses = parse_pass_symbol_uses;
        self.has_import_meta = has_import_meta;
        self.has_with_scope = has_with_scope;
        self.has_es_module_syntax = has_es_module_syntax;
        self.needs_jsx_import = needs_jsx_import;
        self.top_level_await_keyword = top_level_await_keyword;
        // The expression that stays names them by index.
        for name in names {
            self.allocated_names.push(name);
        }

        if has_failed {
            let log = self.log();
            log.msgs.extend(logged);
            log.errors = errors_after;
            log.warnings = warnings_after;
            return Err(match result {
                Err(err) => err,
                Ok(_) => Error::SyntaxError,
            });
        }

        self.lexer.all_comments.extend(comments);
        end.is_log_disabled = is_log_disabled;
        end.prev_error_loc = self.lexer.prev_error_loc;
        end.all_comments_len = self.lexer.all_comments.len();
        end.comments_to_preserve_before_len = self.lexer.comments_to_preserve_before.len();
        self.lexer.restore(&end);
        let end = ts::full_start(
            self.lexer.contents,
            &self.lexer.all_comments,
            offset_of(self.lexer.start),
        );
        result.map(|expression| (expression, end))
    }

    /// The lexer is on the `<` after the name of an interface or of a type alias: reads the type parameters and records them.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_declaration_type_parameters(&mut self) -> Result<(), Error> {
        let less_than = self.lexer.loc();
        let name_end = ts::full_start(
            self.lexer.contents,
            &self.lexer.all_comments,
            offset_of(self.lexer.start),
        );
        if let Some((list, end)) = self.build_type_script_type_parameters()?
            && let Some(starts) = &mut self.starts_for_parse_only
        {
            starts
                .generics
                .declaration_type_parameter_list(name_end, less_than, end, list);
        }
        Ok(())
    }
}

fn offset(loc: Loc) -> u32 {
    u32::try_from(loc.start).unwrap_or(0)
}

fn offset_of(at: usize) -> u32 {
    u32::try_from(at).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::defines::Define;
    use crate::parse::parse_entry::{Options, ParsedForLint, Parser};
    use bun_alloc::Arena;
    use bun_ast::{E, Loader, StoreStr};

    fn identifier(start: i32) -> Expr {
        Expr {
            loc: Loc { start },
            data: ExprData::EIdentifier(E::Identifier::default()),
        }
    }

    fn name(text: &'static [u8], start: u32) -> erased::Name {
        erased::Name {
            start,
            end: start + text.len() as u32,
            text: StoreStr::new(text),
        }
    }

    /// `<T>` after `operand`, with the `<` at `lt`.
    fn record(generics: &mut Generics, operand: Expr, lt: u32) {
        let less_than = Loc { start: lt as i32 };
        let list = ts::List::empty(lt + 1, lt + 2);
        generics.type_argument_list(
            operand,
            less_than,
            lt + 3,
            list,
            TypeArgumentsOf::Expression,
        );
    }

    #[test]
    fn type_arguments_stay_in_the_order_of_the_source() {
        let mut generics = Generics::default();
        record(&mut generics, identifier(9), 10);
        record(&mut generics, identifier(0), 5);
        record(&mut generics, identifier(20), 21);
        let found: Vec<(u32, u32, i32)> = generics
            .type_arguments
            .iter()
            .map(|record| (record.lt, record.end, record.operand.loc.start))
            .collect();
        assert_eq!(found, [(5, 8, 0), (10, 13, 9), (21, 24, 20)]);

        let async_call = identifier(0);
        let after: Vec<u32> = generics
            .type_arguments_after(&async_call)
            .map(|record| record.lt)
            .collect();
        assert_eq!(after, [5]);
        assert!(
            generics
                .type_arguments
                .iter()
                .all(|record| !record.follows(&identifier(5)))
        );
    }

    #[test]
    fn type_parameters_are_found_by_the_name_of_their_declaration() {
        let mut generics = Generics::default();
        let (first, second, bare) = (name(b"A", 5), name(b"Second", 30), name(b"B", 60));
        let list = ts::List::empty(7, 8);
        generics.declaration_type_parameter_list(first.end, Loc { start: 6 }, 9, list);
        let list = ts::List::empty(38, 39);
        generics.declaration_type_parameter_list(second.end, Loc { start: 37 }, 40, list);
        let found = |name: &erased::Name| {
            generics
                .type_parameters_of(name)
                .map(|record| (record.lt, record.end))
        };
        assert_eq!(found(&first), Some((6, 9)));
        assert_eq!(found(&second), Some((37, 40)));
        assert_eq!(found(&bare), None);
    }

    #[test]
    fn rewind_drops_what_was_read_from_the_position_on() {
        let mut generics = Generics::default();
        record(&mut generics, identifier(0), 1);
        record(&mut generics, identifier(8), 9);
        let list = ts::List::empty(21, 22);
        generics.declaration_type_parameter_list(20, Loc { start: 20 }, 23, list);
        assert_eq!(generics.record_count(), 3);

        generics.rewind_to(24);
        assert_eq!(generics.record_count(), 3);
        generics.rewind_to(20);
        assert_eq!(generics.record_count(), 2);
        generics.rewind_to(9);
        let lts: Vec<u32> = generics
            .type_arguments
            .iter()
            .map(|record| record.lt)
            .collect();
        assert_eq!(lts, [1]);
        generics.rewind_to(0);
        assert_eq!(generics.record_count(), 0);
    }

    struct Case {
        name: &'static str,
        path: &'static [u8],
        loader: Loader,
        text: &'static [u8],
        /// One line for each record, by where its `<` or its keyword is.
        records: &'static [&'static str],
    }

    /// A line for each record of type arguments, of type parameters and of a heritage clause that the lint parse of `case` makes. `None`: it does not parse.
    fn lint_parse(case: &Case) -> Option<Vec<String>> {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(case.path, case.text);
        let mut options = Options::init(Default::default(), case.loader);
        options.features.no_macros = true;
        options.features.dont_bundle_twice = true;
        let define = Define::default();
        let mut log = bun_ast::Log::init();
        let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
        parser
            .parse_for_lint(|parsed| describe(case.text, parsed))
            .ok()
    }

    fn describe(text: &[u8], parsed: &ParsedForLint<'_, '_>) -> Vec<String> {
        let sidecar = parsed.sidecar;
        let source = |start: u32, end: u32| {
            let bytes = text.get(start as usize..end as usize).unwrap_or(&[]);
            String::from_utf8_lossy(bytes).into_owned()
        };
        let mut lines: Vec<(u32, String)> = Vec::new();
        for record in &sidecar.generics.type_arguments {
            let of = match record.of {
                TypeArgumentsOf::Expression => "type-arguments",
                TypeArgumentsOf::OptionalCall => "call-type-arguments",
            };
            let list = source(record.lt, record.end);
            let tag = <&'static str>::from(record.operand.data.tag());
            let at = record.operand.loc.start;
            lines.push((record.lt, format!("{of} {list} after {tag}@{at}")));
        }
        for record in &sidecar.generics.type_parameters {
            let list = source(record.lt, record.end);
            let name_end = record.name_end;
            lines.push((
                record.lt,
                format!("type-parameters {list} after the name that ends at {name_end}"),
            ));
        }
        for record in &sidecar.attached.type_parameters {
            let list = source(record.lt, record.end);
            let owner = record.owner;
            lines.push((record.lt, format!("type-parameters {list} of {owner:?}")));
        }
        for record in &sidecar.attached.heritage {
            let clause = record.clause;
            let words = source(clause.start, clause.end);
            let kinds: Vec<&str> = clause
                .types
                .iter()
                .map(|entry| entry.data.kind_name())
                .collect();
            let (class, kinds) = (record.class, kinds.join(", "));
            lines.push((
                clause.start,
                format!("{words} of the class at {class}: {kinds}"),
            ));
        }
        for record in &sidecar.attached.jsx_type_arguments {
            let list = source(record.lt, record.end);
            let element = record.element;
            lines.push((
                record.lt,
                format!("jsx-type-arguments {list} of the element at {element}"),
            ));
        }
        lines.sort_by_key(|line| line.0);
        lines.into_iter().map(|line| line.1).collect()
    }

    #[test]
    fn records_are_those_of_the_known_sources() {
        let mut failed = Vec::new();
        for case in CASES {
            let records = case.records.iter().map(|line| (*line).to_owned()).collect();
            let expected: Option<Vec<String>> = Some(records);
            let found = lint_parse(case);
            if found != expected {
                failed.push(format!("{}: {found:#?}", case.name));
            }
        }
        assert!(failed.is_empty(), "{}", failed.join("\n"));
    }

    const CASES: &[Case] = &[
        Case {
            name: "calls",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"f<T>(x);\na.b<U, V>(y);\n",
            records: &[
                "type-arguments <T> after e_identifier@0",
                "type-arguments <U, V> after e_dot@9",
            ],
        },
        Case {
            name: "new",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"new F<T>(x);\nnew G<T>;\n",
            records: &[
                "type-arguments <T> after e_identifier@4",
                "type-arguments <T> after e_identifier@17",
            ],
        },
        Case {
            name: "tagged-template",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"f<T>`x`;\n",
            records: &["type-arguments <T> after e_identifier@0"],
        },
        Case {
            name: "instantiation-expression",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"const g = f<T>;\n",
            records: &["type-arguments <T> after e_identifier@10"],
        },
        Case {
            name: "optional-call",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"a?.<T>(x);\n",
            records: &["call-type-arguments <T> after e_identifier@0"],
        },
        Case {
            name: "call-of-async",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"async<T>(f<U>(x));\n",
            records: &[
                "type-arguments <T> after e_identifier@0",
                "type-arguments <U> after e_identifier@9",
            ],
        },
        Case {
            name: "decorator",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"@d<T>() class C {}\n",
            records: &["type-arguments <T> after e_identifier@1"],
        },
        Case {
            name: "attempt-that-goes-back",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"a < b > c;\n",
            records: &[],
        },
        Case {
            name: "arrow-body-read-twice",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"a ? (b) : c => d<T>(e) : f;\n",
            records: &["type-arguments <T> after e_identifier@15"],
        },
        Case {
            name: "generic-arrows",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"const a = <T>(x: T) => x;\nconst b = async <U>(y: U) => y;\nconst c = <V,>(z) => z;\n",
            records: &[
                "type-parameters <T> of Arrow(10)",
                "type-parameters <U> of Arrow(36)",
                "type-parameters <V,> of Arrow(68)",
            ],
        },
        Case {
            name: "cast-of-parentheses",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"const d = <T>(x);\n",
            records: &[],
        },
        Case {
            name: "functions-and-classes",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"function f<T>(a: T) {}\nconst g = function <U>() {};\nclass C<V> { m<W>() {} }\nconst o = { n<X>() {} };\n",
            records: &[
                "type-parameters <T> of Fn(13)",
                "type-parameters <U> of Fn(45)",
                "type-parameters <V> of Class(52)",
                "type-parameters <W> of Fn(69)",
                "type-parameters <X> of Fn(93)",
            ],
        },
        Case {
            name: "heritage",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"const k = class<T> extends B<T> implements I, J<K> {};\n",
            records: &[
                "type-parameters <T> of Class(10)",
                "extends B<T> of the class at 10: ExpressionWithTypeArguments",
                "implements I, J<K> of the class at 10: TypeReference, TypeReference",
            ],
        },
        Case {
            name: "implements-an-expression",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"class C implements (A), b.c<D> {}\n",
            records: &[
                "implements (A), b.c<D> of the class at 0: ExpressionWithTypeArguments, TypeReference",
            ],
        },
        Case {
            name: "interface-and-type-alias",
            path: b"/a.ts",
            loader: Loader::Ts,
            text: b"interface I<T> extends J<T> { a: T }\ntype A<U = I> = U[];\n",
            records: &[
                "type-parameters <T> after the name that ends at 11",
                "type-parameters <U = I> after the name that ends at 43",
            ],
        },
        Case {
            name: "jsx",
            path: b"/a.tsx",
            loader: Loader::Tsx,
            text: b"const e = <Foo<string> a=\"1\" />;\nconst f = <T,>(x: T) => x;\n",
            records: &[
                "jsx-type-arguments <string> of the element at 10",
                "type-parameters <T,> of Arrow(43)",
            ],
        },
    ];
}
