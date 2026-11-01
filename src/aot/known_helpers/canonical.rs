use super::find::FindInput;
use super::quiet::has_fixed_binding;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, CodeUnit, Decl, SymbolId};
use bun_sema::hir::{
    self, BinOp, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, PatId, PatKind, PropKey, PropKind,
    StmtId, StmtKind, UnOp, VarDeclId, VarKind,
};
use bun_sema::util::FxHashMap;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum OuterName {
    Symbol(SymbolId),
    Free(Atom),
}

#[derive(Default)]
pub(super) struct CanonicalFunction {
    pub(super) bytes: Vec<u8>,
    pub(super) outer_names: Vec<OuterName>,
    pub(super) inner_functions: Vec<FnId>,
    pub(super) globals: Vec<ExprId>,
}

pub(super) struct CanonicalInput<'a, 's> {
    pub(super) file: &'a FindInput<'a, 's>,
    pub(super) max_bytes: usize,
    pub(super) is_outer_name: &'a dyn Fn(Atom) -> bool,
}

#[derive(Copy, Clone)]
pub(super) enum CanonicalBody {
    Missing,
    Expression(ExprId),
    Statements(hir::IdList<StmtId>),
}

fn declares_in_its_block(hir: &hir::File<'_>, statement: StmtId) -> bool {
    match hir[statement].kind {
        StmtKind::Var(declarations) => {
            let mut kinds = declarations.iter().map(|declaration| hir[declaration].kind);
            kinds.any(|kind| kind != VarKind::Var)
        }
        StmtKind::Fn(_) | StmtKind::Class(_) => true,
        StmtKind::Labeled { body, .. } => declares_in_its_block(hir, body),
        _ => false,
    }
}

pub(super) fn canonical_statement(hir: &hir::File<'_>, mut statement: StmtId) -> StmtId {
    while let StmtKind::Block(statements) = hir[statement].kind {
        let mut inner = hir.ids(statements);
        let (Some(only), None) = (inner.next(), inner.next()) else {
            break;
        };
        if declares_in_its_block(hir, only) {
            break;
        }
        statement = only;
    }
    statement
}

pub(super) fn canonical_body(hir: &hir::File<'_>, function: FnId) -> CanonicalBody {
    let record = hir[function];
    let statements = match record.body {
        FnBody::None => return CanonicalBody::Missing,
        FnBody::Expr(body) => return CanonicalBody::Expression(body),
        FnBody::Block(statements) => statements,
    };
    let mut inner = hir.ids(statements);
    let (FnKind::Arrow, Some(only), None) = (record.kind, inner.next(), inner.next()) else {
        return CanonicalBody::Statements(statements);
    };
    match hir[canonical_statement(hir, only)].kind {
        StmtKind::Return(value) if value.is_some() => CanonicalBody::Expression(value),
        _ => CanonicalBody::Statements(statements),
    }
}

#[repr(u8)]
#[derive(Copy, Clone)]
enum Tag {
    None,
    Local,
    Outer,
    Global,
    Undefined,
    Arguments,
    CommonJs,
    End,
    Expression,
    Statement,
    Pattern,
    Function,
    Property,
    Declaration,
    Case,
}

struct Writer<'a, 's> {
    input: &'a CanonicalInput<'a, 's>,
    locals: FxHashMap<SymbolId, u32>,
    labels: Vec<Atom>,
    found: CanonicalFunction,
    root: FnId,
    is_unsupported: bool,
}

pub(super) fn canonical_function(
    input: &CanonicalInput<'_, '_>,
    function: FnId,
) -> Option<CanonicalFunction> {
    let mut writer = Writer {
        input,
        locals: FxHashMap::default(),
        labels: Vec::new(),
        found: CanonicalFunction::default(),
        root: function,
        is_unsupported: false,
    };
    writer.function(function);
    (!writer.is_unsupported).then_some(writer.found)
}

impl Writer<'_, '_> {
    fn is_stopped(&mut self) -> bool {
        self.is_unsupported |= self.found.bytes.len() > self.input.max_bytes;
        self.is_unsupported
    }

    fn tag(&mut self, tag: Tag) {
        self.found.bytes.push(tag as u8);
    }

    fn byte(&mut self, byte: u8) {
        self.found.bytes.push(byte);
    }

    fn number(&mut self, number: u32) {
        self.found.bytes.extend_from_slice(&number.to_le_bytes());
    }

    fn text(&mut self, text: Atom) {
        if text == Atom::NONE {
            self.number(u32::MAX);
            return;
        }
        let bytes = self.input.file.atoms.bytes(text);
        self.number(bytes.len() as u32);
        self.found.bytes.extend_from_slice(bytes);
    }

    fn declare(&mut self, decl: Decl) {
        let symbol = self.input.file.bound.declared_symbol(decl);
        if symbol.is_none() {
            self.is_unsupported = true;
            return;
        }
        self.symbol(symbol);
    }

    fn symbol(&mut self, symbol: SymbolId) {
        let bound = self.input.file.bound;
        let is_declared_inside = match bound.code_unit(bound.symbol_scope(symbol)) {
            CodeUnit::Function(function) => self.found.inner_functions.contains(&function),
            CodeUnit::File | CodeUnit::FieldInitializer(_) => false,
        };
        if is_declared_inside || symbol == bound.declared_symbol(Decl::Fn(self.root)) {
            let next = self.locals.len() as u32;
            let index = *self.locals.entry(symbol).or_insert(next);
            self.tag(Tag::Local);
            self.number(index);
            return;
        }
        self.outer(OuterName::Symbol(symbol));
    }

    fn outer(&mut self, name: OuterName) {
        let known = self
            .found
            .outer_names
            .iter()
            .position(|&outer| outer == name);
        let index = known.unwrap_or_else(|| {
            self.found.outer_names.push(name);
            self.found.outer_names.len() - 1
        });
        self.tag(Tag::Outer);
        self.number(index as u32);
    }

    fn identifier(&mut self, expression: ExprId, name: Atom) {
        let bound = self.input.file.bound;
        if !has_fixed_binding(bound, expression) {
            self.is_unsupported = true;
            return;
        }
        match bound.binding(expression) {
            Binding::Symbol(symbol) => self.symbol(symbol),
            Binding::Arguments(_) => self.tag(Tag::Arguments),
            Binding::CommonJs(variable) => {
                self.tag(Tag::CommonJs);
                self.byte(variable as u8);
            }
            Binding::Free if (self.input.is_outer_name)(name) => {
                self.outer(OuterName::Free(name));
            }
            Binding::Free if name == known::undefined => self.tag(Tag::Undefined),
            Binding::Free => {
                self.found.globals.push(expression);
                self.tag(Tag::Global);
                self.text(name);
            }
        }
    }

    fn label(&mut self, label: Atom) {
        if label == Atom::NONE {
            self.number(u32::MAX);
            return;
        }
        match self.labels.iter().rposition(|&open| open == label) {
            Some(depth) => self.number(depth as u32),
            None => self.is_unsupported = true,
        }
    }

    fn function(&mut self, function: FnId) {
        if self.is_stopped() {
            return;
        }
        let hir = self.input.file.hir;
        let record = hir[function];
        let kind = match record.kind {
            FnKind::Decl | FnKind::Expr => 0,
            FnKind::Arrow => 1,
            FnKind::Method => 2,
            FnKind::Getter => 3,
            FnKind::Setter => 4,
            _ => {
                self.is_unsupported = true;
                return;
            }
        };
        self.found.inner_functions.push(function);
        self.tag(Tag::Function);
        self.byte(kind);
        self.byte(u8::from(record.flags.contains(Flags::ASYNC)));
        self.byte(u8::from(record.flags.contains(Flags::GENERATOR)));
        let has_own_name = record.name != Atom::NONE && kind == 0;
        if function != self.root {
            self.byte(u8::from(has_own_name));
            if has_own_name {
                self.declare(Decl::Fn(function));
            }
        }
        self.number(record.params.len() as u32);
        for parameter in record.params.iter() {
            let parameter = hir[parameter];
            self.byte(u8::from(parameter.flags.contains(Flags::REST)));
            self.pattern(parameter.pat, true);
            self.expression(parameter.default);
        }
        let open_labels = core::mem::take(&mut self.labels);
        match canonical_body(hir, function) {
            CanonicalBody::Missing => self.is_unsupported = true,
            CanonicalBody::Expression(body) => {
                self.byte(0);
                self.expression(body);
            }
            CanonicalBody::Statements(statements) => {
                self.byte(1);
                self.statements(statements);
            }
        }
        self.labels = open_labels;
    }

    fn statements(&mut self, statements: hir::IdList<StmtId>) {
        self.number(statements.len() as u32);
        for statement in self.input.file.hir.ids(statements) {
            self.statement(statement);
        }
    }

    fn pattern(&mut self, pattern: PatId, is_parameter: bool) {
        if self.is_stopped() {
            return;
        }
        let hir = self.input.file.hir;
        self.tag(Tag::Pattern);
        match hir[pattern].kind {
            PatKind::Missing => self.byte(0),
            PatKind::Ident(_) => {
                self.byte(1);
                self.declare(match is_parameter {
                    true => Decl::Param(pattern),
                    false => Decl::Var(pattern),
                });
            }
            PatKind::Object(properties) => {
                self.byte(2);
                self.number(properties.len() as u32);
                for property in properties.iter() {
                    let property = hir[property];
                    self.byte(u8::from(property.is_rest));
                    self.property_key(property.key);
                    self.pattern(property.value, is_parameter);
                    self.expression(property.default);
                }
            }
            PatKind::Array(elements) => {
                self.byte(3);
                self.number(elements.len() as u32);
                for element in elements.iter() {
                    let element = hir[element];
                    self.byte(u8::from(element.is_rest));
                    self.pattern(element.pat, is_parameter);
                    self.expression(element.default);
                }
            }
        }
    }

    fn property_key(&mut self, key: PropKey) {
        match key {
            PropKey::None => self.byte(0),
            PropKey::Name(name) => self.texts(1, &[name]),
            PropKey::Private(_) => self.is_unsupported = true,
            PropKey::Computed(expression) => self.node(&[2], &[expression], &[]),
        }
    }

    fn declaration(&mut self, declaration: VarDeclId) {
        let declaration = self.input.file.hir[declaration];
        self.tag(Tag::Declaration);
        self.byte(declaration.kind as u8);
        self.pattern(declaration.pat, false);
        self.expression(declaration.init);
    }

    fn texts(&mut self, code: u8, texts: &[Atom]) {
        self.byte(code);
        for &text in texts {
            self.text(text);
        }
    }

    fn node(&mut self, head: &[u8], expressions: &[ExprId], statements: &[StmtId]) {
        self.found.bytes.extend_from_slice(head);
        for &expression in expressions {
            self.expression(expression);
        }
        for &statement in statements {
            self.statement(statement);
        }
    }

    fn statement(&mut self, statement: StmtId) {
        if statement.is_none() {
            return self.tag(Tag::None);
        }
        if self.is_stopped() {
            return;
        }
        let hir = self.input.file.hir;
        self.tag(Tag::Statement);
        match hir[canonical_statement(hir, statement)].kind {
            StmtKind::Empty => self.byte(0),
            StmtKind::Block(statements) if statements.is_empty() => self.byte(0),
            StmtKind::Debugger => self.byte(1),
            StmtKind::Expr(expression) => self.node(&[2], &[expression], &[]),
            StmtKind::Var(declarations) => {
                self.byte(3);
                self.number(declarations.len() as u32);
                for declaration in declarations.iter() {
                    self.declaration(declaration);
                }
            }
            StmtKind::Fn(function) => {
                self.byte(4);
                self.function(function);
            }
            StmtKind::Return(value) => self.node(&[5], &[value], &[]),
            StmtKind::If { test, yes, no } => self.node(&[6], &[test], &[yes, no]),
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => self.node(&[7], &[test, update], &[init, body]),
            StmtKind::ForIn { left, expr, body } => self.node(&[8], &[expr], &[left, body]),
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => self.node(&[9, u8::from(is_await)], &[expr], &[left, body]),
            StmtKind::While { test, body } => self.node(&[10], &[test], &[body]),
            StmtKind::DoWhile { body, test } => self.node(&[11], &[test], &[body]),
            StmtKind::Block(statements) => {
                self.byte(12);
                self.statements(statements);
            }
            StmtKind::Switch { expr, cases } => {
                self.node(&[13], &[expr], &[]);
                self.number(cases.len() as u32);
                for case in cases.iter() {
                    let case = hir[case];
                    self.tag(Tag::Case);
                    self.expression(case.test);
                    self.statements(case.body);
                }
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.node(&[14], &[], &[block, handler, finalizer]);
                match param.is_some() {
                    true => self.declaration(param),
                    false => self.tag(Tag::None),
                }
            }
            StmtKind::Throw(value) => self.node(&[15], &[value], &[]),
            StmtKind::Break(label) => {
                self.byte(16);
                self.label(label);
            }
            StmtKind::Continue(label) => {
                self.byte(17);
                self.label(label);
            }
            StmtKind::Labeled { label, body } => {
                self.byte(18);
                self.labels.push(label);
                self.statement(body);
                self.labels.pop();
            }
            StmtKind::Directive { raw, .. } => self.texts(19, &[raw]),
            _ => self.is_unsupported = true,
        }
    }

    fn expressions(&mut self, expressions: hir::IdList<ExprId>) {
        self.number(expressions.len() as u32);
        for expression in self.input.file.hir.ids(expressions) {
            self.expression(expression);
        }
    }

    fn unary(&mut self, operator: UnOp, operand: ExprId) {
        let hir = self.input.file.hir;
        let number = match hir[hir.skip_type_assertions(operand)].kind {
            ExprKind::Number(index) => Some(hir.numbers[index as usize]),
            _ => None,
        };
        match (operator, number) {
            (UnOp::Not, Some(number)) => self.byte(match number == 0.0 {
                true => 4,
                false => 5,
            }),
            (UnOp::Void, Some(_)) => {
                self.byte(1);
                self.tag(Tag::Undefined);
            }
            _ => self.node(&[18, operator as u8], &[operand], &[]),
        }
    }

    fn compares_type_name(&self, left: ExprId, right: ExprId) -> bool {
        let hir = self.input.file.hir;
        let kind_of = |expression: ExprId| hir[hir.skip_type_assertions(expression)].kind;
        matches!(
            (kind_of(left), kind_of(right)),
            (ExprKind::Unary { op, .. }, ExprKind::String(_))
                | (ExprKind::String(_), ExprKind::Unary { op, .. }) if op == UnOp::Typeof
        )
    }

    fn call(&mut self, code: u8, call: hir::CallId) {
        let call = self.input.file.hir[call];
        self.node(&[code, call.chain as u8], &[call.callee], &[]);
        self.expressions(call.args);
    }

    fn expression(&mut self, expression: ExprId) {
        if expression.is_none() {
            return self.tag(Tag::None);
        }
        if self.is_stopped() {
            return;
        }
        let hir = self.input.file.hir;
        let expression = hir.skip_type_assertions(expression);
        self.tag(Tag::Expression);
        match hir[expression].kind {
            ExprKind::Missing => self.byte(0),
            ExprKind::Ident(name) => {
                self.byte(1);
                self.identifier(expression, name);
            }
            ExprKind::This => self.byte(2),
            ExprKind::Null => self.byte(3),
            ExprKind::True => self.byte(4),
            ExprKind::False => self.byte(5),
            ExprKind::Number(index) => {
                self.byte(6);
                let bits = hir.numbers[index as usize].to_bits();
                self.found.bytes.extend_from_slice(&bits.to_le_bytes());
            }
            ExprKind::String(text) => self.texts(7, &[text]),
            ExprKind::BigInt(digits) => self.texts(8, &[digits]),
            ExprKind::Regex { pattern, flags } => self.texts(9, &[pattern, flags]),
            ExprKind::Template { exprs } => {
                self.byte(10);
                let texts = hir.template_texts(exprs);
                self.number(texts.len() as u32);
                for text in hir.ids(texts) {
                    self.text(text);
                }
                self.expressions(exprs);
            }
            ExprKind::Array(elements) => {
                self.byte(11);
                self.expressions(elements);
            }
            ExprKind::Object(properties) => {
                self.byte(12);
                self.number(properties.len() as u32);
                for property in properties.iter() {
                    let property = hir[property];
                    self.tag(Tag::Property);
                    self.byte(match property.kind {
                        PropKind::Init | PropKind::Shorthand => 0,
                        PropKind::Spread => 1,
                        PropKind::Method => 2,
                        PropKind::Getter => 3,
                        PropKind::Setter => 4,
                    });
                    self.property_key(property.key);
                    self.expression(property.value);
                }
            }
            ExprKind::Fn(function) => {
                self.byte(13);
                self.function(function);
            }
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                self.node(&[14, chain as u8], &[obj], &[]);
                self.text(name);
            }
            ExprKind::Index { obj, index, chain } => {
                self.node(&[15, chain as u8], &[obj, index], &[]);
            }
            ExprKind::Call(call) => self.call(16, call),
            ExprKind::New(call) => self.call(17, call),
            ExprKind::Unary { op, operand } => self.unary(op, operand),
            ExprKind::Binary { op, left, right } => {
                let op = match op {
                    BinOp::EqEq if self.compares_type_name(left, right) => BinOp::EqEqEq,
                    BinOp::NotEq if self.compares_type_name(left, right) => BinOp::NotEqEq,
                    _ => op,
                };
                self.node(&[19, op as u8], &[left, right], &[]);
            }
            ExprKind::Assign { op, target, value } => {
                self.node(
                    &[20, op.map_or(u8::MAX, |op| op as u8)],
                    &[target, value],
                    &[],
                );
            }
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                self.node(&[21], &[test, branches.yes, branches.no], &[]);
            }
            ExprKind::Spread(operand) => self.node(&[22], &[operand], &[]),
            ExprKind::Await(operand) => self.node(&[23], &[operand], &[]),
            ExprKind::Yield { value, star } => self.node(&[24, u8::from(star)], &[value], &[]),
            ExprKind::NewTarget(_) => self.byte(25),
            _ => self.is_unsupported = true,
        }
        self.tag(Tag::End);
    }
}
