//! A built-in that goes from one file to another under a binding: `export const { getPrototypeOf } = Object` here, `import { getPrototypeOf } from "./tools"` there.
//! What a file exports that way, and what a file that loads it gets. By the bindings alone: a name that something stores to stands for nothing.

use super::aliases::declared_names;
use super::resolver::{AliasSource, HolderKind, ResolvedValue, Resolver};
use super::{BuiltinExported, BuiltinPath, BuiltinsOfLoadedFile};
use crate::builtins::table::{self, BuiltinId, Mutability};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, BindingInitializer, CommonJsVariable, Decl, SymbolId};
use bun_sema::hir::{
    ExportSpecId, ExprId, ExprKind, Flags, MemberKey, PatKind, PropKey, PropKind, StmtKind,
};
use bun_sema::import_sites::ImportSiteKind;
use bun_sema::util::FxHashMap;
use smallvec::{SmallVec, smallvec};

type Names = SmallVec<[Atom; 2]>;
// What stands under these names of a file's exports, if that is a built-in.
type Bound = (Names, Option<BuiltinId>);
/// The load that a value is read from, and the names from there on.
pub(super) type WayOutOfLoadedFile<'a> = (&'a BuiltinsOfLoadedFile, Names);

impl BuiltinsOfLoadedFile {
    fn find(&self, path: &[Atom]) -> Option<BuiltinId> {
        let find = |path: &[Atom]| {
            let mut exported = self.exported.iter();
            exported
                .find(|it| it.path[..] == *path)
                .map(|it| it.builtin)
        };
        find(path).or_else(|| {
            // What `import * as` gives is an object of its own.
            let is_property = self.object_is_default
                && path.first().is_some_and(|&first| first != known::default);
            let below_default: Names = core::iter::once(known::default)
                .chain(path.iter().copied())
                .collect();
            find(&below_default).filter(|_| is_property)
        })
    }
}

impl<'a> Resolver<'a, '_> {
    /// `tools.proto` behind `import * as tools`, `require("node:console")`, `(await import("./tools")).proto`, and a name that is bound to one of these.
    pub(super) fn find_builtin_out_of_loaded_file(&self, expr: ExprId) -> Option<ResolvedValue> {
        if self.input.targets.loaded_files.is_empty() {
            return None;
        }
        let (file, path) = self.find_way_out_of_loaded_file(expr, &mut SmallVec::new())?;
        file.find(&path).map(value_of_exported)
    }

    fn find_way_out_of_loaded_file(
        &self,
        expr: ExprId,
        seen: &mut SmallVec<[SymbolId; 4]>,
    ) -> Option<WayOutOfLoadedFile<'a>> {
        let (hir, targets) = (self.input.hir, self.input.targets);
        let expr = hir.skip_type_assertions(expr);
        match hir[expr].kind {
            ExprKind::Ident(_) => match self.input.bound.binding(expr) {
                Binding::Symbol(symbol) => self.find_way_of_name_out_of_loaded_file(symbol, seen),
                Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
            },
            ExprKind::Call(_) => {
                let sites = [
                    ImportSiteKind::Require(expr),
                    ImportSiteKind::ImportMetaRequire(expr),
                    ImportSiteKind::GetBuiltinModule(expr),
                ];
                let file = (sites.into_iter()).find_map(|site| targets.loaded_file_at(site))?;
                Some(match file.object_is_default {
                    true => (file, smallvec![known::default]),
                    false => (file, Names::new()),
                })
            }
            ExprKind::Await(promise) => {
                let site = ImportSiteKind::ImportCall(hir.skip_type_assertions(promise));
                Some((targets.loaded_file_at(site)?, Names::new()))
            }
            _ => {
                let (object, MemberKey::Name(name)) = hir.member_key(expr)? else {
                    return None;
                };
                let (file, mut path) = self.find_way_out_of_loaded_file(object, seen)?;
                path.push(name);
                Some((file, path))
            }
        }
    }

    // Asked once for a name, however often the file reads it.
    fn find_way_of_name_out_of_loaded_file(
        &self,
        symbol: SymbolId,
        seen: &mut SmallVec<[SymbolId; 4]>,
    ) -> Option<WayOutOfLoadedFile<'a>> {
        if let Some(known) = self.ways_out_of_loaded_files.borrow().get(&symbol) {
            return known.clone();
        }
        let way = self.compute_way_of_name_out_of_loaded_file(symbol, seen);
        let known = way.clone();
        (self.ways_out_of_loaded_files.borrow_mut()).insert(symbol, known);
        way
    }

    fn compute_way_of_name_out_of_loaded_file(
        &self,
        symbol: SymbolId,
        seen: &mut SmallVec<[SymbolId; 4]>,
    ) -> Option<WayOutOfLoadedFile<'a>> {
        let (hir, bound, targets) = (self.input.hir, self.input.bound, self.input.targets);
        let file_of = |import| targets.loaded_file_at(ImportSiteKind::Import(import));
        match *bound.symbol(symbol).decls {
            [Decl::ImportNamespace(import)] => return Some((file_of(import)?, Names::new())),
            [Decl::ImportDefault(import)] => {
                return Some((file_of(import)?, smallvec![known::default]));
            }
            [Decl::ImportSpec(spec)] => {
                return Some((file_of(hir[spec].import)?, smallvec![hir[spec].imported]));
            }
            _ => {}
        }
        // `const a = a.b`
        if seen.contains(&symbol) || !self.is_stable(symbol) {
            return None;
        }
        seen.push(symbol);
        match bound.binding_initializer(hir, symbol) {
            BindingInitializer::Expression(initializer) => {
                self.find_way_out_of_loaded_file(initializer, seen)
            }
            BindingInitializer::PatternProperty {
                source,
                path: names,
            } => {
                let (file, mut path) = self.find_way_out_of_loaded_file(source, seen)?;
                path.extend(names);
                Some((file, path))
            }
            _ => None,
        }
    }

    fn find_builtin_bound_to(&self, symbol: SymbolId) -> Option<BuiltinId> {
        let out_of_file = || {
            let (file, path) =
                self.find_way_of_name_out_of_loaded_file(symbol, &mut SmallVec::new())?;
            file.find(&path)
        };
        let value = match self.aliases.get(&symbol) {
            Some(AliasSource::Known(value)) => Some(*value),
            Some(AliasSource::Initializer {
                initializer,
                members,
            }) => {
                let value = self.value_of(*initializer);
                let value = value.or_else(|| self.held_value_of(*initializer));
                members.iter().try_fold(value?, |value, &name| {
                    self.find_member(value, name).map(ResolvedValue::object)
                })
            }
            None => None,
        };
        match value {
            Some(value) if value.kind == HolderKind::Object => Some(value.path.id),
            Some(_) => None,
            None => out_of_file(),
        }
    }

    // `{ holder: Object, parse: JSON.parse }`, also behind a name that nothing else is stored to.
    fn add_builtins_in_properties(&self, object: ExprId, found: &mut Vec<Bound>) {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut object = hir.skip_type_assertions(object);
        if let (ExprKind::Ident(_), Binding::Symbol(symbol)) =
            (hir[object].kind, bound.binding(object))
            && self.is_stable(symbol)
            && let BindingInitializer::Expression(initializer) =
                bound.binding_initializer(hir, symbol)
        {
            object = hir.skip_type_assertions(initializer);
        }
        let ExprKind::Object(properties) = hir[object].kind else {
            return;
        };
        for property in properties.iter().map(|property| hir[property]) {
            if let (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) =
                (property.kind, property.key)
            {
                let path = smallvec![known::default, name];
                found.push((path, self.find_builtin(property.value)));
            }
        }
    }

    // `module.exports` and `exports`: no names. `module.exports.holder` and `exports.holder`: that name.
    fn find_name_below_exports(&self, target: ExprId) -> Option<Option<Atom>> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let is_variable = |expr: ExprId, variable: CommonJsVariable| {
            let expr = hir.skip_type_assertions(expr);
            matches!(hir[expr].kind, ExprKind::Ident(_))
                && bound.binding(expr) == Binding::CommonJs(variable)
        };
        let is_exports = |expr: ExprId| {
            is_variable(expr, CommonJsVariable::Exports)
                || matches!(hir.member_key(hir.skip_type_assertions(expr)),
                    Some((object, MemberKey::Name(name)))
                        if name == known::exports && is_variable(object, CommonJsVariable::Module))
        };
        let target = hir.skip_type_assertions(target);
        if is_exports(target) {
            // A store to the name `exports` changes what the name holds, and not what the file exports.
            return (!is_variable(target, CommonJsVariable::Exports)).then_some(None);
        }
        match hir.member_key(target)? {
            (object, MemberKey::Name(name)) if is_exports(object) => Some(Some(name)),
            _ => None,
        }
    }

    /// `ResolvedBuiltins::builtins_exported`
    pub(super) fn find_builtins_exported(&self) -> Vec<BuiltinExported> {
        let (hir, bound) = (self.input.hir, self.input.bound);
        let mut found: Vec<Bound> = Vec::new();
        // `export { protoOf }`, `export { protoOf as default }`
        for spec in (0..hir.export_specs.len() as u32).map(ExportSpecId) {
            let (item, export) = (hir[spec], hir[hir[spec].export]);
            if !export.has_module_specifier
                && !export.type_only
                && !item.type_only
                && let Binding::Symbol(symbol) = bound.exported_binding(spec)
            {
                let path = smallvec![item.exported];
                found.push((path, self.find_builtin_bound_to(symbol)));
            }
        }
        // `export const proto = Array.prototype`, `export const { getPrototypeOf } = Object`
        for (pattern, symbol) in declared_names(self.input) {
            if let PatKind::Ident(name) = hir[pattern].kind
                && (bound.modifier_flags(hir, Decl::Var(pattern))).contains(Flags::EXPORT)
            {
                found.push((smallvec![name], self.find_builtin_bound_to(symbol)));
            }
        }
        for statement in hir.stmts.iter() {
            if let StmtKind::ExportDefault(value) = statement.kind {
                found.push((smallvec![known::default], self.find_builtin(value)));
                self.add_builtins_in_properties(value, &mut found);
            }
        }
        // `module.exports = JSON`, `module.exports = { holder: Object }`, `exports.holder = Object`
        for expr in self.evaluated_ids().map(ExprId) {
            if let ExprKind::Assign {
                op: None,
                target,
                value,
            } = hir[expr].kind
                && let Some(name) = self.find_name_below_exports(target)
            {
                let path = core::iter::once(known::default).chain(name).collect();
                found.push((path, self.find_builtin(value)));
                if name.is_none() {
                    self.add_builtins_in_properties(value, &mut found);
                }
            }
        }
        // Two stores under one name leave nobody knowing which of them holds.
        let mut places: FxHashMap<Names, usize> = FxHashMap::default();
        let mut kept: Vec<Bound> = Vec::new();
        for (path, builtin) in found {
            let next = kept.len();
            let at = *places.entry(path.clone()).or_insert(next);
            match kept.get_mut(at) {
                Some(before) if before.1 != builtin => before.1 = None,
                Some(_) => {}
                None => kept.push((path, builtin)),
            }
        }
        let kept = kept.into_iter();
        kept.filter_map(|(path, builtin)| Some((path, builtin?)))
            .map(|(path, builtin)| BuiltinExported { path, builtin })
            .collect()
    }
}

fn value_of_exported(builtin: BuiltinId) -> ResolvedValue {
    ResolvedValue::object(BuiltinPath {
        id: table::canonical_id(builtin),
        mutability: Mutability::ConstantUnlessWritten,
    })
}
