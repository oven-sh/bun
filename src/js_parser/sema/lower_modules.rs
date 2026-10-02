//! Import and export declarations: from the nodes that `parse_declarations` kept to `bun_sema::hir`.

use super::lower::Lower;
use bun_ast::ts_syntax as ts;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

#[inline]
fn pos(loc: bun_ast::Loc) -> u32 {
    // Nothing is noted of a node of `ts_syntax`.
    debug_assert!(!loc.is_index());
    loc.start.max(0) as u32
}

impl Lower<'_, '_> {
    /// `checkImportAttributes`
    pub(super) fn import_attributes(&mut self, attributes: ts::ImportAttributes) {
        let object = self.expr(&attributes.object);
        self.b
            .file
            .import_attributes
            .push((pos(attributes.keyword_loc), object));
    }

    /// What is written for a module specifier that is no string, and the import attributes after it.
    pub(super) fn unchecked_parts_of_module_specifier(&mut self, module: ts::ModuleSpecifier) {
        if let Some(expression) = module.expression {
            let expression = self.expr(&expression);
            self.b.file.specifier_expressions.push(expression);
        }
        if let Some(attributes) = module.attributes {
            self.import_attributes(attributes);
        }
    }

    /// The module specifier of an import or export declaration, which is noted as a use of that module. `NONE` if it is no string.
    /// `is_type_only`: after `import type` or `export type`, the only declarations whose `resolution-mode` counts
    /// (`getModeForUsageLocation`).
    fn module_specifier(
        &mut self,
        module: ts::ModuleSpecifier,
        kind: SpecifierKind,
        is_type_only: bool,
    ) -> (Atom, ResolutionMode) {
        self.unchecked_parts_of_module_specifier(module);
        let Some(text) = module.text else {
            return (Atom::NONE, ResolutionMode::None);
        };
        let spec = self.b.atom(&text);
        let mode = match module.mode {
            ts::ResolutionMode::Import if is_type_only => ResolutionMode::Import,
            ts::ResolutionMode::Require if is_type_only => ResolutionMode::Require,
            _ => ResolutionMode::None,
        };
        self.b.file.specifier_uses.push(SpecifierUse {
            spec,
            pos: pos(module.loc),
            kind,
            mode,
        });
        (spec, mode)
    }

    /// `ImportDeclaration`
    pub(super) fn import_declaration(&mut self, id: ts::Id<ts::Import>, at: u32) -> StmtId {
        let import = self.b.ts[id];
        // `isAnExternalModuleIndicatorNode`. `stmts` takes it back for what is not at the top level.
        self.b.file.has_module_syntax = true;
        let has_clause = import.default_name.is_some()
            || import.namespace.is_some()
            || import.specifiers.is_some();
        let kind = if has_clause {
            SpecifierKind::Import
        } else {
            SpecifierKind::SideEffect
        };
        let (spec, mode) = self.module_specifier(import.module, kind, import.is_type_only);
        if spec.is_none() && import.is_in_ambient_module {
            // The checker reads the text of a specifier that is written in `declare module "m" { }`.
            return self.b.file.stmt(StmtKind::Empty, at);
        }
        let declaration = ImportId(self.b.file.imports.len() as u32);
        let mut named = Vec::new();
        for specifier in import.specifiers.unwrap_or_default().iter() {
            let ts::Specifier {
                loc,
                is_type_only,
                property_name,
                name,
            } = self.b.ts[specifier];
            let imported = property_name.unwrap_or(name);
            named.push(ImportSpec {
                start: pos(loc),
                // `ImportSpec::is_name_missing`
                imported: if property_name.is_none() && name.is_string {
                    known::empty
                } else {
                    self.b.atom(&imported.text)
                },
                local: self.b.atom(&name.text),
                pos: pos(name.loc),
                type_only: is_type_only,
                imported_pos: pos(imported.loc),
                import: declaration,
            });
        }
        let named = self.b.file.add_import_specs(&named);
        let (default, default_pos) = match import.default_name {
            Some(name) => (self.b.atom(&name.text), pos(name.loc)),
            None => (Atom::NONE, 0),
        };
        let (namespace, namespace_pos, namespace_start) = match import.namespace {
            Some(ts::NamespaceImport { star_loc, name }) => {
                (self.b.atom(&name.text), pos(name.loc), pos(star_loc))
            }
            None => (Atom::NONE, 0, 0),
        };
        let declaration = self.b.file.add_import(Import {
            spec,
            default,
            default_pos,
            namespace,
            namespace_pos,
            clause_start: pos(import.clause_loc),
            clause_end: pos(import.clause_end),
            namespace_start,
            named,
            type_only: import.is_type_only,
            is_deferred: import.is_deferred,
            mode,
            stmt: StmtId::NONE,
        });
        self.b.file.stmt(StmtKind::Import(declaration), at)
    }

    /// `ImportEqualsDeclaration`. `flags`: what its modifiers and the context say (`EXPORT`, `AMBIENT`).
    pub(super) fn import_equals_declaration(
        &mut self,
        id: ts::Id<ts::ImportEquals>,
        mut flags: Flags,
        at: u32,
    ) -> StmtId {
        let import = self.b.ts[id];
        if import.is_type_only {
            flags |= Flags::TYPE_ONLY;
        }
        let mut expression = ExprId::NONE;
        let target = match import.reference {
            ts::ModuleReference::EntityName(names) => {
                let names: Vec<(Atom, u32)> = self.b.ts[names]
                    .iter()
                    .map(|name| (self.b.atom(&name.text), pos(name.loc)))
                    .collect();
                ImportEqualsTarget::Entity(self.b.file.entity_name(names.into_iter()))
            }
            ts::ModuleReference::External {
                text: Some(text),
                loc,
                ..
            } => {
                let spec = self.b.atom(&text);
                self.b.file.specifier_uses.push(SpecifierUse {
                    spec,
                    pos: pos(loc),
                    kind: SpecifierKind::Require,
                    mode: ResolutionMode::None,
                });
                ImportEqualsTarget::Require(spec)
            }
            ts::ModuleReference::External {
                text: None,
                expression: argument,
                ..
            } => {
                if import.is_in_ambient_module {
                    // The checker reads the text of a specifier that is written in `declare module "m" { }`.
                    return self.b.file.stmt(StmtKind::Empty, at);
                }
                if let Some(argument) = argument {
                    expression = self.expr(&argument);
                }
                ImportEqualsTarget::Require(Atom::NONE)
            }
        };
        let declaration = self.b.file.add_import_equals(ImportEquals {
            name: self.b.atom(&import.name.text),
            name_pos: pos(import.name.loc),
            target,
            expression,
            flags,
            stmt: StmtId::NONE,
        });
        self.b.file.stmt(StmtKind::ImportEquals(declaration), at)
    }

    /// `ExportDeclaration`
    pub(super) fn export_declaration(&mut self, id: ts::Id<ts::Export>, at: u32) -> StmtId {
        let export = self.b.ts[id];
        // `isAnExternalModuleIndicatorNode`. `stmts` takes it back for what is not at the top level.
        self.b.file.has_module_syntax = true;
        let (spec, mode) = match export.module {
            Some(module) => {
                self.module_specifier(module, SpecifierKind::Import, export.is_type_only)
            }
            None => (Atom::NONE, ResolutionMode::None),
        };
        let specifiers = match export.clause {
            // `checkExportDeclaration` looks no further than a specifier that is no string.
            ts::ExportClause::Star { .. } if spec.is_none() => {
                return self.b.file.stmt(StmtKind::Empty, at);
            }
            ts::ExportClause::Named(_) if export.module.is_some() && spec.is_none() => {
                return self.b.file.stmt(StmtKind::Empty, at);
            }
            ts::ExportClause::Star {
                star_loc,
                alias,
                alias_loc,
            } => {
                let kind = StmtKind::ExportStar {
                    spec,
                    alias: alias.map_or(Atom::NONE, |alias| self.b.atom(&alias.text)),
                    type_only: export.is_type_only,
                    mode,
                    star_pos: pos(star_loc),
                    alias_pos: pos(alias_loc),
                };
                return self.b.file.stmt(kind, at);
            }
            ts::ExportClause::Named(specifiers) => specifiers,
        };
        let declaration = ExportId(self.b.file.exports.len() as u32);
        let mut items = Vec::with_capacity(specifiers.len());
        for specifier in specifiers.iter() {
            let ts::Specifier {
                loc,
                is_type_only,
                property_name,
                name,
            } = self.b.ts[specifier];
            let local = property_name.unwrap_or(name);
            items.push(ExportSpec {
                start: pos(loc),
                local: self.b.atom(&local.text),
                exported: self.b.atom(&name.text),
                pos: pos(name.loc),
                type_only: is_type_only,
                local_pos: pos(local.loc),
                export: declaration,
            });
        }
        let items = self.b.file.add_export_specs(&items);
        let declaration = self.b.file.add_export(Export {
            spec,
            items,
            type_only: export.is_type_only,
            mode,
            stmt: StmtId::NONE,
        });
        self.b.file.stmt(StmtKind::ExportNamed(declaration), at)
    }

    /// `NamespaceExportDeclaration`, which makes no module of the file.
    pub(super) fn namespace_export_declaration(&mut self, name: ts::Name, at: u32) -> StmtId {
        let name = self.b.atom(&name.text);
        self.b.file.stmt(StmtKind::ExportAsNamespace(name), at)
    }
}
