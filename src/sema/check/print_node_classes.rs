//! printer.go: classes, their heritage clauses and their members, for `NodePrinter`.

use super::print::OperatorPrecedence as P;
use super::print_node::{Child, Emitted, NodePrinter, Stop, lf};
use super::spans::token_end;
use super::*;
use crate::atom::known;
use crate::util::SharedSort;

/// An `ExpressionWithTypeArguments` of a heritage clause of a class.
#[derive(Copy, Clone)]
enum HeritageElement {
    /// `Class::extends` with `Class::extends_args`.
    Base,
    /// One of `Class::other_extends`.
    Expression(ExprId),
    /// One of `Class::implements` or of `Class::other_implements`.
    Type(TypeNodeId),
}

/// A `HeritageClause`: its `Pos()` and `End()`, and where its keyword starts.
struct HeritageClause {
    pos: usize,
    end: usize,
    keyword: usize,
    is_extends: bool,
    elements: Vec<(HeritageElement, Child)>,
}

/// What is between the name of a class, or its type parameters, and its members.
struct Heritage {
    clauses: Vec<HeritageClause>,
    /// `End()` of the last token before the `{` of the class, or of the class that has none.
    end: usize,
    /// Where the `{` of the class ends.
    open_end: Option<usize>,
}

/// A `ClassElement`: a member, or a `SemicolonClassElement`.
#[derive(Copy, Clone)]
enum ClassElement {
    Member(MemberId),
    Semicolon,
}

impl NodePrinter<'_, '_, '_> {
    /// `emitClassExpression` for the expression `e`, which is the class `class`. `pos`: `Pos()` of `e`.
    #[optimize(size)]
    pub(super) fn emit_class_expression(
        &mut self,
        e: ExprId,
        class: ClassId,
        pos: usize,
    ) -> Emitted {
        self.emit_class(class, (pos, self.hir[e].end as usize))
    }

    /// `emitClassDeclaration` for the statement `s`, which is the class `class`.
    #[optimize(size)]
    pub(super) fn emit_class_declaration(&mut self, s: StmtId, class: ClassId) -> Emitted {
        let pos = self.hir.stmts.get(s.idx()).map_or(0, |it| it.loc.pos);
        self.emit_class(class, (pos as usize, self.end_of_statement(s)))
    }

    /// `emitClassDeclaration`, `emitClassExpression` for the class `c`. `node`: its `Pos()` and `End()`.
    #[optimize(size)]
    fn emit_class(&mut self, c: ClassId, node: (usize, usize)) -> Emitted {
        if self.c.is_stack_low_for_printing() {
            return Err(Stop::OutOfStack);
        }
        let hir = self.hir;
        // The parser has given up a class that is nested too deeply.
        let Some(class) = hir.classes.get(c.idx()) else {
            return Err(Stop::OutOfStack);
        };
        let state = self.enter_node(node.0, node.1);
        let modifiers_end = self.emit_modifier_list(node, class.modifiers, true)?;
        self.emit_token(b"class", modifiers_end, node);
        // Where the tokens of the source end.
        let keyword = self.skip_trivia(modifiers_end);
        let keyword_end = self.token_end_at(b"class", keyword);
        let mut at = keyword_end.unwrap_or(keyword + b"class".len());
        if class.name.is_some() {
            self.write_space();
            at = self.emit_identifier(class.name, class.name_pos as usize);
        }
        self.emit_type_parameters(node, class.type_params, false)?;
        if let Some(last) = class.type_params.iter().next_back() {
            let end = self.c.end_of_type_param(self.file, last) as usize;
            at = self.token_after(b">", end).unwrap_or(end).max(at);
        }
        let heritage = self.heritage_of_class(c, at, node.1);
        self.emit_class_heritage_clauses(node, c, &heritage.clauses)?;
        self.write_space();
        self.write(b"{");
        // A list that is missing is where the token before it ends, and has no element.
        let elements = match heritage.open_end {
            Some(open_end) => self.class_elements(c, open_end, node.1),
            None => Vec::new(),
        };
        let children: Vec<Child> = elements.iter().map(|it| it.1).collect();
        let last = children.last().map(|it| it.end);
        let list = match heritage.open_end {
            Some(open_end) => self.list_range(open_end, b'}', last, node.1),
            None => (heritage.end, heritage.end),
        };
        let format = lf::CLASS_MEMBERS;
        self.emit_list(node, Some(list), &children, format, |printer, index| {
            match elements[index].0 {
                ClassElement::Member(m) => printer.emit_class_element(m),
                ClassElement::Semicolon => {
                    // `emitSemicolonClassElement`
                    let child = children[index];
                    let state = printer.enter_node(child.pos, child.end);
                    printer.write(b";");
                    printer.exit_node(state);
                    Ok(())
                }
            }
        })?;
        self.write(b"}");
        self.exit_node(state);
        Ok(())
    }

    // ───────────────────────────── heritage clauses ─────────────────────────────

    /// The heritage elements of `c` in source order: the start of the first token of each, and its `Pos()` and `End()`.
    #[optimize(size)]
    fn class_heritage_elements(&self, c: ClassId) -> Vec<(HeritageElement, usize, Child)> {
        let hir = self.hir;
        let class = &hir[c];
        let mut elements = Vec::new();
        let range_of = |e: ExprId| Child {
            pos: self.pos_of(e),
            end: self.end_of(e),
        };
        if class.extends.is_some() {
            let mut range = range_of(class.extends);
            // `End()` of the `ExpressionWithTypeArguments`: after its type arguments.
            range.end = (self.c.end_of_class_extends(self.file, c) as usize).max(range.end);
            let start = hir::start_of(hir, class.extends) as usize;
            elements.push((HeritageElement::Base, start, range));
        }
        for e in hir.ids(class.other_extends) {
            let e: ExprId = e;
            if hir.exprs.get(e.idx()).is_none() {
                continue;
            }
            let mut range = range_of(e);
            // The type arguments that the expression has not taken are in no list of the HIR.
            let arguments_end = self.end_of_type_arguments_in_no_list(range.end);
            range.end = arguments_end.unwrap_or(range.end);
            let start = hir::start_of(hir, e) as usize;
            elements.push((HeritageElement::Expression(e), start, range));
        }
        let implemented = hir.ids(class.implements);
        for ty in implemented.chain(hir.ids(class.other_implements)) {
            let ty: TypeNodeId = ty;
            let Some(node) = hir.types.get(ty.idx()) else {
                continue;
            };
            let range = Child {
                pos: self.pos_before(node.pos as usize),
                end: node.end as usize,
            };
            elements.push((HeritageElement::Type(ty), node.pos as usize, range));
        }
        elements.shared_sort_by_key(|it| it.1);
        elements
    }

    /// Whether the token at `start` is one byte long: not an operator that starts with it.
    #[optimize(size)]
    fn is_token_of_one_byte(&self, start: usize) -> bool {
        self.c.end_of_token_at(self.file, start as u32) as usize == start + 1
    }

    /// Whether the token at `start` is `<`, and not an operator that starts with it.
    #[optimize(size)]
    fn is_less_than_at(&self, start: usize) -> bool {
        self.byte(start) == b'<' && self.is_token_of_one_byte(start)
    }

    /// `parseTypeArguments` at `after` for a list that the HIR does not keep: where it ends, if it has its `>`.
    #[optimize(size)]
    fn end_of_type_arguments_in_no_list(&self, after: usize) -> Option<usize> {
        let open = self.skip_trivia(after);
        if !self.is_less_than_at(open) {
            return None;
        }
        let (mut at, mut depth) = (open, 0u32);
        loop {
            at = self.skip_trivia(at);
            match self.byte(at) {
                b'<' => {
                    depth += 1;
                    at += 1;
                }
                b'>' => {
                    depth -= 1;
                    at += 1;
                    if depth == 0 {
                        return Some(at);
                    }
                }
                b'(' | b'[' | b'{' => {
                    let end = self.c.end_of_bracket_at(self.file, at as u32) as usize;
                    if end <= at {
                        return None;
                    }
                    at = end;
                }
                0 | b')' | b']' | b'}' | b';' | b'`' => return None,
                _ => {
                    let end = self.c.end_of_token_at(self.file, at as u32) as usize;
                    at = end.max(at + 1);
                }
            }
        }
    }

    /// `parseHeritageClauses` at `after`: the clauses, from the keywords of the source and the elements of the HIR.
    #[optimize(size)]
    fn heritage_of_class(&self, c: ClassId, after: usize, node_end: usize) -> Heritage {
        let elements = self.class_heritage_elements(c);
        let mut elements = elements.into_iter().peekable();
        let mut clauses: Vec<HeritageClause> = Vec::new();
        // The end of the token before `token`.
        let mut before = after;
        let mut token = self.skip_trivia(before);
        let mut open_end = None;
        while token < node_end {
            if let Some(&(element, start, range)) = elements.peek()
                && start <= token
            {
                elements.next();
                if let Some(clause) = clauses.last_mut() {
                    clause.elements.push((element, range));
                }
                if range.end > token {
                    before = range.end;
                    token = self.skip_trivia(before);
                }
                continue;
            }
            if self.byte(token) == b'{' {
                open_end = Some(token + 1);
                break;
            }
            // A clause ends where the next one starts: after the tokens that the parser skipped.
            let is_extends = self.token_end_at(b"extends", token).is_some();
            if is_extends || self.token_end_at(b"implements", token).is_some() {
                if let Some(clause) = clauses.last_mut() {
                    clause.end = before;
                }
                clauses.push(HeritageClause {
                    pos: before,
                    end: before,
                    keyword: token,
                    is_extends,
                    elements: Vec::new(),
                });
            }
            before = (self.c.end_of_token_at(self.file, token as u32) as usize).max(token + 1);
            token = self.skip_trivia(before);
        }
        if let Some(clause) = clauses.last_mut() {
            clause.end = before;
        }
        Heritage {
            clauses,
            end: before,
            open_end,
        }
    }

    /// `emitList(emitHeritageClauseNode, node, node.HeritageClauses, LFClassHeritageClauses)` for the class at `node`.
    #[optimize(size)]
    fn emit_class_heritage_clauses(
        &mut self,
        node: (usize, usize),
        c: ClassId,
        clauses: &[HeritageClause],
    ) -> Emitted {
        let children: Vec<Child> = clauses
            .iter()
            .map(|it| Child {
                pos: it.pos,
                end: it.end,
            })
            .collect();
        // A class without a clause has no list.
        let (Some(first), Some(last)) = (children.first(), children.last()) else {
            return Ok(());
        };
        let list = Some((first.pos, last.end));
        let format = lf::CLASS_HERITAGE_CLAUSES;
        self.emit_list(node, list, &children, format, |printer, index| {
            printer.emit_class_heritage_clause(c, &clauses[index])
        })
    }

    /// `emitHeritageClause`
    #[optimize(size)]
    fn emit_class_heritage_clause(&mut self, c: ClassId, clause: &HeritageClause) -> Emitted {
        let node = (clause.pos, clause.end);
        let state = self.enter_node(node.0, node.1);
        self.write_space();
        let keyword: &[u8] = match clause.is_extends {
            true => b"extends",
            false => b"implements",
        };
        self.emit_token(keyword, node.0, node);
        self.write_space();
        let children: Vec<Child> = clause.elements.iter().map(|it| it.1).collect();
        // The list starts after the keyword, and ends where the clause does.
        let keyword_end = self.token_end_at(keyword, clause.keyword);
        let keyword_end = keyword_end.unwrap_or(clause.keyword + keyword.len());
        let list = Some((keyword_end.min(node.1), node.1));
        let format = lf::HERITAGE_CLAUSE_TYPES;
        self.emit_list(node, list, &children, format, |printer, index| {
            let (element, range) = clause.elements[index];
            printer.emit_class_heritage_element(c, element, range)
        })?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitExpressionWithTypeArguments` for an element of a heritage clause of `c`. `range`: its `Pos()` and `End()`.
    #[optimize(size)]
    fn emit_class_heritage_element(
        &mut self,
        c: ClassId,
        element: HeritageElement,
        range: Child,
    ) -> Emitted {
        let class = &self.hir[c];
        match element {
            HeritageElement::Base => {
                let node = (range.pos, range.end);
                let state = self.enter_node(node.0, node.1);
                self.emit_expression(class.extends, P::Member)?;
                let expression_end = self.end_of(class.extends);
                self.emit_type_arguments(node, class.extends_args, expression_end)?;
                self.exit_node(state);
                Ok(())
            }
            HeritageElement::Expression(e) => {
                let node = (range.pos, range.end);
                let state = self.enter_node(node.0, node.1);
                self.emit_expression(e, P::Member)?;
                // The type arguments, which the HIR does not keep.
                self.emit_type_arguments_of_source(node, self.end_of(e))?;
                self.exit_node(state);
                Ok(())
            }
            HeritageElement::Type(ty) => self.emit_heritage_type(ty),
        }
    }

    /// `Pos()` and `End()` of a name of the entity name of an element of a heritage clause.
    #[optimize(size)]
    fn range_of_heritage_name(&self, name: NameId) -> Child {
        let name = &self.hir[name];
        let pos = self.pos_before(name.pos() as usize);
        let end = self
            .c
            .end_of_identifier_at(self.file, name.text, name.pos());
        Child {
            pos,
            end: (end as usize).max(pos),
        }
    }

    /// The end of the `.` that follows `pos`, if that token is there.
    #[optimize(size)]
    fn end_of_dot_after(&self, pos: usize) -> Option<usize> {
        let start = self.skip_trivia(pos);
        let is_dot = self.byte(start) == b'.' && token_end(self.text, start, false) == start + 1;
        is_dot.then_some(start + 1)
    }

    /// `emitExpressionWithTypeArguments` for an element that is a type in the HIR. A `Ref` is emitted as an expression.
    #[optimize(size)]
    pub(super) fn emit_heritage_type(&mut self, ty: TypeNodeId) -> Emitted {
        let hir = self.hir;
        let Some(node) = hir.types.get(ty.idx()) else {
            return Err(Stop::OutOfStack);
        };
        let TypeNodeKind::Ref { name, args } = node.kind else {
            // An expression that is no entity name: `TypeNodeKind::Heritage`.
            return self.emit_type_node(ty);
        };
        let (pos, end) = (self.pos_before(node.pos as usize), node.end as usize);
        let state = self.enter_node(pos, end);
        let ranges: Vec<Child> = name
            .iter()
            .map(|name| self.range_of_heritage_name(name))
            .collect();
        let mut name_end = pos;
        if let Some((&first, rest)) = ranges.split_first() {
            // The token of each access: whether it is `?.`, and where it ends. A missing `.` is a token without text.
            let mut dots = Vec::with_capacity(rest.len());
            let mut object_end = first.end;
            for right in rest {
                let question_dot = self.token_after(b"?.", object_end);
                let dot_end = question_dot.or_else(|| self.end_of_dot_after(object_end));
                dots.push((question_dot.is_some(), dot_end.unwrap_or(object_end)));
                object_end = right.end;
            }
            // `emitExpression(node.Expression, OperatorPrecedenceMember)`: an optional chain has a lower precedence.
            let needs_parentheses = dots.iter().any(|dot| dot.0);
            if needs_parentheses {
                self.write(b"(");
            }
            // `emitPropertyAccessExpression`, from the outermost.
            let mut accesses = Vec::with_capacity(rest.len());
            for right in rest.iter().rev() {
                accesses.push(self.enter_node(first.pos, right.end));
            }
            // `emitIdentifierReference`
            self.emit_source(first.pos, first.end);
            name_end = first.end;
            for (right, &(is_question_dot, dot_end)) in rest.iter().zip(&dots) {
                let object_end = name_end;
                let lines_before_dot = self.is_on_next_line(object_end, object_end);
                if lines_before_dot {
                    self.write_line();
                }
                self.increase_indent_if(lines_before_dot);
                match is_question_dot {
                    true => self.emit_token_node(b"?.", object_end, dot_end),
                    false => _ = self.emit_token(b".", object_end, (first.pos, right.end)),
                }
                let lines_after_dot = self.is_on_next_line(dot_end, dot_end);
                if lines_after_dot {
                    self.write_line();
                }
                self.increase_indent_if(lines_after_dot);
                // `emitMemberName`
                self.emit_source(dot_end, right.end);
                self.decrease_indent_if(lines_after_dot);
                self.decrease_indent_if(lines_before_dot);
                if let Some(access) = accesses.pop() {
                    self.exit_node(access);
                }
                name_end = right.end;
            }
            if needs_parentheses {
                self.write(b")");
            }
        }
        self.emit_type_arguments((pos, end), args, name_end)?;
        self.exit_node(state);
        Ok(())
    }

    // ───────────────────────────── members ─────────────────────────────

    /// `node.Members` of `c`: the members of the HIR, and a `SemicolonClassElement` for each semicolon outside them.
    #[optimize(size)]
    fn class_elements(
        &self,
        c: ClassId,
        open_end: usize,
        node_end: usize,
    ) -> Vec<(ClassElement, Child)> {
        let hir = self.hir;
        let mut elements = Vec::new();
        let mut at = open_end;
        for m in hir[c].members.iter() {
            let member = &hir[m];
            self.semicolon_class_elements(at, member.start as usize, &mut elements);
            let range = Child {
                pos: member.loc.pos as usize,
                end: member.loc.end as usize,
            };
            elements.push((ClassElement::Member(m), range));
            at = at.max(range.end);
        }
        // The `}` of the class, if the class ends with it.
        let close = node_end.saturating_sub(1);
        let body_end = match close >= at && self.byte(close) == b'}' {
            true => close,
            false => node_end,
        };
        self.semicolon_class_elements(at, body_end, &mut elements);
        elements
    }

    /// `parseClassElement` at each semicolon between two members, from `from` to `to`. The parser skips other tokens.
    #[optimize(size)]
    fn semicolon_class_elements(
        &self,
        from: usize,
        to: usize,
        elements: &mut Vec<(ClassElement, Child)>,
    ) {
        let mut before = from;
        let mut token = self.skip_trivia(before);
        while token < to.min(self.text.len()) {
            let end = (self.c.end_of_token_at(self.file, token as u32) as usize).max(token + 1);
            if self.byte(token) == b';' {
                let range = Child { pos: before, end };
                elements.push((ClassElement::Semicolon, range));
            }
            before = end;
            token = self.skip_trivia(end);
        }
    }

    /// `emitPropertyName(node.Name())` for the member `m` of a class. Returns the end of the name.
    #[optimize(size)]
    fn emit_class_member_name(&mut self, m: MemberId) -> Result<usize, Stop> {
        let member = &self.hir[m];
        let start = member.name_pos as usize;
        // `""` has the key of a name that is missing.
        if member.key == PropKey::Name(known::empty) && matches!(self.byte(start), b'"' | b'\'') {
            let end = token_end(self.text, start, false);
            self.emit_source(self.pos_before(start), end);
            return Ok(end);
        }
        self.emit_name(member.key, NameKind::Identifier, start)
    }

    /// `emitClassElement` for the member `m` of a class.
    #[optimize(size)]
    fn emit_class_element(&mut self, m: MemberId) -> Emitted {
        if self.c.is_stack_low_for_printing() {
            return Err(Stop::OutOfStack);
        }
        let hir = self.hir;
        let member = &hir[m];
        let node = (member.loc.pos as usize, member.loc.end as usize);
        // A member that is no property has a signature.
        let function = hir.fns.get(member.func.idx());
        match (member.kind, function) {
            // `emitPropertyDeclaration`
            (MemberKind::Property, _) => {
                let state = self.enter_node(node.0, node.1);
                self.emit_modifier_list(node, member.modifiers, true)?;
                let mut at = self.emit_class_member_name(m)?;
                // `PostfixToken`
                let postfix: Option<&[u8]> = match () {
                    () if member.flags.contains(Flags::OPTIONAL) => Some(b"?"),
                    () if member.flags.contains(Flags::DEFINITE) => Some(b"!"),
                    () => None,
                };
                if let Some(token) = postfix {
                    let token_end = self.token_after(token, at).unwrap_or(at);
                    self.emit_token_node(token, at, token_end);
                    at = token_end;
                }
                self.emit_type_annotation(member.ty)?;
                at = self.end_of_type_annotation(member.ty, at);
                self.emit_initializer(member.init, at, node)?;
                self.write(b";");
                self.exit_node(state);
            }
            // `emitMethodDeclaration`
            (MemberKind::Method, Some(function)) => {
                let state = self.enter_node(node.0, node.1);
                let at = self.emit_modifier_list(node, member.modifiers, true)?;
                if function.flags.contains(Flags::GENERATOR) {
                    let asterisk_end = self.token_after(b"*", at).unwrap_or(at);
                    self.emit_token_node(b"*", at, asterisk_end);
                }
                let name_end = self.emit_class_member_name(m)?;
                // `PostfixToken`
                if member.flags.contains(Flags::OPTIONAL) {
                    let question_end = self.token_after(b"?", name_end).unwrap_or(name_end);
                    self.emit_token_node(b"?", name_end, question_end);
                }
                self.emit_signature(node, member.func)?;
                self.emit_function_body(member.func)?;
                self.exit_node(state);
            }
            // `emitClassStaticBlockDeclaration`: its modifiers, which are an error, are not emitted.
            (MemberKind::StaticBlock, Some(_)) => {
                let state = self.enter_node(node.0, node.1);
                self.write(b"static");
                self.emit_function_body(member.func)?;
                self.exit_node(state);
            }
            // `emitConstructor`
            (MemberKind::Constructor, Some(_)) => {
                let state = self.enter_node(node.0, node.1);
                self.emit_modifier_list(node, member.modifiers, false)?;
                self.write(b"constructor");
                self.emit_signature(node, member.func)?;
                self.emit_function_body(member.func)?;
                self.exit_node(state);
            }
            // `emitAccessorDeclaration`
            (MemberKind::Getter | MemberKind::Setter, Some(_)) => {
                let keyword: &[u8] = match member.kind {
                    MemberKind::Getter => b"get",
                    _ => b"set",
                };
                let state = self.enter_node(node.0, node.1);
                let at = self.emit_modifier_list(node, member.modifiers, true)?;
                self.emit_token(keyword, at, node);
                self.write_space();
                self.emit_class_member_name(m)?;
                self.emit_signature(node, member.func)?;
                self.emit_function_body(member.func)?;
                self.exit_node(state);
            }
            // `emitIndexSignature`
            (MemberKind::IndexSignature, Some(signature)) => {
                let state = self.enter_node(node.0, node.1);
                self.emit_modifier_list(node, member.modifiers, false)?;
                self.emit_parameters_for_index_signature(node, member.func)?;
                self.emit_type_annotation(signature.ret)?;
                self.write(b";");
                self.exit_node(state);
            }
            // A member of a type, which a class of the parser has not.
            _ => return self.emit_type_element(m),
        }
        Ok(())
    }
}
