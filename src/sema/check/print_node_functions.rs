//! printer.go: the members of an object literal, modifiers, parameters, binding names and functions, for `NodePrinter`.

use super::errors_declaration_emit::comments_text;
use super::print::OperatorPrecedence as P;
use super::print_node::{Child, Emitted, NodePrinter, NodeState, Stop, lf};
use super::spans::{get_leading_comment_ranges, line_break_len, token_end, word_end};
use super::*;
use crate::atom::known;

/// A `Block` that is the body of a function: `Pos()` and `End()`, those of its list of statements, and `MultiLine`.
struct BodyBlock {
    pos: usize,
    end: usize,
    list: (usize, usize),
    is_multi_line: bool,
}

/// `ParsingContext`: the lists whose end is asked for.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum ListKind {
    Parameters,
    TypeParameters,
}

impl NodePrinter<'_, '_, '_> {
    /// `emitObjectLiteralElement`
    #[optimize(size)]
    pub(super) fn emit_object_literal_element(&mut self, p: PropId, child: Child) -> Emitted {
        let hir = self.hir;
        let prop = &hir[p];
        let node = (child.pos, child.end);
        let value = hir.exprs.get(prop.value.idx()).map(|it| it.kind);
        match (prop.kind, value) {
            // `emitSpreadAssignment`
            (PropKind::Spread, _) => {
                let state = self.enter_node(child.pos, child.end);
                self.emit_token(b"...", child.pos, node);
                self.emit_expression(prop.value, P::Yield)?;
                self.exit_node(state);
            }
            // `emitShorthandPropertyAssignment`: neither the modifiers nor the `?` are emitted.
            (PropKind::Shorthand, _) => {
                let state = self.enter_node(child.pos, child.end);
                self.emit_property_name(p)?;
                // `{ a = 1 }`: the `ObjectAssignmentInitializer`.
                if let Some(ExprKind::Assign { value, .. }) = value {
                    self.write(b" = ");
                    self.emit_expression(value, P::Yield)?;
                }
                self.exit_node(state);
            }
            // `emitMethodDeclaration`
            (PropKind::Method, Some(ExprKind::Fn(f))) => {
                let state = self.enter_node(child.pos, child.end);
                let at = self.emit_modifier_list(node, hir.prop_modifiers(p), true)?;
                if hir[f].flags.contains(Flags::GENERATOR) {
                    let asterisk_end = self.token_after(b"*", at).unwrap_or(at);
                    self.emit_token_node(b"*", at, asterisk_end);
                }
                let name_end = self.emit_property_name(p)?;
                // `PostfixToken`
                let postfix = prop.postfix_token as usize;
                if postfix != 0 {
                    let token: &[u8] = if self.byte(postfix) == b'!' {
                        b"!"
                    } else {
                        b"?"
                    };
                    self.emit_token_node(token, name_end, postfix + 1);
                }
                self.emit_signature(node, f)?;
                self.emit_function_body(f)?;
                self.exit_node(state);
            }
            // `emitAccessorDeclaration`
            (PropKind::Getter | PropKind::Setter, Some(ExprKind::Fn(f))) => {
                let keyword: &[u8] = match prop.kind {
                    PropKind::Getter => b"get",
                    _ => b"set",
                };
                let state = self.enter_node(child.pos, child.end);
                let at = self.emit_modifier_list(node, hir.prop_modifiers(p), true)?;
                self.emit_token(keyword, at, node);
                self.write_space();
                self.emit_property_name(p)?;
                self.emit_signature(node, f)?;
                self.emit_function_body(f)?;
                self.exit_node(state);
            }
            // `emitPropertyAssignment`: neither the modifiers nor the `?` are emitted.
            _ => {
                let state = self.enter_node(child.pos, child.end);
                self.emit_property_name(p)?;
                self.write(b": ");
                // "comment1" is a trailing comment of the token before the initializer.
                self.emit_trailing_comments_with_space_after(self.pos_of(prop.value));
                self.emit_expression(prop.value, P::Yield)?;
                self.exit_node(state);
            }
        }
        Ok(())
    }

    /// `emitPropertyName` for the name of the property `p` of an object literal. Returns its end.
    #[optimize(size)]
    pub(super) fn emit_property_name(&mut self, p: PropId) -> Result<usize, Stop> {
        let prop = &self.hir[p];
        // The name follows the modifiers, `get`, `set` and `*`.
        self.emit_name(prop.key, prop.name_kind, prop.pos as usize)
    }

    /// `emitPropertyName` for a name whose first token is at `start`. Returns its end.
    #[optimize(size)]
    pub(super) fn emit_name(
        &mut self,
        key: PropKey,
        name_kind: NameKind,
        start: usize,
    ) -> Result<usize, Stop> {
        let pos = self.pos_before(start);
        if self.byte(start) == b'[' && !matches!(name_kind, NameKind::Jsx) {
            // `emitComputedPropertyName`
            let (expression_end, literal) = match key {
                PropKey::Computed(e) => (self.end_of(e), None),
                // `["a"]`, `[0]`: the expression is a literal that the HIR has no node for.
                _ => {
                    let literal = self.skip_trivia(start + 1);
                    let literal_end = token_end(self.text, literal, false);
                    (literal_end, Some((literal, literal_end)))
                }
            };
            let end = self
                .token_after(b"]", expression_end)
                .unwrap_or(expression_end);
            let state = self.enter_node(pos, end);
            self.write(b"[");
            match (key, literal) {
                (PropKey::Computed(e), _) => self.emit_expression(e, P::Yield)?,
                (_, Some((literal, literal_end))) => {
                    let written = self.literal_name_text(key, literal, literal_end);
                    self.emit_leaf(start + 1, literal_end, &written);
                }
                _ => {}
            }
            self.write(b"]");
            self.exit_node(state);
            return Ok(end);
        }
        // A missing name has no text. One that declares nothing has no key: a private name outside a class, a bigint.
        let is_missing = match key {
            PropKey::None => !matches!(self.byte(start), b'#' | b'0'..=b'9'),
            // `""` is a name.
            PropKey::Name(name) => {
                name == known::empty && !matches!(self.byte(start), b'"' | b'\'')
            }
            _ => false,
        };
        if is_missing {
            return Ok(pos);
        }
        let end = token_end(self.text, start, false);
        let written = self.literal_name_text(key, start, end);
        self.emit_leaf(pos, end, &written);
        Ok(end)
    }

    /// `getTextOfNode`, `getLiteralTextOfNode`: the source text, or the value of a bigint or invalid numeric literal.
    #[optimize(size)]
    fn literal_name_text(&self, key: PropKey, start: usize, end: usize) -> Vec<u8> {
        let written = self.source(start, end);
        if !matches!(written.first(), Some(b'0'..=b'9' | b'.')) {
            return written.to_vec();
        }
        if written.ends_with(b"n") {
            return crate::json::bigint_token_value(written);
        }
        match key {
            PropKey::Name(name) if self.is_numeric_literal_written_as_value(written) => {
                self.c.atoms().bytes(name).to_vec()
            }
            _ => written.to_vec(),
        }
    }

    /// `emitIdentifierName`, `emitBindingIdentifier`. Returns `End()`: a missing one is where the token before it ends.
    #[optimize(size)]
    pub(super) fn emit_identifier(&mut self, name: Atom, start: usize) -> usize {
        let pos = self.pos_before(start);
        if name.is_none() || name == known::empty {
            return pos;
        }
        let end = token_end(self.text, start, false);
        self.emit_source(pos, end);
        end
    }

    // ───────────────────────────── modifiers ─────────────────────────────

    /// `Pos()` and `End()` of a modifier.
    #[optimize(size)]
    fn modifier_range(&self, modifier: &Modifier) -> Child {
        let end = match modifier.kind {
            ModifierKind::Decorator(e) => self.end_of(e),
            ModifierKind::Keyword(_) => self.c.end_of_token_at(self.file, modifier.pos) as usize,
        };
        Child {
            pos: self.pos_before(modifier.pos as usize),
            end,
        }
    }

    /// `greatestEnd(pos, modifiers)`: the end of the last modifier, even a decorator `emitModifierList` doesn't emit.
    #[optimize(size)]
    pub(super) fn end_of_modifiers(&self, modifiers: Span<ModifierId>, pos: usize) -> usize {
        match self.hir.modifier_list(modifiers).last() {
            Some(last) => pos.max(self.modifier_range(last).end),
            None => pos,
        }
    }

    /// `emitModifierLike`: `emitKeywordNode`, `emitDecorator`
    #[optimize(size)]
    fn emit_modifier_like(&mut self, modifier: &Modifier, range: Child) -> Emitted {
        match modifier.kind {
            ModifierKind::Keyword(flag) => {
                self.emit_leaf(range.pos, range.end, hir::modifier_text(flag).as_bytes());
            }
            ModifierKind::Decorator(e) => {
                let state = self.enter_node(range.pos, range.end);
                self.write(b"@");
                self.emit_expression(e, P::LeftHandSide)?;
                self.exit_node(state);
            }
        }
        Ok(())
    }

    /// `emitModifierList`. Returns what the reference returns: the end of the last modifier, or `Pos()` of the parent.
    #[optimize(size)]
    pub(super) fn emit_modifier_list(
        &mut self,
        parent: (usize, usize),
        modifiers: Span<ModifierId>,
        allow_decorators: bool,
    ) -> Result<usize, Stop> {
        let list = self.hir.modifier_list(modifiers);
        self.emit_modifiers(parent, list, allow_decorators)
    }

    /// `emitModifierList` for the modifiers `list`.
    #[optimize(size)]
    fn emit_modifiers(
        &mut self,
        parent: (usize, usize),
        list: &[Modifier],
        allow_decorators: bool,
    ) -> Result<usize, Stop> {
        let ranges: Vec<Child> = list.iter().map(|it| self.modifier_range(it)).collect();
        let (Some(first), Some(last)) = (ranges.first(), ranges.last()) else {
            return Ok(parent.0);
        };
        let is_decorator = |it: &Modifier| matches!(it.kind, ModifierKind::Decorator(_));
        let whole = Some((first.pos, last.end));
        if !list.iter().any(is_decorator) {
            self.emit_list(parent, whole, &ranges, lf::MODIFIERS, |printer, index| {
                printer.emit_modifier_like(&list[index], ranges[index])
            })?;
        } else if list.iter().all(is_decorator) {
            if !allow_decorators {
                return Ok(parent.0);
            }
            self.emit_list(parent, whole, &ranges, lf::DECORATORS, |printer, index| {
                printer.emit_modifier_like(&list[index], ranges[index])
            })?;
        } else {
            // "partition modifiers into contiguous chunks of `Modifier` or `Decorator`"
            let (mut last_mode, mut mode): (Option<bool>, Option<bool>) = (None, None);
            let (mut start, mut pos) = (0, 0);
            while start < list.len() {
                while pos < list.len() {
                    mode = Some(is_decorator(&list[pos]));
                    if last_mode.is_none() {
                        last_mode = mode;
                    } else if mode != last_mode {
                        break;
                    }
                    pos += 1;
                }
                let chunk = start..pos.min(list.len());
                if (allow_decorators || last_mode == Some(false)) && !chunk.is_empty() {
                    let format = match last_mode {
                        Some(false) => lf::MODIFIERS,
                        _ => lf::DECORATORS,
                    };
                    let range = (ranges[chunk.start].pos, ranges[chunk.end - 1].end);
                    self.emit_list_items(
                        parent,
                        range,
                        &ranges[chunk.clone()],
                        format,
                        &mut |printer, index| {
                            let at = chunk.start + index;
                            printer.emit_modifier_like(&list[at], ranges[at])
                        },
                    )?;
                }
                start = pos;
                last_mode = mode;
                pos += 1;
            }
        }
        Ok(parent.0.max(last.end))
    }

    /// `emitModifierList` for `async`, which the HIR keeps as a flag of a function expression or an arrow function.
    #[optimize(size)]
    fn emit_async_modifier(&mut self, parent: (usize, usize), is_async: bool) -> usize {
        let start = self.skip_trivia(parent.0);
        let Some(end) = self.token_end_at(b"async", start).filter(|_| is_async) else {
            return parent.0;
        };
        let modifier = Child { pos: parent.0, end };
        let whole = Some((modifier.pos, modifier.end));
        // The one emitter of the list cannot fail.
        let _ = self.emit_list(parent, whole, &[modifier], lf::MODIFIERS, |printer, _| {
            printer.emit_leaf(modifier.pos, modifier.end, b"async");
            Ok(())
        });
        end
    }

    // ───────────────────────────── parameters and binding names ─────────────────────────────

    /// The parameters of `f` in the order of the source: the `this` parameter is the first.
    #[optimize(size)]
    fn parameters_of(&self, f: FnId) -> Vec<ParamId> {
        let func = &self.hir[f];
        let this = (func.this_param.is_some()
            && !self.hir[func.this_param].flags.contains(Flags::REPARSED))
        .then_some(func.this_param);
        this.into_iter().chain(func.params.iter()).collect()
    }

    /// `emitList` for parameters. `open`: where the list starts, after its bracket, and whether the source has one.
    #[optimize(size)]
    fn emit_parameter_list(
        &mut self,
        parent: (usize, usize),
        f: FnId,
        (open, has_bracket): (usize, bool),
        format: u32,
    ) -> Emitted {
        let hir = self.hir;
        let parameters = self.parameters_of(f);
        let children: Vec<Child> = parameters
            .iter()
            .map(|&p| Child {
                pos: hir[p].loc.pos as usize,
                end: hir[p].loc.end as usize,
            })
            .collect();
        // The format writes no trailing comma, so only an empty list is asked where it ends: after the skipped tokens.
        let last = match children.last() {
            Some(last) => last.end,
            None if has_bracket => self.end_of_skipped_after(open, ListKind::Parameters),
            None => open,
        };
        self.emit_list(
            parent,
            Some((open, last)),
            &children,
            format,
            |printer, index| printer.emit_parameter(parameters[index]),
        )
    }

    /// Where the list of the parameters of `f` starts, after its `(` or its `[`, and whether the source has that token.
    #[optimize(size)]
    fn start_of_parameters(&self, f: FnId, open: u8) -> (usize, bool) {
        let hir = self.hir;
        let func = &hir[f];
        // `createMissingList`: the anchor is the token after such a list in a function type, else the byte before it.
        if func.kind != FnKind::Arrow {
            let is_there = self.byte(func.anchor as usize) == open;
            let start = match func.kind {
                FnKind::FunctionType | FnKind::ConstructorType if !is_there => {
                    self.pos_before(func.anchor as usize)
                }
                _ => func.anchor as usize + 1,
            };
            return (start, is_there);
        }
        match self.parameters_of(f).first() {
            Some(&first) => (hir[first].loc.pos as usize, false),
            None => {
                // A list that is missing is where the parser was after the type parameters, if there are any.
                let mut at = self.skip_trivia(self.pos_before(func.start as usize));
                if let Some(end) = self.end_of_type_parameters(func.type_params) {
                    at = self.token_after(b">", end).unwrap_or(end);
                } else if func.flags.contains(Flags::ASYNC)
                    && let Some(end) = self.token_end_at(b"async", at)
                {
                    at = end;
                } else {
                    at = self.pos_before(at);
                }
                match self.token_after(&[open], at) {
                    Some(open_end) => (open_end, true),
                    None => (at, false),
                }
            }
        }
    }

    /// Whether the scanner reads `</` as one token: `LanguageVariantJSX`.
    #[optimize(size)]
    pub(super) fn scans_jsx(&self) -> bool {
        matches!(self.hir.kind, hir::FileKind::Tsx | hir::FileKind::Json) || self.hir.is_js
    }

    /// `End()` of the list of type parameters, if any: `emitTypeParameters` asks whether it `HasTrailingComma()`.
    #[optimize(size)]
    pub(super) fn end_of_type_parameters(&self, type_params: Span<TypeParamId>) -> Option<usize> {
        let last = type_params.iter().next_back()?;
        let parameter = &self.hir[last];
        let end = self.c.end_of_type_param(self.file, last) as usize;
        // One without a name and without a token: `<T, in>`.
        let is_empty = parameter.end <= parameter.start;
        Some(self.end_of_list_after(end, is_empty, ListKind::TypeParameters))
    }

    /// `isListTerminator(kind)` for the token at `token`.
    #[optimize(size)]
    fn is_list_terminator(&self, kind: ListKind, token: usize) -> bool {
        let is_word = |word: &[u8]| self.token_end_at(word, token).is_some();
        match kind {
            ListKind::Parameters => matches!(self.byte(token), b')' | b']'),
            ListKind::TypeParameters => {
                matches!(self.byte(token), b'>' | b'(' | b'{')
                    || is_word(b"extends")
                    || is_word(b"implements")
            }
        }
    }

    /// `parseDelimitedList`: `End()` of a list after its last element. It consumes a token after an `is_empty` one.
    #[optimize(size)]
    pub(super) fn end_of_list_after(&self, after: usize, is_empty: bool, kind: ListKind) -> usize {
        let mut at = after;
        let token = self.skip_trivia(at);
        if let Some(comma_end) = self.token_after(b",", at) {
            at = comma_end;
        } else if is_empty && !self.is_list_terminator(kind, token) {
            at = token_end(self.text, token, self.scans_jsx()).max(at);
        }
        self.end_of_skipped_after(at, kind)
    }

    /// `abortParsingListOrMoveToNextToken`: where the parser is after the tokens that a list of `kind` skips from `at`.
    #[optimize(size)]
    pub(super) fn end_of_skipped_after(&self, at: usize, kind: ListKind) -> usize {
        let skipped = &self.hir.after_skipped;
        let mut at = at;
        loop {
            let token = self.skip_trivia(at);
            let end = token_end(self.text, token, self.scans_jsx());
            let next = u32::try_from(self.skip_trivia(end)).unwrap_or(u32::MAX);
            let is_skipped = end > token
                && skipped.binary_search(&next).is_ok()
                && !self.is_list_terminator(kind, token);
            if !is_skipped {
                return at;
            }
            at = end;
        }
    }

    /// `emitParameters(parentNode, parameters)`. `parent`: `Pos()` and `End()` of the node that has the parameters.
    #[optimize(size)]
    pub(super) fn emit_parameters(&mut self, parent: (usize, usize), f: FnId) -> Emitted {
        let open = self.start_of_parameters(f, b'(');
        self.emit_parameter_list(parent, f, open, lf::PARAMETERS)
    }

    /// `emitParametersForArrow`
    #[optimize(size)]
    pub(super) fn emit_parameters_for_arrow(&mut self, parent: (usize, usize), f: FnId) -> Emitted {
        let hir = self.hir;
        let func = &hir[f];
        // `canEmitSimpleArrowHead`
        let parameters = self.parameters_of(f);
        let is_simple = match parameters[..] {
            [only] => {
                let parameter = &hir[only];
                let name = hir.pats.get(parameter.pat.idx());
                parameter.loc.pos as usize == parent.0
                    && func.kind == FnKind::Arrow
                    && func.type_params.is_empty()
                    && func.ret.is_none()
                    && !func.flags.contains(Flags::ASYNC)
                    && hir.param_modifiers(only).is_empty()
                    && !parameter.flags.intersects(Flags::REST | Flags::OPTIONAL)
                    && parameter.ty.is_none()
                    && parameter.default.is_none()
                    && name.is_some_and(|it| matches!(it.kind, PatKind::Ident(_)))
                    // "parameters may not have a trailing comma"
                    && self.byte(self.skip_trivia(parameter.loc.end as usize)) != b','
            }
            _ => false,
        };
        if is_simple {
            let format = lf::PARAMETERS & !lf::PARENTHESIS;
            return self.emit_parameter_list(parent, f, (parent.0, false), format);
        }
        self.emit_parameters(parent, f)
    }

    /// `emitParametersForIndexSignature`
    #[optimize(size)]
    pub(super) fn emit_parameters_for_index_signature(
        &mut self,
        parent: (usize, usize),
        f: FnId,
    ) -> Emitted {
        let open = self.start_of_parameters(f, b'[');
        self.emit_parameter_list(parent, f, open, lf::INDEX_SIGNATURE_PARAMETERS)
    }

    /// `emitParameter`
    #[optimize(size)]
    fn emit_parameter(&mut self, p: ParamId) -> Emitted {
        let hir = self.hir;
        let parameter = &hir[p];
        let node = (parameter.loc.pos as usize, parameter.loc.end as usize);
        let state = self.enter_node(node.0, node.1);
        let mut at = match self.modifiers_of_this_parameter(p) {
            Some(modifiers) => self.emit_modifiers(node, &modifiers, true)?,
            None => self.emit_modifier_list(node, hir.param_modifiers(p), true)?,
        };
        if parameter.flags.contains(Flags::REST) {
            let dots_end = self.token_after(b"...", at).unwrap_or(at);
            self.emit_token_node(b"...", at, dots_end);
            at = dots_end;
        }
        self.emit_binding_name(parameter.pat)?;
        at = at.max(self.end_of_binding_name(parameter.pat));
        if parameter.flags.contains(Flags::OPTIONAL) {
            let question_end = self.token_after(b"?", at).unwrap_or(at);
            self.emit_token_node(b"?", at, question_end);
            at = question_end;
        }
        self.emit_type_annotation(parameter.ty)?;
        at = self.end_of_type_annotation(parameter.ty, at);
        self.emit_initializer(parameter.default, at, node)?;
        self.exit_node(state);
        Ok(())
    }

    /// `node.Modifiers()` of a `this` parameter `p`. The HIR does not keep them: they are read from the source.
    #[optimize(size)]
    fn modifiers_of_this_parameter(&self, p: ParamId) -> Option<Vec<Modifier>> {
        let hir = self.hir;
        let parameter = &hir[p];
        let name = hir.pats.get(parameter.pat.idx())?;
        if !matches!(name.kind, PatKind::Ident(known::this))
            || parameter.pos >= name.pos
            || !hir.param_modifiers(p).is_empty()
        {
            return None;
        }
        let (mut at, name_start) = (parameter.pos as usize, name.pos as usize);
        let mut modifiers = Vec::new();
        while at < name_start {
            let pos = at as u32;
            if self.byte(at) == b'@' {
                // The first token of the expression is after the `@`, and after its parentheses.
                let is_own = |it: &&Stmt| {
                    matches!(it.kind, StmtKind::Expr(_))
                        && it.loc.end == 0
                        && (at..name_start).contains(&(it.start as usize))
                        && hir.stray_decorators.iter().any(|stray| stray.0 == it.start)
                };
                let decorator = hir.stmts.iter().filter(is_own).min_by_key(|it| it.start)?;
                let StmtKind::Expr(e) = decorator.kind else {
                    return None;
                };
                let kind = ModifierKind::Decorator(e);
                modifiers.push(Modifier { kind, pos });
                at = self.skip_trivia(self.end_of(e).max(at + 1));
                continue;
            }
            let end = word_end(self.text, at);
            if end == at {
                return None;
            }
            let word = super::spans::unescaped_identifier(self.source(at, end));
            let mut flags = Flags::all().iter();
            let flag = flags.find(|&flag| hir::modifier_text(flag).as_bytes() == &*word)?;
            let kind = ModifierKind::Keyword(flag);
            modifiers.push(Modifier { kind, pos });
            at = self.skip_trivia(end);
        }
        Some(modifiers)
    }

    /// `End()` of the type and its parentheses, in a declaration whose name, or the token after it, ends at `after`.
    #[optimize(size)]
    pub(super) fn end_of_type_annotation(&self, ty: TypeNodeId, after: usize) -> usize {
        if ty.is_none() {
            return after;
        }
        let end = self.c.end_of_type_node_from(self.file, ty, after as u32);
        after.max(end as usize)
    }

    /// `emitInitializer(node, equalTokenPos, contextNode)`
    #[optimize(size)]
    pub(super) fn emit_initializer(
        &mut self,
        initializer: ExprId,
        equals_pos: usize,
        node: (usize, usize),
    ) -> Emitted {
        if initializer.is_none() {
            return Ok(());
        }
        self.write_space();
        self.emit_token(b"=", equals_pos, node);
        self.write_space();
        self.emit_expression(initializer, P::Yield)
    }

    /// `End()` of a binding name. One that is missing ends where it starts.
    #[optimize(size)]
    pub(super) fn end_of_binding_name(&self, pat: PatId) -> usize {
        self.hir.pats.get(pat.idx()).map_or(0, |it| it.end as usize)
    }

    /// `emitBindingName`
    #[optimize(size)]
    pub(super) fn emit_binding_name(&mut self, pat: PatId) -> Emitted {
        let hir = self.hir;
        let Some(&Pat {
            kind,
            pos: start,
            end,
        }) = hir.pats.get(pat.idx())
        else {
            return Ok(());
        };
        if self.c.is_stack_low_for_printing() {
            return Err(Stop::OutOfStack);
        }
        let (start, end) = (start as usize, end as usize);
        let pos = self.pos_before(start);
        match kind {
            // A name that is missing is an identifier without text, where the token before it ends.
            PatKind::Missing => {}
            PatKind::Ident(_) if start >= end => {}
            // `emitBindingIdentifier`
            PatKind::Ident(_) => self.emit_source(pos, end),
            // `emitObjectBindingPattern`
            PatKind::Object(props) => {
                let state = self.enter_node(pos, end);
                self.write(b"{");
                let children: Vec<Child> = props
                    .iter()
                    .map(|p| Child {
                        pos: self.pos_before(hir[p].pos as usize),
                        end: hir[p].end as usize,
                    })
                    .collect();
                let list = self.list_range(start + 1, b'}', children.last().map(|it| it.end), end);
                let format = lf::OBJECT_BINDING_PATTERN_ELEMENTS;
                self.emit_list(
                    (pos, end),
                    Some(list),
                    &children,
                    format,
                    |printer, index| {
                        let p = PatPropId(props.start + index as u32);
                        printer.emit_object_binding_element(p, children[index])
                    },
                )?;
                self.write(b"}");
                self.exit_node(state);
            }
            // `emitArrayBindingPattern`
            PatKind::Array(elements) => {
                let state = self.enter_node(pos, end);
                self.write(b"[");
                let children: Vec<Child> = elements
                    .iter()
                    .map(|element| {
                        let element = &hir[element];
                        // An element that is omitted is where the token before its comma ends.
                        let is_omitted = hir
                            .pats
                            .get(element.pat.idx())
                            .is_some_and(|it| matches!(it.kind, PatKind::Missing));
                        Child {
                            pos: match is_omitted {
                                true => element.end as usize,
                                false => self.pos_before(element.start as usize),
                            },
                            end: element.end as usize,
                        }
                    })
                    .collect();
                let list = self.list_range(start + 1, b']', children.last().map(|it| it.end), end);
                let format = lf::ARRAY_BINDING_PATTERN_ELEMENTS;
                self.emit_list(
                    (pos, end),
                    Some(list),
                    &children,
                    format,
                    |printer, index| {
                        let element = PatElemId(elements.start + index as u32);
                        printer.emit_array_binding_element(element, children[index])
                    },
                )?;
                self.write(b"]");
                self.exit_node(state);
            }
        }
        Ok(())
    }

    /// `emitBindingElement` for an element of an object binding pattern.
    #[optimize(size)]
    fn emit_object_binding_element(&mut self, p: PatPropId, child: Child) -> Emitted {
        let hir = self.hir;
        let property = &hir[p];
        let node = (child.pos, child.end);
        let state = self.enter_node(child.pos, child.end);
        if property.is_rest {
            let dots_end = self.token_after(b"...", child.pos).unwrap_or(child.pos);
            self.emit_token_node(b"...", child.pos, dots_end);
        }
        // A name that is missing is no binding: the binding after it is missing too.
        let is_shorthand = hir
            .pats
            .get(property.value.idx())
            .is_some_and(|it| it.pos == property.key_pos && it.end > it.pos);
        if !is_shorthand && !matches!(property.key, PropKey::None) {
            self.emit_name(property.key, property.name_kind, property.key_pos as usize)?;
            self.write(b": ");
        }
        if property.value.is_some() {
            self.emit_binding_name(property.value)?;
            let name_end = self.end_of_binding_name(property.value);
            self.emit_initializer(property.default, name_end, node)?;
        }
        self.exit_node(state);
        Ok(())
    }

    /// `emitBindingElement` for an element of an array binding pattern.
    #[optimize(size)]
    fn emit_array_binding_element(&mut self, element: PatElemId, child: Child) -> Emitted {
        let hir = self.hir;
        let element = &hir[element];
        let node = (child.pos, child.end);
        let state = self.enter_node(child.pos, child.end);
        if element.is_rest {
            let dots_end = self.token_after(b"...", child.pos).unwrap_or(child.pos);
            self.emit_token_node(b"...", child.pos, dots_end);
        }
        let is_omitted = hir
            .pats
            .get(element.pat.idx())
            .is_some_and(|it| matches!(it.kind, PatKind::Missing));
        if !is_omitted && element.pat.is_some() {
            self.emit_binding_name(element.pat)?;
            let name_end = self.end_of_binding_name(element.pat);
            self.emit_initializer(element.default, name_end, node)?;
        }
        self.exit_node(state);
        Ok(())
    }

    // ───────────────────────────── functions ─────────────────────────────

    /// `emitFunctionExpression`, `emitArrowFunction` for `e`, which is the function `f`. `pos`: `Pos()` of `e`.
    #[optimize(size)]
    pub(super) fn emit_function_expression(&mut self, e: ExprId, f: FnId, pos: usize) -> Emitted {
        if self.c.is_stack_low_for_printing() {
            return Err(Stop::OutOfStack);
        }
        let hir = self.hir;
        // The arrow functions of `a => b => c` are nested as deeply as the chain is long: each is left after the last.
        let mut states: Vec<NodeState> = Vec::new();
        let (mut e, mut f, mut pos) = (e, f, pos);
        loop {
            let func = &hir[f];
            let node = (pos, hir[e].end as usize);
            states.push(self.enter_node(node.0, node.1));
            let is_async = func.flags.contains(Flags::ASYNC);
            if func.kind != FnKind::Arrow {
                let at = self.emit_async_modifier(node, is_async);
                self.emit_function_after_modifiers(f, at, node)?;
                break;
            }
            self.emit_async_modifier(node, is_async);
            self.emit_type_parameters(node, func.type_params, true)?;
            self.emit_parameters_for_arrow(node, f)?;
            self.emit_type_annotation(func.ret)?;
            self.write_space();
            // A `=>` that is missing is a token without text, where the token before it ends.
            let arrow = func.anchor as usize;
            match self.token_end_at(b"=>", arrow) {
                Some(arrow_end) => self.emit_token_node(b"=>", self.pos_before(arrow), arrow_end),
                None => self.emit_token_node(b"=>", arrow, arrow),
            }
            self.write_space();
            // `emitConciseBody`
            match func.body {
                FnBody::Block(statements) => self.emit_function_block(f, statements)?,
                FnBody::Expr(body) if self.starts_with_object_literal(body) => {
                    // "Wrap in ParenthesizedExpression": in parentheses that have `Loc` of the body.
                    let body_node = (self.pos_of(body), self.end_of(body));
                    let parentheses = self.enter_node(body_node.0, body_node.1);
                    self.emit_token(b"(", body_node.0, body_node);
                    self.emit_expression(body, P::Comma)?;
                    self.emit_token(b")", body_node.1, body_node);
                    self.exit_node(parentheses);
                }
                FnBody::Expr(body) => {
                    // `emitExpression(node, OperatorPrecedenceYield)` adds no parentheses to an arrow function.
                    if let Some(inner) = self.arrow_function_of(body) {
                        (e, f, pos) = (body, inner, self.pos_of(body));
                        continue;
                    }
                    match self.private_name_as_body(f, body) {
                        Some(name_end) => self.emit_source(arrow, name_end),
                        None => self.emit_expression(body, P::Yield)?,
                    }
                }
                FnBody::None => {}
            }
            break;
        }
        while let Some(state) = states.pop() {
            self.exit_node(state);
        }
        Ok(())
    }

    /// `End()` of the `#b` that `parseIdentifier` takes as the body of `(a) #b`: a missing expression in the HIR.
    #[optimize(size)]
    fn private_name_as_body(&self, f: FnId, body: ExprId) -> Option<usize> {
        let hir = self.hir;
        let arrow = hir[f].anchor as usize;
        let expression = hir.exprs.get(body.idx())?;
        let end = expression.end as usize;
        let is_name = matches!(expression.kind, ExprKind::Missing)
            && !hir::is_parenthesized(hir, body)
            && self.token_end_at(b"=>", arrow).is_none()
            && self.byte(self.skip_trivia(arrow)) == b'#'
            && end > arrow;
        is_name.then_some(end)
    }

    /// The arrow function that the expression `e` is, if it is one without parentheses.
    #[optimize(size)]
    fn arrow_function_of(&self, e: ExprId) -> Option<FnId> {
        let hir = self.hir;
        match hir.exprs.get(e.idx())?.kind {
            ExprKind::Fn(f) if hir[f].kind == FnKind::Arrow && !hir::is_parenthesized(hir, e) => {
                Some(f)
            }
            _ => None,
        }
    }

    /// `emitFunctionDeclaration`, `emitFunctionExpression` for the function `f` after its modifiers, which end at `at`.
    #[optimize(size)]
    pub(super) fn emit_function_after_modifiers(
        &mut self,
        f: FnId,
        at: usize,
        node: (usize, usize),
    ) -> Emitted {
        let func = &self.hir[f];
        self.write(b"function");
        if func.flags.contains(Flags::GENERATOR) {
            let keyword = self.skip_trivia(at);
            let keyword_end = self.token_end_at(b"function", keyword);
            let keyword_end = keyword_end.unwrap_or(keyword + b"function".len());
            let asterisk_end = self.token_after(b"*", keyword_end).unwrap_or(keyword_end);
            self.emit_token_node(b"*", keyword_end, asterisk_end);
        }
        self.write_space();
        self.emit_identifier(func.name, func.name_pos as usize);
        self.emit_signature(node, f)?;
        self.emit_function_body(f)
    }

    /// `emitSignature` for the function-like `f`. `node`: its `Pos()` and `End()`.
    #[optimize(size)]
    pub(super) fn emit_signature(&mut self, node: (usize, usize), f: FnId) -> Emitted {
        let func = &self.hir[f];
        self.emit_type_parameters(node, func.type_params, false)?;
        self.emit_parameters(node, f)?;
        self.emit_type_annotation(func.ret)
    }

    /// `GetLeftmostExpression(node, false)`: the expression that `e` starts with, and that starts with no other.
    #[optimize(size)]
    pub(super) fn leftmost_expression(&self, mut e: ExprId) -> ExprId {
        let hir = self.hir;
        loop {
            if hir::is_parenthesized(hir, e) {
                return e;
            }
            e = match hir.exprs.get(e.idx()).map(|it| it.kind) {
                Some(ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    operand,
                }) => operand,
                Some(ExprKind::Binary { left, .. }) => left,
                Some(ExprKind::Assign { target, .. }) => target,
                Some(ExprKind::Cond { test, .. }) => test,
                Some(ExprKind::Call(call) | ExprKind::TaggedTemplate(call)) => hir[call].callee,
                // `import.x` is a `MetaProperty`.
                Some(ExprKind::Dot { obj, .. }) if hir.is_import_keyword(obj) => return e,
                Some(ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. }) => obj,
                // `<T>e` is a `TypeAssertionExpression`.
                Some(ExprKind::As { expr, .. } | ExprKind::AsConst(expr))
                    if self.is_type_assertion(e, expr) =>
                {
                    return e;
                }
                Some(
                    ExprKind::As { expr, .. }
                    | ExprKind::AsConst(expr)
                    | ExprKind::Satisfies { expr, .. }
                    | ExprKind::NonNull(expr),
                ) => expr,
                _ => return e,
            };
        }
    }

    /// Whether the leftmost expression of `e` is an `ObjectLiteralExpression`.
    #[optimize(size)]
    fn starts_with_object_literal(&self, e: ExprId) -> bool {
        let hir = self.hir;
        let leftmost = self.leftmost_expression(e);
        !hir::is_parenthesized(hir, leftmost)
            && matches!(
                hir.exprs.get(leftmost.idx()).map(|it| it.kind),
                Some(ExprKind::Object(_))
            )
    }

    // ───────────────────────────── function bodies ─────────────────────────────

    /// `emitFunctionBodyNode(node.Body)` for `f`: a space and the block, or a semicolon for a function without one.
    #[optimize(size)]
    pub(super) fn emit_function_body(&mut self, f: FnId) -> Emitted {
        let func = &self.hir[f];
        match func.body {
            FnBody::Block(statements) => {
                self.write_space();
                self.emit_function_block(f, statements)
            }
            // A block whose `{` is missing is where the signature ends, and so is its list.
            FnBody::None if func.flags.contains(Flags::MISSING_BODY) => {
                self.write_space();
                let at = self.c.end_of_fn(self.file, f) as usize;
                let block = BodyBlock {
                    pos: at,
                    end: at,
                    list: (at, at),
                    is_multi_line: false,
                };
                self.emit_body_block(&block, &[])
            }
            FnBody::None | FnBody::Expr(_) => {
                self.write(b";");
                Ok(())
            }
        }
    }

    /// `emitFunctionBody` for the block of `f`, whose statements are `statements`.
    #[optimize(size)]
    fn emit_function_block(&mut self, f: FnId, statements: IdList<StmtId>) -> Emitted {
        let hir = self.hir;
        let statements = self.statements_of(statements);
        let open = match hir.body_starts.binary_search_by_key(&f.0, |body| body.0.0) {
            Ok(at) => hir.body_starts[at].1,
            // A static block.
            Err(_) => hir[f].anchor,
        } as usize;
        let pos = self.pos_before(open);
        // `ParseFlagsIgnoreMissingOpenBrace`: the list of a block whose `{` is missing starts where the block does.
        let list_pos = match self.byte(open) {
            b'{' => open + 1,
            _ => pos,
        };
        let last = statements.last().map(|&last| self.end_of_statement(last));
        let function_end = self.c.end_of_fn(self.file, f) as usize;
        let end = self.end_of_block(function_end, last.unwrap_or(list_pos));
        let block = BodyBlock {
            pos,
            end,
            list: self.list_range(list_pos, b'}', last, end),
            // `hasPrecedingLineBreak` of the token after the `{`.
            is_multi_line: self.is_on_next_line(list_pos, list_pos),
        };
        self.emit_body_block(&block, &statements)
    }

    /// `emitFunctionBody`
    #[optimize(size)]
    fn emit_body_block(&mut self, block: &BodyBlock, statements: &[StmtId]) -> Emitted {
        let node = (block.pos, block.end);
        self.write(b"{");
        self.increase_indent();
        self.emit_detached_comments(block.list.0);
        // `emitPrologueDirectives`
        let is_directive = |s: &&StmtId| self.is_prologue_directive(**s);
        let directives = statements.iter().take_while(is_directive).count();
        let (directives, rest) = statements.split_at(directives);
        for &directive in directives {
            self.write_line();
            self.emit_statement(directive)?;
        }
        // `shouldEmitBlockFunctionBodyOnSingleLine`: what is between the braces of a body on one line is on that line.
        let is_on_single_line =
            directives.is_empty() && !block.is_multi_line && self.range_is_on_single_line(node);
        if is_on_single_line {
            self.decrease_indent();
            let format = lf::SINGLE_LINE_FUNCTION_BODY_STATEMENTS;
            self.emit_statement_list(node, block.list, rest, format)?;
            self.increase_indent();
        } else {
            let format = lf::MULTI_LINE_FUNCTION_BODY_STATEMENTS;
            self.emit_statement_list(node, block.list, rest, format)?;
        }
        // `emitDetachedCommentsAfterStatementList`
        let written = self.writer.text.len();
        self.emit_leading_comments(block.list.1);
        if self.writer.text.len() != written && !self.writer.is_at_start_of_line {
            self.write_line();
        }
        self.decrease_indent();
        // `tefNoComments`
        self.write(b"}");
        Ok(())
    }

    /// `IsPrologueDirective`
    #[optimize(size)]
    fn is_prologue_directive(&self, s: StmtId) -> bool {
        let hir = self.hir;
        let Some(StmtKind::Expr(e)) = hir.stmts.get(s.idx()).map(|it| it.kind) else {
            return false;
        };
        // A template is no `StringLiteral`.
        matches!(hir[e].kind, ExprKind::String(_))
            && !hir::is_parenthesized(hir, e)
            && matches!(self.byte(hir[e].pos as usize), b'"' | b'\'')
    }

    // ───────────────────────────── detached comments ─────────────────────────────

    /// The number of line breaks of the source from `from` to `to`.
    #[optimize(size)]
    fn line_breaks_between(&self, from: usize, to: usize) -> usize {
        let (mut at, mut count) = (from, 0);
        while at < to.min(self.text.len()) {
            at += match line_break_len(self.text, at) {
                0 => 1,
                _ if self.source(at, at + 2) == b"\r\n" => {
                    count += 1;
                    2
                }
                len => {
                    count += 1;
                    len
                }
            };
        }
        count
    }

    /// `CommentRange.HasTrailingNewLine` for a comment that ends at `end`.
    #[optimize(size)]
    fn has_trailing_new_line(&self, end: usize) -> bool {
        let mut at = end;
        while matches!(self.byte(at), b' ' | b'\t' | 0x0B | 0x0C) {
            at += 1;
        }
        line_break_len(self.text, at) != 0
    }

    /// `emitDetachedCommentsAndUpdateCommentsInfo` for a list of statements whose `Pos()` is `pos`.
    #[optimize(size)]
    fn emit_detached_comments(&mut self, pos: usize) {
        // "removeComments is true, only reserve pinned comment at the top of file"
        if self.comments_disabled || pos > self.text.len() {
            return;
        }
        let mut detached: Vec<(usize, usize)> = Vec::new();
        for comment in get_leading_comment_ranges(self.text, pos) {
            // "There was a blank line between the last comment and this comment."
            let last = detached.last();
            if last.is_some_and(|last| self.line_breaks_between(last.1, comment.0) >= 2) {
                break;
            }
            detached.push(comment);
        }
        let Some(&(_, end)) = detached.last() else {
            return;
        };
        // "Make sure there is at least one blank line between it and the node."
        if self.line_breaks_between(end, self.skip_trivia(pos)) < 2 {
            return;
        }
        let mut has_written = false;
        for &comment in &detached {
            // `shouldWriteComment`: the text of one that is not written is empty. Its separator is for another caller.
            let mut written = comments_text(self.text, vec![comment], self.writer.indent);
            let Some(last) = bun_core::strings::last_index_of_char(&written, b'/') else {
                continue;
            };
            written.truncate(last + 1);
            // `shouldEmitNewLineBeforeLeadingCommentOfPosition`
            if !std::mem::replace(&mut has_written, true) && !self.on_same_line(pos, comment.0) {
                self.write_line();
            }
            self.write(&written);
            match self.has_trailing_new_line(comment.1) {
                true => self.write_line(),
                false => self.write_space(),
            }
        }
        self.detached_comments.push((pos, end));
    }
}
