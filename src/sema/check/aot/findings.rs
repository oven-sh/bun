use super::flows::{ExternalCause, ExternalMark, Membership, Place, UntypedReason};
use super::identity::Identity;
use crate::aot_rules::{Rule, Scopes, Severity};
use crate::check::spans::token_end;
use crate::check::{Checker, CompilerDiagnostic};
use crate::atom::Atom;
use crate::bind::{Decl, SymFlags, SymbolId};
use crate::hir::{ExprId, ExprKind, FileKind, ImportEqualsTarget, StmtKind};
use crate::program::FileId;
use crate::types::{Origin, TypeData, TypeId};
use crate::util::FxHashMap;
use bun_core::strings;

const MAX_REASONS_SHOWN: usize = 6;
const MAX_STEPS_FOLLOWED: usize = 64;

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

    pub fn find_external_types(&mut self, scopes: &Scopes) -> Vec<CompilerDiagnostic> {
        let (marks, external_types) = self.external_marks();
        let is_reported_at = |c: &Self, declared: Place| c.is_compiled(declared.file) && !c.is_untyped_file(declared.file) && scopes.severity(Rule::ExternalType, declared.file, declared.pos) != Severity::Allow;
        let mut reported: Vec<(Place, Vec<u8>, Identity, bool)> = (marks.iter().filter(|mark| external_types.contains(mark.0)))
            .filter_map(|(&identity, mark)| Some((mark.declared?, mark.name.clone(), identity, false)))
            .filter(|reported| is_reported_at(self, reported.0))
            .collect();
        let files = self.files();
        for (file, module) in files.modules.iter().enumerate().filter(|(_, module)| !module.is_untyped()) {
            let file = FileId(file as u32);
            if !self.is_compiled(file) || self.is_declaration_only(file) {
                continue;
            }
            for (id, _) in module.bound.symbols.iter().enumerate().filter(|(_, symbol)| symbol.flags.intersects(SymFlags::INTERFACE | SymFlags::TYPE_ALIAS)) {
                let ty = self.declared_type(files.sym(file, SymbolId(id as u32)));
                let Some(declared) = self.type_declaration_site(ty).filter(|&declared| declared.file == file && is_reported_at(self, declared)) else { continue };
                if let Some(resembled) = self.external_type_resembled_by(ty) {
                    reported.push((declared, self.display_name(ty).into_bytes(), resembled, true));
                }
            }
        }
        reported.sort_unstable();
        reported.dedup();
        let mut found = Vec::new();
        for (declared, name, identity, is_resembled) in reported {
            let mut steps = Vec::new();
            if is_resembled {
                steps.push(self.finding_at(declared, 100073, vec![name.clone(), marks.get(&identity).map_or_else(Vec::new, |resembled| resembled.name.clone())]));
            }
            steps.extend(self.steps_to_external_source(&marks, identity, declared));
            found.push(CompilerDiagnostic { related: steps, ..self.finding_at(declared, 100029, vec![name]) });
        }
        found
    }

    fn steps_to_external_source(&self, marks: &FxHashMap<Identity, ExternalMark>, identity: Identity, declared: Place) -> Vec<CompilerDiagnostic> {
        let mut steps = Vec::new();
        let mut next = Some(identity);
        while let Some(mark) = next.take().and_then(|identity| marks.get(&identity)).filter(|_| steps.len() < MAX_STEPS_FOLLOWED) {
            let other = mark.from.and_then(|from| marks.get(&from));
            let names = || vec![mark.name.clone(), other.map_or_else(Vec::new, |other| other.name.clone())];
            let nearby = mark.declared.or(other.and_then(|other| other.declared)).unwrap_or(declared);
            let (code, args, at) = match mark.cause {
                ExternalCause::UsedAs { at } => (100063, names(), at),
                ExternalCause::CreatedByGeneratedCode { at } => (100064, names(), at),
                ExternalCause::CrossesBoundary { at } => (100065, names(), at),
                ExternalCause::CastFrom { at } => (100066, names(), at),
                ExternalCause::CastTo { at } => (100067, names(), at),
                ExternalCause::AssignedFrom => (100068, names(), nearby),
                ExternalCause::Resembles if other.is_some() => (100073, names(), nearby),
                ExternalCause::Resembles => (100072, names(), nearby),
                ExternalCause::UnionMember { at } => (100069, names(), at),
                ExternalCause::PartOf => (100070, names(), nearby),
                ExternalCause::SameLayoutAs => (100074, names(), nearby),
            };
            steps.push(self.finding_at(if at.file == FileId(u32::MAX) { nearby } else { at }, code, args));
            next = mark.from;
        }
        if steps.len() > MAX_REASONS_SHOWN {
            let left_out = steps.len() - MAX_REASONS_SHOWN;
            let last = steps.split_off(steps.len() - 1);
            steps.truncate(MAX_REASONS_SHOWN - 1);
            steps.push(self.finding_at(declared, 100071, vec![left_out.to_string().into_bytes()]));
            steps.extend(last);
        }
        steps
    }

    fn untyped_receiver_reasons(&mut self, file: FileId, receiver: ExprId, marks: &FxHashMap<Identity, ExternalMark>) -> Option<Vec<CompilerDiagnostic>> {
        let hir = self.hir(file);
        let at = Place { file, pos: hir[receiver].pos };
        self.prepare_enclosing(file, receiver);
        let ty = self.type_of_expr(file, receiver);
        let ty = self.reduced(ty);
        let (mut reasons, mut is_created_elsewhere) = (Vec::new(), false);
        let mut parts = Vec::new();
        for part in self.parts(ty).to_vec() {
            match self.data(part) {
                TypeData::Intersection(constituents) => parts.extend(constituents.iter().copied()),
                _ => parts.push(part),
            }
        }
        for part in parts {
            let name = self.display_name(part).into_bytes();
            if self.is_uninformative(part) {
                let mut origin = receiver;
                while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Await(expr) = hir[origin].kind {
                    origin = expr;
                }
                let declared = match hir[origin].kind {
                    ExprKind::Ident(_) if self.bound(file).expr_symbol[origin.idx()].is_some() => {
                        let symbol = self.files().sym(file, self.bound(file).expr_symbol[origin.idx()]);
                        match self.files().value_declaration(symbol) {
                            Some((declared_in, Decl::Var(pat) | Decl::Param(pat))) => Some(Place { file: declared_in, pos: self.hir(declared_in)[pat].pos }),
                            _ => None,
                        }
                    }
                    _ => None,
                };
                reasons.push(match (declared, hir[origin].kind) {
                    (Some(declared), _) => self.finding_at(declared, 100076, vec![name]),
                    (None, ExprKind::Call(_)) => self.finding_at(Place { file, pos: hir[origin].pos }, 100077, vec![name]),
                    (None, _) => self.finding_at(at, 100075, vec![name]),
                });
                continue;
            }
            if !self.may_hold_objects(part) {
                continue;
            }
            let identity = self.type_identity(part);
            let nearby = self.type_declaration_site(part).unwrap_or(at);
            if let Some(resembled) = self.external_type_resembled_by(part) {
                reasons.push(self.finding_at(nearby, 100073, vec![name, marks.get(&resembled).map_or_else(Vec::new, |resembled| resembled.name.clone())]));
                reasons.extend(self.steps_to_external_source(marks, resembled, nearby));
            } else if self.is_tainted(part) && marks.contains_key(&identity) {
                reasons.extend(self.steps_to_external_source(marks, identity, nearby));
            } else if self.type_declaration_site(part).is_some_and(|declared| self.hir(declared.file).kind == FileKind::Declaration || self.is_untyped_file(declared.file)) {
                is_created_elsewhere = true;
            } else if matches!(self.data(part), TypeData::TypeParam(..)) {
                reasons.push(self.finding_at(at, 100079, vec![name]));
            } else if self.members(part).is_some_and(|members| !members.shape().index.is_empty()) {
                reasons.push(self.finding_at(nearby, 100078, vec![name]));
            }
        }
        reasons.truncate(2 * MAX_REASONS_SHOWN);
        (!reasons.is_empty() || !is_created_elsewhere).then_some(reasons)
    }

    pub fn find_accesses_by_name(&mut self, accesses: &[(FileId, ExprId, u32, Vec<u8>)], scopes: &Scopes) -> (Vec<CompilerDiagnostic>, usize) {
        let marks = self.external_marks().0;
        let (mut found, mut unexplained) = (Vec::new(), 0);
        for &(file, receiver, name_pos, ref name) in accesses {
            if scopes.severity(Rule::ByName, file, name_pos) == Severity::Allow {
                continue;
            }
            let Some(related) = self.untyped_receiver_reasons(file, receiver, &marks) else { continue };
            if related.is_empty() {
                unexplained += 1;
                continue;
            }
            found.push(CompilerDiagnostic { related, ..self.finding_at(Place { file, pos: name_pos }, 100030, vec![name.clone()]) });
        }
        (found, unexplained)
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
