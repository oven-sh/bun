use super::flows::{Membership, Place, UntypedReason};
use crate::aot_rules::{Rule, Scopes, Severity};
use crate::check::spans::token_end;
use crate::check::{Checker, CompilerDiagnostic};
use crate::atom::Atom;
use crate::hir::{FileKind, ImportEqualsTarget, StmtKind};
use crate::program::FileId;
use crate::types::{Origin, TypeData, TypeId};
use crate::util::FxHashMap;
use bun_core::strings;

const MAX_REASONS_SHOWN: usize = 6;

#[derive(Default)]
struct UntypedPackage {
    files: usize,
    source_bytes: usize,
    first_file: Option<FileId>,
    importer: Option<(bool, Place)>,
}

fn package_name(directory: &[u8]) -> &[u8] {
    let start_of_last = |path: &[u8]| strings::last_index_of_char(path, b'/').map_or(0, |at| at + 1);
    let name = start_of_last(directory);
    let scope = start_of_last(&directory[..name.saturating_sub(1)]);
    &directory[if directory[scope..].starts_with(b"@") { scope } else { name }..]
}

impl<'p, 's> Checker<'p, 's> {
    pub(super) fn finding_at(&self, at: Place, code: u32, args: Vec<Vec<u8>>) -> CompilerDiagnostic {
        let hir = self.hir(at.file);
        let end = token_end(&hir.text, at.pos as usize, hir.kind == FileKind::Tsx) as u32;
        CompilerDiagnostic { file: at.file, start: at.pos, end, code, args, related: Vec::new() }
    }

    pub fn find_open_layouts(&mut self, views: &[TypeId], membership: &Membership, is_left_out: &[bool], scopes: &Scopes) -> Vec<CompilerDiagnostic> {
        let mut found = Vec::new();
        for (index, &view) in views.iter().enumerate() {
            let Some(first) = membership.untyped_reasons[index].filter(|_| !is_left_out[index]) else { continue };
            let is_inferred = matches!(self.data(view), TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. }) && self.alias_of_type(view).is_none();
            let Some(declared) = self.type_declaration_site(view).filter(|_| !is_inferred) else { continue };
            if scopes.severity(Rule::OpenLayout, declared.file, declared.pos) == Severity::Allow {
                continue;
            }
            let name_of = |c: &mut Self, view: u32| views.get(view as usize).map_or_else(Vec::new, |&view| c.display_name(view).into_bytes());
            let mut related = Vec::new();
            let mut why = Some(first);
            while let Some(reason) = why.take().filter(|_| related.len() < MAX_REASONS_SHOWN) {
                let (code, args, at) = match reason {
                    UntypedReason::Untyped { at, .. }
                    | UntypedReason::Flat { at }
                    | UntypedReason::Dictionary { at }
                    | UntypedReason::MayLackCapacity { at }
                    | UntypedReason::AnotherLayout { at }
                    | UntypedReason::ForLogging { at } => (100040, Vec::new(), at),
                    UntypedReason::ExternalData { at, .. }
                    | UntypedReason::UnretainedExternalData { at }
                    | UntypedReason::Weak { at }
                    | UntypedReason::TooMany { at }
                    | UntypedReason::NeverAllocated { at } => (100041, Vec::new(), at),
                    UntypedReason::Seen { source: Some(source), at } => (100042, vec![self.display_name(source).into_bytes()], at),
                    UntypedReason::Seen { source: None, at } => (100041, Vec::new(), at),
                    UntypedReason::Inherited { from, at } => {
                        why = membership.untyped_reasons.get(from as usize).copied().flatten();
                        (100043, vec![name_of(self, from)], at)
                    }
                    UntypedReason::PassedCast { from } => {
                        why = membership.untyped_reasons.get(from as usize).copied().flatten();
                        (100044, vec![name_of(self, from)], declared)
                    }
                    UntypedReason::DeclaredOnly => (100045, Vec::new(), declared),
                    UntypedReason::Instance => (100046, Vec::new(), declared),
                    UntypedReason::ReachesJavaScript { at } => (100047, Vec::new(), at),
                    UntypedReason::UnconvertibleLayout { from } => (100048, vec![name_of(self, from)], declared),
                };
                let at = if at.file == FileId(u32::MAX) { declared } else { at };
                related.push(self.finding_at(at, code, args));
            }
            let name = self.display_name(view).into_bytes();
            found.push(CompilerDiagnostic { related, ..self.finding_at(declared, 100022, vec![name]) });
        }
        found
    }

    fn import_site(&self, file: FileId, specifier: Atom) -> Place {
        let hir = self.hir(file);
        let statement = hir.ids(hir.body).find(|&stmt| match hir[stmt].kind {
            StmtKind::Import(import) => hir[import].spec == specifier,
            StmtKind::ExportNamed(export) => hir[export].spec == specifier,
            StmtKind::ExportStar { spec, .. } => spec == specifier,
            StmtKind::ImportEquals(import) => matches!(hir[import].target, ImportEqualsTarget::Require(spec) if spec == specifier),
            _ => false,
        });
        Place { file, pos: statement.map_or(0, |stmt| hir[stmt].start) }
    }

    pub fn find_untyped_packages(&self, linked: &[FileId], scopes: &Scopes) -> Vec<CompilerDiagnostic> {
        let files = self.files();
        let is_program_code = |file: FileId| files.module(file).builtin.is_none() && !strings::contains(files.module(file).path.text, b"/.bun-aot-prelude/");
        let mut packages: FxHashMap<Atom, UntypedPackage> = FxHashMap::default();
        let mut all_source_bytes = 0;
        for &file in linked.iter().filter(|&&file| is_program_code(file)) {
            let module = files.module(file);
            all_source_bytes += module.hir.source_len as usize;
            if module.is_dependency && module.package_directory.is_some() && module.hir.is_js {
                let package = packages.entry(module.package_directory).or_default();
                package.files += 1;
                package.first_file.get_or_insert(file);
                package.source_bytes += module.hir.source_len as usize;
            }
        }
        for &file in linked.iter().filter(|&&file| is_program_code(file)) {
            let module = files.module(file);
            for &specifier in module.bound.specifiers.iter() {
                let Some(imported) = module.imported_file(specifier).map(|imported| files.module(imported)) else { continue };
                if imported.package_directory == module.package_directory {
                    continue;
                }
                let Some(package) = packages.get_mut(&imported.package_directory) else { continue };
                let candidate = (module.is_dependency, self.import_site(file, specifier));
                if package.importer.is_none_or(|known| candidate < known) {
                    package.importer = Some(candidate);
                }
            }
        }
        let mut found: Vec<CompilerDiagnostic> = Vec::new();
        for (directory, package) in packages {
            let Some(at) = package.importer.map(|importer| importer.1).or(package.first_file.map(|file| Place { file, pos: 0 })) else { continue };
            if scopes.severity(Rule::UntypedPackage, at.file, at.pos) == Severity::Allow {
                continue;
            }
            let share = format!("{:.1}", 100.0 * package.source_bytes as f64 / all_source_bytes.max(1) as f64);
            let name = package_name(self.atoms().bytes(directory)).to_vec();
            let files = format!("{} {}", package.files, if package.files == 1 { "file" } else { "files" });
            found.push(self.finding_at(at, 100026, vec![name, files.into_bytes(), share.into_bytes()]));
        }
        found
    }
}
