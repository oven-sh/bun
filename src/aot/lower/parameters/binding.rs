use bun_sema::bind::{Binding, Bound, CodeUnit, Decl, SymbolId, has_simple_parameter_list};
use bun_sema::fold::{TreeNode, push_children};
use bun_sema::hir::{self, ExprId, ExprKind, FnId, FnKind, ParamId, PatId, PatKind, UnOp};
use smallvec::SmallVec;

use crate::ir::generated::FunctionFlags;
use crate::ir::{DeclaredType, ValueId};
use crate::lower::pattern::{PatternNode, PatternOrigin, apply_default_with};
use crate::lower::scope::{BindingForm, BindingRef, ScopeSlot, Storage};
use crate::lower::{FileLowering, FunctionLowering, convert, scope};

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn lower_parameters(&mut self, source: FnId) {
        let hir = self.file.hir;
        let top = self.file.bound.fns[source.idx()].scope;
        let positions = self.file.function_positions(source);
        let parameters = hir[source].params;
        let count = self.builder.function().parameters.len() as u32;
        let get_parameter = |index| self.builder.parameter(index);
        let values: SmallVec<[ValueId; 4]> = (0..count).map(get_parameter).collect();
        let mut initial: SmallVec<[(BindingRef, ValueId); 4]> = SmallVec::new();
        let unit = CodeUnit::Function(source);
        if let Some(object) = self.create_arguments_object(unit, &values) {
            initial.push((BindingRef::Slot(top, ScopeSlot::Arguments), object));
        }
        if has_simple_parameter_list(hir, source) {
            for (index, parameter) in parameters.iter().enumerate() {
                let node = hir[parameter];
                self.set_position(node.pos);
                let symbol = self.file.bound.declared_symbol(Decl::Param(node.pat));
                match self.file.scopes.form(symbol) {
                    BindingForm::Stored => {
                        initial.push((BindingRef::Symbol(symbol), values[index]));
                    }
                    BindingForm::NotAValue
                    | BindingForm::Import
                    | BindingForm::Callee { .. }
                    | BindingForm::MappedArgument { .. }
                    | BindingForm::ContainerMember { .. } => {}
                }
            }
            initial.reverse();
            initial.sort_by_key(|entry| entry.0);
            initial.dedup_by_key(|entry| entry.0);
            self.allocate_scope(top, &initial);
        } else {
            self.allocate_scope(top, &initial);
            let mut mapped = self.file.parameters_position(source);
            let mut recorded = None;
            for (index, parameter) in parameters.iter().enumerate() {
                let node = hir[parameter];
                self.set_position(node.pos);
                let value =
                    apply_default(self, parameter, values[index], positions.parameters[index]);
                if let Some(default) = node.default.some() {
                    recorded = Some(self.file.last_reported_position(default));
                }
                match hir[node.pat].kind {
                    PatKind::Ident(name) => {
                        let symbol = self.file.bound.declared_symbol(Decl::Param(node.pat));
                        self.initialize_converted_symbol(symbol, name, value);
                    }
                    PatKind::Object(_) | PatKind::Array(_) => {
                        let recorded = recorded.unwrap_or_else(|| {
                            self.file.first_recorded_position(source, node.pat, mapped)
                        });
                        let origin = PatternOrigin { mapped, recorded };
                        self.bind_pattern(node.pat, value, None, origin);
                    }
                    PatKind::Missing => {}
                }
                if let PatKind::Array(_) = hir[node.pat].kind {
                    recorded = Some(mapped);
                }
                mapped = match node.default.some() {
                    Some(default) => self.file.last_mapped_position(default),
                    None => {
                        let last = self.file.last_mapped_pattern_position(node.pat);
                        last.unwrap_or(mapped)
                    }
                };
            }
        }
        let bound = self.file.bound;
        let copies = bound.runtime.parameter_var_copies();
        let start = copies.partition_point(|copy| copy.function < source);
        let end = copies.partition_point(|copy| copy.function <= source);
        for copy in &copies[start..end] {
            let name = bound.symbol(copy.variable).name;
            let value = self.get_binding(Binding::Symbol(copy.parameter), name);
            scope::initialize_binding(self, Binding::Symbol(copy.variable), name, value);
        }
        self.instantiate_functions(top);
        self.list_held_bindings(source);
    }

    fn list_held_bindings(&mut self, source: FnId) {
        let flags = self.builder.function().flags;
        if !flags.intersects(FunctionFlags::IS_ASYNC | FunctionFlags::IS_GENERATOR) {
            return;
        }
        let top = self.file.bound.fns[source.idx()].scope;
        let symbols = parameter_symbols(self.file.hir, self.file.bound, source);
        let names = symbols.into_iter().map(BindingRef::Symbol);
        let arguments = BindingRef::Slot(top, ScopeSlot::Arguments);
        self.coroutine.held = names.chain([arguments]).collect();
    }

    // What the names of the parameters hold here. A name that closures share lies in an environment.
    pub(in crate::lower) fn get_held_values(&mut self) -> SmallVec<[ValueId; 4]> {
        self.begin_stretch_of_scope_reads();
        let mut values: SmallVec<[ValueId; 4]> = SmallVec::new();
        for index in 0..self.coroutine.held.len() {
            let binding = self.coroutine.held[index];
            let placement = self.file.scopes.placement(binding);
            let value = match (self.scopes.find_local(binding), placement) {
                (Some(local), _) => self.builder.read_variable(local.variable),
                (None, Some(placement)) => match placement.storage {
                    Storage::Field { scope, .. } => self.get_environment(scope),
                    Storage::Local | Storage::Variable(_) => continue,
                },
                (None, None) => continue,
            };
            if !values.contains(&value) {
                values.push(value);
            }
        }
        values
    }
}

pub(in crate::lower) fn parameter_symbols(
    hir: &hir::File<'_>,
    bound: &Bound<'_>,
    function: FnId,
) -> SmallVec<[SymbolId; 4]> {
    let mut symbols: SmallVec<[SymbolId; 4]> = SmallVec::new();
    let parameters = hir[function].params.iter();
    let mut pending: SmallVec<[PatId; 8]> =
        parameters.map(|parameter| hir[parameter].pat).collect();
    while let Some(pattern) = pending.pop() {
        if pattern.is_none() {
            continue;
        }
        match hir[pattern].kind {
            PatKind::Ident(_) => match bound.initialized_binding(pattern) {
                Binding::Symbol(symbol) => symbols.push(symbol),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {}
            },
            PatKind::Missing => {}
            PatKind::Object(properties) => {
                pending.extend(properties.iter().map(|property| hir[property].value));
            }
            PatKind::Array(elements) => {
                pending.extend(elements.iter().map(|element| hir[element].pat));
            }
        }
    }
    symbols.sort_unstable();
    symbols
}

fn apply_default(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    parameter: ParamId,
    value: ValueId,
    position: DeclaredType,
) -> ValueId {
    let hir = lowering.file.hir;
    let node = hir[parameter];
    let target = PatternNode::Binding(node.pat);
    // The parameter takes `undefined` for an argument that is left out. The binding behind the default does not.
    apply_default_with(
        lowering,
        value,
        node.default,
        target,
        &mut |lowering, default| {
            let subject = convert::Int32Subject::Parameter(parameter);
            lowering.describe_int32_flow(position, subject, Some(node.default));
            let initialized = match hir[node.pat].kind {
                PatKind::Ident(_) => {
                    let symbol = lowering.file.bound.declared_symbol(Decl::Param(node.pat));
                    lowering.file.binding_position(symbol)
                }
                PatKind::Object(_) | PatKind::Array(_) | PatKind::Missing => position,
            };
            lowering.convert_initializer(default, initialized, Some(node.default))
        },
    )
}

impl FileLowering<'_, '_, '_, '_> {
    // The source map of Bun's transpiler knows the `(` of a function and the first token of an arrow function.
    pub(in crate::lower) fn parameters_position(&self, function: FnId) -> u32 {
        let node = self.hir[function];
        match node.kind {
            FnKind::Arrow => node.text_start,
            _ => node.anchor,
        }
    }

    // In front of the first position that JSC records in a function, it reports that one. Without any, it reports where the parameters start.
    fn first_recorded_position(&self, function: FnId, pattern: PatId, mapped: u32) -> u32 {
        let hir = self.hir;
        let node = hir[pattern];
        let has_rest = match node.kind {
            PatKind::Object(properties) => properties.iter().any(|property| hir[property].is_rest),
            PatKind::Missing | PatKind::Ident(_) | PatKind::Array(_) => false,
        };
        let (mut inside, mut behind) = (None::<u32>, None::<u32>);
        let mut stack = vec![TreeNode::Function(function)];
        while let Some(next) = stack.pop() {
            let TreeNode::Expr(expression) = next else {
                let is_inner_code = matches!(next, TreeNode::Function(inner) if inner != function);
                if !is_inner_code {
                    push_children(hir, next, &mut stack);
                }
                continue;
            };
            let recorded = match hir[expression].kind {
                ExprKind::Ident(_) => Some(hir[expression].pos),
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => {
                    Some(self.last_mapped_position(obj))
                }
                ExprKind::Call(site) | ExprKind::New(site) | ExprKind::TaggedTemplate(site) => {
                    Some(self.last_mapped_position(hir[site].callee))
                }
                _ => None,
            };
            let first = match recorded {
                Some(position) if position < node.pos => None,
                Some(position) if position < node.end => Some((&mut inside, position)),
                Some(position) => Some((&mut behind, position)),
                None => None,
            };
            if let Some((first, position)) = first {
                *first = Some(first.map_or(position, |first| first.min(position)));
            }
            match hir[expression].kind {
                // A store to a name and an update of one record nothing.
                ExprKind::Assign { target, value, .. } if self.is_name(target) => {
                    stack.push(TreeNode::Expr(value));
                }
                ExprKind::Unary {
                    op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec,
                    operand,
                } if self.is_name(operand) => {}
                _ => push_children(hir, next, &mut stack),
            }
        }
        let rest = has_rest.then_some(mapped);
        let parameters = self.parameters_position(function);
        inside.or(rest).or(behind).unwrap_or(parameters)
    }

    fn is_name(&self, expression: ExprId) -> bool {
        let inner = self.skip_type_syntax(expression);
        matches!(self.hir[inner].kind, ExprKind::Ident(_))
    }
}
