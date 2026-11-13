use super::bootstrap::Bootstrap;
use super::{Candidate, Finder, InnerModuleKind, SiteTime, ThisOfBody};
use crate::builtins::runtime_uses::reaches_unknown_module_loader;
use crate::builtins::{BuiltinId, Platforms, table};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, CodeUnit, CommonJsVariable, Decl, Parent, SymbolId};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    self, BinOp, Chain, ExprId, ExprKind, FnBody, FnId, FnKind, IdList, MemberKey, NodeData,
    PatKind, PropId, PropKey, PropKind, StmtId, StmtKind, UnOp,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::util::FxHashMap;
use smallvec::SmallVec;

struct Loader {
    load: SymbolId,
    modules: SymbolId,
    cache: SymbolId,
    id: SymbolId,
}

type NamesOfBody = FxHashMap<Vec<u8>, u32>;

impl Finder<'_, '_> {
    pub(super) fn find_mentions_of_require(&self, platform: Platforms) -> Option<Vec<ExprId>> {
        let (hir, bound) = (self.hir, self.bound);
        let own_values =
            [BuiltinId::ModuleRequire, BuiltinId::ModuleObject].map(table::canonical_id);
        let mentioned = self.builtins.mentioned().iter().copied();
        let others: Vec<BuiltinId> = mentioned
            .filter(|&id| !own_values.contains(&table::canonical_id(id)))
            .collect();
        if reaches_unknown_module_loader(&others, &others, &others, platform) {
            return None;
        }
        let sites = self.files.analysis(self.file).import_sites.iter();
        let calls = sites.map(|site| match site.kind {
            ImportSiteKind::Require(call) => Some(call),
            _ => None,
        });
        let mut mentions: Vec<ExprId> = calls.collect::<Option<_>>()?;
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            if !matches!(hir[expression].kind, ExprKind::Ident(_))
                || !bound.is_evaluated_ident(expression)
                || self.decisions.is_dead_expr(expression)
            {
                continue;
            }
            if bound
                .dynamic_lookup_scope(NodeData::Expr(expression))
                .is_some()
            {
                return None;
            }
            match bound.binding(expression) {
                Binding::CommonJs(CommonJsVariable::Require) => mentions.push(expression),
                Binding::CommonJs(CommonJsVariable::Module)
                    if !self.is_exports_of(expression)
                        && !self.is_operand_of_typeof(expression) =>
                {
                    return None;
                }
                Binding::Arguments(CodeUnit::File) => return None,
                _ => {}
            }
        }
        Some(mentions)
    }

    fn is_operand_of_typeof(&self, expression: ExprId) -> bool {
        let Parent::Expr(parent) = self.bound.parent_of_expr(expression) else {
            return false;
        };
        matches!(
            self.hir[parent].kind,
            ExprKind::Unary {
                op: UnOp::Typeof,
                ..
            }
        )
    }

    fn statements_of(&self, function: FnId) -> SmallVec<[StmtId; 4]> {
        match self.hir[function].body {
            FnBody::Block(statements) => self.hir.ids(statements).collect(),
            FnBody::Expr(_) | FnBody::None => SmallVec::new(),
        }
    }

    fn is_plain_function(&self, function: FnId) -> bool {
        let record = self.hir[function];
        !record
            .flags
            .intersects(hir::Flags::ASYNC | hir::Flags::GENERATOR)
            && record.this_param.is_none()
    }

    fn statements_in(&self, statement: StmtId) -> SmallVec<[StmtId; 4]> {
        match self.hir[statement].kind {
            StmtKind::Block(statements) => self.hir.ids(statements).collect(),
            _ => SmallVec::from_slice(&[statement]),
        }
    }

    fn is_number(&self, expression: ExprId, expected: f64) -> bool {
        matches!(
            self.decisions.constant(self.hir, expression),
            FoldedValue::Constant(Constant::Number(number)) if number == expected
        )
    }

    fn read_index(&self, expression: ExprId) -> Option<(ExprId, ExprId)> {
        match self.hir[expression.some()?].kind {
            ExprKind::Index {
                obj,
                index,
                chain: Chain::No,
            } => Some((obj, index)),
            _ => None,
        }
    }

    fn is_element(&self, expression: ExprId, object: SymbolId, key: SymbolId) -> bool {
        let read = self.read_index(expression);
        read.is_some_and(|(read, index)| self.names(read, object) && self.names(index, key))
    }

    fn is_part_of_element(
        &self,
        expression: ExprId,
        object: SymbolId,
        key: SymbolId,
        position: f64,
    ) -> bool {
        let read = self.read_index(expression);
        read.is_some_and(|(element, index)| {
            self.is_element(element, object, key) && self.is_number(index, position)
        })
    }

    fn read_not(&self, test: ExprId) -> Option<ExprId> {
        match self.hir[test].kind {
            ExprKind::Unary {
                op: UnOp::Not,
                operand,
            } => Some(operand),
            _ => None,
        }
    }

    fn read_call(&self, expression: ExprId) -> Option<(ExprId, SmallVec<[ExprId; 8]>)> {
        let ExprKind::Call(call) = self.hir[expression.some()?].kind else {
            return None;
        };
        let call = self.hir[call];
        let arguments: SmallVec<[ExprId; 8]> = self.hir.ids(call.args).collect();
        (call.chain == Chain::No).then_some((call.callee, arguments))
    }

    fn function_of(&self, expression: ExprId) -> Option<FnId> {
        match self.hir[self.hir.skip_type_assertions(expression)].kind {
            ExprKind::Fn(function) => Some(function),
            _ => None,
        }
    }

    fn is_look_at_require(&self, value: ExprId) -> bool {
        let ExprKind::Binary {
            op: BinOp::And,
            left,
            right,
        } = self.hir[value].kind
        else {
            return false;
        };
        let ExprKind::Binary {
            op: BinOp::EqEq | BinOp::EqEqEq,
            left: one,
            right: other,
        } = self.hir[left].kind
        else {
            return false;
        };
        let looks_at_name = |side: ExprId| match self.hir[side].kind {
            ExprKind::Unary {
                op: UnOp::Typeof,
                operand,
            } => self.is_same_name(operand, right),
            _ => false,
        };
        let is_text = |side: ExprId| matches!(self.hir[side].kind, ExprKind::String(_));
        (looks_at_name(one) && is_text(other)) || (looks_at_name(other) && is_text(one))
    }

    fn is_same_name(&self, looked_at: ExprId, read: ExprId) -> bool {
        let (ExprKind::Ident(name), ExprKind::Ident(read_name)) =
            (self.hir[looked_at].kind, self.hir[read].kind)
        else {
            return false;
        };
        let binding = self.bound.binding(read);
        let never_throws = match binding {
            Binding::Symbol(symbol) => self.has_no_dead_zone(symbol),
            Binding::CommonJs(_) | Binding::Arguments(_) | Binding::Free => true,
        };
        name == read_name && self.bound.binding(looked_at) == binding && never_throws
    }

    fn requires_by_names_of_body(&self, function: FnId, loader: &Loader) -> bool {
        let hir = self.hir;
        let Some(name) = self.find_plain_parameter(function, 0) else {
            return false;
        };
        if hir[function].params.len() != 1 || !self.is_plain_function(function) {
            return false;
        }
        let is_found = |expression: ExprId| {
            let read = self.read_index(expression);
            read.is_some_and(|(names, index)| {
                self.names(index, name)
                    && self.is_part_of_element(names, loader.modules, loader.id, 1.0)
            })
        };
        let (answer, variable) = match hir[function].body {
            FnBody::Expr(answer) => (answer, None),
            FnBody::None => return false,
            FnBody::Block(_) => match self.statements_of(function)[..] {
                [answer] => (self.read_returned(answer), None),
                [declaration, answer] => match self.read_only_declaration(declaration) {
                    Some((symbol, value)) if is_found(value) => {
                        (self.read_returned(answer), Some(symbol))
                    }
                    _ => return false,
                },
                _ => return false,
            },
        };
        let Some((callee, arguments)) = self.read_call(answer) else {
            return false;
        };
        let &[asked] = &arguments[..] else {
            return false;
        };
        let names_found = |expression: ExprId| match variable {
            Some(variable) => self.names(expression, variable),
            None => is_found(expression),
        };
        let asks_for_found = match hir[asked].kind {
            ExprKind::Binary {
                op: BinOp::Or,
                left,
                right,
            } => names_found(left) && self.names(right, name),
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                variable.is_some()
                    && names_found(test)
                    && names_found(branches.yes)
                    && self.names(branches.no, name)
            }
            _ => false,
        };
        self.names(callee, loader.load) && asks_for_found
    }

    fn read_returned(&self, statement: StmtId) -> ExprId {
        match self.hir[statement].kind {
            StmtKind::Return(value) => value,
            _ => ExprId::NONE,
        }
    }

    fn is_evaluation_of_body(&self, call: ExprId, module: SymbolId, loader: &Loader) -> bool {
        let Some((callee, arguments)) = self.read_call(call) else {
            return false;
        };
        let Some((body, MemberKey::Name(name))) = self.hir.member_key(callee) else {
            return false;
        };
        let Some((&[this, require, given, exports], others)) = arguments.split_first_chunk::<4>()
        else {
            return false;
        };
        let requires = self.function_of(require);
        self.files.atoms.bytes(name) == b"call"
            && self.is_part_of_element(body, loader.modules, loader.id, 0.0)
            && self.is_exports_of_symbol(this, module)
            && requires.is_some_and(|requires| self.requires_by_names_of_body(requires, loader))
            && self.names(given, module)
            && self.is_exports_of_symbol(exports, module)
            && others.iter().all(|&other| self.symbol_of(other).is_some())
    }

    fn loads_each_body_once(&self, function: FnId, loader: &Loader) -> bool {
        let hir = self.hir;
        let &[look, answer] = &self.statements_of(function)[..] else {
            return false;
        };
        let StmtKind::If { test, yes, no } = hir[look].kind else {
            return false;
        };
        let is_absent = |test: ExprId, object: SymbolId| {
            let element = self.read_not(test);
            element.is_some_and(|element| self.is_element(element, object, loader.id))
        };
        let exports = match hir.member_key(self.read_returned(answer)) {
            Some((cached, MemberKey::Name(known::exports))) => cached,
            _ => return false,
        };
        let &[refusal, declaration, evaluation] = &self.statements_in(yes)[..] else {
            return false;
        };
        let StmtKind::If {
            test: is_unknown,
            no: otherwise,
            ..
        } = hir[refusal].kind
        else {
            return false;
        };
        let Some((module, stored)) = self.read_only_declaration(declaration) else {
            return false;
        };
        let ExprKind::Assign {
            op: None,
            target,
            value,
        } = hir[stored].kind
        else {
            return false;
        };
        let StmtKind::Expr(evaluation) = hir[evaluation].kind else {
            return false;
        };
        no.is_none()
            && otherwise.is_none()
            && is_absent(test, loader.cache)
            && is_absent(is_unknown, loader.modules)
            && self.is_element(target, loader.cache, loader.id)
            && self.is_new_module_object(value)
            && self.is_evaluation_of_body(evaluation, module, loader)
            && self.is_element(exports, loader.cache, loader.id)
    }

    fn loads_every_entry(&self, statement: StmtId, entries: SymbolId, load: SymbolId) -> bool {
        let hir = self.hir;
        let StmtKind::For {
            init,
            test,
            update,
            body,
        } = hir[statement].kind
        else {
            return false;
        };
        let (Some(init), Some(test), Some(update)) = (init.some(), test.some(), update.some())
        else {
            return false;
        };
        let StmtKind::Var(declarations) = hir[init].kind else {
            return false;
        };
        let mut counter = None;
        for declaration in declarations.iter() {
            match self.read_variable(declaration) {
                Some((symbol, value)) if counter.is_none() && self.is_number(value, 0.0) => {
                    counter = Some(symbol);
                }
                Some((_, value)) if self.is_look_at_require(value) => {}
                _ => return false,
            }
        }
        let Some(counter) = counter else {
            return false;
        };
        let is_below_length = match hir[test].kind {
            ExprKind::Binary {
                op: BinOp::Lt,
                left,
                right,
            } => {
                self.names(left, counter)
                    && matches!(
                        hir.member_key(right),
                        Some((list, MemberKey::Name(known::length))) if self.names(list, entries)
                    )
            }
            _ => false,
        };
        let counts = matches!(
            hir[update].kind,
            ExprKind::Unary { op: UnOp::PostInc | UnOp::PreInc, operand } if self.names(operand, counter)
        );
        let &[only] = &self.statements_in(body)[..] else {
            return false;
        };
        let StmtKind::Expr(call) = hir[only].kind else {
            return false;
        };
        let Some((callee, arguments)) = self.read_call(call) else {
            return false;
        };
        is_below_length
            && counts
            && self.names(callee, load)
            && matches!(arguments[..], [entry] if self.is_element(entry, entries, counter))
    }

    fn find_start_function(&self, callee: ExprId) -> Option<FnId> {
        if let Some(function) = self.function_of(callee) {
            return Some(function);
        }
        let (maker, arguments) = self.read_call(self.hir.skip_type_assertions(callee))?;
        let maker = self.function_of(maker)?;
        let statements = self.statements_of(maker);
        let &[declaration, answer] = &statements[..] else {
            return None;
        };
        let StmtKind::Fn(start) = self.hir[declaration].kind else {
            return None;
        };
        let symbol = self.bound.declared_symbol(Decl::Fn(start)).some()?;
        (arguments.is_empty()
            && self.is_plain_function(maker)
            && self.hir[maker].params.len() == 0
            && self.bound.is_stable_binding(symbol)
            && self.names(self.read_returned(answer).some()?, symbol))
        .then_some(start)
    }

    fn is_start_function(&self, start: FnId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        if hir[start].params.len() != 3 || !self.is_plain_function(start) {
            return false;
        }
        let parameter = |index: usize| self.find_plain_parameter(start, index);
        let (Some(modules), Some(cache), Some(entries)) =
            (parameter(0), parameter(1), parameter(2))
        else {
            return false;
        };
        let statements = self.statements_of(start);
        let &[declaration, ref others @ .., turns, answer] = &statements[..] else {
            return false;
        };
        let StmtKind::Fn(function) = hir[declaration].kind else {
            return false;
        };
        let Some(load) = bound.declared_symbol(Decl::Fn(function)).some() else {
            return false;
        };
        let Some(id) = self.find_plain_parameter(function, 0) else {
            return false;
        };
        let loader = Loader {
            load,
            modules,
            cache,
            id,
        };
        let looks_at_require = |&statement: &StmtId| {
            let declared = self.read_only_declaration(statement);
            declared.is_some_and(|(_, value)| self.is_look_at_require(value))
        };
        let is_stable = [load, modules, cache, entries]
            .iter()
            .all(|&symbol| bound.is_stable_binding(symbol));
        let takes_plain_parameters = hir[function].params.iter().all(|it| {
            hir[it].default.is_none() && matches!(hir[hir[it].pat].kind, PatKind::Ident(_))
        });
        is_stable
            && takes_plain_parameters
            && hir[function].kind == FnKind::Decl
            && self.is_plain_function(function)
            && others.iter().all(looks_at_require)
            && self.loads_every_entry(turns, entries, load)
            && self
                .read_returned(answer)
                .some()
                .is_some_and(|it| self.names(it, load))
            && self.loads_each_body_once(function, &loader)
    }

    fn read_id(&self, value: ExprId) -> Option<Vec<u8>> {
        match self
            .decisions
            .constant(self.hir, self.hir.skip_type_assertions(value))
        {
            FoldedValue::Constant(Constant::String(name)) => {
                let bytes = self.files.atoms.bytes(name);
                (!bytes.is_empty()).then(|| bytes.to_vec())
            }
            FoldedValue::Constant(Constant::Number(number))
                if number >= 1.0 && number < 4294967295.0 && number.fract() == 0.0 =>
            {
                Some((number as u64).to_string().into_bytes())
            }
            _ => None,
        }
    }

    fn read_named_value(&self, property: PropId) -> Option<(Atom, ExprId)> {
        let property = self.hir[property];
        match property.key {
            PropKey::Name(name)
                if property.kind == PropKind::Init && !hir::is_proto_setter(&property) =>
            {
                Some((name, property.value))
            }
            _ => None,
        }
    }

    fn elements_of(&self, list: ExprId) -> Option<SmallVec<[ExprId; 2]>> {
        let elements: IdList<ExprId> = match self.hir[self.hir.skip_type_assertions(list)].kind {
            ExprKind::Array(elements) => elements,
            _ => return None,
        };
        Some(self.hir.ids(elements).collect())
    }

    fn read_bodies_and_names(
        &self,
        literal: ExprId,
        first: u32,
    ) -> Option<(Vec<Candidate>, FxHashMap<Vec<u8>, u32>, Vec<NamesOfBody>)> {
        let ExprKind::Object(properties) = self.hir[literal].kind else {
            return None;
        };
        let mut candidates = Vec::with_capacity(properties.len());
        let mut by_id = FxHashMap::default();
        let mut names_with_ids = Vec::with_capacity(properties.len());
        for (property, index) in properties.iter().zip(first..) {
            let (id, value) = self.read_named_value(property)?;
            let &[body, names] = &self.elements_of(value)?[..] else {
                return None;
            };
            let callback = self.function_of(body)?;
            let ExprKind::Object(names) = self.hir[self.hir.skip_type_assertions(names)].kind
            else {
                return None;
            };
            let is_in_empty_cache = (self.every_object_has)(id);
            let bytes = self.files.atoms.bytes(id).to_vec();
            if is_in_empty_cache
                || !self.can_be_body(callback, InnerModuleKind::CommonJs, ThisOfBody::Unknown)
                || by_id.insert(bytes, index).is_some()
            {
                return None;
            }
            let candidate = self.read_candidate(callback, [1, 2, 0])?;
            if candidate.exposes_module_object {
                return None;
            }
            candidates.push(candidate);
            let mut ids: FxHashMap<Vec<u8>, Option<Vec<u8>>> = FxHashMap::default();
            for property in names.iter() {
                let (name, value) = self.read_named_value(property)?;
                let name = self.files.atoms.bytes(name).to_vec();
                if ids.insert(name, self.read_id(value)).is_some() {
                    return None;
                }
            }
            names_with_ids.push(ids);
        }
        let names_of_bodies = names_with_ids
            .into_iter()
            .map(|ids| {
                let found = |id: Option<Vec<u8>>| by_id.get(&id?).copied();
                ids.into_iter()
                    .filter_map(|(name, id)| Some((name, found(id)?)))
                    .collect()
            })
            .collect();
        Some((candidates, by_id, names_of_bodies))
    }

    fn find_request_of_entry(&self, call: ExprId, entry: ExprId) -> Option<(ExprId, Option<FnId>)> {
        let (hir, bound) = (self.hir, self.bound);
        let request = match bound.parent_of_expr(call) {
            Parent::Stmt(statement) if matches!(hir[statement].kind, StmtKind::Expr(_)) => call,
            Parent::Expr(user) => {
                let (callee, arguments) = self.read_call(user)?;
                let &[id] = &arguments[..] else {
                    return None;
                };
                let is_request = callee == call && self.read_id(id)? == self.read_id(entry)?;
                is_request.then_some(user)?
            }
            _ => return None,
        };
        if self.decisions.is_dead_expr(request) {
            return None;
        }
        match self.find_body_around(request)? {
            Parent::File => Some((request, None)),
            Parent::FnBody(around) if self.is_evaluated_once_at_top(around) => {
                Some((request, Some(around)))
            }
            _ => None,
        }
    }

    pub(super) fn find_bundle(&mut self) {
        let hir = self.hir;
        for call in (0..hir.exprs.len() as u32).map(ExprId) {
            let has_three_arguments =
                matches!(hir[call].kind, ExprKind::Call(site) if hir[site].args.len() == 3);
            if !has_three_arguments {
                continue;
            }
            let Some((callee, arguments)) = self.read_call(call) else {
                continue;
            };
            let &[literal, cache, entries] = &arguments[..] else {
                continue;
            };
            let is_empty_cache =
                matches!(hir[cache].kind, ExprKind::Object(properties) if properties.is_empty());
            if !is_empty_cache {
                continue;
            }
            let Some(start) = self.find_start_function(callee) else {
                continue;
            };
            let Some(&[entry]) = self.elements_of(entries).as_deref() else {
                continue;
            };
            if !self.is_start_function(start) {
                continue;
            }
            let Some((request, enclosing)) = self.find_request_of_entry(call, entry) else {
                continue;
            };
            let first = self.candidates.len() as u32;
            let Some((mut candidates, by_id, names_of_bodies)) =
                self.read_bodies_and_names(literal, first)
            else {
                continue;
            };
            let Some(entry) = self.read_id(entry).and_then(|id| by_id.get(&id).copied()) else {
                continue;
            };
            let entry = &mut candidates[(entry - first) as usize];
            entry.sites.push(SiteTime::At(hir[request].pos));
            entry.calls.push(request);
            let bodies = match enclosing {
                Some(_) => self.list_positions_of(&candidates),
                None => Vec::new(),
            };
            self.candidates.extend(candidates);
            self.bootstrap = Some(Bootstrap {
                function: start,
                require: SymbolId::NONE,
                modules: SymbolId::NONE,
                cache: SymbolId::NONE,
                literal,
                module_object: None,
                call: request,
                enclosing,
                first_candidate: first,
                candidates: by_id,
                names_of_bodies,
                bodies,
                members: Vec::new(),
                member_mentions: Vec::new(),
            });
            return;
        }
    }

    pub(super) fn find_candidate_of_body(&self, argument: ExprId, body: usize) -> Option<usize> {
        let bundle = self.bootstrap.as_ref()?;
        let names = bundle
            .names_of_bodies
            .get(body.checked_sub(bundle.first_candidate as usize)?)?;
        let argument = self.hir.skip_type_assertions(argument);
        let FoldedValue::Constant(Constant::String(name)) =
            self.decisions.constant(self.hir, argument)
        else {
            return None;
        };
        let found = names.get(self.files.atoms.bytes(name))?;
        Some(*found as usize)
    }
}
