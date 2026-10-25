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
use bun_sema::program::{FileId, Sym};
use bun_sema::util::SharedSort;

/// How the text names the exports of its module.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum MentionKind {
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
    pub is_enumerable: bool,
    pub is_read_only: bool,
    pub start: u32,
    pub end: u32,
}

/// What a name stands for that has no variable of its own.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(in crate::modules) enum AliasTarget {
    /// What another module has under a name.
    Member { module: ModuleRef, name: Atom },
    /// A binding of the top level of the file.
    Binding(Sym),
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

pub(super) struct OwnText {
    /// The file that the module is written in.
    pub file: FileId,
    pub module: ModuleRef,
    /// Somebody may look at the module while its body runs.
    pub is_half: bool,
    /// No use of the object in the text of the module: a variable for each name. Otherwise one variable holds `module.exports`.
    pub has_names: bool,
    pub accesses: Vec<Access>,
    /// In the order in which the body gets to them; those that a function makes come last.
    pub creations: Vec<Creation>,
    pub aliases: Vec<Alias>,
    /// The calls of `Object.defineProperty` that are one store, with the name.
    pub defined_values: Vec<(ExprId, Atom)>,
    /// The calls and stores that only say that the module has an `__esModule`.
    pub marker_nodes: Vec<ExprId>,
    pub erased: Vec<StmtId>,
    /// What `__esModule` reads. `false`: the text never gives the module one. `true`: once, in order, a true constant. `None`: only the run knows, as wherever one variable holds the value.
    pub marker: Option<bool>,
    pub needs_wrapped_body: bool,
    pub uses_module_object: bool,
}

impl OwnText {
    pub(super) fn module(&self) -> ModuleRef {
        self.module
    }

    pub(super) fn creations_of(&self, name: Atom) -> impl Iterator<Item = &Creation> {
        let creations = self.creations.iter();
        creations.filter(move |creation| creation.name == name)
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
        let mut creations = self.creations.iter();
        self.has_names && creations.all(|creation| self.always_creates(creation.name))
    }
}

// `module.exports = e`
#[derive(Copy, Clone, Debug)]
struct Replacement {
    /// The outermost assignment of the statement.
    statement: ExprId,
    is_statement_in_order: bool,
    /// `exports = module.exports = e`: the name goes along.
    renames_exports: bool,
    /// `{ a, b: e, c() {} }`, where that is what is stored.
    literal: Option<ExprId>,
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
    /// The code that runs when the module is evaluated: the file, or the callback of an inner module.
    body: CodeUnit,
    found: OwnText,
    mentions: Vec<Mention>,
    replacements: Vec<Replacement>,
    stores_to_exports_name: usize,
}

#[derive(Copy, Clone)]
enum DefinedPart {
    Value(ExprId),
    /// A getter that does nothing but return this expression.
    Getter(ExprId),
}

impl Scan<'_, '_, '_> {
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

    // `require(K)`, or a name that holds it and nothing else: the module, and the call that evaluates it.
    fn find_required_module(&self, expression: ExprId) -> Option<(ModuleRef, ExprId)> {
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
        Some((self.module_of_call(site)?, site))
    }

    fn create(&self, name: Atom, node: ExprId, value_node: ExprId, value: StoredValue) -> Creation {
        let text = self.text;
        Creation {
            name,
            node,
            value,
            value_node,
            is_in_order: text.is_in_order(node, self.body),
            is_run_by_body_alone: text.is_run_by_body_alone(node, self.body),
            is_enumerable: true,
            is_read_only: false,
            start: text.hir[node].pos,
            end: text.hir[node].end,
        }
    }

    fn add_access(&mut self, access: Access) {
        self.found.accesses.push(access);
        let Access { node, name, kind } = access;
        let creation = match kind {
            AccessKind::Store(value) => {
                // The value is evaluated before the store.
                let assignment = self.text.find_assignment(node);
                let (node, value_node) = assignment.unwrap_or((node, ExprId::NONE));
                self.create(name, node, value_node, value)
            }
            // Nothing that can be called.
            AccessKind::Update => self.create(name, node, ExprId::NONE, StoredValue::IgnoresThis),
            AccessKind::Choice(value) => Creation {
                is_in_order: false,
                ..self.create(name, node, ExprId::NONE, value)
            },
            AccessKind::Read | AccessKind::Call => return,
        };
        self.found.creations.push(creation);
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

    // What ToPropertyDescriptor reads from an object literal: the value or the getter, `enumerable`, `writable`.
    fn find_defined(&self, descriptor: ExprId) -> Option<(DefinedPart, bool, bool)> {
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
        Some((part, is_enumerable, is_writable))
    }

    // A binding that the body of the file declares at its top. It has a variable, which every file can read.
    fn find_binding_alias(&self, returned: ExprId) -> Option<AliasTarget> {
        let (text, file) = (self.text, self.text.file);
        let Binding::Symbol(id) = text.bound.binding(returned) else {
            return None;
        };
        let is_declared_at_top = self.body == CodeUnit::File
            && text.bound.symbol_scope(id) == text.bound.top_scope(text.hir, CodeUnit::File);
        let has_variable = matches!(
            text.bound.binding_kind(id),
            BindingKind::Var
                | BindingKind::Let
                | BindingKind::Const
                | BindingKind::Class
                | BindingKind::Function
        );
        // An ES importer holds what the getter answered when the file was linked. Nobody can tell where nothing stores again.
        let is_stable = text.bound.is_stable_binding(id);
        (is_declared_at_top && has_variable && is_stable && text.bound.has_runtime_value(id))
            .then_some(AliasTarget::Binding(Sym { file, id }))
    }

    // What a getter stands for that does nothing but return `returned`.
    fn find_alias_target(&self, returned: ExprId, definition: ExprId) -> Option<AliasTarget> {
        let text = self.text;
        let hir = text.hir;
        let returned = hir.skip_type_assertions(returned);
        if matches!(hir[returned].kind, ExprKind::Ident(_)) {
            return self.find_binding_alias(returned);
        }
        let (object, key) = hir.member_key(returned)?;
        let (ExprKind::Dot { chain, .. } | ExprKind::Index { chain, .. }) = hir[returned].kind
        else {
            return None;
        };
        let name = text.name_of_key(key);
        let name = name.filter(|&name| text.can_name_variable(name))?;
        // A call that is written in the getter runs when the getter does.
        let object = hir.skip_type_assertions(object);
        if chain != Chain::No || !matches!(hir[object].kind, ExprKind::Ident(_)) {
            return None;
        }
        let (module, site) = self.find_required_module(object)?;
        // The name holds the module from its `require` on, and a read in front of that throws.
        let is_loaded_before =
            text.is_in_order(site, self.body) && hir[site].end <= hir[definition].pos;
        is_loaded_before.then_some(AliasTarget::Member { module, name })
    }

    fn add_alias(
        &mut self,
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
        self.found.aliases.push(Alias {
            name,
            target,
            node,
            value,
            is_enumerable,
            start,
        });
    }

    // `Object.defineProperty(exports, "name", { .. })` as a statement that every run of the body passes.
    fn add_definition(&mut self, object: ExprId, call_node: ExprId) -> Option<()> {
        let text = self.text;
        let hir = text.hir;
        let ExprKind::Call(call) = hir[call_node].kind else {
            return None;
        };
        let call = hir[call];
        let callee = hir.skip_type_assertions(call.callee);
        let callee = text.builtins.builtin_of_expression(callee);
        let defines_property = matches!(
            callee,
            Some(BuiltinId::ObjectDefineProperty | BuiltinId::ReflectDefineProperty)
        );
        if !defines_property
            || call.args.len() != 3
            || hir.id_at::<ExprId>(call.args, 0) != object
            || !text.is_statement_in_order(call_node, self.body)
        {
            return None;
        }
        let name = text.constant_name(hir.id_at(call.args, 1));
        let name = name.filter(|&name| text.can_name_variable(name))?;
        let (part, is_enumerable, is_writable) = self.find_defined(hir.id_at(call.args, 2))?;
        match part {
            DefinedPart::Value(value) => {
                let creation = self.create(name, call_node, value, text.classify_value(value));
                self.found.creations.push(Creation {
                    is_enumerable,
                    is_read_only: !is_writable,
                    ..creation
                });
                self.found.defined_values.push((call_node, name));
            }
            DefinedPart::Getter(returned) => {
                let target = self.find_alias_target(returned, call_node)?;
                self.add_alias(name, target, call_node, returned, is_enumerable);
                self.found.erased.extend(text.statement_of(call_node));
            }
        }
        Some(())
    }

    // `_export(exports, { name: function () { return e; }, .. })` as a statement that every run of the body passes: the helper defines an enumerable getter for each name of the literal, in the order in which they are written.
    fn add_definitions_of_helper(&mut self, object: ExprId, call_node: ExprId) -> Option<()> {
        let text = self.text;
        let hir = text.hir;
        let ExprKind::Call(call) = hir[call_node].kind else {
            return None;
        };
        let call = hir[call];
        if call.chain != Chain::No
            || call.args.len() != 2
            || hir.id_at::<ExprId>(call.args, 0) != object
            || !text.is_statement_in_order(call_node, self.body)
            || (self.input.certain_helper)(call.callee) != Some(Helper::Export)
        {
            return None;
        }
        let literal = hir.skip_type_assertions(hir.id_at(call.args, 1));
        let ExprKind::Object(properties) = hir[literal].kind else {
            return None;
        };
        let mut aliases = Vec::with_capacity(properties.len());
        for property in properties.iter().map(|id| hir[id]) {
            let PropKey::Name(name) = property.key else {
                return None;
            };
            if !matches!(property.kind, PropKind::Init | PropKind::Method)
                || !text.can_name_variable(name)
            {
                return None;
            }
            let returned = self.find_returned_expression(property.value)?;
            aliases.push((name, self.find_alias_target(returned, call_node)?, returned));
        }
        for (name, target, returned) in aliases {
            self.add_alias(name, target, call_node, returned, true);
        }
        self.found.erased.extend(text.statement_of(call_node));
        Some(())
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
            } => matches!(
                self.text
                    .constant(if left == mention { right } else { left }),
                Some(Constant::Undefined | Constant::Null)
            ),
            ExprKind::Unary { op: UnOp::Not, .. } => true,
            ExprKind::Cond { test, .. } => test == mention,
            _ => false,
        }
    }

    fn find_literal(&self, value: ExprId) -> Option<ExprId> {
        let hir = self.text.hir;
        let value = hir.skip_type_assertions(value);
        matches!(hir[value].kind, ExprKind::Object(_)).then_some(value)
    }

    fn is_exports_name(&self, expression: ExprId) -> bool {
        let text = self.text;
        let expression = text.hir.skip_type_assertions(expression);
        matches!(text.hir[expression].kind, ExprKind::Ident(_))
            && text.bound.binding(expression) == Binding::CommonJs(CommonJsVariable::Exports)
    }

    // `module.exports = e`, `exports = module.exports = e`, `module.exports = exports = e`
    fn add_replacement(&mut self, target: ExprId) {
        let text = self.text;
        let Some((assignment, mut value)) = text.find_assignment(target) else {
            // A compound assignment, or a part of a pattern.
            return self.replacements.push(Replacement {
                statement: target,
                is_statement_in_order: false,
                renames_exports: false,
                literal: None,
            });
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
        self.replacements.push(Replacement {
            statement,
            is_statement_in_order: text.is_statement_in_order(statement, self.body),
            renames_exports,
            literal: self.find_literal(value),
        });
    }

    fn add_mention(&mut self, object: ExprId, kind: MentionKind) {
        let text = self.text;
        let mention = Mention {
            node: object,
            kind,
            is_exports_name: self.is_exports_name(object),
        };
        if let Some(access) = text.find_access(object) {
            self.mentions.push(mention);
            return self.add_access(access);
        }
        let (outermost, parent) = text.parent(object);
        let target = text.bound.get_assignment_target(text.hir, outermost);
        if target.is_some() {
            return match kind {
                MentionKind::ModuleExports => self.add_replacement(object),
                // The binder lists the stores to the name.
                MentionKind::FirstObject => {}
            };
        }
        self.mentions.push(mention);
        // The lowering puts `true` in the place of every mention that is left.
        self.found.has_names &= match parent {
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
                true
            }
            Parent::Expr(user) => {
                self.add_definition(outermost, user).is_some()
                    || self.add_definitions_of_helper(outermost, user).is_some()
            }
            Parent::Stmt(user) => matches!(text.hir[user].kind, StmtKind::If { .. }),
            Parent::VarInit(declaration) => self.is_kept_under_another_name(declaration),
            _ => false,
        };
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
    fn add_mention_of_module(&mut self, module_object: ExprId) {
        let text = self.text;
        if self.is_compared_or_tested(module_object) {
            return;
        }
        if let (outermost, Parent::Expr(user)) = text.parent(module_object)
            && let Some((accessed, _)) = text.hir.member_key(user)
            && accessed == outermost
            && text.builtins.builtin_of_expression(user).is_some()
        {
            return;
        }
        self.found.uses_module_object = true;
        self.found.has_names = false;
    }

    fn scan_expression_of_file(&mut self, expression: ExprId) {
        let text = self.text;
        if matches!(text.hir[expression].kind, ExprKind::This) {
            return match text.unit_with_this(expression) {
                Some(CodeUnit::File) if !text.analysis.has_esm_syntax => {
                    self.add_mention(expression, MentionKind::FirstObject);
                }
                Some(_) => {}
                None => self.found.has_names = false,
            };
        }
        match text.builtins.builtin_of_expression(expression) {
            Some(BuiltinId::ModuleObjectExports) => {
                let kind = match text.hir.member_key(expression) {
                    Some(_) => MentionKind::ModuleExports,
                    None => MentionKind::FirstObject,
                };
                self.add_mention(expression, kind);
            }
            Some(BuiltinId::ModuleObject) => self.add_mention_of_module(expression),
            Some(_) => {}
            // The file stores to the name, so the table of built-ins does not say what it holds.
            None if text.bound.is_evaluated_ident(expression) => {
                match text.bound.binding(expression) {
                    Binding::CommonJs(CommonJsVariable::Exports) => {
                        self.add_mention(expression, MentionKind::FirstObject);
                    }
                    Binding::CommonJs(CommonJsVariable::Module) => {
                        self.found.needs_wrapped_body = true;
                    }
                    _ => {}
                }
            }
            None => {}
        }
    }

    // `module.exports = { a, b: e, c() {} }`: the literal takes the place of the object that the module was born with, which nobody has seen.
    fn add_literal(&mut self, literal: ExprId) -> bool {
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
        self.found.creations.extend(creations);
        true
    }

    // What one store to `module.exports` makes of the module. `false`: one variable holds the value, and that is all.
    fn apply_replacement(&mut self) -> bool {
        let text = self.text;
        let [replacement] = self.replacements[..] else {
            return false;
        };
        let end = text.hir[replacement.statement].end;
        // In front of the store every mention is one of the first object, also in a function that is written there.
        let names_new_value = |mention: &Mention| {
            text.hir[mention.node].pos >= end
                && (mention.kind == MentionKind::ModuleExports
                    || (replacement.renames_exports && mention.is_exports_name))
        };
        let mut creations = self.found.creations.iter();
        if !replacement.is_statement_in_order
            || self.stores_to_exports_name != usize::from(replacement.renames_exports)
            || !self.mentions.iter().all(names_new_value)
            // What such a function stores when it is called in front of the statement lands on the first object.
            || creations.any(|it| text.is_in_function_declaration(it.node, self.body))
            // Whoever has required the module in a cycle holds the first object.
            || self.found.is_half
            || replacement.renames_exports
        {
            return false;
        }
        let literal = replacement.literal;
        literal.is_some_and(|literal| self.add_literal(literal))
    }

    // `E.n || (E.n = v)` and `E.n ?? (E.n = v)`: whichever way the choice goes, the name is there behind it.
    fn find_stores_that_fill(&mut self) {
        let (text, body) = (self.text, self.body);
        let OwnText {
            accesses,
            creations,
            ..
        } = &mut self.found;
        for creation in creations.iter_mut().filter(|it| !it.is_in_order) {
            let (store, Parent::Expr(choice)) = text.parent(creation.node) else {
                continue;
            };
            let ExprKind::Binary {
                op: BinOp::Or | BinOp::Nullish,
                left,
                right,
            } = text.hir[choice].kind
            else {
                continue;
            };
            let left = text.hir.skip_type_assertions(left);
            creation.is_in_order = right == store
                && accesses.iter().any(|access| {
                    access.node == left
                        && access.name == creation.name
                        && access.kind == AccessKind::Read
                })
                && text.is_in_order(choice, body);
        }
    }

    // A definition takes no store, and a getter none but `undefined` in front of it: TypeScript stores `void 0` under every name first.
    fn check_definitions(&mut self) {
        let (text, found) = (self.text, &self.found);
        // The property is there from its definition on. A function may run in front of that.
        let is_read_before = |alias: &Alias| {
            let mut reads = found.accesses.iter().filter(|access| {
                access.name == alias.name && !matches!(access.kind, AccessKind::Store(_))
            });
            reads.any(|read| {
                text.hir[read.node].pos < alias.start
                    || text.code_unit_of(read.node) != Some(self.body)
            })
        };
        let is_refused = |alias: &Alias| {
            let definitions = found.aliases.iter().filter(|it| it.name == alias.name);
            let is_cleared_before = |creation: &Creation| {
                creation.value == StoredValue::Undefined
                    && creation.is_in_order
                    && !creation.is_read_only
                    && creation.end <= alias.start
            };
            definitions.count() != 1
                || !found.creations_of(alias.name).all(is_cleared_before)
                || is_read_before(alias)
        };
        let is_stored_again = |creation: &Creation| {
            let mut creations = found.creations_of(creation.name);
            creation.is_read_only && creations.any(|it| it.node != creation.node)
        };
        // A name that stands for another is there from the start, the property only from its definition on.
        let last = found.aliases.iter().max_by_key(|alias| alias.start);
        if found.aliases.iter().any(is_refused)
            || found.creations.iter().any(is_stored_again)
            || (found.is_half
                && last.is_some_and(|alias| !self.runs_nothing_else_in_front_of(alias.start)))
        {
            self.found.has_names = false;
            return;
        }
        // Nobody sees what is stored under a name that a getter is defined for behind the store.
        let OwnText {
            creations, aliases, ..
        } = &mut self.found;
        creations.retain(|creation| aliases.iter().all(|alias| alias.name != creation.name));
    }

    // Whether no code but that of the body itself runs until the body gets to the position: an accessor, a conversion or an iterator runs code as a call does, and a function that only makes the helpers of a compiler runs none.
    fn runs_nothing_else_in_front_of(&self, position: u32) -> bool {
        let (text, found) = (self.text, &self.found);
        let statements = match self.body {
            CodeUnit::File => text.hir.body,
            CodeUnit::Function(function) => match text.hir[function].body {
                FnBody::Block(statements) => statements,
                FnBody::Expr(_) | FnBody::None => return false,
            },
            CodeUnit::FieldInitializer(_) => return false,
        };
        // A definition on the object that the module was born with runs the built-in, or the helper that calls it, and no more.
        let is_definition = |call: CallId| {
            let is_call =
                |node: ExprId| matches!(text.hir[node].kind, ExprKind::Call(id) if id == call);
            found.aliases.iter().any(|alias| is_call(alias.node))
                || found.defined_values.iter().any(|it| is_call(it.0))
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
    fn find_marker(&mut self) {
        let (text, found) = (self.text, &self.found);
        let creations: Vec<Creation> = found.creations_of(known::__esModule).copied().collect();
        let is_true = |value: ExprId| match value.some().and_then(|value| text.constant(value)) {
            Some(Constant::Boolean(flag)) => flag,
            Some(Constant::Number(number)) => number != 0.0 && !number.is_nan(),
            Some(Constant::String(string)) => !text.atoms.bytes(string).is_empty(),
            Some(Constant::Undefined | Constant::Null | Constant::BigInt(_)) | None => false,
        };
        let marker = match &creations[..] {
            _ if found.alias_of(known::__esModule).is_some() => None,
            [] => Some(false),
            [creation] => (creation.is_in_order
                && is_true(creation.value_node)
                && text.is_statement(creation.node)
                // Whoever finds the module half evaluated in front of that statement finds no marker.
                && (!found.is_half || self.runs_nothing_else_in_front_of(creation.start)))
            .then_some(true),
            _ => None,
        };
        let found = &mut self.found;
        found.marker = marker;
        if let (Some(true), [creation]) = (marker, &creations[..]) {
            found.marker_nodes.push(creation.node);
            found.erased.extend(text.statement_of(creation.node));
            found.creations.retain(|it| it.name != known::__esModule);
            found.defined_values.retain(|it| it.1 != known::__esModule);
        }
    }

    fn finish(&mut self) {
        let renaming = |it: &&Replacement| it.renames_exports && it.is_statement_in_order;
        let renamed = self.replacements.iter().filter(renaming).count();
        // Nobody knows what the name holds from then on.
        self.found.needs_wrapped_body |= self.stores_to_exports_name != renamed;
        self.found.has_names &= match self.replacements.is_empty() {
            true => self.stores_to_exports_name == 0,
            false => self.apply_replacement(),
        };
        self.find_stores_that_fill();
        self.check_definitions();
        self.find_marker();
        let found = &mut self.found;
        found
            .creations
            .shared_sort_by_key(|it| (!it.is_in_order, it.end, core::cmp::Reverse(it.start)));
        if !found.has_names {
            found.aliases.clear();
            found.erased.clear();
            found.defined_values.clear();
            found.marker_nodes.clear();
            found.marker = None;
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
    let may_replace_require = text.places.may_replace(CommonJsVariable::Require);
    let create_scan = |module: ModuleRef, body: CodeUnit| Scan {
        input,
        text,
        may_replace_require,
        body,
        found: OwnText {
            file: text.file,
            module,
            is_half: (input.half)(module),
            has_names: true,
            accesses: Vec::new(),
            creations: Vec::new(),
            aliases: Vec::new(),
            defined_values: Vec::new(),
            marker_nodes: Vec::new(),
            erased: Vec::new(),
            marker: Some(false),
            needs_wrapped_body: false,
            uses_module_object: false,
        },
        mentions: Vec::new(),
        replacements: Vec::new(),
        stores_to_exports_name: 0,
    };
    // The file comes first, also where it is no module of this kind: then nothing is added to it.
    let mut scans = vec![create_scan(ModuleRef::File(text.file), CodeUnit::File)];
    // The parameters of the callbacks of inner modules, with the index of the scan.
    let mut parameters: Vec<(SymbolId, usize, Parameter)> = Vec::new();
    for inner in input.inner_modules {
        let index = scans.len();
        let module = ModuleRef::Inner {
            file: text.file,
            callback: inner.callback,
        };
        scans.push(create_scan(module, CodeUnit::Function(inner.callback)));
        let exports = inner.exports_parameter;
        let exports = exports.map(|symbol| (symbol, index, Parameter::Exports));
        let module = inner.module_parameter;
        let module = module.map(|symbol| (symbol, index, Parameter::Module));
        parameters.extend(exports.into_iter().chain(module));
    }
    parameters.sort_unstable_by_key(|entry| entry.0);
    if input.is_file_a_module {
        let exports = Binding::CommonJs(CommonJsVariable::Exports);
        let stores = text.bound.runtime.unbound_name_stores().iter();
        let stores = stores.filter(|&&(target, _)| {
            text.bound.binding(target) == exports && !text.decisions.is_dead_expr(target)
        });
        let needs_wrapped_body = needs_wrapped_body(text);
        scans[0].found.needs_wrapped_body = needs_wrapped_body;
        scans[0].found.has_names = !needs_wrapped_body && !input.is_entry_point;
        scans[0].stores_to_exports_name = stores.count();
    }
    for expression in text.expressions() {
        if text.decisions.is_dead_expr(expression) {
            continue;
        }
        if input.is_file_a_module {
            scans[0].scan_expression_of_file(expression);
        }
        if parameters.is_empty() || !text.bound.is_evaluated_ident(expression) {
            continue;
        }
        let Binding::Symbol(symbol) = text.bound.binding(expression) else {
            continue;
        };
        let Ok(at) = parameters.binary_search_by_key(&symbol, |entry| entry.0) else {
            continue;
        };
        let (_, index, parameter) = parameters[at];
        match parameter {
            Parameter::Exports => scans[index].add_mention(expression, MentionKind::FirstObject),
            // It occurs only as `module.exports`.
            Parameter::Module => {
                if let (_, Parent::Expr(member)) = text.parent(expression) {
                    scans[index].add_mention(member, MentionKind::ModuleExports);
                }
            }
        }
    }
    if input.is_file_a_module {
        for statement in text.hir.ids(text.hir.body) {
            // `export = e` of TypeScript is the statement `module.exports = e`.
            if let StmtKind::ExportAssign(value) = text.hir[statement].kind {
                let literal = scans[0].find_literal(value);
                scans[0].replacements.push(Replacement {
                    statement: value,
                    is_statement_in_order: text.is_in_order(value, CodeUnit::File),
                    renames_exports: false,
                    literal,
                });
            }
        }
    }
    scans.iter_mut().for_each(Scan::finish);
    let first = usize::from(!input.is_file_a_module);
    scans.drain(first..).map(|scan| scan.found).collect()
}
