use std::rc::Rc;

use bun_core::strings::contains;
use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{Binding, BindingKind, Bound, CodeUnit, Decl, FunctionFlags, SymbolId};
use bun_sema::hir::{
    BinOp, Call, CallId, Chain, ExprId, ExprKind, File, Flags, FnBody, FnId, IdList, PatId,
    PatKind, PropKey, PropKind, StmtId, StmtKind, UnOp, VarKind,
};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

use super::values::{EnvironmentId, Global, Object, ObjectId, Value};
use super::{end_of_body, start_of_code, strings};
use crate::builtins::id::BuiltinId;
use crate::builtins::table;

const MAX_STEPS: u32 = 1 << 20;
const MAX_STEPS_OF_STATEMENT: u32 = 1 << 12;
const MAX_DEPTH: u32 = 128;

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
enum Owner {
    File,
    Function(FnId),
    FieldValue,
}

#[derive(Clone)]
enum Flow {
    Next,
    Break,
    Continue,
    Return(Value),
}

#[derive(Default)]
struct Evals {
    calls: FxHashSet<CallId>,
    positions: Vec<u32>,
}

impl Evals {
    fn may_store(&self, hir: &File<'_>, atoms: &Interner<'_>, name: Atom) -> bool {
        let name = atoms.bytes(name);
        self.calls.iter().any(|&call| {
            let first = hir.ids(hir.written_args(call)).next();
            let first = first.map(|it| hir[hir.skip_type_assertions(it)].kind);
            let Some(ExprKind::String(text)) = first else {
                return true;
            };
            let text = atoms.bytes(text);
            contains(text, name) || contains(text, b"eval") || contains(text, b"\\")
        })
    }
}

struct SettledFunction {
    function: FnId,
    evals: Evals,
    called: FxHashSet<FnId>,
    named: FxHashSet<Atom>,
}

struct Activation {
    function: FnId,
    environment: EnvironmentId,
    variables: FxHashMap<SymbolId, Value>,
}

struct Identifiers {
    identifiers: Vec<(u32, ExprId, Owner)>,
    names: Vec<(u32, PatId)>,
    jumps: Vec<(u32, StmtId, Owner)>,
    captured: FxHashSet<SymbolId>,
    stored_elsewhere: FxHashSet<SymbolId>,
    callbacks: Vec<(u32, FnId, FnId)>,
    decorated_classes: FxHashMap<u32, u32>,
}

struct Settler<'a, 's> {
    hir: &'a File<'s>,
    bound: &'a Bound<'s>,
    atoms: &'a Interner<'s>,
    identifiers: &'a Identifiers,
    function: FnId,
    evals: &'a Evals,
    activations: Vec<Activation>,
    objects: Vec<Object>,
    found: Vec<(CallId, Rc<[u8]>)>,
    called: FxHashSet<FnId>,
    named: FxHashSet<Atom>,
    environments: usize,
    has_lost_callback: bool,
    steps: u32,
    depth: u32,
    loops: u32,
}

fn range_of<T: Copy>(sorted: &[(u32, T, Owner)], start: u32, end: u32) -> &[(u32, T, Owner)] {
    let first = sorted.partition_point(|it| it.0 < start);
    let count = sorted[first..].partition_point(|it| it.0 < end);
    &sorted[first..first + count]
}

fn collect_identifiers(hir: &File<'_>, bound: &Bound<'_>, atoms: &Interner<'_>) -> Identifiers {
    let functions = (0..hir.fns.len() as u32).map(FnId);
    let functions = functions.filter_map(|it| {
        let end = end_of_body(hir, it)?;
        Some((start_of_code(hir, it), end, Owner::Function(it)))
    });
    let values = hir.members.iter().filter(|it| it.init.is_some());
    let values = values.map(|it| (hir[it.init].pos, hir[it.init].end, Owner::FieldValue));
    let mut ranges: Vec<(u32, u32, Owner)> = functions.chain(values).collect();
    ranges.sort_by_key(|it| (it.0, std::cmp::Reverse(it.1)));
    let assign_owners = |sorted: &mut dyn Iterator<Item = (u32, &mut Owner)>| {
        let mut next = 0;
        let mut open: Vec<(u32, Owner)> = Vec::new();
        for (pos, owner) in sorted {
            while next < ranges.len() && ranges[next].0 <= pos {
                open.retain(|it| it.0 > ranges[next].0);
                open.push((ranges[next].1, ranges[next].2));
                next += 1;
            }
            open.retain(|it| it.0 > pos);
            *owner = open.last().map_or(Owner::File, |it| it.1);
        }
    };
    let expressions = (0..hir.exprs.len() as u32).map(ExprId);
    let identifiers = expressions.filter(|&it| matches!(hir[it].kind, ExprKind::Ident(_)));
    let mut identifiers: Vec<(u32, ExprId, Owner)> = identifiers
        .map(|it| (hir[it].pos, it, Owner::File))
        .collect();
    identifiers.sort_by_key(|it| (it.0, it.1));
    assign_owners(&mut identifiers.iter_mut().map(|it| (it.0, &mut it.2)));
    let patterns = (0..hir.pats.len() as u32).map(PatId);
    let names = patterns.filter(|&it| matches!(hir[it].kind, PatKind::Ident(_)));
    let mut names: Vec<(u32, PatId)> = names.map(|it| (hir[it].pos, it)).collect();
    names.sort_unstable();
    let statements = (0..hir.stmts.len() as u32).map(StmtId);
    let jumps = statements.filter(|&it| {
        matches!(
            hir[it].kind,
            StmtKind::Break(_) | StmtKind::Continue(_) | StmtKind::Return(_)
        )
    });
    let mut jumps: Vec<(u32, StmtId, Owner)> =
        jumps.map(|it| (hir[it].loc.pos, it, Owner::File)).collect();
    jumps.sort_by_key(|it| (it.0, it.1));
    assign_owners(&mut jumps.iter_mut().map(|it| (it.0, &mut it.2)));
    let possible_callbacks = find_callbacks(hir, bound, atoms);
    let mut callbacks: FxHashSet<(u32, FnId, FnId)> = FxHashSet::default();
    let mut captured = FxHashSet::default();
    let mut stored_elsewhere = FxHashSet::default();
    for &(_, identifier, owner) in &identifiers {
        let Binding::Symbol(symbol) = bound.binding(identifier) else {
            continue;
        };
        let CodeUnit::Function(declaring) = bound.code_unit(bound.symbol_scope(symbol)) else {
            continue;
        };
        if owner == Owner::Function(declaring) {
            continue;
        }
        if bound.is_store_target(identifier) {
            stored_elsewhere.insert(symbol);
        }
        let Owner::Function(mut inner) = owner else {
            captured.insert(symbol);
            continue;
        };
        let mut chain: SmallVec<[FnId; 4]> = SmallVec::new();
        while inner != declaring && inner.is_some() && possible_callbacks.contains(&inner) {
            chain.push(inner);
            inner = bound.fns[inner.idx()].enclosing;
        }
        match inner == declaring {
            true => callbacks.extend(chain.iter().map(|&it| (hir[it].start, it, declaring))),
            false => {
                captured.insert(symbol);
            }
        }
    }
    let mut callbacks: Vec<(u32, FnId, FnId)> = callbacks.into_iter().collect();
    callbacks.sort_unstable();
    let classes = hir.exprs.iter().filter_map(|it| match it.kind {
        ExprKind::Class(class) if hir[class].start < it.pos => Some((it.pos, hir[class].start)),
        _ => None,
    });
    let decorated_classes = classes.collect();
    Identifiers {
        identifiers,
        names,
        jumps,
        captured,
        stored_elsewhere,
        callbacks,
        decorated_classes,
    }
}

fn find_callbacks(hir: &File<'_>, bound: &Bound<'_>, atoms: &Interner<'_>) -> FxHashSet<FnId> {
    let mut callbacks = FxHashSet::default();
    for expression in hir.exprs.iter() {
        let ExprKind::Call(call) = expression.kind else {
            continue;
        };
        let callee = hir.skip_type_assertions(hir[call].callee);
        let ExprKind::Dot { name, .. } = hir[callee].kind else {
            continue;
        };
        let is_method = matches!(atoms.bytes(name), b"forEach" | b"map");
        for argument in hir.ids(hir[call].args).filter(|_| is_method) {
            if let ExprKind::Fn(function) = hir[hir.skip_type_assertions(argument)].kind
                && !bound.finds_itself(hir, function)
            {
                callbacks.insert(function);
            }
        }
    }
    callbacks
}

pub(crate) fn find_settled_evals<'s>(
    hir: &File<'s>,
    bound: &Bound<'s>,
    atoms: &Interner<'s>,
) -> Vec<CallId> {
    if !hir.with_bodies.is_empty() {
        return Vec::new();
    }
    let identifiers = collect_identifiers(hir, bound, atoms);
    let mut by_function: FxHashMap<Owner, Evals> = FxHashMap::default();
    for &(expression, eval_scope) in bound.runtime.eval_scopes() {
        let ExprKind::Call(call) = hir[expression].kind else {
            return Vec::new();
        };
        let owner = match bound.code_unit(eval_scope.scope) {
            CodeUnit::File => Owner::File,
            CodeUnit::Function(function) => Owner::Function(function),
            CodeUnit::FieldInitializer(_) => Owner::FieldValue,
        };
        let evals = by_function.entry(owner).or_default();
        evals.calls.insert(call);
        evals.positions.push(hir[hir[call].callee].pos);
    }
    let mut steps = MAX_STEPS;
    let mut settled: Vec<SettledFunction> = Vec::new();
    let mut unsettled: Vec<(Owner, Evals)> = Vec::new();
    let mut by_function: Vec<(Owner, Evals)> = by_function.into_iter().collect();
    by_function.sort_by_key(|it| it.1.positions.iter().copied().min());
    for (owner, mut evals) in by_function {
        evals.positions.sort_unstable();
        let Owner::Function(function) = owner else {
            unsettled.push((owner, evals));
            continue;
        };
        let mut settler = Settler {
            hir,
            bound,
            atoms,
            identifiers: &identifiers,
            function,
            evals: &evals,
            activations: Vec::new(),
            objects: Vec::new(),
            found: Vec::new(),
            called: FxHashSet::default(),
            named: FxHashSet::default(),
            environments: 0,
            has_lost_callback: false,
            steps,
            depth: 0,
            loops: 0,
        };
        let is_settled = settler.settles();
        steps = settler.steps;
        let (called, named) = (settler.called, settler.named);
        match is_settled {
            true => settled.push(SettledFunction {
                function,
                evals,
                called,
                named,
            }),
            false => unsettled.push((owner, evals)),
        }
    }
    let is_within = |mut inner: FnId, outer: FnId| {
        while inner.is_some() && inner != outer {
            inner = bound.fns[inner.idx()].enclosing;
        }
        inner == outer
    };
    let may_change = |(owner, evals): &(Owner, Evals), settled: &SettledFunction| {
        let Owner::Function(other) = *owner else {
            return true;
        };
        is_within(other, settled.function)
            || is_within(settled.function, other)
            || (settled.called.iter()).any(|&called| is_within(other, called))
            || (settled.named.iter()).any(|&name| evals.may_store(hir, atoms, name))
    };
    loop {
        let (kept, others): (Vec<_>, Vec<_>) = settled
            .into_iter()
            .partition(|it| !unsettled.iter().any(|other| may_change(other, it)));
        settled = kept;
        if others.is_empty() {
            break;
        }
        let others = others.into_iter();
        unsettled = others
            .map(|it| (Owner::Function(it.function), it.evals))
            .collect();
    }
    let mut calls: Vec<CallId> = settled.into_iter().flat_map(|it| it.evals.calls).collect();
    calls.sort_unstable();
    calls
}

impl Settler<'_, '_> {
    fn settles(&mut self) -> bool {
        if self.run_function().is_none() || self.has_lost_callback {
            return false;
        }
        let (hir, atoms) = (self.hir, self.atoms);
        self.found.iter().all(|(call, text)| {
            let mut known = hir.known_evaluations_of(*call).iter();
            let text = atoms.intern(text);
            let is_function = |root: ExprId| matches!(hir[root].kind, ExprKind::Fn(_));
            known.any(|it| {
                !it.is_in_global_scope
                    && !it.is_called()
                    && is_function(hir.skip_type_assertions(it.function))
                    && hir.ids(it.arguments).next() == Some(text)
            })
        })
    }

    fn run_function(&mut self) -> Option<()> {
        let hir = self.hir;
        let function = self.function;
        let in_parameters = hir[function].params.iter().any(|param| {
            let (pat, default) = (hir[param].pat, hir[param].default);
            let end = if default.is_some() {
                hir[default].end
            } else {
                hir[pat].end
            };
            self.holds_eval(hir[pat].pos, end)
        });
        let flags = self.bound.function_flags(function);
        let has_patterns = hir[function].params.iter().any(|param| {
            let is_name = matches!(hir[hir[param].pat].kind, PatKind::Ident(_));
            !is_name || hir[param].default.is_some()
        });
        if in_parameters || has_patterns || flags.contains(FunctionFlags::HAS_PARAMETER_EXPRESSIONS)
        {
            return None;
        }
        self.activate(function);
        match hir[function].body {
            FnBody::None => None,
            FnBody::Expr(expression) => self.expression(expression).map(|_| ()),
            FnBody::Block(body) => self.statements(body).map(|_| ()),
        }
    }

    fn pay(&mut self, cost: usize) -> Option<()> {
        let cost = u32::try_from(cost).ok()?;
        self.steps = self.steps.checked_sub(cost)?;
        Some(())
    }

    fn activate(&mut self, function: FnId) {
        self.environments += 1;
        self.activations.push(Activation {
            function,
            environment: EnvironmentId(self.environments),
            variables: FxHashMap::default(),
        });
    }

    fn holds_eval(&self, start: u32, end: u32) -> bool {
        let positions = &self.evals.positions;
        let first = positions.partition_point(|&it| it < start);
        positions.get(first).is_some_and(|&it| it < end)
    }

    fn activation_of(&self, symbol: SymbolId) -> Option<usize> {
        let CodeUnit::Function(declaring) = self.bound.code_unit(self.bound.symbol_scope(symbol))
        else {
            return None;
        };
        let is_function = |decl: &Decl| matches!(decl, Decl::Fn(_));
        if self.identifiers.stored_elsewhere.contains(&symbol)
            || self.bound.runtime.is_stored_by_function_of_block(symbol)
            || (declaring == self.function && self.is_parameter(symbol))
            || self.bound.symbol(symbol).decls.iter().any(is_function)
            || self.bound.binding_kind(symbol) == BindingKind::FunctionName
        {
            return None;
        }
        self.activations
            .iter()
            .rposition(|it| it.function == declaring)
    }

    fn is_parameter(&self, symbol: SymbolId) -> bool {
        let hir = self.hir;
        self.bound.binding_kind(symbol) == BindingKind::Parameter
            || hir[self.function].params.iter().any(|param| {
                let declared = self.bound.initialized_binding(hir[param].pat);
                matches!(declared, Binding::Symbol(it) if it == symbol)
            })
    }

    fn is_one_in_activation(&self, symbol: SymbolId, declaring: FnId) -> bool {
        match self.bound.binding_kind(symbol) {
            BindingKind::Var | BindingKind::Parameter => true,
            _ => self.bound.symbol_scope(symbol) == self.bound.fns[declaring.idx()].scope,
        }
    }

    fn environment_around(&self, symbol: SymbolId) -> Option<EnvironmentId> {
        match self.bound.code_unit(self.bound.symbol_scope(symbol)) {
            CodeUnit::File => Some(EnvironmentId(0)),
            CodeUnit::Function(declaring) => {
                let mut around = self.activations.iter().rev();
                Some(around.find(|it| it.function == declaring)?.environment)
            }
            _ => None,
        }
    }

    fn function_declared_as(&self, symbol: SymbolId) -> Option<FnId> {
        match self.bound.symbol(symbol).decls {
            [Decl::Fn(function)]
                if self.bound.stores_to(symbol).is_empty()
                    && !self.bound.runtime.is_stored_by_function_of_block(symbol) =>
            {
                Some(*function)
            }
            _ => None,
        }
    }

    fn read(&mut self, identifier: ExprId, name: Atom) -> Value {
        match self.bound.binding(identifier) {
            Binding::Symbol(_) if self.atoms.bytes(name) == b"arguments" => Value::Unknown,
            Binding::Symbol(symbol) => {
                if let Some(function) = self.function_declared_as(symbol) {
                    let Some(environment) = self.environment_around(symbol) else {
                        return Value::Unknown;
                    };
                    if environment == EnvironmentId(0) {
                        self.named.insert(name);
                    }
                    return Value::Function(function, environment);
                }
                let Some(activation) = self.activation_of(symbol) else {
                    return Value::Unknown;
                };
                let is_own = activation + 1 == self.activations.len();
                let declaring = self.activations[activation].function;
                if !is_own && !self.is_one_in_activation(symbol, declaring) {
                    return Value::Unknown;
                }
                let value = self.activations[activation].variables.get(&symbol);
                match value {
                    Some(value) => value.clone(),
                    None if self.bound.binding_kind(symbol) == BindingKind::Var => Value::Undefined,
                    None => Value::Unknown,
                }
            }
            Binding::Free => match self.atoms.bytes(name) {
                b"undefined" => Value::Undefined,
                b"NaN" => Value::Number(f64::NAN),
                b"Infinity" => Value::Number(f64::INFINITY),
                b"Object" => Value::Global(Global::Object),
                b"Array" => Value::Global(Global::Array),
                b"String" => Value::Global(Global::String),
                b"RegExp" => Value::Global(Global::RegExp),
                _ => Value::Unknown,
            },
            Binding::Arguments(_) | Binding::CommonJs(_) => Value::Unknown,
        }
    }

    fn assign(&mut self, symbol: SymbolId, value: Value) {
        let value = without_pattern(value);
        if self.identifiers.captured.contains(&symbol) {
            self.lose(&value);
        }
        match self.activation_of(symbol) {
            Some(activation) => {
                self.activations[activation].variables.insert(symbol, value);
            }
            None => self.lose(&value),
        }
    }

    fn lose(&mut self, value: &Value) {
        match value {
            Value::Object(id) => {
                let object = &mut self.objects[id.0];
                if std::mem::replace(&mut object.is_open, true) {
                    return;
                }
                let elements = std::mem::take(&mut object.elements);
                let properties = std::mem::take(&mut object.properties);
                for element in elements.iter().chain(properties.iter().map(|it| &it.1)) {
                    self.lose(element);
                }
            }
            Value::Function(function, _) => {
                let start = self.hir[*function].start;
                let end = end_of_body(self.hir, *function).unwrap_or(start);
                self.lose_callbacks(start, end);
                self.lose_names(start, end);
            }
            _ => {}
        }
    }

    fn lose_callbacks(&mut self, start: u32, end: u32) {
        let callbacks = &self.identifiers.callbacks;
        let first = callbacks.partition_point(|it| it.0 < start);
        let mut within = callbacks[first..]
            .iter()
            .take_while(|it| it.0 < end.max(start + 1));
        let is_active = |function: FnId| self.activations.iter().any(|it| it.function == function);
        let loses_some = within.any(|it| is_active(it.2));
        self.has_lost_callback |= loses_some;
    }

    fn convert(&mut self, value: &Value) {
        let Value::Object(id) = value else {
            return;
        };
        let object = &self.objects[id.0];
        let is_method = |key: &[u8]| matches!(key, b"toString" | b"valueOf");
        let is_object = |element: &Value| matches!(element, Value::Object(_));
        if object.properties.iter().any(|it| is_method(&it.0))
            || object.elements.iter().any(is_object)
        {
            self.lose(value);
        }
    }

    fn to_key(&mut self, value: &Value) -> Option<Rc<[u8]>> {
        self.convert(value);
        value.to_text()
    }

    fn create(&mut self, object: Object) -> Option<Value> {
        self.pay(object.size() + 1)?;
        self.objects.push(object);
        Some(Value::Object(ObjectId(self.objects.len() - 1)))
    }

    fn elements_of(&self, value: &Value) -> Option<Vec<Value>> {
        match value {
            Value::Object(id) => {
                let object = &self.objects[id.0];
                (object.is_array && !object.is_open).then(|| object.elements.clone())
            }
            _ => None,
        }
    }

    fn lose_names(&mut self, start: u32, end: u32) {
        let (bound, identifiers) = (self.bound, self.identifiers);
        let named = range_of(&identifiers.identifiers, start, end);
        self.steps = self.steps.saturating_sub(named.len() as u32 / 4);
        for &(_, identifier, _) in named {
            let Binding::Symbol(symbol) = bound.binding(identifier) else {
                continue;
            };
            let Some(activation) = self.activation_of(symbol) else {
                continue;
            };
            let value = self.activations[activation].variables.get(&symbol).cloned();
            if let Some(value @ Value::Object(_)) = value {
                self.lose(&value);
            }
            if bound.is_store_target(identifier) {
                self.activations[activation]
                    .variables
                    .insert(symbol, Value::Unknown);
            }
        }
        let first = identifiers.names.partition_point(|it| it.0 < start);
        let count = identifiers.names[first..].partition_point(|it| it.0 < end);
        for &(_, name) in &identifiers.names[first..first + count] {
            if let Binding::Symbol(symbol) = bound.initialized_binding(name)
                && let Some(activation) = self.activation_of(symbol)
            {
                self.activations[activation]
                    .variables
                    .insert(symbol, Value::Unknown);
            }
        }
    }

    fn skip(&mut self, start: u32, end: u32) -> Option<()> {
        let decorated = &self.identifiers.decorated_classes;
        let start = decorated.get(&start).copied().unwrap_or(start);
        if self.holds_eval(start, end) {
            return None;
        }
        self.pay(1)?;
        let current = self.activations.last()?.function;
        let is_outermost = self.activations.len() == 1;
        let leaves = range_of(&self.identifiers.jumps, start, end)
            .iter()
            .any(|it| {
                it.2 == Owner::Function(current)
                    && match self.hir[it.1].kind {
                        StmtKind::Return(_) => !is_outermost,
                        _ => self.loops > 0,
                    }
            });
        if leaves {
            return None;
        }
        self.lose_callbacks(start, end);
        self.lose_names(start, end);
        Some(())
    }

    fn skip_statement(&mut self, statement: StmtId) -> Option<Flow> {
        let (start, end) = (self.hir[statement].start, self.hir[statement].loc.end);
        self.skip(start.min(self.hir[statement].loc.pos), end)?;
        Some(Flow::Next)
    }

    fn skip_expression(&mut self, expression: ExprId) -> Option<Value> {
        let (start, end) = (self.hir[expression].pos, self.hir[expression].end);
        self.skip(start, end)?;
        Some(Value::Unknown)
    }

    fn statements(&mut self, list: IdList<StmtId>) -> Option<Flow> {
        let hir = self.hir;
        for statement in hir.ids(list) {
            match self.statement(statement)? {
                Flow::Next => {}
                flow => return Some(flow),
            }
        }
        Some(Flow::Next)
    }

    fn statement(&mut self, statement: StmtId) -> Option<Flow> {
        if statement.is_none() {
            return Some(Flow::Next);
        }
        self.pay(1)?;
        self.depth += 1;
        let flow = match self.depth < MAX_DEPTH {
            true => self.statement_of_kind(statement),
            false => None,
        };
        self.depth -= 1;
        flow
    }

    fn statement_of_kind(&mut self, statement: StmtId) -> Option<Flow> {
        let hir = self.hir;
        match hir[statement].kind {
            StmtKind::Empty | StmtKind::Debugger | StmtKind::Fn(_) => Some(Flow::Next),
            StmtKind::Expr(expression) => {
                let value = self.expression(expression)?;
                self.lose_functions(&value);
                Some(Flow::Next)
            }
            StmtKind::Var(declarations) => {
                for declaration in declarations.iter() {
                    let declaration = hir[declaration];
                    let value = match declaration.init.is_some() {
                        true => self.expression(declaration.init)?,
                        false if declaration.kind == VarKind::Var => continue,
                        false => Value::Undefined,
                    };
                    self.bind(declaration.pat, value)?;
                }
                Some(Flow::Next)
            }
            StmtKind::Block(list) => self.statements(list),
            StmtKind::If { test, yes, no } => match self.expression(test)?.to_boolean() {
                Some(true) => self.statement(yes),
                Some(false) => self.statement(no),
                None => {
                    self.skip_statement(yes)?;
                    match no.is_some() {
                        true => self.skip_statement(no),
                        false => Some(Flow::Next),
                    }
                }
            },
            StmtKind::Return(expression) => {
                let value = match expression.is_some() {
                    true => self.expression(expression)?,
                    false => Value::Undefined,
                };
                Some(Flow::Return(value))
            }
            StmtKind::Break(Atom::NONE) if self.loops > 0 => Some(Flow::Break),
            StmtKind::Continue(Atom::NONE) if self.loops > 0 => Some(Flow::Continue),
            StmtKind::For { .. }
            | StmtKind::ForIn { .. }
            | StmtKind::ForOf {
                is_await: false, ..
            }
            | StmtKind::While { .. }
            | StmtKind::DoWhile { .. } => self.repetition(statement),
            _ => self.skip_statement(statement),
        }
    }

    fn repetition(&mut self, statement: StmtId) -> Option<Flow> {
        let (start, end) = (self.hir[statement].loc.pos, self.hir[statement].loc.end);
        if self.holds_eval(start, end) {
            return self.follow_repetition(statement);
        }
        let sizes = self.objects.iter().map(Object::size);
        self.pay((sizes.sum::<usize>() + self.objects.len()) / 8)?;
        let variables: Vec<FxHashMap<SymbolId, Value>> = self
            .activations
            .iter()
            .map(|it| it.variables.clone())
            .collect();
        let objects = self.objects.clone();
        let (count, loops, depth) = (self.activations.len(), self.loops, self.depth);
        let all = self.steps;
        self.steps = all.min(MAX_STEPS_OF_STATEMENT);
        let given = self.steps;
        let followed = self.follow_repetition(statement);
        self.steps = all - (given - self.steps);
        if followed.is_some() {
            return followed;
        }
        self.activations.truncate(count);
        for (activation, before) in self.activations.iter_mut().zip(variables) {
            activation.variables = before;
        }
        self.objects = objects;
        (self.loops, self.depth) = (loops, depth);
        self.skip_statement(statement)
    }

    fn follow_repetition(&mut self, statement: StmtId) -> Option<Flow> {
        let hir = self.hir;
        self.loops += 1;
        let flow = match hir[statement].kind {
            StmtKind::For {
                init,
                test,
                update,
                body,
            } => {
                self.statement(init)?;
                self.repeat(test, body, update, true)
            }
            StmtKind::While { test, body } => self.repeat(test, body, ExprId::NONE, true),
            StmtKind::DoWhile { body, test } => self.repeat(test, body, ExprId::NONE, false),
            StmtKind::ForOf {
                left, expr, body, ..
            } => {
                let iterated = self.expression(expr)?;
                let Value::Object(id) = iterated else {
                    return None;
                };
                let mut index = 0;
                loop {
                    let object = &self.objects[id.0];
                    if object.is_open || !object.is_array {
                        return None;
                    }
                    let Some(value) = object.elements.get(index).cloned() else {
                        break Some(Flow::Next);
                    };
                    index += 1;
                    match self.iteration(left, value, body)? {
                        Flow::Next | Flow::Continue => {}
                        Flow::Break => break Some(Flow::Next),
                        flow @ Flow::Return(_) => break Some(flow),
                    }
                }
            }
            StmtKind::ForIn { left, expr, body } => {
                let Value::Object(id) = self.expression(expr)? else {
                    return None;
                };
                if self.objects[id.0].is_array {
                    return None;
                }
                let keys = self.objects[id.0].keys()?;
                let mut flow = Flow::Next;
                for key in &keys {
                    self.pay(keys.len())?;
                    match self.iteration(left, Value::String(Rc::clone(key)), body)? {
                        Flow::Next | Flow::Continue => {}
                        Flow::Break => break,
                        Flow::Return(value) => {
                            flow = Flow::Return(value);
                            break;
                        }
                    }
                    if self.objects[id.0].keys().as_ref() != Some(&keys) {
                        return None;
                    }
                }
                Some(flow)
            }
            _ => None,
        };
        self.loops -= 1;
        flow
    }

    fn iteration(&mut self, left: StmtId, value: Value, body: StmtId) -> Option<Flow> {
        let hir = self.hir;
        self.pay(1)?;
        match hir[left].kind {
            StmtKind::Var(declarations) => {
                let declaration = declarations.iter().next()?;
                self.bind(hir[declaration].pat, value)?;
            }
            StmtKind::Expr(target) => self.store(target, value)?,
            _ => return None,
        }
        self.statement(body)
    }

    fn repeat(
        &mut self,
        test: ExprId,
        body: StmtId,
        update: ExprId,
        tests_first: bool,
    ) -> Option<Flow> {
        let mut is_tested = tests_first;
        loop {
            self.pay(1)?;
            if std::mem::replace(&mut is_tested, true)
                && test.is_some()
                && !self.expression(test)?.to_boolean()?
            {
                return Some(Flow::Next);
            }
            match self.statement(body)? {
                Flow::Next | Flow::Continue => {}
                Flow::Break => return Some(Flow::Next),
                flow @ Flow::Return(_) => return Some(flow),
            }
            if update.is_some() {
                self.expression(update)?;
            }
        }
    }

    fn bind(&mut self, pat: PatId, value: Value) -> Option<()> {
        let hir = self.hir;
        match hir[pat].kind {
            PatKind::Ident(_) => {
                match self.bound.initialized_binding(pat) {
                    Binding::Symbol(symbol) => self.assign(symbol, value),
                    _ => self.lose(&value),
                }
                Some(())
            }
            _ => {
                self.lose(&value);
                self.skip(hir[pat].pos, hir[pat].end)
            }
        }
    }

    fn expression(&mut self, expression: ExprId) -> Option<Value> {
        self.pay(1)?;
        self.depth += 1;
        let value = match self.depth < MAX_DEPTH {
            true => self.expression_of_kind(self.hir.skip_type_assertions(expression)),
            false => None,
        };
        self.depth -= 1;
        value
    }

    fn string(&mut self, text: Vec<u8>) -> Option<Value> {
        self.pay(text.len() / 16 + 1)?;
        if !text.is_ascii() {
            return Some(Value::Unknown);
        }
        Some(Value::String(text.into()))
    }

    fn expression_of_kind(&mut self, expression: ExprId) -> Option<Value> {
        let hir = self.hir;
        let value = match hir[expression].kind {
            ExprKind::Ident(name) => self.read(expression, name),
            ExprKind::Null => Value::Null,
            ExprKind::True => Value::Boolean(true),
            ExprKind::False => Value::Boolean(false),
            ExprKind::Number(number) => Value::Number(hir.numbers[number as usize]),
            ExprKind::String(text) => Value::string(self.atoms.bytes(text)),
            ExprKind::Regex { pattern, flags } => {
                let (source, flags) = (self.atoms.bytes(pattern), self.atoms.bytes(flags));
                let pattern = strings::parse_pattern(source, flags);
                pattern.map_or(Value::Unknown, |it| Value::Pattern(Rc::new(it)))
            }
            ExprKind::Template { exprs } => {
                let mut texts = hir.ids(hir.template_texts(exprs));
                let mut joined = Vec::new();
                let mut is_known = true;
                joined.extend(texts.next().map_or(&[][..], |it| self.atoms.bytes(it)));
                for substitution in hir.ids(exprs) {
                    let value = self.expression(substitution)?;
                    match self.to_key(&value) {
                        Some(text) => joined.extend_from_slice(&text),
                        None => is_known = false,
                    }
                    joined.extend(texts.next().map_or(&[][..], |it| self.atoms.bytes(it)));
                }
                match is_known {
                    true => self.string(joined)?,
                    false => Value::Unknown,
                }
            }
            ExprKind::Array(list) => self.array(list)?,
            ExprKind::Object(_) => self.object(expression)?,
            ExprKind::Fn(function) => {
                Value::Function(function, self.activations.last()?.environment)
            }
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => {
                let object = self.expression(obj)?;
                self.property(&object, self.atoms.bytes(name))
            }
            ExprKind::Index {
                obj,
                index,
                chain: Chain::No,
            } => {
                let object = self.expression(obj)?;
                let index = self.expression(index)?;
                match self.to_key(&index) {
                    Some(key) => self.property(&object, &key),
                    None => Value::Unknown,
                }
            }
            ExprKind::Call(call) => {
                let value = self.call(expression, call, hir[call])?;
                self.forget_effects_of_removable_call(expression, call);
                value
            }
            ExprKind::New(call) => {
                let callee = self.expression(hir[call].callee)?;
                let args = self.arguments(hir.written_args(call))?;
                let value = match (callee, args) {
                    (Value::Global(Global::RegExp), Some(args)) => {
                        for arg in &args {
                            self.lose(arg);
                        }
                        create_pattern(&args)
                    }
                    (_, args) => {
                        for arg in args.iter().flatten() {
                            self.lose(arg);
                        }
                        Value::Unknown
                    }
                };
                self.forget_effects_of_removable_call(expression, call);
                value
            }
            ExprKind::Unary {
                op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                operand,
            } if !self.is_variable(operand) => self.skip_expression(expression)?,
            ExprKind::Unary { op, operand } => self.unary(op, operand)?,
            ExprKind::Binary { op, left, right } => self.binary(op, left, right)?,
            ExprKind::Assign {
                op: Some(_),
                target,
                ..
            } if !self.is_variable(target) => self.skip_expression(expression)?,
            ExprKind::Assign { op, target, value } => self.assignment(op, target, value)?,
            ExprKind::Cond { test, branches } => {
                let branches = hir.branches(branches);
                match self.expression(test)?.to_boolean() {
                    Some(true) => self.expression(branches.yes)?,
                    Some(false) => self.expression(branches.no)?,
                    None => {
                        self.skip_expression(branches.yes)?;
                        self.skip_expression(branches.no)?
                    }
                }
            }
            ExprKind::Missing
            | ExprKind::This
            | ExprKind::Super
            | ExprKind::BigInt(_)
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::ImportMeta
            | ExprKind::NewTarget(_) => Value::Unknown,
            _ => self.skip_expression(expression)?,
        };
        Some(value)
    }

    fn array(&mut self, list: IdList<ExprId>) -> Option<Value> {
        let hir = self.hir;
        let mut elements = Vec::new();
        let mut is_known = true;
        for element in hir.ids(list) {
            match hir[element].kind {
                ExprKind::Spread(operand) => {
                    let value = self.expression(operand)?;
                    match self.elements_of(&value) {
                        Some(more) => elements.extend(more),
                        None => is_known = false,
                    }
                }
                ExprKind::Missing => is_known = false,
                _ => elements.push(without_pattern(self.expression(element)?)),
            }
        }
        let array = self.create(Object::array(elements))?;
        if !is_known {
            self.lose(&array);
        }
        Some(array)
    }

    fn object(&mut self, expression: ExprId) -> Option<Value> {
        let hir = self.hir;
        let ExprKind::Object(props) = hir[expression].kind else {
            return None;
        };
        let mut object = Object::default();
        let mut is_known = true;
        for prop in props.iter() {
            let prop = hir[prop];
            let key: Option<Rc<[u8]>> = match prop.key {
                PropKey::Name(name) => Some(self.atoms.bytes(name).into()),
                PropKey::Computed(key) => {
                    let key = self.expression(key)?;
                    self.to_key(&key)
                }
                PropKey::None | PropKey::Private(_) => None,
            };
            let value = without_pattern(self.expression(prop.value)?);
            match (prop.kind, key) {
                (PropKind::Init | PropKind::Shorthand | PropKind::Method, Some(key))
                    if *key != *b"__proto__" =>
                {
                    object.set(&key, value);
                }
                _ => {
                    self.lose(&value);
                    is_known = false;
                }
            }
        }
        let object = self.create(object)?;
        if !is_known {
            self.lose(&object);
        }
        Some(object)
    }

    fn property(&self, object: &Value, key: &[u8]) -> Value {
        match object {
            Value::Object(id) => self.objects[id.0].get(key),
            Value::String(text) if text.is_ascii() && key == b"length" => {
                Value::Number(text.len() as f64)
            }
            Value::String(text) if text.is_ascii() => {
                let character = Object::index_of_key(key).and_then(|it| text.get(it));
                character.map_or(Value::Unknown, |it| Value::string(std::slice::from_ref(it)))
            }
            _ => Value::Unknown,
        }
    }

    fn unary(&mut self, op: UnOp, operand: ExprId) -> Option<Value> {
        if let UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec = op {
            let before = self.expression(operand)?;
            self.convert(&before);
            let step = match op {
                UnOp::PreInc | UnOp::PostInc => 1.0,
                _ => -1.0,
            };
            let after = before.as_number().map(|it| Value::Number(it + step));
            let after = after.unwrap_or(Value::Unknown);
            self.store(operand, after.clone())?;
            return Some(match (op, &after) {
                (_, Value::Unknown) => Value::Unknown,
                (UnOp::PreInc | UnOp::PreDec, _) => after,
                _ => before,
            });
        }
        if op == UnOp::Delete {
            return self.skip_expression(operand);
        }
        let value = self.expression(operand)?;
        if !matches!(op, UnOp::Not | UnOp::Void | UnOp::Typeof) {
            self.convert(&value);
        }
        Some(match op {
            UnOp::Not => (value.to_boolean()).map_or(Value::Unknown, |it| Value::Boolean(!it)),
            UnOp::Minus => (value.as_number()).map_or(Value::Unknown, |it| Value::Number(-it)),
            UnOp::Plus => value.as_number().map_or(Value::Unknown, Value::Number),
            UnOp::Void => Value::Undefined,
            UnOp::Typeof => match value {
                Value::Unknown => Value::Unknown,
                Value::Undefined => Value::string(b"undefined"),
                Value::Boolean(_) => Value::string(b"boolean"),
                Value::Number(_) => Value::string(b"number"),
                Value::String(_) => Value::string(b"string"),
                Value::Function(..) | Value::Evaluated | Value::Global(_) => {
                    Value::string(b"function")
                }
                Value::Null
                | Value::Object(_)
                | Value::Pattern(_)
                | Value::Matcher(_)
                | Value::Path(_)
                | Value::Contents(_)
                | Value::Prototype(_) => Value::string(b"object"),
            },
            _ => Value::Unknown,
        })
    }

    fn binary(&mut self, op: BinOp, left: ExprId, right: ExprId) -> Option<Value> {
        match op {
            BinOp::Comma => {
                self.expression(left)?;
                return self.expression(right);
            }
            BinOp::And | BinOp::Or | BinOp::Nullish => {
                let value = self.expression(left)?;
                let goes_on = match op {
                    BinOp::And => value.to_boolean(),
                    BinOp::Or => value.to_boolean().map(|it| !it),
                    _ if value.is_known() => Some(matches!(value, Value::Undefined | Value::Null)),
                    _ => None,
                };
                return match goes_on {
                    Some(true) => self.expression(right),
                    Some(false) => Some(value),
                    None => self.skip_expression(right),
                };
            }
            _ => {}
        }
        let left = self.expression(left)?;
        let right = self.expression(right)?;
        self.combine(op, &left, &right)
    }

    fn combine(&mut self, op: BinOp, left: &Value, right: &Value) -> Option<Value> {
        if let (Some(left), Some(right)) = (left.as_number(), right.as_number()) {
            return Some(match op {
                BinOp::Add => Value::Number(left + right),
                BinOp::Sub => Value::Number(left - right),
                BinOp::Mul => Value::Number(left * right),
                BinOp::Div => Value::Number(left / right),
                BinOp::Rem => Value::Number(left % right),
                BinOp::Lt => Value::Boolean(left < right),
                BinOp::Le => Value::Boolean(left <= right),
                BinOp::Gt => Value::Boolean(left > right),
                BinOp::Ge => Value::Boolean(left >= right),
                BinOp::EqEq | BinOp::EqEqEq => Value::Boolean(left == right),
                BinOp::NotEq | BinOp::NotEqEq => Value::Boolean(left != right),
                _ => Value::Unknown,
            });
        }
        match op {
            BinOp::EqEqEq | BinOp::NotEqEq => {}
            BinOp::EqEq | BinOp::NotEq
                if matches!((left, right), (Value::Object(_), Value::Object(_))) => {}
            BinOp::In => self.convert(left),
            BinOp::Instanceof if matches!(right, Value::Global(_)) => {}
            BinOp::Instanceof => self.lose(left),
            _ => {
                self.convert(left);
                self.convert(right);
            }
        }
        let is_created = |value: &Value| matches!(value, Value::Function(..) | Value::Pattern(_));
        let identity = |is_equal: bool| {
            if is_created(left) && is_created(right) {
                return Value::Unknown;
            }
            let answer = left.is_identical(right);
            answer.map_or(Value::Unknown, |it| Value::Boolean(it == is_equal))
        };
        Some(match op {
            BinOp::Add
                if matches!((left, right), (Value::String(_), _) | (_, Value::String(_))) =>
            {
                match (left.to_text(), right.to_text()) {
                    (Some(left), Some(right)) => self.string([&left[..], &right[..]].concat())?,
                    _ => Value::Unknown,
                }
            }
            BinOp::EqEqEq => identity(true),
            BinOp::NotEqEq => identity(false),
            BinOp::EqEq if std::mem::discriminant(left) == std::mem::discriminant(right) => {
                identity(true)
            }
            BinOp::NotEq if std::mem::discriminant(left) == std::mem::discriminant(right) => {
                identity(false)
            }
            _ => Value::Unknown,
        })
    }

    fn assignment(&mut self, op: Option<BinOp>, target: ExprId, value: ExprId) -> Option<Value> {
        let hir = self.hir;
        let value = match op {
            None => match hir[hir.skip_type_assertions(target)].kind {
                ExprKind::Dot {
                    obj,
                    name,
                    chain: Chain::No,
                    ..
                } => {
                    let object = self.expression(obj)?;
                    let value = self.expression(value)?;
                    let key = self.atoms.bytes(name);
                    self.store_property(&object, Some(key), &value);
                    return Some(value);
                }
                ExprKind::Index {
                    obj,
                    index,
                    chain: Chain::No,
                } => {
                    let object = self.expression(obj)?;
                    let key = self.expression(index)?;
                    let value = self.expression(value)?;
                    let key = self.to_key(&key);
                    self.store_property(&object, key.as_deref(), &value);
                    return Some(value);
                }
                _ => self.expression(value)?,
            },
            Some(BinOp::And | BinOp::Or | BinOp::Nullish) => {
                let before = self.expression(target)?;
                self.lose(&before);
                self.skip_expression(value)?
            }
            Some(op) => {
                let before = self.expression(target)?;
                let operand = self.expression(value)?;
                self.combine(op, &before, &operand)?
            }
        };
        self.store(target, value.clone())?;
        Some(value)
    }

    fn is_variable(&self, target: ExprId) -> bool {
        let target = self.hir.skip_type_assertions(target);
        matches!(self.hir[target].kind, ExprKind::Ident(_))
    }

    fn store(&mut self, target: ExprId, value: Value) -> Option<()> {
        let hir = self.hir;
        let target = hir.skip_type_assertions(target);
        match (hir[target].kind, self.bound.binding(target)) {
            (ExprKind::Ident(_), Binding::Symbol(symbol)) => self.assign(symbol, value),
            (ExprKind::Ident(_), _) => self.lose(&value),
            _ => {
                self.lose(&value);
                self.skip_expression(target)?;
            }
        }
        Some(())
    }

    fn store_property(&mut self, object: &Value, key: Option<&[u8]>, value: &Value) {
        let value = &without_pattern(value.clone());
        match (object, key) {
            (Value::Object(id), Some(key))
                if !self.objects[id.0].is_open && key != b"__proto__" && key != b"length" =>
            {
                self.objects[id.0].set(key, value.clone());
                if self.objects[id.0].is_open {
                    self.objects[id.0].is_open = false;
                    self.lose(object);
                    self.lose(value);
                }
            }
            _ => {
                self.lose(object);
                self.lose(value);
            }
        }
    }

    fn forget_effects_of_removable_call(&mut self, expression: ExprId, call: CallId) {
        let hir = self.hir;
        let mut args = hir.ids(hir.written_args(call));
        let is_removable = hir[call].is_pure
            || (self.names_global(hir[call].callee) && !args.all(|it| self.has_no_effects(it)));
        if is_removable && !self.evals.calls.contains(&call) {
            let (start, end) = (hir[expression].pos, hir[expression].end);
            self.lose_callbacks(start, end);
            self.lose_names(start, end);
        }
    }

    fn names_global(&self, callee: ExprId) -> bool {
        let hir = self.hir;
        let mut root = hir.skip_type_assertions(callee);
        while let ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } = hir[root].kind {
            root = hir.skip_type_assertions(obj);
        }
        match hir[root].kind {
            ExprKind::Ident(_) => self.bound.binding(root) == Binding::Free,
            ExprKind::ImportMeta => true,
            _ => false,
        }
    }

    fn has_no_effects(&self, expression: ExprId) -> bool {
        let hir = self.hir;
        match hir[hir.skip_type_assertions(expression)].kind {
            ExprKind::Ident(_)
            | ExprKind::Null
            | ExprKind::True
            | ExprKind::False
            | ExprKind::Number(_)
            | ExprKind::String(_)
            | ExprKind::Regex { .. }
            | ExprKind::Fn(_) => true,
            ExprKind::Template { exprs } => hir.ids(exprs).all(|it| self.has_no_effects(it)),
            ExprKind::Dot { obj, .. } => self.has_no_effects(obj),
            ExprKind::Index { obj, index, .. } => {
                self.has_no_effects(obj) && self.has_no_effects(index)
            }
            ExprKind::Binary { left, right, .. } => {
                self.has_no_effects(left) && self.has_no_effects(right)
            }
            _ => false,
        }
    }

    fn lose_functions(&mut self, value: &Value) {
        if let Value::Function(..) = value {
            self.lose(value);
        }
    }

    fn arguments(&mut self, list: IdList<ExprId>) -> Option<Option<Vec<Value>>> {
        let hir = self.hir;
        let mut args = Vec::new();
        let mut is_known = true;
        for arg in hir.ids(list) {
            match hir[arg].kind {
                ExprKind::Spread(operand) => {
                    let value = self.expression(operand)?;
                    match self.elements_of(&value) {
                        Some(elements) => {
                            self.pay(elements.len())?;
                            args.extend(elements);
                        }
                        None => {
                            self.lose(&value);
                            is_known = false;
                        }
                    }
                }
                _ => args.push(self.expression(arg)?),
            }
        }
        if !is_known {
            for arg in &args {
                self.lose(arg);
            }
            return Some(None);
        }
        Some(Some(args))
    }

    fn call(&mut self, expression: ExprId, call: CallId, site: Call) -> Option<Value> {
        let hir = self.hir;
        let written = hir.written_args(call);
        if self.evals.calls.contains(&call) {
            let args = self.arguments(written)??;
            let (Value::String(text), others) = (args.first()?, &args[1..]) else {
                return None;
            };
            self.found.push((call, Rc::clone(text)));
            for other in others {
                self.lose(other);
            }
            return Some(Value::Unknown);
        }
        if site.chain != Chain::No {
            return self.skip_expression(expression);
        }
        let callee = hir.skip_type_assertions(site.callee);
        let (receiver, name) = match hir[callee].kind {
            ExprKind::Dot {
                obj,
                name,
                chain: Chain::No,
                ..
            } => {
                let name: Rc<[u8]> = self.atoms.bytes(name).into();
                (Some(self.expression(obj)?), Some(name))
            }
            ExprKind::Index {
                obj,
                index,
                chain: Chain::No,
            } => {
                let object = self.expression(obj)?;
                let index = self.expression(index)?;
                (Some(object), self.to_key(&index))
            }
            _ => (None, None),
        };
        if let Some(receiver) = receiver {
            let args = self.arguments(written)?;
            if let (Some(name), Some(args)) = (&name, &args)
                && let Some(value) = self.call_method(&receiver, name, args)?
            {
                return Some(value);
            }
            self.lose(&receiver);
            for arg in args.iter().flatten() {
                self.lose(arg);
            }
            return Some(Value::Unknown);
        }
        let callee = self.expression(callee)?;
        let args = self.arguments(written)?;
        match (&callee, &args) {
            (Value::Function(function, environment), Some(args)) => {
                if let Some(value) = self.call_function(*function, *environment, args)? {
                    return Some(value);
                }
            }
            (Value::Global(Global::String), Some(args)) => {
                if let Some(text) = args.first().and_then(Value::to_text) {
                    return Some(Value::String(text));
                }
            }
            (Value::Global(Global::RegExp), Some(args)) => {
                for arg in args {
                    self.lose(arg);
                }
                return Some(create_pattern(args));
            }
            _ => {}
        }
        for arg in args.iter().flatten() {
            self.lose(arg);
        }
        Some(Value::Unknown)
    }

    fn call_function(
        &mut self,
        function: FnId,
        environment: EnvironmentId,
        args: &[Value],
    ) -> Option<Option<Value>> {
        let hir = self.hir;
        let func = hir[function];
        let flags = self.bound.function_flags(function);
        let finds_variables = environment == EnvironmentId(0)
            || (self.activations.iter()).any(|it| it.environment == environment);
        let is_recursive = self.activations.iter().any(|it| it.function == function);
        let is_followed = finds_variables
            && !is_recursive
            && !func.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
            && !flags.intersects(FunctionFlags::USES_ARGUMENTS | FunctionFlags::HAS_DIRECT_EVAL)
            && func.params.iter().all(|param| {
                let param = hir[param];
                matches!(hir[param.pat].kind, PatKind::Ident(_))
                    && param.default.is_none()
                    && !param.flags.contains(Flags::REST)
            });
        if !is_followed {
            return Some(None);
        }
        self.called.insert(function);
        self.pay(4)?;
        self.depth += 4;
        if self.depth >= MAX_DEPTH {
            return None;
        }
        self.activate(function);
        let loops = std::mem::replace(&mut self.loops, 0);
        for (index, param) in func.params.iter().enumerate() {
            let value = args.get(index).cloned().unwrap_or(Value::Undefined);
            self.bind(hir[param].pat, value)?;
        }
        let result = match func.body {
            FnBody::None => return None,
            FnBody::Expr(expression) => self.expression(expression)?,
            FnBody::Block(body) => match self.statements(body)? {
                Flow::Return(value) => value,
                Flow::Next => Value::Undefined,
                Flow::Break | Flow::Continue => return None,
            },
        };
        self.loops = loops;
        self.activations.pop();
        self.depth -= 4;
        Some(Some(result))
    }

    fn call_method(
        &mut self,
        receiver: &Value,
        name: &[u8],
        args: &[Value],
    ) -> Option<Option<Value>> {
        let holder = match receiver {
            Value::String(_) => BuiltinId::StringPrototype,
            _ => BuiltinId::ArrayPrototype,
        };
        let method = table::find_name(name).and_then(|name| table::own_member(holder, name));
        if !method.is_some_and(table::is_locked) {
            return Some(None);
        }
        match receiver {
            Value::String(text) => {
                let value = match name {
                    b"replace" | b"replaceAll" => {
                        self.replace(text, name == b"replaceAll", args)?
                    }
                    _ => strings::call_method(text, name, args),
                };
                if let Some(Value::String(given)) = &value {
                    self.pay(given.len() / 16 + 1)?;
                }
                Some(value)
            }
            Value::Object(id) if self.objects[id.0].is_array && !self.objects[id.0].is_open => {
                self.call_array_method(*id, name, args)
            }
            _ => Some(None),
        }
    }

    fn replace(
        &mut self,
        text: &Rc<[u8]>,
        replaces_all: bool,
        args: &[Value],
    ) -> Option<Option<Value>> {
        let (literal, is_global) = match args {
            [Value::String(literal), _] if !literal.is_empty() => {
                (Rc::clone(literal), replaces_all)
            }
            [Value::Pattern(pattern), _] if pattern.is_global || !replaces_all => {
                (Rc::clone(&pattern.literal), pattern.is_global)
            }
            _ => return Some(None),
        };
        let Some(replacement) = args[1].to_text() else {
            return Some(None);
        };
        let Some(replacement) = strings::expand_replacement(&replacement, &literal) else {
            return Some(None);
        };
        self.pay(text.len() / 16 + 1)?;
        let mut replaced = Vec::with_capacity(text.len());
        let mut from = 0;
        for at in strings::find_matches(text, &literal, is_global) {
            replaced.extend_from_slice(&text[from..at]);
            replaced.extend_from_slice(&replacement);
            from = at + literal.len();
        }
        replaced.extend_from_slice(&text[from..]);
        Some(Some(self.string(replaced)?))
    }

    fn call_array_method(
        &mut self,
        id: ObjectId,
        name: &[u8],
        args: &[Value],
    ) -> Option<Option<Value>> {
        let elements = self.objects[id.0].elements.clone();
        self.pay(elements.len() + 1)?;
        let value = match name {
            b"push" => {
                let array = &mut self.objects[id.0];
                let added = args.iter().cloned().map(without_pattern);
                array.elements.extend(added);
                Value::Number(array.elements.len() as f64)
            }
            b"join" => {
                let separator = match args {
                    [] => Some(Rc::from(&b","[..])),
                    [separator, ..] => separator.to_text(),
                };
                let texts: Option<Vec<Rc<[u8]>>> = elements.iter().map(Value::to_text).collect();
                let has_nullish = elements
                    .iter()
                    .any(|it| matches!(it, Value::Undefined | Value::Null));
                match (separator, texts) {
                    (Some(separator), Some(texts)) if !has_nullish => {
                        self.string(texts.join(&separator[..]))?
                    }
                    _ => return Some(None),
                }
            }
            b"slice" if args.is_empty() => self.create(Object::array(elements))?,
            b"forEach" | b"map" => {
                let [Value::Function(function, environment)] = args else {
                    return Some(None);
                };
                let mut results = Vec::with_capacity(elements.len());
                for (index, element) in elements.iter().enumerate() {
                    let args = [
                        element.clone(),
                        Value::Number(index as f64),
                        Value::Object(id),
                    ];
                    let Some(result) = self.call_function(*function, *environment, &args)? else {
                        return Some(None);
                    };
                    results.push(without_pattern(result));
                    if self.objects[id.0].is_open || self.objects[id.0].elements != elements {
                        return None;
                    }
                }
                match name {
                    b"map" => self.create(Object::array(results))?,
                    _ => Value::Undefined,
                }
            }
            _ => return Some(None),
        };
        Some(Some(value))
    }
}

fn without_pattern(value: Value) -> Value {
    match value {
        Value::Pattern(_) => Value::Unknown,
        _ => value,
    }
}

fn create_pattern(args: &[Value]) -> Value {
    let Some(source) = args.first().and_then(Value::as_string) else {
        return Value::Unknown;
    };
    let flags = match args.get(1) {
        None | Some(Value::Undefined) => &b""[..],
        Some(Value::String(flags)) => flags,
        Some(_) => return Value::Unknown,
    };
    let pattern = strings::parse_pattern(source, flags);
    pattern.map_or(Value::Unknown, |it| Value::Pattern(Rc::new(it)))
}
