//! printer.go: type nodes, type parameters, type arguments, and interface and type literal members, for `NodePrinter`.

use super::print::OperatorPrecedence as P;
use super::print_node::{Child, Emitted, NodePrinter, Stop, lf};
use super::spans::{line_break_len, template_text, token_end, unescaped_identifier};
use super::*;
use crate::atom::known;

/// `ast.TypePrecedence`
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum TypePrecedence {
    Conditional,
    JSDoc,
    Function,
    Union,
    Intersection,
    TypeOperator,
    Postfix,
    NonArray,
}

use TypePrecedence as TP;

/// The keywords that are a type by themselves.
const TYPE_KEYWORDS: [&[u8]; 15] = [
    b"any",
    b"unknown",
    b"number",
    b"bigint",
    b"object",
    b"boolean",
    b"string",
    b"symbol",
    b"void",
    b"undefined",
    b"never",
    b"null",
    b"true",
    b"false",
    b"this",
];

/// Start of the `//` comment that ends `line`. One can start after the `${` of a template, but not in its text.
#[optimize(size)]
fn line_comment_start(line: &[u8]) -> Option<usize> {
    // For each substitution that is open, the braces that are open in it.
    let mut substitutions: Vec<u32> = Vec::new();
    let template = |substitutions: &mut Vec<u32>, at: usize| {
        let (end, is_substitution) = template_text(line, at);
        if is_substitution {
            substitutions.push(0);
        }
        end
    };
    let mut at = 0;
    while let Some(&c) = line.get(at) {
        match c {
            b'"' | b'\'' => {
                at += 1;
                while let Some(&s) = line.get(at) {
                    at += 1;
                    if s == b'\\' {
                        at += 1;
                    } else if s == c {
                        break;
                    }
                }
            }
            b'`' => at = template(&mut substitutions, at + 1),
            b'{' => {
                if let Some(braces) = substitutions.last_mut() {
                    *braces += 1;
                }
                at += 1;
            }
            b'}' => match substitutions.last_mut() {
                Some(0) => {
                    substitutions.pop();
                    at = template(&mut substitutions, at + 1);
                }
                Some(braces) => {
                    *braces -= 1;
                    at += 1;
                }
                None => at += 1,
            },
            b'/' if line.get(at + 1) == Some(&b'/') => return Some(at),
            b'/' if line.get(at + 1) == Some(&b'*') => {
                at = bun_core::strings::index_of(&line[at + 2..], b"*/").map(|end| at + end + 4)?;
            }
            _ => at += 1,
        }
    }
    None
}

impl NodePrinter<'_, '_, '_> {
    /// `emitTypeNodeOutsideExtends(node)`
    #[optimize(size)]
    pub(super) fn emit_type_node(&mut self, ty: TypeNodeId) -> Emitted {
        self.emit_type(ty, 0, TP::Conditional, false)
    }

    /// `emitTypeArguments(parentNode, nodes)` for a list after `before`. Returns its end, or `before` if there is none.
    #[optimize(size)]
    pub(super) fn emit_type_arguments(
        &mut self,
        parent: (usize, usize),
        type_args: IdList<TypeNodeId>,
        before: usize,
    ) -> Result<usize, Stop> {
        let hir = self.hir;
        let open = self.token_after(b"<", before);
        if type_args.is_empty() {
            // `LFOptionalIfEmpty`: the list of `f<>` is not written.
            let close = open.and_then(|open| self.token_after(b">", open));
            return Ok(close.unwrap_or(before));
        }
        let open = open.unwrap_or(before);
        let mut children = Vec::with_capacity(type_args.len());
        let mut floor = open;
        for ty in hir.ids(type_args) {
            let child = self.type_range(ty, floor);
            floor = floor.max(child.end);
            children.push((child, ty));
        }
        let ranges: Vec<Child> = children.iter().map(|it| it.0).collect();
        let last = ranges.last().map_or(open, |it| it.end);
        // The list ends after the comma that follows its last element.
        let list_end = self.token_after(b",", last).unwrap_or(last);
        let format = lf::TYPE_ARGUMENTS;
        self.emit_list(
            parent,
            Some((open, list_end)),
            &ranges,
            format,
            |printer, index| {
                let (child, ty) = children[index];
                // `emitTypeArgument`
                printer.emit_type(ty, child.pos, TP::Conditional, false)
            },
        )?;
        Ok(self.token_after(b">", list_end).unwrap_or(list_end))
    }

    /// `emitTypeParameters(parentNode, nodes)`: `<T, U>`. `allows_trailing_comma`: the parent is an arrow function.
    #[optimize(size)]
    pub(super) fn emit_type_parameters(
        &mut self,
        parent: (usize, usize),
        type_params: Span<TypeParamId>,
        allows_trailing_comma: bool,
    ) -> Emitted {
        let hir = self.hir;
        let children: Vec<Child> = type_params
            .iter()
            .map(|tp| Child {
                pos: self.pos_before_token(hir[tp].start as usize),
                end: hir[tp].end as usize,
            })
            .collect();
        let (Some(first), Some(last)) = (children.first(), children.last()) else {
            return Ok(());
        };
        let list_end = self.end_of_type_parameters(type_params).unwrap_or(last.end);
        let format = match allows_trailing_comma {
            true => lf::TYPE_PARAMETERS | lf::ALLOW_TRAILING_COMMA,
            false => lf::TYPE_PARAMETERS,
        };
        self.emit_list(
            parent,
            Some((first.pos, list_end)),
            &children,
            format,
            |printer, index| printer.emit_type_parameter(type_params.at(index), children[index]),
        )
    }

    /// `emitTypeAnnotation(node)`: `: T`, nothing if there is no type.
    #[optimize(size)]
    pub(super) fn emit_type_annotation(&mut self, ty: TypeNodeId) -> Emitted {
        if ty.is_none() {
            return Ok(());
        }
        self.write(b": ");
        self.emit_type(ty, 0, TP::Conditional, false)
    }

    /// `emitTypeElement`: a member of an interface or of a type literal.
    #[optimize(size)]
    pub(super) fn emit_type_element(&mut self, m: MemberId) -> Emitted {
        if self.c.is_stack_low_for_printing() {
            return Err(Stop::OutOfStack);
        }
        let hir = self.hir;
        let member = &hir[m];
        let (pos, end) = (member.loc.pos as usize, member.loc.end as usize);
        let node = (pos, end);
        let is_optional = member.flags.contains(Flags::OPTIONAL);
        // A member that is no property has a signature.
        let signature = hir.fns.get(member.func.idx());
        match (member.kind, signature) {
            // `emitPropertySignature`. An initializer, which is an error, is not written.
            (MemberKind::Property, _) => {
                let state = self.enter_node(pos, end);
                self.emit_modifier_list(node, member.modifiers, false)?;
                let name_end = self.emit_member_name(m)?;
                self.emit_question_token(is_optional, name_end);
                self.emit_type_annotation(member.ty)?;
                self.write(b";");
                self.exit_node(state);
            }
            // `emitMethodSignature`
            (MemberKind::Method, Some(_)) => {
                let state = self.enter_node(pos, end);
                self.emit_modifier_list(node, member.modifiers, false)?;
                let name_end = self.emit_member_name(m)?;
                self.emit_question_token(is_optional, name_end);
                self.emit_signature(node, member.func)?;
                self.write(b";");
                self.exit_node(state);
            }
            // `emitCallSignature`
            (MemberKind::CallSignature, Some(_)) => {
                let state = self.enter_node(pos, end);
                self.emit_signature(node, member.func)?;
                self.write(b";");
                self.exit_node(state);
            }
            // `emitConstructSignature`
            (MemberKind::ConstructSignature, Some(_)) => {
                let state = self.enter_node(pos, end);
                self.write(b"new ");
                self.emit_signature(node, member.func)?;
                self.write(b";");
                self.exit_node(state);
            }
            // `emitAccessorDeclaration`
            (MemberKind::Getter | MemberKind::Setter, Some(accessor)) => {
                let state = self.enter_node(pos, end);
                let keyword_pos = self.emit_modifier_list(node, member.modifiers, true)?;
                let keyword: &[u8] = match member.kind {
                    MemberKind::Getter => b"get",
                    _ => b"set",
                };
                self.emit_token(keyword, keyword_pos, node);
                self.write_space();
                self.emit_member_name(m)?;
                self.emit_signature(node, member.func)?;
                // `emitFunctionBodyNode`: a body in a type is an error, and is written.
                match accessor.body {
                    FnBody::None => self.write(b";"),
                    _ => self.emit_function_body(member.func)?,
                }
                self.exit_node(state);
            }
            // `emitIndexSignature`
            (MemberKind::IndexSignature, Some(signature)) => {
                let state = self.enter_node(pos, end);
                self.emit_modifier_list(node, member.modifiers, false)?;
                self.emit_parameters_for_index_signature(node, member.func)?;
                self.emit_type_annotation(signature.ret)?;
                self.write(b";");
                self.exit_node(state);
            }
            // `parseTypeMember` builds no other member: typescript-go fails on one.
            _ => {}
        }
        Ok(())
    }

    /// `emitExpressionWithTypeArguments` for an element of a heritage clause that the HIR has as a type.
    #[optimize(size)]
    pub(super) fn emit_expression_with_type_arguments(&mut self, ty: TypeNodeId) -> Emitted {
        self.emit_type(ty, 0, TP::Conditional, false)
    }

    /// Whether `ty`, a `Ref`, is an `ExpressionWithTypeArguments`: a heritage clause element that is an entity name.
    #[optimize(size)]
    fn is_heritage_element(&self, ty: TypeNodeId) -> bool {
        let hir = self.hir;
        hir.kind(hir.node(ty)) == crate::node::Kind::ExpressionWithTypeArguments
    }

    /// `emitExpressionWithTypeArguments` for an entity name: an expression, a `PropertyAccessExpression` for each dot.
    #[optimize(size)]
    fn emit_heritage_element(
        &mut self,
        name: Span<NameId>,
        args: IdList<TypeNodeId>,
        (pos, end): (usize, usize),
    ) -> Emitted {
        let state = self.enter_node(pos, end);
        let ranges: Vec<Child> = name.iter().map(|name| self.range_of_name(name)).collect();
        let mut name_end = pos;
        if let Some((&first, rest)) = ranges.split_first() {
            // `emitExpression(node.Expression, OperatorPrecedenceMember)`: an optional chain is in parentheses.
            let is_optional_chain = (ranges.iter().zip(rest))
                .any(|(object, _)| self.token_after(b"?.", object.end).is_some());
            if is_optional_chain {
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
            for right in rest {
                let object_end = name_end;
                let question_dot = self.token_after(b"?.", object_end);
                let dot_end = question_dot.or_else(|| self.dot_after(object_end));
                // A `.` that the source does not have is a token without text.
                let dot_end = dot_end.unwrap_or(object_end);
                let lines_before_dot = self.is_on_next_line(object_end, object_end);
                if lines_before_dot {
                    self.write_line();
                }
                self.increase_indent_if(lines_before_dot);
                match question_dot {
                    Some(_) => self.emit_token_node(b"?.", object_end, dot_end),
                    None => _ = self.emit_token(b".", object_end, (first.pos, right.end)),
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
            if is_optional_chain {
                self.write(b")");
            }
        }
        self.emit_type_arguments((pos, end), args, name_end)?;
        self.exit_node(state);
        Ok(())
    }

    // ───────────────────────────── members ─────────────────────────────

    /// `emitTokenNode(node.PostfixToken)`: the `?` after the name that ends at `name_end`.
    #[optimize(size)]
    fn emit_question_token(&mut self, is_optional: bool, name_end: usize) {
        if is_optional {
            let end = self.token_after(b"?", name_end).unwrap_or(name_end);
            self.emit_token_node(b"?", name_end, end);
        }
    }

    /// `emitPropertyName(node.Name())` for the member `m`. Returns the end of the name.
    #[optimize(size)]
    fn emit_member_name(&mut self, m: MemberId) -> Result<usize, Stop> {
        let member = &self.hir[m];
        let start = member.name_pos as usize;
        if !matches!(member.key, PropKey::None) {
            return self.emit_name(member.key, NameKind::Identifier, start);
        }
        // `getDeclarationName`: a private name outside a class and a bigint literal declare nothing, so `key` is none.
        let pos = self.pos_before_token(start);
        let end = token_end(self.text, start, false);
        if hir::is_private_name_at(self.hir, member.name_pos) {
            self.emit_source(pos, end);
            return Ok(end);
        }
        if hir::is_bigint_literal_at(self.hir, member.name_pos) {
            let written = crate::json::bigint_token_value(self.source(start, end));
            self.emit_leaf(pos, end, &written);
            return Ok(end);
        }
        // A name that is missing has no text.
        Ok(pos)
    }

    // ───────────────────────────── type parameters ─────────────────────────────

    /// `emitTypeParameter`
    #[optimize(size)]
    fn emit_type_parameter(&mut self, tp: TypeParamId, child: Child) -> Emitted {
        let parameter = &self.hir[tp];
        let state = self.enter_node(child.pos, child.end);
        self.emit_modifier_list((child.pos, child.end), parameter.modifiers, false)?;
        let name_end = self.emit_type_parameter_name(tp);
        // A constraint that is an expression, which is an error, is not written.
        if parameter.constraint.is_some() {
            self.write(b" extends ");
            self.emit_type(parameter.constraint, name_end, TP::Conditional, false)?;
        }
        if parameter.default.is_some() {
            self.write(b" = ");
            let floor = match parameter.constraint.is_some() {
                true => self.type_range(parameter.constraint, name_end).end,
                false => name_end,
            };
            self.emit_type(parameter.default, floor, TP::Conditional, false)?;
        }
        self.exit_node(state);
        Ok(())
    }

    /// `emitBindingIdentifier(node.Name())` for the type parameter `tp`. A missing name has no text. Returns its end.
    #[optimize(size)]
    fn emit_type_parameter_name(&mut self, tp: TypeParamId) -> usize {
        let parameter = &self.hir[tp];
        let pos = self.pos_before_token(parameter.pos as usize);
        if parameter.name.is_none() || parameter.name == known::empty {
            return pos;
        }
        let end = self
            .c
            .end_of_identifier_at(self.file, parameter.name, parameter.pos)
            as usize;
        self.emit_source(pos, end);
        end
    }

    // ───────────────────────────── names ─────────────────────────────

    /// `Pos()` and `End()` of a name of an entity name. One that is missing is where the token before it ends.
    #[optimize(size)]
    fn range_of_name(&self, name: NameId) -> Child {
        let name = &self.hir[name];
        let pos = self.pos_before_token(name.pos() as usize);
        if name.text.is_none() || name.text == known::empty {
            return Child { pos, end: pos };
        }
        let end = self
            .c
            .end_of_identifier_at(self.file, name.text, name.pos()) as usize;
        Child { pos, end }
    }

    /// `emitEntityName`: `A.B.C`, a `QualifiedName` for each dot. Returns its end: `before` if it has no identifier.
    #[optimize(size)]
    pub(super) fn emit_entity_name(&mut self, names: Span<NameId>, before: usize) -> usize {
        let ranges: Vec<Child> = names.iter().map(|name| self.range_of_name(name)).collect();
        let Some((&first, rest)) = ranges.split_first() else {
            return before;
        };
        // `emitQualifiedName`, from the outermost: each starts where the first name starts.
        let mut qualified = Vec::with_capacity(rest.len());
        for right in rest.iter().rev() {
            qualified.push(self.enter_node(first.pos, right.end));
        }
        // `emitIdentifierReference`
        self.emit_source(first.pos, first.end);
        let mut end = first.end;
        for right in rest {
            self.write(b".");
            // `emitIdentifierName`
            self.emit_source(right.pos, right.end);
            if let Some(state) = qualified.pop() {
                self.exit_node(state);
            }
            end = right.end;
        }
        end
    }

    /// The end of the `.` that follows `pos`, if that token is there.
    #[optimize(size)]
    fn dot_after(&self, pos: usize) -> Option<usize> {
        let start = self.skip_trivia(pos);
        (self.byte(start) == b'.' && token_end(self.text, start, false) == start + 1)
            .then_some(start + 1)
    }

    // ───────────────────────────── positions ─────────────────────────────

    /// `Pos()` of a node whose first token is at `start`. `pos_before` does not see a `//` comment after a `${`.
    #[optimize(size)]
    fn pos_before_token(&self, start: usize) -> usize {
        let mut at = self.pos_before(start);
        // A comment that was not seen ends the line.
        while line_break_len(self.text, at) != 0 {
            let line = bun_core::strings::last_index_of_any(self.source(0, at), b"\n\r")
                .map_or(0, |line_break| line_break + 1);
            let Some(comment) = line_comment_start(self.source(line, at)) else {
                break;
            };
            at = self.pos_before(line + comment);
        }
        at
    }

    /// The `(`s around `ty` at `floor` or later, innermost first: `parenthesized_types_around` with `pos_before_token`.
    #[optimize(size)]
    fn parentheses_around(&self, ty: TypeNodeId, floor: usize) -> Vec<usize> {
        let mut opens = Vec::new();
        let Some(node) = self.hir.types.get(ty.idx()) else {
            return opens;
        };
        let mut at = node.pos as usize;
        loop {
            let end = self.pos_before_token(at);
            if end == 0 || end <= floor {
                break;
            }
            at = end - 1;
            match self.byte(at) {
                b'(' => opens.push(at),
                // A leading operator before a whole type belongs to it, and so does the `!` of JSDoc.
                b'|' | b'&' | b'!' => {}
                _ => break,
            }
        }
        opens
    }

    // ───────────────────────────── type nodes ─────────────────────────────

    /// `Pos()` and `End()` of the node that `ty` is with the parentheses around it that open at `floor` or later.
    #[optimize(size)]
    fn type_range(&self, ty: TypeNodeId, floor: usize) -> Child {
        let Some(node) = self.hir.types.get(ty.idx()) else {
            return Child {
                pos: floor,
                end: floor,
            };
        };
        let around = self.parentheses_around(ty, floor);
        let start = around.last().copied().unwrap_or(node.pos as usize);
        // A `)` that is missing has no text.
        let mut end = node.end as usize;
        for _ in &around {
            end = self.token_after(b")", end).unwrap_or(end);
        }
        Child {
            pos: self.pos_before_token(start),
            end,
        }
    }

    /// `GetTypeNodePrecedence` of `ty` without the parentheses around it.
    #[optimize(size)]
    fn type_precedence(&self, ty: TypeNodeId) -> TP {
        let hir = self.hir;
        match hir[ty].kind {
            TypeNodeKind::Cond { .. } => TP::Conditional,
            TypeNodeKind::JSDoc {
                kind: JSDocTypeKind::Optional | JSDocTypeKind::Variadic,
                ..
            } => TP::JSDoc,
            TypeNodeKind::Fn(_) => TP::Function,
            TypeNodeKind::Union(_) => TP::Union,
            TypeNodeKind::Intersection(_) => TP::Intersection,
            // `infer T extends U` has the precedence of a function type: the `extends` clause eagerly consumes a type.
            TypeNodeKind::Infer(parameter) if hir[parameter].constraint.is_some() => TP::Function,
            TypeNodeKind::Keyof(_)
            | TypeNodeKind::Readonly(_)
            | TypeNodeKind::UniqueSymbol
            | TypeNodeKind::Unique(_)
            | TypeNodeKind::Infer(_)
            | TypeNodeKind::Typeof { .. } => TP::TypeOperator,
            TypeNodeKind::IndexedAccess { .. } | TypeNodeKind::Array(_) => TP::Postfix,
            _ => TP::NonArray,
        }
    }

    /// `emitTypeNode(node, precedence)` for `ty` with the parentheses around it that open at `floor` or later.
    #[optimize(size)]
    fn emit_type(
        &mut self,
        ty: TypeNodeId,
        floor: usize,
        precedence: TP,
        in_extends: bool,
    ) -> Emitted {
        if self.c.is_stack_low_for_printing() {
            return Err(Stop::OutOfStack);
        }
        // The parser gave up on a type that is nested too deeply.
        let Some(node) = self.hir.types.get(ty.idx()) else {
            return Err(Stop::OutOfStack);
        };
        let opens = self.parentheses_around(ty, floor);
        if opens.is_empty() {
            return self.emit_type_without_parentheses(ty, precedence, in_extends);
        }
        // `emitParenthesizedType` for each pair, from the outermost. No precedence is higher, so the printer adds none.
        let mut close = node.end as usize;
        let mut states = Vec::with_capacity(opens.len());
        let ends: Vec<usize> = opens
            .iter()
            .map(|_| {
                // A `)` that is missing has no text.
                close = self.token_after(b")", close).unwrap_or(close);
                close
            })
            .collect();
        for (&open, &end) in opens.iter().zip(&ends).rev() {
            states.push(self.enter_node(self.pos_before_token(open), end));
            self.write(b"(");
        }
        // `emitTypeNodeOutsideExtends(node.Type)`
        self.emit_type_without_parentheses(ty, TP::Conditional, false)?;
        while let Some(state) = states.pop() {
            self.write(b")");
            self.exit_node(state);
        }
        Ok(())
    }

    /// `emitTypeNode(node, precedence)` for `ty` itself: the parentheses around it are emitted.
    #[optimize(size)]
    fn emit_type_without_parentheses(
        &mut self,
        ty: TypeNodeId,
        precedence: TP,
        in_extends: bool,
    ) -> Emitted {
        let hir = self.hir;
        let node = hir[ty];
        let (mut precedence, mut in_extends) = (precedence, in_extends);
        // "in the `extends` clause of a ConditionalType or InferType, a ConditionalType must be parenthesized"
        if in_extends && precedence <= TP::Conditional {
            precedence = TP::Function;
        }
        let needs_parentheses = self.type_precedence(ty) < precedence;
        if needs_parentheses {
            in_extends = false;
            self.write(b"(");
        }
        let start = node.pos as usize;
        let (pos, end) = (self.pos_before_token(start), node.end as usize);
        let range = (pos, end);
        match node.kind {
            // Only the oxc dialect has it: the `/` or `/=` where an element of an `implements` clause is expected.
            TypeNodeKind::Error => {
                let token: &[u8] = if end == start + 2 { b"/=" } else { b"/" };
                self.emit_leaf(pos, end, token);
            }
            // `emitExpressionWithTypeArguments`
            TypeNodeKind::Heritage { expr, args } => {
                let state = self.enter_node(pos, end);
                self.emit_expression(expr, P::Member)?;
                self.emit_type_arguments(range, args, self.end_of(expr))?;
                self.exit_node(state);
            }
            // `parseJSDocAllType`: the HIR has `any` for `*`. The printer has no text for the kind of a `JSDocAllType`.
            TypeNodeKind::Keyword(Keyword::Any) if self.byte(start) == b'*' => {
                self.emit_leaf(pos, end, b"");
            }
            // `emitLiteralType` for a `NullKeyword`
            TypeNodeKind::Keyword(Keyword::Null) => {
                let state = self.enter_node(pos, end);
                self.emit_leaf(pos, end, b"null");
                self.exit_node(state);
            }
            // `emitKeywordTypeNode`, `emitThisType`
            TypeNodeKind::Keyword(keyword) => self.emit_leaf(pos, end, keyword.text()),
            // `emitExpressionWithTypeArguments`
            TypeNodeKind::Ref { name, args } if self.is_heritage_element(ty) => {
                self.emit_heritage_element(name, args, range)?;
            }
            // `emitTypeReference`
            TypeNodeKind::Ref { name, args } => {
                let state = self.enter_node(pos, end);
                let name_end = self.emit_entity_name(name, pos);
                self.emit_type_arguments(range, args, name_end)?;
                self.exit_node(state);
            }
            // `emitLiteralType` for a string, or a template without substitutions.
            TypeNodeKind::StringLit(_) => {
                let state = self.enter_node(pos, end);
                self.emit_source(pos, end);
                self.exit_node(state);
            }
            TypeNodeKind::Template { types, .. } if types.is_empty() => {
                let state = self.enter_node(pos, end);
                self.emit_source(pos, end);
                self.exit_node(state);
            }
            TypeNodeKind::BoolLit(value) => {
                let state = self.enter_node(pos, end);
                self.emit_leaf(pos, end, if value { b"true" } else { b"false" });
                self.exit_node(state);
            }
            TypeNodeKind::NumberLit(index) => self.emit_numeric_literal_type(range, Some(index)),
            TypeNodeKind::BigIntLit { .. } => self.emit_numeric_literal_type(range, None),
            TypeNodeKind::Template { types, .. } => self.emit_template_type(types, range)?,
            // `emitArrayType`, `emitIndexedAccessType`, in a loop as in the parser: `T[][K]` is as deep as it is long.
            TypeNodeKind::Array(_) | TypeNodeKind::IndexedAccess { .. } => {
                let mut chain = Vec::new();
                let (mut link, mut link_pos) = (node, pos);
                let (operand, floor) = loop {
                    let (TypeNodeKind::Array(operand)
                    | TypeNodeKind::IndexedAccess { obj: operand, .. }) = link.kind
                    else {
                        return Ok(());
                    };
                    let link_start = link.pos as usize;
                    let state = self.enter_node(link_pos, link.end as usize);
                    chain.push((link.kind, link_start, state));
                    let inner = hir.types.get(operand.idx()).filter(|inner| {
                        matches!(
                            inner.kind,
                            TypeNodeKind::Array(_) | TypeNodeKind::IndexedAccess { .. }
                        ) && self.parentheses_around(operand, link_start).is_empty()
                    });
                    let Some(inner) = inner else {
                        break (operand, link_start);
                    };
                    if inner.pos != link.pos {
                        link_pos = self.pos_before_token(inner.pos as usize);
                    }
                    link = *inner;
                };
                self.emit_postfix_type_operand(operand, floor, in_extends)?;
                while let Some((kind, link_start, state)) = chain.pop() {
                    match kind {
                        TypeNodeKind::IndexedAccess { obj, index } => {
                            let object_end = self.type_range(obj, link_start).end;
                            self.write(b"[");
                            self.emit_type(index, object_end, TP::Conditional, false)?;
                            self.write(b"]");
                        }
                        _ => self.write(b"[]"),
                    }
                    self.exit_node(state);
                }
            }
            // `emitTupleType`
            TypeNodeKind::Tuple(elements) => {
                let state = self.enter_node(pos, end);
                self.emit_token(b"[", pos, range);
                let children: Vec<Child> = elements
                    .iter()
                    .map(|element| Child {
                        pos: self.pos_before_token(hir[element].start as usize),
                        end: hir[element].end as usize,
                    })
                    .collect();
                let list = self.list_range(start + 1, b']', children.last().map(|it| it.end), end);
                let format = lf::MULTI_LINE_TUPLE_TYPE_ELEMENTS | lf::NO_SPACE_IF_EMPTY;
                self.emit_list(range, Some(list), &children, format, |printer, index| {
                    printer.emit_tuple_element(elements.at(index), children[index])
                })?;
                self.emit_token(b"]", list.1, range);
                self.exit_node(state);
            }
            // `emitUnionType`, `emitIntersectionType`
            TypeNodeKind::Union(types) | TypeNodeKind::Intersection(types) => {
                let (operator, format) = match node.kind {
                    TypeNodeKind::Union(_) => (b'|', lf::UNION_TYPE_CONSTITUENTS),
                    _ => (b'&', lf::INTERSECTION_TYPE_CONSTITUENTS),
                };
                let state = self.enter_node(pos, end);
                // An operator that leads is the first token of the node.
                let mut floor = match self.byte(start) == operator {
                    true => start + 1,
                    false => start,
                };
                let mut constituents = Vec::with_capacity(types.len());
                for constituent in hir.ids(types) {
                    let child = self.type_range(constituent, floor);
                    constituents.push((child, floor, constituent));
                    floor = floor.max(child.end);
                }
                let children: Vec<Child> = constituents.iter().map(|it| it.0).collect();
                self.emit_list(range, Some(range), &children, format, |printer, index| {
                    let (_, floor, constituent) = constituents[index];
                    printer.emit_type(constituent, floor, TP::TypeOperator, in_extends)
                })?;
                self.exit_node(state);
            }
            // `emitFunctionType`, `emitConstructorType`
            TypeNodeKind::Fn(f) => {
                let signature = &hir[f];
                let state = self.enter_node(pos, end);
                if signature.kind == FnKind::ConstructorType {
                    // `emitModifierList`: the HIR has `abstract` as a flag.
                    if signature.flags.contains(Flags::ABSTRACT) {
                        let modifier_end = self
                            .token_end_at(b"abstract", start)
                            .unwrap_or(start + b"abstract".len());
                        let modifier = Child {
                            pos,
                            end: modifier_end,
                        };
                        let list = Some((pos, modifier_end));
                        self.emit_list(range, list, &[modifier], lf::MODIFIERS, |printer, _| {
                            printer.emit_leaf(modifier.pos, modifier.end, b"abstract");
                            Ok(())
                        })?;
                    }
                    self.write(b"new ");
                }
                self.emit_type_parameters(range, signature.type_params, false)?;
                self.emit_parameters(range, f)?;
                self.write_space();
                // The `=>` can be missing: the return type's parentheses open after the `(` and the last parameter.
                let anchor = signature.anchor as usize;
                let last_parameter = match signature.params.iter().next_back() {
                    Some(last) => Some(last),
                    None => signature.this_param.some(),
                };
                let floor = match self.byte(anchor) {
                    b'(' => anchor + 1,
                    _ => anchor,
                };
                let floor = last_parameter.map_or(floor, |p| floor.max(hir[p].loc.end as usize));
                self.emit_return_type(signature.ret, floor, in_extends)?;
                self.exit_node(state);
            }
            // `emitTypeLiteral`
            TypeNodeKind::Object(members) => {
                let state = self.enter_node(pos, end);
                self.write(b"{");
                let children: Vec<Child> = members
                    .iter()
                    .map(|member| Child {
                        pos: hir[member].loc.pos as usize,
                        end: hir[member].loc.end as usize,
                    })
                    .collect();
                let list = self.list_range(start + 1, b'}', children.last().map(|it| it.end), end);
                let format = lf::MULTI_LINE_TYPE_LITERAL_MEMBERS | lf::NO_SPACE_IF_EMPTY;
                self.emit_list(range, Some(list), &children, format, |printer, index| {
                    printer.emit_type_element(members.at(index))
                })?;
                self.write(b"}");
                self.exit_node(state);
            }
            // `emitConditionalType`, in a loop: the parser recurses after the `:` with less stack than the printer has.
            TypeNodeKind::Cond { .. } => {
                let mut states = Vec::new();
                let (mut link, mut link_pos) = (node, pos);
                loop {
                    let TypeNodeKind::Cond {
                        check,
                        extends,
                        yes,
                        no,
                    } = link.kind
                    else {
                        break;
                    };
                    let start = link.pos as usize;
                    states.push(self.enter_node(link_pos, link.end as usize));
                    let check_end = self.type_range(check, start).end;
                    let extends_end = self.type_range(extends, check_end).end.max(check_end);
                    let yes_end = self.type_range(yes, extends_end).end.max(extends_end);
                    self.emit_type(check, start, TP::Union, in_extends)?;
                    self.write(b" extends ");
                    // `emitTypeNodeInExtends`
                    self.emit_type(extends, check_end, TP::Conditional, true)?;
                    self.write(b" ? ");
                    self.emit_type(yes, extends_end, TP::Conditional, false)?;
                    self.write(b" : ");
                    let next = hir.types.get(no.idx()).filter(|next| {
                        matches!(next.kind, TypeNodeKind::Cond { .. })
                            && self.parentheses_around(no, yes_end).is_empty()
                    });
                    let Some(next) = next else {
                        self.emit_type(no, yes_end, TP::Conditional, false)?;
                        break;
                    };
                    (link, link_pos) = (*next, self.pos_before_token(next.pos as usize));
                    in_extends = false;
                }
                while let Some(state) = states.pop() {
                    self.exit_node(state);
                }
            }
            // `emitInferType`
            TypeNodeKind::Infer(parameter) => {
                let state = self.enter_node(pos, end);
                self.write(b"infer ");
                // `emitInferTypeParameter`
                let declaration = &hir[parameter];
                let declaration_pos = self.pos_before_token(declaration.pos as usize);
                let declaration_state = self.enter_node(declaration_pos, declaration.end as usize);
                let name_end = self.emit_type_parameter_name(parameter);
                if declaration.constraint.is_some() {
                    self.write(b" extends ");
                    self.emit_type(declaration.constraint, name_end, TP::Conditional, true)?;
                }
                self.exit_node(declaration_state);
                self.exit_node(state);
            }
            TypeNodeKind::Mapped(mapped) => self.emit_mapped_type(mapped, range)?,
            // `emitTypeOperator`
            TypeNodeKind::Keyof(operand)
            | TypeNodeKind::Readonly(operand)
            | TypeNodeKind::Unique(operand) => {
                let (operator, of_operand): (&[u8], TP) = match node.kind {
                    TypeNodeKind::Keyof(_) => (b"keyof", TP::TypeOperator),
                    TypeNodeKind::Readonly(_) => (b"readonly", TP::Postfix),
                    _ => (b"unique", TP::TypeOperator),
                };
                let state = self.enter_node(pos, end);
                self.emit_token(operator, pos, range);
                self.write_space();
                self.emit_type(operand, start + 1, of_operand, in_extends)?;
                self.exit_node(state);
            }
            // `emitTypeOperator` for `unique symbol`: the HIR has no node for the keyword.
            TypeNodeKind::UniqueSymbol => {
                let state = self.enter_node(pos, end);
                let operator_end = self
                    .token_end_at(b"unique", start)
                    .unwrap_or(start + b"unique".len());
                self.emit_token(b"unique", pos, range);
                self.write_space();
                self.emit_leaf(operator_end, end, b"symbol");
                self.exit_node(state);
            }
            TypeNodeKind::JSDoc {
                ty: operand,
                kind,
                is_postfix,
            } => {
                let state = self.enter_node(pos, end);
                // The operand of a postfix type starts where the type starts.
                let floor = if is_postfix { start } else { start + 1 };
                match kind {
                    // `emitJSDocNonNullableType`: `T!` is written as `!T`.
                    JSDocTypeKind::NonNullable => {
                        self.write(b"!");
                        self.emit_type(operand, floor, TP::NonArray, in_extends)?;
                    }
                    // `emitJSDocNullableType`: `T?` is written as `?T`.
                    JSDocTypeKind::Nullable => {
                        self.write(b"?");
                        self.emit_type(operand, floor, TP::NonArray, in_extends)?;
                    }
                    // `emitJSDocOptionalType`
                    JSDocTypeKind::Optional => {
                        self.emit_type(operand, start, TP::JSDoc, in_extends)?;
                        self.write(b"=");
                    }
                    // `emitJSDocVariadicType`
                    JSDocTypeKind::Variadic => {
                        self.write(b"...");
                        self.emit_type(operand, start + 1, TP::JSDoc, in_extends)?;
                    }
                }
                self.exit_node(state);
            }
            // `emitTypeQuery`
            TypeNodeKind::Typeof { name, args, .. } => {
                let state = self.enter_node(pos, end);
                self.write(b"typeof ");
                let keyword_end = self
                    .token_end_at(b"typeof", start)
                    .unwrap_or(start + b"typeof".len());
                let name_end = self.emit_entity_name(name, keyword_end);
                self.emit_type_arguments(range, args, name_end)?;
                self.exit_node(state);
            }
            TypeNodeKind::Import { .. } => self.emit_import_type(ty, range)?,
            // `emitTypePredicate`
            TypeNodeKind::Predicate {
                param,
                ty: target,
                asserts,
            } => {
                let state = self.enter_node(pos, end);
                let mut at = pos;
                if asserts {
                    // `emitTokenNode(node.AssertsModifier)`
                    at = self.emit_keyword(at, b"asserts");
                    self.write_space();
                }
                // `emitTypePredicateParameterName`: a `ThisType`, or an identifier, which has no text if it is missing.
                if param == known::this {
                    at = self.emit_keyword(at, b"this");
                } else if param.is_some() && param != known::empty {
                    let name_end = token_end(self.text, self.skip_trivia(at), false);
                    self.emit_source(at, name_end);
                    at = name_end;
                }
                if target.is_some() {
                    self.write(b" is ");
                    self.emit_type(target, at, TP::Conditional, false)?;
                }
                self.exit_node(state);
            }
        }
        if needs_parentheses {
            self.write(b")");
        }
        Ok(())
    }

    /// `emitLiteralType` for a numeric literal, or a bigint one if `number` is none. `-1` is a `PrefixUnaryExpression`.
    #[optimize(size)]
    fn emit_numeric_literal_type(&mut self, (pos, end): (usize, usize), number: Option<u32>) {
        let state = self.enter_node(pos, end);
        let start = self.skip_trivia(pos);
        let is_negative = self.byte(start) == b'-';
        // `emitPrefixUnaryExpression`
        let prefix = is_negative.then(|| {
            let state = self.enter_node(pos, end);
            self.emit_token(b"-", pos, (pos, end));
            state
        });
        let literal_pos = if is_negative { start + 1 } else { pos };
        let written = self.source(self.skip_trivia(literal_pos), end);
        let written = match number {
            // `node.Text()`: the text of a bigint literal is never that of the source.
            None => crate::json::bigint_token_value(written),
            // `getLiteralTextOfNode`: the value of a literal that is invalid.
            Some(index) if self.is_numeric_literal_written_as_value(written) => {
                let value = self.hir.numbers.get(index as usize).copied().unwrap_or(0.0);
                crate::atom::number_to_string(value.abs())
            }
            Some(_) => written.to_vec(),
        };
        self.emit_leaf(literal_pos, end, &written);
        if let Some(prefix) = prefix {
            self.exit_node(prefix);
        }
        self.exit_node(state);
    }

    /// `emitTemplateType`
    #[optimize(size)]
    fn emit_template_type(
        &mut self,
        types: IdList<TypeNodeId>,
        (pos, end): (usize, usize),
    ) -> Emitted {
        let hir = self.hir;
        let start = self.skip_trivia(pos);
        let state = self.enter_node(pos, end);
        // `emitTemplateHead`
        let head_end = template_text(self.text, start + 1).0.min(end);
        self.emit_leaf(pos, head_end, self.source(start, head_end));
        // Each `TemplateLiteralTypeSpan`, and where its type ends.
        let mut spans: Vec<(Child, usize)> = Vec::with_capacity(types.len());
        let mut piece_end = head_end;
        for ty in hir.ids(types) {
            let type_end = self.type_range(ty, piece_end).end.max(piece_end);
            let literal = self.skip_trivia(type_end);
            // A `}` that is missing: the literal has no text.
            let literal_end = match self.byte(literal) {
                b'}' if literal < end => template_text(self.text, literal + 1).0.min(end),
                _ => type_end,
            };
            let span = Child {
                pos: piece_end,
                end: literal_end,
            };
            spans.push((span, type_end));
            piece_end = literal_end;
        }
        let children: Vec<Child> = spans.iter().map(|it| it.0).collect();
        let list = Some((head_end, piece_end));
        let format = lf::TEMPLATE_EXPRESSION_SPANS;
        self.emit_list((pos, end), list, &children, format, |printer, index| {
            // `emitTemplateTypeSpan`
            let (span, type_end) = spans[index];
            let ty: TypeNodeId = hir.id_at(types, index);
            let state = printer.enter_node(span.pos, span.end);
            printer.emit_type(ty, span.pos, TP::Conditional, false)?;
            // `emitTemplateMiddleTail`
            let literal = printer.skip_trivia(type_end);
            printer.emit_leaf(type_end, span.end, printer.source(literal, span.end));
            printer.exit_node(state);
            Ok(())
        })?;
        self.exit_node(state);
        Ok(())
    }

    /// `emitPostfixTypeOperand` for the operand of a type that starts at `floor`: it adds no parentheses to `typeof X`.
    #[optimize(size)]
    fn emit_postfix_type_operand(
        &mut self,
        operand: TypeNodeId,
        floor: usize,
        in_extends: bool,
    ) -> Emitted {
        let kind = self.hir.types.get(operand.idx()).map(|it| it.kind);
        let precedence = match kind {
            Some(TypeNodeKind::Typeof { .. }) => TP::TypeOperator,
            _ => TP::Postfix,
        };
        self.emit_type(operand, floor, precedence, in_extends)
    }

    /// `emitReturnType`, for a type whose parentheses open at `floor` or later.
    #[optimize(size)]
    fn emit_return_type(&mut self, ty: TypeNodeId, floor: usize, in_extends: bool) -> Emitted {
        let hir = self.hir;
        self.write(b"=> ");
        // "we must parenthesize `infer ... extends ...` so as not to result in an ambiguous parse."
        let kind = hir.types.get(ty.idx()).map(|it| it.kind);
        let is_constrained_infer = matches!(kind, Some(TypeNodeKind::Infer(parameter))
            if hir[parameter].constraint.is_some());
        let precedence = match in_extends && is_constrained_infer {
            true => TP::NonArray,
            false => TP::Conditional,
        };
        self.emit_type(ty, floor, precedence, in_extends)
    }

    /// `emitTupleElementType`: a `NamedTupleMember`, or its type.
    #[optimize(size)]
    fn emit_tuple_element(&mut self, element: TupleElemId, child: Child) -> Emitted {
        let element = &self.hir[element];
        if element.name.is_none() {
            return self.emit_type_of_tuple_element(
                element.written,
                child,
                element.has_dots,
                element.optional,
            );
        }
        // `emitNamedTupleMember`
        let node = (child.pos, child.end);
        let state = self.enter_node(child.pos, child.end);
        let mut at = child.pos;
        if element.has_dots {
            let dots_end = self.token_after(b"...", at).unwrap_or(at);
            self.emit_token_node(b"...", at, dots_end);
            at = dots_end;
        }
        let name_end = token_end(self.text, self.skip_trivia(at), false);
        self.emit_source(at, name_end);
        at = name_end;
        if element.optional {
            let question_end = self.token_after(b"?", at).unwrap_or(at);
            self.emit_token_node(b"?", at, question_end);
            at = question_end;
        }
        let colon_end = self.emit_token(b":", at, node);
        self.write_space();
        let ty = Child {
            pos: colon_end,
            end: child.end,
        };
        self.emit_type_of_tuple_element(
            element.written,
            ty,
            element.member_type == TupleMemberType::Rest,
            element.member_type == TupleMemberType::Optional,
        )?;
        self.exit_node(state);
        Ok(())
    }

    /// `parseTupleElementType`: a `RestType`, an `OptionalType` or `written`. `range`: its `Pos()` and `End()`.
    #[optimize(size)]
    fn emit_type_of_tuple_element(
        &mut self,
        written: TypeNodeId,
        range: Child,
        is_rest: bool,
        is_optional: bool,
    ) -> Emitted {
        if is_rest {
            // `emitRestType`
            let state = self.enter_node(range.pos, range.end);
            self.write(b"...");
            let dots_end = self.token_after(b"...", range.pos).unwrap_or(range.pos);
            self.emit_type(written, dots_end, TP::Conditional, false)?;
            self.exit_node(state);
        } else if is_optional {
            // `emitOptionalType`
            let state = self.enter_node(range.pos, range.end);
            self.emit_postfix_type_operand(written, self.skip_trivia(range.pos), false)?;
            self.write(b"?");
            self.exit_node(state);
        } else {
            self.emit_type(written, range.pos, TP::Conditional, false)?;
        }
        Ok(())
    }

    /// `emitMappedType`
    #[optimize(size)]
    fn emit_mapped_type(&mut self, mapped: MappedId, (pos, end): (usize, usize)) -> Emitted {
        let hir = self.hir;
        let mapped = &hir[mapped];
        let parameter = &hir[mapped.param];
        let state = self.enter_node(pos, end);
        self.write(b"{");
        self.write_line();
        self.increase_indent();
        let open_end = self.skip_trivia(pos) + 1;
        if mapped.readonly != MappedModifier::None {
            // `ReadonlyToken`: `readonly`, `+` or `-`.
            let token = self.skip_trivia(open_end);
            let written: &[u8] = match (mapped.readonly, mapped.is_readonly_with_plus) {
                (MappedModifier::Remove, _) => b"-",
                (_, true) => b"+",
                _ => b"readonly",
            };
            let token_end = self
                .token_end_at(written, token)
                .unwrap_or(token + written.len());
            self.emit_token_node(written, open_end, token_end);
            if written != b"readonly" {
                self.write(b"readonly");
            }
            self.write_space();
        }
        self.write(b"[");
        // `emitMappedTypeParameter`
        let parameter_pos = self.pos_before_token(parameter.pos as usize);
        let parameter_state = self.enter_node(parameter_pos, parameter.end as usize);
        let name_end = self.emit_type_parameter_name(mapped.param);
        self.write(b" in ");
        self.emit_type(parameter.constraint, name_end, TP::Conditional, false)?;
        self.exit_node(parameter_state);
        let mut at = (parameter.end as usize).max(name_end);
        if mapped.name_ty.is_some() {
            self.write(b" as ");
            self.emit_type(mapped.name_ty, at, TP::Conditional, false)?;
            at = self.type_range(mapped.name_ty, at).end.max(at);
        }
        self.write(b"]");
        at = self.token_after(b"]", at).unwrap_or(at);
        if mapped.optional != MappedModifier::None {
            // `QuestionToken`: `?`, `+` or `-`.
            let written: &[u8] = match (mapped.optional, mapped.is_optional_with_plus) {
                (MappedModifier::Remove, _) => b"-",
                (_, true) => b"+",
                _ => b"?",
            };
            let token_end = self.skip_trivia(at) + 1;
            self.emit_token_node(written, at, token_end);
            if written != b"?" {
                self.write(b"?");
            }
        }
        self.write(b": ");
        // typescript-go fails on a mapped type that has no type: it emits the type that is nil.
        if mapped.ty.is_some() {
            self.emit_type(mapped.ty, 0, TP::Conditional, false)?;
        }
        self.write(b";");
        let members = mapped.members;
        let children: Vec<Child> = members
            .iter()
            .map(|member| Child {
                pos: hir[member].loc.pos as usize,
                end: hir[member].loc.end as usize,
            })
            .collect();
        // The members after the type, which are an error.
        if let (Some(first), Some(last)) = (children.first(), children.last()) {
            self.write_line();
            let list = Some((first.pos, last.end));
            let format = lf::PRESERVE_LINES;
            self.emit_list((pos, end), list, &children, format, |printer, index| {
                printer.emit_type_element(members.at(index))
            })?;
        }
        self.write_line();
        self.decrease_indent();
        self.write(b"}");
        self.exit_node(state);
        Ok(())
    }

    /// `emitImportTypeNode`
    #[optimize(size)]
    fn emit_import_type(&mut self, ty: TypeNodeId, (pos, end): (usize, usize)) -> Emitted {
        let hir = self.hir;
        let TypeNodeKind::Import {
            spec,
            name,
            args,
            is_typeof,
            attributes: token,
            ..
        } = hir[ty].kind
        else {
            return Ok(());
        };
        let state = self.enter_node(pos, end);
        let mut at = pos;
        if is_typeof {
            self.write(b"typeof ");
            at = self.token_after(b"typeof", at).unwrap_or(at);
        }
        self.write(b"import(");
        at = self.token_after(b"import", at).unwrap_or(at);
        at = self.token_after(b"(", at).unwrap_or(at);
        // `emitTypeNodeOutsideExtends(node.Argument)`: an argument that is no string is the first of `args`.
        let is_string = spec.is_some();
        let argument = match is_string {
            true => None,
            false => hir.ids(args).next(),
        };
        if let Some(argument) = argument {
            self.emit_type(argument, at, TP::Conditional, false)?;
            at = self.type_range(argument, at).end.max(at);
        } else if is_string {
            // The `LiteralType` of a string, which the HIR has no node for.
            let literal_end = token_end(self.text, self.skip_trivia(at), false).min(end);
            let literal_type = self.enter_node(at, literal_end);
            self.emit_source(at, literal_end);
            self.exit_node(literal_type);
            at = literal_end.max(at);
        }
        let written = hir.attributes_of_import_type(ty);
        if let Some(object) = written.filter(|_| token != ImportAttributesToken::None) {
            self.write(b", ");
            at = self.emit_import_type_attributes(object, token)?.max(at);
            // The comma and the `}` after the attributes.
            at = self.token_after(b",", at).unwrap_or(at);
            at = self.token_after(b"}", at).unwrap_or(at);
        }
        self.write(b")");
        at = self.token_after(b")", at).unwrap_or(at);
        if !name.is_empty() {
            self.write(b".");
            at = self.emit_entity_name(name, at);
        } else if let Some(dot_end) = self.dot_after(at) {
            // A qualifier that is missing: an identifier without text.
            self.write(b".");
            at = dot_end;
        }
        match is_string {
            true => _ = self.emit_type_arguments((pos, end), args, at)?,
            // The HIR has no nodes for the type arguments of an import type whose argument is no string.
            false => self.emit_type_arguments_of_source((pos, end), at)?,
        }
        self.exit_node(state);
        Ok(())
    }

    /// `emitTypeArguments` for a list that the HIR has no nodes for, which follows `before` and ends the node `parent`.
    #[optimize(size)]
    pub(super) fn emit_type_arguments_of_source(
        &mut self,
        parent: (usize, usize),
        before: usize,
    ) -> Emitted {
        // `parseEntityName` leaves the `.` of `A.<T>` to the list.
        let after_dot = self.dot_after(before).unwrap_or(before);
        let open = self.skip_trivia(after_dot);
        // The node ends where the token before the list ends, if it has none.
        if open >= parent.1 || self.byte(open) != b'<' {
            return Ok(());
        }
        // `parseBracketedList(PCTypeArguments, ..)`: a comma that follows no type follows one that is missing.
        let mut tokens: Vec<(usize, usize)> = Vec::new();
        let mut elements: Vec<(Child, usize)> = Vec::new();
        // The brackets that are open. A `` ` `` is the `${` of a template.
        let mut brackets: Vec<u8> = Vec::new();
        let (mut element_pos, mut previous_end) = (open + 1, open + 1);
        let mut first_token = 0;
        let mut at = self.skip_trivia(open + 1);
        while at < parent.1 {
            let byte = self.byte(at);
            let mut end = token_end(self.text, at, false).max(at + 1);
            match (byte, brackets.last()) {
                (b'>', None) => break,
                (b',', None) => {
                    let element_end = match first_token == tokens.len() {
                        true => element_pos,
                        false => previous_end,
                    };
                    let range = Child {
                        pos: element_pos,
                        end: element_end,
                    };
                    elements.push((range, first_token));
                    (element_pos, first_token) = (end, tokens.len());
                    (previous_end, at) = (end, self.skip_trivia(end));
                    continue;
                }
                (b'(', _) => brackets.push(b')'),
                (b'[', _) => brackets.push(b']'),
                (b'{', _) => brackets.push(b'}'),
                // `reScanLessThanToken`
                (b'<', _) => {
                    end = at + 1;
                    brackets.push(b'>');
                }
                (b'`', _) | (b'}', Some(b'`')) => {
                    let (text_end, is_substitution) = template_text(self.text, at + 1);
                    if byte == b'}' {
                        brackets.pop();
                    }
                    if is_substitution {
                        brackets.push(b'`');
                    }
                    end = text_end;
                }
                (b')' | b']' | b'}' | b'>', Some(&closer)) if closer == byte => _ = brackets.pop(),
                _ => {}
            }
            let end = end.min(parent.1);
            tokens.push((at, end));
            (previous_end, at) = (end, self.skip_trivia(end));
        }
        if first_token < tokens.len() {
            let range = Child {
                pos: element_pos,
                end: previous_end,
            };
            elements.push((range, first_token));
        }
        let children: Vec<Child> = elements.iter().map(|it| it.0).collect();
        let list = Some((open + 1, previous_end));
        let format = lf::TYPE_ARGUMENTS;
        self.emit_list(parent, list, &children, format, |printer, index| {
            let (range, first) = elements[index];
            let next = elements.get(index + 1).map_or(tokens.len(), |it| it.1);
            printer.emit_type_of_source(range, tokens.get(first..next).unwrap_or_default());
            Ok(())
        })
    }

    /// A type that the HIR has no node for: its tokens, with a space where the source has something between two.
    #[optimize(size)]
    fn emit_type_of_source(&mut self, range: Child, tokens: &[(usize, usize)]) {
        let state = self.enter_node(range.pos, range.end);
        for (index, &(start, end)) in tokens.iter().enumerate() {
            // The `-` of a literal is a `PrefixUnaryExpression`, which has no space.
            let follows_minus = index > 0 && self.byte(tokens[index - 1].0) == b'-';
            if index > 0 && tokens[index - 1].1 < start && !follows_minus {
                self.write_space();
            }
            let written = self.source(start, end);
            let word = unescaped_identifier(written);
            let is_bigint =
                written.first().is_some_and(u8::is_ascii_digit) && written.ends_with(b"n");
            if is_bigint {
                // `node.Text()`: the text of a bigint literal is never that of the source.
                self.write(&crate::json::bigint_token_value(written));
            } else if word.len() != written.len() && TYPE_KEYWORDS.contains(&&*word) {
                // A keyword is written as the keyword, not as the text of the source.
                self.write(&word);
            } else {
                self.write(written);
            }
        }
        self.exit_node(state);
    }

    /// `emitImportTypeNodeAttributes` for `object`, which the HIR has as an object literal. Returns where it ends.
    #[optimize(size)]
    fn emit_import_type_attributes(
        &mut self,
        object: ExprId,
        token: ImportAttributesToken,
    ) -> Result<usize, Stop> {
        let hir = self.hir;
        // `parseImportAttributes` builds no other node.
        let attributes = match hir[object].kind {
            ExprKind::Object(attributes) => attributes,
            _ => Span::EMPTY,
        };
        let start = hir[object].pos as usize;
        let pos = self.pos_before_token(start);
        // A list that is missing is where the token before it ends.
        let has_list = hir[object].end as usize > start && self.byte(start) == b'{';
        let end = if has_list {
            hir[object].end as usize
        } else {
            pos
        };
        let state = self.enter_node(pos, end);
        self.write(b"{ ");
        self.write(match token {
            ImportAttributesToken::Assert => b"assert",
            _ => b"with",
        });
        self.write(b": ");
        let children: Vec<Child> = attributes
            .iter()
            .map(|p| Child {
                pos: self.pos_before_token(hir[p].start as usize),
                end: self.c.end_of_prop(self.file, p) as usize,
            })
            .collect();
        let list = match has_list {
            true => self.list_range(start + 1, b'}', children.last().map(|it| it.end), end),
            false => (pos, pos),
        };
        let format = lf::IMPORT_ATTRIBUTES;
        self.emit_list(
            (pos, end),
            Some(list),
            &children,
            format,
            |printer, index| printer.emit_import_attribute(attributes.at(index), children[index]),
        )?;
        self.write(b" }");
        self.exit_node(state);
        Ok(end)
    }

    /// `emitImportAttribute`
    #[optimize(size)]
    fn emit_import_attribute(&mut self, p: PropId, child: Child) -> Emitted {
        let attribute = &self.hir[p];
        let state = self.enter_node(child.pos, child.end);
        // `emitImportAttributeName`
        let name = self.skip_trivia(child.pos);
        self.emit_name(attribute.key, attribute.name_kind, name)?;
        self.write(b": ");
        self.emit_trailing_comments_with_space_after(self.pos_of(attribute.value));
        self.emit_expression(attribute.value, P::Yield)?;
        self.exit_node(state);
        Ok(())
    }
}
