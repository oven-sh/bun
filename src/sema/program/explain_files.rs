//! `Program.ExplainFiles`: what `explainFiles` prints.

use super::{
    FileId, Files, IncludeReason, Included, Module, Reference, Visit, implied_format_reason,
};
use crate::messages;
use crate::resolve::{Host, Resolver};
use crate::session::Session;

impl Files<'_> {
    /// The lines. `to_relative_file_name`: `toRelativeFileName`.
    pub fn explain_files(
        &self,
        host: &dyn Host,
        to_relative_file_name: &dyn Fn(&[u8]) -> Vec<u8>,
    ) -> Vec<Vec<u8>> {
        let included = Included {
            host,
            options: self.options,
            atoms: &self.atoms,
            modules: &self.modules,
            by_path: &self.by_path,
            roots: &self.options.files,
            starts: self.starts,
            libs_end: self.libs_end,
            roots_end: self.roots_end,
            root_of_start: self.root_of_start,
        };
        let resolving = Session::new();
        let resolver = Resolver::new(&resolving, host, self.options);
        let mut is_asked = vec![true; self.modules.len()];
        is_asked.push(false);
        let visits = included.visits(&resolver, &is_asked);
        // `fileIncludeReasons[path]`
        let reasons_of = |file: FileId, name: &[u8]| included.by_path_of(&visits[file.idx()], name);
        // `fmt.Fprintln(w, "  ", message)`
        let line = |code: u32, args: &[Vec<u8>]| {
            let mut line = b"   ".to_vec();
            if let Some((_, text)) = messages::message(code) {
                messages::format(&mut line, text, args);
            }
            line
        };
        // `referenceFileLocation.text` in a file whose text is not retained.
        let text_read = |it: &Reference| {
            let from: &Module = &self.modules[it.from.idx()];
            if it.is_synthetic() || !from.hir.text.is_empty() {
                return None;
            }
            let text = host.read(from.file_name())?;
            Some(text.get(it.start as usize..it.end as usize)?.to_vec())
        };
        let mut lines: Vec<Vec<u8>> = Vec::new();
        // `is_redirect`: `name` is that of a `redirectsFile`, and `file` is its target.
        let mut explain_file = |name: &[u8], file: FileId, is_redirect: bool| {
            let module: &Module = &self.modules[file.idx()];
            lines.push(to_relative_file_name(name));
            for visit in reasons_of(file, name) {
                let (code, mut args) = included.reason_message(visit, to_relative_file_name);
                if let IncludeReason::Reference(it) = &visit.reason
                    && let Some(text) = text_read(it)
                {
                    args[0] = text;
                }
                lines.push(line(code, &args));
            }
            // `explainRedirectAndImpliedFormat`
            let options = self.options;
            if !is_redirect && module.project_reference_source.is_some() {
                let source = self.atoms.bytes(module.project_reference_source);
                lines.push(line(1428, &[to_relative_file_name(source)]));
            }
            if is_redirect {
                lines.push(line(1429, &[to_relative_file_name(module.file_name())]));
            } else if let Some((code, args)) =
                implied_format_reason(&resolver, options, module, to_relative_file_name)
            {
                lines.push(line(code, &args));
            }
        };
        // The visit at which `collectFiles` goes on to what the file refers to.
        let first: Vec<Option<&Visit>> = (self.modules.iter().enumerate())
            .map(|(i, module)| reasons_of(FileId(i as u32), module.file_name()))
            .map(|visits| visits.first().copied())
            .collect();
        let libs = (self.order.iter())
            .filter(|file| self.modules[file.idx()].is_lib)
            .count();
        let mut source_files = self.order.iter();
        let mut files_explained = 0;
        for (redirects, &(name, target)) in self.package_copies.iter().enumerate() {
            let Some(&visit) = reasons_of(target, name).first() else {
                continue;
            };
            // `redirectsFile.index`. `files` has what `collectFiles` has come to before, but for
            // the files that it is in the middle of.
            let mut unfinished: Vec<FileId> = Vec::new();
            let mut by = Some(visit);
            while let Some(Visit {
                reason: IncludeReason::Reference(it),
                ..
            }) = by
            {
                unfinished.push(it.from);
                by = first[it.from.idx()];
            }
            let is_added = |file: &&FileId| {
                first[file.idx()].is_some_and(|it| it.order < visit.order)
                    && !unfinished.contains(*file)
            };
            let index = libs + self.order[libs..].iter().take_while(is_added).count() + redirects;
            while files_explained < index
                && let Some(&file) = source_files.next()
            {
                explain_file(self.modules[file.idx()].file_name(), file, false);
                files_explained += 1;
            }
            explain_file(name, target, true);
            files_explained += 1;
        }
        for &file in source_files {
            explain_file(self.modules[file.idx()].file_name(), file, false);
        }
        lines
    }
}
