//! TypeScript syntax that belongs to a node that stays in the tree, kept for a lint parse.

use bun_ast::op::Level;
use bun_ast::ts;
use bun_ast::{Expr, Loc, Range};

use crate::Error;
use crate::lexer::T;
use crate::p::P;

/// What a record of a function, of an arrow function or of a class belongs to: an offset alone names no node.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Debug)]
pub enum Owner {
    /// `G::Fn::open_parens_loc` of a function, method, accessor or constructor.
    Fn(u32),
    /// `Expr::loc` of an `E::Arrow`.
    Arrow(u32),
    /// `G::Class::class_keyword.loc`.
    Class(u32),
}

impl Owner {
    /// The function, method, accessor or constructor whose `(` is at `open_parens`.
    #[inline]
    pub fn function(open_parens: Loc) -> Owner {
        Owner::Fn(offset(open_parens))
    }

    /// The arrow function whose expression is at `loc`.
    #[inline]
    pub fn arrow(loc: Loc) -> Owner {
        Owner::Arrow(offset(loc))
    }

    /// The class whose `class` keyword is at `class_keyword`.
    #[inline]
    pub fn class(class_keyword: Loc) -> Owner {
        Owner::Class(offset(class_keyword))
    }
}

/// The `?`, the `!` and the type after a binding or after the name of a class member.
#[derive(Clone, Copy)]
pub struct Annotation {
    /// `Binding::loc` of the binding, or `Expr::loc` of the key of the class member.
    pub owner: u32,
    /// Offset of the `?`.
    pub question: Option<u32>,
    /// Offset of the `!`.
    pub exclamation: Option<u32>,
    pub type_node: Option<ts::Type>,
}

impl Annotation {
    /// The `?` as the token that TypeScript keeps.
    pub fn question_token(&self) -> Option<ts::Token> {
        self.question
            .map(|start| token(start, ts::TokenKind::Question))
    }

    /// The `!` as the token that TypeScript keeps.
    pub fn exclamation_token(&self) -> Option<ts::Token> {
        self.exclamation
            .map(|start| token(start, ts::TokenKind::Exclamation))
    }
}

/// A `this` parameter: the tree has no argument for it.
#[derive(Clone, Copy)]
pub struct ThisParameter {
    pub owner: Owner,
    /// How many arguments the tree has before it.
    pub index: u32,
    /// Offset of `this`.
    pub start: u32,
    /// Offset after `this`.
    pub end: u32,
    pub type_node: Option<ts::Type>,
}

/// The type parameters of a function, of an arrow function or of a class.
#[derive(Clone, Copy)]
pub struct TypeParameters {
    pub owner: Owner,
    /// Offset of `<`.
    pub lt: u32,
    /// Offset after `>`.
    pub end: u32,
    pub list: ts::List<ts::TypeParameter>,
}

/// The type after the `:` that follows a parameter list: a return type or a type predicate.
#[derive(Clone, Copy)]
pub struct ReturnType {
    pub owner: Owner,
    pub type_node: ts::Type,
}

/// One `extends` or `implements` clause of a class.
#[derive(Clone, Copy)]
pub struct Heritage {
    /// `G::Class::class_keyword.loc`.
    pub class: u32,
    pub clause: ts::HeritageClause,
}

/// The type arguments after the name of a JSX element.
#[derive(Clone, Copy)]
pub struct JsxTypeArguments {
    /// `Expr::loc` of the `E::JSXElement`.
    pub element: u32,
    /// Offset of `<`.
    pub lt: u32,
    /// Offset after `>`.
    pub end: u32,
    pub list: ts::List<ts::Type>,
}

/// A modifier that the tree keeps no trace of: `abstract` before `class`, `const` before `enum`.
#[derive(Clone, Copy)]
pub struct Keyword {
    /// `G::Class::class_keyword.loc` of the class, or `S::Enum::name.loc` of the enum.
    pub owner: u32,
    pub start: u32,
    pub end: u32,
    pub kind: ts::ModifierKind,
}

/// The name of an import or export specifier: an identifier or a keyword, or a string.
#[derive(Clone, Copy)]
pub enum ModuleExportName {
    Identifier(ts::Name),
    String(ts::Literal),
}

/// One name of the clause of an import or export statement.
#[derive(Clone, Copy)]
pub struct Specifier {
    /// Offset of its first token: `type`, or the name.
    pub start: u32,
    /// Offset after its last name.
    pub end: u32,
    /// Offset of `type`.
    pub type_keyword: Option<u32>,
    /// The name before `as`.
    pub property_name: Option<ModuleExportName>,
    pub name: ModuleExportName,
}

/// A name with `type` in the clause of an import or export statement: the tree has no item for it.
#[derive(Clone, Copy)]
pub struct TypeOnlySpecifier {
    /// `Stmt::loc` of the `S::Import`, `S::ExportClause` or `S::ExportFrom`, or the start of a statement that leaves none.
    pub statement: u32,
    /// How many names of the clause the tree has before it.
    pub index: u32,
    pub specifier: Specifier,
}

/// The `statement` of a name whose clause no statement has taken yet.
const UNPLACED: u32 = u32::MAX;

/// The TypeScript syntax of the nodes that stay, as a lint parse reads it: `sort` puts each list in the order of its key.
#[derive(Default)]
pub struct Attached {
    pub annotations: Vec<Annotation>,
    pub this_parameters: Vec<ThisParameter>,
    pub type_parameters: Vec<TypeParameters>,
    pub return_types: Vec<ReturnType>,
    /// The clauses of one class are in the order of the source.
    pub heritage: Vec<Heritage>,
    pub jsx_type_arguments: Vec<JsxTypeArguments>,
    pub keywords: Vec<Keyword>,
    /// The names of one clause are in the order of the source.
    pub specifiers: Vec<TypeOnlySpecifier>,
}

/// How many records of each kind a parse had made at one point.
#[derive(Clone, Copy)]
pub(crate) struct AttachedMark {
    annotations: u32,
    this_parameters: u32,
    type_parameters: u32,
    return_types: u32,
    heritage: u32,
    jsx_type_arguments: u32,
    keywords: u32,
    specifiers: u32,
}

impl Attached {
    pub(crate) fn mark(&self) -> AttachedMark {
        AttachedMark {
            annotations: offset_of(self.annotations.len()),
            this_parameters: offset_of(self.this_parameters.len()),
            type_parameters: offset_of(self.type_parameters.len()),
            return_types: offset_of(self.return_types.len()),
            heritage: offset_of(self.heritage.len()),
            jsx_type_arguments: offset_of(self.jsx_type_arguments.len()),
            keywords: offset_of(self.keywords.len()),
            specifiers: offset_of(self.specifiers.len()),
        }
    }

    /// Drops every record made since `mark`.
    #[cold]
    pub(crate) fn rewind(&mut self, mark: AttachedMark) {
        self.annotations.truncate(mark.annotations as usize);
        self.this_parameters.truncate(mark.this_parameters as usize);
        self.type_parameters.truncate(mark.type_parameters as usize);
        self.return_types.truncate(mark.return_types as usize);
        self.heritage.truncate(mark.heritage as usize);
        self.jsx_type_arguments
            .truncate(mark.jsx_type_arguments as usize);
        self.keywords.truncate(mark.keywords as usize);
        self.specifiers.truncate(mark.specifiers as usize);
    }

    /// How many records the lists hold.
    pub fn record_count(&self) -> usize {
        self.annotations.len()
            + self.this_parameters.len()
            + self.type_parameters.len()
            + self.return_types.len()
            + self.heritage.len()
            + self.jsx_type_arguments.len()
            + self.keywords.len()
            + self.specifiers.len()
    }

    /// Puts every list in the order of its key: the records of one key keep the order of the source.
    pub fn sort(&mut self) {
        self.annotations.sort_by_key(|record| record.owner);
        self.this_parameters.sort_by_key(|record| record.owner);
        self.type_parameters.sort_by_key(|record| record.owner);
        self.return_types.sort_by_key(|record| record.owner);
        self.heritage.sort_by_key(|record| record.class);
        self.jsx_type_arguments.sort_by_key(|record| record.element);
        self.keywords.sort_by_key(|record| record.owner);
        self.specifiers
            .sort_by_key(|record| (record.statement, record.index));
    }

    /// The `?`, `!` and type of the binding at `owner`, or of the class member whose key is at `owner`, in sorted lists.
    pub fn annotation_of(&self, owner: Loc) -> Option<&Annotation> {
        let owner = offset(owner);
        let at = self
            .annotations
            .binary_search_by_key(&owner, |record| record.owner)
            .ok()?;
        self.annotations.get(at)
    }

    /// The `this` parameter of `owner`, in sorted lists.
    pub fn this_parameter_of(&self, owner: Owner) -> Option<&ThisParameter> {
        let at = self
            .this_parameters
            .binary_search_by_key(&owner, |record| record.owner)
            .ok()?;
        self.this_parameters.get(at)
    }

    /// The type parameters of `owner`, in sorted lists.
    pub fn type_parameters_of(&self, owner: Owner) -> Option<&TypeParameters> {
        let at = self
            .type_parameters
            .binary_search_by_key(&owner, |record| record.owner)
            .ok()?;
        self.type_parameters.get(at)
    }

    /// The return type or the type predicate of `owner`, in sorted lists.
    pub fn return_type_of(&self, owner: Owner) -> Option<&ReturnType> {
        let at = self
            .return_types
            .binary_search_by_key(&owner, |record| record.owner)
            .ok()?;
        self.return_types.get(at)
    }

    /// The clauses of the class whose `class` keyword is at `class_keyword`, in sorted lists.
    pub fn heritage_of(&self, class_keyword: Loc) -> &[Heritage] {
        let class = offset(class_keyword);
        let from = self.heritage.partition_point(|record| record.class < class);
        let to = self
            .heritage
            .partition_point(|record| record.class <= class);
        self.heritage.get(from..to).unwrap_or(&[])
    }

    /// The type arguments of the JSX element at `element`, in sorted lists.
    pub fn jsx_type_arguments_of(&self, element: Loc) -> Option<&JsxTypeArguments> {
        let element = offset(element);
        let at = self
            .jsx_type_arguments
            .binary_search_by_key(&element, |record| record.element)
            .ok()?;
        self.jsx_type_arguments.get(at)
    }

    /// The keywords of the class or of the enum at `owner`, in sorted lists.
    pub fn keywords_of(&self, owner: Loc) -> &[Keyword] {
        let owner = offset(owner);
        let from = self.keywords.partition_point(|record| record.owner < owner);
        let to = self
            .keywords
            .partition_point(|record| record.owner <= owner);
        self.keywords.get(from..to).unwrap_or(&[])
    }

    /// The names with `type` of the statement at `statement`, in sorted lists.
    pub fn specifiers_of(&self, statement: Loc) -> &[TypeOnlySpecifier] {
        let statement = offset(statement);
        let from = self
            .specifiers
            .partition_point(|record| record.statement < statement);
        let to = self
            .specifiers
            .partition_point(|record| record.statement <= statement);
        self.specifiers.get(from..to).unwrap_or(&[])
    }

    /// Records the `?` after the binding or the member name at `owner`: `question` is where it is.
    #[cold]
    pub fn optional(&mut self, owner: Loc, question: Loc) {
        if let Some(record) = self.annotation_at(owner) {
            record.question = Some(offset(question));
        }
    }

    /// Records the `!` after the binding or the member name at `owner`: `exclamation` is where it is.
    #[cold]
    pub fn definite(&mut self, owner: Loc, exclamation: Loc) {
        if let Some(record) = self.annotation_at(owner) {
            record.exclamation = Some(offset(exclamation));
        }
    }

    /// Records the type after the `:` that follows the binding or the member name at `owner`.
    #[cold]
    pub fn annotation(&mut self, owner: Loc, type_node: ts::Type) {
        if let Some(record) = self.annotation_at(owner) {
            record.type_node = Some(type_node);
        }
    }

    /// Records the `this` parameter of `owner`, which has `index` arguments before it: `this` is the range of the word.
    #[cold]
    #[inline(never)]
    pub fn this_parameter(
        &mut self,
        owner: Owner,
        index: usize,
        this: Range,
        type_node: Option<ts::Type>,
    ) {
        self.this_parameters.push(ThisParameter {
            owner,
            index: offset_of(index),
            start: offset(this.loc),
            end: offset(this.end()),
            type_node,
        });
    }

    /// Records the type parameters of `owner`: `less_than` is where the `<` is, `end` the offset after the `>`.
    #[cold]
    #[inline(never)]
    pub fn type_parameter_list(
        &mut self,
        owner: Owner,
        less_than: Loc,
        end: u32,
        list: ts::List<ts::TypeParameter>,
    ) {
        self.type_parameters.push(TypeParameters {
            owner,
            lt: offset(less_than),
            end,
            list,
        });
    }

    /// Records the return type or the type predicate of `owner`.
    #[cold]
    pub fn return_type(&mut self, owner: Owner, type_node: ts::Type) {
        self.return_types.push(ReturnType { owner, type_node });
    }

    /// Records a clause of the class whose `class` keyword is at `class_keyword`.
    #[cold]
    pub fn heritage_clause(&mut self, class_keyword: Loc, clause: ts::HeritageClause) {
        self.heritage.push(Heritage {
            class: offset(class_keyword),
            clause,
        });
    }

    /// Records the type arguments of the JSX element at `element`: `less_than` is where the `<` is, `end` the offset after the `>`.
    #[cold]
    #[inline(never)]
    pub fn jsx_type_argument_list(
        &mut self,
        element: Loc,
        less_than: Loc,
        end: u32,
        list: ts::List<ts::Type>,
    ) {
        self.jsx_type_arguments.push(JsxTypeArguments {
            element: offset(element),
            lt: offset(less_than),
            end,
            list,
        });
    }

    /// Records the modifier at `keyword` of the class or of the enum at `owner`.
    #[cold]
    pub fn keyword(&mut self, owner: Loc, keyword: Range, kind: ts::ModifierKind) {
        self.keywords.push(Keyword {
            owner: offset(owner),
            start: offset(keyword.loc),
            end: offset(keyword.end()),
            kind,
        });
    }

    /// Records a name with `type` of the clause that the parser reads: the tree has `index` names of the clause before it.
    #[cold]
    pub fn type_only_specifier(&mut self, index: usize, specifier: Specifier) {
        self.specifiers.push(TypeOnlySpecifier {
            statement: UNPLACED,
            index: offset_of(index),
            specifier,
        });
    }

    /// The names with `type` of the clause that the parser just read are those of the statement at `statement`.
    #[cold]
    pub fn specifiers_belong_to(&mut self, statement: Loc) {
        let statement = offset(statement);
        for record in self.specifiers.iter_mut().rev() {
            if record.statement != UNPLACED {
                break;
            }
            record.statement = statement;
        }
    }

    /// The record of the binding or the member name at `owner`: the last one when it is of that owner, else a new one.
    fn annotation_at(&mut self, owner: Loc) -> Option<&mut Annotation> {
        let owner = offset(owner);
        let is_last = self
            .annotations
            .last()
            .is_some_and(|record| record.owner == owner);
        if !is_last {
            self.annotations.push(Annotation {
                owner,
                question: None,
                exclamation: None,
                type_node: None,
            });
        }
        self.annotations.last_mut()
    }
}

/// What a site of a lint parse calls where a parse without lint skips a type: the type is built and recorded.
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// The lexer is after the `:` that follows the binding or the member name at `owner`: reads the type and records it.
    #[cold]
    #[inline(never)]
    pub fn lint_type_annotation(&mut self, owner: Loc) -> Result<(), Error> {
        let type_node = self.build_type_script_type(Level::Lowest)?;
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.attached.annotation(owner, type_node);
        }
        Ok(())
    }

    /// The lexer is on the `this` that starts a parameter of `owner`, after `index` arguments: reads it with its type and records it.
    #[cold]
    #[inline(never)]
    pub fn lint_this_parameter(&mut self, owner: Owner, index: usize) -> Result<(), Error> {
        let this = self.lexer.range();
        self.lexer.next()?;
        let mut type_node = None;
        if self.lexer.token == T::TColon {
            self.lexer.next()?;
            type_node = Some(self.build_type_script_type(Level::Lowest)?);
        }
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts
                .attached
                .this_parameter(owner, index, this, type_node);
        }
        Ok(())
    }

    /// Reads type parameters, if `<` starts them here, and records them. `None`: they are of the function whose `(` follows them.
    #[cold]
    #[inline(never)]
    pub fn lint_type_parameters(&mut self, owner: Option<Owner>) -> Result<bool, Error> {
        let less_than = self.lexer.loc();
        let Some((list, end)) = self.build_type_script_type_parameters()? else {
            return Ok(false);
        };
        let owner = match owner {
            Some(owner) => owner,
            None => Owner::function(self.lexer.loc()),
        };
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts
                .attached
                .type_parameter_list(owner, less_than, end, list);
        }
        Ok(true)
    }

    /// The lexer is after the `:` that follows the parameters of `owner`: reads the return type or the type predicate and records it.
    #[cold]
    #[inline(never)]
    pub fn lint_return_type(&mut self, owner: Owner) -> Result<(), Error> {
        let type_node = self.build_typescript_return_type()?;
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.attached.return_type(owner, type_node);
        }
        Ok(())
    }

    /// The lexer is on the `extends` of the class whose keyword is at `class_keyword`: reads the expression with its type arguments and records the clause.
    #[cold]
    #[inline(never)]
    pub fn lint_class_extends(&mut self, class_keyword: Loc) -> Result<Expr, Error> {
        let keyword = offset_of(self.lexer.start);
        self.lexer.next()?;
        let start = offset_of(self.lexer.start);
        let expression = self.parse_expr(Level::New)?;
        let next = offset_of(self.lexer.start);
        let mut end = ts::full_start(self.lexer.contents, &self.lexer.all_comments, next);
        let mut type_arguments = None;
        if let Some((list, close_end)) = self.build_type_script_type_arguments::<false, false>()? {
            type_arguments = Some(list);
            end = close_end;
        }
        let payload = ts::ExpressionWithTypeArguments {
            expression,
            type_arguments,
        };
        let entry = ts::Type::alloc(self.arena, payload, start, end);
        let clause = ts::HeritageClause {
            start: keyword,
            end,
            token: ts::HeritageToken::Extends,
            types: ts::List::from_slice(self.arena, &[entry], start, end),
        };
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.attached.heritage_clause(class_keyword, clause);
        }
        Ok(expression)
    }

    /// Reads the type arguments after the name of the JSX element at `element`, if `<` starts them here, and records them.
    #[cold]
    #[inline(never)]
    pub fn lint_jsx_type_arguments(&mut self, element: Loc) -> Result<(), Error> {
        let less_than = self.lexer.loc();
        let Some((list, end)) = self.build_type_script_type_arguments::<true, false>()? else {
            return Ok(());
        };
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts
                .attached
                .jsx_type_argument_list(element, less_than, end, list);
        }
        Ok(())
    }
}

/// The `?` or the `!` at `start`, as the token that TypeScript keeps.
fn token(start: u32, kind: ts::TokenKind) -> ts::Token {
    ts::Token {
        start,
        end: start.saturating_add(1),
        kind,
    }
}

/// The offset that `loc` holds: one past every source for a `Loc` that holds none.
fn offset(loc: Loc) -> u32 {
    u32::try_from(loc.start).unwrap_or(u32::MAX)
}

fn offset_of(at: usize) -> u32 {
    u32::try_from(at).unwrap_or(u32::MAX)
}

#[cfg(test)]
mod tests {
    use core::mem::MaybeUninit;

    use super::*;
    use crate::defines::Define;
    use crate::parse::parse_entry::{Options, Parser};
    use bun_alloc::Arena;

    fn any(start: u32, end: u32) -> ts::Type {
        ts::Type::keyword(ts::KeywordKind::Any, start, end)
    }

    fn range(start: i32, len: i32) -> Range {
        Range {
            loc: Loc { start },
            len,
        }
    }

    fn clause(token: ts::HeritageToken, start: u32, end: u32) -> ts::HeritageClause {
        ts::HeritageClause {
            start,
            end,
            token,
            types: ts::List::empty(start, end),
        }
    }

    /// `type name`, with `type` at `start`.
    fn specifier(name: &'static [u8], start: u32) -> Specifier {
        let name_start = start + 5;
        let end = name_start + name.len() as u32;
        Specifier {
            start,
            end,
            type_keyword: Some(start),
            property_name: None,
            name: ModuleExportName::Identifier(ts::Name::new(name, name_start, end)),
        }
    }

    /// The kind of `type_node` and its range.
    fn described(type_node: ts::Type) -> (&'static str, u32, u32) {
        (type_node.data.kind_name(), type_node.start, type_node.end)
    }

    #[test]
    fn records_at_one_offset_are_told_apart_by_their_owner() {
        let at = Loc { start: 9 };
        let mut attached = Attached::default();
        attached.return_type(Owner::arrow(at), any(20, 23));
        attached.return_type(Owner::function(at), any(30, 33));
        attached.type_parameter_list(
            Owner::class(at),
            Loc { start: 10 },
            13,
            ts::List::empty(11, 11),
        );
        attached.type_parameter_list(
            Owner::function(at),
            Loc { start: 40 },
            43,
            ts::List::empty(41, 41),
        );
        attached.this_parameter(Owner::function(at), 1, range(50, 4), Some(any(56, 59)));
        attached.sort();

        let return_type = |owner: Owner| {
            attached
                .return_type_of(owner)
                .map(|record| record.type_node.start)
        };
        assert_eq!(return_type(Owner::function(at)), Some(30));
        assert_eq!(return_type(Owner::arrow(at)), Some(20));
        assert_eq!(return_type(Owner::class(at)), None);
        assert_eq!(return_type(Owner::function(Loc { start: 8 })), None);

        let type_parameters = |owner: Owner| {
            attached
                .type_parameters_of(owner)
                .map(|record| (record.lt, record.end))
        };
        assert_eq!(type_parameters(Owner::function(at)), Some((40, 43)));
        assert_eq!(type_parameters(Owner::class(at)), Some((10, 13)));
        assert_eq!(type_parameters(Owner::arrow(at)), None);

        let this_parameter = |owner: Owner| {
            attached
                .this_parameter_of(owner)
                .map(|record| (record.index, record.start, record.end))
        };
        assert_eq!(this_parameter(Owner::function(at)), Some((1, 50, 54)));
        assert_eq!(this_parameter(Owner::arrow(at)), None);
    }

    #[test]
    fn the_parts_of_an_annotation_make_one_record() {
        let (optional, definite, bare) = (Loc { start: 30 }, Loc { start: 4 }, Loc { start: 50 });
        let mut attached = Attached::default();
        attached.optional(optional, Loc { start: 31 });
        attached.annotation(optional, any(33, 36));
        attached.definite(definite, Loc { start: 5 });
        attached.annotation(definite, any(7, 10));
        attached.optional(bare, Loc { start: 51 });
        assert_eq!(attached.annotations.len(), 3);
        attached.sort();

        let owners: Vec<u32> = attached
            .annotations
            .iter()
            .map(|record| record.owner)
            .collect();
        assert_eq!(owners, [4, 30, 50]);

        let parts = |owner: Loc| {
            attached.annotation_of(owner).map(|record| {
                let type_node = record.type_node.map(|node| (node.start, node.end));
                (record.question, record.exclamation, type_node)
            })
        };
        assert_eq!(parts(optional), Some((Some(31), None, Some((33, 36)))));
        assert_eq!(parts(definite), Some((None, Some(5), Some((7, 10)))));
        assert_eq!(parts(bare), Some((Some(51), None, None)));
        assert_eq!(parts(Loc { start: 31 }), None);

        let of = |token: ts::Token| (token.start, token.end, token.kind);
        let tokens = |owner: Loc| {
            attached.annotation_of(owner).map(|record| {
                let question = record.question_token().map(of);
                let exclamation = record.exclamation_token().map(of);
                (question, exclamation)
            })
        };
        let question = (31, 32, ts::TokenKind::Question);
        let exclamation = (5, 6, ts::TokenKind::Exclamation);
        assert_eq!(tokens(optional), Some((Some(question), None)));
        assert_eq!(tokens(definite), Some((None, Some(exclamation))));
    }

    #[test]
    fn clauses_keywords_and_names_are_found_in_the_order_of_the_source() {
        let (outer, inner) = (Loc { start: 0 }, Loc { start: 17 });
        let mut attached = Attached::default();
        attached.heritage_clause(inner, clause(ts::HeritageToken::Implements, 25, 37));
        attached.heritage_clause(outer, clause(ts::HeritageToken::Extends, 8, 41));
        attached.heritage_clause(outer, clause(ts::HeritageToken::Implements, 42, 54));
        attached.keyword(Loc { start: 80 }, range(71, 8), ts::ModifierKind::Abstract);
        attached.keyword(Loc { start: 65 }, range(54, 5), ts::ModifierKind::Const);
        attached.type_only_specifier(0, specifier(b"A", 109));
        attached.type_only_specifier(1, specifier(b"C", 120));
        attached.specifiers_belong_to(Loc { start: 100 });
        attached.type_only_specifier(0, specifier(b"D", 99));
        attached.specifiers_belong_to(Loc { start: 90 });
        attached.type_only_specifier(2, specifier(b"E", 140));
        attached.sort();

        let clauses = |class_keyword: Loc| -> Vec<(ts::HeritageToken, u32, u32)> {
            attached
                .heritage_of(class_keyword)
                .iter()
                .map(|record| (record.clause.token, record.clause.start, record.clause.end))
                .collect()
        };
        let extends = (ts::HeritageToken::Extends, 8, 41);
        let implements = (ts::HeritageToken::Implements, 42, 54);
        assert_eq!(clauses(outer), [extends, implements]);
        assert_eq!(clauses(inner), [(ts::HeritageToken::Implements, 25, 37)]);
        assert!(clauses(Loc { start: 8 }).is_empty());

        let keywords = |owner: Loc| -> Vec<(ts::ModifierKind, u32, u32)> {
            attached
                .keywords_of(owner)
                .iter()
                .map(|record| (record.kind, record.start, record.end))
                .collect()
        };
        let abstract_keyword = (ts::ModifierKind::Abstract, 71, 79);
        let const_keyword = (ts::ModifierKind::Const, 54, 59);
        assert_eq!(keywords(Loc { start: 80 }), [abstract_keyword]);
        assert_eq!(keywords(Loc { start: 65 }), [const_keyword]);
        assert!(keywords(Loc { start: 71 }).is_empty());

        let names = |statement: Loc| -> Vec<(u32, u32, Option<u32>)> {
            attached
                .specifiers_of(statement)
                .iter()
                .map(|record| {
                    let specifier = record.specifier;
                    (record.index, specifier.end, specifier.type_keyword)
                })
                .collect()
        };
        let of_first = [(0, 115, Some(109)), (1, 126, Some(120))];
        assert_eq!(names(Loc { start: 100 }), of_first);
        assert_eq!(names(Loc { start: 90 }), [(0, 105, Some(99))]);
        assert!(names(Loc { start: 140 }).is_empty());
        let unplaced: Vec<u32> = attached
            .specifiers
            .iter()
            .filter(|record| record.statement == UNPLACED)
            .map(|record| record.specifier.start)
            .collect();
        assert_eq!(unplaced, [140]);
    }

    #[test]
    fn rewind_drops_the_records_since_the_mark() {
        let function = Owner::function(Loc { start: 20 });
        let mut attached = Attached::default();
        attached.annotation(Loc { start: 1 }, any(3, 6));
        attached.return_type(function, any(8, 11));
        let mark = attached.mark();
        assert_eq!(attached.record_count(), 2);

        attached.optional(Loc { start: 12 }, Loc { start: 13 });
        attached.this_parameter(function, 0, range(21, 4), None);
        attached.type_parameter_list(function, Loc { start: 17 }, 20, ts::List::empty(18, 18));
        attached.return_type(Owner::arrow(Loc { start: 30 }), any(36, 39));
        attached.heritage_clause(
            Loc { start: 40 },
            clause(ts::HeritageToken::Extends, 48, 57),
        );
        attached.jsx_type_argument_list(
            Loc { start: 60 },
            Loc { start: 64 },
            67,
            ts::List::empty(65, 65),
        );
        attached.keyword(Loc { start: 79 }, range(70, 8), ts::ModifierKind::Abstract);
        attached.type_only_specifier(0, specifier(b"A", 90));
        assert_eq!(attached.record_count(), 10);

        attached.rewind(mark);
        assert_eq!(attached.record_count(), 2);
        let kept = (attached.annotations.len(), attached.return_types.len());
        assert_eq!(kept, (1, 1));
        attached.sort();
        assert!(attached.jsx_type_arguments_of(Loc { start: 60 }).is_none());
        assert!(attached.return_type_of(function).is_some());
    }

    /// What `read` returns for a TypeScript parser that holds the side table of a lint parse and whose lexer read past `skipped` tokens of `text`.
    fn with_parser<R>(
        text: &'static [u8],
        skipped: usize,
        read: impl FnOnce(&mut P<'_, true, false>) -> Option<R>,
    ) -> Option<R> {
        let path: &'static [u8] = b"/a.ts";
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = bun_ast::Source::init_path_string(path, text);
        let mut options = Options::init(Default::default(), bun_ast::Loader::Ts);
        options.features.no_macros = true;
        options.features.dont_bundle_twice = true;
        let define = Define::default();
        let mut log = bun_ast::Log::init();
        let parser = Parser::init(options, &mut log, &source, &define, &arena).ok()?;
        let mut slot = MaybeUninit::<P<'_, true, false>>::uninit();
        P::init(
            &mut slot,
            parser.bump,
            parser.log,
            parser.source,
            parser.define,
            parser.lexer,
            parser.options,
        )
        .ok()?;
        // SAFETY: `init` returned `Ok`, so the slot holds a parser.
        let p = unsafe { slot.assume_init_mut() };
        p.starts_for_parse_only = Some(Box::default());
        let mut found = None;
        if (0..skipped).all(|_| p.lexer.next().is_ok()) {
            found = read(p);
        }
        // SAFETY: the slot holds the parser that `init` made, and nothing reads it after this.
        unsafe { slot.assume_init_drop() };
        found
    }

    /// The lists of the side table that `p` holds.
    fn lists<'p>(p: &'p P<'_, true, false>) -> Option<&'p Attached> {
        let starts = p.starts_for_parse_only.as_deref()?;
        Some(&starts.attached)
    }

    #[test]
    fn a_type_annotation_is_read_and_recorded_for_its_binding() {
        let found = with_parser(b"let x: number = 1;", 3, |p| {
            p.lint_type_annotation(Loc { start: 4 }).ok()?;
            let records: Vec<_> = lists(p)?
                .annotations
                .iter()
                .map(|record| {
                    let type_node = record.type_node.map(described);
                    (record.owner, record.question, record.exclamation, type_node)
                })
                .collect();
            Some((records, p.lexer.token))
        });
        let number = Some(("NumberKeyword", 7, 13));
        let expected = vec![(4, None, None, number)];
        assert_eq!(found, Some((expected, T::TEquals)));
    }

    #[test]
    fn a_type_predicate_is_read_and_recorded_for_its_function() {
        let owner = Owner::function(Loc { start: 10 });
        let found = with_parser(b"function f(x): x is string {}", 6, |p| {
            p.lint_return_type(owner).ok()?;
            let records: Vec<_> = lists(p)?
                .return_types
                .iter()
                .map(|record| (record.owner, described(record.type_node)))
                .collect();
            Some((records, p.lexer.token))
        });
        let expected = vec![(Owner::Fn(10), ("TypePredicate", 15, 26))];
        assert_eq!(found, Some((expected, T::TOpenBrace)));
    }

    /// Whether type parameters start at the third token of `text`, the records of all that were read, and the token after them.
    fn read_type_parameters(
        text: &'static [u8],
        owner: Option<Owner>,
    ) -> Option<(bool, Vec<(Owner, u32, u32, usize)>, T)> {
        with_parser(text, 2, |p| {
            let was_read = p.lint_type_parameters(owner).ok()?;
            let records: Vec<(Owner, u32, u32, usize)> = lists(p)?
                .type_parameters
                .iter()
                .map(|record| (record.owner, record.lt, record.end, record.list.len()))
                .collect();
            Some((was_read, records, p.lexer.token))
        })
    }

    #[test]
    fn type_parameters_are_read_and_recorded_for_their_owner() {
        let of_function = read_type_parameters(b"function f<T, U extends T>(a) {}", None);
        let expected = vec![(Owner::Fn(26), 10, 26, 2)];
        assert_eq!(of_function, Some((true, expected, T::TOpenParen)));

        let class = Owner::class(Loc { start: 0 });
        let of_class = read_type_parameters(b"class C<T> {}", Some(class));
        let expected = vec![(Owner::Class(0), 7, 10, 1)];
        assert_eq!(of_class, Some((true, expected, T::TOpenBrace)));

        let none = read_type_parameters(b"function f(a) {}", None);
        assert_eq!(none, Some((false, Vec::new(), T::TOpenParen)));
    }

    #[test]
    fn a_this_parameter_is_read_and_recorded_for_its_function() {
        let owner = Owner::function(Loc { start: 10 });
        let found = with_parser(b"function f(this: Window, a) {}", 3, |p| {
            p.lint_this_parameter(owner, 0).ok()?;
            let records: Vec<_> = lists(p)?
                .this_parameters
                .iter()
                .map(|record| {
                    let type_node = record.type_node.map(described);
                    let range = (record.start, record.end);
                    (record.owner, record.index, range, type_node)
                })
                .collect();
            Some((records, p.lexer.token))
        });
        let window = Some(("TypeReference", 17, 23));
        let expected = vec![(Owner::Fn(10), 0, (11, 15), window)];
        assert_eq!(found, Some((expected, T::TComma)));
    }

    #[test]
    fn the_extends_clause_is_read_and_recorded_for_its_class() {
        let found = with_parser(b"class A extends B<T> {}", 2, |p| {
            let expression = p.lint_class_extends(Loc { start: 0 }).ok()?;
            let [record] = lists(p)?.heritage.as_slice() else {
                return None;
            };
            let clause = record.clause;
            let [entry] = &*clause.types else {
                return None;
            };
            let ts::TypeData::ExpressionWithTypeArguments(payload) = entry.data else {
                return None;
            };
            let type_arguments = payload.type_arguments.map(|list| list.len());
            let expressions = (expression.loc.start, payload.expression.loc.start);
            Some((
                (record.class, clause.token, clause.start, clause.end),
                (clause.types.start, clause.types.end, described(*entry)),
                (expressions, type_arguments),
                p.lexer.token,
            ))
        });
        let expected = (
            (0, ts::HeritageToken::Extends, 8, 20),
            (16, 20, ("ExpressionWithTypeArguments", 16, 20)),
            ((16, 16), Some(1)),
            T::TOpenBrace,
        );
        assert_eq!(found, Some(expected));
    }

    #[test]
    fn the_type_arguments_of_a_jsx_element_are_read_and_recorded() {
        let found = with_parser(b"<Foo<string> />;", 2, |p| {
            p.lint_jsx_type_arguments(Loc { start: 0 }).ok()?;
            let records: Vec<_> = lists(p)?
                .jsx_type_arguments
                .iter()
                .map(|record| (record.element, record.lt, record.end, record.list.len()))
                .collect();
            Some(records)
        });
        assert_eq!(found, Some(vec![(0, 4, 12, 1)]));
    }
}
