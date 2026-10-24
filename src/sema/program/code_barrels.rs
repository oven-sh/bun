use self::object_reads::ObjectReads;
use super::code_load::{LoadKey, LoadedCode};
use super::*;
use crate::bind::{Binding, Parent};
use crate::file_analysis::FileAnalysis;
use crate::import_sites::{ImportSite, ImportSiteKind, ImportSpecifier};
use crate::module_format::ModuleFormat;
use crate::resolve::{
    CodeImportKind, CodeResolution, ComputedCandidate, ComputedResolution, DeclaredSideEffects,
    SiteResolution,
};

// A barrel is a module of a package with `"sideEffects": false` that defines none of its exports: each is an export of another module under a name.

pub(super) const NOT_LOADED: u32 = u32::MAX;

#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) enum Asked {
    Names(Vec<Atom>),
    All,
}

// `target` is `None` where no file has the name that the site gives.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct WaitingSite {
    pub(super) site: u32,
    pub(super) target: Option<u32>,
}

#[derive(Default, Debug)]
pub(super) struct BarrelShape {
    pub(super) can_wait: Vec<WaitingSite>,
    // The name of an export, and where in `can_wait` the site is that it comes from.
    pub(super) exports: Vec<(Atom, u32)>,
}

// What a file asks of each of its targets, in their order.
#[derive(Default, Debug)]
pub(super) struct ImportRequests {
    pub(super) asked: Vec<Asked>,
    pub(super) barrel: Option<BarrelShape>,
}

#[derive(Debug)]
struct WaitingBarrel {
    sites: Vec<WaitingSite>,
    is_waiting: Vec<bool>,
    waiting_count: usize,
    site_of_export: FxHashMap<Atom, u32>,
    asked: Vec<Asked>,
}

impl WaitingBarrel {
    fn new(shape: BarrelShape, asked: Vec<Asked>) -> WaitingBarrel {
        WaitingBarrel {
            is_waiting: vec![true; shape.can_wait.len()],
            waiting_count: shape.can_wait.len(),
            sites: shape.can_wait,
            site_of_export: shape.exports.into_iter().collect(),
            asked,
        }
    }

    fn wake(&mut self, index: usize, woken: &mut Vec<u32>) {
        if std::mem::replace(&mut self.is_waiting[index], false) {
            self.waiting_count -= 1;
            woken.extend(self.sites[index].target);
        }
    }

    fn wake_for_name(&mut self, name: Atom, woken: &mut Vec<u32>) {
        if let Some(&index) = self.site_of_export.get(&name) {
            self.wake(index as usize, woken);
        }
    }

    fn wake_all(&mut self, woken: &mut Vec<u32>) {
        for index in 0..self.sites.len() {
            self.wake(index, woken);
        }
    }
}

#[derive(Debug)]
enum FileRequests {
    // What is asked of a file that is not parsed yet.
    Unparsed(Asked),
    Waiting(Box<WaitingBarrel>),
    // Nothing of the file waits for a name.
    Settled,
}

#[derive(Default, Debug)]
pub(super) struct BarrelRequests {
    files: Vec<FileRequests>,
}

impl BarrelRequests {
    fn file(&mut self, file: u32) -> &mut FileRequests {
        let index = file as usize;
        if index >= self.files.len() {
            let unasked = || FileRequests::Unparsed(Asked::Names(Vec::new()));
            self.files.resize_with(index + 1, unasked);
        }
        &mut self.files[index]
    }

    /// The file is parsed once more, and all of it counts as asked for.
    pub(super) fn forget_parsed_file(&mut self, file: u32) {
        *self.file(file) = FileRequests::Unparsed(Asked::All);
    }

    // `load` queues a target of a file and answers which file it is.
    pub(super) fn add_parsed_file(
        &mut self,
        file: u32,
        requests: ImportRequests,
        load: &mut dyn FnMut(u32, u32) -> u32,
    ) {
        let ImportRequests { asked, barrel } = requests;
        let state = self.file(file);
        let FileRequests::Unparsed(asked_of_file) = std::mem::replace(state, FileRequests::Settled)
        else {
            unreachable!("a file is parsed once, or forgotten in between");
        };
        let mut pending: Vec<(u32, Asked)> = Vec::new();
        let Some(shape) = barrel else {
            for (target, asked) in (0..).zip(asked) {
                pending.push((load(file, target), asked));
            }
            return self.ask(pending, load);
        };
        let mut is_waiting = vec![false; asked.len()];
        for target in shape.can_wait.iter().filter_map(|site| site.target) {
            is_waiting[target as usize] = true;
        }
        for ((target, asked), is_waiting) in (0..).zip(&asked).zip(is_waiting) {
            if !is_waiting {
                pending.push((load(file, target), asked.clone()));
            }
        }
        let barrel = WaitingBarrel::new(shape, asked);
        *state = FileRequests::Waiting(Box::new(barrel));
        pending.push((file, asked_of_file));
        self.ask(pending, load);
    }

    fn ask(&mut self, mut pending: Vec<(u32, Asked)>, load: &mut dyn FnMut(u32, u32) -> u32) {
        let mut woken = Vec::new();
        while let Some((file, asked)) = pending.pop() {
            let state = self.file(file);
            let barrel = match state {
                FileRequests::Settled | FileRequests::Unparsed(Asked::All) => continue,
                FileRequests::Unparsed(collected @ Asked::Names(_)) => {
                    match (collected, asked) {
                        (Asked::Names(collected), Asked::Names(names)) => collected.extend(names),
                        (collected, _) => *collected = Asked::All,
                    }
                    continue;
                }
                FileRequests::Waiting(barrel) => barrel,
            };
            match asked {
                Asked::All => barrel.wake_all(&mut woken),
                Asked::Names(names) => {
                    for name in names {
                        barrel.wake_for_name(name, &mut woken);
                    }
                }
            }
            for target in woken.drain(..) {
                pending.push((load(file, target), barrel.asked[target as usize].clone()));
            }
            if barrel.waiting_count == 0 {
                *state = FileRequests::Settled;
            }
        }
    }

    // The sites that nothing has asked for, by file, in the order of the files.
    pub(super) fn into_waiting(self) -> impl Iterator<Item = (u32, Vec<WaitingSite>)> {
        (0..)
            .zip(self.files)
            .filter_map(|(file, state)| match state {
                FileRequests::Waiting(barrel) => {
                    let sites = barrel.sites.iter().zip(&barrel.is_waiting);
                    let waiting = sites.filter(|(_, is_waiting)| **is_waiting);
                    Some((file, waiting.map(|(&site, _)| site).collect()))
                }
                FileRequests::Unparsed(_) | FileRequests::Settled => None,
            })
    }
}

fn count_targets(resolution: &SiteResolution<'_>) -> u32 {
    let candidates = match *resolution {
        SiteResolution::Constant(CodeResolution::File(_)) => return 1,
        SiteResolution::Constant(
            CodeResolution::HostModule(_)
            | CodeResolution::External { .. }
            | CodeResolution::Erased
            | CodeResolution::NotFound(_),
        ) => return 0,
        SiteResolution::Computed(ComputedResolution::Candidates { candidates, .. }) => candidates,
        SiteResolution::Computed(ComputedResolution::All { host_modules, .. }) => host_modules,
    };
    let is_file = |candidate: &&ComputedCandidate<'_>| match candidate {
        ComputedCandidate::File(_) => true,
        ComputedCandidate::HostModule(_) => false,
    };
    candidates.iter().filter(is_file).count() as u32
}

// How the bindings of a file that hold what it imports are used.
#[derive(Default)]
struct ImportUses {
    members_read: FxHashMap<SymbolId, Vec<Atom>>,
    used_otherwise: FxHashSet<SymbolId>,
    exported: FxHashSet<SymbolId>,
    // For each import site: what is read from the object that the call evaluates to.
    reads_of_sites: Vec<Option<ObjectReads>>,
    holders: FxHashMap<SymbolId, HolderUses>,
    // Filled if a call gives a binding its value: the bindings that code which can run mentions.
    mentioned: FxHashSet<SymbolId>,
}

// What the mentions of a binding read that holds the object of a module.
#[derive(Default)]
struct HolderUses {
    reads: ObjectReads,
    is_used_otherwise: bool,
}

struct MemberNames {
    // `require` of an ECMAScript module returns its export of this name, if it has one.
    module_exports: Atom,
    all: Atom,
    catch: Atom,
    finally: Atom,
}

enum ExportOrigin {
    DefinedHere,
    Site(ImportSiteKind),
    NoValue,
}

struct Summary<'a, 's> {
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    analysis: &'a FileAnalysis<'s>,
    names: MemberNames,
    uses: ImportUses,
}

impl Summary<'_, '_> {
    fn find_import(&self, local: SymbolId) -> Option<ImportId> {
        let (hir, bound) = (self.hir, self.bound);
        bound.symbol(local).decls.iter().find_map(|&declaration| {
            let import = match declaration {
                Decl::ImportDefault(import) | Decl::ImportNamespace(import) => import,
                Decl::ImportSpec(specifier) => hir[specifier].import,
                _ => return None,
            };
            (bound.declared_symbol(declaration) == local).then_some(import)
        })
    }

    // As `find_imported_value_site` of src/aot/modules/imports.rs, without what only other files can say.
    fn has_value(&self, symbol: SymbolId) -> bool {
        self.analysis
            .unused_import_symbols
            .binary_search(&symbol)
            .is_err()
            && self.bound.has_runtime_value(symbol)
    }

    fn is_only_read(&self, member: ExprId) -> bool {
        let Parent::Expr(parent) = self.bound.parent_of_expr(member) else {
            return true;
        };
        match self.hir[parent].kind {
            ExprKind::Assign { target, .. } => target != member,
            ExprKind::Unary { op, .. } => match op {
                UnOp::Delete | UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec => false,
                UnOp::Plus | UnOp::Minus | UnOp::BitNot | UnOp::Not | UnOp::Typeof | UnOp::Void => {
                    true
                }
            },
            _ => true,
        }
    }

    // `ns.a`, `ns["a"]`, `(ns as T).a`
    fn find_member_read_from(&self, holder: ExprId) -> Option<Atom> {
        let hir = self.hir;
        let mut node = holder;
        loop {
            let Parent::Expr(parent) = self.bound.parent_of_expr(node) else {
                return None;
            };
            match hir[parent].kind {
                ExprKind::As { .. }
                | ExprKind::Satisfies { .. }
                | ExprKind::AsConst(_)
                | ExprKind::NonNull(_) => node = parent,
                ExprKind::Dot { .. } | ExprKind::Index { .. } => {
                    return match hir.member_key(parent) {
                        Some((object, MemberKey::Name(name)))
                            if object == node && self.is_only_read(parent) =>
                        {
                            Some(name)
                        }
                        _ => None,
                    };
                }
                _ => return None,
            }
        }
    }

    // `is_every_import_followed`: not only the bindings that hold the object of a module.
    fn for_each_mention(&self, then: &mut dyn FnMut(ExprId, SymbolId)) {
        let (hir, bound) = (self.hir, self.bound);
        for mention in (0..hir.exprs.len() as u32).map(ExprId) {
            if matches!(hir[mention].kind, ExprKind::Ident(_))
                && bound.is_evaluated_ident(mention)
                && !self.analysis.decisions.is_dead_expr(mention)
                && let Binding::Symbol(symbol) = bound.binding(mention)
            {
                then(mention, symbol);
            }
        }
    }

    fn collect_uses(&mut self, is_every_import_followed: bool) {
        let (hir, bound) = (self.hir, self.bound);
        let mut uses = ImportUses::default();
        let sites = self.analysis.import_sites.iter();
        uses.reads_of_sites = sites.map(|site| self.find_reads_of_site(site)).collect();
        let reads = uses.reads_of_sites.iter().flatten();
        let mut holders: Vec<SymbolId> = reads.clone().flat_map(|it| it.holders.clone()).collect();
        let follows_bindings =
            !holders.is_empty() || reads.clone().any(|it| !it.names_of_bindings.is_empty());
        let imports_object = |import: &Import| !import.namespace.is_none() && !import.type_only;
        if !is_every_import_followed && !follows_bindings && !hir.imports.iter().any(imports_object)
        {
            self.uses = uses;
            return;
        }
        let mut is_first_pass = true;
        // A pattern over a binding that holds the object may leave the rest of it in another binding.
        while is_first_pass || !holders.is_empty() {
            for &holder in &holders {
                uses.holders.entry(holder).or_default();
            }
            let mut found = Vec::new();
            self.for_each_mention(&mut |mention, symbol| {
                if is_first_pass && follows_bindings {
                    uses.mentioned.insert(symbol);
                }
                if holders.contains(&symbol) {
                    let holder = uses.holders.entry(symbol).or_default();
                    match self.find_reads_of_mention(mention) {
                        Some(reads) => {
                            found.extend_from_slice(&reads.holders);
                            holder.reads.add(reads);
                        }
                        None => holder.is_used_otherwise = true,
                    }
                } else if is_first_pass && self.find_import(symbol).is_some() {
                    match self.find_member_read_from(mention) {
                        Some(name) => uses.members_read.entry(symbol).or_default().push(name),
                        None => {
                            uses.used_otherwise.insert(symbol);
                        }
                    }
                }
            });
            found.retain(|holder| !uses.holders.contains_key(holder));
            holders = found;
            is_first_pass = false;
        }
        let entity_roots = (0..hir.import_equals.len() as u32)
            .map(|import| bound.entity_root_binding(ImportEqualsId(import)));
        let implicit = bound
            .runtime
            .implicit_references()
            .iter()
            .map(|it| it.binding);
        for binding in entity_roots.chain(implicit) {
            if let Binding::Symbol(symbol) = binding {
                uses.used_otherwise.insert(symbol);
            }
        }
        for specifier in (0..hir.export_specs.len() as u32).map(ExportSpecId) {
            if !hir[hir[specifier].export].has_module_specifier
                && let Binding::Symbol(symbol) = bound.exported_binding(specifier)
            {
                uses.exported.insert(symbol);
            }
        }
        self.uses = uses;
    }

    fn is_evaluated(&self, symbol: SymbolId) -> bool {
        self.uses.used_otherwise.contains(&symbol) || self.uses.members_read.contains_key(&symbol)
    }

    // The bindings of an import that have a value, each with the name that it imports. `None`: the object of the module.
    fn bindings_of(&self, import: ImportId) -> Vec<(SymbolId, Option<Atom>)> {
        let (hir, bound) = (self.hir, self.bound);
        let node = &hir[import];
        let mut bindings = Vec::new();
        if !node.default.is_none() {
            let symbol = bound.declared_symbol(Decl::ImportDefault(import));
            bindings.push((symbol, Some(known::default)));
        }
        if !node.namespace.is_none() {
            bindings.push((bound.declared_symbol(Decl::ImportNamespace(import)), None));
        }
        for specifier in node.named.iter() {
            if !hir[specifier].type_only {
                let symbol = bound.declared_symbol(Decl::ImportSpec(specifier));
                bindings.push((symbol, Some(hir[specifier].imported)));
            }
        }
        bindings.retain(|&(symbol, _)| self.has_value(symbol));
        bindings
    }

    // The names that are read from a binding which holds the object of a module. `None`: the object is used in another way.
    fn find_members_read(&self, symbol: SymbolId) -> Option<&[Atom]> {
        let uses = &self.uses;
        if uses.used_otherwise.contains(&symbol) || uses.exported.contains(&symbol) {
            return None;
        }
        Some(
            uses.members_read
                .get(&symbol)
                .map_or(&[][..], |names| &names[..]),
        )
    }

    fn asked_by_import(&self, import: ImportId) -> Asked {
        let mut names = Vec::new();
        for (symbol, imported) in self.bindings_of(import) {
            match (imported, self.find_members_read(symbol)) {
                (Some(name), _) => names.push(name),
                (None, Some(members)) if !self.hir[import].is_deferred => {
                    names.extend_from_slice(members);
                }
                (None, _) => return Asked::All,
            }
        }
        Asked::Names(names)
    }

    // `false`: the object is used in a way that is not followed.
    fn add_names_read(
        &self,
        reads: &ObjectReads,
        names: &mut Vec<Atom>,
        followed: &mut Vec<SymbolId>,
    ) -> bool {
        let uses = &self.uses;
        let is_used = |binding: &SymbolId| {
            uses.mentioned.contains(binding)
                || uses.exported.contains(binding)
                || uses.used_otherwise.contains(binding)
        };
        names.extend_from_slice(&reads.names);
        let read_into_bindings = reads.names_of_bindings.iter();
        names.extend(
            read_into_bindings
                .filter(|it| is_used(&it.0))
                .map(|it| it.1),
        );
        reads.holders.iter().all(|holder| {
            if followed.contains(holder) {
                return true;
            }
            followed.push(*holder);
            !uses.exported.contains(holder)
                && !uses.used_otherwise.contains(holder)
                && uses.holders.get(holder).is_none_or(|holder| {
                    !holder.is_used_otherwise && self.add_names_read(&holder.reads, names, followed)
                })
        })
    }

    // `read_by_call`: the name that the call itself reads.
    fn asked_by_call(&self, site: usize, read_by_call: Atom) -> Asked {
        let Some(Some(reads)) = self.uses.reads_of_sites.get(site) else {
            return Asked::All;
        };
        let mut names = vec![read_by_call];
        match self.add_names_read(reads, &mut names, &mut Vec::new()) {
            true => Asked::Names(names),
            false => Asked::All,
        }
    }

    fn asked_by(&self, index: usize) -> Asked {
        let hir = self.hir;
        match self.analysis.import_sites[index].kind {
            ImportSiteKind::Import(import) => self.asked_by_import(import),
            ImportSiteKind::ExportFrom(export) => {
                let items = hir[export].items.iter().map(|item| hir[item]);
                let values = items.filter(|item| !item.type_only);
                Asked::Names(values.map(|item| item.local).collect())
            }
            // `await` reads `then`.
            ImportSiteKind::ImportCall(_) => self.asked_by_call(index, known::then),
            ImportSiteKind::Require(_) | ImportSiteKind::ImportMetaRequire(_) => {
                self.asked_by_call(index, self.names.module_exports)
            }
            _ => Asked::All,
        }
    }

    fn origin_of_specifier(&self, specifier: ExportSpecId) -> ExportOrigin {
        let item = self.hir[specifier];
        let export = self.hir[item.export];
        if item.type_only || export.type_only {
            return ExportOrigin::NoValue;
        }
        if export.has_module_specifier {
            return ExportOrigin::Site(ImportSiteKind::ExportFrom(item.export));
        }
        match self.bound.exported_binding(specifier) {
            Binding::Symbol(local) => match self.find_import(local) {
                Some(import) => ExportOrigin::Site(ImportSiteKind::Import(import)),
                None if self.bound.has_runtime_value(local) => ExportOrigin::DefinedHere,
                None => ExportOrigin::NoValue,
            },
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => ExportOrigin::NoValue,
        }
    }

    fn origin_of_declaration(&self, declaration: Decl) -> ExportOrigin {
        match declaration {
            Decl::ExportSpec(specifier) => self.origin_of_specifier(specifier),
            Decl::ExportStarAs(statement) => {
                ExportOrigin::Site(ImportSiteKind::ExportStar(statement))
            }
            Decl::Var(_)
            | Decl::Fn(_)
            | Decl::Class(_)
            | Decl::Enum(_)
            | Decl::Module(_)
            | Decl::ImportEquals(_)
            | Decl::ExportExpr(_) => {
                let local = self.bound.declared_symbol(declaration);
                match local.is_some() && self.bound.has_runtime_value(local) {
                    true => ExportOrigin::DefinedHere,
                    false => ExportOrigin::NoValue,
                }
            }
            _ => ExportOrigin::NoValue,
        }
    }

    fn can_wait(&self, kind: ImportSiteKind) -> bool {
        match kind {
            ImportSiteKind::ExportFrom(_) | ImportSiteKind::ExportStar(_) => true,
            ImportSiteKind::Import(import) => {
                let mut bindings = self.bindings_of(import).into_iter();
                !self.hir[import].is_deferred
                    && bindings.all(|(symbol, _)| {
                        self.uses.exported.contains(&symbol) && !self.is_evaluated(symbol)
                    })
            }
            _ => false,
        }
    }

    // `waiting_sites`: each site as it would wait, if what it resolves to lets it.
    fn find_barrel_shape(&self, waiting_sites: &[Option<WaitingSite>]) -> Option<BarrelShape> {
        let bound = self.bound;
        let mut shape = BarrelShape::default();
        let mut place_of_site: Vec<Option<Option<u32>>> = vec![None; waiting_sites.len()];
        for &(name, exported) in bound.table(bound.symbol(bound.file_symbol).exports) {
            let mut origin = None;
            for &declaration in bound.symbol(exported).decls {
                match self.origin_of_declaration(declaration) {
                    ExportOrigin::DefinedHere => return None,
                    ExportOrigin::Site(kind) => origin = origin.or(Some(kind)),
                    ExportOrigin::NoValue => {}
                }
            }
            let Some(origin) = origin else {
                continue;
            };
            let site = self.analysis.import_site_index(origin)?;
            let place = *place_of_site[site].get_or_insert_with(|| {
                let waiting = waiting_sites[site].filter(|_| self.can_wait(origin))?;
                shape.can_wait.push(waiting);
                Some(shape.can_wait.len() as u32 - 1)
            });
            shape.exports.extend(place.map(|place| (name, place)));
        }
        (!shape.can_wait.is_empty()).then_some(shape)
    }
}

fn is_entry_point(context: &CodeLoadContext<'_, '_, '_>, key: LoadKey<'_>) -> bool {
    context.entry_points.iter().any(|entry_point| {
        entry_point.key.loader == key.loader
            && is_same_path(entry_point.key.path, key.path, context.is_case_sensitive)
    })
}

pub(super) fn summarize_requests<'s>(
    context: &CodeLoadContext<'_, 's, '_>,
    key: LoadKey<'_>,
    hir: &hir::File<'s>,
    bound: &Bound<'s>,
    code: &LoadedCode<'s, '_>,
) -> ImportRequests {
    let analysis = &code.analyzed.analysis;
    let target_count = code.targets.len();
    // Text that is evaluated in a scope of the file names what the file imports.
    if analysis.import_sites.is_empty() || !bound.runtime.eval_scopes().is_empty() {
        return ImportRequests {
            asked: vec![Asked::All; target_count],
            barrel: None,
        };
    }
    let may_be_barrel = code.analyzed.side_effects == DeclaredSideEffects::None
        && analysis.module_format == ModuleFormat::Esm
        && key.loader == HostLoader::default()
        && !is_entry_point(context, key);
    let mut summary = Summary {
        hir,
        bound,
        analysis,
        names: MemberNames {
            module_exports: context.atoms.intern(b"module.exports"),
            all: context.atoms.intern(b"all"),
            catch: context.atoms.intern(b"catch"),
            finally: context.atoms.intern(b"finally"),
        },
        uses: ImportUses::default(),
    };
    summary.collect_uses(may_be_barrel);
    let mut asked = Vec::with_capacity(target_count);
    let mut waiting_sites = Vec::with_capacity(analysis.import_sites.len());
    for (index, resolution) in code.resolutions.iter().enumerate() {
        let target = match resolution {
            SiteResolution::Constant(CodeResolution::File(file)) if file.host_module.is_none() => {
                Some(Some(asked.len() as u32))
            }
            SiteResolution::Constant(CodeResolution::NotFound(_)) => Some(None),
            SiteResolution::Constant(
                CodeResolution::File(_)
                | CodeResolution::HostModule(_)
                | CodeResolution::External { .. }
                | CodeResolution::Erased,
            )
            | SiteResolution::Computed(_) => None,
        };
        waiting_sites.push(target.map(|target| WaitingSite {
            site: index as u32,
            target,
        }));
        let count = count_targets(resolution) as usize;
        if count > 0 {
            asked.extend(std::iter::repeat_n(summary.asked_by(index), count));
        }
    }
    // The rest is what the host adds.
    debug_assert!(asked.len() <= target_count);
    asked.resize(target_count, Asked::All);
    ImportRequests {
        asked,
        barrel: match may_be_barrel {
            true => summary.find_barrel_shape(&waiting_sites),
            false => None,
        },
    }
}

// The file goes on as if the sites were not written: what they export is not among its exports.
pub(super) fn erase_waiting_sites(
    code: &mut LoadedCode<'_, '_>,
    loaded_targets: &mut Vec<u32>,
    waiting: &[WaitingSite],
) {
    debug_assert_eq!(code.targets.len(), loaded_targets.len());
    for it in waiting {
        debug_assert!(
            it.target
                .is_none_or(|it| loaded_targets[it as usize] == NOT_LOADED)
        );
        code.resolutions[it.site as usize] = SiteResolution::Constant(CodeResolution::Erased);
    }
    let mut is_kept = loaded_targets.iter().map(|&target| target != NOT_LOADED);
    code.targets.retain(|_| is_kept.next().unwrap_or(true));
    loaded_targets.retain(|&target| target != NOT_LOADED);

    code.targets_by_specifier.clear();
    let mut target = 0;
    for (site, resolution) in code
        .analyzed
        .analysis
        .import_sites
        .iter()
        .zip(&code.resolutions)
    {
        if let (
            SiteResolution::Constant(CodeResolution::File(_)),
            ImportSpecifier::Constant(specifier),
        ) = (resolution, site.specifier)
        {
            let kind = CodeImportKind::from_site(site.kind);
            code.targets_by_specifier
                .entry((specifier, kind))
                .or_insert(target);
        }
        target += count_targets(resolution);
    }
}

mod object_reads;
#[cfg(test)]
mod tests;
