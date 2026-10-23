use super::text::Text;
use super::{Access, AccessKind, StoredValue};
use crate::builtins::id::BuiltinId;
use crate::known_helpers::{Helper, Quiet};
use crate::modules::ModuleRef;
use crate::modules::requests::ScannedSite;
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{
    Binding, BindingInitializer, BindingKind, CodeUnit, CommonJsVariable, Decl, Parent, SymbolId,
};
use bun_sema::fold::Constant;
use bun_sema::hir::{
    BinOp, CallId, Chain, ExprId, ExprKind, Flags, FnBody, FnId, PatKind, PropKey, PropKind,
    StmtId, StmtKind, UnOp, VarDeclId,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::util::SharedSort;

/// How the text names the exports of its module.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum MentionKind {
    /// `exports`, `this` of the body, or another name for either: the object that the module was born with.
    FirstObject,
    /// Written `module.exports`: what the module has there at that time.
    ModuleExports,
}

#[derive(Copy, Clone, Debug)]
struct Mention {
    node: ExprId,
    kind: MentionKind,
    /// The name `exports` itself, which a store can give another value.
    is_exports_name: bool,
}

/// A place that gives the module a name.
#[derive(Copy, Clone, Debug)]
pub(super) struct Creation {
    pub name: Atom,
    /// The assignment, the call of `Object.defineProperty`, or the value of a property of a literal.
    pub node: ExprId,
    pub value: StoredValue,
    pub value_node: ExprId,
    pub is_in_order: bool,
    /// Nothing gets to the place once the body has ended.
    pub is_run_by_body_alone: bool,
    /// A loop over the object sees the name.
    pub is_enumerable: bool,
    /// No store replaces what the place defines.
    pub is_read_only: bool,
    pub start: u32,
    pub end: u32,
}

/// What a name stands for that has no variable of its own.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum AliasTarget {
    /// What another module has under a name.
    Member { module: ModuleRef, name: Atom },
    /// A binding of the top level of the file.
    Binding(SymbolId),
}

#[derive(Copy, Clone, Debug)]
pub(super) struct Alias {
    pub name: Atom,
    pub target: AliasTarget,
    /// The call that defines it.
    pub node: ExprId,
    /// What a binding holds.
    pub value: StoredValue,
    pub is_enumerable: bool,
    pub start: u32,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Form {
    /// No use of the object in the text of the module: a variable for each name.
    Names,
    /// One variable holds `module.exports`.
    Value,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Marker {
    /// The text never gives the module an `__esModule`.
    Absent,
    /// Once, in order, a true constant.
    True {
        start: u32,
    },
    Unknown,
}

pub(super) struct OwnText {
    pub module: ModuleRef,
    /// Somebody may look at the module while its body runs.
    pub is_half: bool,
    pub form: Form,
    /// Why the form is `Value`. No expression: the file as a whole.
    pub reason: Option<ExprId>,
    pub accesses: Vec<Access>,
    /// In the order in which the body gets to them; those that a function makes come last.
    pub creations: Vec<Creation>,
    pub aliases: Vec<Alias>,
    /// The calls of `Object.defineProperty` that are one store, with the name.
    pub defined_values: Vec<(ExprId, Atom)>,
    /// The calls and stores that only say that the module has an `__esModule`.
    pub marker_nodes: Vec<ExprId>,
    pub erased: Vec<StmtId>,
    pub marker: Marker,
    /// The text stores to one of the five names, names `arguments` at the top, or shows its scope to `eval` or `with`.
    pub needs_wrapped_body: bool,
    /// `module` goes somewhere as a value.
    pub uses_module_object: bool,
}

impl OwnText {
    fn new(module: ModuleRef, is_half: bool) -> OwnText {
        OwnText {
            module,
            is_half,
            form: Form::Names,
            reason: None,
            accesses: Vec::new(),
            creations: Vec::new(),
            aliases: Vec::new(),
            defined_values: Vec::new(),
            marker_nodes: Vec::new(),
            erased: Vec::new(),
            marker: Marker::Absent,
            needs_wrapped_body: false,
            uses_module_object: false,
        }
    }

    fn keep_object(&mut self, at: ExprId) {
        if self.form != Form::Value {
            self.form = Form::Value;
            self.reason = at.some();
        }
    }

    /// The names are variables.
    pub(super) fn has_names(&self) -> bool {
        self.form == Form::Names
    }

    pub(super) fn creations_of(&self, name: Atom) -> impl Iterator<Item = &Creation> {
        self.creations
            .iter()
            .filter(move |creation| creation.name == name)
    }

    pub(super) fn alias_of(&self, name: Atom) -> Option<&Alias> {
        self.aliases.iter().find(|alias| alias.name == name)
    }

    /// Whoever finds the body run to its end finds the name.
    pub(super) fn always_creates(&self, name: Atom) -> bool {
        self.creations_of(name).any(|creation| creation.is_in_order)
            || self.alias_of(name).is_some()
    }

    /// The text says which names the module has once its body has run to its end.
    pub(super) fn knows_all_names(&self) -> bool {
        self.form == Form::Names
            && self
                .creations
                .iter()
                .all(|creation| self.always_creates(creation.name))
    }
}

#[derive(Copy, Clone, Debug)]
enum Replaced {
    /// `{ a, b: e, c() {} }`
    Literal(ExprId),
    Other,
}

// `module.exports = e`
#[derive(Copy, Clone, Debug)]
struct Replacement {
    /// The outermost assignment of the statement.
    statement: ExprId,
    is_statement_in_order: bool,
    /// `exports = module.exports = e`: the name goes along.
    renames_exports: bool,
    replaced: Replaced,
}

struct Draft {
    body: CodeUnit,
    found: OwnText,
    mentions: Vec<Mention>,
    replacements: Vec<Replacement>,
    /// The targets of stores to the name `exports`.
    stores_to_exports_name: Vec<ExprId>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Parameter {
    Exports,
    Module,
}

/// The callback of `__commonJS(cb)` that is a module of its own.
#[derive(Copy, Clone, Debug)]
pub(super) struct InnerBody {
    /// `require_x`
    pub holder: SymbolId,
    pub callback: FnId,
    pub exports_parameter: Option<SymbolId>,
    /// It occurs only as `module.exports`.
    pub module_parameter: Option<SymbolId>,
}

pub(super) struct ScanInput<'t, 'a, 's> {
    pub text: &'t Text<'a, 's>,
    pub sites: &'t [ScannedSite],
    pub inner_modules: &'t [InnerBody],
    /// The file itself is a CommonJS module whose exports the build may keep in variables.
    pub is_file_a_module: bool,
    /// The host may ask what the file exports.
    pub is_entry_point: bool,
    pub half: &'t dyn Fn(ModuleRef) -> bool,
    /// The helper of a compiler that a callee is whenever the call runs.
    pub certain_helper: &'t dyn Fn(ExprId) -> Option<Helper>,
}

struct Scan<'t, 'a, 's> {
    input: &'t ScanInput<'t, 'a, 's>,
    text: &'t Text<'a, 's>,
    may_replace_require: bool,
    drafts: Vec<Draft>,
    /// The parameters of the callbacks of inner modules, with the index of the draft.
    parameters: Vec<(SymbolId, usize, Parameter)>,
}

struct RequiredModule {
    module: ModuleRef,
    /// The call that evaluates it.
    site: ExprId,
}

#[derive(Copy, Clone)]
enum DefinedPart {
    Value(ExprId),
    /// A getter that does nothing but return this expression.
    Getter(ExprId),
}

struct Defined {
    part: DefinedPart,
    is_enumerable: bool,
    is_writable: bool,
}

impl Scan<'_, '_, '_> {
    fn found(&mut self, index: usize) -> &mut OwnText {
        &mut self.drafts[index].found
    }

    fn module_of_call(&self, call: ExprId) -> Option<ModuleRef> {
        let text = self.text;
        let ExprKind::Call(id) = text.hir[call].kind else {
            return None;
        };
        if text.is_call_of_free_require(call) {
            if self.may_replace_require {
                return None;
            }
            let site = text.analysis.import_site_of_call(call)?;
            let is_require = matches!(
                text.analysis.import_sites[site].kind,
                ImportSiteKind::Require(_)
            );
            return match &self.input.sites[site] {
                ScannedSite::Module(module) if is_require => Some(*module),
                _ => None,
            };
        }
        // `require_x()`
        let callee = text.hir.skip_type_assertions(text.hir[id].callee);
        let is_plain = matches!(text.hir[callee].kind, ExprKind::Ident(_))
            && text.hir[id].chain == Chain::No
            && text.hir[id].args.is_empty();
        if !is_plain || self.input.inner_modules.is_empty() {
            return None;
        }
        let Binding::Symbol(holder) = text.bound.binding(callee) else {
            return None;
        };
        let mut inner_modules = self.input.inner_modules.iter();
        let inner = inner_modules.find(|inner| inner.holder == holder)?;
        Some(ModuleRef::Inner {
            file: text.file,
            callback: inner.callback,
        })
    }

    // `require(K)`, or a name that holds it and nothing else.
    fn find_required_module(&self, expression: ExprId) -> Option<RequiredModule> {
        let text = self.text;
        let expression = text.hir.skip_type_assertions(expression);
        let site = match text.hir[expression].kind {
            ExprKind::Call(_) => expression,
            ExprKind::Ident(_) => {
                let Binding::Symbol(symbol) = text.bound.binding(expression) else {
                    return None;
                };
                if !text.bound.is_stable_binding(symbol) {
                    return None;
                }
                match text.bound.binding_initializer(text.hir, symbol) {
                    BindingInitializer::Expression(value) => text.hir.skip_type_assertions(value),
                    _ => return None,
                }
            }
            _ => return None,
        };
        let module = self.module_of_call(site)?;
        Some(RequiredModule { module, site })
    }

    fn add_creation(&mut self, index: usize, name: Atom, node: ExprId, value_node: ExprId) {
        let text = self.text;
        let body = self.drafts[index].body;
        let creation = Creation {
            name,
            node,
            value: value_node
                .some()
                .map_or(StoredValue::Unknown, |value| text.classify_value(value)),
            value_node,
            is_in_order: text.is_in_order(node, body),
            is_run_by_body_alone: text.is_run_by_body_alone(node, body),
            is_enumerable: true,
            is_read_only: false,
            start: text.hir[node].pos,
            end: text.hir[node].end,
        };
        self.found(index).creations.push(creation);
    }

    fn add_access(&mut self, index: usize, access: Access) {
        self.found(index).accesses.push(access);
        match access.kind {
            AccessKind::Store(value) => {
                // The value is evaluated before the store.
                match self.text.find_assignment(access.node) {
                    Some((assignment, value_node)) => {
                        self.add_creation(index, access.name, assignment, value_node);
                    }
                    None => self.add_creation(index, access.name, access.node, ExprId::NONE),
                }
                if let Some(creation) = self.found(index).creations.last_mut() {
                    creation.value = value;
                }
            }
            AccessKind::Update => {
                self.add_creation(index, access.name, access.node, ExprId::NONE);
                if let Some(creation) = self.found(index).creations.last_mut() {
                    // Nothing that can be called.
                    creation.value = StoredValue::IgnoresThis;
                }
            }
            AccessKind::Choice(value) => {
                self.add_creation(index, access.name, access.node, ExprId::NONE);
                if let Some(creation) = self.found(index).creations.last_mut() {
                    creation.value = value;
                    creation.is_in_order = false;
                }
            }
            AccessKind::Read | AccessKind::Call => {}
        }
    }

    fn find_returned_expression(&self, getter: ExprId) -> Option<ExprId> {
        let hir = self.text.hir;
        let ExprKind::Fn(function) = hir[hir.skip_type_assertions(getter)].kind else {
            return None;
        };
        let function = hir[function];
        if !function.params.is_empty() || function.flags.intersects(Flags::ASYNC | Flags::GENERATOR)
        {
            return None;
        }
        match function.body {
            FnBody::Expr(returned) => Some(returned),
            FnBody::Block(statements) if statements.len() == 1 => {
                match hir[hir.id_at::<StmtId>(statements, 0)].kind {
                    StmtKind::Return(returned) => returned.some(),
                    _ => None,
                }
            }
            FnBody::Block(_) | FnBody::None => None,
        }
    }

    // What ToPropertyDescriptor reads from an object literal.
    fn find_defined(&self, descriptor: ExprId) -> Option<Defined> {
        let text = self.text;
        let hir = text.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(descriptor)].kind else {
            return None;
        };
        let flag = |value: ExprId| match text.constant(value)? {
            Constant::Boolean(flag) => Some(flag),
            Constant::Undefined | Constant::Null => Some(false),
            Constant::Number(_) | Constant::String(_) | Constant::BigInt(_) => None,
        };
        let (mut part, mut is_enumerable, mut is_writable) = (None, false, false);
        for property in properties.iter().map(|id| hir[id]) {
            let PropKey::Name(name) = property.key else {
                return None;
            };
            let found = match (text.atoms.bytes(name), property.kind) {
                (b"value", PropKind::Init | PropKind::Shorthand) => {
                    DefinedPart::Value(property.value)
                }
                (b"get", PropKind::Init | PropKind::Method) => {
                    DefinedPart::Getter(self.find_returned_expression(property.value)?)
                }
                (b"enumerable", PropKind::Init) => {
                    is_enumerable = flag(property.value)?;
                    continue;
                }
                (b"writable", PropKind::Init) => {
                    is_writable = flag(property.value)?;
                    continue;
                }
                (b"configurable", PropKind::Init) => {
                    flag(property.value)?;
                    continue;
                }
                _ => return None,
            };
            if part.replace(found).is_some() {
                return None;
            }
        }
        let part = part?;
        // A getter with `writable` is a TypeError.
        if is_writable && matches!(part, DefinedPart::Getter(_)) {
            return None;
        }
        Some(Defined {
            part,
            is_enumerable,
            is_writable,
        })
    }

    // A binding that the body of the file declares at its top. It has a variable, which every file can read.
    fn find_binding_alias(&self, index: usize, returned: ExprId) -> Option<AliasTarget> {
        let text = self.text;
        let Binding::Symbol(symbol) = text.bound.binding(returned) else {
            return None;
        };
        let is_declared_at_top = self.drafts[index].body == CodeUnit::File
            && text.bound.symbol_scope(symbol) == text.bound.top_scope(text.hir, CodeUnit::File);
        let has_variable = matches!(
            text.bound.binding_kind(symbol),
            BindingKind::Var
                | BindingKind::Let
                | BindingKind::Const
                | BindingKind::Class
                | BindingKind::Function
        );
        // An ES importer holds what the getter answered when the file was linked. Nobody can tell where nothing stores again.
        let is_stable = text.bound.is_stable_binding(symbol);
        (is_declared_at_top && has_variable && is_stable && text.bound.has_runtime_value(symbol))
            .then_some(AliasTarget::Binding(symbol))
    }

    // What a getter stands for that does nothing but return `returned`.
    fn find_alias_target(
        &self,
        index: usize,
        returned: ExprId,
        definition: ExprId,
    ) -> Option<AliasTarget> {
        let text = self.text;
        let hir = text.hir;
        let returned = hir.skip_type_assertions(returned);
        if matches!(hir[returned].kind, ExprKind::Ident(_)) {
            return self.find_binding_alias(index, returned);
        }
        let (object, key) = hir.member_key(returned)?;
        let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = hir[returned].kind
        else {
            return None;
        };
        let name = text
            .name_of_key(key)
            .filter(|&name| text.can_name_variable(name))?;
        // A call that is written in the getter runs when the getter does.
        let object = hir.skip_type_assertions(object);
        if chain != Chain::No || !matches!(hir[object].kind, ExprKind::Ident(_)) {
            return None;
        }
        let required = self.find_required_module(object)?;
        // The name holds the module from its `require` on, and a read in front of that throws.
        let is_loaded_before = text.is_in_order(required.site, self.drafts[index].body)
            && hir[required.site].end <= hir[definition].pos;
        is_loaded_before.then_some(AliasTarget::Member {
            module: required.module,
            name,
        })
    }

    fn add_alias(
        &mut self,
        index: usize,
        name: Atom,
        target: AliasTarget,
        node: ExprId,
        returned: ExprId,
        is_enumerable: bool,
    ) {
        let start = self.text.hir[node].pos;
        let value = match target {
            AliasTarget::Binding(_) => self.text.classify_value(returned),
            AliasTarget::Member { .. } => StoredValue::Unknown,
        };
        self.found(index).aliases.push(Alias {
            name,
            target,
            node,
            value,
            is_enumerable,
            start,
        });
    }

    // `Object.defineProperty(exports, "name", { .. })` as a statement that every run of the body passes.
    fn add_definition(&mut self, index: usize, object: ExprId, call_node: ExprId) -> bool {
        let text = self.text;
        let hir = text.hir;
        let body = self.drafts[index].body;
        let ExprKind::Call(call) = hir[call_node].kind else {
            return false;
        };
        let call = hir[call];
        let callee = text
            .builtins
            .builtin_of_expression(hir.skip_type_assertions(call.callee));
        let defines_property = matches!(
            callee,
            Some(BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty)
        );
        if !defines_property
            || call.args.len() != 3
            || hir.id_at::<ExprId>(call.args, 0) != object
            || !text.is_statement_in_order(call_node, body)
        {
            return false;
        }
        let name = text.constant_name(hir.id_at(call.args, 1));
        let Some(name) = name.filter(|&name| text.can_name_variable(name)) else {
            return false;
        };
        let Some(defined) = self.find_defined(hir.id_at(call.args, 2)) else {
            return false;
        };
        match defined.part {
            DefinedPart::Value(value) => {
                self.add_creation(index, name, call_node, value);
                if let Some(creation) = self.found(index).creations.last_mut() {
                    creation.is_enumerable = defined.is_enumerable;
                    creation.is_read_only = !defined.is_writable;
                }
                self.found(index).defined_values.push((call_node, name));
            }
            DefinedPart::Getter(returned) => {
                let Some(target) = self.find_alias_target(index, returned, call_node) else {
                    return false;
                };
                self.add_alias(
                    index,
                    name,
                    target,
                    call_node,
                    returned,
                    defined.is_enumerable,
                );
                self.found(index)
                    .erased
                    .extend(text.statement_of(call_node));
            }
        }
        true
    }

    // `_export(exports, { name: function () { return e; }, .. })` as a statement that every run of the body passes: the helper defines an enumerable getter for each name of the literal, in the order in which they are written.
    fn add_definitions_of_helper(
        &mut self,
        index: usize,
        object: ExprId,
        call_node: ExprId,
    ) -> bool {
        let text = self.text;
        let hir = text.hir;
        let body = self.drafts[index].body;
        let ExprKind::Call(call) = hir[call_node].kind else {
            return false;
        };
        let call = hir[call];
        if call.chain != Chain::No
            || call.args.len() != 2
            || hir.id_at::<ExprId>(call.args, 0) != object
            || !text.is_statement_in_order(call_node, body)
            || (self.input.certain_helper)(call.callee) != Some(Helper::Export)
        {
            return false;
        }
        let literal = hir.skip_type_assertions(hir.id_at(call.args, 1));
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        let mut aliases = Vec::with_capacity(properties.len());
        for property in properties.iter().map(|id| hir[id]) {
            let PropKey::Name(name) = property.key else {
                return false;
            };
            if !matches!(property.kind, PropKind::Init | PropKind::Method)
                || !text.can_name_variable(name)
            {
                return false;
            }
            let Some(returned) = self.find_returned_expression(property.value) else {
                return false;
            };
            let Some(target) = self.find_alias_target(index, returned, call_node) else {
                return false;
            };
            aliases.push((name, target, returned));
        }
        for (name, target, returned) in aliases {
            self.add_alias(index, name, target, call_node, returned, true);
        }
        self.found(index)
            .erased
            .extend(text.statement_of(call_node));
        true
    }

    // `var utils = exports;`, where every `utils` is known to name the object.
    fn is_kept_under_another_name(&self, declaration: VarDeclId) -> bool {
        let text = self.text;
        let pattern = text.hir[declaration].pat;
        if !matches!(text.hir[pattern].kind, PatKind::Ident(_)) {
            return false;
        }
        let symbol = text.bound.declared_symbol(Decl::Var(pattern));
        let path = symbol
            .is_some()
            .then(|| text.builtins.of_symbol(symbol))
            .flatten();
        path.is_some_and(|path| path.id == BuiltinId::ModuleObjectExports)
    }

    fn is_nothing(&self, expression: ExprId) -> bool {
        matches!(
            self.text.constant(expression),
            Some(Constant::Undefined | Constant::Null)
        )
    }

    // Whether the expression around a mention only asks what every object answers alike.
    fn is_asked_as_some_object(&self, mention: ExprId, user: ExprId) -> bool {
        match self.text.hir[user].kind {
            // An object is true: `exports && e` is `e`.
            ExprKind::Binary {
                op: BinOp::And,
                left,
                ..
            } => left == mention,
            ExprKind::Binary {
                op: BinOp::EqEq | BinOp::NotEq | BinOp::EqEqEq | BinOp::NotEqEq,
                left,
                right,
            } => self.is_nothing(if left == mention { right } else { left }),
            ExprKind::Unary { op: UnOp::Not, .. } => true,
            ExprKind::Cond { test, .. } => test == mention,
            _ => false,
        }
    }

    fn classify_replacing_value(&self, value: ExprId) -> Replaced {
        let text = self.text;
        let hir = text.hir;
        let value = hir.skip_type_assertions(value);
        match hir[value].kind {
            ExprKind::Object(_) => Replaced::Literal(value),
            _ => Replaced::Other,
        }
    }

    fn is_exports_name(&self, expression: ExprId) -> bool {
        let text = self.text;
        let expression = text.hir.skip_type_assertions(expression);
        matches!(text.hir[expression].kind, ExprKind::Ident(_))
            && text.bound.binding(expression) == Binding::CommonJs(CommonJsVariable::Exports)
    }

    // `module.exports = e`, `exports = module.exports = e`, `module.exports = exports = e`
    fn add_replacement(&mut self, index: usize, target: ExprId) {
        let text = self.text;
        let body = self.drafts[index].body;
        let Some((assignment, mut value)) = text.find_assignment(target) else {
            // A compound assignment, or a part of a pattern.
            self.drafts[index].replacements.push(Replacement {
                statement: target,
                is_statement_in_order: false,
                renames_exports: false,
                replaced: Replaced::Other,
            });
            return;
        };
        let (mut statement, mut renames_exports) = (assignment, false);
        if let ExprKind::Assign {
            op: None,
            target: inner_target,
            value: inner_value,
        } = text.hir[text.hir.skip_type_assertions(value)].kind
            && self.is_exports_name(inner_target)
        {
            (value, renames_exports) = (inner_value, true);
        }
        if let (outermost, Parent::Expr(user)) = text.parent(assignment)
            && let ExprKind::Assign {
                op: None,
                target: outer_target,
                value: outer_value,
            } = text.hir[user].kind
            && outer_value == outermost
            && self.is_exports_name(outer_target)
        {
            (statement, renames_exports) = (user, true);
        }
        let replacement = Replacement {
            statement,
            is_statement_in_order: text.is_statement_in_order(statement, body),
            renames_exports,
            replaced: self.classify_replacing_value(value),
        };
        self.drafts[index].replacements.push(replacement);
    }

    // `export = e` of TypeScript is the statement `module.exports = e`.
    fn add_export_assignment(&mut self, value: ExprId) {
        let replacement = Replacement {
            statement: value,
            is_statement_in_order: self.text.is_in_order(value, self.drafts[0].body),
            renames_exports: false,
            replaced: self.classify_replacing_value(value),
        };
        self.drafts[0].replacements.push(replacement);
    }

    fn add_mention(&mut self, index: usize, object: ExprId, kind: MentionKind) {
        let text = self.text;
        let is_exports_name = self.is_exports_name(object);
        if let Some(access) = text.find_access(object) {
            self.drafts[index].mentions.push(Mention {
                node: object,
                kind,
                is_exports_name,
            });
            return self.add_access(index, access);
        }
        let (outermost, parent) = text.parent(object);
        if text
            .bound
            .get_assignment_target(text.hir, outermost)
            .is_some()
        {
            return match kind {
                MentionKind::ModuleExports => self.add_replacement(index, object),
                // The binder lists the stores to the name.
                MentionKind::FirstObject => {}
            };
        }
        self.drafts[index].mentions.push(Mention {
            node: object,
            kind,
            is_exports_name,
        });
        let is_some_object = match parent {
            Parent::Expr(user) if self.is_asked_as_some_object(outermost, user) => true,
            // The fold has the answer, and nothing evaluates the operand.
            Parent::Expr(user)
                if matches!(
                    text.hir[user].kind,
                    ExprKind::Unary {
                        op: UnOp::Typeof,
                        ..
                    }
                ) && text.constant(user).is_some() =>
            {
                return;
            }
            Parent::Expr(user) => {
                if !self.add_definition(index, outermost, user)
                    && !self.add_definitions_of_helper(index, outermost, user)
                {
                    self.found(index).keep_object(object);
                }
                return;
            }
            Parent::Stmt(user) => matches!(text.hir[user].kind, StmtKind::If { .. }),
            Parent::VarInit(declaration) => self.is_kept_under_another_name(declaration),
            _ => false,
        };
        match is_some_object {
            // The lowering puts `true` in the place of every mention that is left.
            true => {}
            false => self.found(index).keep_object(object),
        }
    }

    fn is_compared_or_tested(&self, expression: ExprId) -> bool {
        let text = self.text;
        let (_, Parent::Expr(user)) = text.parent(expression) else {
            return false;
        };
        match text.hir[user].kind {
            ExprKind::Binary { op, .. } => matches!(
                op,
                BinOp::EqEqEq | BinOp::NotEqEq | BinOp::EqEq | BinOp::NotEq
            ),
            ExprKind::Unary { op, .. } => matches!(op, UnOp::Typeof | UnOp::Not),
            _ => false,
        }
    }

    // `module` of the file. A member that the table of built-ins knows hands out neither the object nor what it exports.
    fn add_mention_of_module(&mut self, index: usize, module_object: ExprId) {
        let text = self.text;
        if self.is_compared_or_tested(module_object) {
            return;
        }
        let member = match text.parent(module_object) {
            (outermost, Parent::Expr(user)) => match text.hir.member_key(user) {
                Some((accessed, _)) if accessed == outermost => {
                    text.builtins.builtin_of_expression(user)
                }
                _ => None,
            },
            _ => None,
        };
        if member.is_none() {
            self.found(index).uses_module_object = true;
            self.found(index).keep_object(module_object);
        }
    }

    fn find_parameter(&self, symbol: SymbolId) -> Option<(usize, Parameter)> {
        let at = self
            .parameters
            .binary_search_by_key(&symbol, |entry| entry.0)
            .ok()?;
        Some((self.parameters[at].1, self.parameters[at].2))
    }

    fn scan_expression_of_inner_module(&mut self, expression: ExprId) {
        let text = self.text;
        if self.parameters.is_empty() || !text.bound.is_evaluated_ident(expression) {
            return;
        }
        let Binding::Symbol(symbol) = text.bound.binding(expression) else {
            return;
        };
        match self.find_parameter(symbol) {
            Some((index, Parameter::Exports)) => {
                self.add_mention(index, expression, MentionKind::FirstObject);
            }
            // It occurs only as `module.exports`.
            Some((index, Parameter::Module)) => {
                if let (_, Parent::Expr(member)) = text.parent(expression) {
                    self.add_mention(index, member, MentionKind::ModuleExports);
                }
            }
            None => {}
        }
    }

    fn scan_expression_of_file(&mut self, expression: ExprId) {
        let text = self.text;
        if matches!(text.hir[expression].kind, ExprKind::This) {
            return match text.unit_with_this(expression) {
                Some(CodeUnit::File) if !text.analysis.has_esm_syntax => {
                    self.add_mention(0, expression, MentionKind::FirstObject);
                }
                Some(_) => {}
                None => self.found(0).keep_object(expression),
            };
        }
        match text.builtins.builtin_of_expression(expression) {
            Some(BuiltinId::ModuleObjectExports) => {
                let kind = match text.hir.member_key(expression) {
                    Some(_) => MentionKind::ModuleExports,
                    None => MentionKind::FirstObject,
                };
                self.add_mention(0, expression, kind);
            }
            Some(BuiltinId::ModuleObject) => self.add_mention_of_module(0, expression),
            Some(_) => {}
            // The file stores to the name, so the table of built-ins does not say what it holds.
            None if text.bound.is_evaluated_ident(expression) => {
                match text.bound.binding(expression) {
                    Binding::CommonJs(CommonJsVariable::Exports) => {
                        self.add_mention(0, expression, MentionKind::FirstObject);
                    }
                    Binding::CommonJs(CommonJsVariable::Module) => {
                        self.found(0).needs_wrapped_body = true;
                    }
                    _ => {}
                }
            }
            None => {}
        }
    }

    // `module.exports = { a, b: e, c() {} }`: the literal takes the place of the object that the module was born with, which nobody has seen.
    fn add_literal(&mut self, index: usize, literal: ExprId) -> bool {
        let text = self.text;
        let hir = text.hir;
        let ExprKind::Object(properties) = hir[literal].kind else {
            return false;
        };
        let mut creations = Vec::with_capacity(properties.len());
        for property in properties.iter().map(|id| hir[id]) {
            let PropKey::Name(name) = property.key else {
                return false;
            };
            let is_plain = matches!(
                property.kind,
                PropKind::Init | PropKind::Shorthand | PropKind::Method
            );
            let value = text.classify_value(property.value);
            // `super` in a method looks above the literal, however the method is called.
            let needs_literal = property.kind == PropKind::Method && value == StoredValue::Unknown;
            if !is_plain || needs_literal || !text.can_name_variable(name) {
                return false;
            }
            creations.push(Creation {
                name,
                node: property.value,
                value,
                value_node: property.value,
                is_in_order: true,
                is_run_by_body_alone: true,
                is_enumerable: true,
                is_read_only: false,
                start: property.start,
                end: property.end,
            });
        }
        self.found(index).creations.extend(creations);
        true
    }

    // What one store to `module.exports` makes of the module. `false`: one variable holds the value, and that is all.
    fn apply_replacement(&mut self, index: usize) -> bool {
        let text = self.text;
        let draft = &self.drafts[index];
        let [replacement] = draft.replacements[..] else {
            return false;
        };
        let end = text.hir[replacement.statement].end;
        // In front of the store every mention is one of the first object, also in a function that is written there.
        let names_new_value = |mention: &Mention| {
            text.hir[mention.node].pos >= end
                && (mention.kind == MentionKind::ModuleExports
                    || (replacement.renames_exports && mention.is_exports_name))
        };
        let stores_to_name = match replacement.renames_exports {
            true => 1,
            false => 0,
        };
        if !replacement.is_statement_in_order
            || draft.stores_to_exports_name.len() != stores_to_name
            || !draft.mentions.iter().all(names_new_value)
            // What such a function stores when it is called in front of the statement lands on the first object.
            || draft.found.creations.iter().any(|it| text.is_in_function_declaration(it.node, draft.body))
            // Whoever has required the module in a cycle holds the first object.
            || draft.found.is_half
        {
            return false;
        }
        match replacement.replaced {
            Replaced::Literal(literal) => {
                !replacement.renames_exports && self.add_literal(index, literal)
            }
            Replaced::Other => false,
        }
    }

    // `E.n || (E.n = v)` and `E.n ?? (E.n = v)`: whichever way the choice goes, the name is there behind it.
    fn find_stores_that_fill(&mut self, index: usize) {
        let (text, body) = (self.text, self.drafts[index].body);
        let found = &self.drafts[index].found;
        let fills = |creation: &Creation| {
            let (store, Parent::Expr(choice)) = text.parent(creation.node) else {
                return false;
            };
            let ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } = text.hir[choice].kind
            else {
                return false;
            };
            let left = text.hir.skip_type_assertions(left);
            let mut accesses = found.accesses.iter();
            right == store
                && accesses.any(|access| {
                    access.node == left
                        && access.name == creation.name
                        && access.kind == AccessKind::Read
                })
                && text.is_in_order(choice, body)
        };
        let filled: Vec<bool> = found
            .creations
            .iter()
            .map(|creation| !creation.is_in_order && fills(creation))
            .collect();
        for (creation, is_filled) in self.found(index).creations.iter_mut().zip(filled) {
            creation.is_in_order |= is_filled;
        }
    }

    // A definition takes no store, and a getter none but `undefined` in front of it: TypeScript stores `void 0` under every name first.
    fn check_definitions(&mut self, index: usize) {
        let (text, body) = (self.text, self.drafts[index].body);
        let found = &self.drafts[index].found;
        let mut refused = None;
        let mut cleared = Vec::new();
        // The property is there from its definition on. A function may run in front of that.
        let is_read_before = |alias: &Alias| {
            let mut reads = found.accesses.iter().filter(|access| {
                access.name == alias.name && !matches!(access.kind, AccessKind::Store(_))
            });
            reads.any(|read| {
                text.hir[read.node].pos < alias.start || text.code_unit_of(read.node) != Some(body)
            })
        };
        for alias in &found.aliases {
            let is_defined_once = found
                .aliases
                .iter()
                .filter(|it| it.name == alias.name)
                .count()
                == 1;
            let is_cleared_before = |creation: &Creation| {
                creation.value == StoredValue::Undefined
                    && creation.is_in_order
                    && !creation.is_read_only
                    && creation.end <= alias.start
            };
            if !is_defined_once
                || !found.creations_of(alias.name).all(is_cleared_before)
                || is_read_before(alias)
            {
                refused = Some(alias.node);
            }
            cleared.push(alias.name);
        }
        for creation in found
            .creations
            .iter()
            .filter(|creation| creation.is_read_only)
        {
            let mut others = found
                .creations_of(creation.name)
                .filter(|it| it.node != creation.node);
            if others.next().is_some() {
                refused = Some(creation.node);
            }
        }
        // A name that stands for another is there from the start, the property only from its definition on.
        if found.is_half
            && let Some(alias) = found.aliases.iter().max_by_key(|alias| alias.start)
            && !self.runs_nothing_else_in_front_of(body, alias.start)
        {
            refused = Some(alias.node);
        }
        let found = self.found(index);
        if let Some(node) = refused {
            return found.keep_object(node);
        }
        // Nobody sees what is stored under a name that a getter is defined for behind the store.
        found
            .creations
            .retain(|creation| !cleared.contains(&creation.name));
    }

    // Whether no code but that of `body` itself runs until `body` gets to the position: an accessor, a conversion or an iterator runs code as a call does, and a function that only makes the helpers of a compiler runs none.
    fn runs_nothing_else_in_front_of(&self, body: CodeUnit, position: u32) -> bool {
        let text = self.text;
        let statements = match body {
            CodeUnit::File => text.hir.body,
            CodeUnit::Function(function) => match text.hir[function].body {
                FnBody::Block(statements) => statements,
                FnBody::Expr(_) | FnBody::None => return false,
            },
            CodeUnit::FieldInitializer(_) => return false,
        };
        // A definition on the object that the module was born with runs the built-in, or the helper that calls it, and no more.
        let found = self
            .drafts
            .iter()
            .find(|draft| draft.body == body)
            .map(|draft| &draft.found);
        let is_definition = |call: CallId| {
            let is_call =
                |node: ExprId| matches!(text.hir[node].kind, ExprKind::Call(id) if id == call);
            found.is_some_and(|found| {
                found.aliases.iter().any(|alias| is_call(alias.node))
                    || found
                        .defined_values
                        .iter()
                        .any(|defined| is_call(defined.0))
            })
        };
        let quiet = Quiet {
            atoms: text.atoms,
            hir: text.hir,
            bound: text.bound,
            decisions: text.decisions,
            allows_reads_of_open_globals: false,
            runs_nothing: &is_definition,
        };
        let statements = text.hir.ids(statements);
        let mut in_front =
            statements.take_while(|&statement: &StmtId| text.hir[statement].start < position);
        in_front.all(|statement| quiet.is_quiet_statement(statement))
    }

    // `exports.__esModule = true` and `Object.defineProperty(exports, "__esModule", { value: true })`: once, in order, a true constant.
    fn find_marker(&mut self, index: usize) {
        let text = self.text;
        let found = &self.drafts[index].found;
        let creations: Vec<Creation> = found.creations_of(known::__esModule).copied().collect();
        let is_true = |value: ExprId| match value.some().and_then(|value| text.constant(value)) {
            Some(Constant::Boolean(flag)) => flag,
            Some(Constant::Number(number)) => number != 0.0 && !number.is_nan(),
            Some(Constant::String(string)) => !text.atoms.bytes(string).is_empty(),
            Some(Constant::Undefined | Constant::Null | Constant::BigInt(_)) | None => false,
        };
        let marker = match &creations[..] {
            [] => Marker::Absent,
            [creation]
                if creation.is_in_order
                    && is_true(creation.value_node)
                    && text.is_statement(creation.node)
                    && found.alias_of(known::__esModule).is_none() =>
            {
                Marker::True {
                    start: creation.start,
                }
            }
            _ => Marker::Unknown,
        };
        let marker = match (found.alias_of(known::__esModule), marker) {
            (Some(_), _) => Marker::Unknown,
            // Whoever finds the module half evaluated in front of that statement finds no marker.
            (None, Marker::True { start, .. })
                if found.is_half
                    && !self.runs_nothing_else_in_front_of(self.drafts[index].body, start) =>
            {
                Marker::Unknown
            }
            (None, marker) => marker,
        };
        let found = self.found(index);
        found.marker = marker;
        if let (Marker::True { .. }, [creation]) = (marker, &creations[..]) {
            found.marker_nodes.push(creation.node);
            found.erased.extend(text.statement_of(creation.node));
            found.creations.retain(|it| it.name != known::__esModule);
            found.defined_values.retain(|it| it.1 != known::__esModule);
        }
    }

    fn finish_draft(&mut self, index: usize) {
        let has_replacements = !self.drafts[index].replacements.is_empty();
        let is_replaced_well = has_replacements && self.apply_replacement(index);
        if has_replacements && !is_replaced_well {
            let at = self.drafts[index].replacements[0].statement;
            self.found(index).keep_object(at);
        }
        if !has_replacements && let Some(&store) = self.drafts[index].stores_to_exports_name.first()
        {
            // Nobody knows what the name holds from then on.
            self.found(index).needs_wrapped_body = true;
            self.found(index).keep_object(store);
        }
        if has_replacements {
            let replacements = self.drafts[index].replacements.iter();
            let renamed = replacements
                .filter(|it| it.renames_exports && it.is_statement_in_order)
                .count();
            if self.drafts[index].stores_to_exports_name.len() != renamed {
                self.found(index).needs_wrapped_body = true;
            }
        }
        self.find_stores_that_fill(index);
        self.check_definitions(index);
        self.find_marker(index);
        let draft = &mut self.drafts[index];
        let found = &mut draft.found;
        found
            .creations
            .shared_sort_by_key(|it| (!it.is_in_order, it.end, core::cmp::Reverse(it.start)));
        if found.form == Form::Value {
            found.aliases.clear();
            found.erased.clear();
            found.defined_values.clear();
            found.marker_nodes.clear();
            found.marker = Marker::Unknown;
        }
    }
}

fn needs_wrapped_body(text: &Text<'_, '_>) -> bool {
    let (bound, decisions) = (text.bound, text.decisions);
    let is_wrapper_name = |target: ExprId| {
        matches!(
            bound.binding(target),
            Binding::CommonJs(
                CommonJsVariable::Module
                    | CommonJsVariable::Require
                    | CommonJsVariable::Filename
                    | CommonJsVariable::Dirname
            )
        )
    };
    let mut stores = bound.runtime.unbound_name_stores().iter();
    let mut evals = bound.runtime.eval_scopes().iter();
    let mut statements = text.hir.stmts.iter();
    bound.file_uses_arguments()
        || !bound.runtime.redeclared_commonjs_variables().is_empty()
        || evals.any(|&(call, _)| !decisions.is_dead_expr(call))
        || stores.any(|&(target, _)| is_wrapper_name(target) && !decisions.is_dead_expr(target))
        || statements.any(|statement| matches!(statement.kind, StmtKind::With { .. }))
}

/// What the text of a file says of the exports of the file and of the modules that are written in it.
pub(super) fn scan_own_text(input: &ScanInput<'_, '_, '_>) -> Vec<OwnText> {
    let text = input.text;
    let mut scan = Scan {
        input,
        text,
        may_replace_require: text.may_replace_require(),
        drafts: Vec::new(),
        parameters: Vec::new(),
    };
    let create_draft = |module: ModuleRef, body: CodeUnit| Draft {
        body,
        found: OwnText::new(module, (input.half)(module)),
        mentions: Vec::new(),
        replacements: Vec::new(),
        stores_to_exports_name: Vec::new(),
    };
    // The file comes first, also where it is no module of this kind: then nothing is added to it.
    scan.drafts
        .push(create_draft(ModuleRef::File(text.file), CodeUnit::File));
    for inner in input.inner_modules {
        let index = scan.drafts.len();
        let module = ModuleRef::Inner {
            file: text.file,
            callback: inner.callback,
        };
        scan.drafts
            .push(create_draft(module, CodeUnit::Function(inner.callback)));
        let exports = inner
            .exports_parameter
            .map(|symbol| (symbol, index, Parameter::Exports));
        let module = inner
            .module_parameter
            .map(|symbol| (symbol, index, Parameter::Module));
        scan.parameters.extend(exports.into_iter().chain(module));
    }
    scan.parameters.sort_unstable_by_key(|entry| entry.0);
    if input.is_file_a_module && needs_wrapped_body(text) {
        scan.found(0).needs_wrapped_body = true;
        scan.found(0).keep_object(ExprId::NONE);
    }
    if input.is_file_a_module && input.is_entry_point {
        scan.found(0).keep_object(ExprId::NONE);
    }
    if input.is_file_a_module {
        let exports = Binding::CommonJs(CommonJsVariable::Exports);
        let stores = text
            .bound
            .runtime
            .unbound_name_stores()
            .iter()
            .map(|store| store.0);
        let stores = stores.filter(|&target| {
            text.bound.binding(target) == exports && !text.decisions.is_dead_expr(target)
        });
        scan.drafts[0].stores_to_exports_name.extend(stores);
    }
    for expression in text.expressions() {
        if text.decisions.is_dead_expr(expression) {
            continue;
        }
        if input.is_file_a_module {
            scan.scan_expression_of_file(expression);
        }
        scan.scan_expression_of_inner_module(expression);
    }
    if input.is_file_a_module {
        for statement in text.hir.ids(text.hir.body) {
            if let StmtKind::ExportAssign(value) = text.hir[statement].kind {
                scan.add_export_assignment(value);
            }
        }
    }
    for index in 0..scan.drafts.len() {
        scan.finish_draft(index);
    }
    let first = match input.is_file_a_module {
        true => 0,
        false => 1,
    };
    scan.drafts
        .drain(first..)
        .map(|draft| draft.found)
        .collect()
}
