use super::writer::{TreeWriter, UnsupportedNode, Written};
use bun_ast::op::{Level, TABLE};
use bun_ast::{E, Expr, ExprData, ExprTag, G, Loc, LocRef, OpCode, OptionalChain, Ref, flags};
use bun_core::identifier::is_identifier;
use bun_core::strings::{
    contains_char, index_of_char_usize, is_valid_utf8, wtf8_to_utf16, wtf16_to_wtf8,
};
use bun_lint_react_compiler::code_generation::SymbolOrigin;
use bun_sema::atom::{Atom, known, number_to_string};
use bun_sema::hir::{
    BinOp, Branches, Call, Chain, ExprFlags, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, Func,
    IdList, NameKind, Param, ParamId, PatKind, Prop, PropKey, PropKind, Span, TemplatePart,
    TextRange, TypeNodeId, UnOp, rare,
};
use std::borrow::Cow;

type Range = (u32, u32);

enum Operator {
    Unary(UnOp),
    Binary(BinOp),
    Assignment(Option<BinOp>),
}

#[derive(Copy, Clone)]
struct FunctionParts<'e> {
    kind: FnKind,
    flags: Flags,
    name: Option<LocRef>,
    parameters: &'e [G::Arg],
    parameter_flags: flags::FunctionSet,
    body: &'e G::FnBody,
}

impl TreeWriter<'_, '_> {
    pub(super) fn write_expression(&mut self, expression: &Expr) -> Written<ExprId> {
        if !self.stack.is_safe_to_recurse() {
            return Err(UnsupportedNode("nesting"));
        }
        let loc = expression.loc;
        let range = self.range_of(loc);
        match &expression.data {
            ExprData::EIdentifier(E::Identifier { ref_ })
            | ExprData::EImportIdentifier(E::ImportIdentifier { ref_ })
            | ExprData::ECommonjsExportIdentifier(E::CommonJSExportIdentifier { ref_ }) => {
                Ok(self.write_identifier(*ref_, loc))
            }
            ExprData::EUndefined(_) => Ok(self.write_undefined(range)),
            ExprData::ENull(_) => Ok(self.add_expression_at(ExprKind::Null, range)),
            ExprData::EBoolean(boolean) | ExprData::EBranchBoolean(boolean) => {
                Ok(self.write_boolean(boolean.value, range))
            }
            ExprData::EThis(_) => Ok(self.add_expression_at(ExprKind::This, range)),
            ExprData::ESuper(_) => Ok(self.add_expression_at(ExprKind::Super, range)),
            ExprData::EMissing(_) => Ok(self.add_expression_at(ExprKind::Missing, range)),
            ExprData::ENumber(number) => Ok(self.write_number_literal(number.value(), range)),
            ExprData::EBigInt(big_int) => {
                let digits = self.atoms.intern(big_int.value.slice());
                Ok(self.add_expression_at(ExprKind::BigInt(digits), range))
            }
            ExprData::EString(text) => Ok(self.write_string(text, loc)),
            ExprData::ERegExp(regexp) => {
                let pattern = self.atoms.intern(regexp.pattern());
                let flags = self.atoms.intern(regexp.flags());
                Ok(self.add_expression_at(ExprKind::Regex { pattern, flags }, range))
            }
            ExprData::ETemplate(template) => self.write_template(template, loc),
            ExprData::EArray(array) => {
                let items = self.write_expression_list(&array.items)?;
                Ok(self.add_expression_at(ExprKind::Array(items), range))
            }
            ExprData::EObject(object) => self.write_object(object, loc),
            ExprData::ESpread(spread) => {
                let value = self.write_operand(&spread.value, Level::Comma)?;
                Ok(self.add_expression_at(ExprKind::Spread(value), range))
            }
            ExprData::EDot(dot) => self.write_dot(dot, loc),
            ExprData::EIndex(index) => self.write_index(index, loc),
            ExprData::ECall(call) => self.write_call(call, loc),
            ExprData::ENew(new) => self.write_new(new, loc),
            ExprData::EUnary(unary) => self.write_unary(unary, loc),
            ExprData::EBinary(binary) => self.write_binary(binary, loc),
            ExprData::EIf(conditional) => self.write_conditional(conditional, loc),
            ExprData::EAwait(awaited) => {
                let value = self.write_operand(&awaited.value, Level::Prefix.sub(1))?;
                Ok(self.add_expression_at(ExprKind::Await(value), range))
            }
            ExprData::EYield(yielded) => self.write_yield(yielded, loc),
            ExprData::EFunction(function) => {
                let id = self.write_function_expression(&function.func, FnKind::Expr, loc)?;
                Ok(self.add_expression_at(ExprKind::Fn(id), range))
            }
            ExprData::EArrow(arrow) => self.write_arrow(arrow, loc),
            ExprData::EImport(import) if import.is_import_record_null() => {
                self.write_import_call(import, loc)
            }
            ExprData::EImportMeta(_) => {
                self.file.rare_syntax |= rare::IMPORT_META;
                Ok(self.add_expression_at(ExprKind::ImportMeta, range))
            }
            ExprData::ENewTarget(_) => {
                self.file.rare_syntax |= rare::NEW_TARGET;
                let name = self.atoms.intern(b"target");
                Ok(self.add_expression_at(ExprKind::NewTarget(name), range))
            }
            ExprData::EClass(_)
            | ExprData::EJsxElement(_)
            | ExprData::EObjectJSON(_)
            | ExprData::EArrayJSON(_)
            | ExprData::EImport(_)
            | ExprData::EPrivateIdentifier(_)
            | ExprData::ERequireString(_)
            | ExprData::ERequireResolveString(_)
            | ExprData::ERequireCallTarget
            | ExprData::ERequireResolveCallTarget
            | ExprData::EImportMetaMain(_)
            | ExprData::ERequireMain
            | ExprData::ESpecial(_)
            | ExprData::EInlinedEnum(_)
            | ExprData::ENameOfSymbol(_) => Err(unsupported(expression.data.tag())),
        }
    }

    pub(super) fn write_function_expression(
        &mut self,
        function: &G::Fn,
        kind: FnKind,
        loc: Loc,
    ) -> Written<FnId> {
        let parts = FunctionParts {
            kind,
            flags: function_flags(function.flags),
            name: function.name,
            parameters: function.args.slice(),
            parameter_flags: function.flags,
            body: &function.body,
        };
        self.add_function_record(parts, loc)
    }

    fn add_expression_at(&mut self, kind: ExprKind, (pos, end): Range) -> ExprId {
        self.file.expr(kind, pos, end)
    }

    fn write_operand(&mut self, operand: &Expr, outer: Level) -> Written<ExprId> {
        let written = self.write_expression(operand)?;
        if outer.gte(precedence(operand)) {
            self.parenthesize(written);
        }
        Ok(written)
    }

    // `expression` is the last one added: `parens` is sorted by expression.
    fn parenthesize(&mut self, expression: ExprId) {
        let written = self.file[expression];
        self.file
            .parens
            .push((expression, written.pos, written.end));
        self.file.add_flags(expression, ExprFlags::PARENTHESIZED);
    }

    fn write_expression_list(&mut self, items: &[Expr]) -> Written<IdList<ExprId>> {
        let mut written = Vec::with_capacity(items.len());
        for item in items {
            written.push(self.write_operand(item, Level::Comma)?);
        }
        Ok(self.file.list(&written))
    }

    fn write_identifier(&mut self, reference: Ref, loc: Loc) -> ExprId {
        let jsx = self.settings.jsx;
        match self.origin_of(reference) {
            SymbolOrigin::ClassicFactory => self.write_member_path(&jsx.factory, loc),
            SymbolOrigin::ClassicFragment => self.write_member_path(&jsx.fragment, loc),
            SymbolOrigin::Source
            | SymbolOrigin::Local
            | SymbolOrigin::Outlined
            | SymbolOrigin::JsxImport(_)
            | SymbolOrigin::MemoCacheSentinel
            | SymbolOrigin::EarlyReturnSentinel
            | SymbolOrigin::ImportItem
            | SymbolOrigin::ImportNamespace => self.identifier(reference, loc),
        }
    }

    fn write_member_path(&mut self, path: &[Vec<u8>], loc: Loc) -> ExprId {
        let (pos, end) = self.range_of(loc);
        let Some((root, members)) = path.split_first() else {
            return self.file.expr(ExprKind::Missing, pos, end);
        };
        let root = self.atoms.intern(root);
        let mut written = self.file.expr(ExprKind::Ident(root), pos, end);
        for member in members {
            let name = self.atoms.intern(member);
            let kind = self.file.dot((written, Chain::No), (name, pos), end);
            written = self.file.expr(kind, pos, end);
        }
        written
    }

    fn write_undefined(&mut self, range: Range) -> ExprId {
        let operand = self.write_number_literal(0.0, range);
        let op = UnOp::Void;
        self.add_expression_at(ExprKind::Unary { op, operand }, range)
    }

    fn write_boolean(&mut self, value: bool, range: Range) -> ExprId {
        let kind = match value {
            true => ExprKind::True,
            false => ExprKind::False,
        };
        self.add_expression_at(kind, range)
    }

    fn write_number_literal(&mut self, value: f64, range: Range) -> ExprId {
        let magnitude = self.file.number(value.abs());
        let operand = self.add_expression_at(ExprKind::Number(magnitude), range);
        if !is_negative(value) {
            return operand;
        }
        let op = UnOp::Minus;
        self.add_expression_at(ExprKind::Unary { op, operand }, range)
    }

    fn write_string(&mut self, text: &E::EString, loc: Loc) -> ExprId {
        let text = self.atoms.intern(&string_text(text));
        let range = self.range_of(loc);
        self.add_expression_at(ExprKind::String(text), range)
    }

    fn write_template(&mut self, template: &E::Template, loc: Loc) -> Written<ExprId> {
        let range = self.range_of(loc);
        let tag = match &template.tag {
            Some(tag) => Some(self.write_chain_base(tag, None)?.0),
            None => None,
        };
        let head = self.write_template_text(&template.head, tag.is_some())?;
        let mut texts = vec![head];
        let mut substitutions = Vec::with_capacity(template.parts().len());
        for part in template.parts() {
            substitutions.push(self.write_expression(&part.value)?);
            texts.push(self.write_template_text(&part.tail, tag.is_some())?);
        }
        if tag.is_none() && substitutions.is_empty() {
            let literal = self.add_expression_at(ExprKind::String(head), range);
            self.file.add_flags(literal, ExprFlags::TEMPLATE_LITERAL);
            return Ok(literal);
        }
        let (literal, args) = self.add_template_literal(&substitutions, &texts, range);
        let Some(callee) = tag else {
            return Ok(literal);
        };
        let call = self.file.add_call(Call {
            callee,
            args,
            type_args: self.type_arguments_of_call(loc),
            close_pos: u32::MAX,
            chain: Chain::No,
            is_pure: false,
        });
        self.file.tagged_templates.push((call, literal));
        Ok(self.add_expression_at(ExprKind::TaggedTemplate(call), range))
    }

    // Text without an escape is its own raw text. Nothing reads the raw text of a template without a tag.
    fn write_template_text(
        &self,
        contents: &E::TemplateContents,
        is_tagged: bool,
    ) -> Written<Atom> {
        match contents {
            E::TemplateContents::Cooked(text) if !is_tagged => {
                Ok(self.atoms.intern(&string_text(text)))
            }
            E::TemplateContents::Raw(raw) if !contains_char(raw.slice(), b'\\') => {
                Ok(self.atoms.intern(&normalize_line_terminators(raw.slice())))
            }
            E::TemplateContents::Cooked(_) | E::TemplateContents::Raw(_) => {
                Err(unsupported(ExprTag::ETemplate))
            }
        }
    }

    fn add_template_literal(
        &mut self,
        substitutions: &[ExprId],
        texts: &[Atom],
        range: Range,
    ) -> (ExprId, IdList<ExprId>) {
        let exprs = self.file.list(substitutions);
        self.file.list(texts);
        let first_part = self.file.template_parts.len() as u32;
        let parts = texts.iter().map(|&text| TemplatePart {
            cooked: Some(text),
            raw: text,
        });
        self.file.template_parts.extend(parts);
        let kind = match *texts {
            [text] => ExprKind::String(text),
            _ => ExprKind::Template { exprs },
        };
        let literal = self.add_expression_at(kind, range);
        if substitutions.is_empty() {
            self.file.add_flags(literal, ExprFlags::TEMPLATE_LITERAL);
        }
        self.file.template_part_starts.push((literal, first_part));
        (literal, exprs)
    }

    fn write_object(&mut self, object: &E::Object, loc: Loc) -> Written<ExprId> {
        let mut properties = Vec::with_capacity(object.properties.len());
        for property in object.properties.iter() {
            properties.push(self.write_object_literal_property(property)?);
        }
        let properties = self.file.add_props(&properties);
        let range = self.range_of(loc);
        Ok(self.add_expression_at(ExprKind::Object(properties), range))
    }

    fn write_object_literal_property(&mut self, property: &G::Property) -> Written<Prop> {
        let method_kinds = match property.kind {
            G::PropertyKind::Spread => return self.write_spread_property(property),
            G::PropertyKind::Normal if property.flags.contains(flags::Property::IsMethod) => {
                Some((PropKind::Method, FnKind::Method))
            }
            G::PropertyKind::Normal => None,
            G::PropertyKind::Get => Some((PropKind::Getter, FnKind::Getter)),
            G::PropertyKind::Set => Some((PropKind::Setter, FnKind::Setter)),
            G::PropertyKind::Declare
            | G::PropertyKind::Abstract
            | G::PropertyKind::ClassStaticBlock
            | G::PropertyKind::AutoAccessor => {
                return Err(UnsupportedNode(property.kind.into()));
            }
        };
        let (Some(key), Some(value)) = (&property.key, &property.value) else {
            return Err(unsupported(ExprTag::EObject));
        };
        let key_range = self.range_of(key.loc);
        let pos = key_range.0;
        let (key, name_kind) = self.write_property_key(key, property.flags)?;
        let (kind, value) = match method_kinds {
            Some((kind, function_kind)) => (
                kind,
                self.write_method(value, function_kind, (key, key_range))?,
            ),
            None => {
                let value = self.write_property_value(value, property.initializer.as_ref())?;
                (PropKind::Init, value)
            }
        };
        Ok(Prop {
            kind,
            key,
            name_kind,
            value,
            pos,
            start: pos,
            end: self.file[value].end,
            postfix_token: 0,
        })
    }

    fn write_spread_property(&mut self, property: &G::Property) -> Written<Prop> {
        let Some(value) = &property.value else {
            return Err(unsupported(ExprTag::EObject));
        };
        let value = self.write_operand(value, Level::Comma)?;
        let written = self.file[value];
        Ok(Prop {
            kind: PropKind::Spread,
            key: PropKey::None,
            name_kind: NameKind::Identifier,
            value,
            pos: written.pos,
            start: written.pos,
            end: written.end,
            postfix_token: 0,
        })
    }

    pub(super) fn write_property_key(
        &mut self,
        key: &Expr,
        property_flags: flags::PropertySet,
    ) -> Written<(PropKey, NameKind)> {
        let is_computed = property_flags.contains(flags::Property::IsComputed);
        let was_shorthand = property_flags.contains(flags::Property::WasShorthand);
        if let ExprData::EString(text) = &key.data {
            // `{ __proto__ }` defines a property, as `{ ["__proto__"]: v }` does. `{ __proto__: v }` sets the prototype.
            let name_kind = match is_computed || was_shorthand {
                true => NameKind::ComputedString,
                false => NameKind::StringLiteral,
            };
            return Ok((
                PropKey::Name(self.atoms.intern(&string_text(text))),
                name_kind,
            ));
        }
        if let ExprData::ENumber(number) = &key.data
            && !is_negative(number.value())
        {
            let name_kind = match is_computed {
                true => NameKind::ComputedNumber,
                false => NameKind::NumericLiteral,
            };
            let name = self.atoms.intern(&number_to_string(number.value()));
            return Ok((PropKey::Name(name), name_kind));
        }
        if !is_computed {
            return Err(unsupported(key.data.tag()));
        }
        let key = self.write_operand(key, Level::Comma)?;
        Ok((PropKey::Computed(key), NameKind::Identifier))
    }

    fn write_property_value(
        &mut self,
        value: &Expr,
        initializer: Option<&Expr>,
    ) -> Written<ExprId> {
        let target = self.write_operand(value, Level::Comma)?;
        let Some(initializer) = initializer else {
            return Ok(target);
        };
        let value = self.write_operand(initializer, Level::Comma)?;
        let range = (self.file[target].pos, self.file[value].end);
        let op = None;
        Ok(self.add_expression_at(ExprKind::Assign { op, target, value }, range))
    }

    fn write_method(
        &mut self,
        value: &Expr,
        kind: FnKind,
        (key, key_range): (PropKey, Range),
    ) -> Written<ExprId> {
        let ExprData::EFunction(function) = &value.data else {
            return Err(unsupported(value.data.tag()));
        };
        let id = self.write_function_expression(&function.func, kind, value.loc)?;
        // The checker finds the `?` of `m?() {}` in the text before the anchor. `a ? { m() {} } : b` has one at its `{`.
        self.file[id].anchor = key_range.1;
        if let Some(name) = key.name() {
            self.file[id].name = name;
            self.file[id].name_pos = key_range.0;
        }
        let range = self.range_of(value.loc);
        Ok(self.add_expression_at(ExprKind::Fn(id), range))
    }

    fn write_chain_base(
        &mut self,
        base: &Expr,
        link: Option<OptionalChain>,
    ) -> Written<(ExprId, Chain)> {
        let written = self.write_operand(base, Level::Postfix)?;
        let is_base_in_chain = match self.chain_of(written) {
            Chain::Start | Chain::Continue => true,
            Chain::No => false,
        };
        let chain = match (link, is_base_in_chain) {
            (Some(OptionalChain::Start), _) => Chain::Start,
            (Some(OptionalChain::Continuation), true) => Chain::Continue,
            (Some(OptionalChain::Continuation), false) | (None, false) => Chain::No,
            (None, true) => {
                self.parenthesize(written);
                Chain::No
            }
        };
        Ok((written, chain))
    }

    fn chain_of(&self, expression: ExprId) -> Chain {
        match self.file[expression].kind {
            ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. } => chain,
            ExprKind::Call(call) => self.file[call].chain,
            ExprKind::Missing
            | ExprKind::Ident(_)
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::Template { .. }
            | ExprKind::TaggedTemplate(_)
            | ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::New(_)
            | ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Jsx(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_)
            | ExprKind::JsxText(_) => Chain::No,
        }
    }

    fn write_dot(&mut self, dot: &E::Dot, loc: Loc) -> Written<ExprId> {
        let (obj, chain) = self.write_chain_base(&dot.target, dot.optional_chain)?;
        let (pos, end) = self.range_of(loc);
        let name = self.atoms.intern(dot.name.slice());
        let name_range = self.range_of(dot.name_loc);
        if !is_identifier(dot.name.slice()) {
            let index = self.add_expression_at(ExprKind::String(name), name_range);
            return Ok(self
                .file
                .expr(ExprKind::Index { obj, index, chain }, pos, end));
        }
        let kind = self.file.dot((obj, chain), (name, name_range.0), end);
        Ok(self.file.expr(kind, pos, end))
    }

    fn write_index(&mut self, access: &E::Index, loc: Loc) -> Written<ExprId> {
        let (obj, chain) = self.write_chain_base(&access.target, access.optional_chain)?;
        let index = self.write_expression(&access.index)?;
        let range = self.range_of(loc);
        Ok(self.add_expression_at(ExprKind::Index { obj, index, chain }, range))
    }

    fn write_call(&mut self, call: &E::Call, loc: Loc) -> Written<ExprId> {
        let (callee, chain) = self.write_chain_base(&call.target, call.optional_chain)?;
        let args = self.write_expression_list(&call.args)?;
        let range = self.range_of(loc);
        let close_pos = self.compute_close_position(call.close_paren_loc, range);
        let record = self.file.add_call(Call {
            callee,
            args,
            type_args: self.type_arguments_of_call(loc),
            close_pos,
            chain,
            is_pure: is_pure(call.can_be_unwrapped_if_unused),
        });
        let written = self.add_expression_at(ExprKind::Call(record), range);
        if chain == Chain::Start {
            self.file.add_flags(written, ExprFlags::OPTIONAL_CHAIN_LINK);
        }
        Ok(written)
    }

    fn write_new(&mut self, new: &E::New, loc: Loc) -> Written<ExprId> {
        let callee = self.write_operand(&new.target, Level::New)?;
        let args = self.write_expression_list(&new.args)?;
        let range = self.range_of(loc);
        let close_pos = self.compute_close_position(new.close_parens_loc, range);
        let record = self.file.add_call(Call {
            callee,
            args,
            type_args: self.type_arguments_of_call(loc),
            close_pos,
            chain: Chain::No,
            is_pure: is_pure(new.can_be_unwrapped_if_unused),
        });
        Ok(self.add_expression_at(ExprKind::New(record), range))
    }

    // The compiler gives only the call of a JSX element the position of its end. A call ends with its `)`.
    fn compute_close_position(&self, close: Loc, (pos, end): Range) -> u32 {
        match close.is_empty() {
            true => end.saturating_sub(1).max(pos),
            false => self.range_of(close).0,
        }
    }

    fn write_unary(&mut self, unary: &E::Unary, loc: Loc) -> Written<ExprId> {
        let Operator::Unary(op) = operator_of(unary.op) else {
            return Err(unsupported(ExprTag::EUnary));
        };
        // Without its flag `delete a.b` stands for `delete (0, a.b)`. The compiler has no such `delete`.
        let delete_flag = E::UnaryFlags::WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS;
        if op == UnOp::Delete && !unary.flags.contains(delete_flag) {
            return Err(unsupported(ExprTag::EUnary));
        }
        let level = TABLE.get_ptr_const(unary.op).level;
        let mut operand = self.write_operand(&unary.value, level.sub(1))?;
        if self.is_indirect_typeof(unary) {
            operand = self.write_indirect_name(operand);
        }
        match op {
            UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => {
                self.record_assignment_target(operand);
            }
            UnOp::Delete if matches!(self.file[operand].kind, ExprKind::Ident(_)) => {
                self.file.rare_syntax |= rare::DELETES_A_NAME;
            }
            UnOp::Delete
            | UnOp::Plus
            | UnOp::Minus
            | UnOp::BitNot
            | UnOp::Not
            | UnOp::Typeof
            | UnOp::Void => {}
        }
        let range = self.range_of(loc);
        Ok(self.add_expression_at(ExprKind::Unary { op, operand }, range))
    }

    // Without its flag `typeof x` stands for `typeof (0, x)`, which throws if nothing binds `x`.
    fn is_indirect_typeof(&self, unary: &E::Unary) -> bool {
        let ExprData::EIdentifier(name) = &unary.value.data else {
            return false;
        };
        unary.op == OpCode::UnTypeof
            && !unary
                .flags
                .contains(E::UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER)
            && self.origin_of(name.ref_) == SymbolOrigin::Source
    }

    fn write_indirect_name(&mut self, name: ExprId) -> ExprId {
        let range = (self.file[name].pos, self.file[name].end);
        let kind = ExprKind::Binary {
            op: BinOp::Comma,
            left: self.write_number_literal(0.0, range),
            right: name,
        };
        let value = self.add_expression_at(kind, range);
        self.parenthesize(value);
        value
    }

    fn write_binary(&mut self, binary: &E::Binary, loc: Loc) -> Written<ExprId> {
        let (left_level, right_level) = operand_levels(binary);
        let left = self.write_operand(&binary.left, left_level)?;
        let right = self.write_operand(&binary.right, right_level)?;
        let kind = match operator_of(binary.op) {
            Operator::Binary(op) => ExprKind::Binary { op, left, right },
            Operator::Assignment(op) => {
                self.record_assignment_target(left);
                ExprKind::Assign {
                    op,
                    target: left,
                    value: right,
                }
            }
            Operator::Unary(_) => return Err(unsupported(ExprTag::EBinary)),
        };
        let range = self.range_of(loc);
        Ok(self.add_expression_at(kind, range))
    }

    fn record_assignment_target(&mut self, target: ExprId) {
        let is_plain_target = matches!(
            self.file[target].kind,
            ExprKind::Ident(_)
                | ExprKind::Dot {
                    chain: Chain::No,
                    ..
                }
                | ExprKind::Index {
                    chain: Chain::No,
                    ..
                }
        );
        if !is_plain_target {
            self.file.rare_syntax |= rare::ODD_TARGET;
        }
    }

    fn write_conditional(&mut self, conditional: &E::If, loc: Loc) -> Written<ExprId> {
        let test = self.write_operand(&conditional.test, Level::Conditional)?;
        let yes = self.write_operand(&conditional.yes, Level::Yield)?;
        let no = self.write_operand(&conditional.no, Level::Yield)?;
        let branches = self.file.store_branches(Branches { yes, no });
        let range = self.range_of(loc);
        Ok(self.add_expression_at(ExprKind::Cond { test, branches }, range))
    }

    fn write_yield(&mut self, yielded: &E::Yield, loc: Loc) -> Written<ExprId> {
        let value = match &yielded.value {
            Some(value) => self.write_operand(value, Level::Yield)?,
            None => ExprId::NONE,
        };
        let star = yielded.is_star;
        let range = self.range_of(loc);
        Ok(self.add_expression_at(ExprKind::Yield { value, star }, range))
    }

    fn write_import_call(&mut self, import: &E::Import, loc: Loc) -> Written<ExprId> {
        let specifier = self.write_operand(&import.expr, Level::Comma)?;
        let args = match matches!(import.options.data, ExprData::EMissing(_)) {
            true => self.file.list(&[specifier]),
            false => {
                let options = self.write_operand(&import.options, Level::Comma)?;
                self.file.list(&[specifier, options])
            }
        };
        let range = self.range_of(loc);
        Ok(self.add_expression_at(ExprKind::ImportCall { args }, range))
    }

    fn write_arrow(&mut self, arrow: &E::Arrow, loc: Loc) -> Written<ExprId> {
        let mut parameter_flags = flags::FUNCTION_NONE;
        if arrow.has_rest_arg {
            parameter_flags |= flags::Function::HasRestArg;
        }
        let parts = FunctionParts {
            kind: FnKind::Arrow,
            flags: match arrow.is_async {
                true => Flags::ASYNC,
                false => Flags::empty(),
            },
            name: None,
            parameters: arrow.args.slice(),
            parameter_flags,
            body: &arrow.body,
        };
        let id = self.add_function_record(parts, loc)?;
        let range = self.range_of(loc);
        Ok(self.add_expression_at(ExprKind::Fn(id), range))
    }

    // In development `jsxDEV` is passed `this`, which the checker rejects in a function that gives it no type.
    pub(super) fn write_this_parameter(
        &mut self,
        kind: FnKind,
        first_expression: usize,
        position: u32,
    ) -> ParamId {
        if !self.settings.is_typescript || !matches!(kind, FnKind::Decl | FnKind::Expr) {
            return ParamId::NONE;
        }
        let mut written = self.file.exprs[first_expression..].iter();
        if !written.any(|it| matches!(it.kind, ExprKind::This)) {
            return ParamId::NONE;
        }
        let pat = self
            .file
            .pat(PatKind::Ident(known::this), position, position);
        let ty = self.any_type(position);
        self.file.add_param(Param {
            pat,
            ty,
            default: ExprId::NONE,
            flags: Flags::empty(),
            pos: position,
            loc: TextRange {
                pos: position,
                end: position,
            },
        })
    }

    fn add_function_record(&mut self, parts: FunctionParts<'_>, loc: Loc) -> Written<FnId> {
        let first_expression = self.file.exprs.len();
        let params = self.write_parameters(parts.parameters, parts.parameter_flags, Span::EMPTY)?;
        let body = FnBody::Block(self.write_statement_list(parts.body.stmts.slice())?);
        let start = self.range_of(loc).0;
        let (name, name_pos) = match parts.name {
            Some(name) => (self.name_of(name.ref_), self.range_of(name.loc).0),
            None => (Atom::NONE, start),
        };
        let this_param = self.write_this_parameter(parts.kind, first_expression, start);
        let id = self.file.add_fn(Func {
            kind: parts.kind,
            flags: parts.flags,
            name,
            name_pos,
            type_params: Span::EMPTY,
            params,
            this_param,
            ret: TypeNodeId::NONE,
            body,
            anchor: start,
            start,
            text_start: start,
            is_strict: self.function.is_strict,
            is_strict_by_syntax: self.function.is_strict_by_syntax,
        });
        let body_start = self.range_of(parts.body.loc).0;
        self.file.body_starts.push((id, body_start));
        Ok(id)
    }
}

fn unsupported(tag: ExprTag) -> UnsupportedNode {
    UnsupportedNode(tag.into())
}

fn is_negative(value: f64) -> bool {
    value.is_sign_negative() && !value.is_nan()
}

fn is_pure(unwrap: E::CallUnwrap) -> bool {
    match unwrap {
        E::CallUnwrap::Never => false,
        E::CallUnwrap::IfUnused | E::CallUnwrap::IfUnusedAndToStringSafe => true,
    }
}

fn function_flags(set: flags::FunctionSet) -> Flags {
    let mut written = Flags::empty();
    written.set(Flags::ASYNC, set.contains(flags::Function::IsAsync));
    written.set(Flags::GENERATOR, set.contains(flags::Function::IsGenerator));
    written
}

// An operand is in parentheses where `js_printer` prints them: the early errors of the checker read them from the tree.
fn precedence(expression: &Expr) -> Level {
    match &expression.data {
        ExprData::EBinary(binary) => TABLE.get_ptr_const(binary.op).level,
        ExprData::EUnary(unary) => TABLE.get_ptr_const(unary.op).level,
        ExprData::EIf(_) => Level::Conditional,
        ExprData::EArrow(_) | ExprData::EYield(_) => Level::Assign,
        ExprData::EAwait(_) | ExprData::EUndefined(_) => Level::Prefix,
        ExprData::ENumber(number) if is_negative(number.value()) => Level::Prefix,
        ExprData::ECall(_) | ExprData::EImport(_) => Level::New,
        ExprData::ENew(_) => Level::Call,
        ExprData::EArray(_)
        | ExprData::EClass(_)
        | ExprData::EFunction(_)
        | ExprData::EDot(_)
        | ExprData::EIndex(_)
        | ExprData::EJsxElement(_)
        | ExprData::EObject(_)
        | ExprData::EObjectJSON(_)
        | ExprData::EArrayJSON(_)
        | ExprData::ESpread(_)
        | ExprData::ETemplate(_)
        | ExprData::ERegExp(_)
        | ExprData::EIdentifier(_)
        | ExprData::EImportIdentifier(_)
        | ExprData::EPrivateIdentifier(_)
        | ExprData::ECommonjsExportIdentifier(_)
        | ExprData::EBoolean(_)
        | ExprData::EBranchBoolean(_)
        | ExprData::ENumber(_)
        | ExprData::EBigInt(_)
        | ExprData::EString(_)
        | ExprData::ERequireString(_)
        | ExprData::ERequireResolveString(_)
        | ExprData::ERequireCallTarget
        | ExprData::ERequireResolveCallTarget
        | ExprData::EMissing(_)
        | ExprData::EThis(_)
        | ExprData::ESuper(_)
        | ExprData::ENull(_)
        | ExprData::ENewTarget(_)
        | ExprData::EImportMeta(_)
        | ExprData::EImportMetaMain(_)
        | ExprData::ERequireMain
        | ExprData::ESpecial(_)
        | ExprData::EInlinedEnum(_)
        | ExprData::ENameOfSymbol(_) => Level::Member,
    }
}

fn operand_levels(binary: &E::Binary) -> (Level, Level) {
    let level = TABLE.get_ptr_const(binary.op).level;
    let mut left = match OpCode::is_right_associative(binary.op) {
        true => level,
        false => level.sub(1),
    };
    let mut right = match OpCode::is_left_associative(binary.op) {
        true => level,
        false => level.sub(1),
    };
    if binary.op == OpCode::BinNullishCoalescing {
        if is_logical_and_or_or(&binary.left) {
            left = Level::Prefix;
        }
        if is_logical_and_or_or(&binary.right) {
            right = Level::Prefix;
        }
    }
    if binary.op == OpCode::BinPow && precedence(&binary.left).eql(Level::Prefix) {
        left = Level::Call;
    }
    (left, right)
}

fn is_logical_and_or_or(expression: &Expr) -> bool {
    matches!(
        &expression.data,
        ExprData::EBinary(binary)
            if matches!(binary.op, OpCode::BinLogicalAnd | OpCode::BinLogicalOr)
    )
}

fn operator_of(code: OpCode) -> Operator {
    match code {
        OpCode::UnPos => Operator::Unary(UnOp::Plus),
        OpCode::UnNeg => Operator::Unary(UnOp::Minus),
        OpCode::UnCpl => Operator::Unary(UnOp::BitNot),
        OpCode::UnNot => Operator::Unary(UnOp::Not),
        OpCode::UnVoid => Operator::Unary(UnOp::Void),
        OpCode::UnTypeof => Operator::Unary(UnOp::Typeof),
        OpCode::UnDelete => Operator::Unary(UnOp::Delete),
        OpCode::UnPreDec => Operator::Unary(UnOp::PreDec),
        OpCode::UnPreInc => Operator::Unary(UnOp::PreInc),
        OpCode::UnPostDec => Operator::Unary(UnOp::PostDec),
        OpCode::UnPostInc => Operator::Unary(UnOp::PostInc),
        OpCode::BinAdd => Operator::Binary(BinOp::Add),
        OpCode::BinSub => Operator::Binary(BinOp::Sub),
        OpCode::BinMul => Operator::Binary(BinOp::Mul),
        OpCode::BinDiv => Operator::Binary(BinOp::Div),
        OpCode::BinRem => Operator::Binary(BinOp::Rem),
        OpCode::BinPow => Operator::Binary(BinOp::Pow),
        OpCode::BinLt => Operator::Binary(BinOp::Lt),
        OpCode::BinLe => Operator::Binary(BinOp::Le),
        OpCode::BinGt => Operator::Binary(BinOp::Gt),
        OpCode::BinGe => Operator::Binary(BinOp::Ge),
        OpCode::BinIn => Operator::Binary(BinOp::In),
        OpCode::BinInstanceof => Operator::Binary(BinOp::Instanceof),
        OpCode::BinShl => Operator::Binary(BinOp::Shl),
        OpCode::BinShr => Operator::Binary(BinOp::Shr),
        OpCode::BinUShr => Operator::Binary(BinOp::UShr),
        OpCode::BinLooseEq => Operator::Binary(BinOp::EqEq),
        OpCode::BinLooseNe => Operator::Binary(BinOp::NotEq),
        OpCode::BinStrictEq => Operator::Binary(BinOp::EqEqEq),
        OpCode::BinStrictNe => Operator::Binary(BinOp::NotEqEq),
        OpCode::BinNullishCoalescing => Operator::Binary(BinOp::Nullish),
        OpCode::BinLogicalOr => Operator::Binary(BinOp::Or),
        OpCode::BinLogicalAnd => Operator::Binary(BinOp::And),
        OpCode::BinBitwiseOr => Operator::Binary(BinOp::BitOr),
        OpCode::BinBitwiseAnd => Operator::Binary(BinOp::BitAnd),
        OpCode::BinBitwiseXor => Operator::Binary(BinOp::BitXor),
        OpCode::BinComma => Operator::Binary(BinOp::Comma),
        OpCode::BinAssign => Operator::Assignment(None),
        OpCode::BinAddAssign => Operator::Assignment(Some(BinOp::Add)),
        OpCode::BinSubAssign => Operator::Assignment(Some(BinOp::Sub)),
        OpCode::BinMulAssign => Operator::Assignment(Some(BinOp::Mul)),
        OpCode::BinDivAssign => Operator::Assignment(Some(BinOp::Div)),
        OpCode::BinRemAssign => Operator::Assignment(Some(BinOp::Rem)),
        OpCode::BinPowAssign => Operator::Assignment(Some(BinOp::Pow)),
        OpCode::BinShlAssign => Operator::Assignment(Some(BinOp::Shl)),
        OpCode::BinShrAssign => Operator::Assignment(Some(BinOp::Shr)),
        OpCode::BinUShrAssign => Operator::Assignment(Some(BinOp::UShr)),
        OpCode::BinBitwiseOrAssign => Operator::Assignment(Some(BinOp::BitOr)),
        OpCode::BinBitwiseAndAssign => Operator::Assignment(Some(BinOp::BitAnd)),
        OpCode::BinBitwiseXorAssign => Operator::Assignment(Some(BinOp::BitXor)),
        OpCode::BinNullishCoalescingAssign => Operator::Assignment(Some(BinOp::Nullish)),
        OpCode::BinLogicalOrAssign => Operator::Assignment(Some(BinOp::Or)),
        OpCode::BinLogicalAndAssign => Operator::Assignment(Some(BinOp::And)),
    }
}

fn string_text(text: &E::EString) -> Cow<'_, [u8]> {
    if text.is_utf16 {
        return Cow::Owned(wtf16_to_wtf8(text.slice16()));
    }
    let bytes = match text.next {
        None => Cow::Borrowed(text.slice8()),
        Some(_) => Cow::Owned(join_rope(text)),
    };
    if is_valid_utf8(&bytes) {
        return bytes;
    }
    Cow::Owned(wtf16_to_wtf8(&wtf8_to_utf16(&bytes)))
}

fn join_rope(text: &E::EString) -> Vec<u8> {
    let mut joined = Vec::with_capacity(text.len());
    let mut part = Some(text);
    while let Some(current) = part {
        joined.extend_from_slice(current.slice8());
        part = current.next.as_deref();
    }
    joined
}

fn normalize_line_terminators(raw: &[u8]) -> Cow<'_, [u8]> {
    if !contains_char(raw, b'\r') {
        return Cow::Borrowed(raw);
    }
    let mut text = Vec::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(at) = index_of_char_usize(rest, b'\r') {
        text.extend_from_slice(&rest[..at]);
        text.push(b'\n');
        rest = &rest[at + 1..];
        rest = rest.strip_prefix(b"\n").unwrap_or(rest);
    }
    text.extend_from_slice(rest);
    Cow::Owned(text)
}
