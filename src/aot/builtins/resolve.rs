mod aliases;
mod evaluated_text;
mod imports;
mod mention_use;
mod mentions;
mod module_objects;
mod module_values;
mod paths;
mod resolver;
mod runtime_dialect;
#[cfg(test)]
mod tests;
mod walked_texts;

pub use self::imports::find_module_export;
pub use self::module_values::commonjs_variable_builtin;
pub use self::resolver::FileFacts;
use super::names::BuiltinNames;
use super::runtime_uses::RuntimeUses;
use super::table::{
    self, BuiltinId, Intrinsic, Mutability, Platforms, RuntimeFunction, RuntimeModule,
};
use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, Bound, CommonJsVariable, SymbolId};
use bun_sema::fold::Decisions;
use bun_sema::hir::{self, Chain, ExprId, ExprKind, MemberKey, NodeData};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::module_format::ModuleFormat;
use core::ops::Range;
use smallvec::SmallVec;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum SourceDialect {
    Program,
    Runtime,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct BuiltinPath {
    pub id: BuiltinId,
    pub mutability: Mutability,
}

impl BuiltinPath {
    // A locked number, accessor or data property stays a read, which the engine folds: no operation names one.
    pub fn locked_builtin(self) -> Option<BuiltinId> {
        let is_locked = self.mutability == Mutability::AlwaysLocked;
        (is_locked && table::is_legal_builtin_constant(self.id)).then_some(self.id)
    }
}

#[derive(Copy, Clone, Debug)]
pub enum Resolved {
    Builtin(BuiltinPath),
    DynamicGlobal(BuiltinPath),
    Intrinsic(Intrinsic),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum EvaluatedTextForm {
    FunctionBody,
    Script,
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct EvaluatedText {
    pub call: ExprId,
    pub form: EvaluatedTextForm,
    pub callee: BuiltinPath,
    pub texts: SmallVec<[Atom; 2]>,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ModuleExport {
    Unknown,
    Absent,
    HeldByNamespace,
    PropertyOfNamespace(BuiltinId),
    Found(BuiltinId),
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleObjectOwner {
    /// `module`.
    OwnFile,
    /// `require.main` and `process.mainModule`: the file that the process, or the Worker, has started with.
    EntryPoint,
    /// A file that `parent` or an element of `children` leads to, or a binding that something has stored a module object into.
    Related,
}

/// A member of a module object whose value the record of the module has.
#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleField {
    Id,
    Filename,
    Path,
    Loaded,
}

#[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
pub enum ModuleObjectUse {
    /// `module.id`, `require.main.filename`: a plain read off what is that object in every run.
    Field(ModuleField),
    /// `!require.main`: only whether there is an object.
    Tested,
    /// `!module.parent`: only whether there is a parent.
    ParentTested,
    /// `module.parent` as a value: the objects of the files that request the owner.
    Parent,
    /// `module.children`, read or stored: the objects of the files that the owner requires.
    Children,
    /// The object is held, compared, stored into, or asked for a member that is none of the above.
    Object,
    /// The object, or the list of them, goes where nothing follows it. Whoever gets it reads any member, `parent` and `children` among them.
    HandedOn,
    /// `process` goes where nothing follows it. Whoever gets it may read `mainModule` there.
    HolderHandedOn,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ModuleObjectMention {
    /// The member for `Field`, `ParentTested`, `Parent` and `Children`, else what stands for the object.
    pub expr: ExprId,
    pub owner: ModuleObjectOwner,
    pub object_use: ModuleObjectUse,
}

pub struct ImportTargets {
    targets: Vec<(ImportSiteKind, Option<RuntimeModule>)>,
}

impl ImportTargets {
    pub fn new(targets: &[(ImportSiteKind, Option<RuntimeModule>)]) -> ImportTargets {
        debug_assert!(targets.is_sorted_by(|left, right| left.0 < right.0));
        ImportTargets {
            targets: targets.to_vec(),
        }
    }

    fn module_at(&self, site: ImportSiteKind) -> Option<RuntimeModule> {
        let at = self.targets.binary_search_by_key(&site, |target| target.0);
        at.ok().and_then(|at| self.targets[at].1)
    }

    fn has_site(&self, site: ImportSiteKind) -> bool {
        self.targets
            .binary_search_by_key(&site, |target| target.0)
            .is_ok()
    }

    fn iter(&self) -> impl Iterator<Item = (ImportSiteKind, RuntimeModule)> + '_ {
        let targets = self.targets.iter();
        targets.filter_map(|&(site, module)| module.map(|module| (site, module)))
    }
}

pub struct ResolveInput<'a, 's> {
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub decisions: &'a Decisions<'s>,
    pub module_format: ModuleFormat,
    pub targets: &'a ImportTargets,
    pub names: &'a BuiltinNames,
    pub platform: Platforms,
    pub dialect: SourceDialect,
}

#[derive(Copy, Clone, Default)]
struct CommonJsBuiltins {
    module: Option<BuiltinPath>,
    exports: Option<BuiltinPath>,
    require: Option<BuiltinPath>,
    filename: Option<BuiltinPath>,
    dirname: Option<BuiltinPath>,
}

impl CommonJsBuiltins {
    fn get(&self, variable: CommonJsVariable) -> Option<BuiltinPath> {
        match variable {
            CommonJsVariable::Module => self.module,
            CommonJsVariable::Exports => self.exports,
            CommonJsVariable::Require => self.require,
            CommonJsVariable::Filename => self.filename,
            CommonJsVariable::Dirname => self.dirname,
        }
    }

    fn set(&mut self, variable: CommonJsVariable, path: Option<BuiltinPath>) {
        match variable {
            CommonJsVariable::Module => self.module = path,
            CommonJsVariable::Exports => self.exports = path,
            CommonJsVariable::Require => self.require = path,
            CommonJsVariable::Filename => self.filename = path,
            CommonJsVariable::Dirname => self.dirname = path,
        }
    }
}

#[derive(Default)]
pub struct ResolvedBuiltins {
    exprs: Box<[(ExprId, Resolved)]>,
    expr_bits: Box<[u64]>,
    exprs_with_side_effects: Box<[ExprId]>,
    symbols: Box<[(SymbolId, BuiltinPath)]>,
    commonjs: CommonJsBuiltins,
    evaluated_texts: Box<[EvaluatedText]>,
    module_object_mentions: Box<[ModuleObjectMention]>,
    stores_with_module_exports: Box<[ExprId]>,
    mentioned: Box<[BuiltinId]>,
    #[cfg(test)]
    exposed: Box<[BuiltinId]>,
    uses: RuntimeUses,
    guessed_uses: RuntimeUses,
    loads_unknown_modules: bool,
}

impl ResolvedBuiltins {
    pub fn of_expr(&self, expr: ExprId) -> Option<Resolved> {
        let index = expr.idx();
        let word = *self.expr_bits.get(index / 64)?;
        if word & (1 << (index % 64)) == 0 {
            return None;
        }
        let at = self.exprs.binary_search_by_key(&expr, |entry| entry.0);
        at.ok().map(|at| self.exprs[at].1)
    }

    /// `of_expr` resolves the value of `(f(), Object.keys)` and `(f(), module).exports` too. Whatever stands in for an expression, or drops it, asks this one.
    pub fn of_pure_expr(&self, expr: ExprId) -> Option<Resolved> {
        let has_side_effects = self.exprs_with_side_effects.binary_search(&expr).is_ok();
        self.of_expr(expr).filter(|_| !has_side_effects)
    }

    /// `Object.keys` gives `[Object.keys, Object]`. It answers only for a free name and for named, non-optional member reads on one.
    pub fn global_path(
        &self,
        hir: &hir::File<'_>,
        bound: &Bound<'_>,
        expr: ExprId,
    ) -> Option<SmallVec<[BuiltinPath; 4]>> {
        let mut steps = SmallVec::new();
        let mut current = hir.skip_type_assertions(expr);
        loop {
            let Some(Resolved::Builtin(path)) = self.of_pure_expr(current) else {
                return None;
            };
            steps.push(path);
            match hir[current].kind {
                ExprKind::Dot {
                    chain: Chain::No, ..
                }
                | ExprKind::Index {
                    chain: Chain::No, ..
                } => match hir.member_key(current)? {
                    (object, MemberKey::Name(_)) => current = hir.skip_type_assertions(object),
                    (_, MemberKey::PrivateName(_) | MemberKey::Computed(_)) => return None,
                },
                ExprKind::Ident(_) => {
                    let is_free_name = bound.is_evaluated_ident(current)
                        && bound
                            .dynamic_lookup_scope(NodeData::Expr(current))
                            .is_none()
                        && bound.binding(current) == Binding::Free;
                    return is_free_name.then_some(steps);
                }
                _ => return None,
            }
        }
    }

    pub fn builtin_of_expression(&self, expr: ExprId) -> Option<BuiltinId> {
        match self.of_expr(expr)? {
            Resolved::Builtin(path) => Some(path.id),
            Resolved::Intrinsic(Intrinsic::Builtin(id)) => Some(id),
            Resolved::DynamicGlobal(_) | Resolved::Intrinsic(_) => None,
        }
    }

    pub fn of_symbol(&self, symbol: SymbolId) -> Option<BuiltinPath> {
        let at = self.symbols.binary_search_by_key(&symbol, |entry| entry.0);
        at.ok().map(|at| self.symbols[at].1)
    }

    pub fn commonjs_variable(&self, variable: CommonJsVariable) -> Option<BuiltinPath> {
        self.commonjs.get(variable)
    }

    pub fn evaluated_text(&self, call: ExprId) -> Option<&EvaluatedText> {
        let texts = &self.evaluated_texts;
        let at = texts.binary_search_by_key(&call, |text| text.call).ok()?;
        Some(&texts[at])
    }

    pub fn evaluated_texts(&self) -> &[EvaluatedText] {
        &self.evaluated_texts
    }

    /// In the order of the expressions.
    pub fn module_object_mentions(&self) -> &[ModuleObjectMention] {
        &self.module_object_mentions
    }

    pub fn module_object_mention(&self, expr: ExprId) -> Option<ModuleObjectMention> {
        let mentions = &self.module_object_mentions;
        let at = mentions
            .binary_search_by_key(&expr, |mention| mention.expr)
            .ok()?;
        Some(mentions[at])
    }

    /// Whether `target` is the name `exports` in `exports = module.exports = value` as a statement of the body of a CommonJS file: from there on both name the one value, so the store needs no parameter to go to.
    pub fn is_stored_with_module_exports(&self, target: ExprId) -> bool {
        self.stores_with_module_exports.contains(&target)
    }

    pub fn mentioned(&self) -> &[BuiltinId] {
        &self.mentioned
    }

    #[cfg(test)]
    pub fn exposed(&self) -> &[BuiltinId] {
        &self.exposed
    }

    pub fn uses(&self) -> &RuntimeUses {
        &self.uses
    }

    /// `MentionedUses::guessed` of a file of the program.
    pub fn guessed_uses(&self) -> &RuntimeUses {
        &self.guessed_uses
    }

    pub fn loads_unknown_modules(&self) -> bool {
        self.loads_unknown_modules
    }

    pub fn loaded_modules(&self) -> impl Iterator<Item = RuntimeModule> + '_ {
        self.uses.modules.iter().copied()
    }

    pub fn called_functions(&self) -> impl Iterator<Item = RuntimeFunction> + '_ {
        self.uses.functions.iter().copied()
    }
}

pub fn resolve_file(input: &ResolveInput<'_, '_>) -> ResolvedBuiltins {
    resolver::run(input, None, None)
}

/// The built-ins of a part of a file: the code in these ranges of positions, which are in order and do not overlap.
pub fn resolve_within(
    input: &ResolveInput<'_, '_>,
    ranges: &[Range<u32>],
    facts: &FileFacts,
) -> ResolvedBuiltins {
    resolver::run(input, Some(ranges), Some(facts))
}
