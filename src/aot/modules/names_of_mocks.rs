use super::module_set::ModuleSet;
use super::plan::ModuleRef;
use super::requests::{FileScan, ScannedSite};
use bun_sema::atom::{Atom, known};
use bun_sema::bind::{Binding, Bound, Decl, PatParent};
use bun_sema::file_analysis::FileAnalysis;
use bun_sema::hir::{
    self, ExprId, ExprKind, Flags, FnBody, FnId, PropKey, PropKind, StmtKind, VarKind,
};
use bun_sema::import_sites::{ImportSiteKind, is_module_call_of_plugin};
use bun_sema::program::{FileId, Files};
use rustc_hash::{FxHashMap, FxHashSet};

#[derive(Default)]
pub(super) struct NamesInMock {
    written: Vec<Atom>,
    spreads_original: bool,
}

#[derive(Default)]
pub(super) struct NamesOfMocks {
    files: FxHashMap<FileId, Option<Vec<Atom>>>,
}

impl NamesOfMocks {
    pub(super) fn add(
        &mut self,
        files: &Files<'_>,
        modules: &ModuleSet,
        module: ModuleRef,
        in_mock: Option<&NamesInMock>,
    ) {
        for form in modules.forms_of(module).chain([module]) {
            if let ModuleRef::File(mocked) = form {
                self.add_to_file(files, mocked, in_mock);
            }
        }
    }

    fn add_to_file(&mut self, files: &Files<'_>, mocked: FileId, in_mock: Option<&NamesInMock>) {
        let names = self.files.entry(mocked).or_insert_with(|| Some(Vec::new()));
        match (in_mock, &mut *names) {
            (Some(in_mock), Some(names)) => {
                names.extend_from_slice(&in_mock.written);
                if in_mock.spreads_original {
                    let exports = files.exports_of_module(files.file_symbol(mocked)).iter();
                    names.extend(exports.map(|export| export.0));
                }
            }
            _ => *names = None,
        }
    }

    pub(super) fn finish(self) -> FxHashMap<FileId, Vec<Atom>> {
        let known = self.files.into_iter();
        let known = known.filter_map(|(file, names)| Some((file, names?)));
        known
            .map(|(file, names)| {
                let mut listed: FxHashSet<Atom> = FxHashSet::default();
                let names = names.into_iter().filter(|&name| listed.insert(name));
                (file, names.collect())
            })
            .collect()
    }
}

pub(super) struct MockReader<'a, 's> {
    pub hir: &'a hir::File<'s>,
    pub bound: &'a Bound<'s>,
    pub analysis: &'a FileAnalysis<'s>,
    pub scan: &'a FileScan,
}

impl MockReader<'_, '_> {
    pub(super) fn find_names(
        &self,
        call: ExprId,
        mocked: Option<ModuleRef>,
    ) -> Option<NamesInMock> {
        let (hir, bound) = (self.hir, self.bound);
        if is_module_call_of_plugin(hir, bound, call) {
            return None;
        }
        let ExprKind::Call(call) = hir[call].kind else {
            return None;
        };
        let arguments = hir[call].args;
        if arguments.len() < 2 {
            return None;
        }
        let factory = hir.skip_type_assertions(hir.id_at::<ExprId>(arguments, 1));
        let ExprKind::Fn(factory) = hir[factory].kind else {
            return None;
        };
        if hir[factory].flags.contains(Flags::GENERATOR) {
            return None;
        }
        let mut names = NamesInMock::default();
        match hir[factory].body {
            FnBody::None => return None,
            FnBody::Expr(value) => self.add_names_of_literal(factory, value, mocked, &mut names)?,
            FnBody::Block(_) => {
                for statement in bound.ids(bound.fns[factory.idx()].returns) {
                    let StmtKind::Return(value) = hir[statement].kind else {
                        return None;
                    };
                    if value.is_none() {
                        return None;
                    }
                    self.add_names_of_literal(factory, value, mocked, &mut names)?;
                }
            }
        }
        Some(names)
    }

    fn add_names_of_literal(
        &self,
        factory: FnId,
        value: ExprId,
        mocked: Option<ModuleRef>,
        names: &mut NamesInMock,
    ) -> Option<()> {
        let hir = self.hir;
        let ExprKind::Object(properties) = hir[hir.skip_type_assertions(value)].kind else {
            return None;
        };
        for property in properties.iter() {
            let property = &hir[property];
            match (property.kind, property.key) {
                (PropKind::Spread, _) if self.is_original(factory, property.value, mocked?) => {
                    names.spreads_original = true;
                }
                (PropKind::Spread, _) => return None,
                (PropKind::Init, PropKey::Name(known::__proto__)) => return None,
                (_, PropKey::Name(name)) => names.written.push(name),
                (_, PropKey::None | PropKey::Private(_) | PropKey::Computed(_)) => return None,
            }
        }
        Some(())
    }

    fn is_original(&self, factory: FnId, value: ExprId, mocked: ModuleRef) -> bool {
        let (hir, bound) = (self.hir, self.bound);
        let mut value = hir.skip_type_assertions(value);
        if matches!(hir[value].kind, ExprKind::Ident(_))
            && let Binding::Symbol(name) = bound.binding(value)
            && let [Decl::Var(pattern)] = *bound.symbol(name).decls
            && let PatParent::Var(declaration) = bound.pat_parent[pattern.idx()]
            && hir[declaration].kind == VarKind::Const
            && hir[declaration].init.is_some()
        {
            value = hir.skip_type_assertions(hir[declaration].init);
        }
        if let ExprKind::Await(promise) = hir[value].kind {
            value = hir.skip_type_assertions(promise);
        }
        let ExprKind::Call(call) = hir[value].kind else {
            return false;
        };
        if let Some(site) = self.analysis.import_site_of_call(value) {
            return matches!(
                self.analysis.import_sites[site].kind,
                ImportSiteKind::ImportByTestRunner(_) | ImportSiteKind::RequireByTestRunner(_)
            ) && matches!(self.scan.sites[site], ScannedSite::Module(named) if named == mocked);
        }
        let callee = hir.skip_type_assertions(hir[call].callee);
        let Binding::Symbol(name) = bound.binding(callee) else {
            return false;
        };
        let [Decl::Param(pattern)] = *bound.symbol(name).decls else {
            return false;
        };
        matches!(hir[callee].kind, ExprKind::Ident(_))
            && bound.is_stable_binding(name)
            && matches!(bound.pat_parent[pattern.idx()], PatParent::Param(parameter) if bound.param_fn[parameter.idx()] == factory)
    }
}
