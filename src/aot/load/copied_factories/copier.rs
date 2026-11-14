use bun_core::StackCheck;
use bun_sema::atom::Atom;
use bun_sema::hir::{
    Branches, Call, CallId, Case, CaseId, Class, ClassId, Expr, ExprFlags, ExprId, ExprKind, FAR,
    FAR_IN_BRACKETS, FileBuilder, Flags, FnBody, FnId, FnKind, Func, INCOMPLETE_TEMPLATE, IdList,
    ListAt, Member, MemberId, MemberKind, Param, ParamId, Pat, PatElem, PatId, PatKind, PatProp,
    Prop, PropId, PropKey, Span, Stmt, StmtId, StmtKind, TemplatePart, TextRange, TypeNodeId,
    VarDecl, VarDeclId, has_body,
};
use rustc_hash::FxHashMap;

#[derive(Debug)]
pub(super) struct NotCopied;

pub(super) type Copied<T> = Result<T, NotCopied>;

pub(super) struct FunctionCopier<'a> {
    pub(super) file: &'a mut FileBuilder,
    pub(super) distance: u32,
    pub(super) literals: &'a FxHashMap<ExprId, ExprId>,
    pub(super) stack: &'a StackCheck,
}

impl FunctionCopier<'_> {
    #[inline]
    fn moved(&self, position: u32) -> u32 {
        position + self.distance
    }

    #[inline]
    fn moved_if_recorded(&self, position: u32) -> u32 {
        match position {
            0 | u32::MAX => position,
            _ => position + self.distance,
        }
    }

    fn moved_range(&self, range: TextRange) -> TextRange {
        TextRange {
            pos: self.moved(range.pos),
            end: self.moved_if_recorded(range.end),
        }
    }

    fn push(&mut self, written: ExprId, kind: ExprKind) -> ExprId {
        let Expr { pos, end, .. } = self.file[written];
        let (pos, end) = (self.moved(pos), self.moved(end));
        let flags = self.file.expr_flags(written);
        let copy = self.file.expr(kind, pos, end);
        self.file.expr_flags[copy.idx()] = flags;
        if flags.contains(ExprFlags::PARENTHESIZED) {
            let first = self.file.parens.partition_point(|it| it.0.0 < written.0);
            let count = self.file.parens[first..].partition_point(|it| it.0 == written);
            for index in first..first + count {
                let (_, start, end) = self.file.parens[index];
                let (start, end) = (self.moved(start), self.moved(end));
                self.file.parens.push((copy, start, end));
            }
        }
        copy
    }

    fn expressions(&mut self, list: IdList<ExprId>) -> Copied<Vec<ExprId>> {
        let written: Vec<ExprId> = self.file.ids(list).collect();
        let mut copies: Vec<ExprId> = Vec::with_capacity(written.len());
        for expression in written {
            copies.push(self.expression(expression)?);
        }
        Ok(copies)
    }

    fn expression_list(&mut self, list: IdList<ExprId>) -> Copied<IdList<ExprId>> {
        let copies = self.expressions(list)?;
        Ok(self.file.list(&copies))
    }

    fn expression_or_none(&mut self, written: ExprId) -> Copied<ExprId> {
        match written.some() {
            Some(written) => self.expression(written),
            None => Ok(ExprId::NONE),
        }
    }

    fn literal(&mut self, written: ExprId, literal: ExprId) -> ExprId {
        let kind = match self.file[literal].kind {
            ExprKind::Unary { op, operand } => {
                let Expr { pos, end, .. } = self.file[written];
                let (pos, end) = (self.moved(pos), self.moved(end));
                let kind = self.file[operand].kind;
                let operand = self.file.expr(kind, pos, end);
                ExprKind::Unary { op, operand }
            }
            kind => kind,
        };
        self.push(written, kind)
    }

    pub(super) fn expression(&mut self, written: ExprId) -> Copied<ExprId> {
        if !self.stack.is_safe_to_recurse() {
            return Err(NotCopied);
        }
        if let Some(&literal) = self.literals.get(&written) {
            return Ok(self.literal(written, literal));
        }
        let kind = match self.file[written].kind {
            kind @ (ExprKind::Missing
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
            | ExprKind::NewTarget(_)) => kind,
            ExprKind::Template { exprs } => return self.template(written, exprs),
            ExprKind::Array(list) => ExprKind::Array(self.expression_list(list)?),
            ExprKind::Object(properties) => ExprKind::Object(self.properties(properties)?),
            ExprKind::Fn(function) => ExprKind::Fn(self.function(function)?),
            ExprKind::Class(class) => ExprKind::Class(self.class(class)?),
            ExprKind::Dot {
                obj,
                name,
                chain,
                name_before_end,
            } => {
                let obj = self.expression(obj)?;
                if name_before_end == FAR_IN_BRACKETS {
                    self.expression(ExprId(written.0 - 1))?;
                }
                if matches!(name_before_end, FAR | FAR_IN_BRACKETS) {
                    let name_pos = self.moved(self.file.name_pos(written));
                    let next = ExprId(self.file.exprs.len() as u32);
                    self.file.far_names.push((next, name_pos));
                }
                ExprKind::Dot {
                    obj,
                    name,
                    chain,
                    name_before_end,
                }
            }
            ExprKind::Index { obj, index, chain } => {
                let obj = self.expression(obj)?;
                let index = self.expression(index)?;
                ExprKind::Index { obj, index, chain }
            }
            ExprKind::Call(call) => ExprKind::Call(self.call(call)?),
            ExprKind::New(call) => ExprKind::New(self.call(call)?),
            ExprKind::Unary { op, operand } => {
                let operand = self.expression(operand)?;
                ExprKind::Unary { op, operand }
            }
            ExprKind::Binary { op, left, right } => {
                let left = self.expression(left)?;
                let right = self.expression(right)?;
                ExprKind::Binary { op, left, right }
            }
            ExprKind::Assign { op, target, value } => {
                let target = self.expression(target)?;
                let value = self.expression(value)?;
                ExprKind::Assign { op, target, value }
            }
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = self.file.branches(branches);
                let test = self.expression(test)?;
                let yes = self.expression(yes)?;
                let no = self.expression(no)?;
                let branches = self.file.store_branches(Branches { yes, no });
                ExprKind::Cond { test, branches }
            }
            ExprKind::Spread(operand) => ExprKind::Spread(self.expression(operand)?),
            ExprKind::Await(operand) => ExprKind::Await(self.expression(operand)?),
            ExprKind::Yield { value, star } => {
                let value = self.expression_or_none(value)?;
                ExprKind::Yield { value, star }
            }
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => return self.expression(expr),
            ExprKind::TaggedTemplate(_)
            | ExprKind::Jsx(_)
            | ExprKind::JsxText(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::ImportMeta => return Err(NotCopied),
        };
        Ok(self.push(written, kind))
    }

    fn template(&mut self, written: ExprId, exprs: IdList<ExprId>) -> Copied<ExprId> {
        let texts = self.file.template_texts(exprs);
        let texts: Vec<Atom> = self.file.ids(texts).collect();
        let parts: Vec<TemplatePart> = self.file.template_parts(written).to_vec();
        let copies = self.expressions(exprs)?;
        let exprs = self.file.list(&copies);
        self.file.list(&texts);
        let copy = self.push(written, ExprKind::Template { exprs });
        if !parts.is_empty() {
            let first = self.file.template_parts.len() as u32;
            self.file.template_part_starts.push((copy, first));
            self.file.template_parts.extend(parts);
        }
        Ok(copy)
    }

    fn call(&mut self, written: CallId) -> Copied<CallId> {
        let Call {
            callee,
            args,
            close_pos,
            chain,
            is_pure,
            ..
        } = self.file[written];
        let callee = self.expression(callee)?;
        let args = self.expression_list(args)?;
        let close_pos = match close_pos {
            u32::MAX | INCOMPLETE_TEMPLATE => close_pos,
            _ => self.moved(close_pos),
        };
        Ok(self.file.add_call(Call {
            callee,
            args,
            type_args: ListAt::EMPTY,
            close_pos,
            chain,
            is_pure,
        }))
    }

    fn key(&mut self, key: PropKey) -> Copied<PropKey> {
        Ok(match key {
            PropKey::Computed(key) => PropKey::Computed(self.expression(key)?),
            PropKey::None | PropKey::Name(_) | PropKey::Private(_) => key,
        })
    }

    fn properties(&mut self, properties: Span<PropId>) -> Copied<Span<PropId>> {
        let mut copies: Vec<Prop> = Vec::with_capacity(properties.len());
        for property in properties.iter() {
            let written = self.file[property];
            let key = self.key(written.key)?;
            let value = self.expression_or_none(written.value)?;
            copies.push(Prop {
                key,
                value,
                pos: self.moved(written.pos),
                start: self.moved(written.start),
                end: self.moved_if_recorded(written.end),
                postfix_token: self.moved_if_recorded(written.postfix_token),
                ..written
            });
        }
        Ok(self.file.add_props(&copies))
    }

    fn pattern(&mut self, written: PatId) -> Copied<PatId> {
        if !self.stack.is_safe_to_recurse() {
            return Err(NotCopied);
        }
        let Pat { kind, pos, end } = self.file[written];
        let kind = match kind {
            PatKind::Missing | PatKind::Ident(_) => kind,
            PatKind::Object(properties) => {
                let mut copies: Vec<PatProp> = Vec::with_capacity(properties.len());
                for property in properties.iter() {
                    let written = self.file[property];
                    let key = self.key(written.key)?;
                    let value = self.pattern(written.value)?;
                    let default = self.expression_or_none(written.default)?;
                    copies.push(PatProp {
                        key,
                        value,
                        default,
                        pos: self.moved(written.pos),
                        key_pos: self.moved(written.key_pos),
                        end: self.moved(written.end),
                        ..written
                    });
                }
                PatKind::Object(self.file.add_pat_props(&copies))
            }
            PatKind::Array(elements) => {
                let mut copies: Vec<PatElem> = Vec::with_capacity(elements.len());
                for element in elements.iter() {
                    let written = self.file[element];
                    let pat = self.pattern(written.pat)?;
                    let default = self.expression_or_none(written.default)?;
                    copies.push(PatElem {
                        pat,
                        default,
                        start: self.moved(written.start),
                        end: self.moved(written.end),
                        ..written
                    });
                }
                PatKind::Array(self.file.add_pat_elems(&copies))
            }
        };
        Ok(self.file.pat(kind, self.moved(pos), self.moved(end)))
    }

    fn declaration(&mut self, written: VarDeclId) -> Copied<VarDecl> {
        let written = self.file[written];
        let pat = self.pattern(written.pat)?;
        let init = self.expression_or_none(written.init)?;
        Ok(VarDecl {
            pat,
            ty: TypeNodeId::NONE,
            init,
            loc: self.moved_range(written.loc),
            ..written
        })
    }

    fn statements(&mut self, list: IdList<StmtId>) -> Copied<IdList<StmtId>> {
        let written: Vec<StmtId> = self.file.ids(list).collect();
        let mut copies: Vec<StmtId> = Vec::with_capacity(written.len());
        for statement in written {
            copies.push(self.statement(statement)?);
        }
        Ok(self.file.list(&copies))
    }

    fn statement_or_none(&mut self, written: StmtId) -> Copied<StmtId> {
        match written.some() {
            Some(written) => self.statement(written),
            None => Ok(StmtId::NONE),
        }
    }

    fn statement(&mut self, written: StmtId) -> Copied<StmtId> {
        if !self.stack.is_safe_to_recurse() {
            return Err(NotCopied);
        }
        let Stmt { kind, start, loc } = self.file[written];
        let kind = match kind {
            StmtKind::Empty | StmtKind::Debugger | StmtKind::Break(_) | StmtKind::Continue(_) => {
                kind
            }
            StmtKind::Interface(_) | StmtKind::TypeAlias(_) => StmtKind::Empty,
            StmtKind::Expr(expression) => StmtKind::Expr(self.expression(expression)?),
            StmtKind::Var(declarations) => {
                let mut copies: Vec<VarDecl> = Vec::with_capacity(declarations.len());
                for declaration in declarations.iter() {
                    copies.push(self.declaration(declaration)?);
                }
                StmtKind::Var(self.file.add_var_decls(&copies))
            }
            StmtKind::Fn(function) if !has_body(&self.file[function]) => StmtKind::Empty,
            StmtKind::Fn(function) => StmtKind::Fn(self.function(function)?),
            StmtKind::Class(class) => StmtKind::Class(self.class(class)?),
            StmtKind::Return(value) => StmtKind::Return(self.expression_or_none(value)?),
            StmtKind::If { test, yes, no } => StmtKind::If {
                test: self.expression(test)?,
                yes: self.statement(yes)?,
                no: self.statement_or_none(no)?,
            },
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => StmtKind::For {
                init: self.statement_or_none(init)?,
                test: self.expression_or_none(test)?,
                update: self.expression_or_none(update)?,
                body: self.statement(body)?,
            },
            StmtKind::ForIn { left, expr, body } => StmtKind::ForIn {
                left: self.statement(left)?,
                expr: self.expression(expr)?,
                body: self.statement(body)?,
            },
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => StmtKind::ForOf {
                left: self.statement(left)?,
                expr: self.expression(expr)?,
                body: self.statement(body)?,
                is_await,
            },
            StmtKind::While { test, body } => StmtKind::While {
                test: self.expression(test)?,
                body: self.statement(body)?,
            },
            StmtKind::DoWhile { body, test } => StmtKind::DoWhile {
                body: self.statement(body)?,
                test: self.expression(test)?,
            },
            StmtKind::Block(list) => StmtKind::Block(self.statements(list)?),
            StmtKind::Switch { expr, cases } => {
                let expr = self.expression(expr)?;
                StmtKind::Switch {
                    expr,
                    cases: self.cases(cases)?,
                }
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                let block = self.statement(block)?;
                let param = match param.some() {
                    Some(param) => {
                        let copy = self.declaration(param)?;
                        self.file.add_var_decl(copy)
                    }
                    None => VarDeclId::NONE,
                };
                StmtKind::Try {
                    block,
                    param,
                    handler: self.statement_or_none(handler)?,
                    finalizer: self.statement_or_none(finalizer)?,
                }
            }
            StmtKind::Throw(value) => StmtKind::Throw(self.expression(value)?),
            StmtKind::Labeled { label, body } => StmtKind::Labeled {
                label,
                body: self.statement(body)?,
            },
            StmtKind::Directive { expr, raw } => StmtKind::Directive {
                expr: self.expression(expr)?,
                raw,
            },
            StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::With { .. } => return Err(NotCopied),
        };
        Ok(self.file.add_stmt_node(Stmt {
            kind,
            start: self.moved(start),
            loc: self.moved_range(loc),
        }))
    }

    fn cases(&mut self, cases: Span<CaseId>) -> Copied<Span<CaseId>> {
        let mut copies: Vec<Case> = Vec::with_capacity(cases.len());
        for case in cases.iter() {
            let written = self.file[case];
            let test = self.expression_or_none(written.test)?;
            let body = self.statements(written.body)?;
            copies.push(Case {
                test,
                body,
                pos: self.moved(written.pos),
                end: self.moved(written.end),
            });
        }
        Ok(self.file.add_cases(&copies))
    }

    fn parameters(&mut self, parameters: Span<ParamId>) -> Copied<Span<ParamId>> {
        let mut copies: Vec<Param> = Vec::with_capacity(parameters.len());
        for parameter in parameters.iter() {
            let written = self.file[parameter];
            let pat = self.pattern(written.pat)?;
            let default = self.expression_or_none(written.default)?;
            copies.push(Param {
                pat,
                ty: TypeNodeId::NONE,
                default,
                flags: written.flags,
                pos: self.moved(written.pos),
                loc: self.moved_range(written.loc),
            });
        }
        Ok(self.file.add_params(&copies))
    }

    fn function(&mut self, written: FnId) -> Copied<FnId> {
        let kind = self.file[written].kind;
        let name = self.file[written].name;
        let flags = self.file[written].flags;
        self.function_as(written, kind, flags, name)
    }

    pub(super) fn function_expression(&mut self, written: FnId) -> Copied<FnId> {
        let kind = match self.file[written].kind {
            FnKind::Arrow => FnKind::Arrow,
            FnKind::Decl | FnKind::Expr | FnKind::Method => FnKind::Expr,
            _ => return Err(NotCopied),
        };
        let flags = self.file[written].flags & !(Flags::EXPORT | Flags::DEFAULT);
        self.function_as(written, kind, flags, Atom::NONE)
    }

    fn function_as(
        &mut self,
        function: FnId,
        kind: FnKind,
        flags: Flags,
        name: Atom,
    ) -> Copied<FnId> {
        let written = self.file[function];
        let params = self.parameters(written.params)?;
        let body = match written.body {
            FnBody::None => FnBody::None,
            FnBody::Block(list) => FnBody::Block(self.statements(list)?),
            FnBody::Expr(value) => FnBody::Expr(self.expression(value)?),
        };
        let copy = self.file.add_fn(Func {
            kind,
            flags,
            name,
            name_pos: self.moved_if_recorded(written.name_pos),
            type_params: Span::EMPTY,
            params,
            this_param: ParamId::NONE,
            ret: TypeNodeId::NONE,
            body,
            anchor: self.moved(written.anchor),
            start: self.moved(written.start),
            text_start: self.moved(written.text_start),
            is_strict: written.is_strict,
            is_strict_by_syntax: written.is_strict_by_syntax,
        });
        let starts = &self.file.body_starts;
        if let Ok(at) = starts.binary_search_by_key(&function, |it| it.0) {
            let start = self.moved(starts[at].1);
            self.file.body_starts.push((copy, start));
        }
        Ok(copy)
    }

    fn class(&mut self, class: ClassId) -> Copied<ClassId> {
        let written = self.file[class];
        let extends = self.expression_or_none(written.extends)?;
        let mut members: Vec<Member> = Vec::with_capacity(written.members.len());
        for member in written.members.iter() {
            if let Some(copy) = self.member(member)? {
                members.push(copy);
            }
        }
        let members = self.file.add_members(&members);
        Ok(self.file.add_class(Class {
            name: written.name,
            name_pos: self.moved_if_recorded(written.name_pos),
            flags: written.flags,
            type_params: Span::EMPTY,
            extends,
            extends_args: IdList::EMPTY,
            other_extends: IdList::EMPTY,
            implements: IdList::EMPTY,
            other_implements: IdList::EMPTY,
            members,
            start: self.moved(written.start),
            text_start: self.moved(written.text_start),
            modifiers: Span::EMPTY,
        }))
    }

    fn member(&mut self, member: MemberId) -> Copied<Option<Member>> {
        let written = self.file[member];
        let has_code = match written.kind {
            MemberKind::Property => !written.flags.intersects(Flags::AMBIENT | Flags::ABSTRACT),
            MemberKind::Method
            | MemberKind::Getter
            | MemberKind::Setter
            | MemberKind::Constructor
            | MemberKind::StaticBlock => {
                written.func.is_some() && has_body(&self.file[written.func])
            }
            MemberKind::CallSignature
            | MemberKind::ConstructSignature
            | MemberKind::IndexSignature => false,
        };
        if !has_code {
            return Ok(None);
        }
        let key = self.key(written.key)?;
        let init = self.expression_or_none(written.init)?;
        let func = match written.func.some() {
            Some(function) => self.function(function)?,
            None => FnId::NONE,
        };
        Ok(Some(Member {
            key,
            ty: TypeNodeId::NONE,
            init,
            func,
            name_pos: self.moved(written.name_pos),
            start: self.moved(written.start),
            loc: self.moved_range(written.loc),
            modifiers: Span::EMPTY,
            ..written
        }))
    }
}
