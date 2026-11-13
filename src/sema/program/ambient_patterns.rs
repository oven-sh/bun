//! Pattern ambient modules, `declare module "*.css" with { type: "css" } { }`, and which of them an import resolves
//! to: `mergePatternAmbientModules`, `tryResolvePatternAmbientModule`.
//!
//! tsc relates the type of the import's attributes to the type literal after `with`. Modules are resolved before there
//! are types, so both are compared as written. That's exact for what `checkGrammarImportAttributesType` allows, a
//! required property whose type is a string literal. Of what it reports, a union of string literals and the name of a
//! global type alias for either are understood, and nothing is assignable to any other type.

use super::{FileId, Files, Sym, slice_in};
use crate::atom::Atom;
use crate::bind::Decl;
use crate::hir::{ExprId, ExprKind, MemberKind, ModuleName, TypeNodeId, TypeNodeKind};
use crate::util::FxHashMap;
use bun_core::strings;
use smallvec::SmallVec;

/// A property of the type literal after `with`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub struct ModuleAttribute<'s> {
    pub name: Atom,
    /// The string literal types its type is a union of, ordered by atom. Empty for any other type.
    pub values: &'s [Atom],
}

/// `ast.PatternAmbientModule`
#[derive(Copy, Clone)]
pub(super) struct AmbientPattern<'s> {
    /// The text before the `*`.
    pub prefix: &'s [u8],
    /// The text after the `*`.
    pub suffix: &'s [u8],
    pub symbol: Sym,
    /// `getTypeOfModuleImportAttributes(symbol)`, ordered by the atom of the name.
    pub attributes: &'s [ModuleAttribute<'s>],
}

/// `patternAmbientModuleAugmentations` and `patternAmbientModuleAugmentationTargets` for one module name.
#[derive(Copy, Clone)]
pub(super) struct PatternAugmentation {
    /// The augmentation, with the contents of the pattern merged into it.
    pub merged: Sym,
    /// The pattern ambient module that it augments.
    pub target: Sym,
}

/// A property of `getTypeFromImportAttributes`.
#[derive(Copy, Clone)]
pub struct ImportAttribute {
    pub name: Atom,
    /// The text, if the type is a string literal type.
    pub value: Option<Atom>,
}

pub type ImportAttributes = SmallVec<[ImportAttribute; 2]>;

/// `isTypeAssignableTo(importAttributesType, moduleAttributesType)`
fn is_assignable(import: &[ImportAttribute], module: &[ModuleAttribute]) -> bool {
    module.iter().all(|expected| {
        let given = import.iter().find(|given| given.name == expected.name);
        given.is_some_and(|given| given.value.is_some_and(|it| expected.values.contains(&it)))
    })
}

/// `isTypeStrictSubtypeOf(source, target) && !isTypeIdenticalTo(source, target)`
fn is_proper_subtype(source: &[ModuleAttribute], target: &[ModuleAttribute]) -> bool {
    source != target
        && target.iter().all(|expected| {
            let given = source.iter().find(|given| given.name == expected.name);
            given.is_some_and(|given| given.values.iter().all(|it| expected.values.contains(it)))
        })
}

impl<'s> Files<'s> {
    /// `getTypeFromImportAttributes` for the attributes `object` of `file`, an `ExprKind::Object`.
    pub fn import_attributes(&self, file: FileId, object: Option<ExprId>) -> ImportAttributes {
        let hir = self.hir(file);
        let mut attributes = ImportAttributes::new();
        let Some(ExprKind::Object(properties)) = object.map(|it| hir[it].kind) else {
            return attributes;
        };
        for property in properties.iter().map(|it| hir[it]) {
            let Some(name) = property.key.name() else {
                continue;
            };
            let value = match hir[property.value].kind {
                ExprKind::String(text) => Some(text),
                _ => None,
            };
            // `members[member.Name()] = member`: the last attribute with a given name wins.
            attributes.retain(|it| it.name != name);
            attributes.push(ImportAttribute { name, value });
        }
        attributes
    }

    /// `getTypeOfModuleImportAttributes`
    pub fn attributes_of_module(&self, module: Sym) -> &'s [ModuleAttribute<'s>] {
        // `core.Find(symbol.Declarations(), ast.IsModuleWithStringLiteralName)`
        let declarations = self.decls_of(module);
        let declared = declarations.iter().find_map(|&(file, it)| match it {
            Decl::Module(m) if matches!(self.hir(file)[m].name, ModuleName::String(_)) => {
                Some((file, self.hir(file)[m].attributes))
            }
            _ => None,
        });
        let Some((file, attributes)) = declared.filter(|it| it.1.is_some()) else {
            return &[];
        };
        let (mut patterns, module) = (self.ambient_patterns.iter(), self.canonical(module));
        match patterns.find(|it| self.canonical(it.symbol) == module) {
            Some(pattern) => pattern.attributes,
            // 1550
            None => self.attributes_of_type_literal(file, attributes),
        }
    }

    /// `getTypeOfModuleDeclarationImportAttributes` for the type literal `attributes` of `file`.
    fn attributes_of_type_literal(
        &self,
        file: FileId,
        attributes: TypeNodeId,
    ) -> &'s [ModuleAttribute<'s>] {
        let hir = self.hir(file);
        if attributes.is_none() {
            return &[];
        }
        let TypeNodeKind::Object(members) = hir[attributes].kind else {
            return &[];
        };
        let mut found: SmallVec<[ModuleAttribute<'s>; 2]> = SmallVec::new();
        for member in members.iter().map(|it| hir[it]) {
            let Some(name) = member.key.name() else {
                continue;
            };
            // The binder reports a second property with the same name.
            if found.iter().any(|it| it.name == name) {
                continue;
            }
            let mut values: SmallVec<[Atom; 2]> = SmallVec::new();
            if member.kind != MemberKind::Property
                || !self.string_literals_of_type(file, member.ty, 0, &mut values)
            {
                values.clear();
            }
            values.sort_unstable_by_key(|it| it.0);
            values.dedup();
            found.push(ModuleAttribute {
                name,
                values: slice_in(&values, self.arena),
            });
        }
        found.sort_unstable_by_key(|it| it.name.0);
        slice_in(&found, self.arena)
    }

    /// Adds the string literal types that the type `node` of `file` is a union of to `values`. Returns false if it
    /// isn't known to be such a union.
    fn string_literals_of_type(
        &self,
        file: FileId,
        node: TypeNodeId,
        depth: u32,
        values: &mut SmallVec<[Atom; 2]>,
    ) -> bool {
        let hir = self.hir(file);
        if node.is_none() || depth > 8 {
            return false;
        }
        match hir[node].kind {
            TypeNodeKind::StringLit(text) => values.push(text),
            TypeNodeKind::Union(types) => {
                return (hir.ids(types))
                    .all(|it| self.string_literals_of_type(file, it, depth + 1, values));
            }
            // A pattern ambient module is declared in a script, where names are global.
            TypeNodeKind::Ref { name, args } if name.len() == 1 && args.is_empty() => {
                let name = hir.texts(name).next().unwrap_or(Atom::NONE);
                let Some(&symbol) = self.globals.get(name) else {
                    return false;
                };
                let declarations = self.decls_of(symbol);
                let alias = declarations.iter().find_map(|&(file, it)| match it {
                    Decl::Alias(alias) => Some((file, self.hir(file)[alias])),
                    _ => None,
                });
                return alias.is_some_and(|(file, alias)| {
                    alias.type_params.is_empty()
                        && self.string_literals_of_type(file, alias.ty, depth + 1, values)
                });
            }
            _ => return false,
        }
        true
    }

    /// Adds `file.PatternAmbientModules` to `c.patternAmbientModules`.
    pub(super) fn add_pattern_ambient_modules(&mut self, file: FileId) {
        for at in 0..self.modules[file.idx()].bound.pattern_ambient_modules.len() {
            let (name, id) = self.modules[file.idx()].bound.pattern_ambient_modules[at];
            let text = self.atoms.bytes(name);
            let Some(star) = strings::index_of_char_usize(text, b'*') else {
                continue;
            };
            let mut declarations = self.modules[file.idx()].bound.symbol(id).decls.iter();
            let attributes = declarations.find_map(|it| match *it {
                Decl::Module(m) => Some(self.hir(file)[m].attributes),
                _ => None,
            });
            let pattern = AmbientPattern {
                prefix: slice_in(&text[..star], self.arena),
                suffix: slice_in(&text[star + 1..], self.arena),
                symbol: Sym { file, id },
                attributes: self
                    .attributes_of_type_literal(file, attributes.unwrap_or(TypeNodeId::NONE)),
            };
            self.ambient_patterns.push(pattern);
        }
    }

    /// `mergePatternAmbientModules`: "Pattern ambient modules are merged together if they have the same pattern and
    /// identical import attributes type." Call when all patterns are known.
    pub(super) fn merge_pattern_ambient_modules(&mut self) {
        if self.ambient_patterns.is_empty() {
            return;
        }
        let mut grouped: Vec<AmbientPattern<'s>> = Vec::with_capacity(self.ambient_patterns.len());
        // `groupsByPattern`
        let mut groups: FxHashMap<(&[u8], &[u8]), SmallVec<[usize; 1]>> = FxHashMap::default();
        for at in 0..self.ambient_patterns.len() {
            let pattern = self.ambient_patterns[at];
            let with_same_pattern = groups.entry((pattern.prefix, pattern.suffix)).or_default();
            let mut same = with_same_pattern.iter();
            match same.find(|&&group| grouped[group].attributes == pattern.attributes) {
                Some(&group) => {
                    let target = self.canonical(grouped[group].symbol);
                    // Scripts that declare the same name have been merged like any ambient module.
                    if target != self.canonical(pattern.symbol) {
                        grouped[group].symbol = self.merge_symbol(target, pattern.symbol, false);
                    }
                }
                None => {
                    with_same_pattern.push(grouped.len());
                    grouped.push(pattern);
                }
            }
        }
        self.ambient_patterns.clear();
        self.ambient_patterns.extend(grouped);
        let mut by_end: Vec<Vec<u32>> = vec![Vec::new(); 257];
        for (at, pattern) in self.ambient_patterns.iter().enumerate() {
            let end = pattern.suffix.last().map_or(256, |&end| usize::from(end));
            by_end[end].push(at as u32);
        }
        let arena = self.arena;
        let by_end = by_end.iter().map(|patterns| slice_in(patterns, arena));
        self.ambient_patterns_by_end = arena.alloc_slice_fill_iter(by_end);
    }

    /// True if `module` is `getMergedSymbol(module.Symbol)` of a pattern ambient module.
    pub(super) fn is_pattern_ambient_module(&self, module: Sym) -> bool {
        let (mut patterns, module) = (self.ambient_patterns.iter(), self.canonical(module));
        patterns.any(|it| self.canonical(it.symbol) == module)
    }

    /// `tryResolvePatternAmbientModule`, when `resolvedSymbol` isn't the answer: the pattern ambient module that
    /// `spec` resolves to when it's imported with `attributes`.
    pub(super) fn pattern_ambient_module(
        &self,
        spec: Atom,
        attributes: &[ImportAttribute],
    ) -> Option<Sym> {
        let text = self.atoms.bytes(spec);
        let is_candidate = |at: &u32| {
            let pattern = &self.ambient_patterns[*at as usize];
            text.len() >= pattern.prefix.len() + pattern.suffix.len()
                && text.starts_with(pattern.prefix)
                && text.ends_with(pattern.suffix)
                && is_assignable(attributes, pattern.attributes)
        };
        let mut candidates: SmallVec<[u32; 4]> = match self.ambient_patterns_by_end.split_last() {
            Some((ending_with_the_star, by_end)) => {
                let same_ending = text.last().map_or(&[][..], |&end| by_end[usize::from(end)]);
                let may_match = same_ending.iter().chain(*ending_with_the_star).copied();
                may_match.filter(is_candidate).collect()
            }
            None => (0..self.ambient_patterns.len() as u32)
                .filter(is_candidate)
                .collect(),
        };
        let attributes_of = |at: u32| self.ambient_patterns[at as usize].attributes;
        if candidates.iter().any(|&at| !attributes_of(at).is_empty()) {
            let all = candidates.clone();
            candidates.retain(|candidate| {
                let candidate = attributes_of(*candidate);
                !(all.iter()).any(|&other| is_proper_subtype(attributes_of(other), candidate))
            });
        }
        // `FindBestPatternMatch`: the longest prefix wins, and on a tie the earliest pattern.
        let best = (candidates.iter()).min_by_key(|&&at| {
            (
                usize::MAX - self.ambient_patterns[at as usize].prefix.len(),
                at,
            )
        })?;
        let best = self.canonical(self.ambient_patterns[*best as usize].symbol);
        match self.pattern_augmentations.get(&spec) {
            Some(augmentation) if self.canonical(augmentation.target) == best => {
                Some(self.canonical(augmentation.merged))
            }
            _ => Some(best),
        }
    }
}
