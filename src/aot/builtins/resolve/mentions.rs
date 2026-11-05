use super::SourceDialect;
use super::mention_use::MentionUse;
use super::module_cache::{is_function_that_loader_calls, is_module_cache, is_table_of_loaders};
use super::resolver::{ExprState, ResolvedValue, Resolver};
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinKind, CallsForTexts, Intrinsic,
};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::decorator_metadata::{MetadataReference, entity_names};
use bun_sema::bind::{Binding, FnOwner, ImplicitReference, ImplicitReferenceKind, Parent};
use bun_sema::fold::{Constant, FoldedValue};
use bun_sema::hir::{
    self, BinOp, CallId, ExportSpecId, ExprId, ExprKind, FnKind, MemberKey, PatId, PatKind,
    PropKey, PropKind,
};
use bun_sema::import_sites::ImportSiteKind;
use smallvec::{SmallVec, smallvec};

fn exposes_members(id: BuiltinId) -> bool {
    let members = table::members(id);
    match table::entry(id).kind {
        BuiltinKind::Function | BuiltinKind::Method => members.iter().any(|&member| {
            table::entry(member).kind != BuiltinKind::DataProperty
                || !table::members(member).is_empty()
        }),
        _ => !members.is_empty(),
    }
}

fn makes_require(id: BuiltinId) -> bool {
    table::canonical_id(id) == BuiltinId::NodeModuleCreateRequire
}

#[rustfmt::skip]
#[inline]
pub(super) fn mentioned_id(state: ExprState) -> Option<BuiltinId> {
    let intrinsic = match state {
        ExprState::Builtin(value) | ExprState::Held(value) => return Some(value.path.id),
        ExprState::Intrinsic(intrinsic) => intrinsic,
        ExprState::Unvisited | ExprState::InProgress | ExprState::NotEvaluated
        | ExprState::Unresolved | ExprState::DynamicGlobal(_) => return None,
    };
    match intrinsic {
        Intrinsic::Builtin(id) | Intrinsic::Construct(id) | Intrinsic::NativeBinding(id) => Some(id),
        _ => None,
    }
}

fn implicit_reference_path(
    hir: &hir::File<'_>,
    reference: &ImplicitReference,
) -> SmallVec<[Atom; 4]> {
    match reference.kind {
        ImplicitReferenceKind::DecoratorMetadata(MetadataReference::TypeName(node)) => {
            hir.texts(entity_names(hir, node)).collect()
        }
        _ => smallvec![reference.name],
    }
}

impl Resolver<'_, '_> {
    pub(super) fn collect_exported_symbols(&mut self) {
        if self.facts.is_some() {
            return;
        }
        let input = self.input;
        let specs = (0..input.hir.export_specs.len() as u32).map(ExportSpecId);
        let exported = specs.filter(|&spec| {
            let export = &input.hir[input.hir[spec].export];
            !export.has_module_specifier && !export.type_only && !input.hir[spec].type_only
        });
        let exported = exported.map(|spec| input.bound.exported_binding(spec));
        let implicit = input.bound.runtime.implicit_references().iter();
        for binding in exported.chain(implicit.map(|reference| reference.binding)) {
            match binding {
                Binding::Symbol(symbol) => {
                    self.exported_symbols.insert(symbol);
                }
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {}
            }
        }
    }

    pub(super) fn visit_implicit_references(&mut self) {
        let input = self.input;
        for reference in input.bound.runtime.implicit_references() {
            match reference.binding {
                Binding::Free => {
                    let path = implicit_reference_path(input.hir, reference);
                    if let ExprState::Builtin(value) = self.resolve_global_path(&path) {
                        self.expose(value.path.id);
                    }
                }
                Binding::CommonJs(variable) => self.expose_commonjs_variable(variable),
                Binding::Symbol(_) | Binding::Arguments(_) => {}
            }
        }
    }

    pub(super) fn mention(&mut self, id: BuiltinId) {
        self.output.gets_at_entries_of_module_cache |= is_module_cache(id);
        self.output.mentioned.push(id);
    }

    pub(super) fn expose(&mut self, id: BuiltinId) {
        self.output.called.push(id);
        if makes_require(id) {
            self.output.called.push(BuiltinId::ModuleRequire);
        }
        if table::has_flag(id, BuiltinFlags::IS_GLOBAL_OBJECT) {
            self.output.exposed.push(BuiltinId::GlobalThis);
        } else if exposes_members(id) {
            self.output.exposed.push(id);
        }
    }

    pub(super) fn may_be_global_object(&self, this: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        if hir.is_strict || self.input.dialect != SourceDialect::Program {
            return false;
        }
        let mut parent = bound.parent_of_expr(this);
        loop {
            let function = match parent {
                Parent::Expr(user) => {
                    parent = bound.parent_of_expr(user);
                    continue;
                }
                Parent::Stmt(user) => {
                    parent = bound.parent_of_stmt(user);
                    continue;
                }
                Parent::VarInit(declaration) => {
                    parent = bound.parent_of_stmt(bound.var_stmt[declaration.idx()]);
                    continue;
                }
                Parent::Case(case) => {
                    parent = bound.parent_of_stmt(bound.case_stmt[case.idx()]);
                    continue;
                }
                Parent::Prop(property)
                | Parent::PropKey(property)
                | Parent::MethodKey(property) => {
                    parent = bound.parent_of_expr(bound.prop_owner[property.idx()]);
                    continue;
                }
                Parent::FnBody(function) => function,
                Parent::ParamDefault(parameter) => bound.param_fn[parameter.idx()],
                Parent::None | Parent::File | Parent::MemberInit(_) => return false,
                _ => return true,
            };
            match (hir[function].kind, bound.fns[function.idx()].owner) {
                (FnKind::Arrow, FnOwner::Expr(written)) => parent = bound.parent_of_expr(written),
                (FnKind::Arrow, _) => return true,
                _ => return !hir[function].is_strict,
            }
        }
    }

    fn find_global_read_off(&self, this: ExprId) -> Option<BuiltinId> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let member = self.find_member_of(this)?;
        let (_, MemberKey::Name(name)) = hir.member_key(member)? else {
            return None;
        };
        if bound.is_write_only_access(hir, self.outermost_assertion_of(member)) {
            return None;
        }
        self.find_global(name).map(|global| global.id)
    }

    pub(super) fn find_global_out_of_sight_through(&self, this: ExprId) -> Option<BuiltinId> {
        if !self.may_be_global_object(this) {
            return None;
        }
        match self.classify_use(this) {
            MentionUse::Inspected | MentionUse::Called(_) => None,
            MentionUse::Holder => self.find_global_read_off(this),
            MentionUse::ReadByComputedKey
            | MentionUse::Aliased
            | MentionUse::Destructured(_)
            | MentionUse::Exposed => Some(BuiltinId::GlobalThis),
        }
    }

    pub(super) fn classify_mentions(&mut self) {
        if self.loads_node_module {
            for expr in self.evaluated_exprs() {
                self.classify_mention(expr);
            }
            return;
        }
        for index in 0..self.found_or_this.len() {
            let expr = self.found_or_this[index];
            self.classify_mention(expr);
        }
    }

    fn classify_mention(&mut self, expr: ExprId) {
        let state = match self.state(expr) {
            ExprState::Unresolved if matches!(self.input.hir[expr].kind, ExprKind::This) => {
                if let Some(global) = self.find_global_out_of_sight_through(expr) {
                    self.mention(global);
                    self.expose(global);
                }
                return;
            }
            ExprState::Unresolved => match self.find_made_require(expr) {
                Some(made) => ExprState::Held(made),
                None => return,
            },
            state => state,
        };
        if let ExprState::DynamicGlobal(path) = state {
            self.mention(path.id);
            self.expose(path.id);
            return;
        }
        if let ExprState::Intrinsic(Intrinsic::LinkedFunction(function)) = state {
            self.output.linked_functions.push(function);
            return;
        }
        let Some(id) = mentioned_id(state) else {
            return;
        };
        let makes_value =
            !matches!(state, ExprState::Held(_)) || self.input.hir.member_key(expr).is_some();
        if makes_value && self.is_called_with_other_texts(expr, id) {
            self.output.called_with_other_texts.push(id);
        } else if makes_value {
            self.output.mentioned.push(id);
        }
        if is_module_cache(id) {
            self.note_use_of_module_cache(expr);
        }
        if is_table_of_loaders(id) {
            self.note_use_of_table_of_loaders(expr);
        }
        if is_function_that_loader_calls(id) {
            self.note_use_of_function_that_loader_calls(expr);
        }
        match self.classify_use(expr) {
            MentionUse::Called(call) if self.is_import_site(call) => {}
            MentionUse::Called(call) => {
                self.output.called.push(id);
                if makes_require(id) && self.find_made_require(call).is_none() {
                    self.output.called.push(BuiltinId::ModuleRequire);
                }
            }
            MentionUse::Inspected | MentionUse::Holder | MentionUse::Aliased => {}
            MentionUse::ReadByComputedKey => self.expose(id),
            MentionUse::Exposed => self.expose_to_user(expr, id),
            MentionUse::Destructured(pattern) => {
                match self.value_of(expr).or_else(|| self.held_value_of(expr)) {
                    Some(value) => self.destructure(value, pattern),
                    None => self.expose(id),
                }
            }
        }
    }

    fn find_call_taking_first(&self, operand: ExprId) -> Option<(ExprId, CallId, BuiltinId)> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let Parent::Expr(user) = bound.parent_of_expr(operand) else {
            return None;
        };
        let ExprKind::Call(call) = hir[user].kind else {
            return None;
        };
        if hir.ids(hir[call].args).next() != Some(operand) {
            return None;
        }
        let callee = hir.skip_type_assertions(hir[call].callee);
        let function = mentioned_id(self.state(callee))?;
        Some((user, call, table::canonical_id(function)))
    }

    fn is_answer_dropped(&self, call: ExprId) -> bool {
        matches!(self.classify_use(call), MentionUse::Inspected)
    }

    fn is_only_looked_at(&self, value: ExprId) -> bool {
        let (hir, bound) = (self.input.hir, self.input.bound);
        match self.classify_use(value) {
            MentionUse::Inspected => true,
            MentionUse::Aliased => {
                let Parent::VarInit(declaration) =
                    bound.parent_of_expr(self.outermost_assertion_of(value))
                else {
                    return false;
                };
                let holder = bound.initialized_binding(hir[declaration].pat);
                let mut reads = (0..hir.exprs.len() as u32).map(ExprId).filter(|&read| {
                    matches!(hir[read].kind, ExprKind::Ident(_)) && bound.binding(read) == holder
                });
                matches!(holder, Binding::Symbol(_))
                    && reads.all(|read| self.is_only_looked_at(read))
            }
            MentionUse::Exposed => {
                let operand = self.outermost_assertion_of(value);
                match self.find_call_taking_first(operand) {
                    Some((
                        answer,
                        _,
                        BuiltinId::ObjectGetPrototypeOf | BuiltinId::ReflectGetPrototypeOf,
                    )) => self.is_only_looked_at(answer),
                    Some((_, _, BuiltinId::ReflectSetPrototypeOf)) => {
                        self.input.dialect == SourceDialect::Runtime
                    }
                    Some((answer, _, BuiltinId::ObjectSetPrototypeOf)) => {
                        self.input.dialect == SourceDialect::Runtime
                            && self.is_answer_dropped(answer)
                    }
                    _ => false,
                }
            }
            MentionUse::Holder
            | MentionUse::ReadByComputedKey
            | MentionUse::Called(_)
            | MentionUse::Destructured(_) => false,
        }
    }

    fn hands_holder_to_nobody(&self, descriptor: ExprId) -> bool {
        let hir = self.input.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(descriptor)].kind else {
            return false;
        };
        properties.iter().all(|property| {
            let property = &hir[property];
            let PropKey::Name(name) = property.key else {
                return false;
            };
            let is_accessor = name == known::get || name == known::set;
            match property.kind {
                PropKind::Init if is_accessor => {
                    let function = hir.skip_type_assertions(property.value);
                    matches!(hir[function].kind, ExprKind::Fn(function) if hir[function].kind == FnKind::Arrow)
                }
                PropKind::Init | PropKind::Shorthand | PropKind::Method => !is_accessor,
                PropKind::Spread | PropKind::Getter | PropKind::Setter => false,
            }
        })
    }

    fn expose_to_user(&mut self, object: ExprId, id: BuiltinId) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let operand = self.outermost_assertion_of(object);
        match bound.parent_of_expr(operand) {
            Parent::Expr(user) => {
                if let ExprKind::Binary {
                    op: BinOp::In,
                    left,
                    right,
                } = hir[user].kind
                    && right == operand
                {
                    return self.search_for(object, id, left);
                }
            }
            _ => {}
        }
        let Some((answer, call, function)) = self.find_call_taking_first(operand) else {
            return self.expose(id);
        };
        let mut further = hir.ids(hir[call].args).skip(1);
        let (second, third) = (further.next(), further.next());
        match (function, second, third) {
            (BuiltinId::ObjectGetPrototypeOf | BuiltinId::ReflectGetPrototypeOf, ..)
                if self.is_only_looked_at(answer) => {}
            (BuiltinId::ReflectDefineProperty, Some(key), Some(descriptor))
                if self.hands_holder_to_nobody(descriptor) =>
            {
                self.search_for(object, id, key);
            }
            (BuiltinId::ObjectDefineProperty, Some(key), Some(descriptor))
                if self.is_answer_dropped(answer) && self.hands_holder_to_nobody(descriptor) =>
            {
                self.search_for(object, id, key);
            }
            (BuiltinId::ObjectDefineProperties, Some(descriptors), _)
                if self.is_answer_dropped(answer) =>
            {
                self.search_for_keys_of(object, id, descriptors);
            }
            _ => self.expose(id),
        }
    }

    fn search_for(&mut self, object: ExprId, id: BuiltinId, key: ExprId) {
        let hir = self.input.hir;
        match hir[hir.skip_type_assertions(key)].kind {
            ExprKind::String(name) => self.mention_member(object, name),
            _ => self.expose(id),
        }
    }

    fn search_for_keys_of(&mut self, object: ExprId, id: BuiltinId, descriptors: ExprId) {
        let hir = self.input.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(descriptors)].kind else {
            return self.expose(id);
        };
        let is_written_out = properties.iter().all(|property| {
            let property = &hir[property];
            matches!(property.key, PropKey::Name(_))
                && property.kind == PropKind::Init
                && self.hands_holder_to_nobody(property.value)
        });
        if !is_written_out {
            return self.expose(id);
        }
        for property in properties.iter() {
            if let PropKey::Name(name) = hir[property].key {
                self.mention_member(object, name);
            }
        }
    }

    fn mention_member(&mut self, object: ExprId, name: Atom) {
        let holder = self.value_of(object).or_else(|| self.held_value_of(object));
        if let Some(member) = holder.and_then(|holder| self.find_named_member(holder, name)) {
            self.mention(member.id);
        }
    }

    fn walks_lists_as_the_language_says(&self) -> bool {
        let input = self.input;
        let stays = |id: BuiltinId| {
            table::is_locked(id) && input.replaced.binary_search(&(id as u32)).is_err()
        };
        !input.runs_tests
            && stays(BuiltinId::ArrayPrototypeSymbolIterator)
            && stays(BuiltinId::ArrayIteratorPrototypeNext)
    }

    fn writes_other_text(&self, call: CallId, listed: &CallsForTexts) -> bool {
        let input = self.input;
        let hir = input.hir;
        let position = listed.argument as usize;
        let mut operands_up_to_it = hir.ids(hir[call].args).take(position + 1);
        if operands_up_to_it.any(|operand| matches!(hir[operand].kind, ExprKind::Spread(_))) {
            return false;
        }
        let Some(operand) = hir.ids(hir[call].args).nth(position) else {
            return false;
        };
        let operand = hir.skip_type_assertions(operand);
        let folded = input.decisions.constant(hir, operand);
        let known;
        let values = match &folded {
            FoldedValue::Constant(value) | FoldedValue::ConstantOutsideDeadZone(value) => {
                std::slice::from_ref(value)
            }
            FoldedValue::Unknown if self.walks_lists_as_the_language_says() => {
                known = self.known_set(operand);
                &known[..]
            }
            FoldedValue::Unknown => &[],
        };
        let is_other_text = |value: &Constant| match *value {
            Constant::String(text) => {
                let name = input.names.get(text);
                name.is_none_or(|name| !listed.texts.contains(&name))
            }
            Constant::Undefined
            | Constant::Null
            | Constant::Boolean(_)
            | Constant::Number(_)
            | Constant::BigInt(_) => false,
        };
        !values.is_empty() && values.iter().all(is_other_text)
    }

    fn is_called_with_other_texts(&self, function: ExprId, id: BuiltinId) -> bool {
        let lists = table::entry(table::canonical_id(id)).calls_for_texts();
        if lists.is_empty() {
            return false;
        }
        let MentionUse::Called(call) = self.classify_use(function) else {
            return false;
        };
        let ExprKind::Call(operands) = self.input.hir[call].kind else {
            return false;
        };
        let is_answer_dropped = matches!(self.classify_use(call), MentionUse::Inspected);
        is_answer_dropped
            && lists
                .iter()
                .all(|listed| self.writes_other_text(operands, listed))
    }

    fn is_import_site(&self, call: ExprId) -> bool {
        let sites = [
            ImportSiteKind::Require(call),
            ImportSiteKind::ImportMetaRequire(call),
            ImportSiteKind::GetBuiltinModule(call),
        ];
        sites
            .into_iter()
            .any(|site| self.input.targets.has_site(site))
    }

    fn destructure(&mut self, holder: ResolvedValue, pattern: PatId) {
        let input = self.input;
        let mut work_stack: SmallVec<[(ResolvedValue, PatId); 4]> = SmallVec::new();
        work_stack.push((holder, pattern));
        while let Some((holder, pattern)) = work_stack.pop() {
            let PatKind::Object(props) = input.hir[pattern].kind else {
                continue;
            };
            for prop in props.iter() {
                let prop = &input.hir[prop];
                let PropKey::Name(name) = prop.key else {
                    self.expose(holder.path.id);
                    continue;
                };
                if prop.is_rest {
                    self.expose(holder.path.id);
                    continue;
                }
                if self.is_inherited_object_prototype_member(Some(holder.path.id), name) {
                    self.expose(holder.path.id);
                }
                let Some(member) = self.find_named_member(holder, name) else {
                    continue;
                };
                self.mention(member.id);
                match input.hir[prop.value].kind {
                    PatKind::Ident(_) if self.is_local_alias(prop.value) => {}
                    PatKind::Ident(_) => self.expose(member.id),
                    PatKind::Array(_) => self.expose(member.id),
                    PatKind::Object(_) => {
                        work_stack.push((ResolvedValue::object(member), prop.value));
                    }
                    PatKind::Missing => {}
                }
            }
        }
    }
}
