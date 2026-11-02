#[cfg(test)]
mod tests;

use bun_ast::Target;
use bun_resolve_builtins::{Alias, Cfg};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, CodeUnit, CommonJsVariable, Parent, ScopeId};
use bun_sema::fold::NamedPath;
use bun_sema::hir::{BinOp, Call, Chain, ExprId, ExprKind, MemberKey, NodeData};
use bun_sema::import_sites::find_own_require;
use smallvec::SmallVec;

use crate::builtins::id::BuiltinId;
use crate::builtins::{Resolved, SourceDialect};
use crate::diagnostic_codes::Code;
use crate::ir::generated::ECMAMode;
use crate::ir::{FunctionKey, ValueId};
use crate::load;
use crate::lower::captures::Capture;
use crate::lower::member::PropertyName;
use crate::lower::module::file_scope;
use crate::lower::scope::{ArgumentsObject, BindingForm, BindingRef, ScopeSlot, Storage};
use crate::lower::{FileLowering, FunctionLowering};

#[derive(Copy, Clone, Debug)]
pub(in crate::lower) struct GlobalPathMember {
    pub(in crate::lower) holder: Option<ValueId>,
    pub(in crate::lower) name: Atom,
}

/// Why the build stops at the name or the path of a define: what the program does with it there.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::lower) enum DefineStop {
    Read,
    Called,
    TypeOf,
    Deleted,
    DeletedInStrictMode,
    StoredTo,
    StoredToInStrictMode,
}

impl FileLowering<'_, '_, '_, '_> {
    // The call that `site` is the callee of, below nothing but type syntax. A tagged template is no such call.
    fn find_call_of_callee(&self, site: ExprId) -> Option<Call> {
        let (hir, bound) = (self.hir, self.bound);
        let mut callee = site;
        while let Parent::Expr(parent) = bound.parent_of_expr(callee)
            && parent.is_some()
        {
            match hir[parent].kind {
                ExprKind::Call(call) => {
                    let call = hir[call];
                    return (call.callee == callee).then_some(call);
                }
                _ if hir.type_assertion_operand(parent) == Some(callee) => callee = parent,
                _ => return None,
            }
        }
        None
    }

    // `site` is the callee of a call that is no `f?.()`.
    fn is_callee_of_call(&self, site: ExprId) -> bool {
        let call = self.find_call_of_callee(site);
        call.is_some_and(|call| call.chain == Chain::No)
    }

    // A call of a name whose define value is `eval` is a direct eval. So is that of a path unless `head` is free, where `bun run` writes `(0, eval)`.
    fn calls_eval_by_name(&self, site: ExprId, names: &[Atom], head: Binding) -> bool {
        let is_name = matches!(self.hir[site].kind, ExprKind::Ident(_));
        let is_written_as_name = is_name || head != Binding::Free;
        names == [known::eval] && is_written_as_name && self.is_callee_of_call(site)
    }

    // `site` is the callee of a call whose one argument is a string that names a built-in module. `require.resolve` answers it without any file.
    fn asks_for_builtin_module(&self, site: ExprId) -> bool {
        let hir = self.hir;
        let call = self.find_call_of_callee(site);
        let Some(call) = call.filter(|call| call.chain == Chain::No) else {
            return false;
        };
        let mut arguments = hir.ids(call.args);
        let (Some(argument), None) = (arguments.next(), arguments.next()) else {
            return false;
        };
        let ExprKind::String(name) = hir[self.skip_type_syntax(argument)].kind else {
            return false;
        };
        let name = self.queries.atom_bytes(name);
        Alias::get(name, Target::Bun, Cfg::default()).is_some_and(|alias| alias.node_builtin)
    }

    // The first name of `named` is the `require` of the file, or a variable that is initialized with a `require` whose calls the build follows.
    fn holds_require(&self, named: &NamedPath<'_>) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let symbol = match named.head.binding {
            Binding::CommonJs(CommonJsVariable::Require) => return true,
            Binding::Symbol(symbol) => symbol,
            Binding::CommonJs(_) | Binding::Arguments(_) | Binding::Free => return false,
        };
        let is_settled =
            bound.is_stable_binding(symbol) && bound.dynamic_scope_of(&named.head).is_none();
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(source) if is_settled => {
                find_own_require(hir, bound, Some(self.decisions()), source).is_some()
            }
            _ => false,
        }
    }

    // `named` is below `module.require`, or `resolve`, `call` or `apply` of a `require`: a call of it takes a file and is no import site.
    fn calls_require_of_file(&self, site: ExprId, named: &NamedPath<'_>) -> bool {
        match (named.head.binding, named.names) {
            (Binding::CommonJs(CommonJsVariable::Module), [_, known::require, _, ..]) => {
                self.is_commonjs_module()
            }
            (_, [_, known::resolve]) => {
                self.holds_require(named) && !self.asks_for_builtin_module(site)
            }
            (_, [_, known::call | known::apply]) => self.holds_require(named),
            _ => false,
        }
    }

    // Whether `bun run` may print what a define gives `site` as the callee of a call, as it prints `a` of `(0, a)`, `1 && a` or `[a][0]` there.
    fn may_be_printed_as_callee(&self, site: ExprId) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut child = site;
        while let Parent::Expr(parent) = bound.parent_of_expr(child)
            && parent.is_some()
        {
            match hir[parent].kind {
                ExprKind::Call(call) => return hir[call].callee == child,
                ExprKind::Binary {
                    op: BinOp::Comma | BinOp::And | BinOp::Or | BinOp::Nullish,
                    right,
                    ..
                } if right == child => {}
                ExprKind::Cond { test, .. } if test != child => {}
                ExprKind::Index { obj, .. } if obj == child => {}
                ExprKind::Array(_) => {}
                _ if hir.type_assertion_operand(parent) == Some(child) => {}
                _ => return false,
            }
            child = parent;
        }
        false
    }

    // `name` is what the file calls `feature` of "bun:bundle".
    fn imports_feature_flag_as(&self, name: Atom) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        hir.imports.iter().any(|import| {
            import.spec == known::bun_bundle
                && !import.type_only
                && bound.parent_of_stmt(import.stmt) == Parent::File
                && import.named.iter().any(|specifier| {
                    let specifier = hir[specifier];
                    !specifier.type_only
                        && specifier.imported == known::feature
                        && specifier.local == name
                })
        })
    }

    // `bun run` answers a call of `feature` of "bun:bundle" itself. The binder steps over that import, so only a call tells it from a global.
    fn calls_feature_flag(&self, site: ExprId, names: &[Atom]) -> bool {
        let &[name] = names else {
            return false;
        };
        self.may_be_printed_as_callee(site) && self.imports_feature_flag_as(name)
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn lower_global_path(&mut self, expression: ExprId, path: &[Atom]) -> ValueId {
        // The callee of `(0, NAME)()` is read here, and `bun run` calls what a define gives NAME.
        if self.file.calls_feature_flag(expression, path) {
            self.report_define_stop(expression, path, DefineStop::Called);
        }
        match self.file.builtins.of_pure_expr(expression) {
            Some(Resolved::Builtin(builtin)) if builtin.locked_builtin().is_some() => {
                self.emit_locked_builtin(builtin.id)
            }
            Some(Resolved::Builtin(_) | Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_))
            | None => {
                let member = self.lower_global_path_holder(path);
                let value = self.emit_global_path_member(member.holder, member.name);
                self.expect_resolved_path(expression, value)
            }
        }
    }

    pub(in crate::lower) fn lower_global_path_holder(&mut self, path: &[Atom]) -> GlobalPathMember {
        let (&name, holders) = path.split_last().expect("a global path names a global");
        let mut holder = None;
        for &holder_name in holders {
            holder = Some(self.emit_global_path_member(holder, holder_name));
        }
        GlobalPathMember { holder, name }
    }

    pub(super) fn lower_named_path(
        &mut self,
        expression: ExprId,
        named: &NamedPath<'_>,
    ) -> ValueId {
        let stop = self.find_define_stop(expression, named, DefineStop::Read);
        if stop.is_some() {
            self.report_define_without_support(expression, named, DefineStop::Read);
            return self.builder.undefined();
        }
        let member = self.lower_named_path_holder(named);
        match member.holder {
            Some(holder) => self.emit_global_path_member(Some(holder), member.name),
            None => self.get_define_head(named),
        }
    }

    /// `lower_global_path_holder` for a path whose first name the binder found where the define applies. A path of one name has no holder.
    pub(in crate::lower) fn lower_named_path_holder(
        &mut self,
        named: &NamedPath<'_>,
    ) -> GlobalPathMember {
        let (&name, holders) = named
            .names
            .split_last()
            .expect("a named path has a first name");
        let Some((_, members)) = holders.split_first() else {
            return GlobalPathMember { holder: None, name };
        };
        let mut holder = self.get_define_head(named);
        for &member in members {
            holder = self.emit_global_path_member(Some(holder), member);
        }
        GlobalPathMember {
            holder: Some(holder),
            name,
        }
    }

    /// The first name of `named` where the define applies, read from the `with` object or evaluated text that has the name, else through its binding.
    pub(in crate::lower) fn get_define_head(&mut self, named: &NamedPath<'_>) -> ValueId {
        let head = named.head;
        if let Some(value) = self.get_dynamic_define_head(&head) {
            return value;
        }
        let binding = head.binding;
        match binding {
            // As `read_identifier` does: the type of `const zero = 0` does not say that it holds the integer. The read stays for its dead zone.
            Binding::Symbol(symbol) if self.file.is_constant_zero(symbol) => {
                self.get_binding_without_expression(binding, head.name);
                self.builder.integer(0)
            }
            Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
                self.get_binding_without_expression(binding, head.name)
            }
        }
    }

    // The scope walk plans where a binding is kept from the identifiers that name it, and no identifier spells the first name of a define.
    fn reaches_define_head(&self, named: &NamedPath<'_>) -> bool {
        let file = &*self.file;
        let (hir, bound, plan) = (file.hir, file.bound, &file.scopes);
        let stored = match named.head.binding {
            Binding::Free => return true,
            Binding::Arguments(CodeUnit::File) if !plan.has_wrapper_parameters() => return true,
            Binding::Arguments(unit) => {
                BindingRef::Slot(bound.top_scope(hir, unit), ScopeSlot::ArgumentsBinding)
            }
            Binding::CommonJs(_) if !plan.has_wrapper_parameters() => return true,
            Binding::CommonJs(variable) => {
                let slot = match plan.arguments_object(CodeUnit::File) {
                    ArgumentsObject::Mapped => ScopeSlot::Arguments,
                    ArgumentsObject::None | ArgumentsObject::Unmapped => {
                        ScopeSlot::CommonJs(variable)
                    }
                };
                BindingRef::Slot(file_scope(file), slot)
            }
            Binding::Symbol(symbol) => match plan.form(symbol) {
                // The body of the file keeps its copy of such an import to itself where the walk found no other function that names the import.
                BindingForm::Import => {
                    let is_copy_of_body = plan.imported_copies_of_body().contains(&symbol);
                    let local = self.scopes.find_local(BindingRef::Symbol(symbol));
                    return !is_copy_of_body || local.is_some();
                }
                BindingForm::Callee { function } => {
                    BindingRef::Slot(bound.fns[function.idx()].scope, ScopeSlot::Callee)
                }
                BindingForm::MappedArgument { unit, .. } => {
                    BindingRef::Slot(bound.top_scope(hir, unit), ScopeSlot::Arguments)
                }
                // No value is kept for a dropped import, and the binder finds no member of a namespace or of an enum for the first name of a define.
                BindingForm::NotAValue | BindingForm::ContainerMember { .. } => return false,
                BindingForm::Stored if plan.is_initialized_holder(self.key, symbol) => return true,
                BindingForm::Stored => BindingRef::Symbol(symbol),
            },
        };
        self.reaches_stored(stored)
    }

    // Whether `get_stored` finds the binding: a local, a capture, a variable of the module, or an environment that the function made or captured.
    fn reaches_stored(&self, binding: BindingRef) -> bool {
        if self.scopes.find_local(binding).is_some() {
            return true;
        }
        let captures = self.file.scopes.captures(self.key);
        if captures.binary_search(&Capture::Value(binding)).is_ok() {
            return true;
        }
        let placement = self.file.scopes.placement(binding);
        match placement.map(|placement| placement.storage) {
            Some(Storage::Variable(_)) => true,
            Some(Storage::Field { scope, .. }) => {
                self.runs_code_of_scope(scope)
                    || captures.binary_search(&Capture::Environment(scope)).is_ok()
            }
            Some(Storage::Local) | None => false,
        }
    }

    // The scope belongs to the code that this function runs: the function has entered it wherever that code names what the scope declares.
    fn runs_code_of_scope(&self, scope: ScopeId) -> bool {
        match (self.file.bound.code_unit(scope), self.key) {
            (CodeUnit::File, FunctionKey::ModuleBody(_) | FunctionKey::WrappedModuleBody(_)) => {
                true
            }
            (CodeUnit::Function(function), FunctionKey::Source(source)) => {
                source.function == function
            }
            _ => false,
        }
    }

    // The functions of Bun's own modules are created in the scope of the global object, below the `let` and `const` bindings of scripts, so a script that declares `let process` does not shadow the global there.
    fn sees_script_bindings(&self) -> bool {
        match self.file.source.dialect() {
            SourceDialect::Program => true,
            SourceDialect::Runtime => false,
        }
    }

    pub(in crate::lower) fn emit_free_name_get(
        &mut self,
        name: Atom,
        is_for_type_of: bool,
    ) -> ValueId {
        if !is_for_type_of {
            self.report_global_without_support(name);
        }
        let key = self.file.atom_key(name);
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis, false);
        self.builder
            .prop_get(global, key, is_free_name, is_for_type_of)
    }

    fn report_global_without_support(&mut self, name: Atom) {
        let text = self.file.queries.atom_bytes(name);
        if text == b"ShadowRealm" && self.sees_script_bindings() {
            let span = self.file.span_at(self.position());
            self.file
                .diagnostics
                .report(Code::ShadowRealmIsAbsent, span, &[]);
        }
    }

    /// The stop where the program does `usage` with `site`, to which a define gives `named`. `None`: the first name is used through its binding.
    pub(in crate::lower) fn find_define_stop(
        &self,
        site: ExprId,
        named: &NamedPath<'_>,
        usage: DefineStop,
    ) -> Option<DefineStop> {
        let file = &*self.file;
        match (usage, named.head.binding, named.names) {
            (DefineStop::Called, ..)
                if file.calls_eval_by_name(site, named.names, named.head.binding)
                    || file.calls_require_of_file(site, named) =>
            {
                Some(DefineStop::Called)
            }
            (DefineStop::Read | DefineStop::Called, Binding::Free, names)
                if file.calls_feature_flag(site, names) =>
            {
                Some(DefineStop::Called)
            }
            // What a file has under one of the five names of CommonJS goes by the stores that its text spells.
            (DefineStop::StoredTo, Binding::CommonJs(_), [_]) => Some(DefineStop::StoredTo),
            // In strict code a store to `eval` or to `arguments` and `delete` of a name are SyntaxErrors under `bun run`: nothing of the file runs.
            (DefineStop::StoredTo, _, [known::eval | known::arguments])
                if self.mode() == ECMAMode::Strict =>
            {
                Some(DefineStop::StoredToInStrictMode)
            }
            (DefineStop::Deleted, _, [_]) if self.mode() == ECMAMode::Strict => {
                Some(DefineStop::DeletedInStrictMode)
            }
            _ => self.find_stop_at_use_of_define_head(named, usage),
        }
    }

    // The function cannot reach what the first name is bound to: the scope walk plans that from what the code names.
    fn find_stop_at_use_of_define_head(
        &self,
        named: &NamedPath<'_>,
        usage: DefineStop,
    ) -> Option<DefineStop> {
        let reads_head = matches!(
            usage,
            DefineStop::Read | DefineStop::TypeOf | DefineStop::Called
        );
        (reads_head && !self.reaches_define_head(named)).then_some(usage)
    }

    // The program does `usage` with `site`, which a define replaces with `named`. The message names what `find_define_stop` finds, else `usage`.
    pub(in crate::lower) fn report_define_without_support(
        &mut self,
        site: ExprId,
        named: &NamedPath<'_>,
        usage: DefineStop,
    ) {
        let stop = self.find_define_stop(site, named, usage).unwrap_or(usage);
        self.report_define_stop(site, named.names, stop);
    }

    /// `find_define_stop` for a callee whose define has `Decision::GlobalPath`: the stops of a call that stay where the first name is free too.
    pub(in crate::lower) fn report_eval_called_through_define(
        &mut self,
        site: ExprId,
        path: &[Atom],
    ) {
        let file = &*self.file;
        if file.calls_eval_by_name(site, path, Binding::Free) || file.calls_feature_flag(site, path)
        {
            self.report_define_stop(site, path, DefineStop::Called);
        }
    }

    // The message shows the define as a command line has it, `key=value`: the key is read off `site`, and `names` is the value.
    pub(in crate::lower) fn report_define_stop(
        &mut self,
        site: ExprId,
        names: &[Atom],
        stop: DefineStop,
    ) {
        let file = &mut *self.file;
        // `bun run` applies no define to evaluated text, which stays with the interpreter where the fold has replaced an expression of it.
        if file.inputs.sources.kind(file.file) == load::SourceKind::EvaluatedText {
            return;
        }
        let hir = file.hir;
        let mut key: SmallVec<[&[u8]; 4]> = SmallVec::new();
        let mut root = file.skip_type_syntax(site);
        while let Some((object, MemberKey::Name(name))) = hir.member_key(root) {
            key.push(file.queries.atom_bytes(name));
            root = file.skip_type_syntax(object);
        }
        let root: &[u8] = match hir[root].kind {
            ExprKind::Ident(name) => file.queries.atom_bytes(name),
            _ => b"import.meta",
        };
        key.push(root);
        key.reverse();
        let key = key.join(&b'.');
        let value: SmallVec<[&[u8]; 4]> = (names.iter())
            .map(|&name| file.queries.atom_bytes(name))
            .collect();
        let value = value.join(&b'.');
        let reason: &[u8] = match stop {
            DefineStop::Read => b"is read",
            DefineStop::Called => b"is called",
            DefineStop::TypeOf => b"is an operand of typeof",
            DefineStop::Deleted => b"is deleted",
            DefineStop::DeletedInStrictMode => b"is deleted in strict mode",
            DefineStop::StoredTo => b"is stored to",
            DefineStop::StoredToInStrictMode => b"is stored to in strict mode",
        };
        let option = [
            b"--define ".as_slice(),
            key.as_slice(),
            b"=",
            value.as_slice(),
            b" where ",
            key.as_slice(),
            b" ",
            reason,
        ]
        .concat();
        let span = file.span_of(NodeData::Expr(site));
        file.diagnostics
            .report(Code::UnsupportedOption, span, &[&option]);
    }

    pub(in crate::lower) fn emit_free_name_set(&mut self, name: Atom, value: ValueId) {
        let key = self.file.atom_key(name);
        let mode = self.mode();
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis, false);
        self.file.fragment.note_write(key);
        self.builder
            .prop_set(global, key, mode, value, is_free_name);
    }

    pub(in crate::lower) fn emit_free_name_delete(&mut self, name: Atom) -> ValueId {
        let key = self.file.atom_key(name);
        let mode = self.mode();
        let is_free_name = self.sees_script_bindings();
        let global = self.builder.builtin(BuiltinId::GlobalThis, false);
        self.builder.prop_delete(global, key, mode, is_free_name)
    }

    fn emit_global_path_member(&mut self, holder: Option<ValueId>, name: Atom) -> ValueId {
        match holder {
            Some(holder) => {
                let key = self.file.atom_key(name);
                self.emit_get(holder, PropertyName::Constant(key))
            }
            None => self.emit_free_name_get(name, false),
        }
    }
}
