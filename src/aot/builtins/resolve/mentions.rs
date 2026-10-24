use super::mention_use::MentionUse;
use super::resolver::{ExprState, ResolvedValue, Resolver};
use crate::builtins::table::{
    self, BuiltinFlags, BuiltinId, BuiltinKind, CallsForTexts, Intrinsic,
};
use bun_sema::atom::Atom;
use bun_sema::bind::decorator_metadata::{MetadataReference, entity_names};
use bun_sema::bind::{Binding, ImplicitReference, ImplicitReferenceKind, SymbolId};
use bun_sema::hir::{self, CallId, ExportSpecId, ExprId, ExprKind, PatId, PatKind, PropKey};
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

// A JSX factory and the type names of decorator metadata are read where no expression stands.
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

    pub(super) fn expose(&mut self, id: BuiltinId) {
        self.output.called.push(id);
        // Whoever has it makes a `require` that nobody follows.
        if makes_require(id) {
            self.output.called.push(BuiltinId::ModuleRequire);
        }
        if table::has_flag(id, BuiltinFlags::IS_GLOBAL_OBJECT) {
            self.output.exposed.push(BuiltinId::GlobalThis);
        } else if exposes_members(id) {
            self.output.exposed.push(id);
        }
    }

    pub(super) fn classify_mentions(&mut self) {
        for expr in self.evaluated_exprs() {
            // What `createRequire` has made stands for nothing. What is done with it is done with a `require`.
            let state = match (self.state(expr), self.find_made_require(expr)) {
                (ExprState::Unresolved, Some(made)) => ExprState::Held(made),
                (state, _) => state,
            };
            if let ExprState::DynamicGlobal(path) = state {
                self.output.mentioned.push(path.id);
                self.expose(path.id);
                continue;
            }
            if let ExprState::Intrinsic(Intrinsic::LinkedFunction(function)) = state {
                self.output.linked_functions.push(function);
                continue;
            }
            let Some(id) = mentioned_id(state) else {
                continue;
            };
            // A variable, an assignment and `Object.getPrototypeOf` hand on an object that is there already.
            let makes_value =
                !matches!(state, ExprState::Held(_)) || self.input.hir.member_key(expr).is_some();
            if makes_value && self.is_called_with_other_texts(expr, id) {
                self.output.called_with_other_texts.push(id);
            } else if makes_value {
                self.output.mentioned.push(id);
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
                MentionUse::StoredInto(symbol) if self.holds(symbol, id) => {}
                MentionUse::ReadByComputedKey | MentionUse::StoredInto(_) | MentionUse::Exposed => {
                    self.expose(id)
                }
                MentionUse::SearchedFor(key) => self.search_for(expr, id, key),
                MentionUse::SearchedForKeysOf(keyed) => self.search_for_keys_of(expr, id, keyed),
                MentionUse::Destructured(pattern) => {
                    match self.value_of(expr).or_else(|| self.held_value_of(expr)) {
                        Some(value) => self.destructure(value, pattern),
                        None => self.expose(id),
                    }
                }
            }
        }
    }

    fn writes_other_text(&self, call: CallId, listed: &CallsForTexts) -> bool {
        let hir = self.input.hir;
        let position = listed.argument as usize;
        let mut operands_up_to_it = hir.ids(hir[call].args).take(position + 1);
        if operands_up_to_it.any(|operand| matches!(hir[operand].kind, ExprKind::Spread(_))) {
            return false;
        }
        let Some(operand) = hir.ids(hir[call].args).nth(position) else {
            return false;
        };
        let is_other = |&text: &Atom| {
            self.input
                .names
                .get(text)
                .is_none_or(|text| !listed.texts.contains(&text))
        };
        self.find_texts_of(operand)
            .is_some_and(|texts| texts.iter().all(is_other))
    }

    // `process.on("exit", listener);`: the call itself says that the entry does not call what it calls for some texts alone.
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
        let is_answer_dropped = matches!(self.classify_use(call), MentionUse::Inspected)
            || self.is_dropped_by_for_each(call);
        is_answer_dropped
            && lists
                .iter()
                .all(|listed| self.writes_other_text(operands, listed))
    }

    // The host makes a member when it is first looked for, so `"name" in object` needs what makes the member of that name.
    fn search_for(&mut self, object: ExprId, id: BuiltinId, key: ExprId) {
        let hir = self.input.hir;
        let ExprKind::String(name) = hir[hir.skip_type_assertions(key)].kind else {
            self.expose(id);
            return;
        };
        self.mention_member(object, name);
    }

    // A literal that goes straight into the call has the keys that are written in it, and no others.
    fn search_for_keys_of(&mut self, object: ExprId, id: BuiltinId, keyed: ExprId) {
        let hir = self.input.hir;
        let ExprKind::Object(props) = hir[hir.skip_type_assertions(keyed)].kind else {
            self.expose(id);
            return;
        };
        for prop in props.iter() {
            match hir[prop].key {
                PropKey::Name(name) => self.mention_member(object, name),
                PropKey::None | PropKey::Private(_) | PropKey::Computed(_) => {
                    self.expose(id);
                    return;
                }
            }
        }
    }

    fn mention_member(&mut self, object: ExprId, name: Atom) {
        let holder = self.value_of(object).or_else(|| self.held_value_of(object));
        if let Some(member) = holder.and_then(|holder| self.find_named_member(holder, name)) {
            self.output.mentioned.push(member.id);
        }
    }

    fn holds(&self, symbol: SymbolId, id: BuiltinId) -> bool {
        matches!(self.held.get(&symbol), Some(Some(held)) if held.path.id == id)
    }

    // Whether a binding was found that holds a built-in and was not known to.
    pub(super) fn follow_stored_builtins(&mut self) -> bool {
        let mut has_changed = false;
        for expr in self.evaluated_exprs() {
            let (ExprState::Builtin(value) | ExprState::Held(value)) = self.state(expr) else {
                continue;
            };
            let MentionUse::StoredInto(symbol) = self.classify_use(expr) else {
                continue;
            };
            let value = value.predicted();
            match self.held.get(&symbol) {
                None => {
                    self.held.insert(symbol, Some(value));
                    has_changed = true;
                }
                Some(Some(held)) if held.path.id != value.path.id => {
                    self.held.insert(symbol, None);
                    has_changed = true;
                }
                Some(Some(_) | None) => {}
            }
        }
        has_changed
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
                let Some(member) = self.find_named_member(holder, name) else {
                    continue;
                };
                self.output.mentioned.push(member.id);
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
