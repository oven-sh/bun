use super::{
    Candidate, Finder, InnerModule, InnerModuleKind, ModuleObject, ThisOfBody,
    find_functions_around,
};
use crate::builtins::id::BuiltinId;
use crate::builtins::table;
use crate::known_helpers::{Helper, KnownFunction, KnownReference};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, BindingKind, CodeUnit, Decl, FnOwner, Parent, SymbolId,
};
use bun_sema::fold::{Constant, Decision, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, FnBody, FnId, FnKind, MemberKey, PatKind, PropId,
    PropKey, PropKind, Span, StmtId, StmtKind, UnOp, VarDeclId, VarKind,
};
use bun_sema::util::FxHashMap;
use smallvec::SmallVec;

pub(super) struct Bootstrap {
    pub(super) function: FnId,
    pub(super) require: SymbolId,
    pub(super) modules: SymbolId,
    pub(super) cache: SymbolId,
    pub(super) literal: ExprId,
    pub(super) module_object: Option<ModuleObject>,
    pub(super) call: ExprId,
    pub(super) enclosing: Option<FnId>,
    pub(super) first_candidate: u32,
    pub(super) candidates: FxHashMap<Vec<u8>, u32>,
    pub(super) names_of_bodies: Vec<FxHashMap<Vec<u8>, u32>>,
    pub(super) bodies: Vec<(u32, u32)>,
    pub(super) members: Vec<(Atom, Option<StoredMember>)>,
    pub(super) member_mentions: Vec<MemberMention>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum MemberUse {
    Read,
    Called,
    Stored,
    StoredUnknown,
}

#[derive(Copy, Clone)]
pub(super) struct MemberMention {
    key: Atom,
    use_of_member: MemberUse,
}

#[derive(Copy, Clone)]
pub(super) struct StoredMember {
    function: FnId,
    stored_at: u32,
}

struct Parts {
    require: SymbolId,
    modules: SymbolId,
    cache: SymbolId,
    this: ThisOfBody,
    module_object: Option<ModuleObject>,
}

struct Evaluation {
    modules: SymbolId,
    require: SymbolId,
    this: ThisOfBody,
}

impl Bootstrap {
    pub(super) fn is_browserify(&self) -> bool {
        self.call.some().is_some()
    }

    fn is_in_body(&self, position: u32) -> bool {
        let behind = self.bodies.partition_point(|body| body.0 <= position);
        behind > 0 && position < self.bodies[behind - 1].1
    }
}

impl Finder<'_, '_> {
    fn keeps(&self, builtin: BuiltinId) -> bool {
        let mut replaced = self.replaced_builtins.iter();
        !replaced.any(|&member| BuiltinId::from_wire(member) == Some(builtin))
    }

    pub(super) fn symbol_of(&self, name: ExprId) -> Option<SymbolId> {
        let name = self.hir.skip_type_assertions(name);
        match (self.hir[name].kind, self.bound.binding(name)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => Some(symbol),
            _ => None,
        }
    }

    pub(super) fn names(&self, expression: ExprId, symbol: SymbolId) -> bool {
        self.symbol_of(expression) == Some(symbol)
    }

    fn read_element(&self, expression: ExprId) -> Option<(SymbolId, SymbolId)> {
        let ExprKind::Index {
            obj,
            index,
            chain: Chain::No,
        } = self.hir[expression.some()?].kind
        else {
            return None;
        };
        Some((self.symbol_of(obj)?, self.symbol_of(index)?))
    }

    pub(super) fn is_exports_of_symbol(&self, expression: ExprId, symbol: SymbolId) -> bool {
        let Some((object, MemberKey::Name(name))) = self.hir.member_key(expression) else {
            return false;
        };
        name == known::exports && self.names(object, symbol)
    }

    pub(super) fn read_only_declaration(&self, statement: StmtId) -> Option<(SymbolId, ExprId)> {
        let StmtKind::Var(declarations) = self.hir[statement].kind else {
            return None;
        };
        if declarations.len() != 1 {
            return None;
        }
        self.read_variable(declarations.at(0))
    }

    pub(super) fn read_variable(&self, declaration: VarDeclId) -> Option<(SymbolId, ExprId)> {
        let record = self.hir[declaration];
        let is_disposed = matches!(record.kind, VarKind::Using | VarKind::AwaitUsing);
        if is_disposed || !matches!(self.hir[record.pat].kind, PatKind::Ident(_)) {
            return None;
        }
        let symbol = self.bound.declared_symbol(Decl::Var(record.pat)).some()?;
        Some((symbol, record.init.some()?))
    }

    pub(super) fn has_no_dead_zone(&self, symbol: SymbolId) -> bool {
        matches!(
            self.bound.binding_kind(symbol),
            BindingKind::Var
                | BindingKind::Function
                | BindingKind::FunctionName
                | BindingKind::Parameter
                | BindingKind::SimpleCatchParameter
        )
    }

    fn is_undefined(&self, expression: ExprId) -> bool {
        let expression = self.hir.skip_type_assertions(expression);
        matches!(
            self.decisions.constant(self.hir, expression),
            FoldedValue::Constant(Constant::Undefined)
        )
    }

    fn tests_for_value(&self, test: ExprId, symbol: SymbolId) -> bool {
        let ExprKind::Binary {
            op: BinOp::NotEqEq,
            left,
            right,
        } = self.hir[test].kind
        else {
            return false;
        };
        (self.names(left, symbol) && self.is_undefined(right))
            || (self.names(right, symbol) && self.is_undefined(left))
    }

    fn read_only_statement(&self, statement: StmtId) -> Option<StmtId> {
        match self.hir[statement].kind {
            StmtKind::Block(statements) if statements.len() == 1 => {
                Some(self.hir.id_at(statements, 0))
            }
            StmtKind::Block(_) => None,
            _ => Some(statement),
        }
    }

    pub(super) fn is_new_module_object(&self, value: ExprId) -> bool {
        let ExprKind::Object(properties) = self.hir[value].kind else {
            return false;
        };
        let mut has_exports = false;
        properties.iter().all(|property: PropId| {
            let property = self.hir[property];
            let PropKey::Name(name) = property.key else {
                return false;
            };
            let value = property.value;
            match property.kind {
                PropKind::Init if name == known::exports => {
                    has_exports = true;
                    matches!(self.hir[value].kind, ExprKind::Object(inner) if inner.is_empty())
                }
                PropKind::Init => {
                    !hir::is_proto_setter(&property)
                        && (self
                            .symbol_of(value)
                            .is_some_and(|it| self.has_no_dead_zone(it))
                            || matches!(
                                self.decisions.constant(self.hir, value),
                                FoldedValue::Constant(_)
                            ))
                }
                _ => false,
            }
        }) && has_exports
    }

    fn read_evaluation(&self, call: ExprId, key: SymbolId, module: SymbolId) -> Option<Evaluation> {
        let hir = self.hir;
        let ExprKind::Call(call) = hir[call].kind else {
            return None;
        };
        let call = hir[call];
        if call.chain != Chain::No {
            return None;
        }
        let mut arguments: SmallVec<[ExprId; 4]> = hir.ids(call.args).collect();
        let (callee, this) = match hir.member_key(call.callee) {
            Some((callee, MemberKey::Name(name)))
                if self.files.atoms.bytes(name) == b"call"
                    && self.keeps(BuiltinId::FunctionPrototypeCall)
                    && arguments.len() == 4 =>
            {
                if !self.is_exports_of_symbol(arguments.remove(0), module) {
                    return None;
                }
                (callee, ThisOfBody::Exports)
            }
            _ => (call.callee, ThisOfBody::Unknown),
        };
        let (modules, index) = self.read_element(callee)?;
        let &[module_argument, exports, require] = &arguments[..] else {
            return None;
        };
        let is_evaluation = index == key
            && self.names(module_argument, module)
            && self.is_exports_of_symbol(exports, module);
        let require = self.symbol_of(require)?;
        is_evaluation.then_some(Evaluation {
            modules,
            require,
            this,
        })
    }

    fn read_mark(&self, expression: ExprId, module: SymbolId) -> Option<Atom> {
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = self.hir[expression].kind
        else {
            return None;
        };
        let Some((object, MemberKey::Name(name))) = self.hir.member_key(target) else {
            return None;
        };
        let is_mark = name != known::exports
            && self.names(object, module)
            && matches!(
                self.decisions.constant(self.hir, value),
                FoldedValue::Constant(Constant::Boolean(true))
            );
        is_mark.then_some(name)
    }

    fn read_module_object(
        &self,
        function: FnId,
        literal: ExprId,
        key: SymbolId,
        marks: &[Atom],
    ) -> Option<ModuleObject> {
        let ExprKind::Object(properties) = self.hir[literal].kind else {
            return None;
        };
        let mut names: SmallVec<[Atom; 4]> = SmallVec::new();
        for property in properties.iter() {
            let property = self.hir[property];
            let PropKey::Name(name) = property.key else {
                return None;
            };
            let is_index = self.files.atoms.bytes(name).iter().all(u8::is_ascii_digit);
            let names_other_variable = self
                .symbol_of(property.value)
                .is_some_and(|symbol| symbol != key);
            if is_index || names_other_variable || names.contains(&name) {
                return None;
            }
            names.push(name);
        }
        (marks.len() <= 1 && self.bound.is_stable_binding(key)).then_some(ModuleObject {
            literal,
            id: key,
            mark: marks.first().copied(),
            is_mark_strict: self
                .bound
                .is_strict_scope(self.bound.fns[function.idx()].scope),
        })
    }

    pub(super) fn can_expose_module_object(&self, candidate: usize) -> bool {
        let callback = self.candidates[candidate].module.callback;
        let Some(module_object) = self.bootstrap.as_ref().and_then(|it| it.module_object) else {
            return false;
        };
        let mut returns = self.bound.ids(self.bound.fns[callback.idx()].returns);
        module_object.mark.is_none()
            || returns.all(|statement: StmtId| self.decisions.is_dead_stmt(statement))
    }

    pub(super) fn find_ids_of_modules(&mut self) {
        for index in 0..self.candidates.len() {
            let candidate = &self.candidates[index];
            if !candidate.exposes_module_object {
                continue;
            }
            let calls = candidate.calls.iter().map(|&call| (call, 0));
            let requests = candidate.requests.iter().map(|&call| (call, 1));
            let mut ids = calls
                .chain(requests)
                .map(|(call, at)| self.read_argument(call, at));
            let first = ids.next().flatten();
            let has_one = ids.all(|id| id == first);
            let candidate = &mut self.candidates[index];
            candidate.module.id = first;
            candidate.is_refused |= !has_one;
        }
    }

    fn read_argument(&self, call: ExprId, at: usize) -> Option<Constant> {
        let ExprKind::Call(site) = self.hir[call].kind else {
            return None;
        };
        let argument: ExprId = self.hir.ids(self.hir[site].args).nth(at)?;
        match self
            .decisions
            .constant(self.hir, self.hir.skip_type_assertions(argument))
        {
            FoldedValue::Constant(constant) => Some(constant),
            _ => None,
        }
    }

    fn push_operands(&self, expression: ExprId, operands: &mut SmallVec<[ExprId; 4]>) {
        match self.hir[expression].kind {
            ExprKind::Binary {
                op: BinOp::Comma,
                left,
                right,
            } => {
                self.push_operands(left, operands);
                self.push_operands(right, operands);
            }
            _ => operands.push(expression),
        }
    }

    fn read_require_function(&self, function: FnId) -> Option<Parts> {
        let (hir, bound) = (self.hir, self.bound);
        let record = hir[function];
        let FnBody::Block(body) = record.body else {
            return None;
        };
        let runs_at_its_call = !record
            .flags
            .intersects(hir::Flags::ASYNC | hir::Flags::GENERATOR);
        if record.kind != FnKind::Decl
            || record.params.len() != 1
            || body.len() < 4
            || body.len() > 6
            || !runs_at_its_call
        {
            return None;
        }
        let statements: SmallVec<[StmtId; 6]> = hir.ids(body).collect();
        let (cached, cache_read) = self.read_only_declaration(statements[0])?;
        let (cache, key) = self.read_element(cache_read)?;
        if self.find_plain_parameter(function, 0) != Some(key) {
            return None;
        }
        let StmtKind::If { test, yes, no } = hir[statements[1]].kind else {
            return None;
        };
        let answer = self.read_only_statement(yes)?;
        let StmtKind::Return(answer) = hir[answer].kind else {
            return None;
        };
        if no.is_some()
            || !self.tests_for_value(test, cached)
            || !self.is_exports_of_symbol(answer.some()?, cached)
        {
            return None;
        }
        let (module, stored) = self.read_only_declaration(statements[2])?;
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[stored].kind
        else {
            return None;
        };
        if self.read_element(target) != Some((cache, key)) || !self.is_new_module_object(value) {
            return None;
        }
        let mut operands: SmallVec<[ExprId; 4]> = SmallVec::new();
        for (&statement, at) in statements[3..].iter().zip(4..) {
            match hir[statement].kind {
                StmtKind::Expr(expression) if at < statements.len() => {
                    self.push_operands(expression, &mut operands);
                }
                StmtKind::Return(expression) if at == statements.len() => {
                    self.push_operands(expression.some()?, &mut operands);
                }
                _ => return None,
            }
        }
        let (&answer, effects) = operands.split_last()?;
        let (&evaluation, marks) = effects.split_first()?;
        let Evaluation {
            modules,
            require,
            this,
        } = self.read_evaluation(evaluation, key, module)?;
        if !self.is_exports_of_symbol(answer, module) {
            return None;
        }
        let marks = marks.iter().map(|&mark| self.read_mark(mark, module));
        let marks: SmallVec<[Atom; 2]> = marks.collect::<Option<_>>()?;
        let module_object = self.read_module_object(function, value, key, &marks);
        let is_own_name = bound.declared_symbol(Decl::Fn(function)).some() == Some(require);
        let is_stable = [require, modules, cache]
            .iter()
            .all(|&symbol| bound.is_stable_binding(symbol) && !bound.is_visible_to_eval(symbol));
        (is_own_name && is_stable && modules != cache).then_some(Parts {
            require,
            modules,
            cache,
            this,
            module_object,
        })
    }

    pub(super) fn is_evaluated_once_at_top(&self, function: FnId) -> bool {
        let mut function = function;
        loop {
            function = match self.find_body_that_evaluates(function) {
                Some(Parent::File) => return true,
                Some(Parent::FnBody(around)) => around,
                _ => return false,
            };
        }
    }

    fn find_only_call(&self, function: FnId, written: ExprId) -> Option<ExprId> {
        let (hir, bound) = (self.hir, self.bound);
        if !matches!(hir[function].kind, FnKind::Expr | FnKind::Arrow)
            || bound.finds_itself(hir, function)
        {
            return None;
        }
        let user_of = |expression: ExprId| {
            let outermost = super::find_outermost_type_assertion(hir, bound, expression);
            match bound.parent_of_expr(outermost) {
                Parent::Expr(user) if user.is_some() => Some((outermost, user)),
                _ => None,
            }
        };
        let (mut callee, mut user) = user_of(written)?;
        if let Some((object, MemberKey::Name(name))) = hir.member_key(user) {
            let is_call = object == callee
                && self.files.atoms.bytes(name) == b"call"
                && self.keeps(BuiltinId::FunctionPrototypeCall);
            if !is_call {
                return None;
            }
            (callee, user) = user_of(user)?;
        }
        let ExprKind::Call(call) = hir[user].kind else {
            return None;
        };
        (hir[call].callee == callee && hir[call].chain == Chain::No).then_some(user)
    }

    fn find_body_that_evaluates(&self, function: FnId) -> Option<Parent> {
        let (hir, bound) = (self.hir, self.bound);
        let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
            return None;
        };
        if hir[function]
            .flags
            .intersects(hir::Flags::ASYNC | hir::Flags::GENERATOR)
        {
            return None;
        }
        match self.find_only_call(function, written) {
            Some(call) => self.find_body_around(call),
            None => self.find_body_that_passes(function, written),
        }
    }

    pub(super) fn find_body_around(&self, expression: ExprId) -> Option<Parent> {
        let (hir, bound) = (self.hir, self.bound);
        let mut expression = expression;
        let mut statement = loop {
            match bound.parent_of_expr(expression) {
                Parent::Expr(outer) if outer.is_some() => expression = outer,
                Parent::VarInit(declaration) => break bound.var_stmt[declaration.idx()],
                Parent::Stmt(statement) => break statement,
                Parent::FnBody(function) => return Some(Parent::FnBody(function)),
                _ => return None,
            }
        };
        let runs_once = matches!(
            hir[statement].kind,
            StmtKind::Expr(_) | StmtKind::Return(_) | StmtKind::Var(_) | StmtKind::If { .. }
        );
        if !runs_once {
            return None;
        }
        loop {
            statement = match bound.parent_of_stmt(statement) {
                around @ (Parent::File | Parent::FnBody(_)) => return Some(around),
                Parent::Stmt(outer)
                    if matches!(hir[outer].kind, StmtKind::Block(_) | StmtKind::If { .. }) =>
                {
                    outer
                }
                _ => return None,
            };
        }
    }

    fn find_body_that_passes(&self, function: FnId, written: ExprId) -> Option<Parent> {
        let (hir, bound) = (self.hir, self.bound);
        let argument = super::find_outermost_type_assertion(hir, bound, written);
        let Parent::Expr(call) = bound.parent_of_expr(argument) else {
            return None;
        };
        let ExprKind::Call(site) = hir[call.some()?].kind else {
            return None;
        };
        let arguments: SmallVec<[ExprId; 4]> = hir.ids(hir[site].args).collect();
        let is_spread = |it: &ExprId| matches!(hir[*it].kind, ExprKind::Spread(_));
        let mut place = arguments.iter().position(|&it| it == argument)?;
        if !matches!(hir[function].kind, FnKind::Expr | FnKind::Arrow)
            || bound.finds_itself(hir, function)
            || arguments.iter().any(is_spread)
        {
            return None;
        }
        let mut callee = hir.skip_type_assertions(hir[site].callee);
        if let Some((object, _)) = hir.member_key(callee) {
            callee = hir.skip_type_assertions(object);
            place = place.checked_sub(1)?;
        }
        let ExprKind::Fn(taker) = hir[callee].kind else {
            return None;
        };
        if self.find_only_call(taker, callee) != Some(call) {
            return None;
        }
        let parameter = self.find_plain_parameter(taker, place)?;
        if bound.is_visible_to_eval(parameter) {
            return None;
        }
        let mut entry = None;
        for name in (0..hir.exprs.len() as u32).map(ExprId) {
            if !bound.is_evaluated_ident(name)
                || bound.binding(name) != Binding::Symbol(parameter)
                || self.decisions.is_dead_expr(name)
            {
                continue;
            }
            let named = super::find_outermost_type_assertion(hir, bound, name);
            let Parent::Expr(user) = bound.parent_of_expr(named) else {
                return None;
            };
            let ExprKind::Call(site) = hir[user.some()?].kind else {
                return None;
            };
            let is_call = hir[site].callee == named && hir[site].chain == Chain::No;
            if !is_call || entry.replace(user).is_some() {
                return None;
            }
        }
        match self.find_body_around(entry?)? {
            Parent::FnBody(around) if around == taker => self.find_body_that_evaluates(taker),
            _ => None,
        }
    }

    fn is_filled_first(&self, enclosing: Option<FnId>, parts: &Parts) -> bool {
        let hir = self.hir;
        let statements: SmallVec<[StmtId; 8]> = match enclosing {
            None => hir.ids(hir.body).take(64).collect(),
            Some(function) => match hir[function].body {
                FnBody::Block(statements) => hir.ids(statements).take(64).collect(),
                FnBody::Expr(_) | FnBody::None => return false,
            },
        };
        let mut missing = [true, true];
        for statement in statements {
            match hir[statement].kind {
                StmtKind::Directive { .. } | StmtKind::Empty | StmtKind::Fn(_) => {}
                StmtKind::Var(declarations) => {
                    for declaration in declarations.iter() {
                        if hir[declaration].init.is_none() {
                            continue;
                        }
                        match self.read_variable(declaration) {
                            Some((symbol, _)) if symbol == parts.modules => missing[0] = false,
                            Some((symbol, _)) if symbol == parts.cache => missing[1] = false,
                            _ => return false,
                        }
                    }
                }
                _ => return false,
            }
            if missing == [false, false] {
                return true;
            }
        }
        false
    }

    fn read_body(&self, property: PropId, this: ThisOfBody) -> Option<(Atom, FnId)> {
        let hir = self.hir;
        let property = hir[property];
        let PropKey::Name(name) = property.key else {
            return None;
        };
        let is_plain = matches!(property.kind, PropKind::Init | PropKind::Method)
            && !hir::is_proto_setter(&property);
        let ExprKind::Fn(callback) = hir[hir.skip_type_assertions(property.value)].kind else {
            return None;
        };
        (is_plain && self.can_be_body(callback, InnerModuleKind::CommonJs, this))
            .then_some((name, callback))
    }

    pub(super) fn read_candidate(
        &self,
        callback: FnId,
        positions: [usize; 3],
    ) -> Option<Candidate> {
        let [module, exports, require] = positions;
        let count = self.hir[callback].params.len();
        let parameter = |index: usize| match index < count {
            true => self.find_plain_parameter(callback, index).map(Some),
            false => Some(None),
        };
        if count > 3 {
            return None;
        }
        let exports_variable = self.find_reassigned_parameter(callback, exports);
        let module_variable = self.find_reassigned_parameter(callback, module);
        Some(Candidate {
            module: InnerModule {
                callback,
                kind: InnerModuleKind::CommonJs,
                holder: SymbolId::NONE,
                statement: StmtId::NONE,
                caches_evaluation_error: false,
                module_parameter: match module_variable {
                    Some(_) => module_variable,
                    None => parameter(module)?,
                },
                exports_parameter: match exports_variable {
                    Some(_) => None,
                    None => parameter(exports)?,
                },
                require_parameter: parameter(require)?,
                reads_this: self.reads_this_of_call(callback),
                exports_variable,
                module_variable: None,
                id: None,
            },
            defined_at: 0,
            sites: Vec::new(),
            calls: Vec::new(),
            requests: Vec::new(),
            is_refused: false,
            exposes_module_object: module_variable.is_some(),
        })
    }

    fn read_bodies(
        &self,
        literal: ExprId,
        first: u32,
        this: ThisOfBody,
    ) -> Option<(Vec<Candidate>, FxHashMap<Vec<u8>, u32>)> {
        let ExprKind::Object(properties) = self.hir[literal].kind else {
            return None;
        };
        let properties: Span<PropId> = properties;
        let mut candidates = Vec::with_capacity(properties.len());
        let mut by_name = FxHashMap::default();
        for (property, index) in properties.iter().zip(first..) {
            let (name, callback) = self.read_body(property, this)?;
            let bytes = self.files.atoms.bytes(name).to_vec();
            let is_in_empty_cache = (self.every_object_has)(name);
            if is_in_empty_cache || by_name.insert(bytes, index).is_some() {
                return None;
            }
            candidates.push(self.read_candidate(callback, [0, 1, 2])?);
        }
        Some((candidates, by_name))
    }

    pub(super) fn list_positions_of(&self, candidates: &[Candidate]) -> Vec<(u32, u32)> {
        let (hir, bound) = (self.hir, self.bound);
        let position = |candidate: &Candidate| {
            let callback = candidate.module.callback;
            match bound.fns[callback.idx()].owner {
                FnOwner::Expr(written) => (hir[written].pos, hir[written].end),
                _ => (0, u32::MAX),
            }
        };
        let mut bodies: Vec<(u32, u32)> = candidates.iter().map(position).collect();
        bodies.sort_unstable();
        bodies
    }

    pub(super) fn find_bootstrap(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        for function in (0..hir.fns.len() as u32).map(FnId) {
            let Some(parts) = self.read_require_function(function) else {
                continue;
            };
            let enclosing = bound.fns[function.idx()].enclosing.some();
            let initializer = |symbol| match bound.binding_initializer(hir, symbol) {
                BindingInitializer::Expression(value) => Some(hir.skip_type_assertions(value)),
                _ => None,
            };
            let (Some(literal), Some(cache)) =
                (initializer(parts.modules), initializer(parts.cache))
            else {
                continue;
            };
            let is_own_scope = [parts.require, parts.modules, parts.cache]
                .iter()
                .all(|&it| {
                    bound.code_unit(bound.symbol_scope(it))
                        == enclosing.map_or(CodeUnit::File, CodeUnit::Function)
                });
            let is_empty_cache =
                matches!(hir[cache].kind, ExprKind::Object(properties) if properties.is_empty());
            if !is_own_scope
                || !is_empty_cache
                || !enclosing.is_none_or(|enclosing| self.is_evaluated_once_at_top(enclosing))
                || !self.is_filled_first(enclosing, &parts)
            {
                continue;
            }
            let first = self.candidates.len() as u32;
            let Some((candidates, by_name)) = self.read_bodies(literal, first, parts.this) else {
                continue;
            };
            let exposes_unknown_object = parts.module_object.is_none()
                && candidates
                    .iter()
                    .any(|candidate| candidate.exposes_module_object);
            if exposes_unknown_object {
                continue;
            }
            let bodies = self.list_positions_of(&candidates);
            self.candidates.extend(candidates);
            self.bootstrap = Some(Bootstrap {
                function,
                require: parts.require,
                modules: parts.modules,
                cache: parts.cache,
                literal,
                module_object: parts.module_object,
                call: ExprId::NONE,
                enclosing,
                first_candidate: first,
                candidates: by_name,
                names_of_bodies: Vec::new(),
                bodies,
                members: Vec::new(),
                member_mentions: Vec::new(),
            });
            return;
        }
    }

    fn find_candidate_named(&self, argument: ExprId) -> Option<usize> {
        let hir = self.hir;
        let FoldedValue::Constant(constant) = self
            .decisions
            .constant(hir, hir.skip_type_assertions(argument))
        else {
            return None;
        };
        let candidates = &self.bootstrap.as_ref()?.candidates;
        let found = match constant {
            Constant::String(name) => candidates.get(self.files.atoms.bytes(name)),
            Constant::Number(number)
                if number >= 0.0 && number < 4294967295.0 && number.fract() == 0.0 =>
            {
                candidates.get((number as u64).to_string().as_bytes())
            }
            _ => None,
        };
        found.map(|&index| index as usize)
    }

    fn find_required_candidate(&self, name: ExprId, body: usize) -> Option<(ExprId, usize)> {
        let (hir, bound) = (self.hir, self.bound);
        let callee = super::find_outermost_type_assertion(hir, bound, name);
        let Parent::Expr(call) = bound.parent_of_expr(callee) else {
            return None;
        };
        let ExprKind::Call(site) = hir[call.some()?].kind else {
            return None;
        };
        let site = hir[site];
        if site.callee != callee || site.chain != Chain::No || site.args.len() != 1 {
            return None;
        }
        let argument = hir.id_at(site.args, 0);
        let candidate = match self.bootstrap.as_ref()?.is_browserify() {
            true => self.find_candidate_of_body(argument, body)?,
            false => self.find_candidate_named(argument)?,
        };
        Some((call, candidate))
    }

    fn find_requested_candidate(&self, name: ExprId) -> Option<(ExprId, usize)> {
        let (hir, bound) = (self.hir, self.bound);
        let argument = super::find_outermost_type_assertion(hir, bound, name);
        let Parent::Expr(call) = bound.parent_of_expr(argument) else {
            return None;
        };
        let ExprKind::Call(site) = hir[call.some()?].kind else {
            return None;
        };
        let site = hir[site];
        if site.chain != Chain::No
            || site.args.len() != 2
            || hir.id_at::<ExprId>(site.args, 0) != argument
        {
            return None;
        }
        let (object, MemberKey::Name(method)) = hir.member_key(site.callee)? else {
            return None;
        };
        let is_bound = self.files.atoms.bytes(method) == b"bind"
            && self.keeps(BuiltinId::FunctionPrototypeBind)
            && self.names(object, self.symbol_of(name)?);
        if !is_bound {
            return None;
        }
        let candidate = self.find_candidate_named(hir.id_at(site.args, 1))?;
        let Parent::Expr(user) = bound.parent_of_expr(call) else {
            return None;
        };
        let ExprKind::Call(user) = hir[user.some()?].kind else {
            return None;
        };
        let user = hir[user];
        let (_, MemberKey::Name(method)) = hir.member_key(user.callee)? else {
            return None;
        };
        let is_handed_to_promise = user.args.len() == 1
            && hir.id_at::<ExprId>(user.args, 0) == call
            && self.files.atoms.bytes(method) == b"then";
        is_handed_to_promise.then_some((call, candidate))
    }

    fn read_member_mention(&self, name: ExprId) -> Option<MemberMention> {
        let (hir, bound) = (self.hir, self.bound);
        let object = super::find_outermost_type_assertion(hir, bound, name);
        let Parent::Expr(member) = bound.parent_of_expr(object) else {
            return None;
        };
        let (accessed, MemberKey::Name(key)) = hir.member_key(member.some()?)? else {
            return None;
        };
        if accessed != object {
            return None;
        }
        let mention = |use_of_member| Some(MemberMention { key, use_of_member });
        if bound.get_assignment_target(hir, member).is_some() {
            let Parent::Expr(user) = bound.parent_of_expr(member) else {
                return None;
            };
            let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[user.some()?].kind
            else {
                return None;
            };
            return (target == member)
                .then_some(())
                .and_then(|()| mention(self.classify_stored_member(value)?));
        }
        let outer = super::find_outermost_type_assertion(hir, bound, member);
        let Parent::Expr(user) = bound.parent_of_expr(outer) else {
            return mention(MemberUse::Read);
        };
        match user.some().map(|user| hir[user].kind) {
            Some(ExprKind::Call(call) | ExprKind::TaggedTemplate(call))
                if hir[call].callee == outer =>
            {
                mention(MemberUse::Called)
            }
            Some(ExprKind::Unary {
                op: UnOp::Delete, ..
            }) => None,
            _ => mention(MemberUse::Read),
        }
    }

    fn is_receiver_of_request(&self, name: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let object = super::find_outermost_type_assertion(hir, bound, name);
        let Parent::Expr(member) = bound.parent_of_expr(object) else {
            return false;
        };
        let Some(Parent::Expr(call)) = member.some().map(|member| bound.parent_of_expr(member))
        else {
            return false;
        };
        let Some(ExprKind::Call(site)) = call.some().map(|call| hir[call].kind) else {
            return false;
        };
        let site = hir[site];
        site.callee == member
            && site.args.len() == 2
            && matches!(hir.member_key(member), Some((accessed, _)) if accessed == object)
            && self
                .find_requested_candidate(hir.skip_type_assertions(hir.id_at(site.args, 0)))
                .is_some_and(|found| found.0 == call)
    }

    fn every_function_has(&self, name: Atom) -> bool {
        let bytes = self.files.atoms.bytes(name);
        let is_own = matches!(
            bytes,
            b"name" | b"length" | b"prototype" | b"arguments" | b"caller"
        );
        is_own
            || (self.every_object_has)(name)
            || table::find_name(bytes)
                .is_some_and(|name| table::own_member(BuiltinId::FunctionPrototype, name).is_some())
    }

    fn reads_only_stored_members(&self, mentions: &[MemberMention]) -> bool {
        mentions.iter().all(|mention| {
            let mut same = mentions.iter().filter(|it| it.key == mention.key);
            let is_stored = same.clone().any(|it| {
                matches!(
                    it.use_of_member,
                    MemberUse::Stored | MemberUse::StoredUnknown
                )
            });
            let is_safe = mention.use_of_member != MemberUse::StoredUnknown
                || !same.any(|it| it.use_of_member == MemberUse::Called);
            is_stored && is_safe && !self.every_function_has(mention.key)
        })
    }

    fn find_statement_of(&self, expression: ExprId) -> Option<StmtId> {
        let mut expression = expression;
        loop {
            match self.bound.parent_of_expr(expression) {
                Parent::Expr(outer) if outer.is_some() => {
                    let is_list = matches!(
                        self.hir[outer].kind,
                        ExprKind::Binary {
                            op: BinOp::Comma,
                            ..
                        }
                    );
                    if !is_list && self.hir.type_assertion_operand(outer) != Some(expression) {
                        return None;
                    }
                    expression = outer;
                }
                Parent::Stmt(statement) => return Some(statement),
                _ => return None,
            }
        }
    }

    fn is_evaluated_in_scope_of_bootstrap(&self, expression: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let Some(bootstrap) = &self.bootstrap else {
            return false;
        };
        let is_in_scope = |statement: StmtId| match bound.parent_of_stmt(statement) {
            Parent::File => bootstrap.enclosing.is_none(),
            Parent::FnBody(function) => bootstrap.enclosing == Some(function),
            _ => false,
        };
        let Some(statement) = self.find_statement_of(expression) else {
            return false;
        };
        if is_in_scope(statement) {
            return true;
        }
        let Parent::FnBody(function) = bound.parent_of_stmt(statement) else {
            return false;
        };
        let FnBody::Block(statements) = hir[function].body else {
            return false;
        };
        let mut statements = hir.ids(statements);
        let first: Option<StmtId> =
            statements.find(|&it: &StmtId| !matches!(hir[it].kind, StmtKind::Directive { .. }));
        let FnOwner::Expr(written) = bound.fns[function.idx()].owner else {
            return false;
        };
        let Parent::Expr(call) =
            bound.parent_of_expr(super::find_outermost_type_assertion(hir, bound, written))
        else {
            return false;
        };
        first == Some(statement)
            && call.is_some()
            && matches!(hir[call].kind, ExprKind::Call(call) if hir[call].chain == Chain::No)
            && bound.is_called_only_where_written(hir, function)
            && !hir[function]
                .flags
                .intersects(hir::Flags::ASYNC | hir::Flags::GENERATOR)
            && self.find_statement_of(call).is_some_and(is_in_scope)
    }

    fn find_earliest_time(&self, call: ExprId) -> u32 {
        let (hir, bound) = (self.hir, self.bound);
        let enclosing = self.bootstrap.as_ref().and_then(|it| it.enclosing);
        let functions = find_functions_around(hir, bound, call);
        let is_created_in_place = functions.is_some_and(|functions| {
            let mut functions = functions.iter();
            functions.all(|&it| Some(it) == enclosing || hir[it].kind != FnKind::Decl)
        });
        match is_created_in_place {
            true => hir[call].pos,
            false => 0,
        }
    }

    fn read_stored_member(&self, name: ExprId) -> Option<(Atom, Option<StoredMember>)> {
        let (hir, bound) = (self.hir, self.bound);
        let object = super::find_outermost_type_assertion(hir, bound, name);
        let Parent::Expr(member) = bound.parent_of_expr(object) else {
            return None;
        };
        let (_, MemberKey::Name(key)) = hir.member_key(member.some()?)? else {
            return None;
        };
        bound.get_assignment_target(hir, member)?;
        let stored = || {
            let Parent::Expr(user) = bound.parent_of_expr(member) else {
                return None;
            };
            let ExprKind::Assign { value, .. } = hir[user.some()?].kind else {
                return None;
            };
            let ExprKind::Fn(function) = hir[hir.skip_type_assertions(value)].kind else {
                return None;
            };
            self.is_evaluated_in_scope_of_bootstrap(user)
                .then_some(StoredMember {
                    function,
                    stored_at: hir[user].end,
                })
        };
        Some((key, stored()))
    }

    pub(super) fn names_of_require(&self) -> Box<[SymbolId]> {
        let Some(bootstrap) = &self.bootstrap else {
            return Box::default();
        };
        let bodies = self.candidates[bootstrap.first_candidate as usize..].iter();
        let parameters = bodies.filter_map(|candidate| candidate.module.require_parameter);
        let mut names: Vec<SymbolId> = parameters.chain([bootstrap.require]).collect();
        names.sort_unstable();
        names.into_boxed_slice()
    }

    pub(super) fn helpers_of_bootstrap(&self) -> Box<[(Atom, KnownFunction)]> {
        let Some(bootstrap) = &self.bootstrap else {
            return Box::default();
        };
        let calls = (self.candidates.iter())
            .flat_map(|candidate| candidate.calls.iter().chain(&candidate.requests));
        let calls = calls.filter(|&&call| !bootstrap.is_in_body(self.hir[call].pos));
        let first_call = calls.map(|&call| self.find_earliest_time(call)).min();
        let mut found: Vec<(Atom, KnownFunction)> = Vec::new();
        for (name, stored) in &bootstrap.members {
            let Some(stored) = stored else {
                continue;
            };
            let mut others = bootstrap.members.iter().filter(|it| it.0 == *name);
            if others.nth(1).is_some() || first_call.is_some_and(|call| call < stored.stored_at) {
                continue;
            }
            let Some(known) = self.helpers.function(self.file, stored.function) else {
                continue;
            };
            let mut references = known.references.iter();
            let is_own = references.all(|&reference| match reference {
                KnownReference::Holder { symbol } => symbol == bootstrap.require,
                _ => false,
            });
            if is_own && known.relies_on_facts {
                found.push((*name, known.clone()));
            }
        }
        let reads_own_names = found.iter().any(|(name, known)| {
            self.files.atoms.bytes(*name) == b"o" && known.shape.helper() == Helper::HasOwn
        });
        found.retain(|(_, known)| known.shape.helper() != Helper::Export || reads_own_names);
        found.into_boxed_slice()
    }

    fn classify_stored_member(&self, value: ExprId) -> Option<MemberUse> {
        let value = self.hir.skip_type_assertions(value);
        match self.hir[value].kind {
            ExprKind::Fn(function) => {
                let ignores_receiver =
                    self.hir[function].kind == FnKind::Arrow || !self.reads_own_this(function);
                ignores_receiver.then_some(MemberUse::Stored)
            }
            ExprKind::Object(_) | ExprKind::Array(_) => Some(MemberUse::Stored),
            ExprKind::Call(_) => Some(MemberUse::StoredUnknown),
            _ => matches!(
                self.decisions.constant(self.hir, value),
                FoldedValue::Constant(_)
            )
            .then_some(MemberUse::Stored),
        }
    }

    pub(super) fn is_in_require_function(&self, name: ExprId) -> bool {
        let Some(bootstrap) = &self.bootstrap else {
            return false;
        };
        let FnOwner::Stmt(declaration) = self.bound.fns[bootstrap.function.idx()].owner else {
            return false;
        };
        let declaration = self.hir[declaration];
        let position = self.hir[name].pos;
        declaration.start <= position && position < declaration.loc.end
    }

    pub(super) fn refuse_bootstrap(&mut self) {
        if let Some(bootstrap) = &self.bootstrap {
            let first = bootstrap.first_candidate as usize;
            for candidate in &mut self.candidates[first..] {
                candidate.is_refused = true;
            }
        }
    }

    pub(super) fn read_mention_of_require(&mut self, name: ExprId, end_of_head: u32, body: usize) {
        if let Some((call, candidate)) = self.find_required_candidate(name, body)
            && let Some(time) = self.find_site_time(call, end_of_head)
        {
            self.candidates[candidate].sites.push(time);
            self.candidates[candidate].calls.push(call);
        } else if let Some((call, candidate)) = self.find_requested_candidate(name)
            && let Some(time) = self.find_site_time(call, end_of_head)
        {
            self.candidates[candidate].sites.push(time);
            self.candidates[candidate].requests.push(call);
        } else if self.bootstrap.as_ref().is_some_and(|it| it.is_browserify()) {
            self.refuse_bootstrap();
        } else if let Some(mention) = self.read_member_mention(name)
            && !self.is_receiver_of_request(name)
        {
            let stored = self.read_stored_member(name);
            if let Some(bootstrap) = &mut self.bootstrap {
                bootstrap.member_mentions.push(mention);
                bootstrap.members.extend(stored);
            }
        } else if !self.is_in_require_function(name) && !self.is_receiver_of_request(name) {
            self.refuse_bootstrap();
        }
    }

    pub(super) fn refuse_bodies_naming_outer_scope(&mut self) {
        let (hir, bound) = (self.hir, self.bound);
        let Some(bootstrap) = &self.bootstrap else {
            return;
        };
        let Some(enclosing) = bootstrap.enclosing else {
            return;
        };
        let mut scopes_around = SmallVec::<[CodeUnit; 4]>::new();
        let mut next = Some(enclosing);
        while let Some(function) = next {
            scopes_around.push(CodeUnit::Function(function));
            next = bound.fns[function.idx()].enclosing.some();
        }
        let names_scope_around = (0..hir.exprs.len() as u32).map(ExprId).any(|name| {
            if !matches!(hir[name].kind, ExprKind::Ident(_))
                || !bound.is_evaluated_ident(name)
                || !bootstrap.is_in_body(hir[name].pos)
                || matches!(self.decisions.decision(name), Decision::Constant(_))
            {
                return false;
            }
            match bound.binding(name) {
                Binding::Symbol(symbol) => {
                    scopes_around.contains(&bound.code_unit(bound.symbol_scope(symbol)))
                }
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => false,
            }
        });
        if names_scope_around {
            self.refuse_bootstrap();
        }
    }

    pub(super) fn settle_bootstrap(&mut self) {
        let Some(bootstrap) = &self.bootstrap else {
            return;
        };
        if !self.reads_only_stored_members(&bootstrap.member_mentions) {
            self.refuse_bootstrap();
        }
        let Some(bootstrap) = &self.bootstrap else {
            return;
        };
        let first = bootstrap.first_candidate as usize;
        if self.candidates[first..]
            .iter()
            .any(|candidate| candidate.is_refused)
        {
            self.refuse_bootstrap();
            self.bootstrap = None;
        }
    }
}
