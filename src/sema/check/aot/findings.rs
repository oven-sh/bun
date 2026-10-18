use super::flows::{ExternalCause, ExternalMark, Membership, Place, UntypedReason};
use super::mutations::Mutation;
use super::identity::Identity;
use crate::aot_rules::{Rule, Scopes};
use crate::check::spans::token_end;
use crate::check::{Checker, CompilerDiagnostic};
use crate::atom::Atom;
use crate::bind::{Decl, SymFlags, SymbolId};
use crate::hir::{ClassId, ExprId, ExprKind, FileKind, ImportEqualsTarget, StmtKind};
use crate::program::FileId;
use crate::resolve::get_relative_path_from_directory;
use crate::types::{Origin, TypeData, TypeId};
use crate::util::{FxHashMap, FxHashSet};
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
    const INSTALLED_IN: &[u8] = b"/node_modules/";
    if let Some(at) = bun_core::strings::last_index_of(directory, INSTALLED_IN) {
        let inside = &directory[at + INSTALLED_IN.len()..];
        let segments = if inside.starts_with(b"@") { 2 } else { 1 };
        let end = inside.iter().enumerate().filter(|byte| *byte.1 == b'/').nth(segments - 1).map_or(inside.len(), |slash| slash.0);
        return &inside[..end];
    }
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

    pub fn find_open_layouts(&mut self, views: &[TypeId], membership: &Membership, is_left_out: &[bool], scopes: &Scopes) -> Vec<(usize, CompilerDiagnostic)> {
        let mut found = Vec::new();
        for (index, &view) in views.iter().enumerate() {
            let Some(first) = membership.untyped_reasons[index].filter(|_| !is_left_out[index]) else { continue };
            let is_inferred = matches!(self.data(view), TypeData::Anon { origin: Origin::ObjectLiteral(..) | Origin::WidenedLiteral(..), .. }) && self.alias_of_type(view).is_none();
            let Some(declared) = self.type_declaration_site(view).filter(|_| !is_inferred) else { continue };
            if !scopes.is_wanted(Rule::OpenLayout, declared.file, declared.pos) {
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
            found.push((index, CompilerDiagnostic { related, ..self.finding_at(declared, 100022, vec![name]) }));
        }
        found
    }

    pub fn find_reshaped_layouts(&self, membership: &Membership, scopes: &Scopes) -> Vec<CompilerDiagnostic> {
        let mut found = Vec::new();
        for (mutation, code) in [(Mutation::IntegrityLevel, 100080), (Mutation::Prototype, 100081)] {
            let mut places = membership.places_marking_every_layout.iter().filter(|place| place.0 == mutation && scopes.is_wanted(Rule::ReshapedLayout, place.1.file, place.1.pos)).map(|place| place.1);
            let Some(first) = places.next() else { continue };
            let related = places.map(|at| self.finding_at(at, 100082, Vec::new())).collect();
            found.push(CompilerDiagnostic { related, ..self.finding_at(first, code, Vec::new()) });
        }
        found
    }

    pub fn find_external_types(&mut self, scopes: &Scopes) -> Vec<CompilerDiagnostic> {
        let (marks, external_types) = self.external_marks();
        let is_reported_at = |c: &Self, declared: Place| c.is_compiled(declared.file) && !c.is_untyped_file(declared.file) && scopes.is_wanted(Rule::ExternalType, declared.file, declared.pos);
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

    pub fn find_other_places_where_external_data_enters(&mut self) -> Vec<(Place, CompilerDiagnostic)> {
        let marks = self.external_marks().0;
        let mut found: Vec<(Place, Place, Vec<u8>)> = Vec::new();
        for (identity, at) in self.places_where_external_data_enters() {
            let Some(mark) = marks.get(&identity) else { continue };
            let Some(reported) = self.steps_to_external_source(&marks, identity, mark.declared.unwrap_or(at)).pop() else { continue };
            let reported = Place { file: reported.file, pos: reported.start };
            if reported != at {
                found.push((reported, at, mark.name.clone()));
            }
        }
        found.sort_unstable();
        found.dedup_by_key(|other| (other.0, other.1));
        found.into_iter().map(|(reported, at, name)| (reported, self.finding_at(at, 100063, vec![name]))).collect()
    }

    fn steps_to_external_source(&self, marks: &FxHashMap<Identity, ExternalMark>, identity: Identity, declared: Place) -> Vec<CompilerDiagnostic> {
        let mut steps = Vec::new();
        let mut next = Some(identity);
        while let Some(mark) = next.take().and_then(|identity| marks.get(&identity)).filter(|_| steps.len() < MAX_STEPS_FOLLOWED) {
            let other = mark.from.and_then(|from| marks.get(&from));
            let names = || vec![mark.name.clone(), other.map_or_else(Vec::new, |other| other.name.clone())];
            let nearby = mark.declared.or_else(|| other.and_then(|other| other.declared)).unwrap_or(declared);
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

    fn untyped_receiver_reasons(&mut self, file: FileId, receiver: ExprId, marks: &FxHashMap<Identity, ExternalMark>, classes_without_layout: &FxHashSet<(FileId, ClassId)>) -> Option<Vec<CompilerDiagnostic>> {
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
                let made_without_layout = match hir[origin].kind {
                    ExprKind::Ident(_) if declared.is_some() => {
                        let symbol = self.files().sym(file, self.bound(file).expr_symbol[origin.idx()]);
                        self.initializer_of_const(symbol).and_then(|(of, held)| Some((Place { file: of, pos: self.hir(of)[held].pos }, self.why_object_create_makes_no_record(of, held)?)))
                    }
                    _ => None,
                };
                if let Some((made, why)) = made_without_layout {
                    reasons.push(self.finding_at(made, 100091, vec![why.as_bytes().to_vec()]));
                    continue;
                }
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
            } else if let Some(class) = self.class_for_type(part, false).filter(|class| classes_without_layout.contains(class)) {
                reasons.push(self.finding_at(self.class_site(class), 100085, vec![name]));
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

    fn declaration_behind_receiver(&mut self, file: FileId, receiver: ExprId) -> Option<CompilerDiagnostic> {
        let ty = self.type_of_expr(file, receiver);
        let ty = self.reduced(ty);
        let mut found = None;
        for part in self.parts(ty).to_vec() {
            let Some(declared) = self.type_declaration_site(part).filter(|_| self.may_hold_objects(part)) else { continue };
            let is_declared_outside_typed_code = self.hir(declared.file).kind == FileKind::Declaration || self.is_untyped_file(declared.file);
            if found.is_none() || is_declared_outside_typed_code {
                let name = self.display_name(part).into_bytes();
                found = Some(self.finding_at(declared, if is_declared_outside_typed_code { 100088 } else { 100089 }, vec![name]));
            }
            if is_declared_outside_typed_code {
                break;
            }
        }
        if found.is_some() {
            return found;
        }
        let hir = self.hir(file);
        let mut origin = receiver;
        while let ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } | ExprKind::NonNull(expr) | ExprKind::Await(expr) = hir[origin].kind {
            origin = expr;
        }
        let ExprKind::Ident(name) = hir[origin].kind else { return None };
        let bound_to = self.bound(file).expr_symbol[origin.idx()];
        if bound_to.is_none() {
            return None;
        }
        let Some((declared_in, Decl::Var(pat) | Decl::Param(pat))) = self.files().value_declaration(self.files().sym(file, bound_to)) else { return None };
        let (name, type_name) = (self.atoms().bytes(name).to_vec(), self.display_name(ty).into_bytes());
        Some(self.finding_at(Place { file: declared_in, pos: self.hir(declared_in)[pat].pos }, 100090, vec![name, type_name]))
    }

    pub fn explain_untyped_values(&mut self, values: &[(FileId, ExprId)], classes_without_layout: &FxHashSet<(FileId, ClassId)>) -> Vec<Vec<CompilerDiagnostic>> {
        let marks = self.external_marks().0;
        values.iter().map(|&(file, value)| self.untyped_receiver_reasons(file, value, &marks, classes_without_layout).unwrap_or_default()).collect()
    }

    pub fn find_accesses_by_name(&mut self, accesses: &[(FileId, ExprId, u32, Vec<u8>)], classes_without_layout: &FxHashSet<(FileId, ClassId)>, scopes: &Scopes) -> (Vec<CompilerDiagnostic>, Vec<(Place, Option<CompilerDiagnostic>)>) {
        let marks = self.external_marks().0;
        let (mut found, mut unexplained) = (Vec::new(), Vec::new());
        for &(file, receiver, name_pos, ref name) in accesses {
            if !scopes.is_wanted(Rule::ByName, file, name_pos) {
                continue;
            }
            let Some(related) = self.untyped_receiver_reasons(file, receiver, &marks, classes_without_layout) else {
                if scopes.collects_everything() {
                    unexplained.push((Place { file, pos: name_pos }, self.declaration_behind_receiver(file, receiver)));
                }
                continue;
            };
            if related.is_empty() {
                unexplained.push((Place { file, pos: name_pos }, self.declaration_behind_receiver(file, receiver)));
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

    pub fn name_of_package_holding(&self, file: FileId) -> Option<Vec<u8>> {
        let module = self.files().module(file);
        (module.is_dependency && module.package_directory.is_some()).then(|| package_name(self.atoms().bytes(module.package_directory)).to_vec())
    }

    pub fn find_untyped_packages(&self, linked: &[FileId], shown_from: &[u8], scopes: &Scopes) -> Vec<CompilerDiagnostic> {
        let files = self.files();
        let is_program_code = |file: FileId| files.module(file).builtin.is_none() && !strings::contains(files.module(file).path.text, b"/.bun-aot-prelude/");
        let name_of = |module: &crate::program::Module<'_>| package_name(self.atoms().bytes(module.package_directory));
        let mut packages: FxHashMap<&[u8], UntypedPackage> = FxHashMap::default();
        let mut all_source_bytes = 0;
        for &file in linked.iter().filter(|&&file| is_program_code(file)) {
            let module = files.module(file);
            all_source_bytes += module.hir.source_len as usize;
            if module.is_dependency && module.package_directory.is_some() && module.hir.is_js {
                let package = packages.entry(name_of(module)).or_default();
                package.files += 1;
                package.first_file.get_or_insert(file);
                package.source_bytes += module.hir.source_len as usize;
            }
        }
        for &file in linked.iter().filter(|&&file| is_program_code(file)) {
            let module = files.module(file);
            for &specifier in module.bound.specifiers.iter() {
                let Some(imported) = module.imported_file(specifier).map(|imported| files.module(imported)) else { continue };
                if imported.package_directory == module.package_directory || imported.package_directory.is_none() || module.package_directory.is_some() && name_of(imported) == name_of(module) {
                    continue;
                }
                let Some(package) = packages.get_mut(name_of(imported)) else { continue };
                let candidate = (module.is_dependency, self.import_site(file, specifier));
                if package.importer.is_none_or(|known| candidate < known) {
                    package.importer = Some(candidate);
                }
            }
        }
        let mut found: Vec<CompilerDiagnostic> = Vec::new();
        for (name, package) in packages {
            let Some(at) = package.importer.map(|importer| importer.1).or_else(|| package.first_file.map(|file| Place { file, pos: 0 })) else { continue };
            if !scopes.is_wanted(Rule::UntypedPackage, at.file, at.pos) {
                continue;
            }
            let share = format!("{:.1}", 100.0 * package.source_bytes as f64 / all_source_bytes.max(1) as f64);
            let files = format!("{} {}", package.files, if package.files == 1 { "file" } else { "files" });
            found.push(self.finding_at(at, 100026, vec![name.to_vec(), files.into_bytes(), share.into_bytes()]));
        }
        for &file in linked.iter().filter(|&&file| is_program_code(file)) {
            let module = files.module(file);
            if module.hir.is_js && !(module.is_dependency && module.package_directory.is_some()) && scopes.is_wanted(Rule::UntypedPackage, file, 0) {
                let name = get_relative_path_from_directory(shown_from, module.file_name(), files.is_case_sensitive);
                found.push(self.finding_at(Place { file, pos: 0 }, 100083, vec![name]));
            }
        }
        found
    }
}
