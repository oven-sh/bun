use crate::check::Checker;
use crate::hir::{INVALID_CHARACTER, Reader, rare};
use crate::module_format::{DeclaredModuleType, ModuleFormat};
use crate::program::FileId;

impl Checker<'_, '_> {
    /// The legacy HTML comment at `start..end` of `file` is an error in a module. The parser has reported it in a file that `import`, `export` or a
    /// top-level `await` makes one for `bun run`. Of the others a file is none if its own syntax makes it CommonJS. After that its name decides, however
    /// the file is loaded.
    #[cold]
    pub(super) fn check_legacy_html_comment(&mut self, file: FileId, (start, end): (u32, u32)) {
        let hir = self.hir(file);
        let Some(compiled) = self.files.compiled(file) else {
            return;
        };
        let analysis = &compiled.analysis;
        let runs_as_commonjs = analysis.module_format == ModuleFormat::CommonJs;
        let is_commonjs_by_syntax =
            runs_as_commonjs && analysis.module_formats.is_decided_by_text();
        let is_module = match hir.reader_at(start) {
            Reader::Engine => !runs_as_commonjs,
            Reader::ParserOfBunRun if is_commonjs_by_syntax => false,
            Reader::ParserOfBunRun => {
                let path = self.files.module(file).file_name();
                match DeclaredModuleType::by_file_name(path, compiled.type_where_imported) {
                    DeclaredModuleType::Esm => true,
                    DeclaredModuleType::CommonJs => false,
                    // Nothing says what the file is. `import.meta` does, if the file does not run as CommonJS all the same.
                    DeclaredModuleType::Unknown => {
                        hir.rare_syntax & rare::IMPORT_META != 0 && !runs_as_commonjs
                    }
                }
            }
        };
        if is_module {
            self.early_error_at((file, start, end), INVALID_CHARACTER, &[]);
        }
    }
}
