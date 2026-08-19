//! `--zod-compiler`. `import "zod/compile"` makes zod compile every schema
//! constructed after it evaluates into a specialized validator on first parse.
//! Prepending that import to each module that imports zod puts it ahead of the
//! schemas the module constructs, whatever order the modules evaluate in.
//!
//! Two phases: `inject_zod_compile_import` adds the import while the parts are
//! assembled, which is before `to_ast` scans the import statements and flags
//! type-only imports as unused. `finish_zod_compile_import` runs after that
//! scan and retracts the import when every zod import of the module turned out
//! to be unused.

use bun_ast as js_ast;
use bun_ast::{E, S};
use bun_collections::VecExt;

use crate::p::P;

pub const ZOD_COMPILE_SPECIFIER: &[u8] = b"zod/compile";

/// The resolution error for the generated import. The plain "could not
/// resolve" message would point at an import the user never wrote.
pub const ZOD_COMPILE_UNRESOLVED: &str = concat!(
    "Could not resolve: \"zod/compile\". ",
    "The zod compiler option adds this import to every module that imports zod. ",
    "It needs a version of zod that exports \"zod/compile\".",
);

fn is_zod_specifier(specifier: &[u8]) -> bool {
    specifier == b"zod" || specifier.starts_with(b"zod/")
}

impl<'a, const TS: bool, const SCAN_ONLY: bool> P<'a, TS, SCAN_ONLY> {
    /// The range of the first zod import that evaluates with the module. The
    /// generated import record reports its resolution errors there. `None`
    /// when there is no such import, or when the module imports `zod/compile`
    /// itself (`skip` leaves the generated record out of that check).
    fn zod_import_range(&self, skip: Option<u32>) -> Option<bun_ast::Range> {
        let mut range = None;
        for (index, record) in self.import_records.items().iter().enumerate() {
            if skip == Some(index as u32) {
                continue;
            }
            let specifier = record.path.text;
            if !is_zod_specifier(specifier) {
                continue;
            }
            if specifier == ZOD_COMPILE_SPECIFIER {
                return None;
            }
            // `import()` stays lazy.
            if record.flags.contains(js_ast::ImportRecordFlags::IS_UNUSED)
                || !matches!(
                    record.kind,
                    js_ast::ImportKind::Stmt | js_ast::ImportKind::Require
                )
            {
                continue;
            }
            range.get_or_insert(record.range);
        }
        range
    }

    pub(crate) fn inject_zod_compile_import(
        &mut self,
        exports_kind: js_ast::ExportsKind,
        before: &mut bun_alloc::ArenaVec<'_, js_ast::Part>,
    ) -> Result<(), crate::Error> {
        debug_assert!(self.zod_compile_import_record.is_none());
        let Some(range) = self.zod_import_range(None) else {
            return Ok(());
        };

        let part = if exports_kind == js_ast::ExportsKind::Cjs {
            // An import statement would make this CommonJS module a mixed one.
            // A `require()` is normally registered with its part while it is
            // visited, so do that by hand.
            let import_record_index = self.add_import_record_by_range(
                js_ast::ImportKind::Require,
                range,
                ZOD_COMPILE_SPECIFIER,
            );
            self.zod_compile_import_record = Some(import_record_index);
            let value = self.new_expr(
                E::RequireString {
                    import_record_index,
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );
            let stmt = self.s(
                S::SExpr {
                    value,
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );
            js_ast::Part {
                stmts: self.arena.alloc_slice_fill_with(1, |_| stmt).into(),
                import_record_indices: js_ast::PartImportRecordIndices::init_one(
                    import_record_index,
                ),
                tag: js_ast::PartTag::ZodCompiler,
                ..Default::default()
            }
        } else {
            // The import scan in `to_ast` registers the record with the part.
            // Declaring the namespace symbol is the visit pass's job, which this
            // statement skipped.
            let import_record_index = self.add_import_record_by_range(
                js_ast::ImportKind::Stmt,
                range,
                ZOD_COMPILE_SPECIFIER,
            );
            self.zod_compile_import_record = Some(import_record_index);
            self.import_records.items_mut()[import_record_index as usize]
                .flags
                .insert(js_ast::ImportRecordFlags::WAS_ORIGINALLY_BARE_IMPORT);
            let namespace_ref =
                self.declare_generated_symbol(js_ast::symbol::Kind::Other, b"import_zod_compile");
            let stmt = self.s(
                S::Import {
                    namespace_ref,
                    import_record_index,
                    is_single_line: true,
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );
            js_ast::Part {
                stmts: self.arena.alloc_slice_fill_with(1, |_| stmt).into(),
                declared_symbols: js_ast::DeclaredSymbolList::from_slice(&[
                    js_ast::DeclaredSymbol {
                        ref_: namespace_ref,
                        is_top_level: true,
                    },
                ])?,
                tag: js_ast::PartTag::ZodCompiler,
                ..Default::default()
            }
        };

        // When bundling, `before` holds the reserved namespace export part
        // (`NAMESPACE_EXPORT_PART_INDEX`) followed by the module's own import
        // statements. Going in ahead of those covers schemas that the imported
        // modules construct while they load, the same as writing the import on
        // the first line by hand.
        let index = usize::from(self.options.bundle);
        debug_assert!(index <= before.len());
        before.insert(index, part);
        Ok(())
    }

    /// An unused import record is neither resolved nor printed, so this takes
    /// the generated import back out when the zod imports that asked for it
    /// were all type-only.
    pub(crate) fn finish_zod_compile_import(&mut self) {
        let Some(index) = self.zod_compile_import_record else {
            return;
        };
        if self.zod_import_range(Some(index)).is_none() {
            self.import_records.items_mut()[index as usize]
                .flags
                .insert(js_ast::ImportRecordFlags::IS_UNUSED);
        }
    }
}
