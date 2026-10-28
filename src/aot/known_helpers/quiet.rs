use crate::builtins::id::BuiltinId;
use crate::builtins::table::{self, BuiltinKind, MemberLookup, Mutability};
use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Bound, CommonJsVariable, Parent};
use bun_sema::fold::Decisions;
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, Flags, FnBody, FnId, MemberKey, NodeData, PatKind,
    PropKey, PropKind, StmtId, StmtKind, UnOp, VarDeclId, VarKind,
};

/// Tells the code that runs nothing of its file: it calls no function, stores to nothing that was there before it and hands nothing of the file to anybody.
pub struct Quiet<'a, 's> {
    pub atoms: &'a Interner<'s>,
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub decisions: &'a Decisions<'s>,
    /// A read of a global, or of a member of one, that start-up does not lock counts as quiet.
    pub allows_reads_of_open_globals: bool,
    /// A call that runs nothing of the program once its arguments are there.
    pub runs_nothing: &'a dyn Fn(hir::CallId) -> bool,
}

/// A plain object that has no such property of its own answers `undefined`: `Object.prototype` has none and takes none.
pub(super) fn is_absent_from_object_prototype(atoms: &Interner<'_>, name: Atom) -> bool {
    let known_name = table::find_name(atoms.bytes(name));
    let is_inherited = known_name
        .is_some_and(|name| table::own_member(BuiltinId::ObjectPrototype, name).is_some());
    !is_inherited && name != known::__proto__
}

pub(super) fn enclosing_statement(bound: &Bound<'_>, mut expression: ExprId) -> Option<StmtId> {
    loop {
        match bound.parent_of_expr(expression) {
            Parent::Expr(parent) => expression = parent,
            Parent::VarInit(declaration) => return bound.var_stmt[declaration.idx()].some(),
            Parent::Stmt(statement) => return statement.some(),
            _ => return None,
        }
    }
}

pub(super) fn is_in_statement_of_file(bound: &Bound<'_>, expression: ExprId) -> bool {
    enclosing_statement(bound, expression)
        .is_some_and(|statement| bound.parent_of_stmt(statement) == Parent::File)
}

/// Neither `with` nor evaluated text decides at run time what the name means.
pub(super) fn has_fixed_binding(bound: &Bound<'_>, name: ExprId) -> bool {
    bound.dynamic_lookup_scope(NodeData::Expr(name)).is_none()
}

pub(super) fn is_global_name(bound: &Bound<'_>, name: ExprId) -> bool {
    bound.binding(name) == Binding::Free && has_fixed_binding(bound, name)
}

/// `object.name` and `object["name"]` outside an optional chain.
pub(super) fn plain_member(hir: &hir::File<'_>, expression: ExprId) -> Option<(ExprId, Atom)> {
    let (ExprKind::Dot {
        chain: Chain::No, ..
    }
    | ExprKind::Index {
        chain: Chain::No, ..
    }) = hir[expression].kind
    else {
        return None;
    };
    match hir.member_key(expression)? {
        (object, MemberKey::Name(name)) => Some((object, name)),
        (_, MemberKey::PrivateName(_) | MemberKey::Computed(_)) => None,
    }
}

impl Quiet<'_, '_> {
    /// The built-in that a path of names from a global leads to, where every step is locked and none is an accessor.
    pub fn find_locked_builtin(&self, expression: ExprId) -> Option<BuiltinId> {
        let (hir, bound) = (self.hir, self.bound);
        let expression = hir.skip_type_assertions(expression);
        let found = match hir[expression].kind {
            ExprKind::Ident(name) if is_global_name(bound, expression) => {
                table::global(table::find_name(self.atoms.bytes(name))?)?
            }
            _ => {
                let (object, name) = plain_member(hir, expression)?;
                let holder = self.find_locked_builtin(object)?;
                let name = table::find_name(self.atoms.bytes(name))?;
                let MemberLookup::Found(found) = table::member(holder, name) else {
                    return None;
                };
                found
            }
        };
        let entry = table::entry(found);
        let is_fixed_value =
            entry.mutability == Mutability::AlwaysLocked && entry.kind != BuiltinKind::Accessor;
        is_fixed_value.then_some(found)
    }

    /// A locked path that leads to an object, which is truthy.
    pub fn names_locked_object(&self, expression: ExprId) -> bool {
        self.find_locked_builtin(expression).is_some_and(|found| {
            !matches!(
                table::entry(found).kind,
                BuiltinKind::Accessor
                    | BuiltinKind::DataProperty
                    | BuiltinKind::Constant
                    | BuiltinKind::NativeBinding
            )
        })
    }

    pub fn is_this_of_file(&self, expression: ExprId) -> bool {
        let expression = self.hir.skip_type_assertions(expression);
        matches!(self.hir[expression].kind, ExprKind::This)
            && is_in_statement_of_file(self.bound, expression)
    }

    // While nothing but quiet code has run, the object that a CommonJS file exports is as it was made: empty.
    fn is_untouched_exports(&self, expression: ExprId) -> bool {
        let expression = self.hir.skip_type_assertions(expression);
        let is_exports_variable = matches!(self.hir[expression].kind, ExprKind::Ident(_))
            && self.bound.binding(expression) == Binding::CommonJs(CommonJsVariable::Exports)
            && has_fixed_binding(self.bound, expression);
        is_exports_variable || self.is_this_of_file(expression)
    }

    fn is_quiet_name(&self, expression: ExprId, name: Atom) -> bool {
        if !has_fixed_binding(self.bound, expression) {
            return false;
        }
        match self.bound.binding(expression) {
            Binding::Symbol(_) | Binding::CommonJs(_) => true,
            Binding::Arguments(_) => false,
            Binding::Free => {
                name == known::undefined
                    || self.allows_reads_of_open_globals
                    || self.find_locked_builtin(expression).is_some()
            }
        }
    }

    // `Object.getOwnPropertyNames`, `import.meta.require`
    fn is_path_from_global(&self, expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let expression = hir.skip_type_assertions(expression);
        match hir[expression].kind {
            ExprKind::ImportMeta => true,
            ExprKind::Ident(_) => is_global_name(bound, expression),
            _ => plain_member(hir, expression)
                .is_some_and(|(object, _)| self.is_path_from_global(object)),
        }
    }

    fn is_quiet_member(&self, expression: ExprId) -> bool {
        plain_member(self.hir, expression).is_some_and(|(object, _)| {
            self.find_locked_builtin(expression).is_some()
                || self.is_untouched_exports(object)
                || (self.allows_reads_of_open_globals && self.is_path_from_global(object))
        })
    }

    fn is_quiet_literal(&self, properties: hir::Span<hir::PropId>) -> bool {
        properties.iter().all(|property| {
            let property = self.hir[property];
            let has_plain_key = matches!(property.key, PropKey::Name(_));
            match property.kind {
                PropKind::Init | PropKind::Shorthand => {
                    has_plain_key && self.is_quiet_expression(property.value)
                }
                PropKind::Method | PropKind::Getter | PropKind::Setter => has_plain_key,
                PropKind::Spread => false,
            }
        })
    }

    // `(function () { var inner = function () { .. }; return function () { .. }; })()`
    fn is_quiet_when_called(&self, function: FnId) -> bool {
        let record = self.hir[function];
        if record.flags.intersects(Flags::ASYNC | Flags::GENERATOR) || !record.params.is_empty() {
            return false;
        }
        match record.body {
            FnBody::None => false,
            FnBody::Expr(body) => self.is_quiet_expression(body),
            FnBody::Block(statements) => {
                let mut statements = self.hir.ids(statements);
                statements.all(|statement| self.is_quiet_statement(statement))
            }
        }
    }

    fn is_quiet_call(&self, call: hir::CallId) -> bool {
        let hir = self.hir;
        let site = hir[call];
        if site.chain != Chain::No {
            return false;
        }
        if (self.runs_nothing)(call) {
            return hir
                .ids(site.args)
                .all(|argument| self.is_quiet_expression(argument));
        }
        match hir[hir.skip_type_assertions(site.callee)].kind {
            ExprKind::Fn(function) => site.args.is_empty() && self.is_quiet_when_called(function),
            _ => false,
        }
    }

    pub fn is_quiet_expression(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        if expression.is_none() || self.decisions.is_dead_expr(expression) {
            return true;
        }
        let expression = hir.skip_type_assertions(expression);
        match hir[expression].kind {
            ExprKind::Missing
            | ExprKind::This
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::BigInt(_)
            | ExprKind::Regex { .. }
            | ExprKind::ImportMeta
            | ExprKind::Fn(_) => true,
            ExprKind::Template { exprs } => exprs.is_empty(),
            ExprKind::Ident(name) => self.is_quiet_name(expression, name),
            ExprKind::Dot { .. } | ExprKind::Index { .. } => self.is_quiet_member(expression),
            ExprKind::Unary {
                op: UnOp::Not | UnOp::Void | UnOp::Typeof,
                operand,
            } => self.is_quiet_expression(operand),
            ExprKind::Binary {
                op:
                    BinOp::And
                    | BinOp::Or
                    | BinOp::Nullish
                    | BinOp::Comma
                    | BinOp::EqEqEq
                    | BinOp::NotEqEq,
                left,
                right,
            } => self.is_quiet_expression(left) && self.is_quiet_expression(right),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                self.is_quiet_expression(test)
                    && self.is_quiet_expression(branches.yes)
                    && self.is_quiet_expression(branches.no)
            }
            ExprKind::Object(properties) => self.is_quiet_literal(properties),
            ExprKind::Array(elements) => hir
                .ids(elements)
                .all(|element| self.is_quiet_expression(element)),
            ExprKind::Call(call) => self.is_quiet_call(call),
            _ => false,
        }
    }

    fn is_quiet_declaration(&self, declaration: VarDeclId) -> bool {
        let declaration = self.hir[declaration];
        matches!(self.hir[declaration.pat].kind, PatKind::Ident(_))
            && matches!(
                declaration.kind,
                VarKind::Var | VarKind::Let | VarKind::Const
            )
            && self.is_quiet_expression(declaration.init)
    }

    pub fn is_quiet_statement(&self, statement: StmtId) -> bool {
        let hir = self.hir;
        if self.decisions.is_dead_stmt(statement) {
            return true;
        }
        match hir[statement].kind {
            StmtKind::Empty
            | StmtKind::Directive { .. }
            | StmtKind::Fn(_)
            | StmtKind::Interface(_)
            | StmtKind::TypeAlias(_)
            | StmtKind::Import(_)
            | StmtKind::ExportNamed(_)
            | StmtKind::ExportStar { .. }
            | StmtKind::ExportAsNamespace(_) => true,
            StmtKind::Var(declarations) => declarations
                .iter()
                .all(|declaration| self.is_quiet_declaration(declaration)),
            StmtKind::Expr(value) | StmtKind::Return(value) | StmtKind::ExportDefault(value) => {
                self.is_quiet_expression(value)
            }
            _ => false,
        }
    }

    /// Where the first statement of the file starts that is not quiet, or the first such declaration of that statement.
    pub fn find_end_of_head(&self) -> u32 {
        let hir = self.hir;
        let mut statements = hir.ids(hir.body);
        let Some(first) = statements.find(|&statement| !self.is_quiet_statement(statement)) else {
            return u32::MAX;
        };
        let StmtKind::Var(declarations) = hir[first].kind else {
            return hir[first].start;
        };
        let mut declarations = declarations.iter();
        let first = declarations.find(|&declaration| !self.is_quiet_declaration(declaration));
        let first = first.expect("a statement whose declarations are quiet is quiet");
        hir[hir[first].pat].pos
    }
}
