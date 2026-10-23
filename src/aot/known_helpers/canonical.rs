use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Bound, CommonJsVariable, Decl, SymbolId};
use bun_sema::hir::{
    self, BinOp, Chain, ClassId, ExprId, ExprKind, Flags, FnBody, FnId, FnKind, NodeData, PatId,
    PatKind, PropKey, PropKind, StmtId, StmtKind, UnOp, VarDeclId, VarKind,
};
use bun_sema::util::{FxHashMap, FxHashSet};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum OuterName {
    Symbol(SymbolId),
    Free(Atom),
}

pub(super) struct CanonicalFunction {
    pub(super) bytes: Vec<u8>,
    pub(super) outer_names: Vec<OuterName>,
    pub(super) inner_functions: Vec<FnId>,
    /// The names in the function that mean a global.
    pub(super) globals: Vec<ExprId>,
}

pub(super) struct CanonicalInput<'a, 's> {
    pub(super) hir: &'a hir::File<'s>,
    pub(super) bound: &'a Bound<'s>,
    pub(super) atoms: &'a Interner<'s>,
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
    declared: FxHashSet<SymbolId>,
    locals: FxHashMap<SymbolId, u32>,
    labels: Vec<Atom>,
    outer_names: Vec<OuterName>,
    inner_functions: Vec<FnId>,
    globals: Vec<ExprId>,
    bytes: Vec<u8>,
    root: FnId,
    is_collecting: bool,
    is_unsupported: bool,
}

pub(super) fn canonical_function(
    input: &CanonicalInput<'_, '_>,
    function: FnId,
) -> Option<CanonicalFunction> {
    let mut writer = Writer {
        input,
        declared: FxHashSet::default(),
        locals: FxHashMap::default(),
        labels: Vec::new(),
        outer_names: Vec::new(),
        inner_functions: Vec::new(),
        globals: Vec::new(),
        bytes: Vec::new(),
        root: function,
        is_collecting: true,
        is_unsupported: false,
    };
    writer.function(function);
    if writer.is_unsupported {
        return None;
    }
    writer.is_collecting = false;
    writer.bytes.clear();
    writer.inner_functions.clear();
    writer.function(function);
    if writer.is_unsupported {
        return None;
    }
    Some(CanonicalFunction {
        bytes: writer.bytes,
        outer_names: writer.outer_names,
        inner_functions: writer.inner_functions,
        globals: writer.globals,
    })
}

impl Writer<'_, '_> {
    fn is_stopped(&mut self) -> bool {
        self.is_unsupported |= self.bytes.len() > self.input.max_bytes;
        self.is_unsupported
    }

    fn tag(&mut self, tag: Tag) {
        self.bytes.push(tag as u8);
    }

    fn byte(&mut self, byte: u8) {
        self.bytes.push(byte);
    }

    fn number(&mut self, number: u32) {
        self.bytes.extend_from_slice(&number.to_le_bytes());
    }

    fn text(&mut self, text: Atom) {
        if text == Atom::NONE {
            self.number(u32::MAX);
            return;
        }
        let bytes = self.input.atoms.bytes(text);
        self.number(bytes.len() as u32);
        self.bytes.extend_from_slice(bytes);
    }

    fn declare(&mut self, decl: Decl) {
        let symbol = self.input.bound.declared_symbol(decl);
        if self.is_collecting {
            if symbol.is_some() {
                self.declared.insert(symbol);
            }
            self.tag(Tag::Local);
            return;
        }
        if symbol.is_none() {
            self.is_unsupported = true;
            return;
        }
        self.symbol(symbol);
    }

    fn declare_root_name(&mut self, has_own_name: bool) {
        if !has_own_name || !self.is_collecting {
            return;
        }
        let symbol = self.input.bound.declared_symbol(Decl::Fn(self.root));
        if symbol.is_some() {
            self.declared.insert(symbol);
        }
    }

    fn symbol(&mut self, symbol: SymbolId) {
        if self.is_collecting {
            self.tag(Tag::Local);
            return;
        }
        if self.declared.contains(&symbol) {
            let next = self.locals.len() as u32;
            let index = *self.locals.entry(symbol).or_insert(next);
            self.tag(Tag::Local);
            self.number(index);
            return;
        }
        self.outer(OuterName::Symbol(symbol));
    }

    fn outer(&mut self, name: OuterName) {
        let known = self.outer_names.iter().position(|&outer| outer == name);
        let index = known.unwrap_or_else(|| {
            self.outer_names.push(name);
            self.outer_names.len() - 1
        });
        self.tag(Tag::Outer);
        self.number(index as u32);
    }

    fn identifier(&mut self, expression: ExprId, name: Atom) {
        let bound = self.input.bound;
        if bound
            .dynamic_lookup_scope(NodeData::Expr(expression))
            .is_some()
        {
            self.is_unsupported = true;
            return;
        }
        match bound.binding(expression) {
            Binding::Symbol(symbol) => self.symbol(symbol),
            Binding::Arguments(_) => self.tag(Tag::Arguments),
            Binding::CommonJs(variable) => {
                self.tag(Tag::CommonJs);
                self.byte(match variable {
                    CommonJsVariable::Module => 0,
                    CommonJsVariable::Exports => 1,
                    CommonJsVariable::Require => 2,
                    CommonJsVariable::Filename => 3,
                    CommonJsVariable::Dirname => 4,
                });
            }
            Binding::Free if !self.is_collecting && (self.input.is_outer_name)(name) => {
                self.outer(OuterName::Free(name));
            }
            Binding::Free if name == known::undefined => self.tag(Tag::Undefined),
            Binding::Free => {
                if !self.is_collecting {
                    self.globals.push(expression);
                }
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
        let hir = self.input.hir;
        let record = hir[function];
        let kind = match record.kind {
            FnKind::Decl | FnKind::Expr => 0,
            FnKind::Arrow => 1,
            FnKind::Method => 2,
            FnKind::Getter => 3,
            FnKind::Setter => 4,
            FnKind::Constructor
            | FnKind::StaticBlock
            | FnKind::CallSignature
            | FnKind::ConstructSignature
            | FnKind::FunctionType
            | FnKind::ConstructorType
            | FnKind::IndexSignature => {
                self.is_unsupported = true;
                return;
            }
        };
        self.inner_functions.push(function);
        self.tag(Tag::Function);
        self.byte(kind);
        self.byte(u8::from(record.flags.contains(Flags::ASYNC)));
        self.byte(u8::from(record.flags.contains(Flags::GENERATOR)));
        let has_own_name = record.name != Atom::NONE && kind == 0;
        if function == self.root {
            self.declare_root_name(has_own_name);
        } else {
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
            self.optional_expression(parameter.default);
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
        for statement in self.input.hir.ids(statements) {
            self.statement(statement);
        }
    }

    fn pattern(&mut self, pattern: PatId, is_parameter: bool) {
        if self.is_stopped() {
            return;
        }
        let hir = self.input.hir;
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
                    self.optional_expression(property.default);
                }
            }
            PatKind::Array(elements) => {
                self.byte(3);
                self.number(elements.len() as u32);
                for element in elements.iter() {
                    let element = hir[element];
                    self.byte(u8::from(element.is_rest));
                    self.pattern(element.pat, is_parameter);
                    self.optional_expression(element.default);
                }
            }
        }
    }

    fn property_key(&mut self, key: PropKey) {
        match key {
            PropKey::None => self.byte(0),
            PropKey::Name(name) => {
                self.byte(1);
                self.text(name);
            }
            PropKey::Private(_) => self.is_unsupported = true,
            PropKey::Computed(expression) => {
                self.byte(2);
                self.expression(expression);
            }
        }
    }

    fn declaration(&mut self, declaration: VarDeclId) {
        let declaration = self.input.hir[declaration];
        self.tag(Tag::Declaration);
        self.byte(match declaration.kind {
            VarKind::Var => 0,
            VarKind::Let => 1,
            VarKind::Const => 2,
            VarKind::Using => 3,
            VarKind::AwaitUsing => 4,
        });
        self.pattern(declaration.pat, false);
        self.optional_expression(declaration.init);
    }

    fn optional_statement(&mut self, statement: StmtId) {
        match statement.is_some() {
            true => self.statement(statement),
            false => self.tag(Tag::None),
        }
    }

    fn optional_expression(&mut self, expression: ExprId) {
        match expression.is_some() {
            true => self.expression(expression),
            false => self.tag(Tag::None),
        }
    }

    fn class(&mut self, _class: ClassId) {
        self.is_unsupported = true;
    }

    fn statement(&mut self, statement: StmtId) {
        if self.is_stopped() {
            return;
        }
        let hir = self.input.hir;
        self.tag(Tag::Statement);
        match hir[canonical_statement(hir, statement)].kind {
            StmtKind::Empty => self.byte(0),
            StmtKind::Block(statements) if statements.is_empty() => self.byte(0),
            StmtKind::Debugger => self.byte(1),
            StmtKind::Expr(expression) => {
                self.byte(2);
                self.expression(expression);
            }
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
            StmtKind::Class(class) => self.class(class),
            StmtKind::Return(value) => {
                self.byte(5);
                self.optional_expression(value);
            }
            StmtKind::If { test, yes, no } => {
                self.byte(6);
                self.expression(test);
                self.statement(yes);
                self.optional_statement(no);
            }
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.byte(7);
                self.optional_statement(init);
                self.optional_expression(test);
                self.optional_expression(update);
                self.statement(body);
            }
            StmtKind::ForIn { left, expr, body } => {
                self.byte(8);
                self.statement(left);
                self.expression(expr);
                self.statement(body);
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => {
                self.byte(9);
                self.byte(u8::from(is_await));
                self.statement(left);
                self.expression(expr);
                self.statement(body);
            }
            StmtKind::While { test, body } => {
                self.byte(10);
                self.expression(test);
                self.statement(body);
            }
            StmtKind::DoWhile { body, test } => {
                self.byte(11);
                self.statement(body);
                self.expression(test);
            }
            StmtKind::Block(statements) => {
                self.byte(12);
                self.statements(statements);
            }
            StmtKind::Switch { expr, cases } => {
                self.byte(13);
                self.expression(expr);
                self.number(cases.len() as u32);
                for case in cases.iter() {
                    let case = hir[case];
                    self.tag(Tag::Case);
                    self.optional_expression(case.test);
                    self.statements(case.body);
                }
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.byte(14);
                self.statement(block);
                match param.is_some() {
                    true => self.declaration(param),
                    false => self.tag(Tag::None),
                }
                self.optional_statement(handler);
                self.optional_statement(finalizer);
            }
            StmtKind::Throw(value) => {
                self.byte(15);
                self.expression(value);
            }
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
            StmtKind::Directive { raw, .. } => {
                self.byte(19);
                self.text(raw);
            }
            StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Enum(_)
            | StmtKind::Module(_)
            | StmtKind::Import(_)
            | StmtKind::ImportEquals(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportDefault(_)
            | StmtKind::ExportAssign(_)
            | StmtKind::ExportAsNamespace(_)
            | StmtKind::With { .. } => self.is_unsupported = true,
        }
    }

    fn chain(&mut self, chain: Chain) {
        self.byte(match chain {
            Chain::No => 0,
            Chain::Start => 1,
            Chain::Continue => 2,
        });
    }

    fn expressions(&mut self, expressions: hir::IdList<ExprId>) {
        self.number(expressions.len() as u32);
        for expression in self.input.hir.ids(expressions) {
            self.expression(expression);
        }
    }

    fn literal_number(&self, expression: ExprId) -> Option<f64> {
        let hir = self.input.hir;
        match hir[hir.skip_type_assertions(expression)].kind {
            ExprKind::Number(index) => Some(hir.numbers[index as usize]),
            _ => None,
        }
    }

    fn unary(&mut self, operator: UnOp, operand: ExprId) {
        match (operator, self.literal_number(operand)) {
            (UnOp::Not, Some(number)) => self.byte(match number == 0.0 {
                true => 4,
                false => 5,
            }),
            (UnOp::Void, Some(_)) => {
                self.byte(1);
                self.tag(Tag::Undefined);
            }
            _ => {
                self.byte(18);
                self.byte(unary_operator_code(operator));
                self.expression(operand);
            }
        }
    }

    fn compares_type_name(&self, left: ExprId, right: ExprId) -> bool {
        let hir = self.input.hir;
        let kind_of = |expression: ExprId| hir[hir.skip_type_assertions(expression)].kind;
        matches!(
            (kind_of(left), kind_of(right)),
            (
                ExprKind::Unary {
                    op: UnOp::Typeof,
                    ..
                },
                ExprKind::String(_)
            ) | (
                ExprKind::String(_),
                ExprKind::Unary {
                    op: UnOp::Typeof,
                    ..
                }
            )
        )
    }

    fn call(&mut self, call: hir::CallId) {
        let call = self.input.hir[call];
        self.chain(call.chain);
        self.expression(call.callee);
        self.expressions(call.args);
    }

    fn expression(&mut self, expression: ExprId) {
        if self.is_stopped() {
            return;
        }
        let hir = self.input.hir;
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
                self.bytes.extend_from_slice(&bits.to_le_bytes());
            }
            ExprKind::String(text) => {
                self.byte(7);
                self.text(text);
            }
            ExprKind::BigInt(digits) => {
                self.byte(8);
                self.text(digits);
            }
            ExprKind::Regex { pattern, flags } => {
                self.byte(9);
                self.text(pattern);
                self.text(flags);
            }
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
                    self.optional_expression(property.value);
                }
            }
            ExprKind::Fn(function) => {
                self.byte(13);
                self.function(function);
            }
            ExprKind::Class(class) => self.class(class),
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                self.byte(14);
                self.chain(chain);
                self.expression(obj);
                self.text(name);
            }
            ExprKind::Index { obj, index, chain } => {
                self.byte(15);
                self.chain(chain);
                self.expression(obj);
                self.expression(index);
            }
            ExprKind::Call(call) => {
                self.byte(16);
                self.call(call);
            }
            ExprKind::New(call) => {
                self.byte(17);
                self.call(call);
            }
            ExprKind::Unary { op, operand } => self.unary(op, operand),
            ExprKind::Binary { op, left, right } => {
                let op = match op {
                    BinOp::EqEq if self.compares_type_name(left, right) => BinOp::EqEqEq,
                    BinOp::NotEq if self.compares_type_name(left, right) => BinOp::NotEqEq,
                    _ => op,
                };
                self.byte(19);
                self.byte(binary_operator_code(op));
                self.expression(left);
                self.expression(right);
            }
            ExprKind::Assign { op, target, value } => {
                self.byte(20);
                self.byte(op.map_or(u8::MAX, binary_operator_code));
                self.expression(target);
                self.expression(value);
            }
            ExprKind::Cond { test, branches } => {
                self.byte(21);
                let branches = hir.branches(branches);
                self.expression(test);
                self.expression(branches.yes);
                self.expression(branches.no);
            }
            ExprKind::Spread(operand) => {
                self.byte(22);
                self.expression(operand);
            }
            ExprKind::Await(operand) => {
                self.byte(23);
                self.expression(operand);
            }
            ExprKind::Yield { value, star } => {
                self.byte(24);
                self.byte(u8::from(star));
                self.optional_expression(value);
            }
            ExprKind::NewTarget(_) => self.byte(25),
            ExprKind::PrivateIdentifier(_)
            | ExprKind::Super
            | ExprKind::TaggedTemplate(_)
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_)
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Jsx(_)
            | ExprKind::ImportCall { .. }
            | ExprKind::ImportMeta
            | ExprKind::JsxText(_) => self.is_unsupported = true,
        }
        self.tag(Tag::End);
    }
}

fn unary_operator_code(operator: UnOp) -> u8 {
    match operator {
        UnOp::Plus => 0,
        UnOp::Minus => 1,
        UnOp::BitNot => 2,
        UnOp::Not => 3,
        UnOp::Typeof => 4,
        UnOp::Void => 5,
        UnOp::Delete => 6,
        UnOp::PreInc => 7,
        UnOp::PreDec => 8,
        UnOp::PostInc => 9,
        UnOp::PostDec => 10,
    }
}

fn binary_operator_code(operator: BinOp) -> u8 {
    match operator {
        BinOp::Add => 0,
        BinOp::Sub => 1,
        BinOp::Mul => 2,
        BinOp::Div => 3,
        BinOp::Rem => 4,
        BinOp::Pow => 5,
        BinOp::Shl => 6,
        BinOp::Shr => 7,
        BinOp::UShr => 8,
        BinOp::BitAnd => 9,
        BinOp::BitOr => 10,
        BinOp::BitXor => 11,
        BinOp::Lt => 12,
        BinOp::Le => 13,
        BinOp::Gt => 14,
        BinOp::Ge => 15,
        BinOp::EqEq => 16,
        BinOp::NotEq => 17,
        BinOp::EqEqEq => 18,
        BinOp::NotEqEq => 19,
        BinOp::In => 20,
        BinOp::Instanceof => 21,
        BinOp::And => 22,
        BinOp::Or => 23,
        BinOp::Nullish => 24,
        BinOp::Comma => 25,
    }
}
